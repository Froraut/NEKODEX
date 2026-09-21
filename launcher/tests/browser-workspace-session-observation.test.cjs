const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { BrowserHost, isWorkspaceSessionMutationRequest } = require("../electron/browser-host.cjs");

function jsonResponse(value) {
  const bytes = Buffer.from(JSON.stringify(value));
  let sent = false;
  return {
    ok: true,
    status: 200,
    headers: { get(name) { return name === "content-type" ? "application/json" : String(bytes.length); } },
    body: { getReader() { return {
      async read() { if (sent) return { done: true }; sent = true; return { done: false, value: bytes }; },
      async cancel() {},
    }; } },
  };
}

test("workspace request guard classifies mutating auth traffic but not session reads", () => {
  assert.equal(isWorkspaceSessionMutationRequest({ method: "GET", url: "https://chatgpt.com/api/auth/session" }), false);
  assert.equal(isWorkspaceSessionMutationRequest({ method: "POST", url: "https://chatgpt.com/api/auth/signout" }), true);
  assert.equal(isWorkspaceSessionMutationRequest({ method: "POST", url: "https://accounts.google.com/signin" }), true);
  assert.equal(isWorkspaceSessionMutationRequest({ method: "POST", url: "https://chatgpt.com/backend-api/conversation" }), false);
});

test("workspace identity observation uses the account session and canonical principal fingerprint", async () => {
  const payload = { user: { id: "user-123", email: "person@example.test" }, expires: "2099-01-01T00:00:00.000Z" };
  const calls = [];
  const fixture = {
    view: { webContents: { session: { async fetch(url, options) { calls.push([url, options.credentials]); return jsonResponse(payload); } } } },
  };
  const evidence = await BrowserHost.prototype.observeWorkspaceSessionMutation.call(fixture, {
    context: { contents: { isDestroyed: () => false, getURL: () => "https://chatgpt.com/" } },
  });
  assert.equal(evidence.status, "authenticated");
  assert.equal(evidence.label, "person@example.test");
  assert.equal(evidence.principalFingerprint, createHash("sha256").update("id:user-123").digest("hex"));
  assert.deepEqual(calls, [
    ["https://chatgpt.com/api/auth/session", "include"],
    ["https://chatgpt.com/api/auth/session", "include"],
  ]);
});

test("workspace evidence applies one new identity epoch only after coordinator acceptance", () => {
  const published = [];
  const fixture = {
    accountId: "a", authGeneration: 3, authProbeRevision: 4, authPrincipalFingerprint: "a".repeat(64),
    authSessionFingerprint: "b".repeat(64), authIdentityEpoch: 7,
    onAuthIdentityChanged: (id, epoch) => published.push([id, epoch]),
    setState(patch) { this.state = patch; }, snapshot() { return this.state; },
  };
  const result = BrowserHost.prototype.applyWorkspaceSessionMutationEvidence.call(fixture, {
    status: "authenticated", principalFingerprint: "c".repeat(64), label: "person@example.test",
  });
  assert.equal(fixture.authGeneration, 4);
  assert.equal(fixture.authProbeRevision, 5);
  assert.equal(fixture.authSessionFingerprint, null);
  assert.equal(fixture.authIdentityEpoch, 8);
  assert.deepEqual(published, [["a", 8]]);
  assert.equal(result.authenticated, true);
});

test("workspace auth POST acquires one request lease and the shared completion dispatcher settles it", async () => {
  const listeners = {};
  const events = [];
  const contents = { id: 71, isDestroyed: () => false };
  const lease = {
    async finish(context) { events.push(["finish", context.requestId]); },
    fail(error) { events.push(["fail", error.message]); },
  };
  const webRequest = {
    onBeforeRequest(_filter, listener) { listeners.before = listener; },
    onErrorOccurred(_filter, listener) { listeners.error = listener; },
    onCompleted(_filter, listener) { listeners.completed = listener; },
  };
  const fixture = {
    accountId: "default",
    view: { webContents: { session: { webRequest } } },
    workspaceSessionMutation: {
      owns: () => false,
      begin(request) { events.push(["begin", request.sourceId]); return lease; },
    },
    workspaceMetadata: new Map([[contents, { workspaceId: "workspace-1" }]]),
    workspaceMutationRequests: new Map(),
    workspaceRequestOwner: BrowserHost.prototype.workspaceRequestOwner,
    handleWorkspaceSessionMutationCompleted: BrowserHost.prototype.handleWorkspaceSessionMutationCompleted,
    interactionModeOverride: null, getBrowserInteractionMode: () => "automatic",
    logger: { warn() {} }, workspaceChanged() {},
    handleChatGptBackendResponse() { events.push(["backend"]); },
  };
  BrowserHost.prototype.bindWorkspaceSessionRequestGuard.call(fixture);
  BrowserHost.prototype.bindChatGptBackendRecovery.call(fixture);
  let decision;
  listeners.before({ id: 9, webContentsId: 71, method: "POST", url: "https://chatgpt.com/api/auth/signout" }, value => { decision = value; });
  assert.deepEqual(decision, {});
  listeners.completed({ id: 9, webContentsId: 71, statusCode: 200, method: "POST", url: "https://chatgpt.com/api/auth/signout" });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, [["begin", "workspace-1"], ["finish", 9], ["backend"]]);
  assert.equal(fixture.workspaceMutationRequests.size, 0);
});
