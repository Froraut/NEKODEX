const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { UsageStore } = require('../electron/usage-store.cjs');

function assertEmptyPeriod(snapshot) {
  assert.equal(snapshot.available, true);
  assert.equal(snapshot.metrics.total, 0);
  assert.equal(snapshot.rows.length, 0);
  assert.equal(snapshot.durations.observedSamples, 0);
  assert.deepEqual(snapshot.failures, []);
  assert.deepEqual(snapshot.diagnosticGroups, []);
  assert.equal(snapshot.calendar.reduce((sum, day) => sum + day.total, 0), 0);
  assert.equal(snapshot.lifetime, 1);
  assert.equal(snapshot.lifetimeGroups[0].accepted, 1);
}

test('native accepted cross-midnight receipt stays retained but outside the current period', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nekodex-usage-period-'));
  let now = new Date(2026, 8, 22, 23, 59, 45).getTime();
  try {
    let store = new UsageStore(root, () => now);
    assert.deepEqual(store.recordNative({
      schemaVersion: 1, eventId: '00000000-0000-4000-8000-000000000001',
      source: 'native', endpoint: 'responses', requestedModelId: 'gpt-6', reportedModelId: null,
      startedAt: new Date(now + 29_000).toISOString(), durationMs: 1000,
      outcome: 'completed', httpStatus: 200, failureCategory: null, usageStatus: 'reported',
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    }), { recorded: true });
    // Reload actual persisted receipts before exercising the reporting boundary.
    store = new UsageStore(root, () => now);
    assert.equal(Object.keys(store.state.native.receipts).length, 1);
    const saved = fs.readFileSync(store.path, 'utf8');
    const current = store.snapshot({ source: 'native', days: 1 });
    assertEmptyPeriod(current);
    assert.equal(current.tokens.reportedSamples, 0);
    assert.equal(current.tokens.totalTokens, null);
    assert.equal(fs.readFileSync(store.path, 'utf8'), saved);
    now += 30_000;
    const next = store.snapshot({ source: 'native', days: 1 });
    assert.equal(next.rows[0].day, next.period.endDay);
    assert.equal(next.metrics.total, 1);
    assert.equal(next.calendar[0].total, 1);
    assert.equal(next.durations.observedSamples, 1);
    assert.equal(next.diagnosticGroups[0].accepted, 1);
    assert.equal(next.tokens.totalTokens, 30);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('web clock rollback excludes later rows and receipts while preserving lifetime history', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nekodex-usage-period-'));
  let now = new Date(2026, 8, 23, 12).getTime();
  try {
    let store = new UsageStore(root, () => now);
    store.accept('test-trace', 7, 'test-receipt', 'high', '6', 'automatic', 'default');
    now += 1000;
    store.finish('test-trace', 7, 'failed', 'test-receipt', 'tool_timeout');
    store = new UsageStore(root, () => now);
    const query = { source: 'web', days: 7, accountId: 'default' };
    assert.equal(store.snapshot(query).metrics.failed, 1);
    const saved = fs.readFileSync(store.path, 'utf8');
    now -= 86_400_000;
    const current = store.snapshot(query);
    assertEmptyPeriod(current);
    assert.equal(current.metrics.runCountCoverage.observedMessages, 0);
    assert.equal(fs.readFileSync(store.path, 'utf8'), saved);
    now += 86_400_000;
    const restored = store.snapshot(query);
    assert.equal(restored.rows[0].day, restored.period.endDay);
    assert.equal(restored.metrics.failed, 1);
    assert.deepEqual(restored.failures, [{ code: 'timeout', count: 1 }]);
    assert.equal(restored.durations.observedSamples, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
