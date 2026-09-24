const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { BrowserTaskLedger } = require('../electron/browser-task-ledger.cjs');

test('task lookup follows durable revisions and preserves the old index when writing fails', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nekodex-ledger-index-'));
  try {
    const file = path.join(directory, 'tasks.json');
    const ledger = new BrowserTaskLedger(file);
    const id = ledger.start('trace-index', 'tab-index', 1);
    ledger.progress(id, 'sending', 1);
    const saved = fs.readFileSync(file, 'utf8'), record = ledger.get(id);
    const blocked = path.join(directory, 'blocked'); fs.mkdirSync(blocked);
    ledger.file = blocked;
    assert.throws(() => ledger.progress(id, 'accepted', 2));
    assert.equal(ledger.get(id), record);
    assert.equal(ledger.get(id).phase, 'sending');
    assert.equal(fs.readFileSync(file, 'utf8'), saved);
    ledger.file = file;
    ledger.progress(id, 'accepted', 2);
    assert.equal(ledger.get(id).submission, 'accepted');
    const recovered = new BrowserTaskLedger(file);
    assert.equal(recovered.get(id).phase, 'interrupted');
    assert.equal(recovered.get(id).submission, 'accepted');
    recovered.dismiss(id);
    assert.equal(recovered.get(id), undefined);
    assert.deepEqual(new BrowserTaskLedger(file).snapshot(), []);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
