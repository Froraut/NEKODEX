const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { UsageStore } = require('../electron/usage-store.cjs');

function temporaryStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nekodex-usage-groups-'));
  let now = new Date(2026, 8, 21, 12).getTime();
  return { root, store: new UsageStore(root, () => now), advance(ms) { now += ms; }, now: () => now };
}

test('web diagnostic groups reconcile mixed outcomes, partial receipts and account filters', () => {
  const fixture = temporaryStore();
  try {
    const metadata = { modelVersionSource: 'observed', messageKind: 'task' };
    fixture.store.accept('old-private-trace', 6, 'old-private-receipt', 'max', '5.5', 'automatic', 'default', metadata);
    fixture.advance(100);
    fixture.store.finish('old-private-trace', 6, 'completed', 'old-private-receipt');
    fixture.advance(2 * 86_400_000);
    for (const [receipt, outcome, failure, duration] of [
      ['private-receipt-a', 'completed', undefined, 1_000],
      ['private-receipt-b', 'failed', 'tool_timeout', 2_000],
      ['private-receipt-c', 'aborted', undefined, 3_000],
      ['private-receipt-d', 'failed', undefined, 4_000],
      ['private-receipt-e', 'failed', 'browser_failure', 5_000],
    ]) {
      fixture.store.accept(`private-trace-${receipt}`, 7, receipt, 'high', '6', 'automatic', 'default', metadata);
      fixture.advance(duration);
      fixture.store.finish(`private-trace-${receipt}`, 7, outcome, receipt, failure);
    }
    fixture.store.accept('other-private-trace', 8, 'other-private-receipt', 'low', '5.6', 'manual', 'unknown', metadata);
    fixture.advance(500);
    fixture.store.finish('other-private-trace', 8, 'completed', 'other-private-receipt');

    const failedReceipt = Object.entries(fixture.store.state.receipts)
      .find(([, receipt]) => receipt.failureCode === 'browser_failure')[0];
    delete fixture.store.state.receipts[failedReceipt];
    const snapshot = fixture.store.snapshot({ days: 1, source: 'web', accountId: 'default' },
      [{ id: 'default', label: 'Primary' }]);
    assert.equal(snapshot.diagnosticGroups.length, 1);
    assert.deepEqual(snapshot.diagnosticGroups[0], {
      source: 'web', accountId: 'default', effort: 'high', modelVersion: '6', modelVersionSource: 'observed',
      mode: 'automatic', messageKind: 'task', accepted: 5, completed: 1, failed: 3, cancelled: 1,
      knownOutcomeTotal: 5, knownOutcomeCompletionRate: 1 / 5,
      durations: { observedSamples: 4, eligibleSamples: 5, medianMs: 2_500, p95Ms: 4_000 },
      failures: [{ code: 'unknown', count: 2 }, { code: 'timeout', count: 1 }], classifiedFailureSamples: 1,
    });
    const serialized = JSON.stringify(snapshot.diagnosticGroups);
    assert.doesNotMatch(serialized, /private-trace|private-receipt/);
    assert.equal(serialized.includes('unknown'), true);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test('native diagnostic groups use period rows, receipt coverage and normalized failure aggregates', () => {
  const fixture = temporaryStore();
  try {
    const sample = (eventId, outcome, durationMs, httpStatus, failureCategory) => ({
      schemaVersion: 1, eventId, source: 'native', endpoint: 'responses', requestedModelId: 'gpt-6',
      reportedModelId: 'gpt-6', startedAt: new Date(fixture.now() - durationMs).toISOString(), durationMs,
      outcome, httpStatus, failureCategory, usageStatus: 'unreported', usage: null,
    });
    fixture.store.recordNative(sample('00000000-0000-4000-8000-000000000001', 'completed', 100, 200, null));
    fixture.store.recordNative(sample('00000000-0000-4000-8000-000000000002', 'failed', 300, 429, 'http-rate-limit'));
    fixture.store.recordNative(sample('00000000-0000-4000-8000-000000000003', 'aborted', 200, 0, 'aborted'));
    delete fixture.store.state.native.receipts[Object.keys(fixture.store.state.native.receipts)[0]];

    const snapshot = fixture.store.snapshot({ days: 1, source: 'native', accountId: null });
    assert.equal(snapshot.diagnosticGroups.length, 1);
    const group = snapshot.diagnosticGroups[0];
    assert.deepEqual({ source: group.source, endpoint: group.endpoint, modelId: group.modelId,
      modelIdSource: group.modelIdSource, accepted: group.accepted, completed: group.completed,
      incomplete: group.incomplete, failed: group.failed, cancelled: group.cancelled },
    { source: 'native', endpoint: 'responses', modelId: 'gpt-6', modelIdSource: 'reported',
      accepted: 3, completed: 1, incomplete: 0, failed: 1, cancelled: 1 });
    assert.deepEqual(group.durations, { observedSamples: 2, eligibleSamples: 3, medianMs: 250, p95Ms: 300 });
    assert.deepEqual(group.failures, [{ code: 'aborted', count: 1 }, { code: 'http-rate-limit', count: 1 }]);
    assert.equal(group.classifiedFailureSamples, group.failed + group.cancelled);
    assert.throws(() => fixture.store.snapshot({ days: 1, source: 'native', accountId: 'default' }),
      /does not support ChatGPT account filtering/);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});
