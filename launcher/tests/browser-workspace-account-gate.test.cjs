const test = require("node:test");
const assert = require("node:assert/strict");
const { AccountBrowserPool } = require("../electron/account-pool.cjs");

test("workspace identity mutation reports every account owner without cancelling it", () => {
  let cancelled = false;
  const accountId = "default";
  const fixture = Object.assign(Object.create(AccountBrowserPool.prototype), {
    registry: { snapshot: () => ({ accounts: [{ id: accountId }] }) },
    hosts: new Map([[accountId, { currentOperation: () => null, turnTabs: new Map([["tab", { id: "tab", traceId: "trace-running", status: "running" }]]) }]]),
    reservations: new Map([["trace-reserved", accountId]]),
    pendingAffinity: new Map([["trace-affinity", { id: accountId, keys: ["key"] }]]),
    unsentAdmissions: new Map([["trace-unsent", { id: accountId }]]),
    authenticationRefreshOperations: new Map([[accountId, Promise.resolve()]]),
    loginOperation: { id: accountId },
    passkeyImportLease: { id: accountId },
    existingChromeImportLease: null,
    networkOperation: accountId,
  });
  // Acquire through admission policy before adding the independently observed owners.
  const owners = { hosts: fixture.hosts, reservations: fixture.reservations,
    pendingAffinity: fixture.pendingAffinity, unsentAdmissions: fixture.unsentAdmissions,
    authenticationRefreshOperations: fixture.authenticationRefreshOperations,
    loginOperation: fixture.loginOperation, passkeyImportLease: fixture.passkeyImportLease,
    networkOperation: fixture.networkOperation };
  Object.assign(fixture, { hosts: new Map([[accountId, { turnTabs: new Map(), currentOperation: () => null }]]),
    reservations: new Map(), pendingAffinity: new Map(), unsentAdmissions: new Map(),
    authenticationRefreshOperations: new Map(), loginOperation: null, passkeyImportLease: null, networkOperation: null });
  const releaseExclusive = fixture.acquireAccountOperation(accountId, "account setup");
  assert.deepEqual(fixture.canMutateAccountSession({ accountId }).blockers,
    [{ kind: "account-operation", id: "account setup" }]);
  releaseExclusive();
  const releaseRead = fixture.acquireAccountReadOperation(accountId, "quota read", () => { cancelled = true; });
  Object.assign(fixture, owners);
  const result = AccountBrowserPool.prototype.canMutateAccountSession.call(fixture, { accountId });
  assert.equal(result.allowed, false);
  assert.deepEqual(new Set(result.blockers.map(blocker => blocker.kind)), new Set([
    "turn", "reservation", "pending-affinity", "unsent-admission", "account-operation",
    "inspection", "login", "import",
  ]));
  assert.equal(cancelled, false);
  assert.ok(result.blockers.some(blocker => blocker.kind === "inspection" && blocker.id === "quota read"));
  releaseRead();
});

test("workspace identity mutation is allowed only when the exact account has no owner", () => {
  const fixture = Object.assign(Object.create(AccountBrowserPool.prototype), {
    hosts: new Map(), reservations: new Map(), pendingAffinity: new Map(), unsentAdmissions: new Map(),
    authenticationRefreshOperations: new Map(),
    loginOperation: null, passkeyImportLease: null, existingChromeImportLease: null, networkOperation: null,
  });
  assert.deepEqual(AccountBrowserPool.prototype.canMutateAccountSession.call(fixture, { accountId: "default" }), { allowed: true });
});
