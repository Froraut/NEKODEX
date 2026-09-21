const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCodexAccountTools } = require('../electron/codex-account-tools.cjs');

const IDS = [
  'default',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000004',
  '00000000-0000-4000-8000-000000000005',
];

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function quota(accountId, freshness = 'fresh', extra = {}) {
  return {
    availability: 'available', coverage: 'reported_buckets', freshness,
    freshUntil: new Date(Date.now() + 60_000).toISOString(), refreshError: null,
    accountId, fetchedAt: new Date(0).toISOString(), planType: null,
    accountBucket: {}, additionalBuckets: [], additionalBucketsTruncated: false,
    ...extra,
  };
}

function fixture({ accounts, read, snapshot = () => null }) {
  const epochs = new Map(accounts.map(account => [account.id, 1]));
  const principals = new Map(accounts.map(account => [account.id, `principal-${account.id}`]));
  const hosts = new Map(accounts.map(account => [account.id, {
    ready: async () => {},
    view: { webContents: { isDestroyed: () => false, session: { fetch() {} } } },
  }]));
  let acquired = 0;
  let released = 0;
  const pool = {
    hosts,
    accountSnapshot: () => ({ accounts: accounts.map(account => ({ enabled: true, checked: true,
      connectorReady: true, evidenceEpoch: epochs.get(account.id), ...account })) }),
    evidenceEpoch: id => epochs.get(id),
    accountIdentityLease: id => ({ accountId: id, identityEpoch: epochs.get(id), principalFingerprint: principals.get(id) }),
    acquireAccountReadOperation: () => { acquired++; return () => { released++; }; },
    getHost: id => hosts.get(id),
  };
  const controller = { selectionLock: () => null, status() {}, destroy: async () => {} };
  const cleared = [];
  const tools = createCodexAccountTools({
    getPool: () => pool,
    BrowserWindow: class {}, clipboard: { writeText() {} }, codexHome: '/tmp',
    quotaReader: { read, snapshot, clear: id => cleared.push(id) },
    createController: () => controller,
  });
  return { tools, pool, epochs, principals, counts: () => ({ acquired, released }), cleared };
}

test('quota portfolio preserves account order, caps concurrency at three and resolves partial results', async () => {
  const accounts = IDS.map((id, index) => ({ id, label: `Account ${index + 1}`, authenticated: index !== 4 }));
  let active = 0;
  let maximum = 0;
  const calls = [];
  const retrySnapshot = quota(IDS[5], 'stale', {
    retryAt: new Date(Date.now() + 60_000).toISOString(), refreshError: 'rate_limited',
  });
  const { tools, counts } = fixture({
    accounts,
    snapshot: (_session, id) => id === IDS[5] ? retrySnapshot : null,
    read: async (_session, id) => {
      calls.push(id);
      active++;
      maximum = Math.max(maximum, active);
      await new Promise(resolve => setImmediate(resolve));
      active--;
      if (id === IDS[2]) throw new Error('private provider detail');
      return quota(id);
    },
  });

  const result = await tools.refreshQuotaPortfolio();
  assert.deepEqual(result.rows.map(row => row.accountId), IDS);
  assert.equal(maximum, 3);
  assert.deepEqual(result.rows.map(row => row.status),
    ['updated', 'updated', 'unavailable', 'updated', 'skipped', 'skipped']);
  assert.equal(result.rows[2].reason, 'refresh_failed');
  assert.equal(result.rows[4].reason, 'signed_out');
  assert.equal(result.rows[5].reason, 'rate_limited');
  assert.equal(result.rows[5].snapshot.freshness, 'stale');
  assert.equal(calls.includes(IDS[4]), false);
  assert.equal(calls.includes(IDS[5]), false);
  assert.deepEqual(counts(), { acquired: 4, released: 4 });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.rows), true);
  assert.equal(Object.isFrozen(result.rows[0]), true);
  assert.equal(Object.isFrozen(result.rows[0].snapshot), true);
});

test('batch and per-account quota refreshes share one in-flight read and one batch promise', async () => {
  const gate = deferred();
  let reads = 0;
  const { tools, counts } = fixture({
    accounts: [{ id: 'default', label: 'Primary', authenticated: true }],
    read: async () => { reads++; return gate.promise; },
  });

  const firstBatch = tools.refreshQuotaPortfolio();
  const secondBatch = tools.refreshQuotaPortfolio();
  const single = tools.refreshQuota('default');
  assert.equal(firstBatch, secondBatch);
  await Promise.resolve();
  assert.equal(reads, 1);
  assert.deepEqual(counts(), { acquired: 1, released: 0 });

  const value = quota('default');
  gate.resolve(value);
  assert.equal(await single, value);
  const result = await firstBatch;
  assert.deepEqual(result.rows[0].snapshot, value);
  assert.notEqual(result.rows[0].snapshot, value);
  assert.equal(Object.isFrozen(value), false);
  assert.deepEqual(counts(), { acquired: 1, released: 1 });
});

test('identity changes discard a completed read and become a partial skipped row', async () => {
  const gate = deferred();
  const { tools, epochs, cleared, counts } = fixture({
    accounts: [{ id: 'default', label: 'Primary', authenticated: true }],
    read: async () => gate.promise,
  });

  const pending = tools.refreshQuotaPortfolio();
  await Promise.resolve();
  epochs.set('default', 2);
  gate.resolve(quota('default'));
  const result = await pending;
  assert.deepEqual({ status: result.rows[0].status, reason: result.rows[0].reason },
    { status: 'skipped', reason: 'identity_changed' });
  assert.equal(result.rows[0].evidenceEpoch, 1);
  assert.deepEqual(cleared, ['default']);
  assert.deepEqual(counts(), { acquired: 1, released: 1 });
});

test('a queued account whose evidence changes is skipped before acquiring a read lease', async () => {
  const accounts = IDS.slice(0, 4).map((id, index) => ({ id, label: `Account ${index + 1}`, authenticated: true }));
  const gates = new Map(accounts.slice(0, 3).map(account => [account.id, deferred()]));
  const calls = [];
  const { tools, epochs, counts } = fixture({
    accounts,
    read: async (_session, id) => { calls.push(id); return gates.get(id).promise; },
  });

  const pending = tools.refreshQuotaPortfolio();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, IDS.slice(0, 3));
  epochs.set(IDS[3], 2);
  gates.get(IDS[0]).resolve(quota(IDS[0]));
  await new Promise(resolve => setImmediate(resolve));
  gates.get(IDS[1]).resolve(quota(IDS[1]));
  gates.get(IDS[2]).resolve(quota(IDS[2]));

  const result = await pending;
  assert.equal(calls.includes(IDS[3]), false);
  assert.deepEqual({ status: result.rows[3].status, reason: result.rows[3].reason, evidenceEpoch: result.rows[3].evidenceEpoch },
    { status: 'skipped', reason: 'identity_changed', evidenceEpoch: 1 });
  assert.deepEqual(counts(), { acquired: 3, released: 3 });
});

test('a new account generation never joins the previous generation in-flight refresh', async () => {
  const first = deferred();
  const second = deferred();
  let reads = 0;
  const { tools, epochs, principals } = fixture({
    accounts: [{ id: 'default', label: 'Primary', authenticated: true }],
    read: async () => (++reads === 1 ? first.promise : second.promise),
  });

  const oldGeneration = tools.refreshQuota('default');
  await Promise.resolve();
  epochs.set('default', 2);
  principals.set('default', 'replacement-principal');
  const newGeneration = tools.refreshQuota('default');
  assert.notEqual(oldGeneration, newGeneration);
  await Promise.resolve();
  assert.equal(reads, 2);

  first.resolve(quota('default'));
  second.resolve(quota('default'));
  await assert.rejects(oldGeneration, /account changed/);
  assert.equal((await newGeneration).availability, 'available');
});
