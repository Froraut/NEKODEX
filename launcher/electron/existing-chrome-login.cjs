const ACTIVE_PHASES = new Set(["consent", "discovering", "waiting-for-chrome", "reading-session", "verifying", "cancelling"]);
const CAPTURE_PHASES = new Set(["discovering", "waiting-for-chrome", "reading-session"]);
const PREFIX = "@codex-chrome-import:";

function initialExistingChromeProgress(now = Date.now()) {
  return { phase: "consent", startedAt: new Date(now).toISOString(), deadlineAt: new Date(now + 180_000).toISOString(), error: null };
}

function publicExistingChromeProgress(progress) {
  if (!progress) return null;
  return {
    phase: progress.phase, startedAt: progress.startedAt, deadlineAt: progress.deadlineAt,
    error: progress.error, active: ACTIVE_PHASES.has(progress.phase),
    canCancel: ACTIVE_PHASES.has(progress.phase) && !["consent", "cancelling"].includes(progress.phase),
    canCopySettings: ["discovering", "waiting-for-chrome", "failed", "timed-out", "cancelled"].includes(progress.phase),
  };
}

function parseExistingChromeProgress(line) {
  if (!line.startsWith(PREFIX) || line.length > 2048) return null;
  let value;
  try { value = JSON.parse(line.slice(PREFIX.length)); } catch { return null; }
  if (value?.version !== 1 || !CAPTURE_PHASES.has(value.phase)
    || typeof value.deadlineAt !== "string" || !Number.isFinite(Date.parse(value.deadlineAt))) return null;
  return { phase: value.phase, deadlineAt: value.deadlineAt };
}

function updateExistingChromeProgress(host, patch) {
  host.existingChromeProgress = { ...host.existingChromeProgress, ...patch };
  host.publishState?.(host.snapshot());
}

function safeImportError(error, cleanupFailed = false) {
  const timeout = error?.code === "existing_chrome_timeout" || /timed out/i.test(error?.message ?? "");
  const cleanup = cleanupFailed || error?.code === "existing_chrome_cleanup_failed"
    || /(clearing the partial|partial passkey session cleanup|removing temporary passkey state)/i.test(error?.message ?? "");
  const failure = new Error(cleanup ? "Existing Chrome import cleanup failed; retry before using the launcher session"
    : timeout ? "Existing Chrome sign-in timed out" : "Existing Chrome sign-in could not be imported");
  failure.code = cleanup ? "existing_chrome_cleanup_failed" : timeout ? "existing_chrome_timeout" : "existing_chrome_import_failed";
  return failure;
}

function openExistingChromeLogin(host, confirmImport) {
  if (host.existingChromeLoginOperation) return host.existingChromeLoginOperation;
  if (host.state.authenticated) { host.activateHomeSurface(); host.show(); return Promise.resolve(host.snapshot()); }
  const embeddedLogin = host.embeddedLoginController ? host.loginOperation : null;
  const embeddedController = host.embeddedLoginController;
  if (host.loginOperation && !embeddedLogin) throw new Error("Another ChatGPT sign-in is active");
  if (typeof host.loginWithExistingChrome !== "function" || typeof confirmImport !== "function") {
    throw new Error("Existing Chrome sign-in is unavailable");
  }
  // Consent is part of the single owner operation. Neither the helper nor Chrome starts first.
  const controller = new AbortController();
  host.existingChromeLoginController = controller;
  host.existingChromeProgress = initialExistingChromeProgress();
  host.passkeyProgress = null;
  let previousState;
  let importStarted = false;
  let consented = false;
  const operation = (async () => {
    if (await confirmImport() !== true) { controller.abort(); return host.snapshot(); }
    controller.signal.throwIfAborted();
    consented = true;
    if (host.state.authenticated) { host.existingChromeProgress = null; return host.snapshot(); }
    host.passkeyProgress = null;
    if (embeddedLogin) {
      embeddedController.abort();
      for (const view of [host.view, host.authView]) {
        if (view && !view.webContents.isDestroyed()) view.webContents.stop();
      }
      await embeddedLogin;
      host.closeAuthView(host.authView, true, false);
    }
    if (host.sessionRefreshOperation) {
      try { await host.sessionRefreshOperation; } catch { /* Explicit login can recover a stale session. */ }
    }
    controller.signal.throwIfAborted();
    if (host.state.authenticated) { host.existingChromeProgress = null; return host.snapshot(); }
    previousState = { ...host.state };
    host.authGeneration = (host.authGeneration ?? 0) + 1;
    host.authNavigationError = null;
    return await host.withManualOperation("Existing Chrome sign-in", async () => {
      let cleanupFailed = false;
      try {
        controller.signal.throwIfAborted();
        updateExistingChromeProgress(host, { phase: "discovering" });
        host.setState({ status: "loading", loading: true, message: "Waiting for permission to import the existing Chrome sign-in" });
        const capture = await host.loginWithExistingChrome(patch => {
          if (!controller.signal.aborted) updateExistingChromeProgress(host, patch);
        });
        const transfer = { storageState: capture.storageState, cleanup: async () => {
          try { await capture.cleanup(); } catch { cleanupFailed = true; throw safeImportError(null, true); }
        } };
        if (controller.signal.aborted) { await transfer.cleanup(); controller.signal.throwIfAborted(); }
        updateExistingChromeProgress(host, { phase: "verifying" });
        importStarted = true;
        const result = await host.installPasskeyLogin(transfer, controller.signal);
        updateExistingChromeProgress(host, { phase: "completed", error: null });
        return result;
      } catch (error) {
        // withManualOperation publishes the thrown message; sanitize before crossing that boundary.
        throw safeImportError(error, cleanupFailed);
      }
    });
  })();
  const tracked = operation.catch(error => {
    // Only fixed diagnostics reach state/UI; CDP errors may contain URLs or credential data.
    const failure = safeImportError(error);
    const cleanupFailed = failure.code === "existing_chrome_cleanup_failed";
    const cancelled = controller.signal.aborted && !cleanupFailed;
    const timeout = failure.code === "existing_chrome_timeout";
    const phase = cancelled ? "cancelled" : timeout ? "timed-out" : "failed";
    updateExistingChromeProgress(host, { phase, error: cancelled ? null : cleanupFailed ? "existing-chrome-cleanup-failed" : timeout ? "existing-chrome-timeout" : "existing-chrome-import-failed" });
    if (!importStarted && previousState) host.setState(previousState);
    if (importStarted || cleanupFailed) host.setState({ status: "error", loading: false, message: failure.message });
    if (cancelled) return host.snapshot();
    throw failure;
  }).finally(() => {
    if (controller.signal.aborted && host.existingChromeProgress?.phase === "consent") {
      updateExistingChromeProgress(host, { phase: "cancelled", error: null });
    }
    if (host.loginOperation === tracked) host.loginOperation = !consented && embeddedController
      && host.embeddedLoginController === embeddedController ? embeddedLogin : null;
    if (host.existingChromeLoginOperation === tracked) host.existingChromeLoginOperation = null;
    if (host.existingChromeLoginController === controller) host.existingChromeLoginController = null;
    host.publishState?.(host.snapshot());
  }).then(() => host.snapshot());
  host.loginOperation = tracked;
  host.existingChromeLoginOperation = tracked;
  host.publishState?.(host.snapshot());
  return tracked;
}

async function cancelExistingChromeLogin(host, cancelCapture) {
  const controller = host.existingChromeLoginController;
  if (!controller || !host.existingChromeLoginOperation) throw new Error("No existing Chrome sign-in is active");
  const capturing = CAPTURE_PHASES.has(host.existingChromeProgress?.phase);
  controller.abort(new Error("Existing Chrome sign-in cancelled"));
  updateExistingChromeProgress(host, { phase: "cancelling" });
  if (capturing) { try { await cancelCapture(); } catch { /* The capture may have already disconnected. */ } }
  await host.existingChromeLoginOperation;
  return host.snapshot();
}

module.exports = { initialExistingChromeProgress, publicExistingChromeProgress, parseExistingChromeProgress, openExistingChromeLogin, cancelExistingChromeLogin };
