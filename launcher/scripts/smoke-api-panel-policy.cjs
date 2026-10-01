const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { openAiApiPanelUrl, allowedOpenAiApiPanelUrl, openAiApiSessionMutation,
  isOpenAiApiSessionMutationRequest } = require("../electron/openai-api-panel.cjs");
const { BrowserWorkspaceWindows } = require("../electron/browser-workspace-windows.cjs");

assert.equal(openAiApiPanelUrl(), "https://platform.openai.com/settings/organization/tunnels");
assert.equal(openAiApiPanelUrl("keys"), "https://platform.openai.com/settings/organization/api-keys");
assert.throws(() => openAiApiPanelUrl("__proto__"), /invalid/);
assert.equal(allowedOpenAiApiPanelUrl(openAiApiPanelUrl()), true);
assert.equal(allowedOpenAiApiPanelUrl("https://auth.openai.com/log-in"), true);
for (const url of ["http://platform.openai.com/", "https://platform.openai.com.evil.test/",
  "https://user:password@platform.openai.com/", "https://platform.openai.com:444/", "http://127.0.0.1/"]) {
  assert.equal(allowedOpenAiApiPanelUrl(url), false);
}
assert.equal(openAiApiSessionMutation(openAiApiPanelUrl()), false);
assert.equal(openAiApiSessionMutation("https://auth.openai.com/log-in"), true);
assert.equal(isOpenAiApiSessionMutationRequest({ method: "POST", url: "https://platform.openai.com/api/auth/signout" }), true);
assert.equal(isOpenAiApiSessionMutationRequest({ method: "GET", url: "https://platform.openai.com/api/auth/signout" }), false);
assert.equal(isOpenAiApiSessionMutationRequest({ method: "POST", url: openAiApiPanelUrl("keys") }), false);

class FakeWindow extends EventEmitter {
  constructor() {
    super();
    this.destroyed = false;
    this.webContents = new EventEmitter();
    this.webContents.setWindowOpenHandler = handler => { this.popupHandler = handler; };
    this.webContents.getURL = () => this.url ?? "";
  }
  isDestroyed() { return this.destroyed; }
  loadURL(url) { this.url = url; return Promise.resolve(); }
  show() {}
  focus() {}
  addTabbedWindow() {}
  destroy() { if (!this.destroyed) { this.destroyed = true; this.emit("closed"); } }
}
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "nekodex-api-policy-"));
try {
  const manifest = path.join(scratch, "existing-chat-workspaces.json");
  fs.writeFileSync(manifest, "existing owned chat state\n");
  const manager = new BrowserWorkspaceWindows({ accountId: "default", manifestPath: manifest,
    persistLocations: false, home: openAiApiPanelUrl(), allowedUrl: allowedOpenAiApiPanelUrl });
  manager.ensureManifestLoaded();
  manager.saved.set("private", { location: "https://platform.openai.com/auth/callback?code=private" });
  assert.equal(manager.persist().ok, true);
  manager.removeSavedWorkspace("private");
  manager.destroy();
  assert.equal(fs.readFileSync(manifest, "utf8"), "existing owned chat state\n");
  const popupManager = new BrowserWorkspaceWindows({ BrowserWindow: FakeWindow,
    accountId: "default", manifestPath: manifest, persistLocations: false,
    home: openAiApiPanelUrl(), allowedUrl: allowedOpenAiApiPanelUrl,
    register() {}, unregister() {}, external() {}, onChanged() {},
    beginSessionMutation: ({ sourceId }) => ({ sourceId, fail() {}, finish() {} }) });
  const first = popupManager.open();
  const second = popupManager.open();
  const firstUrl = "https://auth.openai.com/authorize?owner=first";
  const secondUrl = "https://auth.openai.com/authorize?owner=second";
  assert.equal(first.popupHandler({ url: firstUrl }).action, "allow");
  assert.equal(second.popupHandler({ url: secondUrl }).action, "allow");
  const secondChild = new FakeWindow();
  second.webContents.emit("did-create-window", secondChild, { url: secondUrl });
  assert.equal(popupManager.mutationLeasesByContents.get(secondChild.webContents).sourceId,
    popupManager.windowMeta.get(second).id);
  const firstChild = new FakeWindow();
  first.webContents.emit("did-create-window", firstChild, { url: firstUrl });
  assert.equal(popupManager.mutationLeasesByContents.get(firstChild.webContents).sourceId,
    popupManager.windowMeta.get(first).id);
  popupManager.destroy();
  assert.equal(fs.readFileSync(manifest, "utf8"), "existing owned chat state\n");
  console.log("API_PANEL_POLICY_OK fixed-sections https-auth account-session no-url-persistence");
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
