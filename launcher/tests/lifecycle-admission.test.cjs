const test = require("node:test");
const assert = require("node:assert/strict");
const { createLifecycleAdmission } = require("../electron/lifecycle-admission.cjs");

test("transition blocks new mutations while observations and cancellation remain usable", () => {
  const admission = createLifecycleAdmission();
  let mutations = 0;
  const mutate = admission.guard("launcher:account-login", () => ++mutations);
  const lease = admission.acquire("NEKODEX shutdown");
  assert.throws(mutate, { code: "LAUNCHER_TRANSITION_BUSY" });
  assert.equal(mutations, 0);
  assert.equal(admission.guard("launcher:snapshot", () => "visible")(), "visible");
  assert.equal(admission.guard("launcher:codex-login-cancel", () => "cancelled")(), "cancelled");
  admission.release(lease);
  assert.equal(mutate(), 1);
});

test("update handoff retains its owner until cleanup; an old release cannot unlock a successor", () => {
  const admission = createLifecycleAdmission();
  const update = admission.acquire("the NEKODEX update");
  admission.assertOwner(update);
  assert.throws(() => admission.acquire("NEKODEX shutdown"), { code: "LAUNCHER_TRANSITION_BUSY" });
  assert.throws(() => admission.assertOwner({ ...update }), /ownership changed/);
  admission.release(update);
  const next = admission.acquire("local runtime startup");
  admission.release(update);
  assert.equal(admission.busy(), true);
  admission.assertOwner(next);
  admission.release(next);
  assert.equal(admission.busy(), false);
});

test("startup gates settings before asynchronous recovery yields and releases after failure", async () => {
  const admission = createLifecycleAdmission();
  let finish;
  const recovery = new Promise((_, reject) => { finish = reject; });
  const lease = admission.acquire("local runtime startup");
  const pending = recovery.finally(() => admission.release(lease));
  const setting = admission.guard("launcher:web-subagents", () => "saved");
  assert.throws(setting, { code: "LAUNCHER_TRANSITION_BUSY" });
  finish(new Error("recovery failed"));
  await assert.rejects(pending, /recovery failed/);
  assert.equal(setting(), "saved");
});
