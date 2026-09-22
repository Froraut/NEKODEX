// Receives only the composition root's authorized, logged, lifecycle-guarded handle.
// Getters preserve current service identity across replacement and asynchronous callbacks.
function registerBrowserHandlers({
  handle, getBrowserHost, getRuntimeHost, stateStore, validateBounds,
  confirmExistingChromeImport, selectChromeConnectionFile, copyChromeSettingsAddress,
  invalidateAccountProof, send, platform,
}) {
  handle("launcher:browser-bounds", (event, bounds) => {
    getBrowserHost()?.setBounds(validateBounds(bounds), event.sender.getZoomFactor());
    return true;
  });
  handle("launcher:browser-surface-active", (_event, active) => getBrowserHost().setSurfaceActive(active === true));
  handle("launcher:browser-show", () => getBrowserHost().reveal(
    stateStore.read().browserInteractionMode === "automatic",
  ));
  handle("launcher:browser-hide", () => { getBrowserHost()?.hide(); return getBrowserHost()?.snapshot(); });
  handle("launcher:browser-navigate", (_event, action) => getBrowserHost().navigate(action));
  handle("launcher:browser-zoom", (_event, action) => getBrowserHost().zoom(action));
  handle("launcher:browser-tab-select", (_event, tabId) => getBrowserHost().selectTab(tabId));
  handle("launcher:browser-tab-close", (_event, tabId, expectedTraceId) => getBrowserHost().closeTab(tabId, expectedTraceId));
  handle('launcher:task-dismiss', (_event, accountId, id) => getBrowserHost().dismissTask(accountId, id));
  handle('launcher:queue-action', (_event, id, action) => getBrowserHost().queueAction(id, action));
  handle('launcher:queue-pause', (_event, accountId, paused) => getBrowserHost().pauseQueue(accountId, paused));
  handle("launcher:manual-prompt-copy", (_event, tabId) => getBrowserHost().copyManualPrompt(tabId));
  handle("launcher:manual-prompt-sent", (_event, tabId) => getBrowserHost().confirmManualSent(tabId));
  handle("launcher:browser-window-open", (_event, asTab = false) => {
    if (typeof asTab !== "boolean") throw new Error("Invalid browser window request");
    return getBrowserHost().openWorkspaceWindow(asTab);
  });
  handle("launcher:browser-workspaces", () => getBrowserHost().workspaceSnapshot());
  handle("launcher:browser-workspace-open", (_event, accountId, options) =>
    getBrowserHost().openWorkspace(accountId, options));
  handle("launcher:browser-workspace-restore", (_event, accountId) =>
    getBrowserHost().restoreWorkspaces(accountId));
  handle("launcher:browser-workspace-focus", (_event, accountId, workspaceId) =>
    getBrowserHost().focusWorkspace(accountId, workspaceId));
  handle("launcher:browser-workspace-close", (_event, accountId, workspaceId) =>
    getBrowserHost().closeWorkspace(accountId, workspaceId));
  handle("launcher:browser-login", async () => {
    const browser = await getBrowserHost().openLogin();
    return browser;
  });
  handle("launcher:browser-passkey-login", async () => {
    const browser = await getBrowserHost().openPasskeyLogin();
    return browser;
  });
  handle("launcher:browser-passkey-login-continue", () => {
    if (getBrowserHost().snapshot().passkeyLogin?.canImport !== true) throw new Error("No passkey sign-in is waiting for Continue");
    return getRuntimeHost().continuePasskeyLogin();
  });
  handle("launcher:browser-passkey-login-reveal", () => {
    if (getBrowserHost().snapshot().passkeyLogin?.canReveal !== true) throw new Error("No dedicated Chrome sign-in is waiting");
    return getRuntimeHost().revealPasskeyLogin();
  });
  handle("launcher:browser-passkey-login-cancel", () => getBrowserHost().cancelPasskeyLogin(() => getRuntimeHost().cancelPasskeyLogin()));
  handle("launcher:browser-existing-chrome-login", async () => {
    // Normal macOS Chrome entry points share the selected-profile identity transaction,
    // even when the separate passkey-browser preference is Firefox.
    if (platform === "darwin") return await getBrowserHost().openPasskeyLogin("chrome-profile");
    const browser = await getBrowserHost().openExistingChromeLogin(() => confirmExistingChromeImport());
    return browser;
  });
  handle("launcher:browser-existing-chrome-login-cancel", () => getBrowserHost().cancelExistingChromeLogin(() => getRuntimeHost().cancelExistingChromeLogin()));
  handle("launcher:browser-existing-chrome-file-access", async () => {
    const browser = await getBrowserHost().allowExistingChromeFileAccess(signal => selectChromeConnectionFile(signal));
    return browser;
  });
  handle("launcher:browser-existing-chrome-settings-copy", () => {
    copyChromeSettingsAddress();
    return true;
  });
  handle("launcher:browser-logout", async () => {
    invalidateAccountProof();
    const browser = await getBrowserHost().logout();
    const state = stateStore.read();
    send("launcher:state-changed", state);
    return { browser, state };
  });
}

module.exports = { registerBrowserHandlers };
