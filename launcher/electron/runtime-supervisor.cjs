const { conciseTunnelLog, tunnelConnectCanContinue, tunnelControlDiagnostic, managedTunnelConnectArgs } = require("./runtime-tunnel-policy.cjs");
const { collectRuntimeLines: collectLines } = require("./runtime-output.cjs");
const { absolutePath, validateConfig, normalizeSetupConfig } = require("./runtime-config-contract.cjs");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { isDeepStrictEqual } = require("node:util");
const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");
const { writePrivateFileAtomic } = require("./atomic-file.cjs");
const { redactText } = require("./logging.cjs");
const {
  DETACH_OWNED_CHILD,
  processRunning,
  terminateOwnedProcessTree,
} = require("./process-tree.cjs");
const { runtimeInvocation } = require("./runtime-command.cjs");
const { ASYNC_CONNECTOR_NAME, ASYNC_DEV_CONNECTOR_NAME } = require("./connector-identity.cjs");

const RESTART_WINDOW_MS = 60_000;
const MAX_RESTARTS_PER_WINDOW = 5;
const MAX_CONTROL_OUTPUT_BYTES = 1024 * 1024;
const DRAIN_IDLE_TIMEOUT_MS = 15_000;
const DRAIN_POLL_INTERVAL_MS = 100;
const TUNNEL_START_TIMEOUT_MS = 120_000;
const RECOVERY_SHUTDOWN_SETTLEMENT_MS = 3_000;
const TUNNEL_HEALTH_POLL_INTERVAL_MS = 1_000;
const TUNNEL_MONITOR_INTERVAL_MS = 10_000;
const TUNNEL_MONITOR_FAILURE_THRESHOLD = 3;
const TUNNEL_MCP_FAILURE_RECENCY_MS = 2 * 60_000;
const TUNNEL_REPAIR_HEALTH_FRESH_MS = 5_000;
const BOOT_TIME_CLOCK_TOLERANCE_MS = 5_000;
const CURRENT_BOOT_STARTED_AT_MS = Date.now() - (os.uptime() * 1_000);

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function loopbackHealthBaseURL(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:"
      || !["127.0.0.1", "[::1]", "::1"].includes(parsed.hostname)
      || !parsed.port) return null;
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

function readJson(pathname) {
  return JSON.parse(fs.readFileSync(pathname, "utf8"));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function appendFailure(primary, label, failure) {
  return `${primary}; ${label}: ${errorMessage(failure)}`;
}

function tunnelRuntimeAbsent(value) {
  return /not found|not running|unknown alias|\balias\b[^\r\n]{0,160}\bis not known\b/i.test(
    String(value || ""),
  );
}

function tunnelRuntimeStopped(health) {
  return health?.absent === true
    || (health?.state === "stopped" && health?.processRunning === false);
}

function runtimeOwnershipPredatesCurrentBoot(state) {
  return Boolean(
    state
    && Date.parse(state.updatedAt) < CURRENT_BOOT_STARTED_AT_MS - BOOT_TIME_CLOCK_TOLERANCE_MS
  );
}

function runtimeOwnershipMayBeLive(state) {
  if (!state || runtimeOwnershipPredatesCurrentBoot(state)) return false;
  if (processRunning(state.daemonPid) || processRunning(state.tunnelPid)) return true;
  return ["starting", "ready", "degraded", "stopping"].includes(state.status);
}

class RuntimeSupervisor {
  constructor({
    app,
    logger,
    sourceRoot,
    installedRuntimeRoot,
    runtimeRootProvider,
    coreHome,
    browserDescriptorPath,
    launcherProfile = "production",
    publishOperation,
    publishCapabilities,
    runtimeInvocationFactory = runtimeInvocation,
    nativeProxyEnvironmentProvider = async () => ({}),
    tunnelProxyEnvironmentProvider = async () => ({}),
  }) {
    this.app = app;
    this.logger = logger;
    this.sourceRoot = sourceRoot;
    this.installedRuntimeRoot = installedRuntimeRoot;
    this.runtimeRootProvider = runtimeRootProvider;
    this.coreHome = coreHome;
    this.browserDescriptorPath = browserDescriptorPath;
    if (launcherProfile !== "production" && launcherProfile !== "development") {
      throw new Error("Runtime supervisor launcher profile is invalid");
    }
    this.launcherProfile = launcherProfile;
    this.publishOperation = publishOperation;
    this.publishCapabilities = publishCapabilities;
    this.runtimeInvocationFactory = runtimeInvocationFactory;
    this.nativeProxyEnvironmentProvider = nativeProxyEnvironmentProvider;
    this.tunnelProxyEnvironmentProvider = tunnelProxyEnvironmentProvider;
    this.configPath = path.join(coreHome, "config.json");
    this.statePath = path.join(coreHome, "runtime", "launcher-supervisor.json");
    this.daemon = null;
    this.daemonInstanceId = null;
    this.tunnel = null;
    this.stopping = false;
    this.startPromise = null;
    this.startController = null;
    this.stopPromise = null;
    this.restartHistory = { daemon: [], tunnel: [] };
    this.restartTimers = { daemon: null, tunnel: null };
    this.tunnelMonitorTimer = null;
    this.tunnelMonitorInFlight = false;
    this.tunnelMonitorFailures = 0;
    this.tunnelMonitorObservationUnavailable = false;
    this.tunnelMonitorGeneration = 0;
    this.tunnelHealthBaseUrl = null;
    this.tunnelControlQueue = Promise.resolve();
    this.tunnelStatusQueue = Promise.resolve();
    this.tunnelStatusRevision = 0;
    this.tunnelControlChildren = new Set();
    this.tunnelControlControllers = new Map();
    this.recoveryTasks = new Set();
    this.recoveryControllers = new Set();
    this.shutdownRequested = false;
    this.shutdownResumeAllowed = false;
    this.recoveryAliasMayBeLive = false;
    this.expectedExits = new WeakSet();
    this.restartableChildren = new WeakSet();
    this.lastChildFailure = { daemon: null, tunnel: null };
    this.lastChildOutput = { daemon: null, tunnel: null };
    this.capabilityRevision = 0;
    this.runtimeStatus = "unconfigured";
    this.runtimeDetail = null;
    this.nativeAccepting = null;
    this.webAccepting = null;
    this.brokerReady = null;
    this.reportedTunnelReady = null;
    this.lastOwnedHealth = null;
    this.lastOwnedHealthAt = 0;
    this.tunnelRepairPromise = null;
  }

  tunnelRepairSnapshot(config = undefined) {
    let current = config;
    if (current === undefined) {
      try { current = this.readConfig(); } catch { current = null; }
    }
    const active = this.tunnelRepairPromise !== null;
    const unavailable = reason => ({ eligible: false, reason, active });
    if (active) return unavailable("repair-active");
    if (this.launcherProfile !== "production") return unavailable("production-only");
    if (!current || current.mode !== "full") return unavailable("full-mode-required");
    if (current.browserInteractionMode !== "automatic") return unavailable("automatic-mode-required");
    if (this.stopping || this.shutdownRequested || this.startPromise || this.stopPromise
      || this.recoveryTasks.size > 0 || this.restartTimers.daemon || this.restartTimers.tunnel) {
      return unavailable("runtime-transition-active");
    }
    const health = this.lastOwnedHealth;
    if (!health || Date.now() - this.lastOwnedHealthAt > TUNNEL_REPAIR_HEALTH_FRESH_MS
      || (this.daemonInstanceId && health.instance_id !== this.daemonInstanceId)) {
      return unavailable("health-refresh-required");
    }
    if (this.nativeAccepting !== true) return unavailable("native-route-unavailable");
    if (this.brokerReady !== true) return unavailable("broker-unavailable");
    if (this.webAccepting === true && this.reportedTunnelReady === true) return unavailable("web-route-ready");
    if (this.reportedTunnelReady !== false) return unavailable("tunnel-state-unknown");
    if (health.active_browser_turns !== 0 || health.active_compaction_runs !== 0) {
      return unavailable("web-work-active");
    }
    return { eligible: true, reason: "tunnel-repair-available", active: false };
  }

  capabilitySnapshot(config = undefined) {
    let current = config;
    if (current === undefined) {
      try { current = this.readConfig(); } catch { current = null; }
    }
    const nativeReady = Boolean(this.daemon && this.daemon.exitCode === null && this.daemon.signalCode === null);
    const tunnelRequired = current?.mode === "full";
    const tunnelReady = Boolean(this.tunnel && this.tunnel.exitCode === null && this.tunnel.signalCode === null
      && this.reportedTunnelReady !== false);
    const webReady = nativeReady && tunnelReady && this.brokerReady === true && this.webAccepting === true;
    return {
      revision: this.capabilityRevision,
      runtimeStatus: this.runtimeStatus,
      nativeAvailability: this.launcherProfile === "development"
        ? "unavailable" : nativeReady && this.nativeAccepting !== false ? "ready" : this.runtimeStatus === "starting" ? "unknown" : "unavailable",
      webAvailability: this.launcherProfile === "development"
        ? !tunnelRequired ? "ready" : tunnelReady ? "ready" : "degraded"
        : !tunnelRequired ? nativeReady && this.webAccepting !== false ? "ready" : "unavailable" : webReady ? "ready" : nativeReady ? "degraded" : "unavailable",
      tunnelStatus: !tunnelRequired ? "absent" : tunnelReady ? "ready"
        : ["starting", "recovering", "stopping"].includes(this.runtimeStatus) ? this.runtimeStatus : "degraded",
      releaseVersion: current?.releaseVersion ?? null,
      daemonPid: this.daemon?.pid ?? null,
      tunnelPid: this.tunnel?.pid ?? null,
      brokerReady: this.brokerReady,
      tunnelReady: this.reportedTunnelReady,
      detail: this.runtimeDetail,
      tunnelRepair: this.tunnelRepairSnapshot(current),
    };
  }

  updateCapabilities(runtimeStatus, detail = null, config = undefined) {
    this.runtimeStatus = runtimeStatus;
    this.runtimeDetail = detail;
    this.capabilityRevision += 1;
    const snapshot = this.capabilitySnapshot(config);
    this.publishCapabilities?.(snapshot);
    return snapshot;
  }

  readConfig() {
    if (!fs.existsSync(this.configPath)) return null;
    return validateConfig(
      readJson(this.configPath),
      this.browserDescriptorPath,
      this.platform,
      this.launcherProfile,
    );
  }

  readSetupConfig() {
    if (!fs.existsSync(this.configPath)) return null;
    return normalizeSetupConfig(readJson(this.configPath), this.launcherProfile);
  }

  readState() {
    if (!fs.existsSync(this.statePath)) return null;
    try {
      const state = readJson(this.statePath);
      const validPid = (value) => value === null || (Number.isInteger(value) && value > 0);
      if (!state
        || state.version !== 1
        || !Number.isInteger(state.ownerPid)
        || state.ownerPid < 1
        || !validPid(state.daemonPid)
        || !validPid(state.tunnelPid)
        || typeof state.status !== "string"
        || typeof state.updatedAt !== "string"
        || Number.isNaN(Date.parse(state.updatedAt))) {
        throw new Error("state shape is invalid");
      }
      return state;
    } catch (error) {
      throw new Error(`Launcher runtime ownership state is invalid at ${this.statePath}: ${errorMessage(error)}`);
    }
  }

  snapshot(status = "idle", detail) {
    return {
      version: 1,
      ownerPid: process.pid,
      daemonPid: this.daemon?.pid ?? null,
      tunnelPid: this.tunnel?.pid ?? null,
      status,
      ...(this.daemonInstanceId ? { daemonInstanceId: this.daemonInstanceId } : {}),
      ...(detail ? { detail } : {}),
      updatedAt: new Date().toISOString(),
    };
  }

  writeState(status, detail) {
    const state = this.snapshot(status, detail);
    writePrivateFileAtomic(this.statePath, `${JSON.stringify(state, null, 2)}\n`);
    return state;
  }

  tryWriteState(status, detail) {
    try {
      this.writeState(status, detail);
      return true;
    } catch (error) {
      const message = `Could not persist launcher runtime ownership: ${errorMessage(error)}`;
      this.stopping = true;
      for (const name of ["daemon", "tunnel"]) {
        if (this.restartTimers[name]) {
          clearTimeout(this.restartTimers[name]);
          this.restartTimers[name] = null;
        }
      }
      this.logger.error("runtime.state_write_failed", { status, message });
      this.publishOperation?.({ name: "runtime-supervisor", status: "failed", message });
      return false;
    }
  }

  tryWriteRepairState(status, detail) {
    try {
      this.writeState(status, detail);
      return true;
    } catch (error) {
      this.logger.warn("runtime.web_route_repair_state_failed", { message: errorMessage(error) });
      return false;
    }
  }

  clearState() {
    fs.rmSync(this.statePath, { force: true });
  }

  prepareExternalMigration() {
    if (this.daemon || this.tunnel) {
      throw new Error("Launcher-owned runtime children exist while an external installation is configured");
    }
    const state = this.readState();
    if (state && !runtimeOwnershipPredatesCurrentBoot(state) && (
      processRunning(state.ownerPid)
      || processRunning(state.daemonPid)
      || processRunning(state.tunnelPid)
    )) {
      throw new Error("Launcher ownership processes are still alive while an external installation is configured");
    }
    this.clearState();
  }

  writeExternalState(detail) {
    const existing = this.readState();
    const preservesLiveOwnership = existing && !runtimeOwnershipPredatesCurrentBoot(existing) && (
      processRunning(existing.ownerPid)
      || processRunning(existing.daemonPid)
      || processRunning(existing.tunnelPid)
    );
    if (!preservesLiveOwnership) this.writeState("external", detail);
  }

  spawnChild(name, invocation, recoverySignal) {
    this.assertCanStart(recoverySignal);
    const background = name === "daemon" && this.launcherProfile === "production";
    if (name === "daemon") this.daemonInstanceId = null;
    const child = spawn(invocation.executable, invocation.args, {
      cwd: invocation.cwd,
      detached: background || DETACH_OWNED_CHILD,
      env: {
        ...process.env,
        ...invocation.env,
        CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR: this.browserDescriptorPath,
        ...(background ? { CODEX_CHATGPT_WEB_BACKGROUND_RUNTIME: "1" } : {}),
      },
      // A GUI-owned pipe can close underneath a surviving daemon after an app crash.
      // Lifecycle diagnostics stay in the launcher log and authenticated runtime status.
      stdio: background ? "ignore" : ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    this[name] = child;
    this.lastChildFailure[name] = null;
    this.lastChildOutput[name] = null;
    if (child.stdout) collectLines(child.stdout, (line) => {
      this.lastChildOutput[name] = redactText(line).slice(0, 1_000);
      this.logger.info(`runtime.${name}_stdout`, { line });
    }, (error) => {
      this.logger.warn(`runtime.${name}_stdout_unavailable`, { message: errorMessage(error) });
    });
    if (child.stderr) collectLines(child.stderr, (line) => {
      this.lastChildOutput[name] = redactText(line).slice(0, 1_000);
      this.logger.warn(`runtime.${name}_stderr`, { line });
    }, (error) => {
      this.logger.warn(`runtime.${name}_stderr_unavailable`, { message: errorMessage(error) });
    });
    let terminalHandled = false;
    const handleTerminal = ({ code = null, signal = null, error = null }) => {
      if (terminalHandled) return;
      terminalHandled = true;
      const expected = this.stopping || this.expectedExits.has(child);
      this.expectedExits.delete(child);
      const restartable = this.restartableChildren.has(child);
      this.restartableChildren.delete(child);
      if (this[name] === child) this[name] = null;
      const detail = error
        ? `${name} failed to start: ${error.message}`
        : `${name} exited (${signal || code})`
          + (this.lastChildOutput[name] ? `: ${this.lastChildOutput[name]}` : "");
      this.lastChildFailure[name] = detail;
      const statePersisted = this.tryWriteState(expected ? "stopping" : "degraded", detail);
      if (!expected) {
        this.updateCapabilities("degraded", detail);
        if (name === "tunnel") {
          let config;
          try { config = this.readConfig(); } catch {}
          if (config) void this.reportTunnelStatus(config, false).catch((statusError) => {
            this.logger.warn("runtime.tunnel_status_report_failed", { message: errorMessage(statusError) });
          });
        }
      }
      this.logger[expected ? "info" : "error"](
        error ? `runtime.${name}_spawn_failed` : `runtime.${name}_exited`,
        error ? { message: error.message } : { code, signal },
      );
      if (!expected && restartable && statePersisted) this.scheduleRecovery(name);
    };
    child.once("error", (error) => {
      if (!Number.isInteger(child.pid)) {
        handleTerminal({ error });
        return;
      }
      this.logger.error(`runtime.${name}_process_error`, { message: error.message, pid: child.pid });
    });
    child.once("exit", (code, signal) => handleTerminal({ code, signal }));
    this.logger.info(`runtime.${name}_started`, { pid: child.pid });
    this.writeState("starting");
    return child;
  }

  runtimeCommand(args, releaseVersion = this.app.getVersion()) {
    if (this.runtimeRootProvider) this.installedRuntimeRoot = this.runtimeRootProvider(releaseVersion);
    return this.runtimeInvocationFactory({
      app: this.app,
      sourceRoot: this.sourceRoot,
      installedRuntimeRoot: this.installedRuntimeRoot,
      args,
    });
  }

  assertTunnelClientReady(config) {
    const tunnel = config.tunnel;
    if (!tunnel || !fs.existsSync(tunnel.binaryPath)) {
      throw new Error(`Tunnel client is missing: ${tunnel?.binaryPath || "not configured"}`);
    }
    if (!fs.existsSync(tunnel.runtimeKeyFile)) {
      throw new Error(`Tunnel runtime key is missing: ${tunnel.runtimeKeyFile}`);
    }
  }

  async proxyHealthPayload(config, timeoutMs = 2_000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`http://${config.host}:${config.port}/healthz`, { signal: controller.signal });
      if (!response.ok) return null;
      const body = await response.json();
      if (this.ownedHealthMatches(config, body)) {
        this.lastOwnedHealth = body;
        this.lastOwnedHealthAt = Date.now();
      }
      return body;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  nativeHealthAccepting(payload) {
    return payload?.native_accepting_turns === true
      || (payload?.native_accepting_turns === undefined && payload?.accepting_turns === true);
  }

  reportTunnelStatus(config, ready, recoverySignal, isCurrent = () => true) {
    const pending = this.tunnelStatusQueue.then(() =>
      this.performReportTunnelStatus(config, ready, recoverySignal, isCurrent));
    this.tunnelStatusQueue = pending.catch(() => {});
    return pending;
  }

  async performReportTunnelStatus(config, ready, recoverySignal, isCurrent) {
    if (this.launcherProfile === "development" || config?.mode !== "full" || !this.daemon) return null;
    this.assertRecoveryActive(recoverySignal);
    if (isCurrent() !== true) return { capabilityChanged: false, stale: true };
    const revision = this.tunnelStatusRevision + 1;
    if (!Number.isSafeInteger(revision) || revision < 1) {
      throw new Error("Tunnel capability status revision is exhausted");
    }
    // Reserve before I/O. A timeout may hide an applied server mutation, so no later
    // transition may reuse this revision even when this request rejects locally.
    this.tunnelStatusRevision = revision;
    let result;
    try {
      result = await this.control(config, "tunnel-status", {
        body: { ready: ready === true, revision },
      });
    } catch (error) {
      if (config.releaseVersion !== this.app.getVersion() && /HTTP 404\b/.test(errorMessage(error))) return null;
      throw error;
    }
    this.assertRecoveryActive(recoverySignal);
    if (isCurrent() !== true) return { ...result, capabilityChanged: false, stale: true };
    if (result === null) return null;
    if (result.status !== "ok"
      || result.native_accepting_turns !== true
      || typeof result.web_accepting_turns !== "boolean"
      || typeof result.broker_ready !== "boolean"
      || typeof result.tunnel_ready !== "boolean") {
      throw new Error("Responses proxy did not acknowledge tunnel capability state");
    }
    const echoedRevision = result.tunnel_status_revision;
    if (echoedRevision === undefined) {
      if (config.releaseVersion === this.app.getVersion()) {
        throw new Error("Responses proxy did not acknowledge the tunnel capability status revision");
      }
    } else {
      if (!Number.isSafeInteger(echoedRevision) || echoedRevision < 1) {
        throw new Error("Responses proxy returned an invalid tunnel capability status revision");
      }
      this.tunnelStatusRevision = Math.max(this.tunnelStatusRevision, echoedRevision);
      if (echoedRevision > revision || this.tunnelStatusRevision > revision) {
        return { ...result, capabilityChanged: false, stale: true };
      }
      if (echoedRevision < revision) {
        throw new Error("Responses proxy returned an older tunnel capability status revision");
      }
    }
    if (result.tunnel_ready !== (ready === true)) {
      throw new Error("Responses proxy rejected a conflicting tunnel capability status revision");
    }
    const capabilityChanged = this.nativeAccepting !== result.native_accepting_turns
      || this.webAccepting !== result.web_accepting_turns
      || this.brokerReady !== result.broker_ready
      || this.reportedTunnelReady !== result.tunnel_ready;
    this.nativeAccepting = result.native_accepting_turns;
    this.webAccepting = result.web_accepting_turns;
    this.brokerReady = result.broker_ready;
    this.reportedTunnelReady = result.tunnel_ready;
    return { ...result, capabilityChanged };
  }

  catalogHealthIsCurrent(config, payload) {
    try {
      const currentConfig = this.readConfig();
      const state = this.readState();
      const daemon = this.daemon;
      const pid = daemon?.pid;
      return Boolean(currentConfig
        && config
        && isDeepStrictEqual(config, currentConfig)
        && !this.stopping
        && !this.shutdownRequested
        && state
        && !runtimeOwnershipPredatesCurrentBoot(state)
        && state.ownerPid === process.pid
        && state.daemonPid === pid
        && ["ready", "degraded"].includes(state.status)
        && Number.isSafeInteger(pid)
        && pid > 0
        && daemon.exitCode === null
        && daemon.signalCode === null
        && processRunning(pid)
        && payload?.service === "codex-chatgpt-web"
        && payload?.status === "ok"
        && payload?.version === config.releaseVersion
        && payload?.mode === config.mode
        && this.nativeHealthAccepting(payload)
        && payload?.pid === pid);
    } catch {
      return false;
    }
  }

  async proxyHealth(config, timeoutMs = 2_000, expectedPid, requireAccepting = false) {
    const body = await this.proxyHealthPayload(config, timeoutMs);
    const matches = body?.service === "codex-chatgpt-web"
      && body?.status === "ok"
      && body?.mode === config.mode
      && body?.version === config.releaseVersion
      && (expectedPid === undefined || body?.pid === expectedPid);
    if (matches && expectedPid !== undefined && this.daemon?.pid === expectedPid) {
      if (typeof body.instance_id === "string" && /^[a-f0-9-]{36}$/.test(body.instance_id)) {
        this.daemonInstanceId = body.instance_id;
      }
      if (Number.isSafeInteger(body.tunnel_status_revision) && body.tunnel_status_revision >= 0) {
        this.tunnelStatusRevision = Math.max(this.tunnelStatusRevision, body.tunnel_status_revision);
      }
      this.nativeAccepting = this.nativeHealthAccepting(body);
      this.webAccepting = typeof body.web_accepting_turns === "boolean" ? body.web_accepting_turns : body.accepting_turns === true;
      this.brokerReady = typeof body.broker_ready === "boolean" ? body.broker_ready : null;
      this.reportedTunnelReady = typeof body.tunnel_ready === "boolean" ? body.tunnel_ready : this.reportedTunnelReady;
      this.lastOwnedHealth = body;
      this.lastOwnedHealthAt = Date.now();
    }
    return matches && (!requireAccepting || this.nativeHealthAccepting(body));
  }

  ownedHealthMatches(config, health, daemon = this.daemon) {
    return Boolean(config && daemon && Number.isInteger(daemon.pid)
      && daemon.exitCode === null && daemon.signalCode === null
      && health?.service === "codex-chatgpt-web" && health.status === "ok"
      && health.version === config.releaseVersion && health.mode === config.mode
      && health.pid === daemon.pid
      && (!this.daemonInstanceId || health.instance_id === this.daemonInstanceId));
  }

  async repairWebRoute() {
    if (this.tunnelRepairPromise) return this.tunnelRepairPromise;
    if (this.stopping || this.shutdownRequested || this.startPromise || this.stopPromise
      || this.recoveryTasks.size > 0 || this.restartTimers.daemon || this.restartTimers.tunnel) {
      return { status: "unavailable", reason: "runtime-transition-active" };
    }
    const controller = new AbortController();
    const repair = this.performWebRouteRepair(controller.signal).catch(error => {
      const reason = errorMessage(error);
      this.logger.warn("runtime.web_route_repair_unavailable", { message: reason });
      return { status: "unavailable", reason };
    });
    this.tunnelRepairPromise = repair;
    this.recoveryControllers.add(controller);
    this.recoveryTasks.add(repair);
    this.updateCapabilities(this.runtimeStatus, this.runtimeDetail);
    void repair.finally(() => {
      this.recoveryControllers.delete(controller);
      this.recoveryTasks.delete(repair);
      if (this.tunnelRepairPromise === repair) this.tunnelRepairPromise = null;
      this.updateCapabilities(this.runtimeStatus, this.runtimeDetail);
    }).catch(() => {});
    return repair;
  }

  async performWebRouteRepair(signal) {
    this.assertRecoveryActive(signal);
    const config = this.readConfig();
    const daemon = this.daemon;
    const health = await this.proxyHealthPayload(config);
    this.assertRecoveryActive(signal);
    if (!this.ownedHealthMatches(config, health, daemon)) {
      return { status: "unavailable", reason: "owned-health-unavailable" };
    }
    this.lastOwnedHealth = health;
    this.lastOwnedHealthAt = Date.now();
    const eligibility = this.tunnelRepairSnapshot(config);
    // The operation itself owns the single-flight marker; ignore only that marker after
    // all other eligibility facts have been recomputed from fresh owned health.
    if (!eligibility.eligible && eligibility.reason !== "repair-active") {
      return { status: "unavailable", reason: eligibility.reason };
    }
    if (this.launcherProfile !== "production") return { status: "unavailable", reason: "production-only" };
    if (config.mode !== "full") return { status: "unavailable", reason: "full-mode-required" };
    if (config.browserInteractionMode !== "automatic") return { status: "unavailable", reason: "automatic-mode-required" };
    if (health.native_accepting_turns !== true) return { status: "unavailable", reason: "native-route-unavailable" };
    if (health.broker_ready !== true) return { status: "unavailable", reason: "broker-unavailable" };
    if (health.web_accepting_turns === true && health.tunnel_ready === true) {
      return { status: "unavailable", reason: "web-route-ready" };
    }
    if (health.tunnel_ready !== false) return { status: "unavailable", reason: "tunnel-state-unknown" };
    if (health.active_browser_turns !== 0 || health.active_compaction_runs !== 0) {
      return { status: "unavailable", reason: "web-work-active" };
    }
    if (this.stopping || this.shutdownRequested || this.startPromise || this.stopPromise
      || this.recoveryTasks.size !== 1 || this.restartTimers.daemon || this.restartTimers.tunnel) {
      return { status: "unavailable", reason: "runtime-transition-active" };
    }
    const currentConfig = this.readConfig();
    const ownership = this.readState();
    if (!isDeepStrictEqual(config, currentConfig) || this.daemon !== daemon
      || !ownership || ownership.ownerPid !== process.pid || ownership.daemonPid !== daemon.pid
      || (this.tunnel?.pid && ownership.tunnelPid !== this.tunnel.pid)) {
      return { status: "unavailable", reason: "runtime-identity-changed" };
    }
    this.publishOperation?.({ name: "web-route-repair", status: "running",
      message: "Repairing the Web tool tunnel while keeping the Native route available" });
    const unavailable = reason => {
      this.updateCapabilities("degraded", reason, config);
      this.publishOperation?.({ name: "web-route-repair", status: "failed", message: reason });
      return { status: "unavailable", reason };
    };
    let finalHealthProven = false;
    this.stopTunnelMonitor();
    try {
      await this.tunnelStatusQueue.catch(() => {});
      this.assertRecoveryActive(signal);
      const fence = await this.reportTunnelStatus(config, false, signal);
      if (!fence || fence.stale === true || fence.applied !== true || fence.tunnel_ready !== false) {
        return unavailable("web-admission-fence-unavailable");
      }
      // Closing Web admission is the ownership boundary. Recheck after it so a turn that
      // entered between the first health read and the status mutation cannot lose its tunnel.
      const quiescentHealth = await this.proxyHealthPayload(config);
      this.assertRecoveryActive(signal);
      if (!isDeepStrictEqual(config, this.readConfig()) || this.daemon !== daemon
        || !this.ownedHealthMatches(config, quiescentHealth, daemon)) {
        return unavailable("runtime-identity-changed");
      }
      if (quiescentHealth.native_accepting_turns !== true || quiescentHealth.broker_ready !== true) {
        return unavailable("native-route-unavailable");
      }
      if (quiescentHealth.active_browser_turns !== 0 || quiescentHealth.active_compaction_runs !== 0) {
        return unavailable("web-work-active");
      }
      await this.startTunnel(config, "web-route-repair", {
        forceRestart: true, recoverySignal: signal, startMonitor: false,
      });
      const reopened = await this.reportTunnelStatus(config, true, signal);
      if (!reopened || reopened.stale === true || reopened.applied !== true || reopened.tunnel_ready !== true) {
        throw new Error("Responses proxy did not confirm the repaired Web admission state");
      }
      const finalHealth = await this.proxyHealthPayload(config);
      this.assertRecoveryActive(signal);
      if (!isDeepStrictEqual(config, this.readConfig()) || this.daemon !== daemon
        || !this.ownedHealthMatches(config, finalHealth, daemon)
        || finalHealth.native_accepting_turns !== true
        || finalHealth.web_accepting_turns !== true
        || finalHealth.broker_ready !== true || finalHealth.tunnel_ready !== true) {
        throw new Error("Fresh owned health did not confirm Web tunnel recovery");
      }
      this.lastOwnedHealth = finalHealth;
      this.lastOwnedHealthAt = Date.now();
      this.nativeAccepting = true;
      this.webAccepting = true;
      this.brokerReady = true;
      this.reportedTunnelReady = true;
      finalHealthProven = true;
      if (!this.tryWriteRepairState("ready")) {
        const reason = "Web tunnel recovered but ownership state could not be persisted";
        this.updateCapabilities("ready", reason, config);
        this.publishOperation?.({ name: "web-route-repair", status: "failed", message: reason });
        return { status: "unavailable", reason };
      }
      this.updateCapabilities("ready", null, config);
      this.publishOperation?.({ name: "web-route-repair", status: "completed",
        message: "Web tool tunnel recovered; the Native route remained available" });
      return { status: "recovered", reason: null };
    } catch (error) {
      const reason = errorMessage(error);
      if (!finalHealthProven) {
        this.webAccepting = false;
        this.reportedTunnelReady = false;
      }
      this.tryWriteRepairState("degraded", reason);
      this.updateCapabilities("degraded", reason, config);
      this.publishOperation?.({ name: "web-route-repair", status: "failed", message: reason });
      return { status: "unavailable", reason };
    } finally {
      if (!this.stopping && !this.shutdownRequested && this.daemon === daemon) {
        try {
          if (isDeepStrictEqual(config, this.readConfig())) this.startTunnelMonitor(config);
        } catch (error) {
          this.logger.warn("runtime.web_route_repair_monitor_restore_failed", { message: errorMessage(error) });
        }
      }
    }
  }

  async waitForProxy(config, timeoutMs = 20_000, recoverySignal) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      this.assertRecoveryActive(recoverySignal);
      const daemon = this.daemon;
      if (!daemon) {
        throw new Error(this.lastChildFailure.daemon || "Responses proxy exited before becoming healthy");
      }
      if (!Number.isInteger(daemon.pid)) {
        await sleep(50);
        continue;
      }
      if (await this.proxyHealth(config, 2_000, daemon.pid, true)) {
        this.assertRecoveryActive(recoverySignal);
        return;
      }
      await sleep(200);
    }
    throw new Error(`Responses proxy did not become healthy on 127.0.0.1:${config.port} within ${timeoutMs}ms`);
  }

  async readTunnelHealth(config, recoverySignal) {
    const tunnel = config.tunnel;
    // `runtimes status` performs an optional control-plane lookup when the saved runtime key is
    // available. The cleanup dry run is the official local-only inventory and never removes
    // entries without `--apply`, so proxy or control-plane failures cannot block supervision.
    const result = await this.runTunnelCommand(
      config,
      ["runtimes", "cleanup", "--json"],
      5_000,
      "Local tunnel inventory probe",
      recoverySignal,
    );
    if (result.code !== 0) {
      return {
        ready: false,
        pid: null,
        state: undefined,
        processRunning: undefined,
        healthy: undefined,
        absent: false,
        statusKnown: false,
        detail: tunnelControlDiagnostic(result),
      };
    }
    try {
      const parsed = JSON.parse(result.output);
      this.assertRecoveryActive(recoverySignal);
      if (!Array.isArray(parsed.entries)) throw new Error("local inventory has no entries array");
      const entry = parsed.entries.find(candidate => candidate?.alias === tunnel.alias);
      if (!entry) {
        return {
          ready: false,
          pid: null,
          state: "stopped",
          processRunning: false,
          healthy: false,
          absent: true,
          statusKnown: true,
          detail: `alias=${tunnel.alias}; local_inventory=absent`,
        };
      }
      const runtimeState = entry.runtime_state;
      if (!["stopped", "starting", "healthy", "ready"].includes(runtimeState)) {
        throw new Error(`local inventory reported unsupported runtime_state=${String(runtimeState)}`);
      }
      const liveRuntime = entry.live_runtime && typeof entry.live_runtime === "object"
        ? entry.live_runtime
        : {};
      const healthBaseUrl = loopbackHealthBaseURL(liveRuntime.base_url);
      if (healthBaseUrl) this.tunnelHealthBaseUrl = healthBaseUrl;
      const pid = Number.isInteger(liveRuntime.system?.pid) && liveRuntime.system.pid > 0
        ? liveRuntime.system.pid
        : Number.isInteger(liveRuntime.status?.pid) && liveRuntime.status.pid > 0
          ? liveRuntime.status.pid
          : null;
      const processRunning = runtimeState !== "stopped";
      const healthy = runtimeState === "healthy" || runtimeState === "ready";
      const ready = runtimeState === "ready";
      const detail = [
        ["state", runtimeState],
        ["process_running", processRunning],
        ["healthy", healthy],
        ["ready", ready],
        ["classification", entry.classification],
        ["live_admin", liveRuntime.found === true],
        ["pid", pid ?? "missing"],
      ]
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join("; ");
      return {
        ready,
        pid,
        state: runtimeState,
        processRunning,
        healthy,
        absent: false,
        statusKnown: true,
        detail: redactText(detail).slice(0, 2_000),
      };
    } catch (error) {
      return {
        ready: false,
        pid: null,
        state: undefined,
        processRunning: undefined,
        healthy: undefined,
        absent: false,
        statusKnown: false,
        detail: `local inventory returned invalid JSON: ${errorMessage(error)};`
          + ` ${redactText(result.output || "[empty]").slice(0, 500)}`,
      };
    }
  }

  async probeTunnelEndpoint(pathname, timeoutMs = 2_000) {
    if (!this.tunnelHealthBaseUrl) {
      return { observed: false, ok: false, detail: "local tunnel health URL is not known" };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${this.tunnelHealthBaseUrl}${pathname}`, {
        method: "GET",
        signal: controller.signal,
      });
      return {
        observed: true,
        ok: response.ok,
        status: response.status,
        detail: `${pathname} returned HTTP ${response.status}`,
      };
    } catch (error) {
      return {
        observed: false,
        ok: false,
        detail: `${pathname} could not be observed: ${errorMessage(error)}`,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async probeTunnelMcpTransport(timeoutMs = 2_000) {
    if (!this.tunnelHealthBaseUrl) {
      return { observed: false, ok: false, fatal: false, detail: "local tunnel MCP diagnostics URL is not known" };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${this.tunnelHealthBaseUrl}/api/logs?limit=100`, {
        method: "GET",
        signal: controller.signal,
      });
      if (!response.ok) {
        return {
          observed: false,
          ok: false,
          fatal: false,
          detail: `MCP transport diagnostics returned HTTP ${response.status}`,
        };
      }
      const body = await response.json();
      if (!body || typeof body !== "object" || !Array.isArray(body.events)) {
        throw new Error("response has no events array");
      }
      const cutoff = Date.now() - TUNNEL_MCP_FAILURE_RECENCY_MS;
      const failure = body.events.findLast(event => {
        if (!event || typeof event !== "object") return false;
        const attrs = event.attrs && typeof event.attrs === "object" ? event.attrs : {};
        const occurredAt = Date.parse(event.time);
        return Number.isFinite(occurredAt)
          && occurredAt >= cutoff
          && event.message === "dispatcher received MCP upstream error; posted error response to control plane"
          && attrs.failure_source === "client_internal"
          && attrs.status_code === 502
          && attrs.upstream_response_received === false
          && ["initialize", "tools/call"].includes(attrs.rpc_method);
      });
      if (!failure) {
        return { observed: true, ok: true, fatal: false, detail: "MCP transport has no recent internal failures" };
      }
      return {
        observed: true,
        ok: false,
        fatal: true,
        detail: `MCP transport returned internal HTTP 502 for ${failure.attrs.rpc_method} at ${failure.time}`,
      };
    } catch (error) {
      return {
        observed: false,
        ok: false,
        fatal: false,
        detail: `MCP transport diagnostics could not be observed: ${errorMessage(error)}`,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async discoverTunnelHealthBaseUrl(config, recoverySignal) {
    const tunnel = config.tunnel;
    if (!tunnel) throw new Error("launcher-owned tunnel has no runtime configuration");
    const result = await this.runTunnelCommand(
      config,
      ["runtimes", "list", "--json"],
      5_000,
      "Local tunnel health discovery",
      recoverySignal,
    );
    this.assertRecoveryActive(recoverySignal);
    if (result.code !== 0) {
      throw new Error(`Local tunnel health discovery failed: ${tunnelControlDiagnostic(result)}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(result.output);
    } catch (error) {
      throw new Error(`Local tunnel health discovery returned invalid JSON: ${errorMessage(error)}`);
    }
    const aliases = Array.isArray(parsed?.aliases)
      ? parsed.aliases.filter(entry => entry?.alias === tunnel.alias)
      : [];
    const healthFile = aliases.length === 1 ? aliases[0].health_url_file : undefined;
    if (typeof healthFile !== "string" || !absolutePath(healthFile)) {
      throw new Error("Local tunnel health discovery returned no unique alias health URL file");
    }
    this.assertRecoveryActive(recoverySignal);
    const healthFileInfo = await fs.promises.lstat(healthFile);
    if (!healthFileInfo.isFile() || healthFileInfo.size > 4_096) {
      throw new Error("Local tunnel health discovery returned an invalid health URL file");
    }
    const baseUrl = loopbackHealthBaseURL(await fs.promises.readFile(healthFile, "utf8"));
    this.assertRecoveryActive(recoverySignal);
    if (!baseUrl) {
      throw new Error("Local tunnel health discovery returned no verified loopback endpoint");
    }
    this.tunnelHealthBaseUrl = baseUrl;
    return baseUrl;
  }

  async waitForTunnelMcpTransport(config, timeoutMs = 10_000, recoverySignal) {
    this.assertRecoveryActive(recoverySignal);
    if (!this.tunnelHealthBaseUrl) await this.discoverTunnelHealthBaseUrl(config, recoverySignal);
    const deadline = Date.now() + timeoutMs;
    let health;
    do {
      this.assertRecoveryActive(recoverySignal);
      health = await this.probeTunnelMcpTransport();
      this.assertRecoveryActive(recoverySignal);
      if (health.observed && health.ok) return health;
      if (health.fatal) {
        throw new Error(`Tunnel MCP transport is unhealthy: ${health.detail}`);
      }
      if (Date.now() >= deadline) break;
      await sleep(TUNNEL_HEALTH_POLL_INTERVAL_MS);
    } while (Date.now() < deadline);
    throw new Error(
      `Tunnel MCP transport could not be verified within ${timeoutMs}ms:`
      + ` ${health?.detail || "no diagnostics returned"}`,
    );
  }

  async readLocalTunnelHealth() {
    const [healthz, readyz, mcp] = await Promise.all([
      this.probeTunnelEndpoint("/healthz"),
      this.probeTunnelEndpoint("/readyz"),
      this.probeTunnelMcpTransport(),
    ]);
    const pid = Number.isInteger(this.tunnel?.pid) ? this.tunnel.pid : null;
    if (pid && !processRunning(pid)) {
      return {
        ready: false,
        pid,
        state: "stopped",
        processRunning: false,
        healthy: false,
        absent: false,
        statusKnown: true,
        detail: `managed tunnel process ${pid} is no longer running`,
      };
    }
    const explicitlyUnhealthy = (healthz.observed && !healthz.ok)
      || (readyz.observed && !readyz.ok)
      || (mcp.observed && !mcp.ok);
    const completelyObserved = healthz.observed && readyz.observed && mcp.observed;
    if (!explicitlyUnhealthy && !completelyObserved) {
      return {
        ready: false,
        pid,
        state: undefined,
        processRunning: pid ? true : undefined,
        healthy: undefined,
        absent: false,
        statusKnown: false,
        fatal: mcp.fatal === true,
        detail: `${healthz.detail}; ${readyz.detail}; ${mcp.detail}`,
      };
    }
    const mcpReady = mcp.observed && mcp.ok;
    return {
      ready: healthz.ok && readyz.ok && mcpReady,
      pid,
      state: healthz.ok && readyz.ok && mcpReady ? "ready" : "degraded",
      processRunning: pid ? true : undefined,
      healthy: healthz.ok && mcpReady,
      absent: false,
      statusKnown: true,
      fatal: mcp.fatal === true,
      detail: `${healthz.detail}; ${readyz.detail}; ${mcp.detail}`,
    };
  }

  async observeTunnelForMonitor(config) {
    const local = await this.readLocalTunnelHealth();
    if (local.statusKnown) return local;
    try {
      const previousEndpoint = this.tunnelHealthBaseUrl;
      const inventory = await this.readTunnelHealth(config);
      if (tunnelRuntimeStopped(inventory)) return inventory;
      if (this.tunnelHealthBaseUrl && this.tunnelHealthBaseUrl !== previousEndpoint) {
        return await this.readLocalTunnelHealth();
      }
      // Inventory can prove that the alias stopped, but its ready flag does not prove MCP health.
      // Unknown observations must not hide failures or trigger a restart without failure evidence.
      return { ...local, detail: `${local.detail}; local inventory: ${inventory.detail}` };
    } catch (error) {
      return {
        ...local,
        detail: `${local.detail}; native status unavailable: ${errorMessage(error)}`,
      };
    }
  }

  async tunnelHealth(config) {
    return (await this.observeTunnelForMonitor(config)).ready;
  }

  async waitForKnownTunnelStatus(config, timeoutMs = 10_000, recoverySignal) {
    const deadline = Date.now() + timeoutMs;
    let health;
    do {
      this.assertRecoveryActive(recoverySignal);
      health = await this.readTunnelHealth(config, recoverySignal);
      this.assertRecoveryActive(recoverySignal);
      if (health.statusKnown) return health;
      await sleep(TUNNEL_HEALTH_POLL_INTERVAL_MS);
    } while (Date.now() < deadline);
    throw new Error(
      `Tunnel runtime status could not be inspected within ${timeoutMs}ms:`
      + ` ${health?.detail || "no status returned"}`,
    );
  }

  async waitForTunnel(
    config,
    timeoutMs = TUNNEL_START_TIMEOUT_MS,
    operationName = "runtime-start",
    recoverySignal,
  ) {
    const deadline = Date.now() + timeoutMs;
    let lastDetail = "tunnel status has not been observed";
    let lastPublishedDetail;
    while (Date.now() < deadline) {
      this.assertCanStart(recoverySignal);
      const health = await this.readTunnelHealth(config, recoverySignal);
      this.assertCanStart(recoverySignal);
      if (health.pid) {
        this.tunnel = {
          pid: health.pid,
          exitCode: null,
          signalCode: null,
          managed: true,
        };
      }
      if (health.ready) {
        if (!this.tunnel) {
          this.tunnel = {
            pid: null,
            exitCode: null,
            signalCode: null,
            managed: true,
          };
        }
        return health;
      }
      if (tunnelRuntimeStopped(health)) {
        throw new Error(`Tunnel managed runtime stopped during startup: ${health.detail}`);
      }
      lastDetail = health.detail;
      if (lastDetail !== lastPublishedDetail) {
        lastPublishedDetail = lastDetail;
        this.logger.info("runtime.tunnel_waiting", { detail: lastDetail });
        this.publishOperation?.({
          name: operationName,
          status: "running",
          message: `Waiting for tunnel readiness: ${lastDetail}`,
        });
      }
      await sleep(TUNNEL_HEALTH_POLL_INTERVAL_MS);
    }
    throw new Error(
      `Tunnel runtime did not become healthy and ready within ${timeoutMs}ms: ${lastDetail}`,
    );
  }

  async startTunnel(config, operationName = "runtime-start", {
    forceRestart = false,
    recoverySignal,
    startMonitor = true,
  } = {}) {
    if (config.mode !== "full") return;
    this.assertCanStart(recoverySignal);
    if (recoverySignal) this.recoveryAliasMayBeLive = true;
    this.assertTunnelClientReady(config);
    // Every acquisition binds diagnostics to this runtime, including adoption of an existing alias.
    this.tunnelHealthBaseUrl = null;
    try {
      const existing = await this.waitForKnownTunnelStatus(config, 10_000, recoverySignal);
      this.assertCanStart(recoverySignal);
      if (existing.ready && !forceRestart) {
        this.tunnel = {
          pid: existing.pid,
          exitCode: null,
          signalCode: null,
          managed: true,
        };
        await this.waitForTunnelMcpTransport(config, 10_000, recoverySignal);
        this.assertCanStart(recoverySignal);
        if (startMonitor) this.startTunnelMonitor(config);
        this.logger.info("runtime.tunnel_adopted", { pid: existing.pid });
        return;
      }
      this.tunnel = null;
      const stopped = await this.runTunnelStopCommand(config, recoverySignal);
      this.assertCanStart(recoverySignal);
      if (stopped.code !== 0
        && !tunnelRuntimeAbsent(stopped.output)) {
        throw new Error(
          `tunnel runtime refused pre-start cleanup: ${tunnelControlDiagnostic(stopped)}`,
        );
      }
      if (stopped.code === 0) await this.waitForTunnelStopped(config, 10_000, recoverySignal);
      this.assertCanStart(recoverySignal);
      this.recoveryAliasMayBeLive = false;
      this.tunnelHealthBaseUrl = null;
      if (recoverySignal) this.recoveryAliasMayBeLive = true;
      const connected = await this.runTunnelConnectCommand(config, recoverySignal);
      this.assertCanStart(recoverySignal);
      if (connected.code !== 0 && !tunnelConnectCanContinue(connected)) {
        throw new Error(
          `tunnel runtime refused managed startup: ${tunnelControlDiagnostic(connected)}`,
        );
      }
      await this.waitForTunnel(config, TUNNEL_START_TIMEOUT_MS, operationName, recoverySignal);
      if (!this.tunnel) throw new Error("Tunnel runtime became ready without a managed process identity");
      await this.waitForTunnelMcpTransport(config, 10_000, recoverySignal);
      this.assertCanStart(recoverySignal);
      if (startMonitor) this.startTunnelMonitor(config);
    } catch (error) {
      // Shutdown owns cleanup after cancellation. Recovery must not race its stop command.
      if (recoverySignal?.aborted) throw error;
      let cleanupError;
      try {
        this.stopTunnelMonitor();
        const managed = this.tunnel;
        const stopped = await this.runTunnelStopCommand(config);
        if (stopped.code !== 0
          && (!tunnelRuntimeAbsent(stopped.output)
            || (managed?.pid && processRunning(managed.pid)))) {
          throw new Error(tunnelControlDiagnostic(stopped));
        }
        if (stopped.code === 0) await this.waitForTunnelStopped(config);
        this.tunnel = null;
        this.recoveryAliasMayBeLive = false;
      } catch (caught) {
        cleanupError = caught;
      }
      if (cleanupError) {
        throw new Error(appendFailure(errorMessage(error), "tunnel startup cleanup failed", cleanupError));
      }
      throw error;
    }
  }

  async runTunnelConnectCommand(config, recoverySignal) {
    const contract = config.browserInteractionMode === "manual" ? "safe" : "native";
    const asyncTools = config.experimentalAsyncToolOperations === true;
    const asyncIdentity = [ASYNC_CONNECTOR_NAME, ASYNC_DEV_CONNECTOR_NAME, "Codex Native5", "Codex Native5 DEV"].includes(config.appName);
    if (asyncTools !== asyncIdentity || asyncTools && (contract !== "native" || config.mode !== "full")) {
      throw new Error("Async tool operations require Automatic Full mode and its separate Native5 or Native6 connector");
    }
    const invocation = this.runtimeCommand([
      "mcp",
      asyncTools ? "--async-tool-operations" : "--synchronous-tool-operations",
      ...([ASYNC_CONNECTOR_NAME, ASYNC_DEV_CONNECTOR_NAME].includes(config.appName) ? ["--native6"] : []),
      config.allowWebSubagents === false ? "--no-web-subagents" : "--allow-web-subagents",
      "--contract",
      contract,
      "--broker-socket",
      config.brokerSocketPath,
    ], config.releaseVersion);
    return await this.runTunnelCommand(
      config,
      managedTunnelConnectArgs(config, invocation),
      TUNNEL_START_TIMEOUT_MS,
      "Tunnel managed startup",
      recoverySignal,
    );
  }

  startTunnelMonitor(config) {
    this.stopTunnelMonitor();
    this.tunnelMonitorFailures = 0;
    this.tunnelMonitorObservationUnavailable = false;
    const generation = this.tunnelMonitorGeneration;
    const recordFailure = (message, immediate = false) => {
      if (this.stopping || generation !== this.tunnelMonitorGeneration) return;
      if (immediate) this.tunnelMonitorFailures = TUNNEL_MONITOR_FAILURE_THRESHOLD - 1;
      this.tunnelMonitorFailures += 1;
      this.logger.warn("runtime.tunnel_monitor_unhealthy", {
        consecutiveFailures: this.tunnelMonitorFailures,
        message,
      });
      if (this.tunnelMonitorFailures < TUNNEL_MONITOR_FAILURE_THRESHOLD) return;
      this.lastChildFailure.tunnel = message;
      this.tunnel = null;
      this.stopTunnelMonitor();
      void this.reportTunnelStatus(config, false).catch((error) => {
        this.logger.warn("runtime.tunnel_status_report_failed", { message: errorMessage(error) });
      });
      if (!this.tryWriteState("degraded", message)) return;
      this.updateCapabilities("degraded", message, config);
      this.publishOperation?.({ name: "runtime-recovery", status: "running", message });
      this.scheduleRecovery("tunnel");
    };
    this.tunnelMonitorTimer = setInterval(() => {
      if (this.stopping
        || generation !== this.tunnelMonitorGeneration
        || this.tunnelMonitorInFlight
        || this.restartTimers.tunnel) return;
      this.tunnelMonitorInFlight = true;
      void this.observeTunnelForMonitor(config).then((health) => {
        if (this.stopping || generation !== this.tunnelMonitorGeneration) return;
        if (!health.statusKnown) {
          if (!this.tunnelMonitorObservationUnavailable) {
            this.tunnelMonitorObservationUnavailable = true;
            this.logger.warn("runtime.tunnel_monitor_observation_unavailable", {
              message: health.detail,
            });
          }
          return;
        }
        if (this.tunnelMonitorObservationUnavailable) {
          this.tunnelMonitorObservationUnavailable = false;
          this.logger.info("runtime.tunnel_monitor_observation_restored", {
            message: health.detail,
          });
        }
        if (health.ready) {
          this.tunnelMonitorFailures = 0;
          const observedTunnelPid = health.pid;
          const ownerChanged = this.tunnel?.pid !== observedTunnelPid;
          if (ownerChanged) {
            this.tunnel = {
              pid: observedTunnelPid,
              exitCode: null,
              signalCode: null,
              managed: true,
            };
            if (!this.tryWriteState("ready")) return;
          }
          const ownerIsCurrent = () => !this.stopping
            && generation === this.tunnelMonitorGeneration
            && this.tunnel?.pid === observedTunnelPid;
          void this.reportTunnelStatus(config, true, undefined, ownerIsCurrent).then((result) => {
            if (!ownerIsCurrent() || result?.stale === true) return;
            if (!ownerChanged && result && result.capabilityChanged !== true) return;
            const available = this.webAccepting === true && this.brokerReady === true;
            this.updateCapabilities(available ? "ready" : "degraded",
              available ? null : "Tool tunnel is ready; local broker admission is still pending", config);
          }).catch((error) => {
            this.logger.warn("runtime.tunnel_status_report_failed", { message: errorMessage(error) });
          });
          return;
        }
        recordFailure(`Tunnel runtime lost readiness: ${health.detail}`, health.fatal === true);
      }).catch((error) => {
        recordFailure(`Tunnel health probe failed: ${errorMessage(error)}`);
      }).finally(() => {
        this.tunnelMonitorInFlight = false;
      });
    }, TUNNEL_MONITOR_INTERVAL_MS);
    this.tunnelMonitorTimer.unref?.();
  }

  stopTunnelMonitor() {
    if (this.tunnelMonitorTimer) clearInterval(this.tunnelMonitorTimer);
    this.tunnelMonitorTimer = null;
    this.tunnelMonitorFailures = 0;
    this.tunnelMonitorObservationUnavailable = false;
    this.tunnelMonitorGeneration += 1;
  }

  async startDaemon(config, recoverySignal) {
    this.assertCanStart(recoverySignal);
    if (this.daemon) {
      const child = this.daemon;
      const identity = Number.isInteger(child.pid)
        && await this.proxyHealth(config, 2_000, child.pid);
      this.assertCanStart(recoverySignal);
      if (identity && !await this.proxyHealth(config, 2_000, child.pid, true)) {
        this.assertCanStart(recoverySignal);
        const resumed = await this.control(config, "resume");
        this.assertCanStart(recoverySignal);
        if (resumed.status !== "ok" || !this.nativeHealthAccepting(resumed)) {
          throw new Error("Responses proxy did not acknowledge readiness after resume");
        }
      }
      await this.waitForProxy(config, 20_000, recoverySignal);
      this.assertCanStart(recoverySignal);
      if (this.daemon !== child) throw new Error("Responses proxy exited while readiness was being confirmed");
      this.restartableChildren.add(child);
      return;
    }
    let child;
    try {
      const env = await this.nativeProxyEnvironmentProvider();
      if (this.stopping) throw new Error("Responses startup was cancelled while resolving the system proxy");
      this.assertCanStart(recoverySignal);
      child = this.spawnChild("daemon", { ...this.runtimeCommand(["serve"], config.releaseVersion), env }, recoverySignal);
      await this.waitForProxy(config, 20_000, recoverySignal);
      this.assertCanStart(recoverySignal);
      if (this.daemon !== child) throw new Error("Responses proxy exited immediately after becoming healthy");
      this.restartableChildren.add(child);
    } catch (error) {
      if (recoverySignal?.aborted) throw error;
      let cleanupError;
      try {
        await this.stopChild("daemon");
      } catch (caught) {
        cleanupError = caught;
      }
      if (cleanupError) {
        throw new Error(appendFailure(errorMessage(error), "daemon startup cleanup failed", cleanupError));
      }
      throw error;
    }
  }

  async startIfConfigured(options = {}) {
    if (this.stopPromise) await this.stopPromise;
    if (this.shutdownRequested) {
      if (!this.shutdownResumeAllowed) {
        throw new Error("Runtime shutdown is committed; a new start requires a failed-Quit recovery");
      }
      if (this.startPromise) {
        throw new Error("Previous runtime startup is still settling; runtime restart is deferred");
      }
      if (!await this.settleRecoveryTasks()) {
        throw new Error("Cancelled runtime recovery is still unsettled; runtime restart is deferred");
      }
      if (this.tunnelControlControllers.size > 0) {
        throw new Error("Previous tunnel control is still unsettled; runtime restart is deferred");
      }
      this.shutdownRequested = false;
      this.shutdownResumeAllowed = false;
    }
    if (this.startPromise) return this.startPromise;
    const controller = new AbortController();
    this.startController = controller;
    this.startPromise = this.startConfigured(controller.signal, options);
    try {
      return await this.startPromise;
    } finally {
      this.startPromise = null;
      if (this.startController === controller) this.startController = null;
    }
  }

  async startConfigured(startSignal, { allowCommittedVersion = false } = {}) {
    this.assertCanStart(startSignal);
    let config;
    try {
      config = this.readConfig();
    } catch (error) {
      const detail = errorMessage(error);
      this.logger.warn("runtime.setup_required", { detail });
      this.updateCapabilities("needs-setup", detail, null);
      return { status: "needs-setup", detail };
    }
    if (!config) {
      this.assertCanStart(startSignal);
      const ownershipState = this.readState();
      if (ownershipState && !runtimeOwnershipPredatesCurrentBoot(ownershipState) && (
        processRunning(ownershipState.daemonPid)
        || processRunning(ownershipState.tunnelPid)
      )) {
        const detail = "Runtime configuration is missing while launcher ownership processes are still alive";
        this.logger.warn("runtime.external_owner_detected", { detail });
        this.updateCapabilities("external", detail, null);
        return { status: "external", detail };
      }
      this.clearState();
      this.updateCapabilities("unconfigured", null, null);
      return { status: "not-configured" };
    }
    const tunnelOnly = this.launcherProfile === "development";
    if (tunnelOnly && config.mode !== "full") {
      this.assertCanStart(startSignal);
      const ownershipState = this.readState();
      if (runtimeOwnershipMayBeLive(ownershipState)) {
        const detail = "A DEV MCP runtime is still owned while the profile is configured as browser-only";
        this.writeExternalState(detail);
        this.updateCapabilities("external", detail, config);
        return { status: "external", detail };
      }
      this.clearState();
      this.updateCapabilities("ready", null, config);
      return { status: "ready", daemonPid: null, tunnelPid: null };
    }
    if (!tunnelOnly && config.releaseVersion !== this.app.getVersion()) {
      const detail = `Config requires committed runtime ${config.releaseVersion}; launcher is ${this.app.getVersion()}`;
      if (!allowCommittedVersion) {
        this.writeState("needs-setup", detail);
        this.logger.warn("runtime.setup_required", { detail });
        this.updateCapabilities("needs-setup", detail, config);
        return { status: "needs-setup", detail };
      }
      // Resolve and validate the committed bundle before disturbing its process or route.
      this.runtimeCommand(["--version"], config.releaseVersion);
      this.logger.info("runtime.committed_release_bootstrap", {
        committedVersion: config.releaseVersion,
        launcherVersion: this.app.getVersion(),
      });
    }
    if (!this.daemon && !this.tunnel) {
      await this.adoptBackgroundDaemon(config, startSignal);
    }
    if (!this.daemon && !this.tunnel) {
      const healthyRuntime = tunnelOnly ? false : await this.proxyHealth(config);
      this.assertCanStart(startSignal);
      const ownershipState = this.readState();
      if (healthyRuntime || runtimeOwnershipMayBeLive(ownershipState)) {
        try {
          const recovered = await this.stopStaleOwnedRuntime(config, startSignal);
          this.assertCanStart(startSignal);
          if (!recovered) {
            const detail = healthyRuntime
              ? "An external runtime already owns the configured port"
              : "Existing launcher runtime ownership could not be safely recovered";
            this.writeExternalState(detail);
            this.logger.warn("runtime.external_owner_detected", { port: config.port, detail });
            this.updateCapabilities("external", detail, config);
            return { status: "external", detail };
          }
        } catch (error) {
          this.assertCanStart(startSignal);
          const detail = errorMessage(error);
          this.writeExternalState(detail);
          this.logger.warn("runtime.external_owner_detected", { port: config.port, detail });
          this.updateCapabilities("external", detail, config);
          return { status: "external", detail };
        }
      }
    }

    this.stopping = false;
    this.updateCapabilities("starting", null, config);
    this.publishOperation?.({
      name: "runtime-start",
      status: "running",
      message: tunnelOnly ? "Starting isolated DEV MCP runtime" : "Starting local runtime",
    });
    try {
      this.assertCanStart(startSignal);
      if (tunnelOnly) {
        await this.startTunnel(config, "runtime-start", { recoverySignal: startSignal });
      } else {
        await this.startDaemon(config, startSignal);
      }
      this.assertCanStart(startSignal);
      this.restartHistory.daemon = [];
      let tunnelFailure = null;
      if (!tunnelOnly && config.mode === "full") {
        try {
          await this.reportTunnelStatus(config, false, startSignal);
        } catch (error) {
          if (startSignal.aborted) throw error;
          tunnelFailure = `Tunnel capability status could not be initialized: ${errorMessage(error)}`;
        }
        tunnelFailure = tunnelFailure || "Tool tunnel startup is continuing in bounded recovery";
        this.lastChildFailure.tunnel = tunnelFailure;
        this.scheduleRecovery("tunnel");
      }
      this.writeState(tunnelFailure ? "degraded" : "ready", tunnelFailure || undefined);
      this.updateCapabilities(tunnelFailure ? "degraded" : "ready", tunnelFailure, config);
      this.publishOperation?.({
        name: "runtime-start",
        status: "completed",
        message: tunnelOnly ? "Isolated DEV MCP runtime is ready"
          : tunnelFailure ? `Native runtime is ready; tool tunnel is recovering: ${tunnelFailure}` : "Local runtime is ready",
      });
      return { status: "ready", nativeReady: !tunnelOnly, webReady: config.mode !== "full" || !tunnelFailure,
        tunnelStatus: tunnelFailure ? "degraded" : config.mode === "full" ? "ready" : "absent",
        ...(tunnelFailure ? { detail: tunnelFailure } : {}), daemonPid: this.daemon?.pid, tunnelPid: this.tunnel?.pid };
    } catch (error) {
      // Shutdown owns the stop after an aborted startup. Its bounded settlement
      // keeps command cleanup from racing a second tunnel stop.
      if (startSignal.aborted) throw error;
      this.stopping = true;
      let cleanupError;
      try {
        await this.cleanupFailedStart(config);
      } catch (caught) {
        cleanupError = caught;
      } finally {
        this.stopping = false;
      }
      const primary = errorMessage(error);
      const message = cleanupError
        ? appendFailure(primary, "runtime startup cleanup failed", cleanupError)
        : primary;
      this.tryWriteState("failed", message);
      this.updateCapabilities("failed", message, config);
      this.publishOperation?.({ name: "runtime-start", status: "failed", message });
      throw new Error(message);
    }
  }

  recordRestart(name) {
    const cutoff = Date.now() - RESTART_WINDOW_MS;
    const recent = this.restartHistory[name].filter((at) => at >= cutoff);
    recent.push(Date.now());
    this.restartHistory[name] = recent;
    return recent.length;
  }

  assertRecoveryActive(signal) {
    if (signal && (signal.aborted || this.stopping || this.shutdownRequested)) {
      throw new Error("Runtime recovery was cancelled for shutdown");
    }
  }

  assertCanStart(signal) {
    if (this.shutdownRequested) throw new Error("Runtime startup was cancelled for shutdown");
    this.assertRecoveryActive(signal);
  }

  cancelRecoveries() {
    this.startController?.abort();
    for (const name of ["daemon", "tunnel"]) {
      if (this.restartTimers[name]) {
        clearTimeout(this.restartTimers[name]);
        this.restartTimers[name] = null;
      }
    }
    for (const controller of this.recoveryControllers) controller.abort();
  }

  cancelTunnelControls() {
    for (const controller of this.tunnelControlControllers.values()) controller.abort();
  }

  async settleTunnelControls(timeoutMs = RECOVERY_SHUTDOWN_SETTLEMENT_MS) {
    const deadline = Date.now() + timeoutMs;
    while (this.tunnelControlControllers.size > 0 && Date.now() < deadline) await sleep(25);
    return this.tunnelControlControllers.size === 0;
  }

  allowRestartAfterQuitFailure() {
    if (!this.shutdownRequested) return;
    this.shutdownResumeAllowed = true;
    // main's failed-Quit handler is synchronous. Restore supervision only when
    // every previous owner is settled; otherwise retain the explicit-start fence.
    if (this.stopping || this.stopPromise || this.startPromise
      || this.recoveryTasks.size > 0 || this.tunnelControlControllers.size > 0) return;
    let config;
    try { config = this.readConfig(); } catch (error) {
      this.logger.warn("runtime.failed_quit_resume_deferred", { message: errorMessage(error) });
      return;
    }
    if (!config) return;
    this.shutdownRequested = false;
    this.shutdownResumeAllowed = false;
    if (this.tunnel) this.startTunnelMonitor(config);
    else if (config.mode === "full") this.scheduleRecovery("tunnel");
    if (!this.daemon && this.launcherProfile !== "development") this.scheduleRecovery("daemon");
  }

  async settleRecoveryTasks() {
    if (this.recoveryTasks.size === 0) return true;
    let timer;
    try {
      return await Promise.race([
        Promise.allSettled([...this.recoveryTasks]).then(() => true),
        new Promise(resolve => {
          timer = setTimeout(() => resolve(false), RECOVERY_SHUTDOWN_SETTLEMENT_MS);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async settleInitialStart() {
    if (!this.startPromise) return true;
    let timer;
    try {
      return await Promise.race([
        this.startPromise.then(() => true, () => true),
        new Promise(resolve => {
          timer = setTimeout(() => resolve(false), RECOVERY_SHUTDOWN_SETTLEMENT_MS);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  scheduleRecovery(name) {
    if (this.stopping || this.shutdownRequested) return;
    if (this.restartTimers[name]) return;
    const attempts = this.recordRestart(name);
    if (attempts > MAX_RESTARTS_PER_WINDOW) {
      const cause = this.lastChildFailure[name];
      const message = `${name} stopped more than ${MAX_RESTARTS_PER_WINDOW} times in 60 seconds; automatic restart is disabled`
        + (cause ? `; last failure: ${cause}` : "");
      const nativeSurvives = name === "tunnel" && Boolean(this.daemon);
      this.tryWriteState(nativeSurvives ? "degraded" : "failed", message);
      this.updateCapabilities(nativeSurvives ? "degraded" : "failed", message);
      this.publishOperation?.({ name: "runtime-recovery", status: "failed", message });
      return;
    }
    const delay = Math.min(attempts * 1_000, 5_000);
    this.restartTimers[name] = setTimeout(() => {
      this.restartTimers[name] = null;
      if (this.stopping || this.shutdownRequested) return;
      const controller = new AbortController();
      this.recoveryControllers.add(controller);
      const recovery = this.recover(name, controller.signal).catch((error) => {
        if (controller.signal.aborted || this.stopping || this.shutdownRequested) return;
        const message = errorMessage(error);
        this.logger.error(`runtime.${name}_recovery_failed`, { message });
        const nativeSurvives = name === "tunnel" && Boolean(this.daemon);
        if (this.tryWriteState(nativeSurvives ? "degraded" : "failed", message)) {
          this.updateCapabilities(nativeSurvives ? "degraded" : "failed", message);
          this.scheduleRecovery(name);
        }
      });
      this.recoveryTasks.add(recovery);
      void recovery.finally(() => {
        this.recoveryTasks.delete(recovery);
        this.recoveryControllers.delete(controller);
      });
    }, delay);
  }

  async recover(name, recoverySignal) {
    this.assertRecoveryActive(recoverySignal);
    const config = this.readConfig();
    this.assertRecoveryActive(recoverySignal);
    if (!config) return;
    this.updateCapabilities("recovering", `Restarting ${name}`, config);
    this.publishOperation?.({ name: "runtime-recovery", status: "running", message: `Restarting ${name}` });
    const tunnelOnly = this.launcherProfile === "development";
    if (name === "tunnel") {
      await this.reportTunnelStatus(config, false, recoverySignal);
      await this.startTunnel(config, "runtime-recovery", { forceRestart: true, recoverySignal });
      await this.reportTunnelStatus(config, true, recoverySignal);
    }
    else if (tunnelOnly) throw new Error("DEV runtime cannot recover a Responses daemon");
    else await this.startDaemon(config, recoverySignal);
    this.assertRecoveryActive(recoverySignal);
    if (!tunnelOnly && !this.daemon) throw new Error("Responses proxy is unavailable after runtime recovery");
    if (tunnelOnly && config.mode === "full" && !this.tunnel) {
      throw new Error("Tunnel runtime is unavailable after runtime recovery");
    }
    if (!tunnelOnly) await this.waitForProxy(config, 20_000, recoverySignal);
    if (name === "tunnel" && config.mode === "full") {
      await this.waitForTunnel(config, TUNNEL_START_TIMEOUT_MS, "runtime-recovery", recoverySignal);
    }
    this.assertRecoveryActive(recoverySignal);
    const recoveredStatus = config.mode === "full"
      && (!this.tunnel || this.webAccepting !== true || this.brokerReady !== true) ? "degraded" : "ready";
    if (!this.tryWriteState(recoveredStatus)) {
      let cleanupError;
      try {
        await this.cleanupFailedStart(config);
      } catch (caught) {
        cleanupError = caught;
      }
      const message = cleanupError
        ? appendFailure(
            "Recovered runtime could not persist launcher ownership",
            "runtime recovery cleanup failed",
            cleanupError,
          )
        : "Recovered runtime could not persist launcher ownership";
      throw new Error(message);
    }
    this.updateCapabilities(recoveredStatus, null, config);
    this.publishOperation?.({ name: "runtime-recovery", status: "completed", message: `${name} recovered` });
  }

  async cleanupFailedStart(config) {
    if (this.daemon) {
      const child = this.daemon;
      const healthy = Number.isInteger(child.pid) && await this.proxyHealth(config, 2_000, child.pid);
      if (healthy) {
        let drained = false;
        try {
          drained = await this.acquireDrain(config);
          await this.shutdownDaemon(config);
        } catch (error) {
          if (drained) {
            try {
              await this.control(config, "resume");
            } catch (resumeError) {
              throw new Error(appendFailure(errorMessage(error), "daemon resume compensation failed", resumeError));
            }
          }
          throw error;
        }
      } else {
        await this.stopChild("daemon");
      }
    }
    if (this.tunnel) {
      await this.stopTunnelGracefully(config);
    }
  }

  async restoreDrainedDaemon(config) {
    const child = this.daemon;
    const childAlive = child
      && child.exitCode === null
      && child.signalCode === null
      && processRunning(child.pid);
    if (childAlive) {
      if (!Number.isInteger(child.pid) || !await this.proxyHealth(config, 2_000, child.pid)) {
        throw new Error("drained daemon is still alive but no longer provides matching health evidence");
      }
      const resumed = await this.control(config, "resume");
      if (resumed.status !== "ok" || !this.nativeHealthAccepting(resumed)) {
        throw new Error("drained daemon did not acknowledge resume");
      }
      await this.waitForProxy(config);
      return { status: "resumed", pid: child.pid };
    }
    this.daemon = null;
    await this.waitForPortRelease(config);
    await this.startDaemon(config);
    return { status: "restarted", pid: this.daemon?.pid };
  }

  async ownedRuntimeReady(config) {
    if (this.launcherProfile === "development") {
      return config.mode !== "full" || Boolean(this.tunnel && await this.tunnelHealth(config));
    }
    const daemon = this.daemon;
    if (!daemon
      || !Number.isInteger(daemon.pid)
      || daemon.exitCode !== null
      || daemon.signalCode !== null
      || !await this.proxyHealth(config, 2_000, daemon.pid, true)) {
      return false;
    }
    return true;
  }

  async control(config, action, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 5_000);
    try {
      const response = await fetch(`http://${config.host}:${config.port}/admin/${action}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.controlToken}`,
          ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  async waitForChildExit(name, child, timeoutMs) {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise((resolve, reject) => {
      const finish = () => {
        clearTimeout(timeout);
        child.off("exit", finish);
        child.off("close", finish);
        resolve();
      };
      const timeout = setTimeout(() => {
        child.off("exit", finish);
        child.off("close", finish);
        reject(new Error(`${name} did not stop within ${timeoutMs}ms`));
      }, timeoutMs);
      child.once("exit", finish);
      child.once("close", finish);
    });
  }

  async waitForProcessExit(name, pid, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    while (processRunning(pid) && Date.now() < deadline) await sleep(50);
    if (processRunning(pid)) throw new Error(`${name} process ${pid} did not stop within ${timeoutMs}ms`);
  }

  async waitForTunnelStopped(config, timeoutMs = 10_000, recoverySignal) {
    const deadline = Date.now() + timeoutMs;
    let lastDetail = "tunnel stop status has not been observed";
    while (Date.now() < deadline) {
      this.assertRecoveryActive(recoverySignal);
      const health = await this.readTunnelHealth(config, recoverySignal);
      this.assertRecoveryActive(recoverySignal);
      if (tunnelRuntimeStopped(health)) {
        return health;
      }
      lastDetail = health.detail;
      await sleep(TUNNEL_HEALTH_POLL_INTERVAL_MS);
    }
    throw new Error(`Tunnel runtime did not confirm a stopped state within ${timeoutMs}ms: ${lastDetail}`);
  }

  async waitForPortRelease(config, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    let lastError = "port is still occupied";
    while (Date.now() < deadline) {
      try {
        await new Promise((resolve, reject) => {
          const probe = net.createServer();
          probe.unref();
          probe.once("error", reject);
          probe.listen(config.port, config.host, () => {
            probe.close((error) => error ? reject(error) : resolve());
          });
        });
        return;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        await sleep(100);
      }
    }
    throw new Error(
      `Responses port ${config.host}:${config.port} was not released within ${timeoutMs}ms: ${lastError}`,
    );
  }

  async shutdownDaemon(config, timeoutMs = 10_000) {
    const child = this.daemon;
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      this.daemon = null;
      return;
    }
    const result = await this.control(config, "shutdown");
    if (result.status !== "ok") throw new Error("daemon did not acknowledge graceful shutdown");
    await this.waitForChildExit("daemon", child, timeoutMs);
    await this.waitForPortRelease(config);
    this.daemon = null;
  }

  async stopTunnelGracefully(config, timeoutMs = 10_000) {
    const managed = this.tunnel;
    if (!managed) {
      this.stopTunnelMonitor();
      this.tunnel = null;
      return;
    }
    const tunnel = config.tunnel;
    if (!tunnel) throw new Error("launcher-owned tunnel has no runtime configuration");
    this.stopTunnelMonitor();
    let result;
    try {
      result = await this.runTunnelStopCommand(config);
    } catch (error) {
      this.startTunnelMonitor(config);
      throw error;
    }
    if (result.code !== 0) {
      this.startTunnelMonitor(config);
      throw new Error(`tunnel runtime refused graceful shutdown: ${tunnelControlDiagnostic(result)}`);
    }
    try {
      await this.waitForTunnelStopped(config, timeoutMs);
    } catch (error) {
      // The native manager accepted the stop request but did not prove the terminal state.
      // Keep supervising the alias until the caller either recovers or retries the transaction.
      this.startTunnelMonitor(config);
      throw error;
    }
    this.tunnel = null;
    this.recoveryAliasMayBeLive = false;
  }

  async adoptConfiguredTunnelForStop(config) {
    if (config.mode !== "full" || this.tunnel) return;
    const health = await this.waitForKnownTunnelStatus(config);
    if (tunnelRuntimeStopped(health)) {
      this.recoveryAliasMayBeLive = false;
      return;
    }
    if (health.state === undefined
      && health.processRunning !== true
      && health.pid === null) {
      throw new Error(`Tunnel runtime state is ambiguous before shutdown: ${health.detail}`);
    }
    this.tunnel = {
      pid: health.pid,
      exitCode: null,
      signalCode: null,
      managed: true,
    };
    this.logger.info("runtime.tunnel_adopted_for_stop", {
      pid: health.pid,
      state: health.state,
    });
  }

  async runTunnelStopCommand(config, recoverySignal) {
    const tunnel = config.tunnel;
    if (!tunnel) throw new Error("launcher-owned tunnel has no runtime configuration");
    return await this.runTunnelCommand(
      config,
      ["runtimes", "stop", tunnel.alias, "--json"],
      10_000,
      "Tunnel shutdown",
      recoverySignal,
    );
  }

  async runTunnelCommand(config, args, timeoutMs, label, recoverySignal) {
    const tunnel = config.tunnel;
    if (!tunnel) throw new Error("launcher-owned tunnel has no runtime configuration");
    this.assertRecoveryActive(recoverySignal);
    const controlController = new AbortController();
    const controlToken = {};
    this.tunnelControlControllers.set(controlToken, controlController);
    const previousControl = this.tunnelControlQueue;
    let releaseControl;
    this.tunnelControlQueue = new Promise((resolve) => {
      releaseControl = resolve;
    });
    let removeControlWaitAbort;
    let proxyEnvironment;
    let controlChild = null;
    const releaseControlOperation = () => {
      this.tunnelControlControllers.delete(controlToken);
    };
    try {
      const controlWaitAbort = new Promise((_, reject) => {
        const onAbort = () => reject(new Error(`${label} cancelled for runtime shutdown`));
        removeControlWaitAbort = () => {
          controlController.signal.removeEventListener("abort", onAbort);
          recoverySignal?.removeEventListener("abort", onAbort);
        };
        if (controlController.signal.aborted || recoverySignal?.aborted) onAbort();
        else {
          controlController.signal.addEventListener("abort", onAbort, { once: true });
          recoverySignal?.addEventListener("abort", onAbort, { once: true });
        }
      });
      try {
        await Promise.race([previousControl, controlWaitAbort]);
      } catch (error) {
        // Keep this queued slot closed until the predecessor releases its control child.
        // A cancelled waiter must not let a later command overlap that unresolved child.
        previousControl.then(releaseControl, releaseControl);
        throw error;
      }
      if (controlController.signal.aborted) {
        throw new Error(`${label} cancelled for runtime shutdown`);
      }
      if (recoverySignal?.aborted) {
        throw new Error("Runtime recovery was cancelled for shutdown");
      }
      try {
        proxyEnvironment = await this.tunnelProxyEnvironmentProvider();
        this.assertRecoveryActive(recoverySignal);
        if (controlController.signal.aborted) {
          throw new Error(`${label} cancelled for runtime shutdown`);
        }
      } catch (error) {
        releaseControl();
        throw error;
      }
    } finally {
      removeControlWaitAbort?.();
    }
    try {
      this.assertRecoveryActive(recoverySignal);
      if (controlController.signal.aborted) {
        throw new Error(`${label} cancelled for runtime shutdown`);
      }
      return await new Promise((resolve, reject) => {
        let child;
        try {
          child = spawn(tunnel.binaryPath, args, {
            cwd: tunnel.profileDir,
            detached: DETACH_OWNED_CHILD,
            env: { ...process.env, ...proxyEnvironment },
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
          });
        } catch (error) {
          releaseControl();
          reject(error);
          return;
        }
        controlChild = child;
        this.tunnelControlChildren.add(child);
        let controlReleased = false;
        const releaseOwnedControl = () => {
          if (controlReleased) return;
          controlReleased = true;
          this.tunnelControlChildren.delete(child);
          releaseControlOperation();
          releaseControl();
        };
      const stdout = [];
      const stderr = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      const capture = (chunks, chunk, stream) => {
        const used = stream === "stdout" ? stdoutBytes : stderrBytes;
        const remaining = MAX_CONTROL_OUTPUT_BYTES - used;
        if (remaining <= 0) return;
        const captured = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
        chunks.push(captured);
        if (stream === "stdout") stdoutBytes += captured.length;
        else stderrBytes += captured.length;
      };
      let settled = false;
      let timeoutError = null;
      let terminationTimeout = null;
      let forceTimeout = null;
      const clearTimers = () => {
        clearTimeout(timeout);
        if (terminationTimeout) clearTimeout(terminationTimeout);
        if (forceTimeout) clearTimeout(forceTimeout);
        recoverySignal?.removeEventListener("abort", onAbort);
        controlController.signal.removeEventListener("abort", onAbort);
      };
      const beginTermination = (reason, firstDelayMs, forceDelayMs) => {
        if (settled) return;
        timeoutError = reason;
        clearTimeout(timeout);
        try {
          terminateOwnedProcessTree(child);
        } catch (error) {
          settled = true;
          clearTimers();
          reject(new Error(`${timeoutError.message}; control process tree termination failed: ${errorMessage(error)}`));
          return;
        }
        terminationTimeout = setTimeout(() => {
          if (settled) return;
          try {
            terminateOwnedProcessTree(child, "SIGKILL");
          } catch (error) {
            settled = true;
            clearTimers();
            reject(new Error(`${timeoutError.message}; forced control process tree termination failed: ${errorMessage(error)}`));
            return;
          }
          forceTimeout = setTimeout(() => {
            if (settled) return;
            settled = true;
            clearTimers();
            reject(new Error(`${timeoutError.message}; the control process did not exit after forced termination`));
          }, forceDelayMs);
        }, firstDelayMs);
      };
      const onAbort = () => {
        beginTermination(new Error(`${label} cancelled for runtime shutdown`), 1_000, 1_000);
      };
      const timeout = setTimeout(() => {
        beginTermination(new Error(`${label} timed out after ${timeoutMs}ms`), 5_000, 2_000);
      }, timeoutMs);
      recoverySignal?.addEventListener("abort", onAbort, { once: true });
      controlController.signal.addEventListener("abort", onAbort, { once: true });
      if (recoverySignal?.aborted) onAbort();
      if (controlController.signal.aborted) onAbort();
      child.stdout.on("data", (chunk) => capture(stdout, chunk, "stdout"));
      child.stderr.on("data", (chunk) => capture(stderr, chunk, "stderr"));
      const onOutputError = (stream) => (error) => {
        if (settled) return;
        beginTermination(new Error(`${label} ${stream} pipe failed: ${errorMessage(error)}`), 1_000, 2_000);
      };
      child.stdout.once("error", onOutputError("stdout"));
      child.stderr.once("error", onOutputError("stderr"));
      child.once("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimers();
        reject(timeoutError
          ? new Error(`${timeoutError.message}; termination failed: ${error.message}`)
          : error);
      });
      child.once("close", releaseOwnedControl);
      child.once("exit", (code) => {
        if (settled) return;
        settled = true;
        clearTimers();
        if (timeoutError) {
          try {
            terminateOwnedProcessTree(child, "SIGKILL");
            reject(timeoutError);
          } catch (error) {
            reject(new Error(
              `${timeoutError.message}; final control process-group cleanup failed: ${errorMessage(error)}`,
            ));
          }
          return;
        }
        const exitCode = code ?? 1;
        const stdoutText = Buffer.concat(stdout).toString("utf8").trim();
        const stderrText = Buffer.concat(stderr).toString("utf8").trim();
        resolve({
          code: exitCode,
          stdout: stdoutText,
          stderr: stderrText,
          output: exitCode === 0
            ? (stdoutText || stderrText)
            : [stderrText, stdoutText].filter(Boolean).join("\n"),
        });
      });
      });
    } catch (error) {
      if (!controlChild) {
        releaseControlOperation();
        releaseControl();
      }
      throw error;
    }
  }

  async runtimeSession(config, action) {
    const health = await this.proxyHealthPayload(config);
    if (!health || health.pid !== this.daemon?.pid || health.version !== config.releaseVersion
      || health.mode !== config.mode || health.service !== "codex-chatgpt-web"
      || health.instance_id !== this.daemonInstanceId || !this.daemonInstanceId) {
      throw new Error("Runtime session no longer matches the owned daemon");
    }
    const result = await this.control(config, "runtime-session", {
      body: { action, instanceId: this.daemonInstanceId },
    });
    if (result.status !== "ok" || result.pid !== health.pid || result.instance_id !== this.daemonInstanceId
      || result.version !== config.releaseVersion || result.mode !== config.mode) {
      throw new Error("Runtime session did not acknowledge the exact daemon identity");
    }
    return result;
  }

  async adoptBackgroundDaemon(config, signal) {
    if (this.launcherProfile !== "production" || this.daemon) return false;
    const state = this.readState();
    if (!state || runtimeOwnershipPredatesCurrentBoot(state)
      || typeof state.daemonInstanceId !== "string"
      || !/^[a-f0-9-]{36}$/.test(state.daemonInstanceId)) return false;
    if (state.ownerPid !== process.pid && processRunning(state.ownerPid)) return false;
    const health = await this.proxyHealthPayload(config);
    this.assertCanStart(signal);
    if (!health?.background_runtime || health.service !== "codex-chatgpt-web"
      || health.version !== config.releaseVersion || health.mode !== config.mode
      || health.pid !== state.daemonPid || health.instance_id !== state.daemonInstanceId) return false;
    // Authenticate before accepting the persisted PID, never on public health alone.
    const proof = await this.control(config, "runtime-session", {
      body: { action: "status", instanceId: state.daemonInstanceId },
    });
    this.assertCanStart(signal);
    if (proof.status !== "ok" || proof.pid !== state.daemonPid
      || proof.instance_id !== state.daemonInstanceId || proof.background_runtime !== true) {
      throw new Error("Background runtime ownership could not be authenticated");
    }
    const child = new EventEmitter();
    Object.assign(child, { pid: state.daemonPid, exitCode: null, signalCode: null, background: true });
    const timer = setInterval(() => {
      if (processRunning(child.pid)) return;
      clearInterval(timer);
      child.exitCode = 0;
      child.emit("exit", 0, null);
      if (this.daemon !== child) return;
      this.daemon = null;
      this.daemonInstanceId = null;
      if (this.stopping || this.expectedExits.has(child)) return;
      const detail = "Background native runtime exited";
      if (this.tryWriteState("degraded", detail)) this.scheduleRecovery("daemon");
      this.updateCapabilities("degraded", detail);
    }, 250);
    timer.unref();
    child.disposeMonitor = () => clearInterval(timer);
    child.unref = () => timer.unref();
    this.daemon = child;
    this.daemonInstanceId = state.daemonInstanceId;
    this.writeState("starting");
    await this.runtimeSession(config, "attach");
    await this.proxyHealth(config, 2_000, child.pid);
    this.logger.info("runtime.background_attached", { pid: child.pid });
    return true;
  }

  async detachForQuit() {
    const config = this.readConfig();
    if (this.launcherProfile !== "production" || !config || !this.daemon) {
      return this.shutdown({ cancelActiveTurns: false, force: false });
    }
    const health = await this.proxyHealthPayload(config);
    // The first upgrade from a pre-background release retains its proven idle shutdown path.
    if (health?.background_runtime !== true) return this.shutdown({ cancelActiveTurns: false, force: false });
    const proof = await this.runtimeSession(config, "status");
    if (!proof.background_network_ready) {
      throw new Error("The native network route is not ready for background use. Keep NEKODEX open or choose Stop connections and quit.");
    }
    this.shutdownRequested = true;
    this.shutdownResumeAllowed = false;
    this.cancelRecoveries();
    this.stopping = true;
    let detached = false;
    let settled = false;
    try {
      if (!await this.settleInitialStart() || !await this.settleRecoveryTasks()) {
        throw new Error("Runtime work is still settling; retry closing NEKODEX shortly");
      }
      settled = true;
      // The daemon atomically fences Web admission and checks every Web HTTP owner.
      // This never drains or cancels an active native stream.
      await this.runtimeSession(config, "detach");
      detached = true;
      this.stopTunnelMonitor();
      if (this.tunnel) await this.stopTunnelGracefully(config);
      this.writeState("background");
      this.daemon.disposeMonitor?.();
      this.daemon.unref?.();
      this.webAccepting = false;
      this.reportedTunnelReady = false;
      this.updateCapabilities("ready", "Native Codex remains available; reopen NEKODEX for ChatGPT Web", config);
      return { status: "background", daemonPid: this.daemon.pid };
    } catch (error) {
      if (detached) await this.runtimeSession(config, "attach").catch(failure => {
        this.logger.error("runtime.background_detach_compensation_failed", { message: errorMessage(failure) });
      });
      this.stopping = false;
      if (settled) {
        this.shutdownRequested = false;
        this.shutdownResumeAllowed = false;
        if (config.mode === "full") {
          if (this.tunnel) this.startTunnelMonitor(config);
          else this.scheduleRecovery("tunnel");
        }
      }
      throw error;
    }
  }

  async stopStaleOwnedRuntime(config, startSignal) {
    if (startSignal) this.assertCanStart(startSignal);
    const state = this.readState();
    if (!state) return false;
    if (runtimeOwnershipPredatesCurrentBoot(state)) {
      this.clearState();
      return false;
    }
    const tunnelOnly = this.launcherProfile === "development";
    if (tunnelOnly && processRunning(state.daemonPid)) {
      throw new Error("DEV launcher ownership unexpectedly contains a Responses daemon");
    }
    const health = tunnelOnly ? null : await this.proxyHealthPayload(config);
    if (startSignal) this.assertCanStart(startSignal);
    const daemonRunning = health?.service === "codex-chatgpt-web"
      && health?.mode === config.mode
      && health?.version === config.releaseVersion;
    if (daemonRunning && health.pid !== state.daemonPid) {
      throw new Error("The process on the Responses port does not match the stale launcher marker");
    }
    if (!daemonRunning && processRunning(state.daemonPid)) {
      throw new Error(
        `The stale daemon PID ${state.daemonPid} is still alive but did not provide matching health evidence`,
      );
    }
    let managedTunnelRunning = false;
    if (config.mode === "full") {
      const tunnelHealth = await this.waitForKnownTunnelStatus(config, 10_000, startSignal);
      if (startSignal) this.assertCanStart(startSignal);
      managedTunnelRunning = !tunnelRuntimeStopped(tunnelHealth);
      if (managedTunnelRunning
        && tunnelHealth.processRunning !== true
        && tunnelHealth.pid === null
        && typeof tunnelHealth.state !== "string") {
        throw new Error(`The stale tunnel runtime state is ambiguous: ${tunnelHealth.detail}`);
      }
      if (!managedTunnelRunning && processRunning(state.tunnelPid)) {
        throw new Error(
          `The stale tunnel PID ${state.tunnelPid} is still alive but the native runtime manager`
          + " does not recognize it; refusing to terminate an unverified process",
        );
      }
    } else if (processRunning(state.tunnelPid)) {
      throw new Error(
        `The stale tunnel PID ${state.tunnelPid} is still alive but browser-only configuration`
        + " has no tunnel identity with which to verify it",
      );
    }
    if (!daemonRunning && !managedTunnelRunning) {
      this.clearState();
      return true;
    }
    if (state.ownerPid !== process.pid && processRunning(state.ownerPid)) {
      throw new Error(`Another launcher process still owns the runtime (pid ${state.ownerPid})`);
    }

    this.logger.warn("runtime.stale_owner_recovery_started", {
      ownerPid: state.ownerPid,
      daemonPid: daemonRunning ? state.daemonPid : null,
      tunnelPid: managedTunnelRunning ? state.tunnelPid : null,
    });
    if (daemonRunning) {
      let drained = false;
      try {
        drained = await this.acquireDrain(config);
        if (startSignal) this.assertCanStart(startSignal);
        const shutdown = await this.control(config, "shutdown");
        if (shutdown.status !== "ok") throw new Error("stale daemon did not acknowledge graceful shutdown");
        await this.waitForProcessExit("stale daemon", state.daemonPid);
        await this.waitForPortRelease(config);
      } catch (error) {
        if (drained) {
          try {
            await this.control(config, "resume");
          } catch (resumeError) {
            throw new Error(appendFailure(errorMessage(error), "stale daemon resume compensation failed", resumeError));
          }
        }
        throw error;
      }
    }
    if (managedTunnelRunning) {
      if (startSignal) this.assertCanStart(startSignal);
      const stopped = await this.runTunnelStopCommand(config, startSignal);
      if (stopped.code !== 0) {
        throw new Error(`stale tunnel refused graceful shutdown: ${tunnelControlDiagnostic(stopped)}`);
      }
      await this.waitForTunnelStopped(config, 10_000, startSignal);
    }
    if (startSignal) this.assertCanStart(startSignal);
    this.clearState();
    this.logger.info("runtime.stale_owner_recovered");
    return true;
  }

  async acquireDrain(config, timeoutMs = DRAIN_IDLE_TIMEOUT_MS) {
    let attempted = false;
    let busyAtDeadline = false;
    try {
      attempted = true;
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const health = await this.control(config, "drain");
        if (health.accepting_turns !== false
          || !Number.isInteger(health.active_http_turns)
          || health.active_http_turns < 0
          || !Number.isInteger(health.active_browser_turns)
          || health.active_browser_turns < 0
          || !Number.isInteger(health.active_compaction_runs)
          || health.active_compaction_runs < 0) {
          throw new Error("daemon did not acknowledge the drain contract");
        }
        if (health.active_http_turns === 0
          && health.active_browser_turns === 0
          && health.active_compaction_runs === 0) return true;
        if (Date.now() >= deadline) {
          busyAtDeadline = true;
          throw new Error(
            `daemon has ${health.active_http_turns} active HTTP turn(s), ${health.active_browser_turns} active browser turn(s), and ${health.active_compaction_runs} active compaction run(s)`,
          );
        }
        await sleep(Math.min(DRAIN_POLL_INTERVAL_MS, Math.max(1, deadline - Date.now())));
      }
    } catch (error) {
      let resumeError;
      if (attempted) {
        try {
          await this.control(config, "resume");
        } catch (caught) {
          resumeError = caught;
        }
      }
      const message = resumeError
        ? appendFailure(errorMessage(error), "compensating resume failed", resumeError)
        : errorMessage(error);
      const failure = new Error(`Refusing to stop launcher-owned runtime because atomic idleness could not be proven: ${message}`);
      failure.code = resumeError ? "RUNTIME_RESUME_FAILED" : busyAtDeadline ? "RUNTIME_NOT_IDLE" : "RUNTIME_DRAIN_FAILED";
      throw failure;
    }
  }

  async cancelActiveTurns() {
    const config = this.readConfig();
    const daemon = this.daemon;
    if (!config || !daemon || daemon.exitCode !== null || daemon.signalCode !== null) {
      return { cancelledHttpTurns: 0, cancelledBrowserTurns: 0 };
    }
    const result = await this.control(config, "cancel-turns");
    if (result.status !== "ok"
      || !Number.isInteger(result.cancelled_http_turns)
      || !Number.isInteger(result.cancelled_browser_turns)
      || result.active_http_turns !== 0
      || result.active_browser_turns !== 0) {
      throw new Error("launcher-owned daemon did not acknowledge complete active-turn cancellation");
    }
    this.logger.info("runtime.active_turns_cancelled", {
      httpTurns: result.cancelled_http_turns,
      browserTurns: result.cancelled_browser_turns,
    });
    return {
      cancelledHttpTurns: result.cancelled_http_turns,
      cancelledBrowserTurns: result.cancelled_browser_turns,
    };
  }

  async cancelBrowserTurn(traceId, reason) {
    if (!/^[A-Za-z0-9_-]{6,128}$/.test(traceId || "")) throw new Error("Browser turn trace id is invalid");
    if (reason !== undefined && !["browser_surface_bootstrap_timeout", "helper_heartbeat_expired"].includes(reason)) {
      throw new Error("Browser turn cancellation reason is invalid");
    }
    const config = this.readConfig();
    const daemon = this.daemon;
    if (!config || !daemon || daemon.exitCode !== null || daemon.signalCode !== null) {
      throw new Error("Launcher-owned runtime is unavailable for browser-turn cancellation");
    }
    const result = await this.control(config, "cancel-turn", {
      body: { traceId, ...(reason ? { reason } : {}) },
      timeoutMs: 15_000,
    });
    if (result.status !== "ok"
      || result.trace_id !== traceId
      || !Number.isInteger(result.cancelled_browser_turns)
      || !Number.isInteger(result.cancelled_broker_turns)) {
      throw new Error("Launcher-owned runtime did not acknowledge targeted browser-turn cancellation");
    }
    this.logger.info("runtime.browser_turn_cancelled", {
      traceId,
      browserTurns: result.cancelled_browser_turns,
      brokerTurns: result.cancelled_broker_turns,
    });
    return result;
  }

  async stopChild(name, timeoutMs = 10_000) {
    const child = this[name];
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      this[name] = null;
      return;
    }
    this.expectedExits.add(child);
    try {
      terminateOwnedProcessTree(child);
    } catch (error) {
      this.expectedExits.delete(child);
      if (!processRunning(child.pid)) {
        this[name] = null;
        return;
      }
      throw new Error(`Could not request ${name} process-tree shutdown: ${errorMessage(error)}`);
    }
    try {
      await this.waitForChildExit(name, child, timeoutMs);
    } catch (gracefulError) {
      try {
        terminateOwnedProcessTree(child, "SIGKILL");
        await this.waitForChildExit(name, child, 2_000);
      } catch (forceError) {
        throw new Error(appendFailure(
          errorMessage(gracefulError),
          `forced ${name} process-tree shutdown failed`,
          forceError,
        ));
      }
      this.logger.warn(`runtime.${name}_forced_stop`, { message: errorMessage(gracefulError) });
    }
    this[name] = null;
  }

  async stopForSetup() {
    if (this.stopPromise) return this.stopPromise;
    this.cancelRecoveries();
    this.stopPromise = this.performStopForSetup();
    try {
      return await this.stopPromise;
    } finally {
      this.stopPromise = null;
    }
  }

  async performStopForSetup() {
    this.stopping = true;
    this.updateCapabilities("stopping");
    let config;
    let drained = false;
    let tunnelStopped = false;
    let startUnsettled = false;
    try {
      if (!await this.settleInitialStart()) {
        startUnsettled = true;
        throw new Error("Cancelled initial runtime startup did not settle within the shutdown bound");
      }
      this.stopTunnelMonitor();
      if (!await this.settleRecoveryTasks()) {
        throw new Error("Cancelled runtime recovery did not settle within the shutdown bound");
      }
      config = this.readConfig();
      const ownershipState = this.readState();
      const healthyRuntime = config && this.launcherProfile !== "development"
        ? await this.proxyHealth(config)
        : false;
      const runtimeMayBeLive = healthyRuntime || runtimeOwnershipMayBeLive(ownershipState);
      if (config?.mode === "full"
        && !this.tunnel
        && (runtimeMayBeLive || !ownershipState || this.recoveryAliasMayBeLive)) {
        await this.adoptConfiguredTunnelForStop(config);
      }
      if (!this.daemon && !this.tunnel) {
        if (!config) {
          if (ownershipState && !runtimeOwnershipPredatesCurrentBoot(ownershipState) && (
            processRunning(ownershipState.daemonPid)
            || processRunning(ownershipState.tunnelPid)
          )) {
            throw new Error("runtime configuration is missing while launcher ownership processes are still alive");
          }
        } else if (runtimeMayBeLive) {
          const recovered = await this.stopStaleOwnedRuntime(config);
          if (!recovered) {
            throw new Error("an existing runtime could not be safely recovered");
          }
        }
        this.clearState();
        this.updateCapabilities("stopped", null, config);
        return { status: "stopped" };
      }
      if (this.daemon && config) {
        const daemonPid = this.daemon.pid;
        if (!Number.isInteger(daemonPid)
          || !await this.proxyHealth(config, 2_000, daemonPid)) {
          throw new Error("launcher-owned daemon did not provide matching health evidence");
        }
        drained = await this.acquireDrain(config);
      }
      if (this.tunnel) {
        if (!config) throw new Error("launcher-owned tunnel cannot be stopped without a valid configuration");
        await this.stopTunnelGracefully(config);
        tunnelStopped = true;
      }
      if (this.daemon) {
        if (!config || !drained) {
          throw new Error("launcher-owned daemon cannot be stopped without a verified idle drain");
        }
        await this.shutdownDaemon(config);
      }
      this.clearState();
      this.updateCapabilities("stopped", null, config);
      return { status: "stopped" };
    } catch (error) {
      // The pending starter still owns its command and state. Do not write a
      // replacement ownership record or compensate while it can acquire a PID.
      if (startUnsettled) throw error;
      const compensationErrors = [];
      if (tunnelStopped && config?.mode === "full" && !this.tunnel) {
        try {
          await this.startTunnel(config);
        } catch (caught) {
          compensationErrors.push(["tunnel restart compensation failed", caught]);
        }
      }
      if (drained && config) {
        try {
          await this.restoreDrainedDaemon(config);
        } catch (caught) {
          compensationErrors.push(["daemon resume compensation failed", caught]);
        }
      }
      const message = compensationErrors.reduce(
        (current, [label, failure]) => appendFailure(current, label, failure),
        errorMessage(error),
      );
      let restoredReady = false;
      if (compensationErrors.length === 0 && config) {
        try {
          restoredReady = await this.ownedRuntimeReady(config);
        } catch {
          restoredReady = false;
        }
      }
      this.tryWriteState(restoredReady ? "ready" : "failed", message);
      this.updateCapabilities(restoredReady ? "ready" : "failed", message, config);
      throw new Error(message);
    } finally {
      this.stopping = false;
    }
  }

  async restart() {
    await this.stopForSetup();
    return this.startIfConfigured();
  }

  async forceStopOwnedRuntime(reason) {
    this.logger.warn("runtime.forced_shutdown_started", { message: errorMessage(reason) });
    this.stopping = true;
    this.stopTunnelMonitor();
    this.cancelRecoveries();
    this.cancelTunnelControls();
    try {
      const failures = [];
      if (!await this.settleInitialStart()) {
        const message = "cancelled initial runtime startup did not settle within the shutdown bound";
        this.logger.warn("runtime.forced_shutdown_unsettled_start", { message });
        return { status: "forced-partial", detail: errorMessage(reason), failures: [message] };
      }
      if (!await this.settleRecoveryTasks()) {
        failures.push("cancelled runtime recovery did not settle within the shutdown bound");
      }
      const controlsSettled = await this.settleTunnelControls();
      if (!controlsSettled) {
        failures.push("cancelled tunnel control operation did not settle within the shutdown bound");
      }
      let priorState;
      let ownershipStateUnreadable = false;
      try {
        priorState = this.readState();
      } catch (error) {
        ownershipStateUnreadable = true;
        failures.push(`ownership: ${errorMessage(error)}`);
      }
      if ((this.tunnel || this.recoveryAliasMayBeLive) && controlsSettled) {
        try {
          const config = this.readConfig();
          if (!config) throw new Error("runtime configuration is unavailable");
          const stopped = await this.runTunnelStopCommand(config);
          if (stopped.code !== 0 && !tunnelRuntimeAbsent(stopped.output)) {
            throw new Error(tunnelControlDiagnostic(stopped));
          }
          const health = await this.waitForTunnelStopped(config, 5_000);
          if (!tunnelRuntimeStopped(health)) throw new Error("tunnel stop did not prove absence");
          this.tunnel = null;
          this.recoveryAliasMayBeLive = false;
        } catch (error) {
          failures.push(`tunnel: ${errorMessage(error)}`);
        }
      }
      if (!await this.settleTunnelControls()) {
        failures.push("tunnel control operation remained unsettled after forced cleanup");
      }
      try {
        await this.stopChild("daemon");
      } catch (error) {
        failures.push(`daemon: ${errorMessage(error)}`);
      }
      const unadoptedPids = ["daemon", "tunnel"].flatMap(name => {
        const pid = priorState?.[`${name}Pid`];
        return pid && pid !== this[name]?.pid && processRunning(pid) ? [`${name}: ${pid}`] : [];
      });
      if (unadoptedPids.length > 0) {
        failures.push(`unadopted owned process(es) may still be live (${unadoptedPids.join(", ")})`);
      }
      if (failures.length === 0) {
        try {
          this.clearState();
        } catch (error) {
          failures.push(`ownership cleanup: ${errorMessage(error)}`);
        }
      }
      if (failures.length > 0 && !ownershipStateUnreadable && unadoptedPids.length === 0
        && !this.tryWriteState("failed", failures.join("; "))) {
        failures.push("ownership: could not persist the partial-cleanup state");
      }
      this.logger.warn("runtime.forced_shutdown_completed", {
        message: errorMessage(reason),
        failures,
        remainingDaemonPid: this.daemon?.pid ?? null,
        remainingTunnelPid: this.tunnel?.pid ?? null,
        ownershipStatePath: this.statePath,
      });
      return {
        status: failures.length === 0 ? "forced" : "forced-partial",
        detail: errorMessage(reason),
        failures,
      };
    } finally {
      this.stopping = false;
    }
  }

  async shutdown({ cancelActiveTurns = false, force = false } = {}) {
    this.shutdownRequested = true;
    this.shutdownResumeAllowed = false;
    this.cancelRecoveries();
    try {
      if (cancelActiveTurns) await this.cancelActiveTurns();
      return await this.stopForSetup();
    } catch (error) {
      if (!force) throw error;
      return this.forceStopOwnedRuntime(error);
    }
  }
}

module.exports = {
  MAX_RESTARTS_PER_WINDOW,
  RESTART_WINDOW_MS,
  TUNNEL_HEALTH_POLL_INTERVAL_MS,
  TUNNEL_MONITOR_FAILURE_THRESHOLD,
  TUNNEL_MONITOR_INTERVAL_MS,
  TUNNEL_START_TIMEOUT_MS,
  RuntimeSupervisor,
  managedTunnelConnectArgs,
  validateConfig,
};
