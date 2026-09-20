const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createExternalLinkBroker, externalWebUrl, publicAddress } = require('../electron/external-links.cjs');
const { UsageStore } = require('../electron/usage-store.cjs');

test('external-link broker consumes one visible native gesture and rejects local destinations', async () => {
  const contents = new EventEmitter();
  contents.isDestroyed = () => false;
  const opened = [];
  const broker = createExternalLinkBroker({
    shell: { openExternal: async url => opened.push(url) }, logger: {}, isVisible: () => true,
    lookup: async host => host === 'private.example'
      ? [{ address: '192.168.1.10', family: 4 }]
      : [{ address: '203.0.113.10', family: 4 }],
  });
  broker.register(contents);
  await assert.rejects(broker.open(contents, 'https://example.com/path?private=value'), /gesture/);
  contents.emit('before-mouse-event', {}, { type: 'mouseUp', button: 'left' });
  assert.equal(await broker.open(contents, 'https://example.com/path?private=value'), true);
  assert.deepEqual(opened, ['https://example.com/path?private=value']);
  contents.emit('before-input-event', {}, { type: 'keyDown', key: 'Enter', isAutoRepeat: false });
  await assert.rejects(broker.open(contents, 'https://private.example/'), /private/);
  assert.throws(() => externalWebUrl('http://[::1]/'), /Private/);
  assert.equal(publicAddress('::ffff:c0a8:1'), false);
  assert.equal(externalWebUrl('https://[2606:4700:4700::1111]/').hostname, '[2606:4700:4700::1111]');
  broker.destroy();
});

test('usage v3 migrates legacy attribution and aggregates account durations, failures, runs and zero days', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nekodex-usage-v3-'));
  let now = new Date(2026, 8, 20, 12).getTime();
  const file = path.join(root, 'local-usage.json');
  const day = '2026-09-20';
  const legacyGroup = { effort: 'max', modelVersion: '5.6', mode: 'automatic', accepted: 1, completed: 0, failed: 0, aborted: 0 };
  fs.writeFileSync(file, JSON.stringify({ version: 2, startedAt: new Date(now).toISOString(),
    rows: { [`${day}|max|5.6|automatic`]: { day, ...legacyGroup } }, receipts: {}, lifetime: 1,
    lifetimeGroups: { 'max|5.6|automatic': legacyGroup }, lifetimeUnclassified: 0 }));
  try {
    const store = new UsageStore(root, () => now);
    store.accept('trace-v3-a', 7, 'receipt-v3-a', 'high', '6', 'automatic', 'default',
      { modelVersionSource: 'observed', messageKind: 'task' });
    now += 1_000;
    store.finish('trace-v3-a', 7, 'failed', 'receipt-v3-a', 'timeout');
    store.accept('trace-v3-b', 7, 'receipt-v3-b', 'high', '6', 'automatic', 'default',
      { modelVersionSource: 'observed', messageKind: 'task' });
    now += 3_000;
    store.finish('trace-v3-b', 7, 'completed', 'receipt-v3-b');
    const snapshot = store.snapshot({ days: 1, accountId: null }, [{ id: 'default', label: 'Primary account' }]);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).version, 3);
    assert.deepEqual(snapshot.metrics, { total: 3, messageCount: 3, completed: 1, failed: 1, cancelled: 0,
      unrecorded: 1, knownOutcomeTotal: 2, knownOutcomeCompletionRate: 0.5, observedRunCount: 2,
      runCountCoverage: { observedMessages: 2, totalMessages: 3, complete: false } });
    assert.deepEqual(snapshot.durations, { observedSamples: 2, medianMs: 2_000, p95Ms: 3_000 });
    assert.deepEqual(snapshot.failures, [{ code: 'timeout', count: 1 }]);
    assert.equal(snapshot.calendar.length, 1);
    assert.equal(snapshot.rows.some(row => row.accountId === 'unknown' && row.modelVersionSource === 'unknown'), true);
    assert.equal(snapshot.accounts.some(account => account.id === 'unknown' && account.available === false), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
