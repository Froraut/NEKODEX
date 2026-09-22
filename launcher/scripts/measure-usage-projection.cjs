// Bounded, in-memory comparison against a supplied Git ref; never reads usage history.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const Module = require('node:module');
const path = require('node:path');
const current = require('../electron/usage-report.cjs');
const { emptyGroup, emptyNativeGroup, rowKey, nativeRowKey, classificationKey, nativeGroupKey } = require('../electron/usage-schema.cjs');
const ref = process.argv[2];
if (!ref) throw new Error('Supply the baseline Git ref to compare');
const file = path.resolve(__dirname, '../electron/usage-report.cjs');
const baseline = new Module(file, module);
baseline.filename = file;
baseline.paths = module.paths;
baseline._compile(execFileSync('git', ['show', `${ref}:launcher/electron/usage-report.cjs`], {
  cwd: path.resolve(__dirname, '../..'), encoding: 'utf8', timeout: 5000,
}), file);
const now = new Date(2026, 8, 22, 12).getTime();
const state = { startedAt: new Date(now).toISOString(), rows: {}, receipts: {}, lifetimeGroups: {}, lifetimeUnclassified: 0,
  native: { rows: {}, receipts: {}, lifetimeGroups: {}, lifetime: 10000 } };
const health = { error: null, recovered: false, backupAvailable: true };
for (let i = 0; i < 10000; i++) {
  const durationMs = (i * 7919) % 600000;
  const row = { day: '2026-09-22', ...emptyGroup({ accountId: i % 2 ? 'default' : 'unknown',
    effort: i % 3 ? 'high' : 'max', modelVersion: '6', modelVersionSource: 'observed', mode: 'automatic', messageKind: 'task' }) };
  const key = rowKey(row), saved = state.rows[key] ??= row;
  saved.accepted++; saved.completed++;
  state.receipts[i] = { key, owner: `owner-${i}`, outcome: 'completed', durationMs };
  const native = { day: row.day, ...emptyNativeGroup({ endpoint: 'responses', modelId: `model-${i % 8}`, modelIdSource: 'reported' }) };
  const nativeKey = nativeRowKey(native), nativeSaved = state.native.rows[nativeKey] ??= native;
  nativeSaved.accepted++; nativeSaved.completed++; nativeSaved.unreportedSamples++;
  state.native.receipts[i] = { key: nativeKey, durationMs };
}
state.lifetimeGroups = Object.fromEntries(Object.values(state.rows).map(({ day, ...group }) => [classificationKey(group), group]));
state.native.lifetimeGroups = Object.fromEntries(Object.values(state.native.rows).map(({ day, ...group }) => [nativeGroupKey(group), group]));
const invoke = (version, source) => source === 'web'
  ? version.projectWebUsage(state, { days: 7, accountId: null }, [], now, health)
  : version.projectNativeUsage(state, 7, now, health);
const evidence = { baseline: ref, receiptsPerSource: 10000, samples: 7, sources: {} };
for (const source of ['web', 'native']) {
  assert.deepEqual(invoke(current, source), invoke(baseline.exports, source));
  const times = { before: [], after: [] };
  for (let i = 0; i < 9; i++) {
    for (const [name, version] of i % 2 ? [['after', current], ['before', baseline.exports]] : [['before', baseline.exports], ['after', current]]) {
      const start = performance.now(); invoke(version, source); const elapsed = performance.now() - start;
      if (i >= 2) times[name].push(elapsed);
    }
  }
  evidence.sources[source] = Object.fromEntries(Object.entries(times).map(([name, values]) => [
    name + 'MedianMs', +values.sort((a, b) => a - b)[3].toFixed(3),
  ]));
}
console.log(JSON.stringify(evidence, null, 2));
