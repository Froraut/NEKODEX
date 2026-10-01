const path = require("node:path");
const { RuntimeSupervisor } = require("./runtime-supervisor.cjs");
const { processIdentity } = require('./update-recovery.cjs');

const keyOf = binding => `${binding.accountId}\0${binding.interactionMode}`;
const stateName = binding => Buffer.from(keyOf(binding)).toString("hex");
const processStartedAt = Date.now() - process.uptime() * 1_000;
const currentProcessMarker = marker => marker?.ownerPid === process.pid
  && Date.parse(marker.updatedAt) >= processStartedAt - 5_000;
function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}

class AccountTunnelPeer extends RuntimeSupervisor {
  constructor(options, binding, onChange) {
    super({ ...options, launcherProfile: "development", publishOperation: undefined,
      publishCapabilities: () => onChange() });
    this.binding = binding;
    this.statePath = path.join(options.coreHome, "runtime", `account-tunnel-${stateName(binding)}.json`);
    this.ownedAliasVerified = false;
    this.connectAttempted = false;
    this.initialAliasAbsent = false;
    this.restartOwnedAlias = false;
  }

  snapshot(status, detail) {
    return { ...super.snapshot(status, detail), accountId: this.binding.accountId,
      interactionMode: this.binding.interactionMode, tunnelId: this.binding.tunnel.tunnelId,
      alias: this.binding.tunnel.alias, ownerIdentity: processIdentity(process.pid),
      ...(this.tunnel?.pid ? { tunnelIdentity: processIdentity(this.tunnel.pid) } : {}) };
  }

  recoverableMarker(marker, pid) {
    if (!marker || marker.tunnelPid !== pid || !marker.ownerIdentity || !marker.tunnelIdentity
      || processIdentity(pid) !== marker.tunnelIdentity) return false;
    const owner = processIdentity(marker.ownerPid);
    return !processAlive(marker.ownerPid) || owner !== null && owner !== marker.ownerIdentity;
  }

  readState() {
    const state = super.readState();
    if (state && (state.accountId !== this.binding.accountId
      || state.interactionMode !== this.binding.interactionMode
      || state.tunnelId !== this.binding.tunnel.tunnelId
      || state.alias !== this.binding.tunnel.alias)) {
      throw new Error("Account tunnel ownership marker does not match its saved binding");
    }
    return state;
  }

  readConfig() {
    const parent = this.parentConfig();
    if (!parent?.accountTunnelMode || parent.mode !== "full"
      || parent.browserInteractionMode !== this.binding.interactionMode) return null;
    const current = parent.accountTunnels?.find(item => keyOf(item) === keyOf(this.binding));
    if (!current || current.tunnel.tunnelId !== this.binding.tunnel.tunnelId
      || current.tunnel.alias !== this.binding.tunnel.alias) return null;
    const appName = current.interactionMode === "manual" ? parent.manualAppName : parent.automaticAppName;
    if (typeof appName !== "string" || !appName.trim()) {
      throw new Error("Account tunnel interaction mode has no connector identity");
    }
    return { ...parent, accountTunnelMode: false, accountTunnels: undefined,
      tunnel: current.tunnel, browserInteractionMode: current.interactionMode, appName,
      experimentalAsyncToolOperations: current.interactionMode === "manual"
        ? false : parent.experimentalAsyncToolOperations === true,
      accountTunnelBinding: true };
  }

  async readTunnelHealth(config, signal) {
    const health = await super.readTunnelHealth(config, signal);
    if (health.absent || !health.statusKnown) return health;
    if (health.tunnelId !== config.tunnel.tunnelId || health.alias !== config.tunnel.alias) {
      throw new Error("Account tunnel inventory did not prove exact alias and tunnel id");
    }
    const checked = observation => {
      const marker = this.ownedAliasVerified && !Number.isInteger(this.tunnel?.pid)
        ? this.readState() : null;
      const expectedPid = Number.isInteger(this.tunnel?.pid) && this.tunnel.pid > 0
        ? this.tunnel.pid : currentProcessMarker(marker) ? marker.tunnelPid : null;
      if (observation.processRunning !== false && this.ownedAliasVerified
        && Number.isInteger(expectedPid) && expectedPid > 0
        && observation.pid !== expectedPid) {
        throw new Error("Account tunnel process identity changed during supervision");
      }
      return observation;
    };
    if (health.processRunning === false || Number.isInteger(health.pid) && health.pid > 0) return checked(health);
    // tunnel-client 0.0.12 cleanup identifies the alias and tunnel but omits
    // the PID when live_runtime is {found:false}. Its scoped status command
    // exposes process.pid; never adopt that PID without matching every identity.
    const result = await this.runTunnelCommand(config,
      ["runtimes", "status", config.tunnel.alias, "--json"], 5_000,
      "Account tunnel process identity", signal);
    if (result.code !== 0) {
      return { ...health, ready: false, statusKnown: false,
        detail: "Scoped account tunnel process status is unavailable" };
    }
    let status;
    try { status = JSON.parse(result.output); }
    catch { throw new Error("Scoped account tunnel process status is invalid JSON"); }
    const tunnel = config.tunnel;
    if (status?.alias !== tunnel.alias || status.tunnel_id !== tunnel.tunnelId
      || status.profile_name !== tunnel.profileName
      || typeof status.profile_dir !== "string"
      || path.resolve(status.profile_dir) !== path.resolve(tunnel.profileDir)) {
      throw new Error("Scoped account tunnel process identity does not match the saved binding");
    }
    const state = status.runtime_state ?? status.state;
    const pid = status.process?.pid;
    if (!Number.isInteger(pid) || pid < 1 || !["starting", "healthy", "ready"].includes(state)
      || health.ready && state !== "ready") {
      return { ...health, ready: false, statusKnown: false,
        detail: "Scoped account tunnel process did not prove a matching live PID and state" };
    }
    if (typeof status.health_url === "string") {
      try {
        const endpoint = new URL(status.health_url);
        if (endpoint.protocol === "http:" && endpoint.port
          && ["127.0.0.1", "[::1]", "::1"].includes(endpoint.hostname)) {
          this.tunnelHealthBaseUrl = `${endpoint.protocol}//${endpoint.host}`;
        }
      } catch { /* The separate local endpoint probe remains authoritative. */ }
    }
    return checked({ ...health, pid });
  }

  async observeTunnelForMonitor(config) {
    const inventory = await this.readTunnelHealth(config);
    if (!inventory.statusKnown || !inventory.ready) return inventory;
    if (!this.ownedAliasVerified) {
      return { ...inventory, ready: false, fatal: true,
        detail: "Account tunnel local ownership proof was lost" };
    }
    const local = await super.observeTunnelForMonitor(config);
    return { ...local, pid: inventory.pid };
  }

  async startTunnel(config, operationName, options) {
    const existing = await this.waitForKnownTunnelStatus(config, 10_000, options?.recoverySignal);
    const wasOwnAttempt = this.connectAttempted && this.initialAliasAbsent;
    this.initialAliasAbsent = existing.absent === true || existing.state === "stopped";
    if (existing.ready && !this.ownedAliasVerified) {
      const marker = this.readState();
      if (!wasOwnAttempt && (!(currentProcessMarker(marker) || this.recoverableMarker(marker, existing.pid)) || marker.status !== "ready"
        || marker.tunnelPid !== existing.pid)) {
        throw new Error("Account tunnel alias is ready without current launcher ownership proof");
      }
      if (!wasOwnAttempt) this.ownedAliasVerified = true;
    }
    this.restartOwnedAlias = this.ownedAliasVerified && options?.forceRestart === true;
    try {
      await super.startTunnel(config, operationName, options);
      // super.startTunnel has checked local inventory, /healthz, /readyz and MCP
      // diagnostics. The identity stays scoped to this alias and profile.
      this.ownedAliasVerified = true;
    } finally {
      this.restartOwnedAlias = false;
    }
  }

  async runTunnelConnectCommand(config, signal) {
    if (!this.initialAliasAbsent && !this.ownedAliasVerified && !this.restartOwnedAlias) {
      throw new Error("Account tunnel startup refuses an unowned existing alias");
    }
    this.connectAttempted = true;
    return super.runTunnelConnectCommand(config, signal);
  }

  async runTunnelStopCommand(config, signal) {
    const health = await this.readTunnelHealth(config, signal);
    if (health.absent || health.state === "stopped" && health.processRunning === false) {
      return { code: 1, output: "alias not running" };
    }
    if (!health.statusKnown) throw new Error("Account tunnel identity is unavailable for shutdown");
    const marker = this.readState();
    const expectedPid = this.tunnel?.pid ?? marker?.tunnelPid;
    const currentOwner = (currentProcessMarker(marker) || this.recoverableMarker(marker, health.pid)) && this.ownedAliasVerified;
    const newAttempt = this.connectAttempted && this.initialAliasAbsent;
    if (!currentOwner && !newAttempt) {
      throw new Error("Account tunnel shutdown has no current launcher ownership proof");
    }
    if (!Number.isInteger(expectedPid) || expectedPid < 1 || health.pid !== expectedPid) {
      throw new Error("Account tunnel process identity changed before shutdown");
    }
    const result = await super.runTunnelStopCommand(config, signal);
    if (result.code === 0) {
      this.ownedAliasVerified = false;
      this.connectAttempted = false;
    }
    return result;
  }

  async adoptConfiguredTunnelForStop(config) {
    const marker = this.readState();
    if (!currentProcessMarker(marker) || !this.ownedAliasVerified) return;
    if (!Number.isInteger(marker.tunnelPid) || marker.tunnelPid < 1) return;
    await super.adoptConfiguredTunnelForStop(config);
    if (this.tunnel && this.tunnel.pid !== marker.tunnelPid) {
      this.tunnel = null;
      throw new Error("Account tunnel adoption does not match its owned process identity");
    }
  }
}

class AccountTunnelSupervisor {
  constructor(options, onChange) {
    this.options = options;
    this.onChange = onChange;
    this.peers = new Map();
    this.bindings = [];
    this.activeMode = null;
  }

  configure(config) {
    const bindings = config?.accountTunnelMode === true && config.mode === "full"
      ? config.accountTunnels || [] : [];
    if (!Array.isArray(bindings)) throw new Error("Account tunnel bindings must be an array");
    const keys = new Set(bindings.map(keyOf));
    if (keys.size !== bindings.length
      || new Set(bindings.map(item => item.tunnel.tunnelId)).size !== bindings.length
      || new Set(bindings.map(item => item.tunnel.alias)).size !== bindings.length) {
      throw new Error("Account tunnel bindings must have distinct account modes, tunnel ids and aliases");
    }
    const active = bindings.filter(binding => binding.interactionMode === config.browserInteractionMode);
    const activeKeys = new Set(active.map(keyOf));
    for (const [key, peer] of this.peers) {
      if (!activeKeys.has(key) || JSON.stringify(active.find(binding => keyOf(binding) === key)?.tunnel)
        !== JSON.stringify(peer.binding.tunnel)
        || peer.runtimeStatus === "stopped" && peer.shutdownRequested === true) {
        if (peer.tunnel || peer.startPromise || peer.recoveryTasks.size
          || peer.restartTimers?.tunnel || peer.tunnelControlControllers?.size) {
          throw new Error("Account tunnel bindings changed before prior owners were stopped");
        }
        this.peers.delete(key);
      }
    }
    this.bindings = bindings;
    this.activeMode = config.browserInteractionMode;
    for (const binding of active) {
      const key = keyOf(binding);
      if (!this.peers.has(key)) {
        const peer = this.options.peerFactory
          ? this.options.peerFactory(binding, this.onChange)
          : new AccountTunnelPeer(this.options, binding, this.onChange);
        peer.parentConfig = () => this.options.readConfig();
        this.peers.set(key, peer);
      }
    }
    this.onChange();
  }

  snapshot() {
    let current;
    try { current = this.options.readConfig(); } catch { current = null; }
    const bindings = current?.accountTunnelMode === true && Array.isArray(current.accountTunnels)
      ? current.accountTunnels : this.bindings;
    const activeMode = current?.accountTunnelMode === true
      ? current.browserInteractionMode : this.activeMode;
    return bindings.map(binding => {
      if (binding.interactionMode !== activeMode) {
        return { accountId: binding.accountId, interactionMode: binding.interactionMode,
          tunnelId: binding.tunnel.tunnelId, status: "stopped", ready: false, pid: null,
          detail: "Inactive interaction mode" };
      }
      const peer = this.peers.get(keyOf(binding));
      const live = peer?.tunnel && peer.tunnel.exitCode === null && peer.tunnel.signalCode === null;
      const identityMatches = peer && JSON.stringify(peer.binding.tunnel) === JSON.stringify(binding.tunnel);
      const localIdentity = Number.isInteger(peer?.tunnel?.pid) && peer.tunnel.pid > 0
        && (peer.ownedAliasVerified === true || this.options.peerFactory);
      const ready = Boolean(identityMatches && live && localIdentity
        && peer.runtimeStatus === "ready" && peer.tunnelMonitorFailures === 0
        && peer.tunnelMonitorObservationUnavailable !== true && peer.reportedTunnelReady !== false);
      const status = ready ? "ready" : peer?.runtimeStatus === "starting" || peer?.runtimeStatus === "recovering"
        ? "starting" : peer?.runtimeStatus === "failed" || peer?.runtimeStatus === "degraded"
          ? "error" : peer?.runtimeStatus === "stopped" ? "stopped" : "unknown";
      return { accountId: binding.accountId, interactionMode: binding.interactionMode,
        tunnelId: binding.tunnel.tunnelId, status, ready,
        pid: identityMatches ? peer?.tunnel?.pid ?? null : null,
        ...(status === 'error' ? { detail: 'This account’s tool tunnel needs repair' } : {}) };
    });
  }

  getStatus(accountId, mode) {
    return this.snapshot().find(item => item.accountId === accountId && item.interactionMode === mode)
      || { accountId, interactionMode: mode, status: "unconfigured", ready: false, pid: null };
  }

  async start(config) {
    this.configure(config);
    await Promise.allSettled([...this.peers.values()]
      .filter(peer => !peer.tunnel && !peer.startPromise
        && !peer.recoveryTasks?.size && !peer.restartTimers?.tunnel
        && !peer.tunnelControlControllers?.size
        && ["unconfigured", "stopped", "unknown"].includes(peer.runtimeStatus))
      .map(async peer => {
      try {
        const result = await peer.startIfConfigured();
        if (result.status !== "ready") {
          peer.runtimeStatus = "failed";
          peer.runtimeDetail = result.detail || `Account tunnel startup returned ${result.status}`;
        }
      }
      catch (error) { this.options.logger.error("runtime.account_tunnel_start_failed", {
        accountId: peer.binding.accountId, interactionMode: peer.binding.interactionMode, message: error.message,
      }); }
      finally { this.onChange(); }
    }));
  }

  async prepareChange(accountId, mode) {
    const key = keyOf({ accountId, interactionMode: mode });
    const peer = this.peers.get(key);
    if (!peer) return { status: "no-active-peer" };
    // The parent has not persisted the replacement yet, so the peer can still
    // authenticate its old alias, tunnel id, PID and ownership marker.
    await peer.shutdown();
    this.peers.delete(key);
    this.onChange();
    return { status: "stopped", accountId, interactionMode: mode };
  }

  ownedKeys() {
    return [...this.peers].filter(([, peer]) => peer.tunnel || peer.startPromise
      || peer.recoveryTasks?.size || peer.restartTimers?.tunnel
      || peer.recoveryAliasMayBeLive || peer.tunnelControlControllers?.size
      || ["starting", "recovering", "ready"].includes(peer.runtimeStatus)
      || Number.isInteger(peer.readState?.()?.tunnelPid)).map(([key]) => key);
  }

  async restartOwned(keys) {
    const results = await Promise.allSettled(keys.map(async key => {
      const peer = this.peers.get(key);
      if (!peer || peer.tunnel || peer.runtimeStatus !== "stopped") return;
      // A successful stop commits shutdownRequested. Failed-stop compensation is
      // the one path that may release that fence and restart the same old binding.
      peer.allowRestartAfterQuitFailure?.();
      if (peer.restartTimers?.tunnel) {
        clearTimeout(peer.restartTimers.tunnel);
        peer.restartTimers.tunnel = null;
      }
      const result = await peer.startIfConfigured();
      if (result?.status !== "ready") throw new Error(`Account tunnel restart returned ${result?.status || "unknown"}`);
    }));
    this.onChange();
    const failures = results.filter(result => result.status === "rejected");
    if (failures.length) throw new AggregateError(failures.map(result => result.reason),
      "Owned account tunnel restart compensation failed");
  }

  async stop({ force = false } = {}) {
    const results = await Promise.allSettled([...this.peers.values()].map(peer => peer.shutdown({ force })));
    this.onChange();
    const failures = results.filter(result => result.status === "rejected"
      || result.value?.status === "forced-partial");
    if (failures.length) throw new AggregateError(failures.map(result => result.reason
      ?? new Error(result.value.failures?.join("; ") || "forced cleanup was partial")),
    "Account tunnel shutdown incomplete");
  }

  allowRestartAfterQuitFailure() {
    for (const peer of this.peers.values()) peer.allowRestartAfterQuitFailure();
  }
}

module.exports = { AccountTunnelSupervisor, AccountTunnelPeer };
