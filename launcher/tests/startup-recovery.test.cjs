const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { recoverStartupFailure, startupFailureDetails } = require("../electron/startup-recovery.cjs");

function fixture(overrides = {}) {
  const calls = [];
  const app = Object.assign(new EventEmitter(), {
    isReady: () => true,
    whenReady: async () => { calls.push("ready"); },
    relaunch: options => calls.push(["relaunch", options]),
    exit: code => calls.push(["exit", code]),
  });
  const dialog = {
    showMessageBox: async options => { calls.push(["dialog", options]); return { response: 0 }; },
    showErrorBox: (...args) => { calls.push(["error", ...args]); },
  };
  return { calls, app, dialog, options: {
    app, dialog, error: new Error("Embedded browser initialization timeout"), phase: "browser",
    cleanup: async () => { calls.push("cleanup"); }, recordFailure: details => calls.push(["record", details]),
    timeoutMs: 10, ...overrides,
  } };
}

test("startup failure identifies the stage without disclosing exception paths or credentials", () => {
  assert.deepEqual(startupFailureDetails(new Error("failed https://example.test/?secret=credential /Users/private"), "browser"), {
    phase: "browser", reason: "initialization-failed",
  });
  assert.deepEqual(startupFailureDetails(new Error("ERR_ABORTED secret"), "evil-stage"), {
    phase: "electron-ready", reason: "browser-load-failed",
  });
});

test("bootstrap failure gets a native Quit/Restart recovery independent of a hidden renderer", async () => {
  const f = fixture();
  f.options.cleanup = async () => {
    assert.equal(f.app.listenerCount("window-all-closed"), 1);
    f.app.emit("window-all-closed");
    f.calls.push("cleanup");
  };
  const result = await recoverStartupFailure(f.options);
  assert.equal(result.action, "quit");
  assert.equal(result.cleaned, true);
  const prompt = f.calls.find(call => Array.isArray(call) && call[0] === "dialog")[1];
  assert.deepEqual(prompt.buttons, ["Quit", "Restart"]);
  assert.equal(prompt.defaultId, 0);
  assert.equal(prompt.cancelId, 0);
  assert.match(prompt.message, /embedded browser/);
  assert.match(prompt.detail, /readiness deadline/);
  assert.deepEqual(f.calls.at(-1), ["exit", 1]);
  assert.equal(f.app.listenerCount("window-all-closed"), 0);
});

test("explicit recovery restarts a new visible process and then releases the old process", async () => {
  const f = fixture({ args: ["launcher.cjs", "--hidden", "--profile=development"] });
  f.dialog.showMessageBox = async () => ({ response: 1 });
  const result = await recoverStartupFailure(f.options);
  assert.equal(result.action, "restart");
  assert.deepEqual(f.calls.slice(-2), [["relaunch", { args: ["launcher.cjs", "--profile=development"] }], ["exit", 0]]);
});

test("cleanup rejection or a hung control socket cannot trap recovery behind the single-instance lock", async () => {
  for (const cleanup of [() => { throw new Error("cleanup failed"); }, () => new Promise(() => {})]) {
    const f = fixture({ cleanup });
    const result = await recoverStartupFailure(f.options);
    assert.equal(result.cleaned, false);
    assert.ok(f.calls.some(call => Array.isArray(call) && call[0] === "dialog"));
    assert.deepEqual(f.calls.at(-1), ["exit", 1]);
  }
});

test("failure before readiness has bounded readiness recovery and always exits if unavailable", async () => {
  const f = fixture();
  f.app.isReady = () => false;
  f.app.whenReady = () => new Promise(() => {});
  const result = await recoverStartupFailure(f.options);
  assert.equal(result.action, "quit");
  assert.ok(f.calls.some(call => Array.isArray(call) && call[0] === "error"));
  assert.deepEqual(f.calls.at(-1), ["exit", 1]);
});

test("a completed readiness transition can offer restart after an earlier runtime-file failure", async () => {
  const f = fixture({ phase: "runtime-files" });
  f.app.isReady = () => false;
  await recoverStartupFailure(f.options);
  assert.ok(f.calls.includes("ready"));
  assert.match(f.calls.find(call => Array.isArray(call) && call[0] === "dialog")[1].message, /packaged runtime/);
  assert.deepEqual(f.calls.at(-1), ["exit", 1]);
});

test("dialog, failure-recording and relaunch errors never leave a hidden instance running", async () => {
  for (const failure of ["dialog", "record", "relaunch"]) {
    const f = fixture();
    if (failure === "dialog") f.dialog.showMessageBox = async () => { throw new Error("UI unavailable"); };
    if (failure === "record") f.options.recordFailure = () => { throw new Error("disk unavailable"); };
    if (failure === "relaunch") {
      f.dialog.showMessageBox = async () => ({ response: 1 });
      f.app.relaunch = () => { throw new Error("relaunch unavailable"); };
    }
    assert.equal((await recoverStartupFailure(f.options)).action, "quit");
    assert.deepEqual(f.calls.at(-1), ["exit", 1]);
  }
});

test("automated package smoke failures exit without waiting for an operator dialog", async () => {
  const f = fixture({ interactive: false });
  assert.equal((await recoverStartupFailure(f.options)).action, "quit");
  assert.equal(f.calls.some(call => Array.isArray(call) && ["dialog", "error", "relaunch"].includes(call[0])), false);
  assert.deepEqual(f.calls.at(-1), ["exit", 1]);
});
