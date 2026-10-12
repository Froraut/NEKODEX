// Account tunnel resilience: network blips, OpenAI reachability, dead
// processes, recovery backoff, stale-marker orphans and the Reconnect action.
// Uses a loopback stand-in for tunnel-client's local endpoints and real
// child processes for PID/start-identity proof. No tunnel-client binary runs.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { AccountTunnelPeer, AccountTunnelSupervisor } = require("../electron/account-tunnel-supervisor.cjs");
const { RuntimeSupervisor } = require("../electron/runtime-supervisor.cjs");
const { processIdentity } = require("../electron/update-recovery.cjs");
const { TunnelPollHealth, parseTunnelPollMetrics } = require("../electron/tunnel-poll-health.cjs");
const { recoveryBackoffDelay } = require("../electron/runtime-tunnel-policy.cjs");

const events = [];
const logger = {
  info: (name, data) => events.push(["info", name, data]),
  warn: (name, data) => events.push(["warn", name, data]),
  error: (name, data) => events.push(["error", name, data]),
};
const logged = name => events.filter(([, event]) => event === name);
const flush = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };

function metricsText({ lastSuccess, errors = 0 }) {
  return [
    "# TYPE commands_poll_cycles_total counter",
    `commands_poll_cycles_total{otel_scope_name="controlplane"} ${errors + 1}`,
    "# TYPE commands_poll_errors_total counter",
    `commands_poll_errors_total{error_kind="other",otel_scope_name="controlplane"} ${errors}`,
    ...(lastSuccess === null ? [] : ["# TYPE commands_poll_last_successful_timestamp_seconds gauge",
      `commands_poll_last_successful_timestamp_seconds{otel_scope_name="controlplane"} ${(lastSuccess / 1000).toExponential(8)}`]),
    "go_goroutines 12", "",
  ].join("\n");
}

async function stubTunnelEndpoints() {
  const state = { healthz: 200, readyz: 200, metrics: metricsText({ lastSuccess: Date.now() }) };
  const server = http.createServer((req, res) => {
    if (req.url === "/healthz") { res.statusCode = state.healthz; return res.end("ok"); }
    if (req.url === "/readyz") { res.statusCode = state.readyz; return res.end("ok"); }
    if (req.url.startsWith("/api/logs")) { res.setHeader("content-type", "application/json"); return res.end('{"events":[]}'); }
    if (req.url === "/metrics") return res.end(state.metrics);
    res.statusCode = 404; res.end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { state, server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

async function liveChild() {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
  await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  return child;
}
async function killChild(child) {
  if (child.exitCode !== null || child.signalCode) return;
  child.kill("SIGKILL");
  await new Promise(resolve => child.once("exit", resolve));
}

function makePeer(root, suffix = "a", accountId = `acct-${suffix}`) {
  const binding = { accountId, interactionMode: "automatic", tunnel: {
    tunnelId: `tunnel_${suffix.repeat(32)}`, alias: `account-${suffix}`, profileName: "profile",
    profileDir: path.join(root, `profile-${suffix}`), binaryPath: process.execPath,
    runtimeKeyFile: process.execPath } };
  fs.mkdirSync(path.join(root, "runtime"), { recursive: true });
  const peer = new AccountTunnelPeer({ app: { getVersion: () => "test" }, logger, coreHome: root,
    browserDescriptorPath: path.join(root, "browser.json") }, binding, () => {});
  const config = { mode: "full", tunnel: binding.tunnel, accountTunnelBinding: true };
  peer.readConfig = () => config;
  return { peer, binding, config };
}

// Remote `runtimes status` must never run while local proof holds.
function forbidControlCommands(peer) {
  const calls = [];
  peer.runTunnelCommand = async (_config, argv) => {
    calls.push(argv);
    throw new Error(`Account tunnel process identity timed out after 5000ms (${argv.join(" ")})`);
  };
  return calls;
}

function pureHelpers() {
  const now = Date.parse("2026-10-12T10:00:00Z");
  const parsed = parseTunnelPollMetrics(metricsText({ lastSuccess: now - 200_000, errors: 15 }));
  assert.equal(parsed.errorsTotal, 15);
  assert.deepEqual(parsed.errorKinds, { other: 15 });
  // tunnel-client prints the gauge with nine significant digits (10 s resolution).
  assert.ok(Math.abs(parsed.lastSuccessAtMs - (now - 200_000)) < 10_000);
  assert.equal(parseTunnelPollMetrics("go_goroutines 1\n"), null);
  const tracker = new TunnelPollHealth();
  // An adopted tunnel with an old failure history still gets the full window.
  assert.equal(tracker.observe(42, parsed, now).degraded, false);
  let verdict = tracker.observe(42, parsed, now + 76_000);
  assert.equal(verdict.degraded, true);
  assert.equal(verdict.changed, true);
  assert.equal(verdict.reason, "openai_unreachable");
  assert.match(verdict.detail, /check VPN/);
  assert.match(verdict.detail, /15 poll errors \(other=15\)/);
  verdict = tracker.observe(42, null, now + 80_000);
  assert.equal(verdict.degraded, true, "unobserved metrics never prove recovery");
  assert.equal(verdict.changed, false);
  verdict = tracker.observe(42, { ...parsed, lastSuccessAtMs: now + 85_000 }, now + 90_000);
  assert.equal(verdict.degraded, false);
  assert.equal(verdict.changed, true);
  assert.equal(tracker.observe(43, parsed, now + 900_000).degraded, false, "a new process starts a new window");
  const delays = [];
  for (let delay = 0, i = 0; i < 7; i++) delays.push(delay = recoveryBackoffDelay(delay));
  assert.deepEqual(delays, [15_000, 30_000, 60_000, 120_000, 240_000, 300_000, 300_000]);
}

function monitorHarness(observe) {
  const monitored = Object.create(RuntimeSupervisor.prototype);
  const calls = { recoveries: 0, reports: [], capabilities: [] };
  Object.assign(monitored, { launcherProfile: "development", logger, stopping: false,
    tunnel: { pid: 4242 }, tunnelMonitorGeneration: 0, tunnelMonitorTimer: null,
    tunnelMonitorInFlight: false, restartTimers: { tunnel: null }, lastChildFailure: { tunnel: null },
    tunnelPollDegraded: null, observeTunnelForMonitor: observe,
    reportTunnelStatus: async (_config, ready) => { calls.reports.push(ready); return null; },
    updateCapabilities: (status, detail) => { calls.capabilities.push([status, detail]); },
    tryWriteState: () => true, publishOperation: () => {},
    scheduleRecovery: () => { calls.recoveries += 1; } });
  let tick;
  const original = global.setInterval;
  global.setInterval = callback => { tick = callback; const timer = original(() => {}, 10_000); timer.unref(); return timer; };
  try { monitored.startTunnelMonitor({ mode: "full", tunnel: {} }); } finally { global.setInterval = original; }
  return { monitored, calls, tick: async () => { tick(); await flush(); } };
}

async function monitorDecisions() {
  // P0-1: a stalled remote lookup is an unknown observation, never a failure.
  const blip = monitorHarness(async () => {
    throw new Error("Account tunnel process identity timed out after 5000ms");
  });
  for (let i = 0; i < 6; i++) await blip.tick();
  assert.equal(blip.calls.recoveries, 0);
  assert.equal(blip.monitored.tunnel.pid, 4242);
  assert.equal(blip.monitored.tunnelMonitorFailures, 0);
  // A process whose own endpoints stay silent for long is still recovered, boundedly.
  for (let i = 0; i < 3; i++) await blip.tick();
  assert.equal(blip.calls.recoveries, 1);
  blip.monitored.stopTunnelMonitor();

  // P1-5: an exited tunnel-client is recovered on the first observation.
  const dead = monitorHarness(async () => ({ statusKnown: true, ready: false, processRunning: false,
    state: "stopped", pid: 4242, detail: "account tunnel process 4242 exited" }));
  await dead.tick();
  assert.equal(dead.calls.recoveries, 1);
  assert.equal(dead.monitored.tunnel, null);
  dead.monitored.stopTunnelMonitor();

  // P0-2: ready locally but no OpenAI poll: degrade with a reason, never restart.
  let poll = { degraded: true, reason: "openai_unreachable", detail: "OpenAI unreachable — check VPN or network connection: x",
    silentMs: 90_000, errorsTotal: 4 };
  const offline = monitorHarness(async () => ({ statusKnown: true, ready: true, pid: 4242, poll }));
  await offline.tick();
  await offline.tick();
  assert.equal(offline.calls.recoveries, 0);
  assert.deepEqual(offline.calls.reports, [false, false]);
  assert.deepEqual(offline.calls.capabilities.at(-1), ["degraded", poll.detail]);
  assert.equal(offline.monitored.tunnelPollDegraded.reason, "openai_unreachable");
  assert.equal(logged("runtime.tunnel_poll_health_changed").length, 1);
  poll = { degraded: false, reason: null, detail: null };
  await offline.tick();
  assert.deepEqual(offline.calls.reports, [false, false, true]);
  assert.deepEqual(offline.calls.capabilities.at(-1), ["ready", null]);
  assert.equal(offline.monitored.tunnelPollDegraded, null);
  assert.equal(logged("runtime.tunnel_poll_health_changed").length, 2);
  offline.monitored.stopTunnelMonitor();
}

function recoveryBackoff() {
  const supervisor = Object.create(RuntimeSupervisor.prototype);
  const launches = [];
  const operations = [];
  Object.assign(supervisor, { logger, stopping: false, shutdownRequested: false, daemon: null,
    launcherProfile: "development", restartHistory: { daemon: [], tunnel: [] },
    restartTimers: { daemon: null, tunnel: null }, recoveryBackoffMs: { daemon: 0, tunnel: 0 },
    lastChildFailure: { tunnel: "Account tunnel process identity timed out after 5000ms" },
    tryWriteState: () => true, updateCapabilities: () => {}, publishOperation: op => operations.push(op),
    launchRecovery: name => launches.push(name) });
  const delays = [];
  const original = global.setTimeout;
  global.setTimeout = (callback, ms) => { delays.push(ms); return { callback }; };
  try {
    for (let i = 0; i < 9; i++) {
      supervisor.scheduleRecovery("tunnel");
      const timer = supervisor.restartTimers.tunnel;
      assert.ok(timer, "recovery must stay scheduled after the fast budget");
      timer.callback();
    }
  } finally { global.setTimeout = original; }
  assert.deepEqual(delays, [1_000, 2_000, 3_000, 4_000, 5_000, 15_000, 30_000, 60_000, 120_000]);
  assert.equal(launches.length, 9);
  assert.equal(operations.some(op => op.status === "failed" || /disabled/.test(op.message)), false);
  assert.equal(logged("runtime.recovery_backoff").length, 4);
}

async function localOnlySupervision(root, endpoints) {
  const child = await liveChild();
  try {
    const { peer, config } = makePeer(root, "b");
    const calls = forbidControlCommands(peer);
    peer.ownedAliasVerified = true;
    peer.tunnel = { pid: child.pid, exitCode: null, signalCode: null, managed: true };
    peer.verifiedTunnel = { pid: child.pid, identity: processIdentity(child.pid) };
    peer.tunnelHealthBaseUrl = endpoints.baseUrl;
    const health = await peer.observeTunnelForMonitor(config);
    assert.equal(health.ready, true);
    assert.equal(health.pid, child.pid);
    assert.equal(health.poll.degraded, false);
    assert.deepEqual(calls, [], "owned-process supervision must not run tunnel-client commands");

    // Recovery after local failures keeps a tunnel that is healthy again.
    peer.writeState("degraded", "injected local failure");
    peer.tunnel = null;
    peer.startTunnel = async () => { throw new Error("a locally healthy tunnel must not be force-restarted"); };
    peer.waitForTunnel = async () => ({ ready: true, pid: child.pid });
    let monitorStarts = 0;
    peer.startTunnelMonitor = () => { monitorStarts += 1; };
    await peer.recover("tunnel", new AbortController().signal);
    assert.equal(monitorStarts, 1);
    assert.equal(peer.tunnel.pid, child.pid);
    assert.equal(peer.runtimeStatus, "ready");
    assert.ok(logged("runtime.account_tunnel_ready").some(([, , data]) => data.path === "kept-healthy"));

    // The orphan-proof marker alone also identifies the process for a stop.
    peer.tunnel = null;
    peer.writeState("degraded", "probe failed");
    await peer.adoptConfiguredTunnelForStop(config);
    assert.equal(peer.tunnel.pid, child.pid, "Quit adopts the owned process without a network lookup");
    assert.deepEqual(calls, []);

    await killChild(child);
    const dead = await peer.observeTunnelForMonitor(config);
    assert.equal(dead.statusKnown, true);
    assert.equal(dead.processRunning, false);
    assert.equal(dead.ready, false);
    assert.deepEqual(calls, []);
  } finally { await killChild(child); }
}

async function staleMarkerOrphan(root, endpoints) {
  const orphan = await liveChild();
  const replacement = await liveChild();
  try {
    const { peer, config, binding } = makePeer(root, "c");
    // A dead launcher's marker after a failed probe: status "failed", exact identity kept.
    fs.writeFileSync(peer.statePath, JSON.stringify({ version: 1, ownerPid: 999999999,
      ownerIdentity: "old-launcher", daemonPid: null, tunnelPid: orphan.pid,
      tunnelIdentity: processIdentity(orphan.pid), status: "failed",
      detail: "Tunnel health probe failed", updatedAt: new Date().toISOString(),
      accountId: binding.accountId, interactionMode: binding.interactionMode,
      tunnelId: binding.tunnel.tunnelId, alias: binding.tunnel.alias }));
    let phase = "orphan";
    const commands = [];
    const entry = () => phase === "stopped" ? [] : [{ alias: binding.tunnel.alias,
      tunnel_id: binding.tunnel.tunnelId, runtime_state: "ready",
      profile: { name: "profile", dir: binding.tunnel.profileDir },
      live_runtime: phase === "orphan" ? { found: false }
        : { found: true, base_url: endpoints.baseUrl, system: { pid: replacement.pid } } }];
    peer.runtimeCommand = argv => ({ executable: "/tmp/runtime", args: argv });
    peer.startTunnelMonitor = () => {};
    peer.runTunnelCommand = async (_config, argv) => {
      commands.push(argv.slice(0, 2).join(" "));
      if (argv[1] === "cleanup") return { code: 0, output: JSON.stringify({ entries: entry() }) };
      if (argv[1] === "stop") {
        assert.equal(phase, "orphan");
        phase = "stopped";
        await killChild(orphan);
        return { code: 0, output: "stopped" };
      }
      if (argv[1] === "connect") { phase = "connected"; return { code: 0, output: "{}" }; }
      throw new Error(`Account tunnel process identity timed out after 5000ms (${argv.join(" ")})`);
    };
    await peer.startTunnel({ ...config, brokerSocketPath: path.join(root, "broker.sock"),
      releaseVersion: "test", browserInteractionMode: "automatic", appName: "Codex Test" }, "runtime-start");
    assert.equal(orphan.exitCode !== null || orphan.signalCode !== null, true, "the orphan was stopped");
    assert.equal(peer.tunnel.pid, replacement.pid, "a fresh tunnel replaced the orphan");
    assert.equal(peer.ownedAliasVerified, true);
    assert.equal(peer.verifiedTunnel.pid, replacement.pid);
    assert.equal(commands.includes("runtimes status"), false, "no remote lookup was needed");
    assert.ok(commands.includes("runtimes stop") && commands.includes("runtimes connect"));
    assert.ok(logged("runtime.account_tunnel_ready").some(([, , data]) => data.path === "replaced-stale"
      && data.accountId === binding.accountId && Number.isFinite(data.ms)));
  } finally { await killChild(orphan); await killChild(replacement); }
}

async function reconnectAction(root) {
  const { peer, binding, config } = makePeer(root, "d", "default");
  const parentConfig = { mode: "full", accountTunnelMode: true, browserInteractionMode: "automatic",
    automaticAppName: "Codex Test", accountTunnels: [binding] };
  const supervisor = new AccountTunnelSupervisor({ logger, readConfig: () => parentConfig,
    peerFactory: () => peer }, () => {});
  supervisor.configure(parentConfig);
  // A peer waiting out recovery backoff is eligible for an immediate Reconnect.
  peer.runtimeStatus = "failed";
  peer.restartTimers.tunnel = setTimeout(() => { throw new Error("backoff timer must be cleared"); }, 600_000);
  peer.recoveryBackoffMs.tunnel = 120_000;
  peer.restartHistory.tunnel = [Date.now(), Date.now()];
  peer.tunnelPollHealth.observe(null, null);
  let forced = null;
  peer.recover = async () => {
    forced = peer.reconnectRequested;
    peer.tunnel = { pid: process.pid, exitCode: null, signalCode: null, managed: true };
    peer.updateCapabilities("ready", null, config);
  };
  const parent = Object.create(RuntimeSupervisor.prototype);
  Object.assign(parent, { logger, launcherProfile: "production", stopping: false, shutdownRequested: false,
    startPromise: null, stopPromise: null, tunnelRepairPromise: null, accountTunnelSupervisor: supervisor,
    recoveryTasks: new Set(), recoveryControllers: new Set(), restartTimers: { daemon: null, tunnel: null },
    runtimeStatus: "ready", runtimeDetail: null, readConfig: () => parentConfig,
    updateCapabilities: () => {}, publishAccountTunnelCapabilities: () => {}, publishOperation: () => {} });
  assert.deepEqual(parent.tunnelRepairSnapshot(parentConfig),
    { eligible: true, reason: "account-tunnel-reconnect-available", active: false });
  assert.equal(supervisor.getStatus(binding.accountId, "automatic").status, "error");
  assert.match(supervisor.getStatus(binding.accountId, "automatic").detail, /retrying automatically/);
  assert.deepEqual(await parent.repairWebRoute(), { status: "recovered", reason: null });
  assert.equal(forced, true, "an explicit Reconnect restarts instead of keeping the old process");
  assert.equal(peer.restartTimers.tunnel, null);
  assert.equal(peer.recoveryBackoffMs.tunnel, 0);
  assert.equal(supervisor.getStatus(binding.accountId, "automatic").ready, true);
  assert.equal(parent.tunnelRepairSnapshot(parentConfig).eligible, false);

  // OpenAI unreachable: the account stays visible as not ready with its cause.
  peer.tunnelPollDegraded = { reason: "openai_unreachable", detail: "OpenAI unreachable — check VPN or network connection" };
  const offline = supervisor.getStatus(binding.accountId, "automatic");
  assert.equal(offline.ready, false);
  assert.equal(offline.reason, "openai_unreachable");
  assert.match(offline.detail, /check VPN/);
  const view = require("../electron/account-tunnels.cjs").accountTunnelView(parentConfig, binding.accountId,
    "automatic", offline, null);
  assert.equal(view.reason, "openai_unreachable");
  peer.tunnelPollDegraded = null;
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nekodex-tunnel-resilience-"));
  const endpoints = await stubTunnelEndpoints();
  try {
    pureHelpers();
    await monitorDecisions();
    recoveryBackoff();
    await localOnlySupervision(root, endpoints);
    await staleMarkerOrphan(root, endpoints);
    await reconnectAction(root);
    console.log("account tunnel resilience smoke passed");
  } finally {
    endpoints.server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
