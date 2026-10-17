import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";

const require = createRequire(import.meta.url);
const { BrowserHost, IDLE_BROWSER_URL, TEMPORARY_CHAT_URL } = require("../launcher/electron/browser-host.cjs");

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}

function fixture(url = TEMPORARY_CHAT_URL) {
  const loads: string[] = [];
  const publications: any[] = [];
  const contents: any = Object.assign(new EventEmitter(), {
    getURL: () => url, isDestroyed: () => false, isLoadingMainFrame: () => false,
    setWindowOpenHandler: () => {}, stop: () => {}, setBackgroundThrottling: () => {},
    loadURL: async (next: string) => { loads.push(next); url = next; },
  });
  const host: any = Object.assign(Object.create(BrowserHost.prototype), {
    view: { webContents: contents }, getBrowserInteractionMode: () => "automatic",
    state: { authenticated: false, authenticationStatus: "unavailable", status: "error",
      message: "ChatGPT session verification unavailable: session HTTP 403", lastVerifiedAt: "2026-10-15T09:27:20.019Z" },
    authGeneration: 0, authProbeRevision: 0, turnTabs: new Map(), manualOperation: null,
    selectedTabId: "retained-task", logger: { info() {}, error() {} },
    ready: async () => {}, activateHomeSurface: () => {}, currentOperation() { return this.readOnlyInspection?.name ?? null; },
    snapshot() { return { ...this.state }; }, publishState(value: any) { publications.push(value); },
    clearHomeNavigationTimeout() {}, armHomeNavigationTimeout() {},
  });
  host.probeAuthentication = async () => {
    host.setState({ authenticated: true, authenticationStatus: "verified", status: "ready", message: "ChatGPT is ready" });
    return host.snapshot();
  };
  return { host, contents, loads, publications };
}

test("retry reloads a failed ChatGPT navigation even when Electron retains its requested URL", async () => {
  const { host, contents, loads } = fixture();
  host.bindWebContents();
  contents.emit("did-fail-load", {}, -105, "ERR_NAME_NOT_RESOLVED", TEMPORARY_CHAT_URL, true);
  expect(host.primaryNavigationFailed).toBe(true);
  await expect(host.retryAuthenticationCheck()).resolves.toMatchObject({ authenticationStatus: "verified" });
  expect(loads).toEqual([TEMPORARY_CHAT_URL]);
  expect(host.selectedTabId).toBe("retained-task");
  expect(host.readOnlyInspection).toBeNull();
});

test("retry loads an idle home and keeps one pending operation until observation settles", async () => {
  const { host, loads, publications } = fixture(IDLE_BROWSER_URL);
  const probe = deferred<any>();
  host.probeAuthentication = () => probe.promise;
  const first = host.retryAuthenticationCheck();
  expect(host.retryAuthenticationCheck()).toBe(first);
  await new Promise(resolve => setImmediate(resolve));
  expect(loads).toEqual([TEMPORARY_CHAT_URL]);
  expect(host.state.authenticationStatus).toBe("unknown");
  expect(publications.some(value => value.message === "Checking saved ChatGPT session")).toBe(true);
  expect(host.readOnlyInspection.name).toBe("session verification retry");
  host.setState({ authenticated: true, authenticationStatus: "verified", status: "ready" });
  probe.resolve(host.snapshot());
  await first;
  expect(host.authenticationRetryOperation).toBeNull();
  expect(host.readOnlyInspection).toBeNull();
});

test("an unresolved check reports an error, preserves a loaded draft and can be retried", async () => {
  const { host, loads } = fixture("https://chatgpt.com/c/11111111-2222-3333-4444-555555555555?temporary-chat=true");
  const successfulProbe = host.probeAuthentication;
  host.probeAuthentication = async () => {
    host.setState({ authenticated: false, authenticationStatus: "unavailable", status: "error",
      message: "ChatGPT session verification unavailable: session HTTP 403" });
    return host.snapshot();
  };
  await expect(host.retryAuthenticationCheck()).rejects.toThrow("session HTTP 403");
  expect(host.state.authenticationStatus).toBe("unavailable");
  expect(host.state.lastVerifiedAt).toBe("2026-10-15T09:27:20.019Z");
  expect(loads).toEqual([]);
  expect(host.authenticationRetryOperation).toBeNull();
  host.probeAuthentication = successfulProbe;
  await expect(host.retryAuthenticationCheck()).resolves.toMatchObject({ authenticationStatus: "verified" });
});

test("confirmed sign-out remains distinct from an unavailable check", async () => {
  const { host } = fixture();
  host.probeAuthentication = async () => {
    host.setState({ authenticated: false, authenticationStatus: "signed-out", status: "signed-out" });
    return host.snapshot();
  };
  await expect(host.retryAuthenticationCheck()).resolves.toMatchObject({ authenticationStatus: "signed-out", lastVerifiedAt: null });
});

test("navigation failure and superseded checks release their lease without declaring sign-out", async () => {
  const { host, contents } = fixture(IDLE_BROWSER_URL);
  contents.loadURL = async () => { throw new Error("ERR_NAME_NOT_RESOLVED"); };
  await expect(host.retryAuthenticationCheck()).rejects.toThrow("ERR_NAME_NOT_RESOLVED");
  expect(host.state.authenticationStatus).toBe("unavailable");
  expect(host.readOnlyInspection).toBeNull();
  contents.getURL = () => TEMPORARY_CHAT_URL;
  host.probeAuthentication = async () => {
    host.authGeneration++;
    host.state = { ...host.state, authenticationStatus: "signed-out", message: "New session" };
    return host.snapshot();
  };
  await expect(host.retryAuthenticationCheck()).rejects.toThrow("browser session changed");
  expect(host.state.message).toBe("New session");
});

test("new embedded sign-in retires a cancelled external guide and recovers the known-failed page", async () => {
  const { host, loads } = fixture();
  host.primaryNavigationFailed = true;
  host.existingChromeProgress = { phase: "cancelled" };
  host.withManualOperation = async (_name: string, action: () => Promise<any>) => action();
  host.show = () => {};
  host.waitForAuthenticated = async () => host.snapshot();
  host.runSessionInspection = async () => ({});
  await host.openLogin();
  expect(host.existingChromeProgress).toBeNull();
  expect(loads).toEqual([TEMPORARY_CHAT_URL]);
  expect(host.loginOperation).toBeNull();
});

test("cancelling before a profile transfer preserves a settled verdict and never installs a session", async () => {
  for (const status of ["signed-out", "unavailable", "unknown"]) {
    const { host } = fixture();
    host.state.authenticationStatus = status;
    let captures = 0, installs = 0;
    host.loginWithChromeProfile = async () => {
      captures++;
      throw Object.assign(new Error("Profile selection cancelled"), { code: "profile-login-cancelled" });
    };
    host.installPasskeyLogin = async () => { installs++; };
    const result = await host.openPasskeyLogin("chrome-profile");
    expect(captures).toBe(1);
    expect(installs).toBe(0);
    expect(result.authenticationStatus).toBe(status === "unknown" ? "unavailable" : status);
    expect(result.loading).toBe(false);
    expect(host.passkeyProgress.phase).toBe("cancelled");
    expect(host.loginOperation).toBeNull();
  }
});

test("a cancelled chooser cannot restore evidence over a newer identity observation", async () => {
  const { host } = fixture();
  host.authIdentityEpoch = 1;
  host.loginWithChromeProfile = async () => {
    host.authIdentityEpoch++;
    host.setState({ authenticated: true, authenticationStatus: "verified", accountLabel: "new-identity@example.test" });
    throw Object.assign(new Error("Profile selection cancelled"), { code: "profile-login-cancelled" });
  };
  const result = await host.openPasskeyLogin("chrome-profile");
  expect(result.authenticationStatus).toBe("verified");
  expect(result.authenticated).toBe(true);
  expect(result.accountLabel).toBe("new-identity@example.test");
});

test("cancelling a chooser after it stopped an embedded page keeps that page recoverable", async () => {
  const { host, contents, loads } = fixture();
  let stops = 0;
  contents.isLoadingMainFrame = () => true;
  contents.stop = () => { stops++; };
  host.embeddedLoginController = new AbortController();
  host.loginOperation = Promise.resolve();
  host.closeAuthView = () => {};
  host.loginWithChromeProfile = async () => {
    throw Object.assign(new Error("Profile selection cancelled"), { code: "profile-login-cancelled" });
  };
  await host.openPasskeyLogin("chrome-profile");
  expect(stops).toBe(1);
  expect(host.primaryNavigationFailed).toBe(true);
  // The real embedded owner clears its reference when it settles.
  host.loginOperation = null;
  host.embeddedLoginController = null;
  await host.retryAuthenticationCheck();
  expect(loads).toEqual([TEMPORARY_CHAT_URL]);
});
