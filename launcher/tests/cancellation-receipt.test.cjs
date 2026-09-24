const test = require('node:test');
const assert = require('node:assert/strict');
const { RuntimeHost } = require('../electron/runtime.cjs');

const host = receipt => ({ assertProductionProfile() {}, async run() { return { stdout: JSON.stringify(receipt) }; } });

test('cancellation returns separate acknowledged counts and does not invent missing compaction evidence', async () => {
  assert.deepEqual(await RuntimeHost.prototype.cancelActiveTurns.call(host({
    cancelledHttpTurns: 3, cancelledBrowserTurns: 3, cancelledCompactionRuns: 1,
  })), { cancelled: false, cancelledHttpTurns: 3, cancelledBrowserTurns: 3, cancelledCompactionRuns: 1 });
  const legacy = await RuntimeHost.prototype.cancelActiveTurns.call(host({ cancelledHttpTurns: 0, cancelledBrowserTurns: 0 }));
  assert.equal(legacy.cancelledCompactionRuns, null);
});

test('missing or malformed cancellation receipt is not reported as success', async () => {
  for (const receipt of [{}, { cancelledHttpTurns: -1, cancelledBrowserTurns: 0 }, { cancelledHttpTurns: 0, cancelledBrowserTurns: '1' }]) {
    await assert.rejects(RuntimeHost.prototype.cancelActiveTurns.call(host(receipt)), /acknowledgement/);
  }
});
