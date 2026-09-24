const test = require('node:test');
const assert = require('node:assert/strict');
const { BrowserHost } = require('../electron/browser-host.cjs');
const { AccountBrowserPool } = require('../electron/account-pool.cjs');
const { createSnapshotPublisher } = require('../electron/browser-state-publication.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('pooled host bursts publish one latest snapshot while authentication invalidation stays immediate', async () => {
  let hostReads = 0, poolReads = 0;
  const sent = [], invalidated = [];
  const host = Object.assign(Object.create(BrowserHost.prototype), {
    state: { authenticated: true }, snapshot() { hostReads++; return this.state; },
  });
  const pool = Object.assign(Object.create(AccountBrowserPool.prototype), {
    hosts: new Map([['default', host]]), creatingHosts: new Set(), destroyed: false,
    publishedAuthentication: new Map([['default', true]]), observationSourceId: 'test-pool', observationRevision: 0,
    options: { publishState: value => sent.push(value) },
    invalidateEvidence: id => invalidated.push(id), logger: { warn() { assert.fail('unexpected publication failure'); } },
    snapshot() { poolReads++; return { title: host.state.title, observation: this.observationStamp() }; },
  });
  host.requestStatePublication = () => pool.publish();
  for (let i = 0; i < 100; i++) host.setState({ title: String(i), authenticated: i !== 50 });
  assert.deepEqual(invalidated, ['default']);
  assert.equal(hostReads, 0); assert.equal(poolReads, 0);
  await tick();
  assert.equal(poolReads, 1);
  assert.deepEqual(sent, [{ title: '99', observation: { sourceId: 'test-pool', revision: 100 } }]);
  host.setState({ title: 'pending' }); pool.destroyed = true; pool.snapshotPublisher.dispose();
  await tick(); assert.equal(sent.length, 1); assert.equal(poolReads, 1);
});
test('standalone host delivery remains immediate; a failed deferred projection does not wedge later updates', async () => {
  const sent = [], failures = [];
  const host = Object.assign(Object.create(BrowserHost.prototype), {
    state: {}, snapshot() { return { ...this.state }; }, publishState: value => sent.push(value),
  });
  host.setState({ title: 'standalone' }); assert.equal(sent[0].title, 'standalone');
  let broken = true;
  const publisher = createSnapshotPublisher({ available: () => true,
    read: () => { if (broken) throw new Error('projection boundary'); return { title: 'recovered' }; },
    send: value => sent.push(value), onError: error => failures.push(error.message) });
  publisher.request(); await tick(); assert.deepEqual(failures, ['projection boundary']);
  broken = false; publisher.request(); await tick(); assert.equal(sent.at(-1).title, 'recovered');
  publisher.dispose(); publisher.request(); await tick(); assert.equal(sent.length, 2);
});
test('account availability counts active work and reservations from one reservation traversal', () => {
  const active = new Map([['one', { status: 'running' }], ['two', { status: 'ready' }]]);
  let traversals = 0;
  const reservations = new Map([['a', 'default'], ['b', 'default'], ['c', 'other']]);
  const values = reservations.values.bind(reservations);
  reservations.values = () => { traversals++; return values(); };
  const counts = [];
  const pool = Object.assign(Object.create(AccountBrowserPool.prototype), {
    observationSourceId: 'test-pool', observationRevision: 3, reservations,
    registry: { snapshot: () => ({ selectedId: 'default', accounts: [{ id: 'default' }, { id: 'other' }] }) },
    hosts: new Map([['default', { state: { authenticated: true }, turnTabs: active, connectorName: () => 'Tools' }]]),
    capabilities: new Map(), connectors: new Map(), evidenceEpoch: () => 0,
    network: { get: () => ({ mode: 'system' }) }, safety: { snapshot: () => ({}),
      availability: (id, count) => { counts.push([id, count]); return { available: count === 0 }; } },
  });
  const value = pool.accountSnapshot();
  assert.equal(traversals, 1); assert.deepEqual(counts, [['default', 3], ['other', 1]]);
  assert.equal(value.accounts[0].activeTurns, 1); assert.equal(value.accounts[1].activeTurns, 0);
  assert.deepEqual(value.observation, { sourceId: 'test-pool', revision: 3 });
});
