// Bounded journal lookup comparison, using an isolated valid synthetic journal.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const { BrowserTaskLedger } = require('../electron/browser-task-ledger.cjs');
const ref = process.argv[2];
if (!ref) throw new Error('Supply the baseline Git ref');
const modulePath = path.resolve(__dirname, '../electron/browser-task-ledger.cjs');
const baseline = new Module(modulePath, module);
baseline.filename = modulePath; baseline.paths = module.paths;
baseline._compile(execFileSync('git', ['show', `${ref}:launcher/electron/browser-task-ledger.cjs`], {
  cwd: path.resolve(__dirname, '../..'), encoding: 'utf8', timeout: 5000,
}), modulePath);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nekodex-task-lookup-'));
try {
  const file = path.join(directory, 'tasks.json');
  const records = Array.from({ length: 2048 }, (_, i) => ({ id: i.toString(16).padStart(32, '0'),
    traceId: `trace-${i}`, tabId: `tab-task-${i}`, createdAt: i, updatedAt: i, phase: 'completed',
    submission: 'accepted', sequence: 1, terminal: true, model: null }));
  fs.writeFileSync(file, JSON.stringify({ version: 1, records }));
  const before = new baseline.exports.BrowserTaskLedger(file), after = new BrowserTaskLedger(file);
  assert.equal(before.storageIssue, null); assert.equal(after.storageIssue, null);
  assert.equal(before.snapshot().length, records.length);
  assert.deepEqual(after.snapshot(), before.snapshot());
  for (const record of records) assert.deepEqual(after.get(record.id), before.get(record.id));
  const times = { before: [], after: [] }, lookups = 8192;
  for (let sample = 0; sample < 9; sample++) {
    for (const [name, ledger] of sample % 2 ? [['after', after], ['before', before]] : [['before', before], ['after', after]]) {
      const start = performance.now(); let sum = 0;
      for (let i = 0; i < lookups; i++) sum += ledger.get(records[i % records.length].id).createdAt;
      const elapsed = performance.now() - start;
      assert.equal(sum, 8384512);
      if (sample >= 2) times[name].push(elapsed);
    }
  }
  console.log(JSON.stringify({ baseline: ref, records: records.length, lookups, samples: 7,
    ...Object.fromEntries(Object.entries(times).map(([key, values]) => [key + 'MedianMs', +values.sort((a, b) => a - b)[3].toFixed(3)])) }, null, 2));
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
