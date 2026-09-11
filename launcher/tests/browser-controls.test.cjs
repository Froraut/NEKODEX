const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const source = fs.readFileSync(path.join(__dirname, "../src/browser-controls.ts"), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
}).outputText;
const loaded = { exports: {} };
Function("module", "exports", "require", output)(loaded, loaded.exports, require);
const { browserControls } = loaded.exports;

const signedOut = {
  status: "signed-out",
  authenticated: false,
  navigationLocked: false,
  loginInProgress: false,
  loginKind: null,
};

test("a waiting embedded login locks navigation while retaining the macOS passkey escape route", () => {
  for (const status of ["signed-out", "loading", "ready"]) {
    const state = browserControls({ ...signedOut, status, navigationLocked: true, loginInProgress: true, loginKind: "embedded" }, null, "darwin", "automatic");
    assert.equal(state.navigationLocked, true);
    assert.equal(state.passkeyAvailable, true);
    assert.equal(state.passkeyWaiting, false);
    assert.equal(state.passkeyBlocked, false);
  }
});

test("a pending passkey switch locks Import until the owned child confirms it is waiting", () => {
  const state = browserControls({ ...signedOut, loginInProgress: true, loginKind: "passkey" }, null, "darwin", "automatic");
  assert.equal(state.navigationLocked, true);
  assert.equal(state.passkeyWaiting, true);
  assert.equal(state.passkeyBlocked, false);
  assert.equal(state.passkeyCanImport, false);
});

test("only a current main-process waiting phase can enable Import after a renderer reload", () => {
  for (const phase of ["waiting", "starting", "importing", "verifying", "cancelling"]) {
    const browser = JSON.parse(JSON.stringify({ ...signedOut, loginKind: "passkey", passkeyLogin: {
      phase, active: true, canImport: phase === "waiting",
    } }));
    const controls = browserControls(browser, null, "darwin", "automatic");
    assert.equal(controls.passkeyCanImport, phase === "waiting");
    assert.equal(controls.navigationLocked, true);
  }
});

test("passkey progress and unrelated runtime work have distinct controls", () => {
  const passkey = browserControls(signedOut, { name: "passkey-login", status: "running" }, "darwin", "automatic");
  assert.equal(passkey.passkeyWaiting, true);
  assert.equal(passkey.passkeyBlocked, false);
  const setup = browserControls(signedOut, { name: "setup", status: "running" }, "darwin", "automatic");
  assert.equal(setup.passkeyWaiting, false);
  assert.equal(setup.passkeyBlocked, true);
  const failed = browserControls(signedOut, { name: "passkey-login", status: "failed" }, "darwin", "automatic");
  assert.equal(failed.passkeyWaiting, false);
  assert.equal(failed.passkeyBlocked, false);
});

test("browser automation cannot be launched from manual mode or other platforms", () => {
  for (const [platform, mode] of [["darwin", "manual"], ["win32", "automatic"], ["linux", "automatic"]]) {
    const state = browserControls(signedOut, null, platform, mode);
    assert.equal(state.passkeyAvailable, false);
    assert.equal(state.passkeyBlocked, true);
  }
});

test("active turns and a verified authenticated session cannot start a competing passkey flow", () => {
  for (const status of ["running", "testing"]) {
    const state = browserControls({ ...signedOut, status }, null, "darwin", "automatic");
    assert.equal(state.navigationLocked, true);
    assert.equal(state.passkeyBlocked, true);
  }
  const authenticated = browserControls({ ...signedOut, status: "ready", authenticated: true }, null, "darwin", "automatic");
  assert.equal(authenticated.navigationLocked, false);
  assert.equal(authenticated.passkeyAvailable, false);
  assert.equal(authenticated.passkeyBlocked, true);
});
