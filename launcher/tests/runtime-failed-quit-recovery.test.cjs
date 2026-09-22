const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');

function fixture(t) {
  const filename = path.resolve(__dirname, '../electron/runtime-supervisor.cjs');
  const realRequire = createRequire(filename);
  const child = Object.assign(new EventEmitter(), { pid: 12001, exitCode: null, signalCode: null });
  let monitor;
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, __dirname: path.dirname(filename), process, Buffer, URL,
    AbortController, setTimeout, clearTimeout,
    setInterval(fn) { monitor = fn; return { unref() {} }; }, clearInterval() { monitor = null; },
    require(name) {
      return name === 'node:child_process' ? { ...realRequire(name), spawn: () => child } : realRequire(name);
    },
  }, { filename });
  const s = new module.exports.RuntimeSupervisor({ app: { isPackaged: false, getVersion: () => '1.0.0' },
    logger: { info() {}, warn() {}, error() {} }, sourceRoot: '/fixture', coreHome: '/fixture',
    browserDescriptorPath: '/fixture/browser.json' });
  const config = { mode: 'full' };
  s.readConfig = () => config;
  s.readState = () => null;
  s.writeState = () => {};
  s.tryWriteState = () => true;
  s.updateCapabilities = () => {};
  s.proxyHealth = async () => true;
  s.ownedRuntimeReady = async () => true;
  s.reportTunnelStatus = async () => ({});
  s.spawnChild('daemon', { executable: 'simulated', args: [] });
  s.restartableChildren.add(child);
  s.tunnel = { pid: 12002 };
  s.startTunnelMonitor(config);
  const actions = [];
  s.control = async (_config, action) => {
    actions.push(action);
    return { status: 'ok', accepting_turns: action === 'resume', active_http_turns: 1,
      active_browser_turns: 0, active_compaction_runs: 1 };
  };
  const acquireDrain = s.acquireDrain.bind(s);
  s.acquireDrain = config => acquireDrain(config, 0);
  s.stopTunnelGracefully = async () => assert.fail('must preserve tunnel');
  s.shutdownDaemon = async () => assert.fail('must preserve active daemon');
  t.after(() => { s.cancelRecoveries(); s.stopTunnelMonitor(); });
  return { s, child, actions, poll: () => monitor() };
}

test('failed full-stop Quit resumes admission and daemon/tunnel recovery without restarting active work', async t => {
  const { s, child, actions, poll } = fixture(t);
  const tunnel = s.tunnel;
  await assert.rejects(s.shutdown(), /active HTTP turn/);
  assert.deepEqual(actions, ['drain', 'resume']);
  assert.equal(s.daemon, child);
  assert.equal(s.tunnel, tunnel);
  assert.equal(s.tunnelMonitorTimer, null);
  s.allowRestartAfterQuitFailure();
  assert.equal(s.shutdownRequested, false);
  assert.ok(s.tunnelMonitorTimer);
  assert.equal(s.restartTimers.daemon, null);
  assert.equal(s.restartTimers.tunnel, null);
  child.emit('exit', 1, null);
  assert.ok(s.restartTimers.daemon, 'actual child exit handler schedules recovery');
  s.observeTunnelForMonitor = async () => ({ statusKnown: true, ready: false, fatal: true, detail: 'lost' });
  poll();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(s.restartTimers.tunnel, 'actual monitor loss handler schedules recovery');
});

for (const owner of ['startup', 'recovery', 'control']) {
  test(`failed-Quit compensation retains the ${owner} owner fence`, async t => {
    const { s } = fixture(t);
    s.shutdownRequested = true;
    s.startConfigured = async () => assert.fail('cannot start with unsettled owner');
    if (owner === 'startup') s.startPromise = new Promise(() => {});
    if (owner === 'recovery') {
      s.recoveryTasks.add(new Promise(() => {}));
      s.settleRecoveryTasks = async () => false;
    }
    if (owner === 'control') s.tunnelControlControllers.set('pending', new AbortController());
    s.allowRestartAfterQuitFailure();
    assert.equal(s.shutdownRequested, true);
    s.scheduleRecovery('daemon');
    assert.equal(s.restartTimers.daemon, null);
    await assert.rejects(s.startIfConfigured(), /settling|unsettled/);
  });
}

test('settled failed-Quit compensation schedules missing owned runtime components', t => {
  const { s } = fixture(t);
  s.shutdownRequested = true;
  s.daemon = null;
  s.tunnel = null;
  s.allowRestartAfterQuitFailure();
  assert.ok(s.restartTimers.daemon);
  assert.ok(s.restartTimers.tunnel);
});
