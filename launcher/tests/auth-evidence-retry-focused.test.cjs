const test = require("node:test");
const assert = require("node:assert/strict");
const { BrowserHost, IDLE_BROWSER_URL } = require("../electron/browser-host.cjs");

const fingerprint = character => character.repeat(64);

function probeFixture(result, state = {}) {
  const fixture = {
    activeTraceId: null,
    authGeneration: 7,
    authProbeRevision: 0,
    authPrincipalFingerprint: fingerprint("a"),
    authSessionFingerprint: fingerprint("b"),
    authIdentityEpoch: 1,
    authView: null,
    manualOperation: null,
    visible: false,
    surfaceActive: true,
    state: {
      authenticated: true,
      authenticationStatus: "verified",
      authenticationCheckedAt: "2026-09-20T10:00:00.000Z",
      lastVerifiedAt: "2026-09-20T10:00:00.000Z",
      accountLabel: "alex@example.com",
      status: "ready",
      ...state,
    },
    view: { webContents: {
      isDestroyed: () => false,
      getURL: () => "https://chatgpt.com/?temporary-chat=true",
      executeJavaScript: async () => result,
    } },
    getBrowserInteractionMode: () => "automatic",
    setState: BrowserHost.prototype.setState,
    snapshot() { return { ...this.state }; },
    retireAuthenticatedIdentity: BrowserHost.prototype.retireAuthenticatedIdentity,
    onAuthIdentityChanged() {},
    logger: { info() {} },
  };
  return fixture;
}

test("unavailable authentication evidence fails closed while retaining historical identity", async () => {
  const fixture = probeFixture({
    composer: true,
    temporary: true,
    sessionAuthenticated: false,
    sessionVerification: "unavailable",
    verificationFailure: "session request timed out",
    readyState: "complete",
    url: "https://chatgpt.com/?temporary-chat=true",
  });

  const result = await BrowserHost.prototype.runAuthenticationProbe.call(fixture, { observationOnly: true });

  assert.equal(result.authenticated, false);
  assert.equal(result.authenticationStatus, "unavailable");
  assert.equal(result.authenticationIssue, "timeout");
  assert.match(result.authenticationCheckedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(result.lastVerifiedAt, "2026-09-20T10:00:00.000Z");
  assert.equal(result.accountLabel, "alex@example.com");
  assert.equal(fixture.authPrincipalFingerprint, fingerprint("a"));
  assert.equal(fixture.authSessionFingerprint, fingerprint("b"));
});

test("verified and rejected evidence update timestamps and identity authoritatively", async () => {
  const verified = probeFixture({
    composer: true,
    temporary: true,
    sessionAuthenticated: true,
    sessionVerification: "authenticated",
    readyState: "complete",
    url: "https://chatgpt.com/?temporary-chat=true",
    accountLabel: "current@example.com",
    principalFingerprint: fingerprint("c"),
    sessionFingerprint: fingerprint("d"),
  });
  const verifiedResult = await BrowserHost.prototype.runAuthenticationProbe.call(verified, { observationOnly: true });
  assert.equal(verifiedResult.authenticationStatus, "verified");
  assert.equal(verifiedResult.authenticated, true);
  assert.equal(verifiedResult.authenticationCheckedAt, verifiedResult.lastVerifiedAt);
  assert.equal(verifiedResult.accountLabel, "current@example.com");

  const rejected = probeFixture({
    composer: false,
    temporary: true,
    sessionAuthenticated: false,
    sessionVerification: "rejected",
    verificationFailure: "",
    readyState: "complete",
    url: "https://chatgpt.com/?temporary-chat=true",
  });
  const rejectedResult = await BrowserHost.prototype.runAuthenticationProbe.call(rejected, { observationOnly: true });
  assert.equal(rejectedResult.authenticationStatus, "signed-out");
  assert.equal(rejectedResult.authenticated, false);
  assert.equal(rejectedResult.accountLabel, null);
  assert.equal(rejectedResult.lastVerifiedAt, null);
  assert.equal(rejected.authPrincipalFingerprint, null);
  assert.equal(rejected.authSessionFingerprint, null);
});

test("explicit retry joins concurrent observation and never navigates or changes selected tabs", async () => {
  let finish;
  let probes = 0;
  let selections = 0;
  const fixture = {
    activeTraceId: null,
    authGeneration: 4,
    authenticationRetryOperation: null,
    currentOperation: () => null,
    getBrowserInteractionMode: () => "automatic",
    readOnlyInspection: null,
    ready: async () => {},
    selectedTabId: "retained-tab",
    publishState() {},
    snapshot: () => ({ authenticationStatus: "verified", authenticated: true }),
    probeAuthentication: async ({ observationOnly }) => {
      probes += 1;
      assert.equal(observationOnly, true);
      return await new Promise(resolve => { finish = resolve; });
    },
    view: { webContents: {
      isDestroyed: () => false,
      getURL: () => IDLE_BROWSER_URL,
      loadURL: async () => { throw new Error("retry must not navigate"); },
      stop() {},
    } },
    activateHomeSurface() { selections += 1; },
    withReadOnlyInspection: BrowserHost.prototype.withReadOnlyInspection,
  };

  const first = BrowserHost.prototype.retryAuthenticationCheck.call(fixture);
  const second = BrowserHost.prototype.retryAuthenticationCheck.call(fixture);
  assert.equal(first, second);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(probes, 1);
  finish({ authenticationStatus: "verified", authenticated: true });
  assert.deepEqual(await first, { authenticationStatus: "verified", authenticated: true });
  assert.equal(fixture.selectedTabId, "retained-tab");
  assert.equal(selections, 0);
  assert.equal(fixture.authenticationRetryOperation, null);
});

test("smoke, connector and helper inspection cannot promote unavailable authentication", async () => {
  const state = {
    authenticated: false,
    authenticationStatus: "unavailable",
    authenticationCheckedAt: "2026-09-21T10:00:00.000Z",
    lastVerifiedAt: "2026-09-20T10:00:00.000Z",
    accountLabel: "historical@example.com",
    status: "error",
  };
  const fixture = {
    state,
    visible: false,
    surfaceActive: true,
    getBrowserInteractionMode: () => "automatic",
    setState: BrowserHost.prototype.setState,
    snapshot() { return { ...this.state }; },
    connectorName: () => "Codex Native6",
    show() {},
    waitForSurfaceReady: async () => {},
    runBrowserHelperOperation: async ({ operation }) => ({ value: operation === "smoke"
      ? { effort: "high", response: "CODEX WEB GPT READY" }
      : { authenticated: true, temporary: true, url: "https://chatgpt.com/?temporary-chat=true" } }),
    refreshChatGptHomeDocument: async () => {},
    verifyConnectorWithBrowserHelper: async () => ({ ok: true }),
    view: { webContents: { getURL: () => "https://chatgpt.com/?temporary-chat=true" } },
    logger: { info() {}, error() {} },
  };

  await BrowserHost.prototype.runSmokeTest.call(fixture);
  await BrowserHost.prototype.runConnectorVerification.call(fixture, "Codex Native6");
  await BrowserHost.prototype.runSessionInspection.call(fixture, false);

  assert.equal(fixture.state.authenticated, false);
  assert.equal(fixture.state.authenticationStatus, "unavailable");
  assert.equal(fixture.state.authenticationCheckedAt, "2026-09-21T10:00:00.000Z");
  assert.equal(fixture.state.lastVerifiedAt, "2026-09-20T10:00:00.000Z");
  assert.equal(fixture.state.accountLabel, "historical@example.com");
});

test("unknown login state preserves guarded history while definitive sign-out clears it", () => {
  const fixture = {
    state: {
      authenticated: true,
      authenticationStatus: "verified",
      authenticationCheckedAt: "2026-09-21T10:00:00.000Z",
      lastVerifiedAt: "2026-09-21T10:00:00.000Z",
      accountLabel: "current@example.com",
    },
    visible: false,
    surfaceActive: true,
    snapshot() { return { ...this.state }; },
  };

  BrowserHost.prototype.setState.call(fixture, { authenticated: false, authenticationStatus: "unknown" });
  assert.equal(fixture.state.authenticationStatus, "unknown");
  assert.equal(fixture.state.accountLabel, "current@example.com");
  assert.equal(fixture.state.lastVerifiedAt, "2026-09-21T10:00:00.000Z");

  BrowserHost.prototype.setState.call(fixture, { authenticated: false, authenticationStatus: "signed-out" });
  assert.equal(fixture.state.authenticationStatus, "signed-out");
  assert.equal(fixture.state.accountLabel, null);
  assert.equal(fixture.state.lastVerifiedAt, null);
});
