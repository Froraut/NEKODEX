const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { RuntimeSupervisor } = require('../electron/runtime-supervisor.cjs');

test('catalog evidence rejects retired probes and foreign runtime counters', async () => {
  const config = { mode: 'full', releaseVersion: '5.2.0-nekodex.2', host: '127.0.0.1', port: 17841 };
  const owned = { ownerPid: process.pid, daemonPid: process.pid, status: 'ready', updatedAt: new Date().toISOString() };
  const payload = { service: 'codex-chatgpt-web', status: 'ok', version: config.releaseVersion,
    mode: 'full', accepting_turns: true, pid: process.pid, successful_model_catalog_requests: 1 };
  const replies = [];
  const supervisor = {
    daemon: { pid: process.pid, exitCode: null, signalCode: null },
    readConfig: () => config, readState: () => owned,
    proxyHealthPayload: () => new Promise(resolve => replies.push(resolve)),
    catalogHealthIsCurrent: RuntimeSupervisor.prototype.catalogHealthIsCurrent,
  };
  const state = { coreSetupComplete: true, codexCatalogVerified: false };
  const updates = [];
  const stateStore = { read: () => ({ ...state }), update: patch => {
    updates.push(patch); Object.assign(state, patch); return { ...state };
  } };
  let tick;
  const source = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
  const begin = source.indexOf('function stopCatalogVerificationMonitor()');
  const end = source.indexOf('async function restoreCodexRouteAfterRuntimeFailure', begin);
  assert.ok(begin >= 0 && end > begin);
  const context = vm.createContext({ runtimeSupervisor: supervisor, catalogVerificationEpoch: 0,
    catalogVerificationTimer: null, send() {},
    setInterval(fn) { tick = fn; return { unref() {} }; }, clearInterval() {},
  });
  vm.runInContext(source.slice(begin, end), context);
  const options = { stateStore, logger: { info() {}, debug() {} } };
  const flush = () => new Promise(resolve => setImmediate(resolve));
  context.startCatalogVerificationMonitor(options);
  context.stopCatalogVerificationMonitor();
  context.startCatalogVerificationMonitor(options);
  replies[0](payload); await flush();
  assert.equal(updates.length, 0);
  replies[1]({ ...payload, pid: process.pid + 1 }); await flush();
  assert.equal(updates.length, 0);
  tick(); replies[2](payload); await flush();
  assert.equal(updates.length, 1);
  assert.equal(state.codexCatalogVerified, true);
  context.stopCatalogVerificationMonitor();
});
