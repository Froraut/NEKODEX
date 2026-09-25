const ACTIVE_PHASES = new Set(["starting", "waiting", "importing", "verifying", "cancelling"]);
const PUBLIC_ERROR_CODES = new Set([
  "chrome-account-mismatch",
  "chrome-account-unverified",
  "chrome-account-unidentified",
  "chrome-profile-claim-missing",
  "passkey-timeout",
  "passkey-handoff-timeout",
  "passkey-capture-failed",
  "passkey-validation-failed",
  "passkey-cleanup-failed",
  "passkey-verification-failed",
  "passkey-import-failed",
]);
const CLEANUP_FAILURE = /(cleanup|clearing|removing|did not exit|termination|refused)/i;

function initialPasskeyProgress(now = Date.now()) {
  return {
    phase: "starting",
    startedAt: new Date(now).toISOString(),
    deadlineAt: new Date(now + 10 * 60_000).toISOString(),
    error: null,
    revealError: null,
  };
}

function publicPasskeyProgress(progress) {
  if (!progress) return null;
  return {
    phase: progress.phase,
    startedAt: progress.startedAt,
    deadlineAt: progress.deadlineAt,
    error: PUBLIC_ERROR_CODES.has(progress.error) ? progress.error : progress.error ? "passkey-import-failed" : null,
    revealError: progress.revealError === "passkey-reveal-failed" ? progress.revealError : null,
    active: ACTIVE_PHASES.has(progress.phase),
    canImport: progress.phase === "waiting",
    canReveal: progress.phase === "waiting",
    canCancel: ACTIVE_PHASES.has(progress.phase) && progress.phase !== "cancelling",
  };
}

/** Classifies a failed sign-in; the raw error message never leaves this function. */
function passkeyLoginFailure(error, { aborted, progressPhase }) {
  const message = error instanceof Error ? error.message : String(error);
  const cancelled = (aborted || error?.code === "profile-login-cancelled") && !CLEANUP_FAILURE.test(message);
  const phase = cancelled ? "cancelled" : /timed out/i.test(message) ? "timed-out" : "failed";
  const errorCode = phase === "cancelled" ? null
    : ["chrome-account-mismatch", "chrome-account-unverified", "chrome-account-unidentified",
      "chrome-profile-claim-missing"].includes(error?.code) ? error.code
    : error?.code === "existing_chrome_handoff_timeout" ? "passkey-handoff-timeout"
      : phase === "timed-out" ? "passkey-timeout"
        : CLEANUP_FAILURE.test(message) ? "passkey-cleanup-failed"
          : /invalid (storage-state|cookie|origin|ChatGPT local storage)|contains no ChatGPT\/OpenAI cookies|too (large|many)/i.test(message) ? "passkey-validation-failed"
            : progressPhase === "verifying" ? "passkey-verification-failed"
              : progressPhase === "starting" || progressPhase === "waiting" || progressPhase === "importing"
                ? "passkey-capture-failed" : "passkey-import-failed";
  return { phase, errorCode };
}

function parsePasskeyProgress(line) {
  if (!line.startsWith("@codex-passkey:")) return null;
  let message;
  try { message = JSON.parse(line.slice("@codex-passkey:".length)); } catch { return null; }
  if (message?.version !== 1) return null;
  if (message.phase === "waiting" && Number.isFinite(Date.parse(message.deadlineAt))) {
    return { phase: "waiting", deadlineAt: message.deadlineAt };
  }
  if (message.event === "revealed") return { revealError: null };
  if (message.event === "reveal-failed") return { revealError: "passkey-reveal-failed" };
  return null;
}

module.exports = { initialPasskeyProgress, passkeyLoginFailure, publicPasskeyProgress, parsePasskeyProgress };
