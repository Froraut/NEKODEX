const STARTUP_PHASES = Object.freeze({
  "runtime-files": "preparing the packaged runtime",
  "electron-ready": "starting the desktop application",
  "window": "creating the launcher window",
  "browser-control": "starting the private browser control service",
  "browser": "initializing the embedded browser",
  "renderer": "loading the launcher interface",
  "runtime": "starting the local runtime",
});

function startupFailureDetails(error, phase) {
  const stage = Object.hasOwn(STARTUP_PHASES, phase) ? phase : "electron-ready";
  const message = typeof error?.message === "string" ? error.message : "";
  const reason = /timeout|timed out|deadline|within \d+ms/i.test(message) ? "timeout"
    : /ERR_[A-Z_]+/.test(message) ? "browser-load-failed" : "initialization-failed";
  // Startup errors can contain local paths, remote URLs and query credentials. Keep the
  // failure report useful without copying arbitrary exception text into UI or logs.
  return { phase: stage, reason };
}

async function settleWithin(action, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(action).then(() => true, () => false),
      new Promise(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}

async function recoverStartupFailure({
  app, dialog, error, phase, cleanup = () => {}, recordFailure = () => {},
  args = process.argv.slice(1), interactive = true, timeoutMs = 3_000,
}) {
  let exitCode = 1;
  const details = startupFailureDetails(error, phase);
  // Electron otherwise quits when the last window is destroyed. Hold the application
  // only while this native recovery dialog is visible, then unconditionally exit below.
  const keepRecoveryAlive = () => {};
  app.on("window-all-closed", keepRecoveryAlive);
  try {
    try { recordFailure(details); } catch {}
    // Cleanup cannot hold the single-instance lock indefinitely. A fresh process is the
    // retry boundary; we never rerun start() against partially initialized Electron state.
    const cleaned = await settleWithin(cleanup, timeoutMs);
    if (!interactive) return { action: "quit", ...details, cleaned };
    const ready = app.isReady() || await settleWithin(() => app.whenReady(), timeoutMs);
    if (!ready) {
      try {
        dialog.showErrorBox("Codex Web GPT could not start",
          `Startup failed while ${STARTUP_PHASES[details.phase]}. The application will exit. Open it again to retry.`);
      } catch {}
      return { action: "quit", ...details, cleaned };
    }
    const result = await dialog.showMessageBox({
      type: "error",
      title: "Codex Web GPT could not start",
      message: `Startup failed while ${STARTUP_PHASES[details.phase]}.`,
      detail: `${details.reason === "timeout" ? "This startup step exceeded its readiness deadline. " : ""}Restart to try again in a new process, or quit and reopen the application later. Your saved settings and sign-in data are retained.`,
      buttons: ["Quit", "Restart"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (result.response === 1) {
      // An explicit recovery launch must be visible even after a hidden autostart.
      app.relaunch({ args: args.filter(arg => arg !== "--hidden") });
      exitCode = 0;
      return { action: "restart", ...details, cleaned };
    }
    return { action: "quit", ...details, cleaned };
  } catch {
    // Native UI failures must not leave an invisible, locked launcher process behind.
    return { action: "quit", ...details };
  } finally {
    app.removeListener("window-all-closed", keepRecoveryAlive);
    app.exit(exitCode);
  }
}

module.exports = { recoverStartupFailure, startupFailureDetails };
