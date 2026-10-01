const assert = require("node:assert/strict");
const { AccountTunnelSupervisor, AccountTunnelPeer } = require("../electron/account-tunnel-supervisor.cjs");
const { managedTunnelConnectArgs } = require("../electron/runtime-tunnel-policy.cjs");
const { RuntimeSupervisor } = require("../electron/runtime-supervisor.cjs");
const { processIdentity } = require('../electron/update-recovery.cjs');
const { spawn } = require('node:child_process');

const tunnel = (suffix) => ({ tunnelId: `tunnel_${suffix.repeat(32)}`, alias: `account-${suffix}`,
  profileName: "profile", profileDir: "/tmp", binaryPath: "/tmp/unused", runtimeKeyFile: "/tmp/unused-key" });
const bindings = [
  { accountId: "one", interactionMode: "automatic", tunnel: tunnel("a") },
  { accountId: "two", interactionMode: "automatic", tunnel: tunnel("b") },
  { accountId: "three", interactionMode: "manual", tunnel: tunnel("c") },
];
const events = [];
const peers = new Map();
let config = { accountTunnelMode: true, mode: "full", browserInteractionMode: "automatic",
  automaticAppName: "Codex Native6", manualAppName: "Codex Zero Risk4",
  experimentalAsyncToolOperations: true, accountTunnels: bindings };
const lifecycle = [];
const manager = new AccountTunnelSupervisor({
  logger: { error: (...args) => events.push(args) }, readConfig: () => config,
  peerFactory: (binding, changed) => {
    const peer = { binding, runtimeStatus: "unknown", runtimeDetail: null, tunnel: null,
      recoveryTasks: new Set(), startPromise: null, tunnelMonitorFailures: 0,
      async startIfConfigured() {
        this.runtimeStatus = "starting";
        changed();
        if (binding.accountId === "one") {
          this.runtimeStatus = "failed";
          this.runtimeDetail = "injected failure";
          changed();
          throw new Error("injected failure");
        }
        this.tunnel = { pid: 222, exitCode: null, signalCode: null };
        this.runtimeStatus = "ready";
        changed();
        return { status: "ready" };
      },
      async shutdown() {
        lifecycle.push(["stop", binding.accountId, config.accountTunnels.find(item => item.accountId === binding.accountId)?.tunnel.tunnelId]);
        this.tunnel = null; this.runtimeStatus = "stopped"; changed();
      },
    };
    peers.set(binding.accountId, peer);
    return peer;
  },
}, () => events.push(manager.snapshot()));

async function main() {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { stdio: 'ignore' });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  try {
    const peer = Object.create(AccountTunnelPeer.prototype);
    const identity = processIdentity(child.pid);
    assert.ok(identity);
    const marker = { ownerPid: 999999999, ownerIdentity: 'old-launcher', tunnelPid: child.pid, tunnelIdentity: identity };
    assert.equal(peer.recoverableMarker(marker, child.pid), true);
    assert.equal(peer.recoverableMarker({ ...marker, tunnelIdentity: 'different-process' }, child.pid), false);
    assert.equal(peer.recoverableMarker({ ...marker, ownerPid: process.pid, ownerIdentity: processIdentity(process.pid) }, child.pid), false);
  } finally { child.kill('SIGTERM'); await new Promise(resolve => child.once('exit', resolve)); }
  const args = managedTunnelConnectArgs({ tunnel: bindings[1].tunnel, accountTunnelBinding: true },
    { executable: "/tmp/runtime", args: ["mcp", "--contract", "safe"] });
  assert.match(args[args.indexOf("--mcp-command") + 1], /"--tunnel-id" "tunnel_b{32}"/);
  await manager.start(config);
  assert.equal(manager.getStatus("one", "automatic").status, "error");
  assert.deepEqual(manager.getStatus("two", "automatic"), {
    accountId: "two", interactionMode: "automatic", tunnelId: bindings[1].tunnel.tunnelId,
    status: "ready", ready: true, pid: 222,
  });
  assert.equal(peers.has("three"), false);
  assert.deepEqual(manager.getStatus("three", "manual"), {
    accountId: "three", interactionMode: "manual", tunnelId: bindings[2].tunnel.tunnelId,
    status: "stopped", ready: false, pid: null, detail: "Inactive interaction mode",
  });
  assert.equal(manager.snapshot().filter(item => item.ready).length, 1);
  assert.equal(manager.getStatus("missing", "manual").status, "unconfigured");
  const identityPeer = Object.create(AccountTunnelPeer.prototype);
  identityPeer.tunnel = { pid: 321 };
  identityPeer.readState = () => null;
  identityPeer.readTunnelHealth = async () => ({ statusKnown: true, pid: 999, state: "ready" });
  await assert.rejects(identityPeer.runTunnelStopCommand({ tunnel: bindings[0].tunnel }),
    /ownership proof/);
  identityPeer.tunnel = null;
  await identityPeer.adoptConfiguredTunnelForStop({ tunnel: bindings[0].tunnel });
  assert.equal(identityPeer.tunnel, null);
  const scoped = Object.create(AccountTunnelPeer.prototype);
  scoped.binding = bindings[1];
  scoped.tunnel = { pid: 4372, managed: true, exitCode: null, signalCode: null };
  scoped.ownedAliasVerified = true;
  scoped.stopping = false;
  scoped.shutdownRequested = false;
  scoped.readState = () => ({ ownerPid: process.pid, updatedAt: new Date().toISOString(),
    tunnelPid: 4372, status: "ready" });
  const inventory = JSON.stringify({ entries: [{ alias: bindings[1].tunnel.alias,
    tunnel_id: bindings[1].tunnel.tunnelId, runtime_state: "ready",
    profile: { name: "profile", dir: "/tmp" }, live_runtime: { found: false } }] });
  const status = JSON.stringify({ alias: bindings[1].tunnel.alias,
    tunnel_id: bindings[1].tunnel.tunnelId, profile_dir: "/tmp", profile_name: "profile",
    state: "ready", process: { pid: 4372 }, health_url: "http://127.0.0.1:9999" });
  const commands = [];
  let scopedStatus = status;
  scoped.runTunnelCommand = async (_config, argv) => {
    commands.push(argv);
    return argv[1] === "cleanup"
    ? { code: 0, output: inventory } : argv[1] === "status"
      ? { code: 0, output: scopedStatus } : { code: 0, output: "stopped" };
  };
  const peerConfig = { tunnel: bindings[1].tunnel, accountTunnelBinding: true };
  const scopedHealth = await scoped.readTunnelHealth(peerConfig);
  assert.equal(scopedHealth.ready, true);
  assert.equal(scopedHealth.pid, 4372);
  assert.deepEqual(commands[1], ["runtimes", "status", bindings[1].tunnel.alias, "--json"]);
  scopedStatus = JSON.stringify({ ...JSON.parse(status), tunnel_id: bindings[0].tunnel.tunnelId });
  await assert.rejects(scoped.readTunnelHealth(peerConfig), /does not match the saved binding/);
  scopedStatus = JSON.stringify({ ...JSON.parse(status), process: { pid: 9876 } });
  await assert.rejects(scoped.readTunnelHealth(peerConfig), /process identity changed during supervision/);
  scoped.tunnel = null;
  await assert.rejects(scoped.readTunnelHealth(peerConfig), /process identity changed during supervision/);
  scoped.tunnel = { pid: 4372, managed: true, exitCode: null, signalCode: null };
  scopedStatus = status;
  assert.equal((await scoped.runTunnelStopCommand(peerConfig)).code, 0);
  scoped.ownedAliasVerified = true;
  scoped.readState = () => ({ ownerPid: process.pid + 100000, updatedAt: new Date().toISOString(),
    tunnelPid: 4372, status: "ready" });
  await assert.rejects(scoped.runTunnelStopCommand(peerConfig), /ownership proof/);
  scoped.ownedAliasVerified = false;
  scoped.readState = () => null;
  scoped.waitForKnownTunnelStatus = async () => scopedHealth;
  await assert.rejects(scoped.startTunnel(peerConfig), /without current launcher ownership proof/);
  identityPeer.binding = bindings[1];
  identityPeer.parentConfig = () => config;
  assert.equal(identityPeer.readConfig().accountTunnelMode, false);
  assert.equal(identityPeer.readConfig().accountTunnelBinding, true);
  assert.equal(identityPeer.readConfig().tunnel.tunnelId, bindings[1].tunnel.tunnelId);
  assert.equal(identityPeer.readConfig().appName, "Codex Native6");
  config = { ...config, browserInteractionMode: "manual" };
  identityPeer.binding = bindings[2];
  assert.equal(identityPeer.readConfig().appName, "Codex Zero Risk4");
  assert.equal(identityPeer.readConfig().experimentalAsyncToolOperations, false);
  let manualArgs;
  const manualInvocation = Object.create(RuntimeSupervisor.prototype);
  manualInvocation.runtimeCommand = argv => ({ executable: "/tmp/runtime", args: argv });
  manualInvocation.runTunnelCommand = async (_config, argv) => {
    manualArgs = argv;
    return { code: 0, output: "ok" };
  };
  await manualInvocation.runTunnelConnectCommand({ ...identityPeer.readConfig(),
    brokerSocketPath: "/tmp/broker.sock", releaseVersion: "test" });
  const manualCommand = manualArgs[manualArgs.indexOf("--mcp-command") + 1];
  assert.match(manualCommand, /"--synchronous-tool-operations"/);
  assert.match(manualCommand, /"--contract" "safe"/);
  assert.match(manualCommand, /"--tunnel-id" "tunnel_c{32}"/);
  config = { ...config, browserInteractionMode: "automatic" };
  const reports = [];
  const parent = Object.create(RuntimeSupervisor.prototype);
  Object.assign(parent, {
    launcherProfile: "production", daemon: { pid: 111 }, stopping: false,
    shutdownRequested: false, tunnelStatusRevision: 0, tunnelStatusQueue: Promise.resolve(),
    app: { getVersion: () => "test" }, accountTunnelSupervisor: manager,
    nativeAccepting: null, webAccepting: null, brokerReady: null, reportedTunnelReady: null,
    control: async (_config, action, options) => {
      assert.equal(action, "tunnel-status");
      reports.push(options.body);
      return { status: "ok", native_accepting_turns: true, web_accepting_turns: true,
        broker_ready: true, tunnel_ready: options.body.ready,
        tunnel_status_revision: options.body.revision };
    },
  });
  await parent.reportTunnelStatus({ ...config, releaseVersion: "test" }, true);
  assert.equal(reports[0].ready, true);
  assert.deepEqual(reports[0].account_tunnels.map(item => [item.account_id, item.ready]),
    [["one", false], ["two", true], ["three", false]]);
  await parent.reportTunnelStatus({ mode: "full", releaseVersion: "test" }, false);
  assert.equal("account_tunnels" in reports[1], false);
  parent.readConfig = () => config;
  parent.publishAccountTunnelCapabilities = () => {};
  await parent.prepareAccountTunnelChange("two", "automatic");
  assert.deepEqual(lifecycle[0], ["stop", "two", bindings[1].tunnel.tunnelId]);
  assert.equal(manager.getStatus("one", "automatic").status, "error");
  assert.equal(peers.has("three"), false);
  config = { ...config, accountTunnels: [bindings[0], { ...bindings[1], tunnel: tunnel("d") }, bindings[2]] };
  assert.equal(manager.getStatus("two", "automatic").ready, false);
  assert.equal(manager.getStatus("two", "automatic").pid, null);
  await parent.syncAccountTunnels();
  assert.equal(manager.getStatus("two", "automatic").tunnelId, tunnel("d").tunnelId);
  assert.equal(manager.getStatus("two", "automatic").ready, true);
  peers.get("two").reportedTunnelReady = false;
  assert.equal(manager.getStatus("two", "automatic").ready, false);
  peers.get("two").reportedTunnelReady = null;
  assert.equal(peers.has("three"), false);

  const dev = Object.create(RuntimeSupervisor.prototype);
  let devPeerStarts = 0;
  Object.assign(dev, { launcherProfile: "development", daemon: null, tunnel: null,
    shutdownRequested: false, stopping: false, restartHistory: { daemon: [], tunnel: [] },
    readConfig: () => config, readState: () => null, adoptBackgroundDaemon: async () => false,
    updateCapabilities: () => {}, writeState: () => {}, publishOperation: () => {},
    accountPeers: () => ({ start: async () => { devPeerStarts++; }, snapshot: () => manager.snapshot() }),
    startTunnel: async () => { throw new Error("DEV used legacy tunnel fallback"); },
  });
  const devResult = await dev.startConfigured(new AbortController().signal);
  assert.equal(devResult.status, "ready");
  assert.equal(devPeerStarts, 1);

  const legacy = Object.create(RuntimeSupervisor.prototype);
  const nativeDaemon = { pid: 111 };
  let oldTunnelStops = 0;
  Object.assign(legacy, { launcherProfile: "production", daemon: nativeDaemon,
    tunnel: { pid: 333 }, restartTimers: { tunnel: null },
    recoveryAliasMayBeLive: false, stopping: false, shutdownRequested: false,
    readConfig: () => ({ mode: "full", accountTunnelMode: false, tunnel: tunnel("e") }),
    stopTunnelMonitor: () => {}, settleRecoveryTasks: async () => true,
    reportTunnelStatus: async () => {}, stopTunnelGracefully: async () => { oldTunnelStops++; legacy.tunnel = null; },
    tryWriteState: () => true, updateCapabilities: () => {},
  });
  assert.equal((await legacy.prepareAccountTunnelChange("one", "automatic")).status, "legacy-tunnel-stopped");
  assert.equal(oldTunnelStops, 1);
  assert.equal(legacy.daemon, nativeDaemon);
  assert.equal(legacy.legacyTunnelTransitionPending, true);
  legacy.scheduleRecovery("tunnel");
  assert.equal(legacy.restartTimers.tunnel, null);

  const stopConfig = { ...config, accountTunnelMode: true };
  const idleRefusal = new Error("injected active browser turn");
  idleRefusal.code = "RUNTIME_NOT_IDLE";
  const stopEvents = [];
  const busyPeers = { configure: () => {}, ownedKeys: () => ["two"],
    stop: async () => { stopEvents.push("peer-stop"); } };
  const busy = Object.create(RuntimeSupervisor.prototype);
  Object.assign(busy, { launcherProfile: "production", daemon: nativeDaemon, tunnel: null,
    accountTunnelSupervisor: busyPeers, accountPeers: () => busyPeers,
    updateCapabilities: () => {}, settleInitialStart: async () => true,
    stopTunnelMonitor: () => {}, settleRecoveryTasks: async () => true,
    readConfig: () => stopConfig, readState: () => null,
    proxyHealth: async () => true, ownedRuntimeReady: async () => true,
    acquireDrain: async () => { stopEvents.push("drain-reached"); throw idleRefusal; },
    tryWriteState: () => true,
  });
  await assert.rejects(busy.performStopForSetup(), /injected active browser turn/);
  assert.deepEqual(stopEvents, ["drain-reached"]);
  assert.equal(busy.daemon, nativeDaemon);

  const compensation = [];
  const recoverPeers = { configure: () => {}, ownedKeys: () => ["two"],
    stop: async () => { compensation.push("peer-stop"); },
    restartOwned: async keys => { compensation.push(["peer-restart", ...keys]); },
    snapshot: () => [{ ready: true }] };
  const rollback = Object.create(RuntimeSupervisor.prototype);
  Object.assign(rollback, { launcherProfile: "production", daemon: nativeDaemon, tunnel: null,
    accountTunnelSupervisor: recoverPeers, accountPeers: () => recoverPeers,
    updateCapabilities: () => {}, settleInitialStart: async () => true,
    stopTunnelMonitor: () => {}, settleRecoveryTasks: async () => true,
    readConfig: () => stopConfig, readState: () => null,
    proxyHealth: async () => true, ownedRuntimeReady: async () => true,
    acquireDrain: async () => { compensation.push("drain"); return true; },
    shutdownDaemon: async () => { compensation.push("daemon-shutdown"); throw new Error("injected daemon failure"); },
    restoreDrainedDaemon: async () => { compensation.push("daemon-resume"); },
    reportTunnelStatus: async () => { compensation.push("status-report"); },
    tryWriteState: () => true,
  });
  await assert.rejects(rollback.performStopForSetup(), /injected daemon failure/);
  assert.deepEqual(compensation, ["drain", "peer-stop", "daemon-shutdown", "daemon-resume",
    ["peer-restart", "two"], "status-report"]);
  const restartCalls = [];
  const ownedOnly = new AccountTunnelSupervisor({ readConfig: () => config }, () => {});
  ownedOnly.bindings = bindings.slice(0, 2);
  ownedOnly.activeMode = "automatic";
  ownedOnly.peers.set("one\0automatic", { binding: bindings[0], tunnel: null,
    runtimeStatus: "stopped", async startIfConfigured() { restartCalls.push("one"); return { status: "ready" }; } });
  ownedOnly.peers.set("two\0automatic", { binding: bindings[1], tunnel: { pid: 222 },
    runtimeStatus: "ready", async startIfConfigured() { restartCalls.push("two"); return { status: "ready" }; } });
  await ownedOnly.restartOwned(["one\0automatic", "two\0automatic"]);
  assert.deepEqual(restartCalls, ["one"]);

  const alpha = { accountId: "alpha", interactionMode: "automatic", tunnel: tunnel("1") };
  const beta = { accountId: "beta", interactionMode: "automatic", tunnel: tunnel("2") };
  let syncConfig = { ...config, accountTunnels: [alpha] };
  const starts = { alpha: 0, beta: 0 };
  const stable = new AccountTunnelSupervisor({ readConfig: () => syncConfig,
    logger: { error: error => { throw error; } },
    peerFactory: binding => ({ binding, runtimeStatus: "unconfigured", tunnel: null,
      recoveryTasks: new Set(), tunnelMonitorFailures: 0,
      async startIfConfigured() {
        starts[binding.accountId]++;
        this.tunnel = { pid: starts[binding.accountId] + 100, exitCode: null, signalCode: null };
        this.runtimeStatus = "ready";
        return { status: "ready" };
      },
      async shutdown() { this.tunnel = null; this.runtimeStatus = "stopped"; },
    }),
  }, () => {});
  await stable.start(syncConfig);
  syncConfig = { ...syncConfig, accountTunnels: [alpha, beta] };
  await stable.start(syncConfig);
  assert.deepEqual(starts, { alpha: 1, beta: 1 });
  await stable.prepareChange("beta", "automatic");
  syncConfig = { ...syncConfig, accountTunnels: [alpha, { ...beta, tunnel: tunnel("3") }] };
  await stable.start(syncConfig);
  assert.deepEqual(starts, { alpha: 1, beta: 2 });
  const retiredAlpha = stable.peers.get("alpha\0automatic");
  retiredAlpha.tunnel = null;
  retiredAlpha.runtimeStatus = "stopped";
  retiredAlpha.shutdownRequested = true;
  await stable.start(syncConfig);
  assert.notEqual(stable.peers.get("alpha\0automatic"), retiredAlpha);
  assert.deepEqual(starts, { alpha: 2, beta: 2 });

  await manager.stop();
  assert.equal(manager.snapshot().filter(item => item.ready).length, 0);
  assert.equal(peers.get("two").runtimeStatus, "stopped");
  console.log("account tunnel supervision smoke passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
