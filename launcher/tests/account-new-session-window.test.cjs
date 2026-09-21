const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  AccountSafety,
  DEFAULT_POLICY,
  NEW_SESSION_WINDOW_LIMIT_RANGE,
  NEW_SESSION_WINDOW_MINUTES_RANGE,
  validatePolicy,
} = require('../electron/account-safety.cjs');
const { AccountBrowserPool, newWebSessionReservationId } = require('../electron/account-pool.cjs');

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nekodex-new-session-window-'));
  try { return run(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

async function asyncFixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nekodex-new-session-window-pool-'));
  try { return await run(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function policy(newSessionWindow = null) {
  return { ...DEFAULT_POLICY, newSessionWindow };
}

function poolFixture(root, { limit, failBeforeCreateTrace } = {}) {
  const safety = new AccountSafety(root, () => 7_000_000);
  safety.setPolicy('default', policy({ limit, minutes: 60 }));
  const tabs = new Map();
  let created = 0;
  let reused = 0;
  let alternateStarts = 0;
  const connector = 'Codex Native fixture';
  const exactRetained = key => [...tabs.values()].find(tab => tab.status === 'ready'
    && tab.conversationKey === key && tab.connectorIdentity === connector);
  const host = {
    turnTabs: tabs,
    ready: async () => {},
    exactRetainedTurnTab: (key, candidateConnector) => candidateConnector === connector
      ? exactRetained(key) : undefined,
    precheckRetainedTurn(_traceId, key, candidateConnector) {
      if (candidateConnector !== connector || !exactRetained(key)) {
        const error = new Error('The retained ChatGPT conversation is no longer available');
        error.code = 'retained_conversation_unavailable';
        throw error;
      }
    },
    assertLiveConversationOwner() {},
    async beginTurn(traceId, _reveal, helperPid, key, candidateConnector, requireRetained) {
      const sameTrace = [...tabs.values()].find(tab => tab.traceId === traceId && tab.status === 'running');
      const retained = candidateConnector === connector ? exactRetained(key) : undefined;
      const existing = sameTrace ?? retained;
      if (existing) {
        const wasRetained = existing.status === 'ready';
        existing.traceId = traceId;
        existing.helperPid = helperPid;
        existing.status = 'running';
        if (wasRetained) reused++;
        return { tabId: existing.id, surfaceId: existing.surfaceId, reused: wasRetained,
          connectorBound: existing.connectorBound };
      }
      if (requireRetained) throw new Error('retained fixture precheck failed');
      const tab = { id: `tab-${++created}`, surfaceId: `surface-${created}`, traceId, helperPid,
        status: 'running', interactionMode: 'automatic', conversationKey: key,
        connectorIdentity: candidateConnector, connectorBound: false };
      tabs.set(tab.id, tab);
      return { tabId: tab.id, surfaceId: tab.surfaceId, reused: false, connectorBound: false };
    },
  };
  const alternateHost = { turnTabs: new Map(), async beginTurn() { alternateStarts++; } };
  const selected = [];
  const alternateId = '11111111-1111-1111-1111-111111111111';
  const pool = Object.assign(Object.create(AccountBrowserPool.prototype), {
    options: { maxTabs: 8 },
    reservations: new Map(), pendingAffinity: new Map(), traceOwners: new Map(),
    lastAssigned: new Map(), sequence: 0, selectionRevision: 0, affinity: new Map(),
    turnAdmission: { open: true, reason: null }, turnAdmissionRevision: 0,
    safety, logger: { warn() {} },
    registry: {
      snapshot: () => ({ selectedId: 'default', mode: 'selected', accounts: [
        { id: 'default', enabled: true }, { id: alternateId, enabled: true },
      ] }),
      select() {},
    },
    assertTurnAdmission: () => 0,
    evidenceEpoch: () => 0,
    chooseAccount() { selected.push('default'); return 'default'; },
    getHost: id => id === 'default' ? host : alternateHost,
    accountOperationLabel: () => null,
    ensureTabCapacity(_candidateHost, traceId) {
      if (traceId === failBeforeCreateTrace) throw new Error('fixture pre-creation failure');
    },
    persistAffinity() {}, writeDescriptor() {}, publish() {}, syncVisibility() {},
  });
  Object.defineProperty(pool, 'turnTabs', {
    configurable: true,
    get: () => new Map([...host.turnTabs, ...alternateHost.turnTabs]),
  });
  return { pool, safety, host, connector, selected,
    created: () => created, reused: () => reused, alternateStarts: () => alternateStarts };
}

test('legacy account safety policy remains valid with the new-session window disabled', () => fixture(root => {
  const legacy = { ...DEFAULT_POLICY };
  delete legacy.newSessionWindow;
  fs.writeFileSync(path.join(root, 'account-safety.json'), `${JSON.stringify({
    version: 1,
    accounts: { default: { policy: legacy, lastStart: 0, sessionStart: 0,
      breakStart: 0, cooldownUntil: 0, stopped: false } },
  })}\n`);

  const safety = new AccountSafety(root, () => 1_000);
  const snapshot = safety.snapshot('default');
  assert.equal(snapshot.policy.newSessionWindow, null);
  assert.equal(snapshot.newSessionWindow, null);
  assert.equal(snapshot.policy.enabled, false);
}));

test('persisted account safety timestamps stay within the JavaScript Date domain', () => fixture(root => {
  const saved = timestamp => fs.writeFileSync(path.join(root, 'account-safety.json'), `${JSON.stringify({
    version: 1,
    accounts: { default: { policy: DEFAULT_POLICY, lastStart: timestamp, sessionStart: 0,
      breakStart: 0, cooldownUntil: 0, stopped: false } },
  })}\n`);

  saved(8_640_000_000_000_000);
  assert.doesNotThrow(() => new AccountSafety(root, () => 1_000));
  saved(1.5);
  assert.doesNotThrow(() => new AccountSafety(root, () => 1_000));
  saved(8_640_000_000_000_001);
  assert.throws(() => new AccountSafety(root, () => 1_000), /Invalid account safety timestamp/);
}));

test('opt-in window counts only new Web sessions and lets existing sessions continue', () => fixture(root => {
  let now = 1_000_000;
  const safety = new AccountSafety(root, () => now);
  safety.setPolicy('default', policy({ limit: 2, minutes: 60 }));
  const policySnapshot = safety.snapshot('default').policy;
  policySnapshot.newSessionWindow.limit = 999;
  assert.equal(safety.snapshot('default').policy.newSessionWindow.limit, 2);

  assert.deepEqual(safety.admit('default', 0, {
    createsNewSession: true,
    sessionId: 'a'.repeat(64),
  }), { newSessionRecorded: true });
  now += 30 * 60_000;
  assert.deepEqual(safety.admit('default', 0, {
    createsNewSession: true,
    sessionId: 'b'.repeat(64),
  }), { newSessionRecorded: true });

  assert.doesNotThrow(() => safety.admit('default', 0, { createsNewSession: false }));
  assert.deepEqual(safety.snapshot('default').newSessionWindow, {
    used: 2,
    remaining: 0,
    limit: 2,
    windowMinutes: 60,
    resetsAt: 1_000_000 + 60 * 60_000,
  });
  assert.throws(() => safety.admit('default', 0, {
    createsNewSession: true,
    sessionId: 'c'.repeat(64),
  }), error => error.code === 'account_cooldown'
    && error.retryAt === 1_000_000 + 60 * 60_000
    && error.message.includes('Existing sessions may continue'));

  now = 1_000_000 + 60 * 60_000 + 1;
  assert.equal(safety.snapshot('default').newSessionWindow.used, 1);
  assert.deepEqual(safety.admit('default', 0, {
    createsNewSession: true,
    sessionId: 'c'.repeat(64),
  }), { newSessionRecorded: true });
}));

test('failed pre-creation reservation rolls back without storing the raw trace id', () => fixture(root => {
  const safety = new AccountSafety(root, () => 2_000_000);
  safety.setPolicy('default', policy({ limit: 1, minutes: 120 }));
  const traceId = 'trace_private_123';
  const reservation = newWebSessionReservationId('default', traceId, 'test-reservation');
  assert.match(reservation, /^[a-f0-9]{64}$/);
  assert.notEqual(reservation, newWebSessionReservationId('default', traceId, 'another-reservation'));

  assert.equal(safety.admit('default', 0, {
    createsNewSession: true,
    sessionId: reservation,
  }).newSessionRecorded, true);
  assert.equal(fs.readFileSync(path.join(root, 'account-safety.json'), 'utf8').includes(traceId), false);
  assert.equal(safety.rollbackNewSession('default', reservation), true);
  assert.equal(safety.snapshot('default').newSessionWindow.used, 0);
}));

test('existing-session window exception does not bypass provider cooldown or account stop', () => fixture(root => {
  let now = 2_500_000;
  const safety = new AccountSafety(root, () => now);
  safety.setPolicy('default', policy({ limit: 1, minutes: 120 }));
  safety.admit('default', 0, { createsNewSession: true, sessionId: '1'.repeat(64) });

  safety.fail('default', 'rate_limit_exceeded');
  assert.throws(() => safety.admit('default', 0, { createsNewSession: false }), error => (
    error.code === 'account_cooldown' && error.message.includes('cooling down')
  ));
  now += DEFAULT_POLICY.cooldownMinutes * 60_000 + 1;
  safety.fail('default', 'account_safety_stop');
  assert.throws(() => safety.admit('default', 0, { createsNewSession: false }), error => (
    error.code === 'account_cooldown' && error.message.includes('paused')
  ));
}));

test('snapshot projects expired sessions without mutating persisted safety state', () => fixture(root => {
  let now = 3_000_000;
  const safety = new AccountSafety(root, () => now);
  safety.setPolicy('default', policy({ limit: 1, minutes: 1 }));
  safety.admit('default', 0, { createsNewSession: true, sessionId: 'd'.repeat(64) });
  const statePath = path.join(root, 'account-safety.json');
  const before = fs.readFileSync(statePath, 'utf8');

  now += 60_001;
  assert.equal(safety.snapshot('default').newSessionWindow.used, 0);
  assert.equal(fs.readFileSync(statePath, 'utf8'), before);
}));

test('expired-window pruning cannot undo a session hard-stop mutation', () => fixture(root => {
  let now = 4_000_000;
  const safety = new AccountSafety(root, () => now);
  safety.setPolicy('default', {
    ...policy({ limit: 1, minutes: 1 }),
    enabled: true,
    minIntervalSec: 0,
    maxSessionMinutes: 1,
    breakAfterMinutes: 240,
  });
  safety.admit('default', 0, { createsNewSession: true, sessionId: 'e'.repeat(64) });

  now += 60_001;
  assert.equal(safety.snapshot('default').newSessionWindow.used, 0);
  assert.throws(() => safety.admit('default', 0, { createsNewSession: false }), /session time limit/);
  const stored = JSON.parse(fs.readFileSync(path.join(root, 'account-safety.json'), 'utf8')).accounts.default;
  assert.equal(stored.stopped, true);
  assert.equal(stored.newSessionUsages, undefined);
}));

test('expired-window pruning preserves a fixed scheduled break across restart', () => fixture(root => {
  let now = 5_000_000;
  const safety = new AccountSafety(root, () => now);
  safety.setPolicy('default', {
    ...policy({ limit: 1, minutes: 1 }),
    enabled: true,
    minIntervalSec: 0,
    maxSessionMinutes: 1440,
    breakAfterMinutes: 1,
    breakMinutes: 5,
  });
  safety.admit('default', 0, { createsNewSession: true, sessionId: 'f'.repeat(64) });

  now += 60_001;
  const fixedEnd = 5_000_000 + 60_000 + 5 * 60_000;
  assert.equal(safety.snapshot('default').newSessionWindow.used, 0);
  assert.throws(() => safety.admit('default', 0, { createsNewSession: false }), /Scheduled account break/);
  const stored = JSON.parse(fs.readFileSync(path.join(root, 'account-safety.json'), 'utf8')).accounts.default;
  assert.equal(stored.cooldownUntil, fixedEnd);
  assert.equal(stored.breakStart, fixedEnd);
  assert.equal(stored.newSessionUsages, undefined);
  const restarted = new AccountSafety(root, () => now);
  now = fixedEnd - 1;
  assert.throws(() => restarted.admit('default', 0, { createsNewSession: false }), error => error.retryAt === fixedEnd);
  now = fixedEnd;
  assert.doesNotThrow(() => restarted.admit('default', 0, { createsNewSession: false }));
}));

test('new-session window is nullable and bounded only by technical validation ranges', () => {
  assert.equal(validatePolicy(policy()).newSessionWindow, null);
  assert.deepEqual(validatePolicy(policy({
    limit: NEW_SESSION_WINDOW_LIMIT_RANGE[0],
    minutes: NEW_SESSION_WINDOW_MINUTES_RANGE[1],
  })).newSessionWindow, {
    limit: NEW_SESSION_WINDOW_LIMIT_RANGE[0],
    minutes: NEW_SESSION_WINDOW_MINUTES_RANGE[1],
  });
  assert.throws(() => validatePolicy(policy({ limit: 0, minutes: 60 })), /window limit/);
  assert.throws(() => validatePolicy(policy({ limit: 1, minutes: 0 })), /window minutes/);
});

test('pool wiring admits retained reuse, rejects new creation at the window, and rolls back failed acquisition', () => (
  asyncFixture(async root => {
    const full = poolFixture(path.join(root, 'full'), { limit: 1 });
    const retainedKey = 'a'.repeat(64);
    const newKey = 'b'.repeat(64);
    const first = await full.pool.beginTurn(
      'trace_first', false, 11, retainedKey, full.connector, false, { effort: 'high' },
    );
    assert.equal(first.reused, false);
    assert.equal(full.created(), 1);
    const retainedTab = full.host.turnTabs.get(first.tabId);
    retainedTab.status = 'ready';

    const continued = await full.pool.beginTurn(
      'trace_retained', false, 12, retainedKey, full.connector, true, { effort: 'high' },
    );
    assert.equal(continued.reused, true);
    assert.equal(full.reused(), 1);
    assert.equal(full.created(), 1);
    await assert.rejects(() => full.pool.beginTurn(
      'trace_blocked', false, 13, newKey, full.connector, false, { effort: 'high' },
    ), error => error.code === 'account_cooldown' && error.message.includes('Existing sessions may continue'));
    assert.equal(full.created(), 1);
    assert.equal(full.alternateStarts(), 0);
    assert.equal(full.pool.reservations.has('trace_blocked'), false);
    assert.equal(full.pool.pendingAffinity.has('trace_blocked'), false);
    assert.equal(full.pool.traceOwners.has('trace_blocked'), false);
    assert.deepEqual(new Set(full.selected), new Set(['default']));

    const failed = poolFixture(path.join(root, 'failed'), {
      limit: 1,
      failBeforeCreateTrace: 'trace_failed',
    });
    await assert.rejects(() => failed.pool.beginTurn(
      'trace_failed', false, 21, 'c'.repeat(64), failed.connector, false, { effort: 'high' },
    ), /fixture pre-creation failure/);
    assert.equal(failed.safety.snapshot('default').newSessionWindow.used, 0);
    assert.equal(failed.pool.reservations.size, 0);
    assert.equal(failed.pool.pendingAffinity.size, 0);
    assert.equal(failed.pool.traceOwners.has('trace_failed'), false);
    assert.equal(failed.alternateStarts(), 0);
    assert.deepEqual(new Set(failed.selected), new Set(['default']));

    const afterFailure = await failed.pool.beginTurn(
      'trace_after', false, 22, 'd'.repeat(64), failed.connector, false, { effort: 'high' },
    );
    assert.equal(afterFailure.reused, false);
    assert.equal(failed.created(), 1);
    assert.equal(failed.safety.snapshot('default').newSessionWindow.used, 1);
  })
));
