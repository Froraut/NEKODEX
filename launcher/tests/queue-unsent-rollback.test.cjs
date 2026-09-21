const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AccountBrowserPool } = require('../electron/account-pool.cjs');
const { createAccountRegistry } = require('../electron/account-registry.cjs');
const { AccountSafety, DEFAULT_POLICY } = require('../electron/account-safety.cjs');
const { BrowserTaskLedger } = require('../electron/browser-task-ledger.cjs');
const { BrowserAdmissionQueue } = require('../electron/browser-admission-queue.cjs');

test('unsent rollback preserves a newer provider cooldown', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nekodex-rollback-cooldown-'));
  try {
    const safety = new AccountSafety(root, () => 1000000);
    safety.setPolicy('default', { ...DEFAULT_POLICY, newSessionWindow: { limit: 1, minutes: 60 } });
    const before = safety.entry('default');
    const id = 'f'.repeat(64);
    safety.admit('default', 0, { createsNewSession: true, sessionId: id });
    const after = safety.entry('default');
    safety.fail('default', 'rate_limit_exceeded');
    const until = safety.snapshot('default').cooldownUntil;
    safety.rollbackUnsentAdmission('default', id, before, after);
    assert.equal(safety.snapshot('default').cooldownUntil, until);
    assert.equal(safety.snapshot('default').newSessionWindow.used, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

for (const scenario of ['cancel', 'close', 'reused']) test(`${scenario}: unsent acquisition restores allowance and leaves no false affinity`, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nekodex-unsent-rollback-'));
  let entered; const created = new Promise(resolve => { entered = resolve; });
  let release; const held = new Promise(resolve => { release = resolve; });
  const safety = new AccountSafety(root);
  safety.setPolicy('default', { ...DEFAULT_POLICY, enabled: true, newSessionWindow: { limit: 1, minutes: 60 } });
  const ledger = new BrowserTaskLedger(path.join(root, 'tasks.json'));
  const tabs = new Map();
  const host = { accountId: 'default', state: { authenticated: true }, taskLedger: ledger, turnTabs: tabs,
    ready: async () => {}, currentOperation: () => null, exactRetainedTurnTab: () => null, assertLiveConversationOwner() {},
    async beginTurn(traceId, _reveal, helperPid, conversationKey) {
      const taskRecordId = ledger.start(traceId, 'tab-rollback', 1);
      tabs.set('tab-rollback', { id: 'tab-rollback', traceId, helperPid, taskRecordId, conversationKey,
        status: 'running', interactionMode: 'automatic', surfaceId: 'a'.repeat(32) });
      entered(); await held;
      return { tabId: 'tab-rollback', surfaceId: 'a'.repeat(32), reused: scenario === 'reused', connectorBound: false };
    },
    removeTurnTab(tab) { ledger.end(tab.taskRecordId, 'aborted'); tabs.delete(tab.id); },
  };
  const pool = Object.assign(Object.create(AccountBrowserPool.prototype), {
    registry: createAccountRegistry(root), safety, hosts: new Map([['default', host]]), options: { maxTabs: 2 },
    taskLedgers: new Map([['default', ledger]]), unsentAdmissions: new Map(), reservations: new Map(), pendingAffinity: new Map(),
    traceOwners: new Map(), lastAssigned: new Map(), sequence: 0, selectionRevision: 0, affinity: new Map(),
    affinityPath: path.join(root, 'affinity.json'), capabilities: new Map([['default', { solAvailable: true }]]),
    connectors: new Map(), evidenceEpochs: new Map(), accountOperations: new Map(), accountReadOperations: new Map(),
    turnAdmission: { open: true, reason: null }, turnAdmissionRevision: 0,
    writeDescriptor() {}, publish() {}, logger: { warn() {} },
  });
  const queue = new BrowserAdmissionQueue({ file: path.join(root, 'queue.json'), autoPump: false,
    inspect: req => pool.previewAdmission(req), leaseCurrent: (req, lease) => pool.admissionLeaseCurrent(req, lease),
    releaseUnsent: req => pool.releaseUnsentAdmission(req),
    dispatch: (req, signal) => pool.beginTurn(req.traceId, false, req.helperPid, req.key, undefined, false,
      { effort: 'medium', taskProgressVersion: 1, deferAffinity: true, admissionSignal: signal }),
  });
  pool.admissionQueue = queue;
  try {
    const req = { traceId: 'trace-rollback', helperPid: process.pid, reveal: false, key: 'a'.repeat(64), connector: null,
      retained: false, effort: 'medium', routingKey: null, taskProgressVersion: 1, requestedAccountId: 'default' };
    queue.request(req); await created;
    assert.equal(safety.snapshot('default').newSessionWindow.used, 1);
    const row = queue.snapshot().entries[0]; assert.equal(row.canCancel, true);
    if (scenario === 'close') queue.close(); else await queue.action(row.id, 'cancel');
    release(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(queue.snapshot().entries[0].status, 'cancelled');
    assert.equal(safety.snapshot('default').newSessionWindow.used, 0);
    assert.equal(safety.entry('default').lastStart, 0);
    assert.equal(pool.affinity.size, 0); assert.equal(pool.pendingAffinity.size, 0);
    assert.equal(pool.unsentAdmissions.size, 0); assert.equal(tabs.size, 0);
  } finally { release(); queue.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
