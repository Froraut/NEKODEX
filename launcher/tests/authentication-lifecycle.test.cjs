const test = require("node:test");
const assert = require("node:assert/strict");
const { BrowserHost, authViewOptions } = require("../electron/browser-host.cjs");

test("auth popup without supplied WebContents uses a sandboxed owned partition", () => {
  const options = authViewOptions({
    webContents: undefined,
    webPreferences: { nodeIntegration: true, sandbox: false, preload: "/untrusted.cjs", partition: "other" },
  }, "persist:codex-web-gpt-dev-chatgpt");
  assert.equal(Object.hasOwn(options, "webContents"), false);
  assert.deepEqual(options.webPreferences, {
    partition: "persist:codex-web-gpt-dev-chatgpt",
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    backgroundThrottling: false,
  });
});

test("auth popup adopts an existing Electron guest without replacing its contents", () => {
  const guest = { id: 17 };
  assert.deepEqual(authViewOptions({ webContents: guest }, "owned"), { webContents: guest });
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function loginFixture() {
  const calls = [];
  const loginWaiting = deferred();
  const transferWaiting = deferred();
  const transfer = deferred();
  const fixture = Object.assign(Object.create(BrowserHost.prototype), {
    state: { authenticated: false, status: "signed-out" },
    loginOperation: null,
    embeddedLoginController: null,
    passkeyLoginOperation: null,
    manualOperation: null,
    authView: null,
    turnTabs: new Map(),
    getBrowserInteractionMode: () => "automatic",
    ready: async () => {},
    activateHomeSurface() {},
    show() {},
    logger: { info() {} },
    snapshot() { return { ...this.state }; },
    setState(patch) { Object.assign(this.state, patch); },
    view: { webContents: {
      getURL: () => "https://chatgpt.com/?temporary-chat=true",
      isDestroyed: () => false,
      setBackgroundThrottling: value => calls.push(["throttle", value]),
      stop: () => calls.push("stop"),
    } },
    probeAuthentication: async () => {},
    waitForAuthenticated: async (_timeout, signal) => {
      calls.push("embedded-wait");
      loginWaiting.resolve();
      await new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    },
    runSessionInspection: async () => calls.push("inspect-embedded"),
    closeAuthView: () => calls.push("close-auth"),
    loginWithPasskey: async () => {
      assert.equal(fixture.manualOperation, "ChatGPT passkey login");
      calls.push("chrome");
      transferWaiting.resolve();
      return await transfer.promise;
    },
    installPasskeyLogin: async value => {
      assert.equal(value, "verified-transfer");
      calls.push("import");
      fixture.state.authenticated = true;
      return fixture.snapshot();
    },
  });
  return { fixture, calls, loginWaiting, transferWaiting, transfer };
}

test("Use passkey switches a pending embedded login immediately and serializes browser ownership", async () => {
  const { fixture, calls, loginWaiting, transferWaiting, transfer } = loginFixture();
  const embedded = fixture.openLogin();
  await loginWaiting.promise;
  const passkey = fixture.openPasskeyLogin();
  assert.notEqual(passkey, embedded);
  assert.equal(fixture.openPasskeyLogin(), passkey);
  assert.equal(fixture.openLogin(), passkey);
  await transferWaiting.promise;
  assert.equal(fixture.embeddedLoginController, null);
  assert.equal(calls.filter(value => value === "chrome").length, 1);
  assert.equal(calls.includes("inspect-embedded"), false);
  assert.equal(fixture.state.status, "loading");
  assert.ok(calls.indexOf("stop") < calls.indexOf("chrome"));
  assert.ok(calls.indexOf("close-auth") < calls.indexOf("chrome"));
  transfer.resolve("verified-transfer");
  assert.equal((await passkey).authenticated, true);
  assert.equal(fixture.loginOperation, null);
  assert.equal(fixture.passkeyLoginOperation, null);
  assert.equal(fixture.manualOperation, null);
});

test("passkey switch waits for a pending authentication probe to finish before importing", async () => {
  const { fixture, calls, transferWaiting, transfer } = loginFixture();
  const probing = deferred();
  const probe = deferred();
  fixture.probeAuthentication = async () => { probing.resolve(); await probe.promise; };
  const embedded = fixture.openLogin();
  await probing.promise;
  const passkey = fixture.openPasskeyLogin();
  await Promise.resolve();
  assert.equal(calls.includes("chrome"), false);
  probe.resolve();
  await embedded;
  await transferWaiting.promise;
  transfer.resolve("verified-transfer");
  await passkey;
  assert.equal(calls.includes("embedded-wait"), false);
  assert.equal(calls.includes("inspect-embedded"), false);
});

test("failed passkey launch releases ownership and allows a new attempt", async () => {
  const { fixture } = loginFixture();
  fixture.loginWithPasskey = async () => { throw new Error("Chrome unavailable"); };
  await assert.rejects(fixture.openPasskeyLogin(), /Chrome unavailable/);
  assert.equal(fixture.loginOperation, null);
  assert.equal(fixture.passkeyLoginOperation, null);
  assert.equal(fixture.manualOperation, null);
  fixture.loginWithPasskey = async () => "verified-transfer";
  assert.equal((await fixture.openPasskeyLogin()).authenticated, true);
});

test("authentication cancellation stops polling promptly and never accepts a stale success", async () => {
  const controller = new AbortController();
  let probes = 0;
  const fixture = {
    authNavigationError: null,
    probeAuthentication: async () => {
      probes += 1;
      controller.abort();
      return { authenticated: true };
    },
  };
  await assert.rejects(BrowserHost.prototype.waitForAuthenticated.call(fixture, 180_000, controller.signal), {
    name: "AbortError",
  });
  assert.equal(probes, 1);
});

test("navigation is locked even while login is waiting to acquire the browser", () => {
  assert.throws(() => BrowserHost.prototype.navigate.call({
    loginOperation: Promise.resolve(),
    manualOperation: null,
    activeTraceId: null,
  }, "reload"), /locked during ChatGPT login/);
});

test("a page-load probe from before passkey login cannot overwrite the imported session", async () => {
  const { fixture, transferWaiting, transfer } = loginFixture();
  const oldResult = deferred();
  fixture.view.webContents.executeJavaScript = () => oldResult.promise;
  const oldProbe = BrowserHost.prototype.probeAuthentication.call(fixture);
  const passkey = fixture.openPasskeyLogin();
  await transferWaiting.promise;
  transfer.resolve("verified-transfer");
  await passkey;
  fixture.state.status = "ready";
  const importedState = fixture.snapshot();
  oldResult.resolve({
    url: "https://chatgpt.com/?temporary-chat=true",
    composer: false,
    temporary: true,
    sessionAuthenticated: false,
    readyState: "complete",
  });
  assert.deepEqual(await oldProbe, importedState);
  assert.equal(fixture.state.authenticated, true);
  assert.equal(fixture.state.status, "ready");
});

test("a delayed popup authentication result cannot close or navigate a replacement popup", async () => {
  const { fixture, calls } = loginFixture();
  const popupProbing = deferred();
  const popupResult = deferred();
  fixture.view.webContents.executeJavaScript = async () => ({
    composer: false, temporary: true, sessionAuthenticated: false, readyState: "complete",
  });
  fixture.view.webContents.loadURL = async () => calls.push("load-primary");
  fixture.authView = { webContents: {
    isDestroyed: () => false,
    executeJavaScript: () => { popupProbing.resolve(); return popupResult.promise; },
  } };
  const oldProbe = BrowserHost.prototype.probeAuthentication.call(fixture);
  await popupProbing.promise;
  const replacement = { webContents: { isDestroyed: () => false } };
  fixture.authView = replacement;
  popupResult.resolve({ sessionAuthenticated: true });
  await oldProbe;
  assert.equal(fixture.authView, replacement);
  assert.equal(calls.includes("close-auth"), false);
  assert.equal(calls.includes("load-primary"), false);
});

test("a superseded authentication navigation neither reprobes nor restores old authentication", async () => {
  const { fixture } = loginFixture();
  const navigating = deferred();
  const navigation = deferred();
  let probes = 0;
  fixture.manualOperation = "ChatGPT login";
  fixture.view.webContents.executeJavaScript = async () => {
    probes += 1;
    return { composer: true, temporary: false, sessionAuthenticated: true, readyState: "complete" };
  };
  fixture.view.webContents.loadURL = () => { navigating.resolve(); return navigation.promise; };
  const oldProbe = BrowserHost.prototype.probeAuthentication.call(fixture);
  await navigating.promise;
  fixture.authGeneration = (fixture.authGeneration ?? 0) + 1;
  fixture.state = { authenticated: false, status: "signed-out", message: "New login required" };
  navigation.resolve();
  await oldProbe;
  assert.equal(probes, 1);
  assert.deepEqual(fixture.state, { authenticated: false, status: "signed-out", message: "New login required" });
});
