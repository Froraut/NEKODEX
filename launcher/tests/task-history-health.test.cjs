const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AccountBrowserPool } = require('../electron/account-pool.cjs');
const { BrowserTaskLedger } = require('../electron/browser-task-ledger.cjs');
const { BrowserAdmissionQueue } = require('../electron/browser-admission-queue.cjs');
const healthyId = '11111111-1111-4111-8111-111111111111';
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nekodex-history-health-'));
  const file = path.join(root, 'tasks-default.json');
  const original = '{unreadable journal containing private data';
  fs.writeFileSync(file, original);
  const accounts = [{ id: 'default', label: 'Primary', enabled: true }, { id: healthyId, label: 'Healthy', enabled: true }];
  const state = { selectedId: 'default', mode: 'selected', accounts };
  let allowanceChecks = 0, dispatches = 0;
  const hosts = new Map(accounts.map(({ id }) => [id, {
    turnTabs: new Map(), state: { authenticated: true }, currentOperation: () => null,
    exactRetainedTurnTab: () => null, snapshot: () => ({ tabs: [] }),
  }]));
  const pool = Object.assign(Object.create(AccountBrowserPool.prototype), {
    registry: { snapshot: () => state }, hosts, options: { maxTabs: 4 },
    taskLedgers: new Map([['default', new BrowserTaskLedger(file)], [healthyId, new BrowserTaskLedger(path.join(root, 'healthy.json'))]]),
    turnAdmission: { open: true }, destroyed: false, reservations: new Map(), traceOwners: new Map(),
    affinity: new Map(), pendingAffinity: new Map(), accountOperations: new Map(), lastAssigned: new Map(),
    capabilities: new Map(accounts.map(({ id }) => [id, { solAvailable: true }])), connectors: new Map(),
    safety: { availability: () => { allowanceChecks++; return { eligible: true }; } },
  });
  pool.admissionQueue = new BrowserAdmissionQueue({ file: path.join(root, 'queue.json'), autoPump: false,
    inspect: req => pool.previewAdmission(req), alive: () => true,
    dispatch: async () => { dispatches++; return { surfaceId: 'a'.repeat(32) }; }, leaseCurrent: () => true,
  });
  return { pool, state, file, original, counts: () => ({ allowanceChecks, dispatches }),
    close() { pool.admissionQueue.close(); fs.rmSync(root, { recursive: true, force: true }); } };
}
const request = { traceId: 'trace-history', helperPid: process.pid, reveal: false, key: null, connector: null,
  retained: false, effort: 'medium', routingKey: null, taskProgressVersion: 1, requestedAccountId: 'default' };

test('damaged history is account-scoped and holds selected admission before allowance or dispatch', async () => {
  const f = fixture();
  try {
    assert.deepEqual(f.pool.snapshot().taskHistoryHealth,
      [{ accountId: 'default', accountName: 'Primary', issue: 'task-history-unavailable' }]);
    assert.equal(f.pool.snapshot().tasks.length, 0);
    assert.deepEqual(f.pool.previewAdmission({ ...request, requestedAccountId: null }), { reason: 'task-history-unavailable' });
    f.pool.queueTurn({ traceId: request.traceId, helperPid: process.pid, requestedEffort: 'medium' }, false);
    await tick();
    assert.equal(f.pool.admissionQueue.snapshot().entries[0].reason, 'task-history-unavailable');
    assert.deepEqual(f.counts(), { allowanceChecks: 0, dispatches: 0 });
    assert.equal(fs.readFileSync(f.file, 'utf8'), f.original);
    // Switching selection does not move the already queued task away from its owner.
    f.state.selectedId = healthyId;
    await f.pool.admissionQueue.pump();
    assert.deepEqual(f.counts(), { allowanceChecks: 0, dispatches: 0 });
    assert.equal(f.pool.previewAdmission({ ...request, traceId: 'trace-healthy', requestedAccountId: healthyId }), null);
    f.pool.admissionQueue.request({ ...request, traceId: 'trace-healthy', requestedAccountId: healthyId }); await tick();
    assert.equal(f.counts().dispatches, 1);
    assert.equal(fs.readFileSync(f.file, 'utf8'), f.original);
  } finally { f.close(); }
});

test('balanced preview preserves conversation affinity to unhealthy history without fallback', () => {
  const f = fixture();
  try {
    f.state.mode = 'balanced'; f.state.selectedId = healthyId;
    const key = 'b'.repeat(64);
    f.pool.affinity.set(key, 'default');
    assert.deepEqual(f.pool.previewAdmission({ ...request, requestedAccountId: null, routingKey: key }),
      { reason: 'task-history-unavailable' });
    assert.deepEqual(f.counts(), { allowanceChecks: 0, dispatches: 0 });
    assert.equal(f.pool.affinity.get(key), 'default');
    assert.equal(fs.readFileSync(f.file, 'utf8'), f.original);
    f.pool.taskLedgers.set('default', f.pool.taskLedgers.get(healthyId));
    assert.deepEqual(f.pool.snapshot().taskHistoryHealth, []);
  } finally { f.close(); }
});

test('direct starts reject damaged history before pacing and recheck after account readiness', async () => {
  const f = fixture();
  try {
    let pacingAdmissions = 0, hostStarts = 0;
    const ledger = f.pool.taskLedgers.get('default');
    const host = f.pool.hosts.get('default');
    Object.assign(f.pool, {
      evidenceEpoch: () => 0, selectionRevision: 0, sequence: 0,
      unsentAdmissions: new Map(), ensureTabCapacity() {},
      persistAffinity() {}, writeDescriptor() {}, publish() {},
    });
    Object.assign(host, {
      ready: async () => {}, assertLiveConversationOwner() {},
      beginTurn: async () => { hostStarts++; return {}; },
    });
    f.pool.safety.admit = () => { pacingAdmissions++; return { newSessionRecorded: false }; };
    const start = () => f.pool.beginTurn(request.traceId, false, process.pid,
      undefined, undefined, false, { requestedAccountId: 'default', effort: 'medium' });
    await assert.rejects(start, { code: 'task-history-unavailable', workStarted: false });
    assert.equal(f.pool.sequence, 0);
    assert.equal(f.pool.lastAssigned.size, 0);
    assert.equal(f.pool.traceOwners.size, 0);
    assert.equal(f.pool.reservations.size, 0);
    assert.equal(pacingAdmissions, 0);
    assert.equal(hostStarts, 0);

    ledger.storageIssue = null;
    host.ready = async () => { ledger.storageIssue = 'task-history-unavailable'; };
    await assert.rejects(start, { code: 'task-history-unavailable', workStarted: false });
    assert.equal(f.pool.traceOwners.size, 0);
    assert.equal(f.pool.reservations.size, 0);
    assert.equal(f.pool.pendingAffinity.size, 0);
    assert.equal(pacingAdmissions, 0);
    assert.equal(hostStarts, 0);
    assert.equal(fs.readFileSync(f.file, 'utf8'), f.original);
  } finally { f.close(); }
});
