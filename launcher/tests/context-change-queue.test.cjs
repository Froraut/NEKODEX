const test = require("node:test");
const assert = require("node:assert/strict");
const { createContextChangeQueue } = require("../electron/context-change-queue.cjs");
function fixture(extra = {}) {
  let state = { experimentalBiggerContext: false, pendingBiggerContext: null, contextChangeError: null };
  let idle = false;
  const applied = [];
  const queue = createContextChangeQueue({
    read: () => ({ ...state }), write: patch => Object.assign(state, patch),
    ready: async () => idle,
    apply: async value => { applied.push(value); },
    onApplied: value => Object.assign(state, { experimentalBiggerContext: value }),
    schedule: () => 1, unschedule: () => {}, ...extra,
  });
  return { queue, applied, state: () => state, idle: () => { idle = true; } };
}
test("queued context change preserves active mode until idle and applies exactly once", async () => {
  const f = fixture();
  f.queue.request(true);
  await f.queue.flush();
  assert.equal(f.state().pendingBiggerContext, true);
  assert.equal(f.state().experimentalBiggerContext, false);
  assert.deepEqual(f.applied, []);
  f.idle(); await f.queue.flush(); await f.queue.flush();
  assert.deepEqual(f.applied, [true]);
  assert.equal(f.state().pendingBiggerContext, null);
  assert.equal(f.state().experimentalBiggerContext, true);
});
test("superseding context changes cancel cleanly; deterministic failures wait for explicit retry", async () => {
  let calls = 0;
  const f = fixture({ apply: async () => { calls++; throw new Error("configuration changed"); } });
  f.queue.request(true); f.queue.request(false); f.idle(); await f.queue.flush();
  assert.equal(calls, 0);
  f.queue.request(true); await f.queue.flush(); await f.queue.flush();
  assert.equal(calls, 1);
  assert.equal(f.state().experimentalBiggerContext, false);
  assert.equal(f.state().contextChangeError, "configuration changed");
  f.queue.request(true); await f.queue.flush(); assert.equal(calls, 2);
  f.queue.cancel(); assert.equal(f.state().pendingBiggerContext, null);
});
