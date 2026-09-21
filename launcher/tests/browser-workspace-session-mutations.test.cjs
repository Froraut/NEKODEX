const test = require("node:test");
const assert = require("node:assert/strict");
const {
  AccountSessionMutationCoordinator,
} = require("../electron/browser-workspace-session-mutations.cjs");

test("session mutation refuses an active account without cancelling its task", () => {
  let cancelled = false;
  const coordinator = new AccountSessionMutationCoordinator({
    accountId: "a",
    canMutateAccountSession: () => ({
      allowed: false,
      reason: "Task trace-1 is still using this account",
      blockers: [{ kind: "pending-affinity", id: "trace-1" }],
    }),
  });
  assert.throws(() => coordinator.begin({ sourceId: "window", reason: "logout" }), /trace-1/);
  assert.equal(cancelled, false);
  assert.equal(coordinator.snapshot().admissionBlocked, false);
});

test("session mutation gates new admission until settled identity evidence is applied", async () => {
  const states = [];
  const applied = [];
  const coordinator = new AccountSessionMutationCoordinator({
    accountId: "a",
    canBegin: () => ({ allowed: true }),
    verify: async ({ generation }) => ({ generation, principal: "new-principal" }),
    applyVerification: async evidence => applied.push(evidence),
    onStateChange: state => states.push(state),
  });
  const lease = coordinator.begin({ sourceId: "window", reason: "login" });
  assert.equal(coordinator.snapshot().admissionBlocked, true);
  assert.equal(coordinator.owns({ sourceId: "window", generation: 1 }), true);
  const receipt = await lease.finish({ url: "https://chatgpt.com/" });
  assert.equal(receipt.status, "applied");
  assert.deepEqual(applied, [{ generation: 1, principal: "new-principal" }]);
  assert.equal(coordinator.snapshot().admissionBlocked, false);
  assert.equal(coordinator.owns({ sourceId: "window", generation: 1 }), false);
  assert.deepEqual(states.map(state => state.admissionBlocked), [true, false]);
});

test("a late verification result cannot apply after its generation is invalidated", async () => {
  let release;
  const applied = [];
  const coordinator = new AccountSessionMutationCoordinator({
    accountId: "a",
    canBegin: () => true,
    verify: () => new Promise(resolve => { release = resolve; }),
    applyVerification: evidence => applied.push(evidence),
  });
  const lease = coordinator.begin({ sourceId: "window", reason: "login" });
  const finishing = lease.finish({});
  coordinator.invalidate("newer identity mutation");
  release({ principal: "stale-principal" });
  assert.equal((await finishing).status, "stale");
  assert.deepEqual(applied, []);
});
