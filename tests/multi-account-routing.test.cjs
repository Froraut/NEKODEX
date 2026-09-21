const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const filename = path.resolve(__dirname, '../launcher/electron/account-pool.cjs');
const localRequire = createRequire(filename);
const moduleStub = { exports: {} };
vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: moduleStub, exports: moduleStub.exports,
  require: name => name === './browser-host.cjs' ? { BrowserHost: class {} } : localRequire(name), process, console });
const { AccountBrowserPool } = moduleStub.exports;
const { createAccountRegistry } = localRequire('./account-registry.cjs');
const { AccountSafety, DEFAULT_POLICY } = localRequire('./account-safety.cjs');

function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'account-routing-'));
  const registry = createAccountRegistry(home);
  const second = registry.add('Second').selectedId;
  registry.setMode('balanced');
  const hosts = new Map(['default', second].map(id => [id, {
    accountId: id, state: { authenticated: true }, turnTabs: new Map(),
    closedTurnOwners: new Map(), userCancelledTurnOwners: new Map(),
    manualCompletionSignals: new Map(), manualTerminalSignals: new Map(),
    currentOperation: () => null, ready: async () => {},
    exactRetainedTurnTab: () => null,
    evictOldestReclaimableTurnTab() {
      const tab = [...this.turnTabs.values()].find(tab => tab.status === 'ready');
      if (!tab) return false; this.turnTabs.delete(tab.id); return true;
    },
    async beginTurn(trace, _reveal, pid, key) {
      this.turnTabs.set(trace, { id: trace, traceId: trace, status: 'running', helperPid: pid, conversationKey: key });
      if (this.gate) await this.gate;
      return { surfaceId: trace };
    },
    beginManualTurn(trace, pid) {
      if (!this.turnTabs.has(trace)) this.turnTabs.set(trace, { id: trace, traceId: trace, helperPid: pid, status: 'running' });
      return { surfaceId: trace };
    },
    endManualTurn(trace, pid) {
      this.turnTabs.delete(trace); this.manualCompletionSignals.set(trace, { helperPid: pid }); return { ok: true };
    },
  }]));
  const pool = Object.assign(Object.create(AccountBrowserPool.prototype), { registry, hosts,
    safety: new AccountSafety(home),
    accountOperations: new Map(), accountReadOperations: new Map(),
    options: { maxTabs: 2 }, reservations: new Map(), pendingAffinity: new Map(), traceOwners: new Map(), affinity: new Map(),
    affinityPath: path.join(home, 'affinity.json'), lastAssigned: new Map(), sequence: 0,
    capabilities: new Map([...hosts.keys()].map(id => [id, { solAvailable: true }])), connectors: new Map(),
    evidenceEpochs: new Map(),
    writeDescriptor() {}, publish() {}, syncVisibility() {} });
  return { pool, home, second, cleanup: () => fs.rmSync(home, { recursive: true, force: true }) };
}

test('balanced admission skips local holds but preserves pinned and selected ownership', () => {
  const { pool, second, cleanup } = fixture();
  try {
    pool.safety.fail('default', 'rate_limit_exceeded');
    assert.equal(pool.chooseAccount('cooldown-test', undefined, false, { effort: 'medium' }), second);
    pool.safety.fail(second, 'account_safety_stop');
    assert.throws(() => pool.chooseAccount('all-waiting', undefined, false, { effort: 'medium' }),
      error => error.code === 'account_cooldown' && error.workStarted === false && error.blockers.length === 2);
    const key = 'b'.repeat(64);
    pool.affinity.set(key, 'default');
    assert.equal(pool.chooseAccount('pinned-test', key, false, { effort: 'medium' }), 'default');
    pool.registry.setMode('selected'); pool.registry.select('default');
    assert.equal(pool.chooseAccount('selected-test', undefined, false, { effort: 'medium' }), 'default');
    assert.throws(() => pool.safety.admit('default', 0), error => error.code === 'account_cooldown');
  } finally { cleanup(); }
});

test('balanced admission skips concurrent and new-session limits before assigning a new owner', () => {
  const { pool, second, cleanup } = fixture();
  try {
    pool.safety.setPolicy('default', { ...DEFAULT_POLICY, enabled: true, minIntervalSec: 0 });
    pool.reservations.set('other-turn', 'default');
    assert.equal(pool.chooseAccount('capacity-test', undefined, false, { effort: 'medium' }), second);
    pool.reservations.clear();
    pool.safety.setPolicy('default', { ...DEFAULT_POLICY, newSessionWindow: { limit: 1, minutes: 60 } });
    pool.safety.admit('default', 0, { createsNewSession: true, sessionId: 'a'.repeat(64) });
    assert.equal(pool.chooseAccount('window-test', undefined, false, { effort: 'medium' }), second);
    assert.equal(pool.traceOwners.size, 0);
    assert.equal(pool.safety.snapshot('default').newSessionWindow.used, 1);
  } finally { cleanup(); }
});

test('availability is read-only and scheduled breaks expire without moving their deadline', () => {
  const { pool, home, cleanup } = fixture();
  try {
    let now = 1_000_000;
    const safety = new AccountSafety(home, () => now);
    safety.setPolicy('default', { ...DEFAULT_POLICY, enabled: true, minIntervalSec: 0, breakAfterMinutes: 1, breakMinutes: 1 });
    safety.admit('default', 0);
    const before = fs.readFileSync(safety.path, 'utf8');
    now += 60_000;
    const blocked = safety.availability('default', 0);
    assert.equal(blocked.reason, 'scheduled-break');
    assert.equal(blocked.retryAt, 1_120_000);
    now += 10_000;
    assert.equal(safety.availability('default', 0).retryAt, blocked.retryAt);
    assert.equal(fs.readFileSync(safety.path, 'utf8'), before);
    assert.throws(() => safety.admit('default', 0), error => error.retryAt === blocked.retryAt);
    now = blocked.retryAt;
    assert.equal(safety.availability('default', 0).eligible, true);
    assert.doesNotThrow(() => safety.admit('default', 0));
    now += 60_000;
    assert.equal(safety.availability('default', 0).reason, 'scheduled-break');
  } finally { cleanup(); }
});

test('mixed-model: disabling an account during readiness prevents a fresh turn', async () => {
  const { pool, cleanup } = fixture();
  pool.registry.setMode('selected');
  pool.registry.select('default');
  const host = pool.hosts.get('default');
  let releaseReady;
  let enteredReady;
  const entered = new Promise(resolve => { enteredReady = resolve; });
  const gate = new Promise(resolve => { releaseReady = resolve; });
  host.ready = async () => { enteredReady(); await gate; };
  const pending = pool.beginTurn('disabled_during_ready', false, 42);
  try {
    await entered;
    pool.registry.setEnabled('default', false);
    releaseReady();
    await assert.rejects(pending, /ready|disabled|enabled|changed|eligible/i);
    assert.equal(host.turnTabs.size, 0);
    assert.equal(pool.reservations.size, 0);
    assert.equal(pool.traceOwners.size, 0);
  } finally {
    releaseReady();
    await pending.catch(() => {});
    cleanup();
  }
});

test('pinned fresh turns reject stale connector evidence without moving affinity', () => {
  const { pool, second, cleanup } = fixture();
  try {
    const key = 'f'.repeat(64);
    pool.affinity.set(key, second);
    pool.connectors.set(second, 'Codex Native3');
    assert.throws(() => pool.chooseAccount('fresh-trace', undefined, false,
      { effort: 'medium', routingKey: key, connector: 'Codex Native4' }), /ready|connector/i);
    assert.equal(pool.affinity.get(key), second);
    assert.equal(pool.hosts.get(second).turnTabs.size, 0);
  } finally { cleanup(); }
});

test('parallel starts count once, respect total capacity, and pin the task account', async () => {
  const { pool, second, home, cleanup } = fixture();
  let release;
  const primary = pool.hosts.get('default');
  primary.gate = new Promise(resolve => { release = resolve; });
  primary.turnTabs.set('retained', { id: 'retained', traceId: 'old', status: 'ready' });
  try {
    const taskKey = 'a'.repeat(64);
    const first = pool.beginTurn('first_trace', false, 1, 'b'.repeat(64), undefined, false, { effort: 'medium', routingKey: taskKey });
    await Promise.resolve(); await Promise.resolve();
    const secondStart = await pool.beginTurn('second_trace', false, 2, 'c'.repeat(64), undefined, false, { effort: 'medium' });
    assert.equal(secondStart.accountId, second);
    assert.equal(pool.turnTabs.size, 2);
    await assert.rejects(pool.beginTurn('third_trace', false, 3), /capacity is full/);
    release(); await first;
    pool.registry.setEnabled('default', false);
    assert.throws(() => pool.chooseAccount('followup_trace', undefined, false,
      { effort: 'medium', routingKey: taskKey }), /ready|connector/i);
    assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'affinity.json'), 'utf8'))[taskKey], 'default');
  } finally { release(); cleanup(); }
});

test('manual retries and completion remain routed to their original account', () => {
  const { pool, second, cleanup } = fixture();
  try {
    pool.registry.select('default');
    pool.beginManualTurn('manual_trace', 42, 'prompt');
    pool.registry.select(second);
    pool.beginManualTurn('manual_trace', 42, 'prompt');
    assert.equal(pool.hosts.get(second).turnTabs.size, 0);
    assert.equal(pool.ownerForTrace('manual_trace').accountId, 'default');
    pool.endManualTurn('manual_trace', 42, 'completed');
    assert.equal(pool.ownerForTrace('manual_trace').accountId, 'default');
    pool.endManualTurn('manual_trace', 42, 'completed');
  } finally { cleanup(); }
});

test('review: failed account readiness preserves retained tabs and releases tentative affinity', async () => {
  const { pool, home, second, cleanup } = fixture();
  try {
    pool.options.maxTabs = 1;
    pool.registry.setMode('selected');
    pool.registry.select('default');
    const first = pool.hosts.get('default');
    first.turnTabs.set('retained', { id: 'retained', traceId: 'previous_trace', status: 'ready' });
    first.ready = async () => { throw new Error('fixture host not ready'); };
    const key = 'd'.repeat(64);
    await assert.rejects(pool.beginTurn('new_trace', false, 1, key, undefined, false, { effort: 'medium' }), /fixture host not ready/);
    assert.equal(first.turnTabs.has('retained'), true);
    assert.equal(pool.affinity.size, 0);
    assert.equal(pool.pendingAffinity.size, 0);
    assert.equal(fs.existsSync(path.join(home, 'affinity.json')), false);
    pool.registry.select(second);
    const lease = await pool.beginTurn('retry_trace', false, 1, key, undefined, false, { effort: 'medium' });
    assert.equal(lease.accountId, second);
    assert.equal(pool.affinity.get(key), second);
  } finally { cleanup(); }
});
