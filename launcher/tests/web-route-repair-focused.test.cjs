const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { RuntimeSupervisor } = require("../electron/runtime-supervisor.cjs");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nekodex-web-route-repair-"));
  const descriptor = path.join(root, "runtime", "launcher-browser.json");
  const tunnel = {
    binaryPath: path.join(root, "bin", "tunnel-client"),
    tunnelId: "tunnel_0123456789abcdef0123456789abcdef",
    runtimeKeyFile: path.join(root, "secrets", "runtime.key"),
    profileDir: path.join(root, "profiles"), profileName: "nekodex", alias: "nekodex",
  };
  const config = {
    version: 3, releaseVersion: "1.2.3", mode: "full", browserInteractionMode: "automatic",
    host: "127.0.0.1", port: 17841, contextWindow: 256000, appName: "NEKODEX",
    browserHost: "launcher", browserHostDescriptorPath: descriptor,
    chromeExecutablePath: process.execPath, storageStatePath: path.join(root, "storage.json"),
    brokerSocketPath: path.join(root, "broker.sock"), headed: true, proAvailable: true,
    autoApproveToolCalls: false, controlToken: "repair-control-token-0123456789abcdef0123456789",
    runtimeCommand: [process.execPath], tunnel, automaticTunnel: tunnel,
  };
  fs.mkdirSync(path.dirname(descriptor), { recursive: true });
  fs.writeFileSync(path.join(root, "config.json"), `${JSON.stringify(config)}\n`);
  const operations = [], capabilities = [];
  const supervisor = new RuntimeSupervisor({
    app: { getVersion: () => "1.2.3", isPackaged: true },
    logger: { info() {}, warn() {}, error() {} }, sourceRoot: root, coreHome: root,
    browserDescriptorPath: descriptor, publishOperation: value => operations.push(value),
    publishCapabilities: value => capabilities.push(value),
  });
  supervisor.daemon = { pid: 4242, exitCode: null, signalCode: null, managed: true };
  supervisor.daemonInstanceId = "11111111-1111-4111-8111-111111111111";
  supervisor.runtimeStatus = "degraded";
  supervisor.nativeAccepting = true;
  supervisor.webAccepting = false;
  supervisor.brokerReady = true;
  supervisor.reportedTunnelReady = false;
  supervisor.tryWriteState = () => true;
  supervisor.readState = () => ({ version: 1, ownerPid: process.pid, daemonPid: 4242,
    tunnelPid: supervisor.tunnel?.pid ?? null, status: "degraded", updatedAt: new Date().toISOString() });
  supervisor.tryWriteRepairState = () => true;
  const health = extra => ({ service: "codex-chatgpt-web", status: "ok", version: "1.2.3", mode: "full", pid: 4242,
    instance_id: "11111111-1111-4111-8111-111111111111",
    native_accepting_turns: true, web_accepting_turns: false, broker_ready: true, tunnel_ready: false,
    active_http_turns: 1, active_browser_turns: 0, active_compaction_runs: 0, ...extra });
  return { root, config, supervisor, operations, capabilities, health,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test("repair restarts only the tunnel and requires fresh owned Web readiness", async () => {
  const f = fixture();
  const reports = [], starts = [], daemon = f.supervisor.daemon;
  const health = [f.health(), f.health(), f.health({ web_accepting_turns: true, tunnel_ready: true })];
  f.supervisor.proxyHealthPayload = async () => health.shift();
  f.supervisor.reportTunnelStatus = async (_config, ready) => {
    reports.push(ready); return { applied: true, stale: false, tunnel_ready: ready };
  };
  f.supervisor.startTunnel = async (_config, operation, options) => {
    starts.push({ operation, forceRestart: options.forceRestart });
    f.supervisor.tunnel = { pid: 5252, exitCode: null, signalCode: null, managed: true };
  };
  try {
    f.supervisor.lastOwnedHealth = f.health();
    f.supervisor.lastOwnedHealthAt = Date.now();
    assert.deepEqual(f.supervisor.tunnelRepairSnapshot(f.config),
      { eligible: true, reason: "tunnel-repair-available", active: false });
    assert.deepEqual(await f.supervisor.repairWebRoute(), { status: "recovered", reason: null });
    assert.deepEqual(reports, [false, true]);
    assert.deepEqual(starts, [{ operation: "web-route-repair", forceRestart: true }]);
    assert.equal(f.supervisor.daemon, daemon);
    assert.equal(f.supervisor.nativeAccepting, true);
    assert.equal(f.supervisor.capabilitySnapshot(f.config).nativeAvailability, "ready");
    assert.equal(f.operations.at(-1).status, "completed");
  } finally { f.cleanup(); }
});

test("repair refuses active Web work before touching the tunnel", async () => {
  const f = fixture();
  let starts = 0, reports = 0;
  f.supervisor.proxyHealthPayload = async () => f.health({ active_browser_turns: 1 });
  f.supervisor.startTunnel = async () => {
    starts++;
    f.supervisor.tunnel = { pid: 5252, exitCode: null, signalCode: null, managed: true };
  };
  f.supervisor.reportTunnelStatus = async () => { reports++; };
  try {
    assert.deepEqual(await f.supervisor.repairWebRoute(),
      { status: "unavailable", reason: "web-work-active" });
    assert.equal(starts, 0);
    assert.equal(reports, 0);
    assert.equal(f.supervisor.nativeAccepting, true);
  } finally { f.cleanup(); }
});

test("failed final proof leaves Native ready and does not run daemon cleanup", async () => {
  const f = fixture();
  const daemon = f.supervisor.daemon;
  let daemonStops = 0;
  const health = [f.health(), f.health(), f.health()];
  f.supervisor.proxyHealthPayload = async () => health.shift();
  f.supervisor.reportTunnelStatus = async (_config, ready) => ({ applied: true, stale: false, tunnel_ready: ready });
  f.supervisor.startTunnel = async () => { f.supervisor.tunnel = null; };
  f.supervisor.cleanupFailedStart = async () => { daemonStops++; };
  try {
    const result = await f.supervisor.repairWebRoute();
    assert.equal(result.status, "unavailable");
    assert.match(result.reason, /Fresh owned health did not confirm/);
    assert.equal(daemonStops, 0);
    assert.equal(f.supervisor.daemon, daemon);
    assert.equal(f.supervisor.capabilitySnapshot(f.config).nativeAvailability, "ready");
    assert.equal(f.supervisor.capabilitySnapshot(f.config).webAvailability, "degraded");
  } finally { f.cleanup(); }
});

test("repair closes Web admission and rechecks for raced work before tunnel restart", async () => {
  const f = fixture();
  const health = [f.health(), f.health({ active_browser_turns: 1 })];
  let starts = 0;
  const reports = [];
  f.supervisor.proxyHealthPayload = async () => health.shift();
  f.supervisor.reportTunnelStatus = async (_config, ready) => {
    reports.push(ready); return { applied: true, stale: false, tunnel_ready: ready };
  };
  f.supervisor.startTunnel = async () => { starts++; };
  try {
    assert.deepEqual(await f.supervisor.repairWebRoute(),
      { status: "unavailable", reason: "web-work-active" });
    assert.deepEqual(reports, [false]);
    assert.equal(starts, 0);
    assert.equal(f.supervisor.daemon?.pid, 4242);
  } finally { f.cleanup(); }
});

test("repair retires and settles an older monitor generation before the false admission fence", async () => {
  const f = fixture();
  const health = [f.health(), f.health(), f.health({ web_accepting_turns: true, tunnel_ready: true })];
  const reports = [];
  let releaseQueued, oldMonitorStillCurrent = true, monitorRestores = 0;
  const generation = f.supervisor.tunnelMonitorGeneration;
  f.supervisor.tunnelMonitorTimer = {};
  f.supervisor.tunnelStatusQueue = new Promise(resolve => {
    releaseQueued = () => {
      oldMonitorStillCurrent = generation === f.supervisor.tunnelMonitorGeneration;
      resolve();
    };
  });
  f.supervisor.proxyHealthPayload = async () => health.shift();
  f.supervisor.reportTunnelStatus = async (_config, ready) => {
    reports.push(ready); return { applied: true, stale: false, tunnel_ready: ready };
  };
  f.supervisor.startTunnel = async () => {};
  f.supervisor.startTunnelMonitor = () => { monitorRestores++; };
  try {
    const repair = f.supervisor.repairWebRoute();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(reports, []);
    releaseQueued();
    assert.deepEqual(await repair, { status: "recovered", reason: null });
    assert.equal(oldMonitorStillCurrent, false);
    assert.deepEqual(reports, [false, true]);
    assert.equal(monitorRestores, 1);
  } finally { f.cleanup(); }
});

test("repair is single-flight and a state-write failure never enters Native shutdown", async () => {
  const f = fixture();
  let releaseHealth;
  let healthReads = 0, starts = 0;
  f.supervisor.proxyHealthPayload = async () => {
    healthReads++;
    if (healthReads === 1) await new Promise(resolve => { releaseHealth = resolve; });
    return healthReads < 3 ? f.health() : f.health({ web_accepting_turns: true, tunnel_ready: true });
  };
  f.supervisor.reportTunnelStatus = async (_config, ready) => ({ applied: true, stale: false, tunnel_ready: ready });
  f.supervisor.startTunnel = async () => {
    starts++;
    f.supervisor.tunnel = { pid: 5252, exitCode: null, signalCode: null, managed: true };
  };
  f.supervisor.tryWriteRepairState = () => false;
  try {
    const first = f.supervisor.repairWebRoute();
    const second = f.supervisor.repairWebRoute();
    await new Promise(resolve => setImmediate(resolve));
    releaseHealth();
    const [a, b] = await Promise.all([first, second]);
    assert.deepEqual(a, b);
    assert.equal(a.status, "unavailable");
    assert.match(a.reason, /ownership state could not be persisted/);
    assert.equal(starts, 1);
    assert.equal(f.supervisor.stopping, false);
    assert.equal(f.supervisor.daemon?.pid, 4242);
    assert.equal(f.supervisor.webAccepting, true);
    assert.equal(f.supervisor.reportedTunnelReady, true);
    assert.equal(f.supervisor.capabilitySnapshot(f.config).webAvailability, "ready");
  } finally { f.cleanup(); }
});

test("actual tunnel-start failure cleans only tunnel ownership and preserves Native", async () => {
  const f = fixture();
  const health = [f.health(), f.health()];
  const daemon = f.supervisor.daemon;
  let broadCleanup = 0, tunnelStops = 0;
  f.supervisor.proxyHealthPayload = async () => health.shift();
  f.supervisor.reportTunnelStatus = async (_config, ready) => ({ applied: true, stale: false, tunnel_ready: ready });
  f.supervisor.assertTunnelClientReady = () => {};
  f.supervisor.waitForKnownTunnelStatus = async () => ({ ready: false, absent: true, statusKnown: true, detail: "stopped" });
  f.supervisor.runTunnelStopCommand = async () => { tunnelStops++; return { code: 0, output: "stopped" }; };
  f.supervisor.waitForTunnelStopped = async () => {};
  f.supervisor.runTunnelConnectCommand = async () => ({ code: 1, output: "fixture connect failed" });
  f.supervisor.cleanupFailedStart = async () => { broadCleanup++; };
  try {
    const result = await f.supervisor.repairWebRoute();
    assert.equal(result.status, "unavailable");
    assert.match(result.reason, /refused managed startup/);
    assert.equal(tunnelStops, 2);
    assert.equal(broadCleanup, 0);
    assert.equal(f.supervisor.daemon, daemon);
    assert.equal(f.supervisor.stopping, false);
    assert.equal(f.supervisor.capabilitySnapshot(f.config).nativeAvailability, "ready");
  } finally { f.cleanup(); }
});
