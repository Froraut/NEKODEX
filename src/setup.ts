import { transitionSetupConfig, meaningfulRuntimeChange, type SetupOptions } from "./setup-policy";
export type { SetupOptions } from "./setup-policy";
import { fileSnapshotsMatch as sameSnapshot, restoreFileSnapshot, snapshotFile, type FileSnapshot } from "./file-transactions";
import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { join } from "node:path";
import type { AppConfig, BrowserInteractionMode, RuntimeMode } from "./config";
import {
  currentRuntimeCommand,
  defaultBrokerEndpoint,
  defaultConfig,
  getConfigPath,
  readConfigForSetup,
  type ConfigRead,
  saveConfig,
  tunnelConfigForInteractionMode,
} from "./config";
import {
  browserLoginStateExists,
  browserLoginStateNeedsReverification,
  inspectBrowserLoginCapabilities,
  loginToChatGpt,
  storedBrowserLoginCapabilities,
} from "./browser-login";
import {
  installCodexIntegration,
  preflightCodexIntegration,
  readCodexSubagentProtocol,
} from "./codex-integration";
import { inspectLauncherBrowserHost } from "./launcher-browser-host";
import {
  DEV_CONFIG_PURPOSE,
  DEV_LAUNCHER_PROFILE,
  DEV_TUNNEL_BASE_NAME,
} from "./dev-chat/constants";
import {
  assertServiceIdle,
  getServiceStatus,
  installService,
  removeLegacyRuntimeArtifacts,
  restartService,
  uninstallService,
} from "./service";
import { connectTunnel, createTunnelConfig, installRuntimeKey, installRuntimeKeyBytes, installTunnelClient, managedRuntimeKeyPath, restoreTunnelClientInstallation, snapshotTunnelClientInstallation, stopTunnel, waitForTunnelReady } from "./tunnel";
import type { TunnelClientInstallSnapshot } from "./tunnel";
import { getTunnelServiceStatus, installTunnelService, restartTunnelService, stopTunnelService, tunnelServiceDefinitionMatches, uninstallTunnelService } from "./tunnel-service";
import { launchDomain } from "./launch-agent";
import { runChecked, runCommand, type CommandResult } from "./process";
import { VERSION } from "./version";

export interface SetupResult {
  mode: RuntimeMode;
  configPath: string;
  loginCreated: boolean;
  serviceLoaded: boolean;
  tunnelReady: boolean | null;
  codexRestartRequired: true;
  connectorSetupRequired: boolean;
  connectorName: string;
  experimentalAsyncToolOperations: boolean;
  connectorVerificationReset: boolean;
  warnings?: string[];
}

interface PreparedSetup {
  existing: AppConfig | undefined;
  config: AppConfig;
  launcherOwned: boolean;
  read: ConfigRead;
}

export interface DevProfileSetupResult {
  mode: RuntimeMode;
  configPath: string;
  tunnelReady: boolean | null;
  connectorSetupRequired: boolean;
  connectorName: string;
  experimentalAsyncToolOperations: boolean;
  connectorVerificationReset: boolean;
}

export interface ExistingFullSetupCredentials {
  tunnelId: boolean;
  runtimeKey: boolean;
}

export function launcherCapabilityProbeRequired(
  existing: AppConfig | undefined,
  refreshAccountCapabilities = false,
  interactionMode: BrowserInteractionMode = existing?.browserInteractionMode ?? "automatic",
): boolean {
  if (interactionMode === "manual") return false;
  return refreshAccountCapabilities
    || existing?.browserInteractionMode === "manual"
    || existing?.browserHost !== "launcher"
    || typeof existing.solAvailable !== "boolean"
    || (typeof existing.extraHighAvailable !== "boolean" && existing.proAvailable !== true)
    || typeof existing.proAvailable !== "boolean";
}

export function existingFullSetupCredentials(
  existing: AppConfig | undefined,
  interactionMode: BrowserInteractionMode = existing?.browserInteractionMode ?? "automatic",
): ExistingFullSetupCredentials {
  const tunnel = existing?.mode === "full"
    ? tunnelConfigForInteractionMode(existing, interactionMode)
    : undefined;
  return {
    tunnelId: Boolean(tunnel?.tunnelId),
    runtimeKey: Boolean(tunnel?.runtimeKeyFile && existsSync(tunnel.runtimeKeyFile)),
  };
}

/** Identity comes from the same before-image as the migrated candidate. */
function activeConnectorIdentityMigrationRequired(config: AppConfig, read: ConfigRead): boolean {
  return read.persistedIdentity !== undefined && read.persistedIdentity !== config.appName;
}

function assertConfigReadCurrent(read: ConfigRead): void {
  if (!sameSnapshot(snapshotFile(read.snapshot.path), read.snapshot)) {
    throw new Error("Setup config changed during setup; preserving the concurrent edit");
  }
}

export function tunnelWorkerRuntimeChanged(before: AppConfig | undefined, after: AppConfig): boolean {
  if (!before || before.mode !== "full" || after.mode !== "full") return false;
  return before.releaseVersion !== after.releaseVersion
    || JSON.stringify(before.runtimeCommand) !== JSON.stringify(after.runtimeCommand)
    || before.allowWebSubagents !== after.allowWebSubagents
    || before.experimentalAsyncToolOperations !== after.experimentalAsyncToolOperations
    || before.brokerSocketPath !== after.brokerSocketPath
    || before.browserInteractionMode !== after.browserInteractionMode
    || JSON.stringify(before.tunnel) !== JSON.stringify(after.tunnel);
}

async function assertPortAvailable(host: string, port: number): Promise<void> {
  await new Promise<void>((resolveAvailable, rejectAvailable) => {
    const server = createServer();
    server.unref();
    server.once("error", error => rejectAvailable(new Error(`Cannot bind ${host}:${port}: ${error.message}`)));
    server.listen(port, host, () => server.close(error => error ? rejectAvailable(error) : resolveAvailable()));
  });
}

export function setupProxyIsReady(
  health: Record<string, unknown>,
  config: Pick<AppConfig, "mode" | "releaseVersion">,
): boolean {
  return health.service === "codex-chatgpt-web"
    && health.status === "ok"
    && health.mode === config.mode
    && health.version === config.releaseVersion
    && health.accepting_turns === true
    && (config.mode !== "full" || health.broker_ready === true);
}

async function waitForProxy(config: AppConfig, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "not reachable";
  while (Date.now() < deadline) {
    const controller = new AbortController();
    const requestTimeout = setTimeout(() => controller.abort(), 2_000);
    try {
      const response = await fetch(`http://${config.host}:${config.port}/healthz`, {
        signal: controller.signal,
      });
      if (response.ok) {
        const body = await response.json() as Record<string, unknown>;
        if (setupProxyIsReady(body, config)) return;
        lastError = `unexpected health payload: ${JSON.stringify(body)}`;
      } else {
        lastError = `HTTP ${response.status}`;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    } finally {
      clearTimeout(requestTimeout);
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 250));
  }
  throw new Error(`Responses proxy did not become ready: ${lastError}`);
}

function baseConfig(existing: AppConfig | undefined, options: SetupOptions, profile: "production" | "development" = "production"): AppConfig {
  return transitionSetupConfig(existing, options, {
    defaults: existing ?? defaultConfig(options.mode), profile, version: VERSION,
    runtimeCommand: currentRuntimeCommand(), brokerEndpoint: defaultBrokerEndpoint(),
    acknowledgementTime: new Date().toISOString(),
  });
}

async function inspectLauncherCapabilities(
  config: AppConfig,
  existing: AppConfig | undefined,
  refreshAccountCapabilities: boolean,
  expectedProfile: "production" | "development",
): Promise<{ solAvailable: boolean; extraHighAvailable: boolean; proAvailable: boolean }> {
  const detectCapabilities = launcherCapabilityProbeRequired(
    existing,
    refreshAccountCapabilities,
    config.browserInteractionMode,
  );
  const inspected = await inspectLauncherBrowserHost(config.browserHostDescriptorPath!, {
    detectCapabilities,
    expectedProfile,
  });
  return {
    solAvailable: detectCapabilities ? inspected.solAvailable === true : existing!.solAvailable,
    extraHighAvailable: detectCapabilities
      ? inspected.extraHighAvailable === true
      : existing!.extraHighAvailable ?? existing!.proAvailable,
    proAvailable: detectCapabilities ? inspected.proAvailable === true : existing!.proAvailable,
  };
}

/** `tunnel-client runtimes status --json` explicitly reports a stopped runtime without error.
 * An unreadable status is uncertain ownership, not evidence of a stopped runtime. */
function runtimeStatusReportsStopped(result: CommandResult): boolean {
  if (result.status !== 0) return false;
  try {
    const status = JSON.parse(result.stdout.trim() || result.stderr.trim()) as Record<string, unknown>;
    return status.process_running === false
      && (status.runtime_state === "stopped" || status.status === "stopped")
      && status.error === undefined;
  } catch { return false; }
}

/** A failed connect is not evidence of a stopped runtime. Probe with the candidate client;
 * never send stop to an alias whose launch did not return an ownership checkpoint. */
function failedConnectIsStopped(config: AppConfig): boolean {
  if (!config.tunnel) return false;
  try {
    return runtimeStatusReportsStopped(runCommand(config.tunnel.binaryPath,
      ["runtimes", "status", config.tunnel.alias, "--json"], { timeout: 10_000 }));
  } catch { return false; }
}

async function configureTunnel(
  config: AppConfig,
  existing: AppConfig | undefined,
  options: SetupOptions,
  expectedTunnelClient?: TunnelClientInstallSnapshot,
  onInstalled?: (owned: TunnelClientInstallSnapshot) => void,
  onKeyWritten?: (receipt: FileSnapshot) => void,
  expectedRuntimeKey?: FileSnapshot,
): Promise<void> {
  if (config.mode === "browser-only") {
    delete config.tunnel;
    delete config.automaticTunnel;
    delete config.manualTunnel;
    return;
  }
  const interactionMode = config.browserInteractionMode;
  const legacyTunnel = existing?.mode === "full"
    && !existing.automaticTunnel
    && !existing.manualTunnel
    ? existing.tunnel
    : undefined;
  let automaticTunnel = existing?.automaticTunnel
    ?? legacyTunnel;
  let manualTunnel = existing?.manualTunnel;
  const existingTunnel = interactionMode === "manual" ? manualTunnel : automaticTunnel;
  const tunnelId = options.tunnelId ?? existingTunnel?.tunnelId;
  if (!tunnelId) {
    throw new Error(`${interactionMode === "manual" ? "Manual mode" : "Automatic"} mode requires its own Tunnel ID`);
  }
  if (!/^tunnel_[a-f0-9]{32}$/.test(tunnelId)) {
    throw new Error("--tunnel-id must be tunnel_ followed by 32 lowercase hexadecimal characters");
  }
  const otherTunnel = interactionMode === "manual" ? automaticTunnel : manualTunnel;
  if (otherTunnel?.tunnelId === tunnelId) {
    throw new Error("Automatic and Manual mode require different Tunnel IDs and separate ChatGPT connectors");
  }
  let expectedKey = expectedRuntimeKey;
  const keyWritten = (_bytes: Uint8Array, receipt: FileSnapshot): void => {
    expectedKey = receipt;
    onKeyWritten?.(receipt);
  };
  let runtimeKeyFile = existingTunnel?.runtimeKeyFile;
  const managedKeyFile = managedRuntimeKeyPath(interactionMode);
  if ((!runtimeKeyFile || !existsSync(runtimeKeyFile)) && existsSync(managedKeyFile)) {
    runtimeKeyFile = managedKeyFile;
  }
  if (options.runtimeKeyFile) {
    runtimeKeyFile = installRuntimeKey(options.runtimeKeyFile, interactionMode, keyWritten, expectedKey);
  }
  if (options.runtimeKeyValue) {
    runtimeKeyFile = installRuntimeKeyBytes(options.runtimeKeyValue, interactionMode, keyWritten, expectedKey);
  }
  if (runtimeKeyFile && runtimeKeyFile !== managedKeyFile && existsSync(runtimeKeyFile)) {
    runtimeKeyFile = installRuntimeKey(runtimeKeyFile, interactionMode, keyWritten, expectedKey);
  }
  if (!runtimeKeyFile || !existsSync(runtimeKeyFile)) {
    throw new Error(`${interactionMode === "manual" ? "Manual mode" : "Automatic"} mode requires its own runtime key`);
  }
  const installedBinary = await installTunnelClient(expectedTunnelClient, onInstalled);
  const productionProfileName = interactionMode === "manual"
    ? "codex-chatgpt-web-zero-risk"
    : "codex-chatgpt-web";
  const profileName = config.purpose === DEV_CONFIG_PURPOSE
    ? interactionMode === "manual" ? `${DEV_TUNNEL_BASE_NAME}-zero-risk` : DEV_TUNNEL_BASE_NAME
    : productionProfileName;
  const configuredTunnel = createTunnelConfig({
    binaryPath: installedBinary,
    tunnelId,
    runtimeKeyFile,
    profileName,
    alias: profileName,
  });
  if (interactionMode === "manual") manualTunnel = configuredTunnel;
  else automaticTunnel = configuredTunnel;
  config.tunnel = configuredTunnel;
  if (automaticTunnel) config.automaticTunnel = automaticTunnel;
  else delete config.automaticTunnel;
  if (manualTunnel) config.manualTunnel = manualTunnel;
  else delete config.manualTunnel;
}

async function bootstrapTunnelProfile(
  config: AppConfig,
  onProfileWritten?: () => void,
  onValidationStopped?: () => void,
  onConnectFailed?: () => void,
  keepRuntime = false,
): Promise<void> {
  let bootstrapError: unknown;
  let connectReturned = false;
  try {
    // `runtimes connect` writes the native profile and returns once its managed runtime is healthy.
    // Readiness follows after a successful control-plane poll, so setup proves it separately before
    // transferring it to the launcher supervisor, or stopping temporary external-service validation.
    connectTunnel(config);
    connectReturned = true;
    onProfileWritten?.();
    const status = await waitForTunnelReady(config);
    if (!status.ok) throw new Error(`Tunnel runtime did not become healthy and ready: ${status.detail}`);
  } catch (error) {
    if (!connectReturned) onConnectFailed?.();
    bootstrapError = error;
  }
  if (keepRuntime && connectReturned && !bootstrapError) return;
  if (connectReturned) {
    try {
      stopTunnel(config);
      onValidationStopped?.();
    } catch (stopError) {
      if (bootstrapError) {
        const primary = bootstrapError instanceof Error ? bootstrapError.message : String(bootstrapError);
        const cleanup = stopError instanceof Error ? stopError.message : String(stopError);
        throw new Error(`${primary}; temporary tunnel cleanup also failed: ${cleanup}`);
      }
      throw stopError;
    }
  }
  if (bootstrapError) throw bootstrapError;
}

function prepareSetup(options: SetupOptions): PreparedSetup {
  const read = readConfigForSetup();
  const existing = read.config;
  if (existing?.purpose === DEV_CONFIG_PURPOSE) {
    throw new Error("A DEV harness configuration cannot be installed into Codex");
  }
  const config = baseConfig(existing, {
    ...options,
    subagentProtocol: options.subagentProtocol
      ?? readCodexSubagentProtocol(existing?.subagentProtocol ?? "compatibility-v1"),
  });
  delete config.purpose;
  const launcherOwned = config.browserHost === "launcher";
  if (!launcherOwned && process.platform !== "darwin") {
    throw new Error(
      "Terminal-only managed Chrome setup currently requires macOS. "
      + "Use the NEKODEX launcher on Windows or Linux.",
    );
  }
  return { existing, config, launcherOwned, read };
}

/** Re-bootstrap the exact definition restored by rollback; installers regenerate plist bytes. */
function bootstrapRestoredDefinition(path: string): void {
  runChecked("launchctl", ["bootstrap", launchDomain(), path]);
}

export function preflightSetup(options: SetupOptions): void {
  const { existing, config } = prepareSetup(options);
  if (config.mode === "full") {
    const saved = existing?.mode === "full"
      ? tunnelConfigForInteractionMode(existing, config.browserInteractionMode)
      : undefined;
    const tunnelId = options.tunnelId ?? saved?.tunnelId;
    if (!tunnelId) {
      throw new Error(
        `${config.browserInteractionMode === "manual" ? "Manual mode" : "Automatic"} mode needs its own MCP Tunnel ID`,
      );
    }
    const savedKey = saved?.runtimeKeyFile;
    const managedKey = managedRuntimeKeyPath(config.browserInteractionMode);
    const hasRuntimeKey = Boolean(
      options.runtimeKeyValue
      || (options.runtimeKeyFile && existsSync(options.runtimeKeyFile))
      || (savedKey && existsSync(savedKey))
      || existsSync(managedKey),
    );
    if (!hasRuntimeKey) {
      throw new Error(
        `${config.browserInteractionMode === "manual" ? "Manual mode" : "Automatic"} mode needs its own MCP runtime key`,
      );
    }
    const otherMode = config.browserInteractionMode === "manual" ? "automatic" : "manual";
    const other = existing?.mode === "full"
      ? tunnelConfigForInteractionMode(existing, otherMode)
      : undefined;
    if (other?.tunnelId === tunnelId) {
      throw new Error("Automatic and Manual mode require different Tunnel IDs and separate ChatGPT connectors");
    }
  }
  preflightCodexIntegration(config, {
    replaceExistingRoute: options.replaceCodexRoute,
  });
}

export async function setup(options: SetupOptions): Promise<SetupResult> {
  const { existing, config, launcherOwned, read } = prepareSetup(options);
  preflightCodexIntegration(config, {
    replaceExistingRoute: options.replaceCodexRoute,
  });
  const connectorIdentityMigrating = config.mode === "full"
    && activeConnectorIdentityMigrationRequired(config, read);
  const connectorVerificationReset = Boolean(existing
    && (existing.appName !== config.appName
      || existing.experimentalAsyncToolOperations !== config.experimentalAsyncToolOperations));
  const refreshTunnelWorker = tunnelWorkerRuntimeChanged(existing, config)
    || connectorIdentityMigrating;
  if (existing && options.restartService) config.controlToken = randomBytes(32).toString("base64url");
  const beforeService = getServiceStatus();
  if (launcherOwned && (beforeService.installed || beforeService.loaded)) {
    if (!existing) {
      throw new Error("A legacy background service exists without a verifiable configuration; refusing automatic migration");
    }
    if (!options.restartService) {
      throw new Error(
        "Launcher ownership migration must stop the legacy background service. "
        + "Retry from the launcher after the active Codex task finishes.",
      );
    }
  }
  if (beforeService.loaded && !existing) {
    throw new Error("A codex-chatgpt-web service is loaded but its configuration is missing; refusing to replace an unverifiable process");
  }

  let loginCreated = false;
  let solAvailable: boolean | undefined = config.solAvailable;
  let extraHighAvailable: boolean | undefined = config.extraHighAvailable;
  let proAvailable: boolean | undefined = config.proAvailable;
  if (config.browserInteractionMode === "manual") {
    // The generic manual route is independent of account capabilities. The launcher may open the
    // authenticated surface, but setup must not inspect its model selector or infer availability.
  } else if (config.browserHost === "launcher") {
    if (options.forceLogin) throw new Error("Launcher browser login is owned by the launcher UI; --login cannot replace it");
    const capabilities = await inspectLauncherCapabilities(
      config,
      existing,
      options.refreshAccountCapabilities === true,
      "production",
    );
    solAvailable = capabilities.solAvailable;
    extraHighAvailable = capabilities.extraHighAvailable;
    proAvailable = capabilities.proAvailable;
  } else {
    const stored = storedBrowserLoginCapabilities(config);
    solAvailable = stored.solAvailable;
    extraHighAvailable = stored.extraHighAvailable;
    proAvailable = stored.proAvailable;
    const verifiedLogin = browserLoginStateExists(config);
    const legacyLoginNeedsReverification = !verifiedLogin && browserLoginStateNeedsReverification(config);
    const loginRequired = options.forceLogin || (!verifiedLogin && !legacyLoginNeedsReverification);
    const capabilityProbeRequired = !loginRequired
      && (options.refreshAccountCapabilities === true
        || legacyLoginNeedsReverification
        || existing?.browserInteractionMode === "manual"
        || solAvailable === undefined
        || extraHighAvailable === undefined
        || proAvailable === undefined);
    if (beforeService.loaded && (loginRequired || capabilityProbeRequired) && !options.restartService) {
      throw new Error(
        "Setup must verify the browser account before changing the running daemon. "
        + "Rerun from a normal terminal with --restart-service after the active task finishes.",
      );
    }
    if (beforeService.loaded && (loginRequired || capabilityProbeRequired) && existing) await assertServiceIdle(existing);
    if (loginRequired) {
      const login = await loginToChatGpt(config);
      solAvailable = login.solAvailable;
      extraHighAvailable = login.extraHighAvailable;
      proAvailable = login.proAvailable;
      loginCreated = true;
    } else if (capabilityProbeRequired) {
      const inspected = await inspectBrowserLoginCapabilities(config);
      solAvailable = inspected.solAvailable;
      extraHighAvailable = inspected.extraHighAvailable;
      proAvailable = inspected.proAvailable;
    }
  }
  assertConfigReadCurrent(read);
  config.solAvailable = solAvailable === true;
  config.extraHighAvailable = config.solAvailable && extraHighAvailable === true;
  config.proAvailable = config.solAvailable && proAvailable === true;
  const explicitTunnelChange = Boolean(options.tunnelId || options.runtimeKeyFile || options.runtimeKeyValue);
  const preliminaryChange = Boolean(existing && (meaningfulRuntimeChange(existing, config)
    || connectorIdentityMigrating || explicitTunnelChange || options.forceLogin));
  if (beforeService.loaded && preliminaryChange && !options.restartService) {
    throw new Error(
      "The daemon is currently serving a Codex task and setup would change its runtime. "
      + "Rerun from a normal terminal with --restart-service after the active task finishes.",
    );
  }
  if (beforeService.loaded && preliminaryChange && existing) await assertServiceIdle(existing);
  assertConfigReadCurrent(read);
  const runtimeKeyPath = managedRuntimeKeyPath(config.browserInteractionMode);
  const runtimeKeyBeforeRoute = snapshotFile(runtimeKeyPath);
  let runtimeKeyAfterRoute = runtimeKeyBeforeRoute;
  const tunnelClientBeforeRoute = snapshotTunnelClientInstallation();
  let tunnelClientAfterRoute: TunnelClientInstallSnapshot = tunnelClientBeforeRoute;
  // The final Codex route write can still lose a race with edits made after preflight.
  // Keep the setup-owned files' original bytes so that a failed commit can compensate
  // without replacing a concurrent user edit.
  const configBeforeRoute = read.snapshot;
  const servicePath = beforeService.definitionPath;
  const serviceBeforeRoute = servicePath ? snapshotFile(servicePath) : undefined;
  const tunnelServiceBeforeRoute = getTunnelServiceStatus();
  const tunnelServicePath = tunnelServiceBeforeRoute.definitionPath;
  const tunnelDefinitionBeforeRoute = tunnelServicePath ? snapshotFile(tunnelServicePath) : undefined;
  let tunnelProfilePath: string | undefined;
  let tunnelProfileBeforeRoute: FileSnapshot | undefined;
  let tunnelProfileAfterRoute: FileSnapshot | undefined;
  let serviceAfterRoute = serviceBeforeRoute;
  let serviceLoadedAfterRoute = beforeService.loaded;
  let tunnelDefinitionAfterRoute = tunnelDefinitionBeforeRoute;
  let tunnelServiceLoadedAfterRoute = tunnelServiceBeforeRoute.loaded;
  const statusProbeFailures: string[] = [];
  let serviceStatusUnknown = false;
  let tunnelStatusUnknown = false;
  const observeServiceState = (): void => {
    try { serviceLoadedAfterRoute = getServiceStatus().loaded; }
    catch (error) {
      serviceStatusUnknown = true;
      statusProbeFailures.push(`background service status: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const observeTunnelState = (): void => {
    try { tunnelServiceLoadedAfterRoute = getTunnelServiceStatus().loaded; }
    catch (error) {
      tunnelStatusUnknown = true;
      statusProbeFailures.push(`tunnel service status: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const assertKnownServiceState = (): void => {
    if (serviceStatusUnknown) throw new Error("Background service status is unknown after setup transition");
  };
  const assertKnownTunnelState = (): void => {
    if (tunnelStatusUnknown) throw new Error("Tunnel service status is unknown after setup transition");
  };
  const onServiceDefinitionWritten = ({ path, receipt }: { path: string; receipt: FileSnapshot }): void => {
    if (path !== servicePath) throw new Error("Service definition path changed during setup");
    serviceAfterRoute = receipt;
  };
  const onTunnelDefinitionWritten = ({ path, receipt }: { path: string; receipt: FileSnapshot }): void => {
    if (path !== tunnelServicePath) throw new Error("Tunnel service definition path changed during setup");
    tunnelDefinitionAfterRoute = receipt;
  };
  const checkpointServiceRemoval = (): void => {
    if (servicePath && !existsSync(servicePath)) {
      serviceAfterRoute = { path: servicePath, exists: false };
    }
    observeServiceState();
  };
  const checkpointOwnedTunnelProfile = (): void => {
    tunnelProfileAfterRoute = tunnelProfilePath ? snapshotFile(tunnelProfilePath) : undefined;
  };
  const checkpointTunnelState = (): void => {
    observeTunnelState();
  };
  const checkpointTunnelRemoval = (): void => {
    if (tunnelServicePath && !existsSync(tunnelServicePath)) {
      tunnelDefinitionAfterRoute = { path: tunnelServicePath, exists: false };
    }
    checkpointTunnelState();
  };
  const tunnelServiceUnchanged = (): boolean => {
    if (!tunnelServicePath || !tunnelDefinitionBeforeRoute) return true;
    const current = snapshotFile(tunnelServicePath);
    return sameSnapshot(current, tunnelDefinitionBeforeRoute)
      && getTunnelServiceStatus().loaded === tunnelServiceBeforeRoute.loaded;
  };
  let changedWhileLoaded = false;
  const migratingTerminalRuntime = Boolean(
    launcherOwned && existing && existing.browserHost !== "launcher",
  );
  let tunnelReady: boolean | null = null;
  let validationTunnelStarted = false;
  let validationTunnelRunning = false;
  let previousTunnelStopped = false;
  let failedConnectMayHaveWrittenProfile = false;
  let savedConfigReceipt: FileSnapshot | undefined;
  const configUnchanged = (): boolean => {
    const current = snapshotFile(getConfigPath());
    return sameSnapshot(current, configBeforeRoute);
  };
  const serviceUnchanged = (): boolean => {
    if (!servicePath || !serviceBeforeRoute) return true;
    const current = snapshotFile(servicePath);
    return sameSnapshot(current, serviceBeforeRoute)
      && getServiceStatus().loaded === beforeService.loaded;
  };

  let tunnelRuntimeTouched = false;
  try {
    await configureTunnel(config, existing, options,
      tunnelClientBeforeRoute,
      owned => { tunnelClientAfterRoute = owned; },
      receipt => { runtimeKeyAfterRoute = receipt; },
      runtimeKeyBeforeRoute);
    changedWhileLoaded = Boolean(existing && beforeService.loaded
      && (meaningfulRuntimeChange(existing, config) || connectorIdentityMigrating));
    tunnelProfilePath = config.mode === "full" && config.tunnel
      ? join(config.tunnel.profileDir, `${config.tunnel.profileName}.yaml`) : undefined;
    tunnelProfileBeforeRoute = tunnelProfilePath ? snapshotFile(tunnelProfilePath) : undefined;
    tunnelProfileAfterRoute = tunnelProfileBeforeRoute;
    if (changedWhileLoaded && !options.restartService) {
      throw new Error(
        "The daemon is currently serving a Codex task and setup would change its runtime. "
        + "Rerun from a normal terminal with --restart-service after the active task finishes.",
      );
    }
    if (changedWhileLoaded && !preliminaryChange && existing) await assertServiceIdle(existing);
    if (!beforeService.loaded) await assertPortAvailable(config.host, config.port);

    if (!launcherOwned) {
      if (!configUnchanged()) throw new Error("Setup config changed during setup; refusing to overwrite the concurrent edit");
      if (!serviceUnchanged()) throw new Error("Background service changed during setup; refusing to overwrite the concurrent edit");
      savedConfigReceipt = saveConfig(config, configBeforeRoute);
      try { installService(config, onServiceDefinitionWritten); } finally {
        observeServiceState();
      }
      assertKnownServiceState();
      if (changedWhileLoaded && options.restartService && existing) {
        try { await restartService(existing); } finally { observeServiceState(); }
        assertKnownServiceState();
      }
      await waitForProxy(config);
    }

    if (config.mode === "browser-only" && existing?.mode === "full") {
      const previousTunnelService = getTunnelServiceStatus();
      tunnelRuntimeTouched = true;
      if (previousTunnelService.installed || previousTunnelService.loaded) {
        if (!tunnelServiceUnchanged()) throw new Error("Tunnel service changed during setup; refusing to remove the concurrent edit");
        try { await uninstallTunnelService(); checkpointTunnelRemoval(); } finally { observeTunnelState(); }
        assertKnownTunnelState();
      }
      stopTunnel(existing);
      previousTunnelStopped = true;
    }
    if (config.mode === "full") {
      const profilePath = join(config.tunnel!.profileDir, `${config.tunnel!.profileName}.yaml`);
      const tunnelService = getTunnelServiceStatus();
      const needsProfile = !existsSync(profilePath);
      if (launcherOwned) {
        if (tunnelService.installed || tunnelService.loaded) {
          if (!tunnelServiceUnchanged()) throw new Error("Tunnel service changed during setup; refusing to remove the concurrent edit");
          try { await uninstallTunnelService(); checkpointTunnelRemoval(); } finally { observeTunnelState(); }
          assertKnownTunnelState();
        }
        if (needsProfile || refreshTunnelWorker || explicitTunnelChange) {
          tunnelRuntimeTouched = true;
          await bootstrapTunnelProfile(config,
            () => { validationTunnelStarted = validationTunnelRunning = true; checkpointOwnedTunnelProfile(); },
            () => { validationTunnelRunning = false; },
            () => { failedConnectMayHaveWrittenProfile = true; }, true);
        }
      } else {
        const needsOwnershipMigration = !tunnelService.installed || !tunnelService.loaded || !tunnelServiceDefinitionMatches(config);
        if (needsOwnershipMigration || needsProfile) {
          tunnelRuntimeTouched = true;
          await assertServiceIdle(config);
          if (tunnelService.loaded) {
            if (!tunnelServiceUnchanged()) throw new Error("Tunnel service changed during setup; refusing to stop the concurrent edit");
            try { await stopTunnelService(); } finally { checkpointTunnelState(); }
            assertKnownTunnelState();
          }
          await bootstrapTunnelProfile(config,
            () => { validationTunnelStarted = validationTunnelRunning = true; checkpointOwnedTunnelProfile(); },
            () => { validationTunnelRunning = false; },
            () => { failedConnectMayHaveWrittenProfile = true; });
          if (tunnelServicePath && tunnelDefinitionAfterRoute) {
            const current = snapshotFile(tunnelServicePath);
            if (!sameSnapshot(current, tunnelDefinitionAfterRoute)) {
              throw new Error("Tunnel service changed during setup; refusing to overwrite the concurrent edit");
            }
          }
          try { installTunnelService(config, onTunnelDefinitionWritten); } finally {
            checkpointTunnelState();
          }
          assertKnownTunnelState();
        } else if (refreshTunnelWorker) {
          tunnelRuntimeTouched = true;
          await assertServiceIdle(config);
          try { await restartTunnelService(); } finally { checkpointTunnelState(); }
          assertKnownTunnelState();
        }
        const status = await waitForTunnelReady(config);
        if (!status.ok) throw new Error(`Tunnel runtime did not become healthy and ready: ${status.detail}`);
        tunnelReady = true;
      }
    }
    if (launcherOwned && (beforeService.installed || beforeService.loaded)) {
      if (!serviceUnchanged()) throw new Error("Background service changed during setup; refusing to remove the concurrent edit");
      try { await uninstallService(existing!); checkpointServiceRemoval(); } finally { observeServiceState(); }
      assertKnownServiceState();
    }
    if (launcherOwned) {
      if (!configUnchanged()) throw new Error("Setup config changed during setup; refusing to overwrite the concurrent edit");
      savedConfigReceipt = saveConfig(config, configBeforeRoute);
    }
    // Keep the previous terminal runtime intact through the ownership handoff. A later launcher
    // setup removes it once the launcher-owned configuration is already the established baseline.
    assertKnownServiceState();
    assertKnownTunnelState();
    installCodexIntegration(config, {
      replaceExistingRoute: options.replaceCodexRoute,
    });
  } catch (error) {
    const rollbackFailures: string[] = [...statusProbeFailures];
    const failedConnectUnresolved = failedConnectMayHaveWrittenProfile && !failedConnectIsStopped(config);
    if (failedConnectUnresolved) rollbackFailures.push("failed connect runtime ownership is unknown; preserving tunnel profile, client and key for manual recovery");
    let configRestored = true;
    if (!savedConfigReceipt) {
      try { configRestored = configUnchanged(); }
      catch (caught) {
        configRestored = false;
        rollbackFailures.push(`config status during rollback: ${caught instanceof Error ? caught.message : String(caught)}`);
      }
    }
    if (savedConfigReceipt) {
      try {
        const current = snapshotFile(getConfigPath());
        if (sameSnapshot(current, configBeforeRoute)) {
          // The exact original file is still current; no compensation is needed.
        } else if (sameSnapshot(current, savedConfigReceipt)) {
          restoreFileSnapshot(configBeforeRoute, { expectedCurrent: savedConfigReceipt });
        } else {
          throw new Error("changed after setup wrote it; preserving the concurrent edit");
        }
      } catch (caught) {
        configRestored = false;
        rollbackFailures.push(`${getConfigPath()}: ${caught instanceof Error ? caught.message : String(caught)}`);
      }
    }
    if (servicePath && serviceBeforeRoute && serviceAfterRoute
      && (serviceStatusUnknown || !sameSnapshot(serviceBeforeRoute, serviceAfterRoute)
        || beforeService.loaded !== serviceLoadedAfterRoute
        || (changedWhileLoaded && options.restartService))) {
      try {
        if (serviceStatusUnknown) throw new Error("loaded state unknown; leaving service for manual recovery");
        if (!configRestored) throw new Error("config rollback was not safe; leaving service state for manual recovery");
        if (!sameSnapshot(snapshotFile(servicePath), serviceAfterRoute)
          || getServiceStatus().loaded !== serviceLoadedAfterRoute) {
          throw new Error("changed after setup wrote it; preserving the concurrent service edit");
        }
        if (getServiceStatus().loaded) {
          await uninstallService(config);
          serviceAfterRoute = { path: servicePath, exists: false };
        }
        restoreFileSnapshot(serviceBeforeRoute, { expectedCurrent: serviceAfterRoute });
        if (beforeService.loaded && existing) bootstrapRestoredDefinition(servicePath);
      } catch (caught) {
        rollbackFailures.push(`${servicePath}: ${caught instanceof Error ? caught.message : String(caught)}`);
      }
    }
    // Setup may have stopped the old tunnel or bootstrapped a new profile before the
    // final route commit. Restore only the definitions and profile still owned by this
    // attempt, then re-establish the previous full-mode runtime.
    let tunnelClientRestored = false;
    let runtimeKeyRestored = false;
    if (tunnelRuntimeTouched || existing?.mode === "full" || config.mode === "full") {
      try {
        if (failedConnectUnresolved) throw new Error("failed connect is not confirmed stopped; preserving dependent files");
        if (tunnelStatusUnknown) throw new Error("loaded state unknown; leaving tunnel and dependent files for manual recovery");
        if (!configRestored) throw new Error("config rollback was not safe; leaving tunnel state for manual recovery");
        if (tunnelServicePath && tunnelDefinitionBeforeRoute && tunnelDefinitionAfterRoute
          && (!sameSnapshot(snapshotFile(tunnelServicePath), tunnelDefinitionAfterRoute)
            || getTunnelServiceStatus().loaded !== tunnelServiceLoadedAfterRoute)) {
          throw new Error("tunnel service changed after setup; preserving the concurrent edit");
        }
        if (tunnelProfilePath && tunnelProfileBeforeRoute && tunnelProfileAfterRoute
          && !sameSnapshot(snapshotFile(tunnelProfilePath), tunnelProfileAfterRoute)) {
          throw new Error(failedConnectMayHaveWrittenProfile
            ? `failed tunnel connect may have written ${tunnelProfilePath}; preserving uncheckpointed profile bytes for manual recovery`
            : "tunnel profile changed after setup; preserving the concurrent edit");
        }
        if (!sameSnapshot(snapshotFile(runtimeKeyPath), runtimeKeyAfterRoute)) {
          throw new Error("tunnel runtime key changed after setup; preserving the concurrent edit");
        }
        if (config.mode === "full" && validationTunnelRunning) {
          stopTunnel(config);
          validationTunnelRunning = false;
        }
        restoreTunnelClientInstallation(tunnelClientBeforeRoute, tunnelClientAfterRoute);
        tunnelClientRestored = true;
        if (tunnelProfilePath && tunnelProfileBeforeRoute && tunnelProfileAfterRoute
          && !sameSnapshot(tunnelProfileBeforeRoute, tunnelProfileAfterRoute)) {
          restoreFileSnapshot(tunnelProfileBeforeRoute, { expectedCurrent: tunnelProfileAfterRoute });
        }
        if (!sameSnapshot(runtimeKeyBeforeRoute, runtimeKeyAfterRoute)) {
          restoreFileSnapshot(runtimeKeyBeforeRoute, { expectedCurrent: runtimeKeyAfterRoute });
        }
        runtimeKeyRestored = true;
        const tunnelServiceChanged = Boolean(tunnelServicePath && tunnelDefinitionBeforeRoute
          && tunnelDefinitionAfterRoute
          && (!sameSnapshot(tunnelDefinitionBeforeRoute, tunnelDefinitionAfterRoute)
            || tunnelServiceBeforeRoute.loaded !== tunnelServiceLoadedAfterRoute));
        if (tunnelServiceChanged && tunnelDefinitionBeforeRoute) {
          if (getTunnelServiceStatus().loaded) {
            await uninstallTunnelService();
            tunnelDefinitionAfterRoute = { path: tunnelServicePath!, exists: false };
          }
          restoreFileSnapshot(tunnelDefinitionBeforeRoute, { expectedCurrent: tunnelDefinitionAfterRoute });
          if (tunnelServiceBeforeRoute.loaded && existing?.mode === "full") {
            bootstrapRestoredDefinition(tunnelServicePath!);
          }
        } else if (tunnelRuntimeTouched && tunnelServiceBeforeRoute.loaded
          && existing?.mode === "full") {
          await restartTunnelService();
        }
        if (existing?.mode === "full" && !tunnelServiceBeforeRoute.loaded
          && (previousTunnelStopped || validationTunnelStarted)) {
          connectTunnel(existing);
        }
      } catch (caught) {
        rollbackFailures.push(`tunnel: ${caught instanceof Error ? caught.message : String(caught)}`);
      }
    }
    // A profile/service recovery failure must not strand independent setup-owned writes.
    // Keep them while the validation runtime may still be using this client or key.
    let tunnelLoadedForFallback = true;
    if (!tunnelStatusUnknown && tunnelRuntimeTouched && configRestored && !validationTunnelRunning) {
      try { tunnelLoadedForFallback = getTunnelServiceStatus().loaded; }
      catch (caught) {
        tunnelStatusUnknown = true;
        rollbackFailures.push(`tunnel service status during rollback: ${caught instanceof Error ? caught.message : String(caught)}`);
      }
    }
    if (configRestored && !failedConnectUnresolved && !validationTunnelRunning && !tunnelStatusUnknown
      && (!tunnelRuntimeTouched || !tunnelLoadedForFallback)) {
      if (!tunnelClientRestored) {
        try {
          restoreTunnelClientInstallation(tunnelClientBeforeRoute, tunnelClientAfterRoute);
        } catch (caught) {
          rollbackFailures.push(`tunnel client: ${caught instanceof Error ? caught.message : String(caught)}`);
        }
      }
      if (!runtimeKeyRestored && !sameSnapshot(runtimeKeyBeforeRoute, runtimeKeyAfterRoute)) {
        try {
          if (!sameSnapshot(snapshotFile(runtimeKeyPath), runtimeKeyAfterRoute)) {
            throw new Error("changed after setup; preserving the concurrent edit");
          }
          restoreFileSnapshot(runtimeKeyBeforeRoute, { expectedCurrent: runtimeKeyAfterRoute });
        } catch (caught) {
          rollbackFailures.push(`tunnel runtime key: ${caught instanceof Error ? caught.message : String(caught)}`);
        }
      }
    }
    const primary = error instanceof Error ? error.message : String(error);
    throw new Error(rollbackFailures.length
      ? `${primary}; setup rollback also failed: ${rollbackFailures.join("; ")}`
      : primary);
  }
  const warnings: string[] = [];
  if (!migratingTerminalRuntime) {
    try { removeLegacyRuntimeArtifacts(config); } catch (error) {
      warnings.push(`Legacy runtime cleanup needs a retry: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    mode: config.mode,
    configPath: getConfigPath(),
    loginCreated,
    serviceLoaded: launcherOwned ? false : serviceLoadedAfterRoute,
    tunnelReady,
    codexRestartRequired: true,
    connectorSetupRequired: config.mode === "full",
    connectorName: config.appName,
    experimentalAsyncToolOperations: config.experimentalAsyncToolOperations,
    connectorVerificationReset,
    ...(warnings.length ? { warnings } : {}),
  };
}

/**
 * Configure the isolated launcher/browser/tunnel inputs used by the repository DEV harness.
 * This deliberately has no Codex integration, Responses listener, or system service; the DEV
 * launcher supervises only the isolated MCP tunnel after this transaction commits.
 */
export async function setupDevProfile(options: SetupOptions): Promise<DevProfileSetupResult> {
  const read = readConfigForSetup();
  const existing = read.config;
  if (existing && existing.purpose !== DEV_CONFIG_PURPOSE) {
    throw new Error("DEV profile home contains a non-DEV configuration; refusing to repurpose it");
  }
  if (!options.browserHostDescriptorPath) {
    throw new Error("DEV profile setup requires the isolated launcher browser descriptor");
  }
  const config = baseConfig(existing, options, DEV_LAUNCHER_PROFILE);
  const connectorVerificationReset = Boolean(existing
    && (existing.appName !== config.appName
      || existing.experimentalAsyncToolOperations !== config.experimentalAsyncToolOperations));
  if (config.browserHost !== "launcher") {
    throw new Error("DEV profile setup requires the desktop launcher browser host");
  }
  config.purpose = DEV_CONFIG_PURPOSE;
  if (config.browserInteractionMode === "automatic") {
    const capabilities = await inspectLauncherCapabilities(
      config,
      existing,
      options.refreshAccountCapabilities === true,
      DEV_LAUNCHER_PROFILE,
    );
    config.solAvailable = capabilities.solAvailable;
    config.extraHighAvailable = capabilities.solAvailable && capabilities.extraHighAvailable;
    config.proAvailable = capabilities.solAvailable && capabilities.proAvailable;
  }

  assertConfigReadCurrent(read);
  const explicitTunnelChange = Boolean(options.tunnelId || options.runtimeKeyFile || options.runtimeKeyValue);
  // Direct DEV setup has no verified launcher owner/idle-drain handshake. Require an
  // explicitly stopped old alias before any key, client, profile, or config mutation.
  // Even a nominally unchanged Full setup can reinstall the tunnel client or
  // regenerate a missing profile during configureTunnel/bootstrapTunnelProfile.
  if (existing?.mode === "full") {
    if (!existing.tunnel || !existsSync(existing.tunnel.binaryPath)) {
      throw new Error("DEV setup cannot verify the existing Full tunnel is stopped; use the launcher owner/idle-drain setup path");
    }
    const observed = runCommand(existing.tunnel.binaryPath,
      ["runtimes", "status", existing.tunnel.alias, "--json"], { timeout: 10_000 });
    if (!runtimeStatusReportsStopped(observed)) {
      throw new Error(
        "DEV setup requires an explicitly stopped existing Full tunnel before changing its profile. "
        + "Finish active turns and use the launcher owner/idle-drain setup path; direct CLI setup cannot stop or recover an unknown owner.",
      );
    }
  }
  const keyPath = managedRuntimeKeyPath(config.browserInteractionMode);
  const keyBefore = snapshotFile(keyPath);
  let keyOwned = keyBefore;
  const clientBefore = snapshotTunnelClientInstallation();
  let clientOwned = clientBefore;
  const configBefore = read.snapshot;
  let configReceipt: FileSnapshot | undefined;
  let profileBefore: FileSnapshot | undefined;
  let profileOwned: FileSnapshot | undefined;
  let failedConnectMayHaveWrittenProfile = false;
  let validationTunnelRunning = false;
  let tunnelReady: boolean | null = null;
  try {
    await configureTunnel(config, existing, options, clientBefore,
      owned => { clientOwned = owned; },
      receipt => { keyOwned = receipt; },
      keyBefore);
    if (config.mode === "full") {
      const profilePath = join(config.tunnel!.profileDir, `${config.tunnel!.profileName}.yaml`);
      profileBefore = snapshotFile(profilePath);
      profileOwned = profileBefore;
      if (!profileBefore.exists || tunnelWorkerRuntimeChanged(existing, config)
        || activeConnectorIdentityMigrationRequired(config, read) || explicitTunnelChange) {
        await bootstrapTunnelProfile(config,
          () => { validationTunnelRunning = true; profileOwned = snapshotFile(profilePath); },
          () => { validationTunnelRunning = false; },
          () => { failedConnectMayHaveWrittenProfile = true; }, true);
      }
      tunnelReady = false;
    }
    if (!sameSnapshot(snapshotFile(getConfigPath()), configBefore)) {
      throw new Error("DEV config changed during setup; preserving the concurrent edit");
    }
    configReceipt = saveConfig(config, configBefore);
  } catch (error) {
    const rollbackFailures: string[] = [];
    const failedConnectUnresolved = failedConnectMayHaveWrittenProfile && !failedConnectIsStopped(config);
    let configRestored = true;
    const attempt = (label: string, action: () => void): void => {
      try { action(); } catch (caught) {
        rollbackFailures.push(`${label}: ${caught instanceof Error ? caught.message : String(caught)}`);
      }
    };
    if (configReceipt) attempt("DEV config", () => {
      const current = snapshotFile(getConfigPath());
      if (sameSnapshot(current, configBefore)) return;
      if (!sameSnapshot(current, configReceipt!)) {
        throw new Error("changed after setup; preserving the concurrent edit");
      }
      restoreFileSnapshot(configBefore, { expectedCurrent: configReceipt });
    });
    if (configReceipt && rollbackFailures.length > 0) configRestored = false;
    if (!configReceipt && !sameSnapshot(snapshotFile(getConfigPath()), configBefore)) {
      configRestored = false;
      rollbackFailures.push("DEV config changed during setup; preserving the concurrent edit");
    }
    if (validationTunnelRunning) attempt("DEV validation tunnel", () => {
      stopTunnel(config);
      validationTunnelRunning = false;
    });
    if (configRestored && !failedConnectUnresolved && !validationTunnelRunning && profileBefore && profileOwned && !sameSnapshot(profileBefore, profileOwned)) {
      attempt("DEV tunnel profile", () => {
        if (!sameSnapshot(snapshotFile(profileOwned!.path), profileOwned!)) {
          throw new Error("changed after setup; preserving the concurrent edit");
        }
        restoreFileSnapshot(profileBefore!, { expectedCurrent: profileOwned });
      });
    }
    if (failedConnectMayHaveWrittenProfile) {
      rollbackFailures.push("DEV tunnel connect may have written an uncheckpointed profile; preserving it for manual recovery");
    }
    if (validationTunnelRunning) {
      rollbackFailures.push("DEV validation tunnel may still be running; preserving its profile for manual recovery");
    }
    if (configRestored && !failedConnectUnresolved && !validationTunnelRunning) {
      attempt("DEV tunnel client", () => restoreTunnelClientInstallation(clientBefore, clientOwned));
      if (!sameSnapshot(keyBefore, keyOwned)) attempt("DEV runtime key", () => {
        if (!sameSnapshot(snapshotFile(keyPath), keyOwned)) {
          throw new Error("changed after setup; preserving the concurrent edit");
        }
        restoreFileSnapshot(keyBefore, { expectedCurrent: keyOwned });
      });
    } else {
      rollbackFailures.push("DEV config or validation tunnel remains active; preserving tunnel client and runtime key for manual recovery");
    }
    const primary = error instanceof Error ? error.message : String(error);
    throw new Error(rollbackFailures.length
      ? `${primary}; DEV setup rollback also failed: ${rollbackFailures.join("; ")}` : primary);
  }
  return {
    mode: config.mode,
    configPath: getConfigPath(),
    tunnelReady,
    connectorSetupRequired: config.mode === "full",
    connectorName: config.appName,
    experimentalAsyncToolOperations: config.experimentalAsyncToolOperations,
    connectorVerificationReset,
  };
}
