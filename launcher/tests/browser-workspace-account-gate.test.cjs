const test = require("node:test");
const assert = require("node:assert/strict");
const { AccountBrowserPool } = require("../electron/account-pool.cjs");

test("workspace identity mutation reports every account owner without cancelling it", () => {
  let cancelled = false;
  const accountId = "default";
  const fixture = {
    hosts: new Map([[accountId, { turnTabs: new Map([["tab", { id: "tab", traceId: "trace-running", status: "running" }]]) }]]),
    reservations: new Map([["trace-reserved", accountId]]),
    pendingAffinity: new Map([["trace-affinity", { id: accountId, keys: ["key"] }]]),
    unsentAdmissions: new Map([["trace-unsent", { id: accountId }]]),
    accountOperations: new Map([[accountId, { label: "account setup" }]]),
    accountReadOperations: new Map([[accountId, new Map([[Symbol("read"), { label: "quota read", cancel() { cancelled = true; } }]])]]),
    authenticationRefreshOperations: new Map([[accountId, Promise.resolve()]]),
    loginOperation: { id: accountId },
    passkeyImportLease: { id: accountId },
    existingChromeImportLease: null,
    networkOperation: accountId,
  };
  const result = AccountBrowserPool.prototype.canMutateAccountSession.call(fixture, { accountId });
  assert.equal(result.allowed, false);
  assert.deepEqual(new Set(result.blockers.map(blocker => blocker.kind)), new Set([
    "turn", "reservation", "pending-affinity", "unsent-admission", "account-operation",
    "inspection", "login", "import",
  ]));
  assert.equal(cancelled, false);
});

test("workspace identity mutation is allowed only when the exact account has no owner", () => {
  const fixture = {
    hosts: new Map(), reservations: new Map(), pendingAffinity: new Map(), unsentAdmissions: new Map(),
    accountOperations: new Map(), accountReadOperations: new Map(), authenticationRefreshOperations: new Map(),
    loginOperation: null, passkeyImportLease: null, existingChromeImportLease: null, networkOperation: null,
  };
  assert.deepEqual(AccountBrowserPool.prototype.canMutateAccountSession.call(fixture, { accountId: "default" }), { allowed: true });
});
