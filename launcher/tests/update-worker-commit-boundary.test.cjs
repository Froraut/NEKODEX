const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { operation, runTransaction, waitForReadiness, recover, writeJournal } = require('../electron/update-worker.cjs');

// A supported Linux wrapper transaction with real staged inode identity. No
// validator is replaced, and no executable, updater, or recovery agent is started.
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nekodex-commit-boundary-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const wrapper = path.join(directory, 'launcher');
  const root = `${wrapper}.update-recovery`;
  fs.mkdirSync(root, { mode: 0o700 });
  const job = { platform: 'linux', arch: 'x64', version: '2.0.0', wrapper,
    target: path.join(directory, 'versions', 'new', 'app.AppImage'),
    tempRoot: path.join(directory, 'download'), logPath: path.join(directory, 'update-worker.log'),
    runtimeExecutable: __filename, transactionRoot: root, readinessSchema: 2 };
  fs.mkdirSync(job.tempRoot);
  const next = path.join(directory, `.launcher.next-${path.basename(root)}`);
  fs.writeFileSync(wrapper, 'old-wrapper');
  fs.writeFileSync(next, 'new-wrapper');
  const op = operation(wrapper, next, root, 0);
  const stat = fs.lstatSync(next);
  op.stagedIdentity = { dev: stat.dev, ino: stat.ino, type: 'file' };
  const transaction = { schemaVersion: 1, root, job, phase: 'prepared', operations: [op],
    runtime: __filename, readyFile: path.join(root, 'ready.json'), readyToken: 'fixture-token',
    packageTarget: job.target };
  writeJournal(transaction);
  const journal = path.join(root, 'transaction.json');
  const saved = () => JSON.parse(fs.readFileSync(journal, 'utf8'));
  const calls = [];
  let ready = false;
  const deps = {
    async launch(bin) {
      if (bin === wrapper) {
        assert.equal(saved().phase, 'rolled-back');
        assert.equal(fs.readFileSync(wrapper, 'utf8'), 'old-wrapper');
        calls.push('relaunch');
      } else calls.push('launch');
      return { pid: process.pid };
    },
    async waitForReadiness(current) {
      assert.equal(fs.readFileSync(wrapper, 'utf8'), 'new-wrapper');
      assert.equal(fs.readFileSync(op.previous, 'utf8'), 'old-wrapper');
      assert.equal(saved().phase, 'awaiting-readiness');
      assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'launch-authorized.json'))).token, current.readyToken);
      fs.writeFileSync(current.readyFile, JSON.stringify({ token: current.readyToken,
        version: job.version, platform: job.platform, arch: job.arch, packageTarget: job.target,
        pid: process.pid, readinessSchema: 2, lifecycleStatus: 'not-configured', lifecycleRevision: 1 }));
      await waitForReadiness(current, { graceMs: 0, timeoutMs: 1000 });
      ready = true;
    },
    async stopReplacement() {
      assert.equal(saved().phase, 'rollback-pending-stop');
      assert.equal(fs.readFileSync(op.previous, 'utf8'), 'old-wrapper');
      calls.push('stop');
    },
    unregisterRecovery() {
      assert.ok(['committed', 'rolled-back'].includes(saved().phase));
      calls.push('unregister');
    },
  };
  return { transaction, op, journal, saved, deps, calls, reachedReadiness: () => ready };
}

test('commit journal publication failure after real replacement/readiness rolls back before cleanup', async t => {
  const f = fixture(t);
  const rename = fs.renameSync;
  let injected = false;
  const mock = t.mock.method(fs, 'renameSync', (source, target) => {
    if (target === f.journal && JSON.parse(fs.readFileSync(source, 'utf8')).phase === 'committed') {
      assert.equal(f.reachedReadiness(), true);
      assert.equal(fs.readFileSync(f.op.target, 'utf8'), 'new-wrapper');
      assert.equal(fs.readFileSync(f.op.previous, 'utf8'), 'old-wrapper');
      injected = true;
      throw new Error('injected commit journal rename failure');
    }
    return rename(source, target);
  });
  try {
    await assert.rejects(runTransaction(f.transaction, f.deps), /^Error: injected commit journal rename failure$/);
  } finally { mock.mock.restore(); }
  assert.equal(injected, true);
  assert.equal(f.transaction.phase, 'rolled-back');
  assert.equal(fs.readFileSync(f.op.target, 'utf8'), 'old-wrapper');
  assert.deepEqual(f.calls, ['launch', 'stop', 'relaunch', 'unregister']);
  assert.equal(fs.existsSync(f.transaction.root), false);
});

test('backup deletion failure after durable commit keeps candidate and makes recovery cleanup-only', async t => {
  const f = fixture(t);
  const rm = fs.rmSync;
  let injected = 0;
  const mock = t.mock.method(fs, 'rmSync', (filename, options) => {
    if (filename === f.op.previous) {
      assert.equal(f.reachedReadiness(), true);
      assert.equal(f.saved().phase, 'committed');
      assert.equal(fs.readFileSync(f.op.target, 'utf8'), 'new-wrapper');
      injected++;
      throw new Error('injected backup deletion failure');
    }
    return rm(filename, options);
  });
  try {
    await assert.rejects(runTransaction(f.transaction, f.deps), /^Error: injected backup deletion failure$/);
  } finally { mock.mock.restore(); }
  assert.ok(injected > 0);
  assert.equal(f.transaction.phase, 'committed');
  assert.equal(f.saved().phase, 'committed');
  assert.equal(fs.readFileSync(f.op.previous, 'utf8'), 'old-wrapper');
  assert.deepEqual(f.calls, ['launch']);
  // The fixture has no worker owner; recovery runs the real terminal cleanup.
  await recover(f.journal, f.deps);
  assert.deepEqual(f.calls, ['launch', 'unregister']);
  assert.equal(fs.readFileSync(f.op.target, 'utf8'), 'new-wrapper');
  assert.equal(fs.existsSync(f.op.previous), false);
  assert.equal(fs.existsSync(f.transaction.root), false);
});
