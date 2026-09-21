const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { BrowserAdmissionQueue } = require('../electron/browser-admission-queue.cjs');

const request = traceId => ({ traceId, helperPid: process.pid, reveal: false, key: null, connector: null,
  retained: false, effort: 'medium', routingKey: null, taskProgressVersion: 1, requestedAccountId: 'default' });
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nekodex-admission-'));
  const options = { file: path.join(root, 'queue.json'), autoPump: false, alive: () => true,
    inspect: () => null, dispatch: async () => ({ surfaceId: 'a'.repeat(32), reused: false, connectorBound: false }),
    releaseUnsent: async () => true, leaseCurrent: () => true, ...overrides };
  const queue = new BrowserAdmissionQueue(options);
  return { queue, options, close() { queue.close(); fs.rmSync(root, { recursive: true, force: true }); } };
}

test('one freed slot admits one waiting owner; repeated polls do not submit twice', async () => {
  let active = 1; const started = [];
  const f = fixture({ clock: () => 1000, inspect: () => active ? { reason: 'capacity' } : null,
    dispatch: async req => { active++; started.push(req.traceId); return { surfaceId: 'a'.repeat(32), reused: false, connectorBound: false }; } });
  try {
    assert.equal(f.queue.request(request('trace-first')).queued, true);
    f.queue.request(request('trace-second'));
    assert.deepEqual(f.queue.snapshot().entries.map(row => row.position), [1, 2]);
    assert.equal(started.length, 0);
    active = 0; await f.queue.pump(); await tick();
    assert.deepEqual(started, ['trace-first']);
    assert.equal(f.queue.request(request('trace-first')).queued, false);
    assert.equal(f.queue.request(request('trace-first')).queued, false);
    assert.deepEqual(started, ['trace-first']);
    assert.equal(f.queue.snapshot().entries.find(row => row.traceId === 'trace-second').status, 'waiting');
  } finally { f.close(); }
});

test('pause holds new work and cancellation remains final after history dismissal and late start', async () => {
  const started = [];
  const f = fixture({ dispatch: async req => { started.push(req.traceId); return {}; } });
  try {
    f.queue.pause(null, true);
    const queued = f.queue.request(request('trace-cancelled'));
    await tick(); assert.equal(started.length, 0);
    assert.equal((await f.queue.cancelOwner('trace-cancelled', process.pid)).notSent, true);
    await f.queue.action(queued.queueId, 'dismiss');
    f.queue.pause(null, false);
    assert.throws(() => f.queue.request(request('trace-cancelled')), error => error.code === 'turn_cancelled');
    await f.queue.cancelOwner('trace-late-start', process.pid);
    assert.throws(() => f.queue.request(request('trace-late-start')), error => error.code === 'turn_cancelled');
    await tick(); assert.equal(started.length, 0);
  } finally { f.close(); }
});

test('restart restores a paused queue and needs both a live owner and explicit resume', async () => {
  let started = 0;
  const f = fixture({ inspect: () => ({ reason: 'capacity' }), dispatch: async () => { started++; return {}; } });
  let restored;
  try {
    const input = request('trace-restart'); const queued = f.queue.request(input); await tick(); f.queue.close();
    restored = new BrowserAdmissionQueue({ ...f.options, inspect: () => null });
    await restored.pump(); assert.equal(started, 0);
    assert.equal(restored.snapshot().entries[0].canResume, false);
    restored.request(input);
    assert.equal(restored.snapshot().entries[0].canResume, true);
    assert.equal(started, 0);
    await restored.action(queued.queueId, 'resume'); await tick();
    assert.equal(started, 1);
  } finally { restored?.close(); f.close(); }
});

test('cancel while acquiring joins exact unsent cleanup before it reports cancelled', async () => {
  let release; let cleaned = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const f = fixture({ dispatch: async () => { await gate; return {}; }, releaseUnsent: async () => { cleaned++; return true; } });
  try {
    f.queue.request(request('trace-acquiring'));
    const cancellation = await f.queue.cancelOwner('trace-acquiring', process.pid);
    assert.equal(cancellation.cancelling, true);
    assert.equal(f.queue.snapshot().entries[0].status, 'cancelling');
    assert.equal(f.queue.snapshot().entries[0].canCancel, false);
    release(); await tick();
    assert.equal(cleaned, 1);
    assert.equal(f.queue.snapshot().entries[0].status, 'cancelled');
    assert.throws(() => f.queue.request(request('trace-acquiring')), error => error.code === 'turn_cancelled');
  } finally { release(); f.close(); }
});

test('a lease can be replayed only before acknowledgement while its surface remains current', async () => {
  let current = true;
  const f = fixture({ leaseCurrent: () => current });
  try {
    const input = request('trace-lease-current');
    f.queue.request(input); await tick();
    const lease = f.queue.request(input);
    assert.equal(lease.queued, false);
    assert.equal(f.queue.snapshot().entries[0].canCancel, true);
    f.queue.acknowledge(input.traceId, input.helperPid, lease.surfaceId);
    assert.equal(f.queue.snapshot().entries.length, 0);
    assert.throws(() => f.queue.request(input), /ended/);
    f.queue.retire(input.traceId, input.helperPid);
    assert.throws(() => f.queue.request(input), /ended/);
    const other = request('trace-stale-lease');
    f.queue.request(other); await tick(); current = false;
    assert.throws(() => f.queue.request(other), /ended/);
    assert.equal(f.queue.snapshot().entries[0].status, 'interrupted');
  } finally { f.close(); }
});

test('closing a queue during acquisition cannot start the next waiting owner', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const started = [];
  const f = fixture({ dispatch: async req => { started.push(req.traceId); await gate; return {}; } });
  try {
    f.queue.request(request('trace-close-first'));
    f.queue.request(request('trace-close-second'));
    f.queue.close(); release(); await tick();
    assert.deepEqual(started, ['trace-close-first']);
    assert.equal(f.queue.snapshot().entries.find(row => row.traceId === 'trace-close-second').status, 'waiting');
  } finally { release(); f.close(); }
});
