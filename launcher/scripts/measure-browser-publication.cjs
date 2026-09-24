// Compare actual host/pool publication methods on an inert four-account fixture.
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const { BrowserHost } = require('../electron/browser-host.cjs');
const { AccountBrowserPool } = require('../electron/account-pool.cjs');
const ref = process.argv[2];
if (!ref) throw new Error('Supply the baseline Git ref');
function baseline(name) {
  const file = path.resolve(__dirname, '../electron', name);
  const loaded = new Module(file, module); loaded.filename = file; loaded.paths = module.paths;
  loaded._compile(execFileSync('git', ['show', `${ref}:launcher/electron/${name}`], {
    cwd: path.resolve(__dirname, '../..'), encoding: 'utf8', timeout: 5000,
  }), file);
  return loaded.exports;
}
async function measure(Host, Pool) {
  const counts = { hostSnapshots: 0, poolSnapshots: 0, publications: 0, serializedBytes: 0 };
  let last;
  const accounts = Array.from({ length: 4 }, (_, i) => ({ id: i ? `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` : 'default', label: `Account ${i}` }));
  const hosts = new Map(), ledgers = new Map();
  const pool = Object.assign(Object.create(Pool.prototype), {
    observationSourceId: 'performance-pool', observationRevision: 0,
    registry: { snapshot: () => ({ selectedId: 'default', accounts }) },
    hosts, taskLedgers: ledgers, creatingHosts: new Set(), publishedAuthentication: new Map(), destroyed: false,
    options: { maxTabs: 16, publishState(state) {
      counts.publications++; const text = JSON.stringify(state); counts.serializedBytes += Buffer.byteLength(text); last = JSON.parse(text);
    } },
    logger: { warn(_event, detail) { throw new Error(JSON.stringify(detail)); } },
  });
  const snapshot = Pool.prototype.snapshot;
  pool.snapshot = function () { counts.poolSnapshots++; return snapshot.call(this); };
  for (const account of accounts) {
    const records = Array.from({ length: 128 }, (_, i) => ({ id: `record-${i}`, traceId: `trace-${i}`, tabId: `tab-${i}`,
      createdAt: i, updatedAt: i, phase: 'completed', submission: 'accepted', sequence: 1, terminal: true, model: 'chatgpt-web/high' }));
    const host = Object.assign(Object.create(Host.prototype), {
      state: { authenticated: true, title: account.label, status: 'ready' }, visible: false, surfaceActive: false,
      selectedTabId: 'home', turnTabs: new Map(),
      snapshot() { counts.hostSnapshots++; return { ...this.state, tabs: [{ id: 'home', title: 'Home' }, ...this.turnTabSnapshots()] }; },
      taskSnapshot: () => records.map(record => ({ ...record, canOpen: false, canCancel: false, canDismiss: true, retrySafe: false })),
      publishState: () => pool.publish(), requestStatePublication: () => pool.publish(),
    });
    hosts.set(account.id, host); ledgers.set(account.id, { snapshot: () => records.map(record => ({ ...record })) });
    pool.publishedAuthentication.set(account.id, true);
  }
  try {
    for (let burst = 0; burst < 4; burst++) {
      for (let event = 0; event < 16; event++) hosts.get(accounts[event % 4].id).setState({ title: `Update ${burst * 16 + event}` });
      await new Promise(resolve => setImmediate(resolve));
    }
    delete last.observation;
    return { counts, last };
  } finally { pool.snapshotPublisher?.dispose(); }
}
(async () => {
  const before = await measure(baseline('browser-host.cjs').BrowserHost, baseline('account-pool.cjs').AccountBrowserPool);
  const after = await measure(BrowserHost, AccountBrowserPool);
  assert.deepEqual(after.last, before.last);
  assert.equal(after.last.tasks.length, 512);
  console.log(JSON.stringify({ baseline: ref, accounts: 4, tasks: 512, bursts: 4, eventsPerBurst: 16,
    sameFinalSnapshot: true, before: before.counts, after: after.counts }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
