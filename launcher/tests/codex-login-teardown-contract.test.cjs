const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');
const filename = path.resolve(__dirname, '../electron/codex-login.cjs');
const loginId = '12345678-1234-4123-8123-123456789abc';
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function fixture({ cancelStatus = 'canceled' } = {}) {
  const timers = new Set();
  const children = [];
  const signals = [];
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, process, Buffer,
    require(name) {
      if (name === 'node:fs') return { ...fs, realpathSync: p => p, statSync: () => ({ isFile: () => true }), accessSync() {}, mkdirSync() {} };
      if (name === './process-tree.cjs') return { DETACH_OWNED_CHILD: false, terminateOwnedProcessTree: (child, signal) => signals.push([child, signal]) };
      return localRequire(name);
    },
    setTimeout(fn, ms) { const timer = { fn, ms }; timers.add(timer); return timer; },
    clearTimeout(timer) { timers.delete(timer); },
  }, { filename });
  const controller = module.exports.createCodexLoginController({
    codexHome: '/mock/codex-home', codexPath: '/mock/codex', isAccountCurrent: () => true,
    spawnProcess() {
      const child = new EventEmitter();
      Object.assign(child, { exitCode: null, signalCode: null, stdout: new EventEmitter(), stderr: new EventEmitter(), stdin: new EventEmitter() });
      child.stdout.setEncoding = () => {};
      child.stdin.end = () => { child.stdin.writableEnded = true; child.ends = (child.ends || 0) + 1; };
      child.stdin.write = (line, cb) => {
        const request = JSON.parse(line);
        if (request.id) queueMicrotask(() => child.stdout.emit('data', JSON.stringify({ id: request.id, result:
          request.method === 'account/login/start' ? { type: 'chatgptDeviceCode', loginId, verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'ABCD-EFGH' }
          : request.method === 'account/login/cancel' ? { status: cancelStatus }
          : request.method === 'account/read' ? { account: { type: 'chatgpt', email: 'fixture@example.test', planType: 'pro' }, requiresOpenaiAuth: false } : {} }) + '\n'));
        cb?.(); return true;
      };
      children.push(child); queueMicrotask(() => child.emit('spawn')); return child;
    },
  });
  async function exhaustStop() {
    for (const ms of [1000, 2000, 2000]) {
      await flush();
      const timer = [...timers].find(t => t.ms === ms);
      assert.ok(timer, `reached stop wait ${ms}`);
      timers.delete(timer); timer.fn();
    }
    await flush();
  }
  const start = () => controller.start({ accountId: 'default', confirmed: true });
  return { controller, start, exhaustStop, children, signals, timers };
}
test('unconfirmed stop blocks respawn and destroy; overlapping callers share teardown; observed exit permits retry', async () => {
  const f = fixture();
  const initial = await f.start();
  const child = f.children[0];
  child.stdout.emit('data', 'invalid-json\n'); // fail() starts teardown for this exact child
  assert.equal(f.controller.status(initial).phase, 'failed');
  const restart = assert.rejects(f.start(), { code: 'codex_cleanup_failed' });
  const destroy = assert.rejects(f.controller.destroy(), { code: 'codex_cleanup_failed' });
  await f.exhaustStop();
  await Promise.all([restart, destroy]);
  assert.equal(f.children.length, 1);
  assert.equal(child.ends, 1);
  assert.deepEqual(f.signals.map(entry => entry[1]), ['SIGTERM', 'SIGKILL']);
  assert.ok(f.signals.every(entry => entry[0] === child));
  child.exitCode = 0; child.emit('close');
  const next = await f.start();
  assert.equal(next.phase, 'waiting');
  assert.equal(f.children.length, 2);
  const cancelled = f.controller.cancel(next);
  await flush();
  f.children[1].exitCode = 0; f.children[1].emit('close');
  assert.equal((await cancelled).authOutcome, 'cancelled');
  await f.controller.destroy();
  assert.equal(f.timers.size, 0);
});
test('committed identity survives cleanup failure and remains separately observable', async () => {
  const f = fixture(); const initial = await f.start();
  f.children[0].stdout.emit('data', JSON.stringify({ method: 'account/login/completed', params: { loginId, success: true } }) + '\n');
  await flush();
  assert.equal(f.controller.status(initial).authOutcome, 'committed');
  await f.exhaustStop();
  const result = f.controller.status(initial);
  assert.equal(result.phase, 'completed');
  assert.equal(result.authOutcome, 'committed');
  assert.equal(result.actualAccount.email, 'fixture@example.test');
  assert.equal(result.cleanupError.code, 'codex_cleanup_failed');
  await assert.rejects(f.controller.destroy(), { code: 'codex_cleanup_failed' });
  assert.equal(f.timers.size, 0);
});

test('uncertain cancellation retains its reconciliation outcome when cleanup fails', async () => {
  const f = fixture({ cancelStatus: 'notFound' });
  const initial = await f.start();
  const cancellation = f.controller.cancel(initial);
  await flush();
  assert.equal(f.controller.status(initial).authOutcome, 'uncertain');
  await f.exhaustStop();
  const result = await cancellation;
  assert.equal(result.phase, 'needs-confirmation');
  assert.equal(result.authOutcome, 'uncertain');
  assert.equal(result.cancelStatus, 'notFound');
  assert.equal(result.cleanupError.code, 'codex_cleanup_failed');
  await assert.rejects(f.start(), { code: 'codex_cleanup_failed' });
  assert.equal(f.children.length, 1);
  assert.equal(f.timers.size, 0);
});
