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

for (const status of ['admitted', 'running']) {
  test(`pump reconciles a lost ${status} lease durably without resubmission or unsent cleanup`, async () => {
    const { AccountBrowserPool } = require('../electron/account-pool.cjs');
    const tabs = new Map();
    const pool = { hosts: new Map([['default', { turnTabs: tabs }]]) };
    let dispatches = 0;
    const f = fixture({
      leaseCurrent: (req, lease) => AccountBrowserPool.prototype.admissionLeaseCurrent.call(pool, req, lease),
      dispatch: async req => {
        dispatches++;
        const surfaceId = String(dispatches).repeat(32);
        tabs.set(req.traceId, { ...req, status: 'running', surfaceId });
        return { surfaceId };
      },
      releaseUnsent: () => { throw new Error('Missing lease does not prove not-sent'); },
    });
    let restored;
    try {
      const lost = request(`trace-lost-${status}`), live = request(`trace-live-${status}`);
      const queued = f.queue.request(lost); await tick();
      const lease = f.queue.request(lost);
      if (status === 'running') f.queue.acknowledge(lost.traceId, lost.helperPid, lease.surfaceId);
      f.queue.request(live); await tick();
      // A replacement with the same trace but another surface/helper is not this lease.
      tabs.set(lost.traceId, { ...tabs.get(lost.traceId), surfaceId: 'f'.repeat(32), helperPid: process.pid + 1 });
      await f.queue.pump();
      const orphan = f.queue.snapshot().entries.find(row => row.id === queued.queueId);
      assert.equal(orphan.status, 'interrupted');
      assert.equal(orphan.reason, 'lease-ended');
      assert.equal(orphan.canDismiss, true);
      assert.equal(orphan.canResume, false);
      assert.equal(f.queue.entries.find(row => row.request.traceId === live.traceId).status, 'admitted');
      assert.throws(() => f.queue.request(lost), error => error.code === 'queue_task_ended');
      tabs.delete(lost.traceId); await f.queue.pump();
      assert.equal(dispatches, 2);
      const saved = JSON.parse(fs.readFileSync(f.options.file, 'utf8')).entries.find(row => row.id === queued.queueId);
      assert.equal(saved.status, 'interrupted'); assert.equal(saved.reason, 'lease-ended');
      restored = new BrowserAdmissionQueue(f.options);
      assert.equal(restored.snapshot().entries.find(row => row.id === queued.queueId).reason, 'lease-ended');
      await restored.pump(); assert.equal(dispatches, 2);
      await f.queue.action(queued.queueId, 'dismiss');
      assert.equal(f.queue.entries.some(row => row.id === queued.queueId), false);
    } finally { restored?.close(); f.close(); }
  });
}

test('reconciled incident is retained at history capacity until explicitly dismissed', async () => {
  let current = true, dispatches = 0;
  const f = fixture({ leaseCurrent: () => current, dispatch: async () => { dispatches++; return { surfaceId: 'a'.repeat(32) }; } });
  try {
    const queued = f.queue.request(request('trace-capacity-orphan')); await tick();
    const { randomUUID } = require('node:crypto');
    const template = f.queue.entries[0];
    f.queue.entries.push(...Array.from({ length: 2047 }, (_, index) => ({ ...template,
      id: randomUUID(), request: request(`trace-incident-${index}`), status: 'interrupted', reason: 'previous-run' })));
    current = false; await f.queue.pump();
    assert.equal(f.queue.snapshot().entries.length, 2048);
    assert.throws(() => f.queue.request(request('trace-capacity-new')), /Review and dismiss/);
    assert.equal(dispatches, 1);
    await f.queue.action(queued.queueId, 'dismiss');
    assert.equal(f.queue.entries.length, 2047);
    current = true;
    f.queue.request(request('trace-capacity-new')); await tick();
    assert.equal(dispatches, 2);
    assert.equal(f.queue.entries.length, 2048);
  } finally { f.close(); }
});


test('prioritize during acquisition selects the next live candidate and skips cancelled work', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const started = [];
  const f = fixture({ clock: () => 1000, dispatch: async req => {
    started.push(req.traceId);
    if (req.traceId === 'trace-front-first') await gate;
    return { surfaceId: 'a'.repeat(32) };
  } });
  try {
    f.queue.pause(null, true);
    f.queue.request(request('trace-front-first'));
    f.queue.request(request('trace-front-second'));
    const third = f.queue.request(request('trace-front-third'));
    const cancelled = f.queue.request(request('trace-front-cancelled'));
    f.queue.pause(null, false);
    assert.deepEqual(started, ['trace-front-first']);
    await f.queue.action(third.queueId, 'prioritize');
    await f.queue.action(cancelled.queueId, 'cancel');
    release(); await tick();
    assert.deepEqual(started, ['trace-front-first', 'trace-front-third', 'trace-front-second']);
    assert.equal(f.queue.snapshot().entries.find(row => row.id === cancelled.queueId).status, 'cancelled');
  } finally { release(); f.close(); }
});


test('live candidate selection still honors pause and owner loss after an awaited acquisition', async () => {
  let release, now = 1000;
  const gate = new Promise(resolve => { release = resolve; });
  const started = [];
  const f = fixture({ clock: () => now, dispatch: async req => {
    started.push(req.traceId);
    if (req.traceId === 'trace-transition-first') await gate;
    return { surfaceId: 'a'.repeat(32) };
  } });
  try {
    f.queue.pause(null, true);
    f.queue.request(request('trace-transition-first'));
    const stale = f.queue.request(request('trace-transition-stale'));
    const liveInput = request('trace-transition-live');
    f.queue.request(liveInput);
    f.queue.pause(null, false);
    now += 10_000;
    f.queue.request(liveInput); // Only this waiting owner is still polling.
    f.queue.pause(null, true);
    release(); await tick();
    assert.deepEqual(started, ['trace-transition-first']);
    const rows = f.queue.snapshot().entries;
    assert.equal(rows.find(row => row.id === stale.queueId).reason, 'owner-reconnect-required');
    assert.equal(rows.find(row => row.id === stale.queueId).canResume, false);
    assert.equal(rows.find(row => row.traceId === liveInput.traceId).reason, 'paused-global');
    f.queue.pause(null, false); await tick();
    assert.deepEqual(started, ['trace-transition-first', 'trace-transition-live']);
    assert.equal(f.queue.snapshot().entries.find(row => row.id === stale.queueId).status, 'paused');
  } finally { release(); f.close(); }
});

test('terminal failures persist only allowlisted metadata and never infer unsent from failure', async () => {
  let dispatches = 0;
  const f = fixture({ dispatch: async req => {
    dispatches++;
    throw Object.assign(new Error('private provider text must not be journalled'), {
      code: req.retained ? 'retained_conversation_unavailable' : 'unexpected_provider_failure',
      ...(req.retained ? {} : { workStarted: false }), token: 'private-secret',
    });
  }, releaseUnsent: () => { throw new Error('Failed row must not refund based on a missing tab'); } });
  let restored;
  try {
    const retained = { ...request('trace-terminal-retained'), retained: true };
    const unknown = request('trace-terminal-unknown');
    f.queue.request(retained); await tick();
    f.queue.request(unknown); await tick();
    assert.equal(dispatches, 2);
    const bytes = fs.readFileSync(f.options.file, 'utf8');
    assert.equal(bytes.includes('private'), false);
    const saved = JSON.parse(bytes);
    assert.deepEqual(saved.entries[0].terminalFailure, { code: 'retained_conversation_unavailable' });
    assert.equal(saved.entries[1].terminalFailure, undefined);
    restored = new BrowserAdmissionQueue(f.options);
    assert.equal(restored.storageIssue, null);
    assert.throws(() => restored.request(retained), error => error.code === 'retained_conversation_unavailable' && error.workStarted === undefined);
    assert.throws(() => restored.request(unknown), error => error.code === 'queue_task_ended' && error.workStarted === undefined);
    assert.deepEqual(await f.queue.cancelOwner(retained.traceId, retained.helperPid), { cancelled: false, notSent: false });
    assert.deepEqual(await f.queue.cancelOwner(unknown.traceId, unknown.helperPid), { cancelled: false, notSent: false });
    await restored.pump(); assert.equal(dispatches, 2);
    restored.close();
    saved.entries[0].terminalFailure.workStarted = true;
    fs.writeFileSync(f.options.file, JSON.stringify(saved));
    restored = new BrowserAdmissionQueue(f.options);
    assert.equal(restored.storageIssue, 'queue-storage-unavailable');
    assert.throws(() => restored.request(retained), /history is unavailable/);
  } finally { restored?.close(); f.close(); }
});
