const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { BrowserTaskLedger, taskModelForRequirement } = require('../electron/browser-task-ledger.cjs');
const { BrowserHost } = require('../electron/browser-host.cjs');
const { BrowserControlServer } = require('../electron/control-server.cjs');
const { AccountBrowserPool } = require('../electron/account-pool.cjs');

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nekodex-task-ledger-'));
  const file = path.join(directory, 'tasks.json');
  return { file, ledger: new BrowserTaskLedger(file), cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

test('interrupted sending survives restart without becoming a safe-to-retry task', () => {
  const f = fixture();
  try {
    const id = f.ledger.start('trace-one', 'tab-one', 1);
    f.ledger.progress(id, 'sending', 1);
    const recovered = new BrowserTaskLedger(f.file);
    assert.equal(recovered.get(id).phase, 'interrupted');
    assert.equal(recovered.get(id).submission, 'uncertain');
    assert.equal(recovered.get(id).terminal, true);
    assert.throws(() => recovered.progress(id, 'preparing', 2), /no longer active/);
    assert.equal(fs.statSync(f.file).mode & 0o777, 0o600);
    assert.deepEqual(Object.keys(recovered.get(id)).sort(), ['id', 'traceId', 'tabId', 'model', 'createdAt', 'updatedAt', 'phase', 'submission', 'sequence', 'terminal'].sort());
    recovered.dismiss(id);
    assert.equal(new BrowserTaskLedger(f.file).snapshot().length, 0);
  } finally { f.cleanup(); }
});

test('pre-send failure, partial context and accepted response retain distinct outcomes', () => {
  const f = fixture();
  try {
    const before = f.ledger.start('trace-before', 'tab-before', 1);
    f.ledger.end(before, 'failed');
    assert.equal(f.ledger.get(before).phase, 'failed-before-send');
    const partial = f.ledger.start('trace-context', 'tab-context', 1);
    f.ledger.progress(partial, 'sending-context', 1);
    f.ledger.progress(partial, 'context-accepted', 2);
    f.ledger.progress(partial, 'sending-context', 1); // delayed frame cannot roll evidence back
    assert.equal(f.ledger.get(partial).submission, 'context-accepted');
    f.ledger.end(partial, 'failed');
    assert.equal(f.ledger.get(partial).phase, 'failed-after-send');
    const accepted = f.ledger.start('trace-accepted', 'tab-accepted', 1);
    f.ledger.progress(accepted, 'sending', 1);
    f.ledger.progress(accepted, 'accepted', 2);
    assert.throws(() => f.ledger.progress(accepted, 'preparing', 3), /cannot return/);
    f.ledger.end(accepted, 'aborted');
    assert.equal(f.ledger.get(accepted).phase, 'cancelled');
    assert.equal(f.ledger.get(accepted).submission, 'accepted');
    const legacy = f.ledger.start('trace-legacy', 'tab-legacy');
    f.ledger.end(legacy, 'failed');
    assert.equal(f.ledger.get(legacy).phase, 'send-uncertain');
  } finally { f.cleanup(); }
});

test('dismissing completed history preserves the retained conversation', () => {
  const f = fixture();
  try {
    const id = f.ledger.start('trace-complete', 'tab-complete', 1);
    f.ledger.end(id, 'completed');
    const tab = { id: 'tab-complete', taskRecordId: id, status: 'ready' };
    const host = { taskLedger: f.ledger, turnTabs: new Map([[tab.id, tab]]),
      removeTurnTab() { throw new Error('History dismissal must not close a completed continuation'); } };
    const pool = { getHost: () => host, publish() {}, snapshot: () => ({}) };
    AccountBrowserPool.prototype.dismissTask.call(pool, 'default', id);
    assert.equal(f.ledger.get(id), undefined);
    assert.equal(host.turnTabs.get(tab.id), tab);
  } finally { f.cleanup(); }
});

test('authenticated progress binds to exact surface and ambiguous end keeps the inspection tab', async () => {
  const f = fixture();
  const tab = { id: 'tab-control', traceId: 'trace-control', surfaceId: 'a'.repeat(32), helperPid: process.pid,
    status: 'running', interactionMode: 'automatic', view: { webContents: { isDestroyed: () => false, setBackgroundThrottling() {} } } };
  tab.taskRecordId = f.ledger.start(tab.traceId, tab.id, 1);
  const host = Object.assign(Object.create(BrowserHost.prototype), {
    taskLedger: f.ledger, turnTabs: new Map([[tab.id, tab]]), userCancelledTurnOwners: new Map(),
    snapshot() { return {}; }, syncPowerSaveBlocker() {}, writeDescriptor() {}, publishState() {},
    logger: { info() {}, warn() {} },
    removeTurnTab() { throw new Error('Ambiguous document must stay available'); },
  });
  const server = await new BrowserControlServer({ logger: host.logger, getBrowserHost: () => host, getPreferences: () => ({}) }).start();
  const descriptor = server.descriptor();
  const post = body => fetch(`${descriptor.endpoint}/v1/turn/progress`, { method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${descriptor.token}` }, body: JSON.stringify(body) });
  try {
    const body = { traceId: tab.traceId, helperPid: process.pid, surfaceId: tab.surfaceId,
      taskPhase: 'sending', sequence: 1, mutationId: '11111111-1111-4111-8111-111111111111' };
    const wrong = await post({ ...body, surfaceId: 'b'.repeat(32) });
    assert.equal(wrong.status, 400); await wrong.arrayBuffer();
    const first = await post(body); assert.equal(first.status, 200); await first.arrayBuffer();
    const replay = await post(body); assert.equal(replay.status, 200); await replay.arrayBuffer();
    assert.equal(f.ledger.get(tab.taskRecordId).sequence, 1);
    await host.endTurn(tab.traceId, tab.helperPid, 'failed', false, 'Uncertain submission');
    assert.equal(tab.status, 'error');
    assert.equal(host.turnTabs.size, 1);
    assert.equal(host.taskSnapshot()[0].canOpen, true);
    assert.equal(host.taskSnapshot()[0].retrySafe, false);
    assert.equal(host.evictOldestReclaimableTurnTab(), false);
  } finally { await server.close(); f.cleanup(); }
});


test('legacy journal rows retain outcomes and allowlisted model metadata survives progress and restart', () => {
  const f = fixture();
  try {
    const legacyId = f.ledger.start('trace-legacy-model', 'tab-legacy-model', 1);
    f.ledger.end(legacyId, 'failed');
    const legacy = JSON.parse(fs.readFileSync(f.file, 'utf8'));
    delete legacy.records[0].model;
    fs.writeFileSync(f.file, JSON.stringify(legacy));
    const upgraded = new BrowserTaskLedger(f.file);
    assert.equal(upgraded.storageIssue, null);
    assert.equal(upgraded.get(legacyId).model, null);
    assert.equal(upgraded.get(legacyId).phase, 'failed-before-send');
    assert.equal(taskModelForRequirement({ requestedModel: 'https://secret.invalid/prompt' }), null);
    assert.equal(taskModelForRequirement({ requestedModel: 'constructor' }), null);
    assert.equal(taskModelForRequirement({ effort: 'xhigh' }), null);
    assert.equal(taskModelForRequirement({ requestedModel: 'chatgpt-web/think' }), 'chatgpt-web/think');
    const model = taskModelForRequirement({ requestedModel: 'chatgpt-web/extra-high' });
    assert.equal(model, 'chatgpt-web/extra-high');
    const id = upgraded.start('trace-model', 'tab-model', 1, model);
    upgraded.progress(id, 'accepted', 1);
    assert.throws(() => upgraded.start('trace-invalid', 'tab-invalid', 1, 'user prompt'), /Invalid task owner/);
    const recovered = new BrowserTaskLedger(f.file);
    assert.equal(recovered.get(id).model, model);
    assert.equal(recovered.get(id).submission, 'accepted');
    assert.equal(recovered.get(id).phase, 'interrupted');
    assert.equal(recovered.get(legacyId).model, null);
  } finally { f.cleanup(); }
});
