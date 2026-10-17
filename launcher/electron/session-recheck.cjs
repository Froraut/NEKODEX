// A session check that fails for a transient reason (no network yet after login, a VPN that
// is still connecting, a slow or challenged page) left the account on "Verification
// unavailable" until someone pressed Retry. Re-run the read-only check on a backoff while
// the account stays unavailable, never while a task or a user-driven operation owns the
// browser, and stop once ChatGPT gives a definite answer.

const RECHECK_DELAYS_MS = [20_000, 60_000, 120_000, 300_000, 600_000];
// These need the user: a different signed-in principal or an expired session.
const USER_ACTION_ISSUES = new Set(["identity", "expired"]);

function sessionRecheckDelayMs(attempt) {
  return RECHECK_DELAYS_MS[Math.min(Math.max(attempt, 0), RECHECK_DELAYS_MS.length - 1)];
}

function sessionRecheckWanted(host) {
  const state = host.state ?? {};
  return !host.destroyed && host.sessionRecheckEnabled?.() !== false
    && state.authenticationStatus === "unavailable" && !USER_ACTION_ISSUES.has(state.authenticationIssue);
}

function cancelSessionRecheck(host) {
  clearTimeout(host.sessionRecheckTimer);
  host.sessionRecheckTimer = null;
}

/** Called after every state change: arms, keeps or cancels the single pending re-check. */
function syncSessionRecheck(host, { setTimer = setTimeout } = {}) {
  const status = host.state?.authenticationStatus;
  if (status === "verified" || status === "signed-out") host.sessionRecheckAttempt = 0;
  if (!sessionRecheckWanted(host)) {
    // "unknown" is the retry itself in flight; its outcome re-arms the timer.
    if (status !== "unknown") cancelSessionRecheck(host);
    return;
  }
  if (host.sessionRecheckTimer || host.sessionRecheckRunning) return;
  const attempt = host.sessionRecheckAttempt ?? 0;
  host.sessionRecheckTimer = setTimer(() => {
    host.sessionRecheckTimer = null;
    if (!sessionRecheckWanted(host)) return;
    // A running task, a manual browser operation or a page the user is looking at keeps
    // the browser; try again after the next delay.
    if (host.activeTraceId || host.manualOperation || host.readOnlyInspection || host.visible) {
      syncSessionRecheck(host, { setTimer });
      return;
    }
    host.sessionRecheckAttempt = attempt + 1;
    host.sessionRecheckRunning = true;
    host.logger?.info?.("browser.session_recheck_started", {
      attempt: attempt + 1, issue: host.state?.authenticationIssue ?? null,
    });
    Promise.resolve()
      .then(() => host.retryAuthenticationCheck())
      .then(state => host.logger?.info?.("browser.session_recheck_completed", {
        authenticationStatus: state?.authenticationStatus ?? null,
      }))
      .catch(error => host.logger?.info?.("browser.session_recheck_failed", {
        message: (error instanceof Error ? error.message : String(error)).split("\n")[0].slice(0, 160),
      }))
      .finally(() => {
        host.sessionRecheckRunning = false;
        syncSessionRecheck(host, { setTimer });
      });
  }, sessionRecheckDelayMs(attempt));
  host.sessionRecheckTimer?.unref?.();
}

module.exports = { cancelSessionRecheck, sessionRecheckDelayMs, syncSessionRecheck };
