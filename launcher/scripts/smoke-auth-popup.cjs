// Offline Electron regression: no account, user profile, Codex config, or network is used.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow, session, webContents } = require("electron");
const { BrowserHost } = require("../electron/browser-host.cjs");

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "codex-auth-popup-smoke-"));
app.setPath("userData", scratch);
const timeout = setTimeout(() => { console.error("Auth popup smoke timed out"); app.exit(1); }, 20_000);
let window;

app.whenReady().then(async () => {
  window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  const partition = `auth-popup-smoke-${process.pid}`;
  const fixture = Object.assign(Object.create(BrowserHost.prototype), {
    window,
    partition,
    authView: null,
    bounds: { x: 0, y: 0, width: 320, height: 240 },
    state: { zoomFactor: 1 },
    logger: { info() {}, error() {} },
    getBrowserInteractionMode: () => "manual",
    bindShellZoomShortcuts() {},
    syncViewVisibility() {},
    setState(patch) { Object.assign(this.state, patch); },
  });
  const url = "data:text/html,<title>Offline auth regression</title>Ready";
  for (const supplied of [false, true]) {
    const guest = supplied ? webContents.create({ partition, sandbox: true, contextIsolation: true, nodeIntegration: false }) : undefined;
    const contents = fixture.createAuthView({ webContents: guest }, url);
    assert.equal(contents.session, session.fromPartition(partition));
    if (guest) assert.equal(contents, guest);
    const preferences = contents.getLastWebPreferences();
    assert.equal(preferences.sandbox, true);
    assert.equal(preferences.nodeIntegration, false);
    assert.equal(preferences.contextIsolation, true);
    if (guest) await contents.loadURL(url);
    else if (contents.getURL() !== url || contents.isLoading()) {
      await new Promise((resolve, reject) => {
        contents.once("did-finish-load", resolve);
        contents.once("did-fail-load", (_event, _code, description) => reject(new Error(description)));
      });
    }
    assert.equal(contents.getTitle(), "Offline auth regression");
    fixture.closeAuthView(fixture.authView, true, false);
    assert.equal(fixture.authView, null);
  }
  console.log("PASS: missing and supplied Electron auth guests load in the owned sandboxed session");
}).then(() => finish(0), error => { console.error(error); finish(1); });

function finish(code) {
  clearTimeout(timeout);
  window?.destroy();
  fs.rmSync(scratch, { recursive: true, force: true });
  app.exit(code);
}
