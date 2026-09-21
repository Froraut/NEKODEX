const test = require('node:test');
const assert = require('node:assert/strict');
const { AccountBrowserPool } = require('../electron/account-pool.cjs');

function fixture() {
  const account = { id: 'default', label: 'Primary', enabled: true };
  const registry = {
    state: { selectedId: 'default', mode: 'selected', accounts: [account] },
    snapshot() { return this.state; },
  };
  let resolveRetry;
  const retry = new Promise(resolve => { resolveRetry = resolve; });
  const host = {
    accountId: 'default', activeTraceId: null, authIdentityEpoch: 7,
    state: { authenticated: false, authenticationStatus: 'unavailable',
      authenticationCheckedAt: '2026-09-21T10:00:00.000Z', lastVerifiedAt: '2026-09-20T10:00:00.000Z',
      accountLabel: 'known@example.test' },
    turnTabs: new Map(), currentOperation: () => null, browserInteractionMode: () => 'automatic',
    connectorName: () => 'Tools',
    retryCalls: 0, retryAuthenticationCheck() { this.retryCalls++; return retry; },
    cancelReadOnlyInspection() {},
    destroy() {},
  };
  const pool = Object.assign(Object.create(AccountBrowserPool.prototype), {
    registry, hosts: new Map([['default', host]]), reservations: new Map(), accountOperations: new Map(),
    accountReadOperations: new Map(), authenticationRefreshOperations: new Map(), networkOperation: null,
    loginOperation: null, inspectionsPaused: false, destroyed: false,
    existingChromeImportLease: null, options: {},
    capabilities: new Map([['default', { solAvailable: true }]]), connectors: new Map([['default', 'Tools']]),
    evidenceEpochs: new Map([['default', 3]]),
    network: { get: () => ({ mode: 'system' }) },
    safety: { snapshot: () => ({ policy: { enabled: false }, cooldownUntil: 0, stopped: false, newSessionWindow: null }) },
    publishCalls: 0, publish() { this.publishCalls++; },
  });
  return { pool, host, resolveRetry };
}

test('account snapshot retains historical identity while projecting unavailable verification', () => {
  const { pool } = fixture();
  assert.deepEqual(pool.accountSnapshot().accounts[0], {
    id: 'default', label: 'Primary', enabled: true,
    proxy: { mode: 'system' }, safety: { policy: { enabled: false }, cooldownUntil: 0, stopped: false, newSessionWindow: null },
    authenticated: false, authenticationStatus: 'unavailable',
    authenticationCheckedAt: '2026-09-21T10:00:00.000Z', lastVerifiedAt: '2026-09-20T10:00:00.000Z',
    accountLabel: 'known@example.test', evidenceEpoch: 3, activeTurns: 0, checked: true, connectorReady: true,
  });
});

test('authentication retry joins ownership, clears routing evidence, and never selects or logs in', async () => {
  const { pool, host, resolveRetry } = fixture();
  const selectedBefore = pool.registry.snapshot().selectedId;
  const first = pool.refreshAccountAuthentication('default');
  const second = pool.refreshAccountAuthentication('default');
  assert.equal(first, second);
  assert.equal(host.retryCalls, 1);
  assert.equal(pool.capabilities.has('default'), false);
  assert.equal(pool.connectors.has('default'), false);
  assert.equal(pool.accountReadOperationLabel('default'), 'ChatGPT session verification retry');
  host.state = { ...host.state, authenticated: true, authenticationStatus: 'verified',
    authenticationCheckedAt: '2026-09-21T11:00:00.000Z', lastVerifiedAt: '2026-09-21T11:00:00.000Z' };
  resolveRetry(host.state);
  const snapshot = await first;
  assert.equal(snapshot.accounts[0].authenticationStatus, 'verified');
  assert.equal(snapshot.accounts[0].checked, false);
  assert.equal(pool.registry.snapshot().selectedId, selectedBefore);
  assert.equal(pool.accountReadOperationLabel('default'), null);
});

test('active work rejects retry before evidence or ownership changes', async () => {
  const { pool, host } = fixture();
  host.activeTraceId = 'active_trace';
  await assert.rejects(pool.refreshAccountAuthentication('default'), /active or acquiring tasks/);
  assert.equal(host.retryCalls, 0);
  assert.equal(pool.capabilities.has('default'), true);
  assert.equal(pool.connectors.has('default'), true);
  assert.equal(pool.accountReadOperationLabel('default'), null);
});

test('retry rejects publication when another readiness epoch supersedes it', async () => {
  const { pool, host, resolveRetry } = fixture();
  const pending = pool.refreshAccountAuthentication('default');
  pool.invalidateEvidence('default');
  resolveRetry(host.state);
  await assert.rejects(pending, /readiness changed/);
  assert.equal(pool.accountReadOperationLabel('default'), null);
});

test('a retry after pool destruction rejects instead of joining an unsettled old operation', async () => {
  const { pool, host, resolveRetry } = fixture();
  const original = pool.refreshAccountAuthentication('default');
  const originalRejection = assert.rejects(original, /account changed/);
  assert.equal(host.retryCalls, 1);
  pool.destroy();
  await assert.rejects(pool.refreshAccountAuthentication('default'), /pool is closed/);
  assert.equal(host.retryCalls, 1);
  resolveRetry(host.state);
  await originalRejection;
});
