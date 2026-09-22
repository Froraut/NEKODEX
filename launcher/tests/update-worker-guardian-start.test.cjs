const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { installUpdate, prepareTransaction, cleanup, rollback, recover, writeJournal } = require('../electron/update-worker.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nekodex-guardian-start-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'Application');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'installed'), 'original installation', { mode: 0o751 });
  const job = { platform: 'darwin', arch: 'arm64', version: '2.0.0', target, productName: 'NEKODEX',
    tempRoot: path.join(root, 'download'), logPath: path.join(root, 'update-worker.log'),
    runtimeExecutable: __filename, transactionRoot: `${target}.update-recovery`,
    stagedApplication: path.join(root, 'download', 'staged') };
  const calls = [];
  const deps = {
    validate() {},
    copyTree(_source, destination) { fs.mkdirSync(destination); fs.writeFileSync(path.join(destination, 'candidate'), 'new'); },
    registerRecovery() { calls.push('register'); },
    unregisterRecovery() { calls.push('unregister'); },
    spawn() {
      const child = Object.assign(new EventEmitter(), { unref() {}, stdin: { end() {} } });
      queueMicrotask(() => child.emit('error', new Error('guardian EAGAIN')));
      return child;
    },
    launch: async () => { calls.push('relaunch'); assert.equal(fs.readFileSync(path.join(target, 'installed'), 'utf8'), 'original installation'); },
  };
  return { job, deps, calls, root };
}

for (const kind of ['event', 'throw']) {
  test(`guardian ${kind} spawn failure rolls back prepared state and permits retry, relaunching exactly once`, async t => {
    const { job, deps, calls } = fixture(t);
    if (kind === 'throw') deps.spawn = () => { throw new Error('guardian EAGAIN'); };
    const before = fs.statSync(path.join(job.target, 'installed'));
    await assert.rejects(installUpdate(job, deps), /guardian EAGAIN/);
    assert.deepEqual(calls, ['register', 'unregister', 'relaunch']);
    const after = fs.statSync(path.join(job.target, 'installed'));
    assert.equal(after.mode, before.mode);
    assert.equal(after.mtimeMs, before.mtimeMs);
    assert.equal(fs.existsSync(job.transactionRoot), false);
    const retry = prepareTransaction(job, deps);
    assert.equal(retry.phase, 'prepared');
    rollback(retry);
    cleanup(retry, deps);
  });
}

test('cleanup and relaunch failures preserve the journal and all original diagnostics', async t => {
  const { job, deps, calls } = fixture(t);
  deps.unregisterRecovery = () => { throw new Error('registration locked'); };
  deps.launch = async () => { calls.push('relaunch'); throw new Error('launch denied'); };
  await assert.rejects(installUpdate(job, deps), error => {
    assert.ok(error instanceof AggregateError);
    assert.match(error.message, /guardian EAGAIN.*registration locked.*launch denied/);
    return true;
  });
  const saved = JSON.parse(fs.readFileSync(path.join(job.transactionRoot, 'transaction.json')));
  assert.equal(saved.phase, 'rolled-back');
  assert.equal(fs.readFileSync(path.join(job.target, 'installed'), 'utf8'), 'original installation');
  assert.equal(calls.filter(call => call === 'relaunch').length, 1);
});

test('once runTransaction starts its rollback and relaunch remain exclusively owned there', async t => {
  const { job, deps, calls } = fixture(t);
  deps.spawn = () => {
    const child = Object.assign(new EventEmitter(), { unref() {}, stdin: { end() { calls.push('guard-end'); } } });
    queueMicrotask(() => child.emit('spawn'));
    return child;
  };
  deps.runTransaction = async transaction => {
    rollback(transaction);
    await deps.launch();
    cleanup(transaction, deps);
    throw new Error('run failed after compensation');
  };
  await assert.rejects(installUpdate(job, deps), /run failed after compensation/);
  assert.deepEqual(calls, ['register', 'relaunch', 'unregister', 'guard-end']);
});

test('runTransaction pending-stop failure is not bypassed by outer compensation', async t => {
  const { job, deps, calls } = fixture(t);
  deps.spawn = () => {
    const child = Object.assign(new EventEmitter(), { unref() {}, stdin: { end() {} } });
    queueMicrotask(() => child.emit('spawn'));
    return child;
  };
  deps.runTransaction = async () => { throw new Error('rollback remains pending until replacement ownership is proven'); };
  await assert.rejects(installUpdate(job, deps), /rollback remains pending/);
  assert.deepEqual(calls, ['register']);
  assert.equal(fs.existsSync(path.join(job.transactionRoot, 'transaction.json')), true);
});

for (const fault of ['staged-removal', 'terminal-journal', 'unregister']) {
  test(`durable rollback relaunch fence survives ${fault} failure and later recovery`, async t => {
    const { job, deps, calls } = fixture(t);
    const journal = path.join(job.transactionRoot, 'transaction.json');
    const next = path.join(path.dirname(job.target), `.${path.basename(job.target)}.next-${path.basename(job.transactionRoot)}`);
    const originalRm = fs.rmSync;
    const originalRename = fs.renameSync;
    const rmMock = t.mock.method(fs, 'rmSync', (filename, options) => {
      if (fault === 'staged-removal' && filename === next) throw new Error('staged removal locked');
      return originalRm(filename, options);
    });
    const renameMock = t.mock.method(fs, 'renameSync', (source, target) => {
      if (fault === 'terminal-journal' && target === journal
        && JSON.parse(fs.readFileSync(source, 'utf8')).phase === 'rolled-back') {
        throw new Error('terminal journal rename denied');
      }
      return originalRename(source, target);
    });
    if (fault === 'unregister') deps.unregisterRecovery = () => { throw new Error('registration locked'); };
    try {
      await assert.rejects(installUpdate(job, deps), error => {
        assert.match(error.message, /guardian EAGAIN/);
        assert.match(error.message, /staged removal locked|terminal journal rename denied|registration locked/);
        return true;
      });
    } finally { rmMock.mock.restore(); renameMock.mock.restore(); }
    const immediateLaunches = calls.filter(call => call === 'relaunch').length;
    const saved = JSON.parse(fs.readFileSync(journal, 'utf8'));
    assert.equal(saved.phase, fault === 'unregister' ? 'rolled-back' : 'prepared');
    // Simulate the original worker having exited, without terminating any process.
    saved.workerIdentity = null;
    writeJournal(saved);
    await recover(journal, { launch: deps.launch, stopReplacement: async () => {}, unregisterRecovery() {} });
    assert.equal(calls.filter(call => call === 'relaunch').length, 1,
      'immediate compensation and later recovery must share one relaunch');
    assert.equal(immediateLaunches, fault === 'unregister' ? 1 : 0);
    assert.equal(fs.readFileSync(path.join(job.target, 'installed'), 'utf8'), 'original installation');
    assert.equal(fs.existsSync(job.transactionRoot), false);
  });
}
