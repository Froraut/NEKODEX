const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { BrowserHost } = require('../electron/browser-host.cjs');
const { AccountBrowserPool } = require('../electron/account-pool.cjs');
const { BrowserTaskLedger } = require('../electron/browser-task-ledger.cjs');
const { AccountSafety, DEFAULT_POLICY } = require('../electron/account-safety.cjs');

function fixture(t, phase) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nekodex-unsent-removal-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const traceId = 'trace_removal', helperPid = 4321, id = 'default';
  const safety = new AccountSafety(home);
  safety.setPolicy(id, { ...DEFAULT_POLICY, newSessionWindow: { limit: 1, minutes: 60 } });
  const safetyBefore = safety.entry(id);
  const newSessionReservation = 'a'.repeat(64);
  const admission = safety.admit(id, 0, { createsNewSession: true, sessionId: newSessionReservation });
  assert.equal(admission.newSessionRecorded, true);
  const ledger = new BrowserTaskLedger(path.join(home, 'tasks.json'));
  const taskRecordId = ledger.start(traceId, 'tab_removal', phase === 'unknown' ? undefined : 1);
  if (phase && phase !== 'unknown') ledger.progress(taskRecordId, phase, 1);
  const tab = { id: 'tab_removal', traceId, helperPid, taskRecordId, surfaceId: 'surface_removal',
    interactionMode: 'automatic', status: 'running', bootstrapReady: false, bootstrapDeadlineAt: 0,
    view: { webContents: { isDestroyed: () => false, close() { tab.closed = true; }, setBackgroundThrottling() {} } } };
  const host = Object.assign(Object.create(BrowserHost.prototype), {
    accountId: id, taskLedger: ledger, turnTabs: new Map([[tab.id, tab]]), artifactLeases: new Map(),
    closedTurnOwners: new Map(), userCancelledTurnOwners: new Map(), manualCompletionSignals: new Map(), manualTerminalSignals: new Map(),
    logger: { info() {}, warn() {} }, window: { contentView: { removeChildView() {} } },
    syncPowerSaveBlocker() {}, syncViewVisibility() {}, snapshot() { return {}; }, writeDescriptor() {},
    cancelCalls: 0, async cancelTurn() { this.cancelCalls++; },
  });
  const pool = Object.assign(Object.create(AccountBrowserPool.prototype), {
    hosts: new Map([[id, host]]), taskLedgers: new Map([[id, ledger]]), safety,
    unsentAdmissions: new Map([[traceId, { helperPid, id, keys: ['key'], newSessionReservation,
      newSessionRecorded: true, safetyBefore, safetyAfter: safety.entry(id) }]]),
    pendingAffinity: new Map([[traceId, { id, keys: ['key'] }]]), traceOwners: new Map([[traceId, id]]),
    reservations: new Map(), accountOperations: new Map(), authenticationRefreshOperations: new Map(),
    getHost: () => host, publish() {}, recordUsage(fn) { fn(); }, usage: { finish() {} }, logger: host.logger,
  });
  const receipt = { accountId: id, traceId, helperPid, tabId: tab.id, surfaceId: tab.surfaceId, taskRecordId };
  pool.bindUnsentAdmissionOwner(receipt);
  host.onTurnTabRemoved = value => pool.settleRemovedUnsentAdmission(value);
  return { home, host, pool, tab, ledger, safety, traceId, helperPid, receipt };
}

test('exact close before end and expiry without end settle durable not-sent reservations once', async t => {
  for (const action of ['close', 'expiry']) {
    const f = fixture(t);
    let refunds = 0;
    const rollback = f.safety.rollbackUnsentAdmission.bind(f.safety);
    f.safety.rollbackUnsentAdmission = (...args) => { refunds++; return rollback(...args); };
    if (action === 'close') await f.pool.closeTab(f.tab.id, f.traceId);
    else await f.host.reapExpiredTurnTabs(Date.now());
    assert.equal(f.host.cancelCalls, 1);
    assert.equal(f.tab.closed, true);
    assert.equal(f.ledger.get(f.tab.taskRecordId).phase, 'cancelled');
    assert.equal(new BrowserTaskLedger(f.ledger.file).get(f.tab.taskRecordId).submission, 'not-sent');
    assert.equal(f.pool.unsentAdmissions.size, 0);
    assert.equal(f.pool.pendingAffinity.size, 0);
    assert.equal(new AccountSafety(f.home).snapshot('default').newSessionWindow.used, 0);
    assert.deepEqual(f.pool.canMutateAccountSession({ accountId: 'default' }), { allowed: true });
    if (action === 'close') await f.pool.endTurn(f.traceId, f.helperPid, 'aborted');
    f.host.removeTurnTab(f.tab, true);
    assert.equal(f.pool.settleRemovedUnsentAdmission(f.receipt), false);
    assert.equal(refunds, 1);
  }
});

test('failed cancellation, non-not-sent evidence and mismatched identity never refund', async t => {
  const failed = fixture(t);
  failed.host.cancelTurn = async () => { throw new Error('cancel refused'); };
  await assert.rejects(failed.pool.closeTab(failed.tab.id), /cancel refused/);
  assert.equal(failed.host.turnTabs.get(failed.tab.id), failed.tab);
  assert.equal(failed.ledger.get(failed.tab.taskRecordId).terminal, false);
  assert.equal(failed.safety.snapshot('default').newSessionWindow.used, 1);
  for (const phase of ['unknown', 'sending', 'context-accepted', 'accepted']) {
    const f = fixture(t, phase);
    await f.pool.closeTab(f.tab.id);
    assert.equal(f.tab.closed, true);
    assert.equal(f.safety.snapshot('default').newSessionWindow.used, 1);
  }
  const mismatch = fixture(t);
  mismatch.pool.unsentAdmissions.get(mismatch.traceId).taskOwner = { ...mismatch.receipt, taskRecordId: 'different' };
  await mismatch.pool.closeTab(mismatch.tab.id);
  assert.equal(mismatch.safety.snapshot('default').newSessionWindow.used, 1);
});

test('rollback persistence failure retains exact recovery ownership and retries at matching end', async t => {
  const f = fixture(t);
  const save = f.safety.save.bind(f.safety);
  let failedWrites = 0;
  f.safety.save = () => {
    assert.equal(f.tab.closed, true);
    assert.equal(f.ledger.get(f.tab.taskRecordId).terminal, true);
    failedWrites++;
    throw new Error('injected safety persistence failure');
  };
  await f.pool.closeTab(f.tab.id);
  assert.equal(failedWrites, 1);
  assert.deepEqual(f.pool.unsentAdmissions.get(f.traceId).removedOwner, f.receipt);
  assert.equal(f.pool.pendingAffinity.size, 1);
  assert.equal(new AccountSafety(f.home).snapshot('default').newSessionWindow.used, 1);
  f.safety.save = save;
  await f.pool.endTurn(f.traceId, f.helperPid, 'aborted');
  assert.equal(f.pool.unsentAdmissions.size, 0);
  assert.equal(new AccountSafety(f.home).snapshot('default').newSessionWindow.used, 0);
});

test('queue release requires exact removal receipt, and ledger failure precedes any refund', t => {
  const missing = fixture(t);
  missing.host.turnTabs.delete(missing.tab.id);
  assert.equal(missing.pool.releaseUnsentAdmission(missing), false);
  assert.equal(missing.safety.snapshot('default').newSessionWindow.used, 1);
  const f = fixture(t);
  const save = f.ledger.save.bind(f.ledger);
  let writes = 0;
  f.ledger.save = () => { writes++; throw new Error('terminal ledger save failed'); };
  assert.throws(() => f.pool.releaseUnsentAdmission(f), /terminal ledger save failed/);
  assert.equal(writes, 1);
  assert.equal(f.host.turnTabs.get(f.tab.id), f.tab);
  assert.equal(f.safety.snapshot('default').newSessionWindow.used, 1);
  f.ledger.save = save;
  assert.equal(f.pool.releaseUnsentAdmission(f), true);
  assert.equal(f.tab.closed, true);
  assert.equal(f.pool.unsentAdmissions.size, 0);
  assert.equal(new AccountSafety(f.home).snapshot('default').newSessionWindow.used, 0);
});
