const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { BrowserHost } = require("../electron/browser-host.cjs");
const { RuntimeHost } = require("../electron/runtime.cjs");
const { openExistingChromeLogin, cancelExistingChromeLogin, initialExistingChromeProgress, publicExistingChromeProgress, parseExistingChromeProgress, waitForPreviousAuthentication } = require("../electron/existing-chrome-login.cjs");
const { isExistingChromeErrorCode, parseExistingChromeError, existingChromeError } = require("../electron/existing-chrome-errors.cjs");
const { captureExistingChromeLogin, cancelExistingChromeLogin: cancelRuntime } = require("../electron/existing-chrome-runtime.cjs");
const { confirmExistingChromeImport, CHROME_SETTINGS_ADDRESS } = require("../electron/existing-chrome-consent.cjs");
const flush = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
  const events = [];
  const host = {
    state: { authenticated: false, status: "signed-out", loading: false, message: "previous session" },
    authGeneration: 4, loginOperation: null, embeddedLoginController: null,
    snapshot() { return { ...this.state, loginInProgress: Boolean(this.loginOperation), loginKind: this.existingChromeLoginOperation ? "existing-chrome" : this.embeddedLoginController ? "embedded" : null, existingChromeLogin: publicExistingChromeProgress(this.existingChromeProgress) }; },
    setState(patch) { this.state = { ...this.state, ...patch }; },
    publishState() {}, activateHomeSurface() {}, show() {},
    withManualOperation: async (_label, action) => action(),
    loginWithExistingChrome: async () => { events.push("capture"); return { storageState: {}, cleanup: async () => events.push("cleanup") }; },
    installPasskeyLogin: async transfer => { events.push("verify"); await transfer.cleanup(); host.setState({ authenticated: true, status: "ready", loading: false }); return host.snapshot(); },
  };
  return { host, events };
}

test("no helper starts before explicit local consent; concurrent starts share one owner", async () => {
  const { host, events } = fixture();
  let allow;
  const consent = new Promise(resolve => { allow = resolve; });
  const pending = openExistingChromeLogin(host, () => consent);
  assert.equal(host.authGeneration, 4);
  assert.equal(host.snapshot().existingChromeLogin.phase, "consent");
  assert.deepEqual(events, []);
  assert.equal(openExistingChromeLogin(host, () => { throw new Error("duplicate consent"); }), pending);
  allow(true);
  const result = await pending;
  assert.equal(result.authenticated, true);
  assert.equal(result.loginInProgress, false);
  assert.equal(result.loginKind, null);
  assert.equal(result.existingChromeLogin.active, false);
  assert.deepEqual(events, ["capture", "verify", "cleanup"]);
  assert.equal(host.authGeneration, 5);
  assert.equal(host.loginOperation, null);
  assert.equal(host.snapshot().existingChromeLogin.phase, "completed");
});

test("declined consent preserves the previous session and an in-flight embedded owner", async () => {
  const { host, events } = fixture();
  const previous = { ...host.state };
  const embedded = new Promise(() => {});
  const embeddedController = new AbortController();
  host.embeddedLoginController = embeddedController;
  host.loginOperation = embedded;
  await openExistingChromeLogin(host, async () => false);
  assert.deepEqual(host.state, previous);
  assert.deepEqual(events, []);
  assert.equal(host.authGeneration, 4);
  assert.equal(embeddedController.signal.aborted, false);
  assert.equal(host.loginOperation, embedded);
});

test("declined consent resolves a final cancelled snapshot with navigation ownership released", async () => {
  const { host } = fixture();
  const result = await openExistingChromeLogin(host, async () => false);
  assert.equal(result.existingChromeLogin.phase, "cancelled");
  assert.equal(result.existingChromeLogin.active, false);
  assert.equal(result.loginInProgress, false);
  assert.equal(result.loginKind, null);
});

test("capture failure preserves old browser state, redacts raw errors, and permits retry", async () => {
  const { host, events } = fixture();
  const previous = { ...host.state };
  const capture = host.loginWithExistingChrome;
  host.loginWithExistingChrome = async () => { throw new Error("SECRET https://sensitive.test/cookie"); };
  await assert.rejects(openExistingChromeLogin(host, async () => true), /Existing Chrome sign-in could not be imported/);
  assert.deepEqual(host.state, previous);
  assert.doesNotMatch(JSON.stringify(host.snapshot()), /SECRET|sensitive/);
  assert.equal(host.loginOperation, null);
  assert.deepEqual(events, []);
  host.loginWithExistingChrome = capture;
  assert.equal((await openExistingChromeLogin(host, async () => true)).authenticated, true);
});

test("an import failure is sanitized before withManualOperation can publish any snapshot", async () => {
  const { host } = fixture();
  const snapshots = [];
  host.publishState = state => snapshots.push(state);
  host.setState = patch => { host.state = { ...host.state, ...patch }; host.publishState(host.snapshot()); };
  host.withManualOperation = BrowserHost.prototype.withManualOperation.bind(host);
  host.ready = async () => {};
  host.logger = { info() {}, error() {} };
  let called = false;
  host.installPasskeyLogin = async () => { called = true; throw new Error("SECRET cookie https://sensitive.test"); };
  await assert.rejects(openExistingChromeLogin(host, async () => true), { code: "session-verification-failed" });
  assert.equal(called, true);
  assert.equal(host.snapshot().existingChromeLogin.error, "session-verification-failed");
  assert.equal(host.snapshot().existingChromeLogin.canCopySettings, false);
  assert.doesNotMatch(JSON.stringify(snapshots), /SECRET|sensitive/);
  assert.doesNotMatch(host.state.message, /SECRET|sensitive/);
});

test("installer rollback evidence survives the real manual-operation boundary", async () => {
  for (const scenario of ["authenticated", "unavailable", "cancelled", "cleanup-failed", "no-receipt"]) {
    const { host } = fixture();
    const snapshots = [];
    host.withManualOperation = BrowserHost.prototype.withManualOperation.bind(host);
    host.ready = async () => {};
    host.logger = { info() {}, error() {} };
    host.publishState = state => snapshots.push(state);
    host.setState = patch => { host.state = { ...host.state, ...patch }; host.publishState(host.snapshot()); };
    const restored = { authenticated: scenario !== "unavailable", authenticationStatus: scenario === "unavailable" ? "unavailable" : "authenticated",
      status: scenario === "unavailable" ? "error" : "ready", loading: false,
      message: scenario === "unavailable" ? "Previous session restored; verification unavailable" : "Previous session verified",
      authenticationCheckedAt: "fresh-rollback-probe" };
    host.installPasskeyLogin = async transfer => {
      await transfer.cleanup();
      host.setState(restored);
      if (scenario === "cancelled") host.existingChromeLoginController.abort();
      throw Object.assign(new Error("SECRET raw cookie https://sensitive.test"), {
        ...(scenario !== "no-receipt" ? { previousSessionRestored: true } : {}),
        ...(scenario === "cleanup-failed" ? { code: "existing_chrome_cleanup_failed" } : {}),
      });
    };
    const operation = openExistingChromeLogin(host, async () => true);
    if (scenario === "cancelled") await operation;
    else await assert.rejects(operation, error => {
      assert.equal(error.previousSessionRestored, scenario === "no-receipt" ? undefined : true);
      assert.equal(error.cause, undefined);
      assert.doesNotMatch(error.message, /SECRET|sensitive/);
      return true;
    });
    if (["cleanup-failed", "no-receipt"].includes(scenario)) {
      assert.equal(host.state.status, "error");
      assert.notEqual(host.state.message, restored.message);
    } else assert.deepEqual(host.state, restored);
    assert.equal(host.snapshot().existingChromeLogin.phase, scenario === "cancelled" ? "cancelled" : "failed");
    assert.equal(host.snapshot().existingChromeLogin.error, scenario === "cancelled" ? null
      : scenario === "cleanup-failed" ? "existing-chrome-cleanup-failed" : "session-verification-failed");
    assert.equal(host.loginOperation, null);
    assert.equal(host.manualOperation, null);
    assert.equal(host.existingChromeLoginController, null);
    assert.doesNotMatch(JSON.stringify(snapshots), /SECRET|sensitive/);
  }
});

test("capture cannot forge the local installer's rollback receipt", async () => {
  const { host } = fixture();
  const original = { ...host.state };
  host.loginWithExistingChrome = async () => {
    throw Object.assign(new Error("SECRET"), { previousSessionRestored: true });
  };
  await assert.rejects(openExistingChromeLogin(host, async () => true), error => {
    assert.equal(error.previousSessionRestored, undefined);
    return true;
  });
  assert.deepEqual(host.state, original);
});

test("authentication completed during consent or refresh is preserved without capture", async () => {
  for (const where of ["consent", "refresh"]) {
    const { host, events } = fixture();
    let complete;
    const waiting = new Promise(resolve => { complete = () => { host.setState({ authenticated: true, status: "ready", loading: false }); resolve(true); }; });
    if (where === "refresh") host.sessionRefreshOperation = waiting;
    const operation = openExistingChromeLogin(host, where === "consent" ? () => waiting : async () => true);
    await flush();
    complete();
    const result = await operation;
    assert.equal(result.authenticated, true);
    assert.deepEqual(events, []);
    assert.equal(host.authGeneration, 4);
    assert.equal(host.existingChromeProgress, null);
  }
});

test("a stale embedded navigation error cannot defeat an existing Chrome import", async () => {
  const { host } = fixture(), install = host.installPasskeyLogin;
  host.authNavigationError = new Error("stale login navigation");
  host.installPasskeyLogin = async (...args) => { assert.equal(host.authNavigationError, null); return install(...args); };
  assert.equal((await openExistingChromeLogin(host, async () => true)).authenticated, true);
});

test("cancellation does not conceal a failed private transfer cleanup", async () => {
  const { host } = fixture();
  let captured;
  host.loginWithExistingChrome = () => new Promise(resolve => { captured = resolve; });
  const operation = openExistingChromeLogin(host, async () => true);
  const rejected = assert.rejects(operation, /cleanup failed/);
  await flush();
  await assert.rejects(cancelExistingChromeLogin(host, async () => captured({ storageState: {}, cleanup: async () => { throw new Error("SECRET removal"); } })), /cleanup failed/);
  await rejected;
  assert.equal(host.snapshot().existingChromeLogin.phase, "failed");
  assert.equal(host.snapshot().existingChromeLogin.error, "existing-chrome-cleanup-failed");
  assert.doesNotMatch(JSON.stringify(host.snapshot()), /SECRET/);
});

test("cancel during capture disconnects only its helper and cleans a late transfer without importing", async () => {
  const { host, events } = fixture();
  const previous = { ...host.state };
  let captured;
  host.loginWithExistingChrome = () => new Promise(resolve => { captured = resolve; });
  const operation = openExistingChromeLogin(host, async () => true);
  await flush();
  const cancel = cancelExistingChromeLogin(host, async () => {
    events.push("cancel-helper");
    captured({ storageState: {}, cleanup: async () => events.push("cleanup") });
  });
  await Promise.all([operation, cancel]);
  assert.deepEqual(events, ["cancel-helper", "cleanup"]);
  assert.deepEqual(host.state, previous);
  assert.equal(host.snapshot().existingChromeLogin.phase, "cancelled");
});

test("existing passkey/turn ownership and Manual policy prevent starting a different import", () => {
  const { host, events } = fixture();
  host.loginOperation = Promise.resolve({});
  assert.throws(() => openExistingChromeLogin(host, async () => true), /Another ChatGPT sign-in/);
  host.loginOperation = null;
  host.getBrowserInteractionMode = () => "manual";
  assert.throws(() => BrowserHost.prototype.openExistingChromeLogin.call(host, async () => true), /disabled in Manual mode/);
  assert.deepEqual(events, []);
});

test("a mode change during native consent is rechecked before capturing Chrome", async () => {
  const { host, events } = fixture();
  let mode = "automatic", approve;
  host.getBrowserInteractionMode = () => mode;
  const operation = BrowserHost.prototype.openExistingChromeLogin.call(host, () => new Promise(resolve => { approve = resolve; }));
  mode = "manual";
  approve(true);
  await assert.rejects(operation, /could not be imported/);
  assert.deepEqual(events, []);
});

test("public progress accepts only known phases and does not expose arbitrary helper fields", () => {
  const progress = initialExistingChromeProgress(1_000_000);
  const deadlineAt = progress.deadlineAt;
  assert.equal(publicExistingChromeProgress(progress).canCancel, false);
  for (const phase of ["discovering", "waiting-for-chrome", "reading-session"]) {
    assert.deepEqual(parseExistingChromeProgress(`@codex-chrome-import:${JSON.stringify({ version: 1, phase, deadlineAt, cookies: "SECRET" })}`), { phase, deadlineAt });
  }
  assert.equal(parseExistingChromeProgress('@codex-chrome-import:{"version":1,"phase":"completed"}'), null);
  assert.equal(parseExistingChromeProgress('@codex-chrome-import:{"version":1,"phase":"waiting-for-chrome","deadlineAt":"bad"}'), null);
  const publicState = publicExistingChromeProgress({ ...progress, phase: "waiting-for-chrome", cookies: "SECRET" });
  assert.equal(publicState.canCancel, true);
  assert.equal(publicState.canCopySettings, true);
  assert.doesNotMatch(JSON.stringify(publicState), /SECRET/);
});

test("native consent is cancel by default and explains the broad Chrome permission in every language", async () => {
  assert.equal(CHROME_SETTINGS_ADDRESS, "chrome://inspect/#remote-debugging");
  for (const language of ["en", "zh-CN", "ja"]) {
    let options;
    const dialog = { showMessageBox: async (_window, value) => { options = value; return { response: 0 }; } };
    assert.equal(await confirmExistingChromeImport(dialog, {}, language), false);
    assert.equal(options.defaultId, 0);
    assert.equal(options.cancelId, 0);
    assert.ok(options.detail.includes(CHROME_SETTINGS_ADDRESS));
    assert.ok(options.detail.includes("ChatGPT/OpenAI"));
    assert.equal(await confirmExistingChromeImport({ showMessageBox: async () => ({ response: 1 }) }, {}, language), true);
  }
});

function runtimeFixture(platform, root) {
  const host = {
    platform, app: { getPath: () => root }, currentOperation: () => null,
    launcherControlEnvironment: () => ({ CODEX_WEB_GPT_LAUNCHER_CONTROL_TOKEN: "fixture-only" }),
    run: async (_name, args, options) => {
      const storage = args[args.indexOf("--storage-state") + 1];
      fs.writeFileSync(storage, JSON.stringify({ cookies: [], origins: [] }));
      fs.writeFileSync(`${storage}.verified.json`, JSON.stringify({ version: 1, source: "existing-chrome-profile", captureComplete: true, capturedAt: new Date().toISOString() }));
      host.invocation = { args, options };
    },
  };
  return host;
}

test("all supported platforms capture a scoped private transfer with a distinct marker and no Chrome launch arguments", async () => {
  for (const platform of ["darwin", "win32", "linux"]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "existing-chrome-runtime-"));
    try {
      const host = runtimeFixture(platform, root);
      const transfer = await captureExistingChromeLogin(host);
      assert.deepEqual(transfer.storageState, { cookies: [], origins: [] });
      assert.ok(host.invocation.args.includes("--existing-chrome"));
      assert.ok(host.invocation.args.includes("--consent-user-profile"));
      assert.ok(!host.invocation.args.includes("--chrome"));
      assert.ok(!host.invocation.args.some(value => /user-data-dir|new-window|remote-debugging-port/.test(value)));
      assert.equal(host.invocation.options.privateOutput, true);
      assert.equal(host.invocation.options.onStdoutLine("SECRET"), true);
      await transfer.cleanup();
      assert.deepEqual(fs.readdirSync(path.join(root, "existing-chrome-login")), []);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});

test("capture rejects an isolated-profile marker and removes all temporary state", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "existing-chrome-runtime-"));
  try {
    const host = runtimeFixture("darwin", root), run = host.run;
    host.run = async (...args) => {
      await run(...args);
      const storage = args[1][args[1].indexOf("--storage-state") + 1];
      fs.writeFileSync(`${storage}.verified.json`, JSON.stringify({ version: 1, source: "isolated-normal-browser-profile", captureComplete: true, capturedAt: new Date().toISOString() }));
    };
    await assert.rejects(captureExistingChromeLogin(host), /could not be imported/);
    assert.deepEqual(fs.readdirSync(path.join(root, "existing-chrome-login")), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("broken control cancels the exact importer process only and refuses unrelated operations", async () => {
  const killed = [];
  const child = { exitCode: null, signalCode: null, stdin: { writable: false }, kill: signal => killed.push(signal) };
  const host = { active: "existing-chrome-login", activeChild: child };
  assert.equal(await cancelRuntime(host), true);
  assert.deepEqual(killed, ["SIGTERM"]);
  host.active = "passkey-login";
  await assert.rejects(cancelRuntime(host), /No existing Chrome/);
  assert.deepEqual(killed, ["SIGTERM"]);
  assert.throws(() => RuntimeHost.prototype.captureExistingChromeLogin.call({ getBrowserInteractionMode: () => "manual" }), /Manual mode/);
});

test("private runtime output is excluded from logs, operation events, returned captures, and thrown errors", async () => {
  const published = [], logged = [];
  const host = {
    active: null, activeChild: null, browserDescriptorPath: "/unused-fixture-descriptor",
    command: () => ({ executable: process.execPath, args: ["-e", "process.stdout.write('SECRET stdout'); process.stderr.write('SECRET stderr'); process.exitCode = 1"], cwd: os.tmpdir() }),
    logger: { info: (...args) => logged.push(args), warn: (...args) => logged.push(args), error: (...args) => logged.push(args) },
    publishOperation: value => published.push(value),
  };
  await assert.rejects(RuntimeHost.prototype.run.call(host, "existing-chrome-login", [], { privateOutput: true, timeoutMs: 5000 }), error => {
    assert.doesNotMatch(error.message, /SECRET/);
    return true;
  });
  assert.doesNotMatch(JSON.stringify({ logged, published }), /SECRET/);
});

test("retry cleans only abandoned owned transfer directories after checking runtime ownership", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "existing-chrome-runtime-"));
  try {
    const parent = path.join(root, "existing-chrome-login"), stale = path.join(parent, "transfer-ABC123"), keep = path.join(parent, "keep-user-data");
    fs.mkdirSync(stale, { recursive: true }); fs.mkdirSync(keep);
    fs.writeFileSync(path.join(stale, "storage-state.json"), "private");
    const host = runtimeFixture("darwin", root);
    host.currentOperation = () => "existing-chrome-login";
    await assert.rejects(captureExistingChromeLogin(host), /Another launcher operation/);
    assert.equal(fs.existsSync(stale), true);
    host.currentOperation = () => null;
    const transfer = await captureExistingChromeLogin(host);
    assert.equal(fs.existsSync(stale), false);
    assert.equal(fs.existsSync(keep), true);
    await transfer.cleanup();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("typed helper errors preserve only allowlisted codes, never raw diagnostics", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "existing-chrome-safe-error-"));
  try {
    for (const code of ["chrome-profile-access-denied", "chrome-profile-claim-missing", "chrome-permission-denied", "chrome-permission-timeout", "launcher-authorization-failed"]) {
      const host = runtimeFixture("darwin", root), logs = [];
      host.logger = { warn: (...args) => logs.push(args) };
      host.run = async (_name, _args, options) => {
        options.onStdoutLine(`@codex-chrome-import-error:${JSON.stringify({ version: 1, code })}`);
        options.onStdoutLine('@codex-chrome-import-error:{"version":1,"code":"SECRET"}');
        throw new Error("SECRET raw endpoint or cookie");
      };
      await assert.rejects(captureExistingChromeLogin(host), error => {
        assert.equal(error.code, code);
        assert.doesNotMatch(error.message, /SECRET/);
        return true;
      });
      assert.deepEqual(logs, [["runtime.existing_chrome_import_failed", { code }]]);
      assert.deepEqual(fs.readdirSync(path.join(root, "existing-chrome-login")), []);
    }
    for (const invalid of [
      '{"version":1,"code":"__proto__"}', '{"version":1,"code":"constructor"}',
      '{"version":1,"code":"chrome-unavailable","message":"SECRET"}',
      '{"version":1,"code":"chrome-unavailable","endpoint":"SECRET"}',
      '{"version":2,"code":"chrome-unavailable"}', '{"version":1,"code":null}', '[]',
    ]) assert.equal(parseExistingChromeError(`@codex-chrome-import-error:${invalid}`), null);
    assert.equal(isExistingChromeErrorCode("toString"), false);
    assert.equal(existingChromeError("SECRET").code, "import-failed");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("specific failure progress and progress logs contain safe codes only", async () => {
  const { host } = fixture(), logs = [];
  host.logger = { info: (...args) => logs.push(args) };
  host.loginWithExistingChrome = async () => { const error = new Error("SECRET"); error.code = "chrome-profile-access-denied"; throw error; };
  await assert.rejects(openExistingChromeLogin(host, async () => true), error => error.code === "chrome-profile-access-denied");
  assert.equal(host.snapshot().existingChromeLogin.error, "chrome-profile-access-denied");
  assert.equal(host.snapshot().existingChromeLogin.phase, "failed");
  assert.deepEqual(logs.filter(([event]) => event === "browser.existing_chrome_progress").map(([, fields]) => fields.phase), ["consent", "preparing", "discovering", "failed"]);
  assert.deepEqual(logs.at(-1), ["browser.existing_chrome_operation_settled", { phase: "failed", previousLoginPending: false }]);
  assert.doesNotMatch(JSON.stringify({ state: host.snapshot(), logs }), /SECRET/);
});

test("previous authentication waits have an external deadline and consume late rejection", async () => {
  const controller = new AbortController(); let rejectOld;
  const never = new Promise((_resolve, reject) => { rejectOld = reject; });
  await assert.rejects(waitForPreviousAuthentication(never, controller.signal, 5), error => error.code === "existing_chrome_handoff_timeout");
  rejectOld(new Error("late previous login failure"));
  await flush();
  assert.equal(await waitForPreviousAuthentication(Promise.resolve("done"), controller.signal, 50), "done");
});

test("post-consent preparing can cancel promptly without starting Chrome or discarding prior ownership", async () => {
  for (const previous of ["embedded", "refresh"]) {
    const { host, events } = fixture();
    const originalState = { ...host.state };
    const pending = new Promise(() => {});
    if (previous === "embedded") {
      host.embeddedLoginController = new AbortController();
      host.loginOperation = pending;
    } else host.sessionRefreshOperation = pending;
    const operation = openExistingChromeLogin(host, async () => true);
    await flush();
    assert.equal(host.snapshot().existingChromeLogin.phase, "preparing");
    assert.equal(host.snapshot().existingChromeLogin.canCancel, true);
    const result = await cancelExistingChromeLogin(host, async () => { throw new Error("Importer must not be started"); });
    await operation;
    assert.deepEqual(events, []);
    assert.equal(result.existingChromeLogin.phase, "cancelled");
    assert.equal(result.existingChromeLogin.active, false);
    assert.deepEqual(host.state, originalState);
    assert.equal(previous === "embedded" ? host.loginOperation : host.sessionRefreshOperation, pending);
  }
});

test("file recovery is offered only for a macOS access denial and remains a guarded native action", async () => {
  const base = { ...initialExistingChromeProgress(), phase: "failed", error: "chrome-profile-access-denied" };
  assert.equal(publicExistingChromeProgress(base, "darwin").canAllowFileAccess, true);
  for (const platform of ["win32", "linux"]) assert.equal(publicExistingChromeProgress(base, platform).canAllowFileAccess, false);
  for (const patch of [{ phase: "consent" }, { phase: "cancelled" }, { error: "chrome-unavailable" }]) {
    assert.equal(publicExistingChromeProgress({ ...base, ...patch }, "darwin").canAllowFileAccess, false);
  }
  const { host, events } = fixture();
  host.getBrowserInteractionMode = () => "automatic";
  host.existingChromeProgress = { ...base, error: "chrome-unavailable" };
  assert.throws(() => BrowserHost.prototype.allowExistingChromeFileAccess.call(host, async () => "must not read"), /only after/);
  host.getBrowserInteractionMode = () => "manual";
  assert.throws(() => BrowserHost.prototype.allowExistingChromeFileAccess.call(host, async () => "must not read"), /Manual mode/);
  assert.deepEqual(events, []);
});

test("selected connection contents stay out of progress and travel only in the private runtime control pipe", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "existing-chrome-selected-"));
  const contents = "9222\n/devtools/browser/11111111-2222-3333-4444-555555555555\n";
  try {
    const host = runtimeFixture("darwin", root);
    const transfer = await captureExistingChromeLogin(host, undefined, { selectedDiscoveryContents: contents });
    assert.ok(host.invocation.args.includes("--selected-chrome-discovery"));
    assert.deepEqual(JSON.parse(host.invocation.options.privateControlMessage), { version: 1, type: "existing-chrome-discovery", contents });
    assert.doesNotMatch(JSON.stringify({ args: host.invocation.args, env: host.invocation.options.env }), /devtools|11111111/);
    await transfer.cleanup();
    await assert.rejects(captureExistingChromeLogin(host, undefined, { selectedDiscoveryContents: undefined }));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("selected profile claim travels only through the private runtime control pipe", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "existing-chrome-profile-claim-"));
  const nonce = "P".repeat(32);
  const profileClaim = { version: 1, nonce, url: `http://127.0.0.1:43210/nekodex-profile-claim-v1/${nonce}`,
    openedAt: new Date().toISOString() };
  try {
    const host = runtimeFixture("darwin", root);
    const transfer = await captureExistingChromeLogin(host, undefined, { profileClaim });
    assert.ok(host.invocation.args.includes("--selected-chrome-profile-claim"));
    assert.deepEqual(JSON.parse(host.invocation.options.privateControlMessage),
      { version: 1, type: "existing-chrome-profile-claim", claim: profileClaim });
    assert.doesNotMatch(JSON.stringify({ args: host.invocation.args, env: host.invocation.options.env }), new RegExp(nonce));
    await transfer.cleanup();
    await assert.rejects(captureExistingChromeLogin(host, undefined, { profileClaim: { ...profileClaim, url: "about:blank#wrong" } }),
      /claim is invalid/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("file selection cancellation never starts a helper and clears the import owner", async () => {
  const { host, events } = fixture();
  const result = await openExistingChromeLogin(host, async () => true, { selectConnectionFile: async () => null });
  assert.deepEqual(events, []);
  assert.equal(result.existingChromeLogin.phase, "cancelled");
  assert.equal(result.loginInProgress, false);
});

test("cancelled file recovery does not pass a late selection to the helper", async () => {
  const { host, events } = fixture(); let select;
  const operation = openExistingChromeLogin(host, async () => true, { selectConnectionFile: () => new Promise(resolve => { select = resolve; }) });
  await flush();
  assert.equal(host.snapshot().existingChromeLogin.phase, "file-access");
  const cancelled = cancelExistingChromeLogin(host, async () => { throw new Error("No helper should exist"); });
  select("late connection file contents");
  await Promise.all([operation, cancelled]);
  assert.deepEqual(events, []);
  assert.equal(host.snapshot().existingChromeLogin.phase, "cancelled");
});

test("private control delivery is successful without logging the message or falsely recording a pipe error", async () => {
  const logged = [];
  const host = { active: null, activeChild: null, browserDescriptorPath: "/fixture",
    command: () => ({ executable: process.execPath, args: ["-e", "process.stdin.once('data', data => { const message=JSON.parse(data); if(message.type !== 'existing-chrome-discovery') process.exitCode=1; process.stdout.write('private-control-received'); process.stdin.destroy(); });"], cwd: os.tmpdir() }),
    logger: { info: (...args) => logged.push(args), warn: (...args) => logged.push(args), error: (...args) => logged.push(args) },
  };
  const message = JSON.stringify({ version: 1, type: "existing-chrome-discovery", contents: "SECRET-private-discovery" }) + "\n";
  const result = await RuntimeHost.prototype.run.call(host, "existing-chrome-login", [], { controlStdin: true, privateOutput: true, privateControlMessage: message, timeoutMs: 3000 });
  assert.equal(result.code, 0);
  assert.equal(result.stdout, "");
  assert.doesNotMatch(JSON.stringify(logged), /SECRET|private-control-received/);
  await assert.rejects(RuntimeHost.prototype.run.call(host, "bad-private", [], { controlStdin: true, privateControlMessage: message }), /Private runtime control/);
});
