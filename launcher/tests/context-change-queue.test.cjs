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

test("stopping a queue retires its pending readiness check without applying or writing late state", async () => {
  let resolveReady;
  const f = fixture({ ready: () => new Promise(resolve => { resolveReady = resolve; }) });
  f.queue.request(true);
  const flush = f.queue.flush();
  const beforeStop = { ...f.state() };
  f.queue.stop();
  resolveReady(true);
  await flush;
  assert.deepEqual(f.applied, []);
  assert.deepEqual(f.state(), beforeStop);
});

test("waiting for readiness is cancellable and an old failed check cannot poison a replacement request", async () => {
  let rejectReady, checks = 0;
  const f = fixture({ ready: () => ++checks === 1
    ? new Promise((_resolve, reject) => { rejectReady = reject; }) : Promise.resolve(true) });
  f.queue.request(true);
  const oldFlush = f.queue.flush();
  assert.doesNotThrow(() => f.queue.cancel());
  assert.equal(f.state().pendingBiggerContext, null);
  f.queue.request(true);
  rejectReady(new Error("old account configuration was retired"));
  await oldFlush;
  assert.equal(f.state().contextChangeError, null);
  await f.queue.flush();
  assert.deepEqual(f.applied, [true]);
  assert.equal(f.state().pendingBiggerContext, null);
  f.queue.stop();
});

test("a failed older apply does not block the user's newer context choice", async () => {
  let rejectApply;
  const f = fixture({ apply: () => new Promise((_resolve, reject) => { rejectApply = reject; }) });
  f.idle(); f.queue.request(true);
  const oldFlush = f.queue.flush();
  await Promise.resolve();
  assert.equal(f.state().contextChangeApplying, true);
  f.queue.request(false);
  rejectApply(new Error("older change failed"));
  await oldFlush;
  assert.equal(f.state().contextChangeError, null);
  assert.equal(f.state().pendingBiggerContext, false);
  await f.queue.flush();
  assert.equal(f.state().experimentalBiggerContext, false);
  assert.equal(f.state().pendingBiggerContext, null);
  f.queue.stop();
});

test("a committed older apply reports its actual mode then preserves and applies the newer choice", async () => {
  let finishFirst, calls = 0;
  const applied = [];
  const f = fixture({ apply: async value => {
    applied.push(value);
    if (++calls === 1) await new Promise(resolve => { finishFirst = resolve; });
  } });
  f.idle(); f.queue.request(true);
  const oldFlush = f.queue.flush();
  await Promise.resolve();
  f.queue.request(false);
  finishFirst(); await oldFlush;
  assert.equal(f.state().experimentalBiggerContext, true);
  assert.equal(f.state().pendingBiggerContext, false);
  await f.queue.flush();
  assert.deepEqual(applied, [true, false]);
  assert.equal(f.state().experimentalBiggerContext, false);
  assert.equal(f.state().pendingBiggerContext, null);
  f.queue.stop();
});
