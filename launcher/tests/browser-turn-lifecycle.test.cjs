const test = require('node:test');
const assert = require('node:assert/strict');
const { BrowserTurnLifecycle } = require('../electron/browser-turn-lifecycle.cjs');

function fixture() {
  const effects = [];
  const tab = { id: 'tab', traceId: 'trace', helperPid: 17, surfaceId: 'surface',
    taskRecordId: 'record', status: 'running', interactionMode: 'automatic',
    bootstrapReady: true, lastHeartbeatAt: 0,
    view: { webContents: { isDestroyed: () => false } } };
  const tabs = new Map([[tab.id, tab]]);
  const context = { accountId: 'account', ledger: {
    get: () => ({ terminal: false }), end: () => effects.push('ledger'),
  } };
  const lifecycle = new BrowserTurnLifecycle({ tabs, context,
    closedOwners: new Map(), cancelledOwners: new Map(), lastSweepAt: 60_000,
    views: { dispose: () => { assert.equal(tabs.has(tab.id), false); effects.push('view'); } },
    manual: { dispose: () => effects.push('manual') },
    artifacts: { release: () => { assert.equal(tabs.get(tab.id), tab); effects.push('downloads'); } },
    presentation: { syncPowerSaveBlocker() {}, afterRemoval() {}, syncViewVisibility() {},
      snapshot: () => ({}), publishState() {}, writeDescriptor() {} },
    events: { removed: receipt => effects.push(receipt) },
    logger: { warn() {}, info() {} },
  });
  return { lifecycle, tab, tabs, context, effects };
}

test('failed terminal ledger write preserves exact owner; retry emits one receipt after disposal', () => {
  const { lifecycle, tab, tabs, context, effects } = fixture();
  const failure = new Error('ledger commit failed');
  let attempts = 0;
  context.ledger.end = () => { attempts++; throw failure; };
  assert.throws(() => lifecycle.removeTurnTab(tab, true), error => error === failure);
  assert.equal(attempts, 1, 'terminal ledger boundary reached');
  assert.equal(tabs.get(tab.id), tab);
  assert.deepEqual(effects, []);
  context.ledger.end = () => effects.push('ledger');
  lifecycle.removeTurnTab(tab, true);
  lifecycle.removeTurnTab(tab, true);
  assert.equal(lifecycle.tabs, tabs);
  assert.equal(tabs.size, 0);
  assert.deepEqual(effects, ['ledger', 'downloads', 'manual', 'view', {
    accountId: 'account', traceId: 'trace', helperPid: 17, tabId: 'tab',
    surfaceId: 'surface', taskRecordId: 'record',
  }]);
});

test('expiry cancellation rejection preserves the live owner and does not issue a receipt', async () => {
  const { lifecycle, tab, tabs, context, effects } = fixture();
  let reached = false;
  context.cancelTurn = async (traceId, reason) => {
    reached = true;
    assert.equal(traceId, tab.traceId);
    assert.equal(reason, 'helper_heartbeat_expired');
    throw new Error('runtime refused cancellation');
  };
  await lifecycle.reapExpiredTurnTabs(61_000);
  assert.equal(reached, true);
  assert.equal(tabs.get(tab.id), tab);
  assert.equal(tab.status, 'running');
  assert.equal(tab.expiryCancellation, undefined);
  assert.deepEqual(effects, []);
});

test('late expiry acknowledgement cannot remove a replacement owner', async () => {
  const { lifecycle, tab, tabs, context, effects } = fixture();
  let acknowledge;
  let reached;
  const entered = new Promise(resolve => { reached = resolve; });
  context.cancelTurn = () => new Promise(resolve => { acknowledge = resolve; reached(); });
  const pending = lifecycle.reapExpiredTurnTabs(61_000);
  await entered;
  const replacement = { ...tab, traceId: 'replacement', helperPid: 18 };
  tabs.set(tab.id, replacement);
  acknowledge();
  await pending;
  assert.equal(tabs.get(tab.id), replacement);
  assert.deepEqual(effects, []);
});

test('shutdown disposes Manual waiters and views without terminal writes or removal authority', () => {
  const { lifecycle, tab, tabs, effects } = fixture();
  tab.interactionMode = 'manual';
  tab.prompt = 'private prompt';
  tab.promptDigest = 'digest';
  tab.manualTerminalResolutionSuppressed = true;
  const settlements = [];
  tab.manualWaiters = new Set([result => settlements.push(['submit', result.status])]);
  tab.manualTerminalWaiters = new Set([result => settlements.push(['terminal', result.status])]);
  const { BrowserHost } = require('../electron/browser-host.cjs');
  lifecycle.manual.dispose = (candidate, shutdown) => {
    assert.equal(candidate, tab); assert.equal(shutdown, true); effects.push('manual');
    BrowserHost.prototype.disposeManualTurn.call({}, candidate, shutdown);
  };
  lifecycle.views.dispose = candidate => { assert.equal(candidate, tab); effects.push('view'); };
  lifecycle.disposeForShutdown();
  assert.equal(lifecycle.tabs, tabs);
  assert.equal(tabs.size, 0);
  assert.deepEqual(effects, ['manual', 'view']);
  assert.deepEqual(settlements, [['submit', 'cancelled'], ['terminal', 'cancelled']]);
  assert.equal(tab.prompt, null);
  assert.equal(tab.promptDigest, null);
  assert.equal(tab.manualWaiters.size + tab.manualTerminalWaiters.size, 0);
});

test('automatic allocation and progress retain failed submitted documents for inspection', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { BrowserTaskLedger } = require('../electron/browser-task-ledger.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nekodex-turn-lifecycle-'));
  const { lifecycle, tabs, context, effects } = fixture();
  try {
    tabs.clear();
    context.ledger = new BrowserTaskLedger(path.join(root, 'tasks.json'));
    context.maxTabs = 2;
    context.authIdentityEpoch = 7;
    context.authPrincipalFingerprint = 'a'.repeat(64);
    const view = { webContents: { isDestroyed: () => false, setBackgroundThrottling() {} } };
    lifecycle.views = { idleUrl: 'test:idle', create: () => view,
      attach: tab => { assert.equal(tabs.get(tab.id), tab); effects.push('attach'); },
      initialize: async tab => { assert.equal(tab.view, view); effects.push('initialize'); },
      isTrusted: () => true, dispose: () => effects.push('dispose') };
    lifecycle.events.owned = receipt => effects.push(receipt);
    lifecycle.artifacts.release = () => effects.push('downloads');
    const lease = await lifecycle.beginTurn('trace_created', false, 17, 'conversation', 'connector', false, 1);
    const tab = tabs.get(lease.tabId);
    assert.equal(lifecycle.tabs, tabs);
    assert.equal(tab.initializingSurface, false);
    assert.equal(tab.authIdentityEpoch, 7);
    assert.deepEqual(effects.slice(1), ['attach', 'initialize']);
    assert.deepEqual(effects[0], { accountId: 'account', traceId: 'trace_created', helperPid: 17,
      tabId: tab.id, surfaceId: lease.surfaceId, taskRecordId: tab.taskRecordId });
    assert.throws(() => lifecycle.taskProgress(tab.traceId, 99, tab.surfaceId, 'accepted', 1), /live browser owner/);
    assert.equal(context.ledger.get(tab.taskRecordId).sequence, 0);
    lifecycle.taskProgress(tab.traceId, 17, tab.surfaceId, 'accepted', 1);
    await lifecycle.endTurn(tab.traceId, 17, 'failed', false, 'provider failed');
    assert.equal(tabs.get(tab.id), tab);
    assert.equal(tab.status, 'error');
    assert.equal(context.ledger.get(tab.taskRecordId).submission, 'accepted');
    assert.equal(context.ledger.get(tab.taskRecordId).terminal, true);
    assert.equal(effects.includes('dispose'), false);
    assert.deepEqual(lifecycle.taskSnapshot().map(({ canOpen, canCancel, retrySafe }) =>
      ({ canOpen, canCancel, retrySafe })), [{ canOpen: true, canCancel: false, retrySafe: false }]);
    assert.equal(lifecycle.evictOldestReclaimableTurnTab(), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('aborted tab initialization releases only its own pending browser owner', async () => {
  const { lifecycle, tabs, context, effects } = fixture();
  tabs.clear();
  context.maxTabs = 2;
  context.ledger.start = () => 'new-record';
  lifecycle.artifacts.release = () => effects.push('downloads');
  lifecycle.logger.error = () => {};
  lifecycle.views = {
    idleUrl: 'test:idle',
    create: () => ({ webContents: { isDestroyed: () => false } }),
    attach() {}, initialize: () => new Promise(() => {}),
    dispose: () => effects.push('disposed'),
  };
  const abort = new AbortController();
  const pending = lifecycle.createTurnTab('new-trace', 17, undefined, undefined, 1, null, abort.signal);
  await Promise.resolve();
  assert.equal(tabs.size, 1);
  abort.abort(new DOMException('caller left', 'AbortError'));
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(tabs.size, 0);
  assert.deepEqual(effects.slice(0, 4), ['ledger', 'downloads', 'manual', 'disposed']);
});

test('a disconnected acquisition cannot release a replacement browser owner', () => {
  const { lifecycle, tab, tabs, effects } = fixture();
  const originalSignal = new AbortController().signal;
  tab.acquisitionSignal = originalSignal;
  assert.equal(lifecycle.releaseUnclaimedTurn(tab.traceId, tab.helperPid, tab.surfaceId,
    new AbortController().signal), false);
  assert.equal(tabs.get(tab.id), tab);
  assert.equal(lifecycle.releaseUnclaimedTurn(tab.traceId, tab.helperPid, tab.surfaceId, originalSignal), true);
  assert.equal(tabs.size, 0);
  assert.equal(effects[0], 'ledger');
});
