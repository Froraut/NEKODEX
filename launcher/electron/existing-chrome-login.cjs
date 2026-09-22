const { publishBrowserSnapshot } = require("./browser-state-publication.cjs");
const { isExistingChromeErrorCode, existingChromeError } = require("./existing-chrome-errors.cjs");
const ACTIVE_PHASES = new Set(["consent", "preparing", "file-access", "discovering", "waiting-for-chrome", "reading-session", "verifying", "cancelling"]);
const CAPTURE_PHASES = new Set(["discovering", "waiting-for-chrome", "reading-session"]);
const PREFIX = "@codex-chrome-import:";
const AUTH_HANDOFF_TIMEOUT_MS = 15_000;

function waitForPreviousAuthentication(operation, signal, timeoutMs = AUTH_HANDOFF_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", aborted);
      error ? reject(error) : resolve(result);
    };
    const aborted = () => finish(new Error("Existing Chrome sign-in cancelled"));
    const timer = setTimeout(() => {
      const error = new Error("The previous launcher sign-in did not finish before the handoff timed out");
      error.code = "existing_chrome_handoff_timeout";
      finish(error);
    }, Math.max(1, timeoutMs));
    signal.addEventListener("abort", aborted, { once: true });
    // Keep handlers attached after cancellation/timeout: a late rejection must not be unhandled.
    Promise.resolve(operation).then(result => finish(null, result), error => finish(error));
    if (signal.aborted) aborted();
  });
}

function initialExistingChromeProgress(now = Date.now()) {
  return { phase: "consent", startedAt: new Date(now).toISOString(), deadlineAt: new Date(now + 180_000).toISOString(), error: null };
}

function publicExistingChromeProgress(progress, platform = process.platform) {
  if (!progress) return null;
  return {
    phase: progress.phase, startedAt: progress.startedAt, deadlineAt: progress.deadlineAt,
    error: progress.error, active: ACTIVE_PHASES.has(progress.phase),
    canCancel: ACTIVE_PHASES.has(progress.phase) && !["consent", "cancelling"].includes(progress.phase),
    canAllowFileAccess: platform === "darwin" && progress.phase === "failed" && progress.error === "chrome-profile-access-denied",
    canCopySettings: !["existing-chrome-handoff-timeout", "session-verification-failed"].includes(progress.error)
      && ["discovering", "waiting-for-chrome", "failed", "timed-out", "cancelled"].includes(progress.phase),
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
  if (typeof patch.phase === "string") {
    host.logger?.info?.("browser.existing_chrome_progress", { phase: patch.phase });
  }
  publishBrowserSnapshot(host);
}

function safeImportError(error, cleanupFailed = false, verifying = false) {
  if (error?.code === "existing_chrome_handoff_timeout") {
    const failure = new Error("The previous launcher sign-in is still stopping; retry after it finishes or restart the launcher");
    failure.code = "existing_chrome_handoff_timeout";
    return failure;
  }
  const timeout = error?.code === "existing_chrome_timeout" || /timed out|before the timeout/i.test(error?.message ?? "");
  const cleanup = cleanupFailed || error?.code === "existing_chrome_cleanup_failed"
    || /(clearing the partial|partial passkey session cleanup|removing temporary passkey state)/i.test(error?.message ?? "");
  if (verifying && !cleanup) return existingChromeError("session-verification-failed");
  if (!cleanup && isExistingChromeErrorCode(error?.code)) return existingChromeError(error.code);
  const failure = new Error(cleanup ? "Existing Chrome import cleanup failed; retry before using the launcher session"
    : timeout ? "Existing Chrome sign-in timed out" : "Existing Chrome sign-in could not be imported");
  failure.code = cleanup ? "existing_chrome_cleanup_failed" : timeout ? "existing_chrome_timeout" : "existing_chrome_import_failed";
  return failure;
}

function openExistingChromeLogin(host, confirmImport, { selectConnectionFile } = {}) {
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
  host.logger?.info?.("browser.existing_chrome_progress", { phase: "consent" });
  host.passkeyProgress = null;
  let previousState;
  let importStarted = false;
  let restoredState;
  const operation = (async () => {
    if (await confirmImport() !== true) { controller.abort(); return host.snapshot(); }
    controller.signal.throwIfAborted();
    if (host.state.authenticated) { host.existingChromeProgress = null; return host.snapshot(); }
    host.passkeyProgress = null;
    const handoffDeadline = Date.now() + AUTH_HANDOFF_TIMEOUT_MS;
    updateExistingChromeProgress(host, { phase: "preparing", deadlineAt: new Date(handoffDeadline).toISOString() });
    if (embeddedLogin) {
      embeddedController.abort();
      for (const view of [host.view, host.authView]) {
        if (view && !view.webContents.isDestroyed()) view.webContents.stop();
      }
      await waitForPreviousAuthentication(embeddedLogin, controller.signal, handoffDeadline - Date.now());
      host.closeAuthView(host.authView, true, false);
    }
    if (host.sessionRefreshOperation) {
      try {
        await waitForPreviousAuthentication(host.sessionRefreshOperation, controller.signal, handoffDeadline - Date.now());
      } catch (error) {
        if (controller.signal.aborted || error?.code === "existing_chrome_handoff_timeout") throw error;
        // A completed refresh failure permits explicit sign-in; an unresolved owner does not.
      }
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
        let captureOptions;
        if (selectConnectionFile) {
          updateExistingChromeProgress(host, { phase: "file-access" });
          const contents = await selectConnectionFile(controller.signal);
          if (contents === null) controller.abort(new Error("Existing Chrome sign-in cancelled"));
          controller.signal.throwIfAborted();
          captureOptions = { selectedDiscoveryContents: contents };
        }
        updateExistingChromeProgress(host, { phase: "discovering", deadlineAt: new Date(Date.now() + 180_000).toISOString() });
        host.setState({ status: "loading", loading: true, message: "Waiting for permission to import the existing Chrome sign-in" });
        const capture = await host.loginWithExistingChrome(patch => {
          if (!controller.signal.aborted) updateExistingChromeProgress(host, patch);
        }, captureOptions);
        const transfer = { storageState: capture.storageState, cleanup: async () => {
          try { await capture.cleanup(); } catch { cleanupFailed = true; throw safeImportError(null, true); }
        } };
        if (controller.signal.aborted) { await transfer.cleanup(); controller.signal.throwIfAborted(); }
        updateExistingChromeProgress(host, { phase: "verifying" });
        importStarted = true;
        let result;
        try {
          result = await host.installPasskeyLogin(transfer, controller.signal);
        } catch (error) {
          // Only the local installer can attest to rollback. Capture its fresh
          // presentation before withManualOperation overwrites it; identity stays live.
          if (error?.previousSessionRestored === true) {
            const { status, loading, message } = host.state;
            restoredState = { status, loading, message };
          }
          throw error;
        }
        updateExistingChromeProgress(host, { phase: "completed", error: null });
        return result;
      } catch (error) {
        // withManualOperation publishes the thrown message; sanitize before crossing that boundary.
        const failure = safeImportError(error, cleanupFailed, importStarted && !controller.signal.aborted);
        if (restoredState) failure.previousSessionRestored = true;
        throw failure;
      }
    });
  })();
  const tracked = operation.catch(error => {
    // Only fixed diagnostics reach state/UI; CDP errors may contain URLs or credential data.
    const failure = safeImportError(error);
    if (restoredState && error?.previousSessionRestored === true) failure.previousSessionRestored = true;
    const cleanupFailed = failure.code === "existing_chrome_cleanup_failed";
    const cancelled = controller.signal.aborted && !cleanupFailed;
    const timeout = failure.code === "existing_chrome_timeout" || failure.code === "chrome-permission-timeout"
      || failure.code === "existing_chrome_handoff_timeout";
    const phase = cancelled ? "cancelled" : timeout ? "timed-out" : "failed";
    updateExistingChromeProgress(host, { phase, error: cancelled ? null : cleanupFailed ? "existing-chrome-cleanup-failed"
      : failure.code === "existing_chrome_handoff_timeout" ? "existing-chrome-handoff-timeout"
      : isExistingChromeErrorCode(failure.code) ? failure.code : timeout ? "existing-chrome-timeout" : "existing-chrome-import-failed" });
    if (!importStarted && previousState) host.setState(previousState);
    if (restoredState && failure.previousSessionRestored && !cleanupFailed) host.setState(restoredState);
    else if (importStarted || cleanupFailed) host.setState({ status: "error", loading: false, message: failure.message });
    if (cancelled) return host.snapshot();
    throw failure;
  }).finally(() => {
    if (controller.signal.aborted && host.existingChromeProgress?.phase === "consent") {
      updateExistingChromeProgress(host, { phase: "cancelled", error: null });
    }
    if (host.loginOperation === tracked) host.loginOperation = embeddedController
      && host.embeddedLoginController === embeddedController ? embeddedLogin : null;
    if (host.existingChromeLoginOperation === tracked) host.existingChromeLoginOperation = null;
    if (host.existingChromeLoginController === controller) host.existingChromeLoginController = null;
    host.logger?.info?.("browser.existing_chrome_operation_settled", {
      phase: host.existingChromeProgress?.phase ?? "not-needed",
      previousLoginPending: Boolean(host.loginOperation || host.sessionRefreshOperation),
    });
    publishBrowserSnapshot(host);
  }).then(() => host.snapshot());
  host.loginOperation = tracked;
  host.existingChromeLoginOperation = tracked;
  publishBrowserSnapshot(host);
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

module.exports = { initialExistingChromeProgress, publicExistingChromeProgress, parseExistingChromeProgress, openExistingChromeLogin, cancelExistingChromeLogin, waitForPreviousAuthentication };
