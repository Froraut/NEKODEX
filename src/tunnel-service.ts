import { assertProtectedTunnelProfile, connectTunnel, stopTunnel, waitForTunnelReady } from "./tunnel";
import { retireGlobalLegacyCredential, tunnelCredentialProvider, tunnelCredentialScope, type TunnelCredentialProvider } from "./tunnel-credential";
import { assertServiceIdle } from "./service";
import { runtimeStatusReportsStopped } from "./tunnel-status";
import { fileSnapshotsMatch, snapshotFile, writeFileSnapshot, type FileSnapshot } from "./file-transactions";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AppConfig } from "./config";
import { assertDurableRuntimeCommand, getConfigDir, readConfigForSetup } from "./config";
import {
  assertLaunchdPrintResult,
  launchAgentPlistPath,
  launchDomain,
  launchServiceTarget,
  xmlEscape as xml,
} from "./launch-agent";
import { runCommand, runChecked } from "./process";

const LABEL = "io.github.codex-chatgpt-web.tunnel";
const LAUNCHCTL_PRINT_TIMEOUT_MS = 5_000;
const LAUNCHCTL_MUTATION_TIMEOUT_MS = 20_000;

export interface TunnelServiceStatus {
  supported: boolean;
  installed: boolean;
  loaded: boolean;
  running: boolean;
  label: string;
  definitionPath?: string;
}

function plistPath(): string {
  return launchAgentPlistPath(LABEL);
}

function serviceTarget(): string {
  return launchServiceTarget(LABEL);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted", "AbortError");
  }
}

function settings(config: AppConfig) {
  if (config.mode !== "full" || !config.tunnel) throw new Error("Tunnel service requires full mode");
  return config.tunnel;
}

function assertMacOs(): void {
  if (process.platform !== "darwin") {
    throw new Error("Managed tunnel service installation is currently supported on macOS only");
  }
}

export function tunnelServiceDefinition(config: AppConfig): string {
  const tunnel = settings(config);
  const logDir = join(getConfigDir(), "logs");
  const args = [...config.runtimeCommand, "tunnel", "credential-run"];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.map(arg => `    <string>${xml(arg)}</string>`).join("\n")}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>MCP_STDIO_SEND_INITIALIZED_NOTIFICATION</key>
    <string>true</string>
    <key>CODEX_CHATGPT_WEB_HOME</key>
    <string>${xml(getConfigDir())}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${xml(join(logDir, "tunnel.stdout.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${xml(join(logDir, "tunnel.stderr.log"))}</string>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
`;
}

export function getTunnelServiceStatus(
  printTimeoutMs = LAUNCHCTL_PRINT_TIMEOUT_MS,
  signal?: AbortSignal,
): TunnelServiceStatus {
  throwIfAborted(signal);
  if (process.platform !== "darwin") {
    return { supported: false, installed: false, loaded: false, running: false, label: LABEL };
  }
  const path = plistPath();
  // A stalled probe must not bypass the unload poll's elapsed-time check.
  const result = runCommand("launchctl", ["print", serviceTarget()],
    { timeout: printTimeoutMs, signal });
  throwIfAborted(signal);
  assertLaunchdPrintResult(LABEL, result);
  return {
    supported: true,
    installed: existsSync(path),
    loaded: result.status === 0,
    running: result.status === 0 && /^\s*state = running\s*$/m.test(result.stdout),
    label: LABEL,
    definitionPath: path,
  };
}

export function tunnelServiceDefinitionMatches(config: AppConfig): boolean {
  const path = plistPath();
  return existsSync(path) && readFileSync(path, "utf8") === tunnelServiceDefinition(config);
}

export function installTunnelService(
  config: AppConfig,
  onDefinitionWritten?: (definition: { path: string; data: string; receipt: FileSnapshot }) => void,
  signal?: AbortSignal,
): TunnelServiceStatus {
  throwIfAborted(signal);
  assertMacOs();
  const tunnel = settings(config);
  assertDurableRuntimeCommand(config.runtimeCommand);
  const profile = join(tunnel.profileDir, `${tunnel.profileName}.yaml`);
  if (!existsSync(tunnel.binaryPath)) throw new Error(`Tunnel client is missing: ${tunnel.binaryPath}`);
  if (!existsSync(profile)) throw new Error(`Tunnel profile is missing: ${profile}`);
  const current = getTunnelServiceStatus(LAUNCHCTL_PRINT_TIMEOUT_MS, signal);
  const before = snapshotFile(plistPath());
  const next = tunnelServiceDefinition(config);
  if (current.loaded && (!current.installed || readFileSync(plistPath(), "utf8") !== next)) {
    throw new Error("Refusing to replace a loaded tunnel service definition; stop it before installing the update");
  }
  throwIfAborted(signal);
  mkdirSync(dirname(plistPath()), { recursive: true, mode: 0o700 });
  mkdirSync(join(getConfigDir(), "logs"), { recursive: true, mode: 0o700 });
  if (!current.installed || readFileSync(plistPath(), "utf8") !== next) {
    throwIfAborted(signal);
    const receipt = writeFileSnapshot(before, next, { expectedSnapshot: before });
    onDefinitionWritten?.({ path: plistPath(), data: next, receipt });
  }
  if (!current.loaded) {
    throwIfAborted(signal);
    runChecked("launchctl", ["bootstrap", launchDomain(), plistPath()], {
      signal,
      timeout: LAUNCHCTL_MUTATION_TIMEOUT_MS,
    });
  }
  return getTunnelServiceStatus(LAUNCHCTL_PRINT_TIMEOUT_MS, signal);
}

export function startTunnelService(signal?: AbortSignal): TunnelServiceStatus {
  throwIfAborted(signal);
  assertMacOs();
  if (!existsSync(plistPath())) throw new Error("Tunnel service is not installed; rerun full setup");
  if (!getTunnelServiceStatus(LAUNCHCTL_PRINT_TIMEOUT_MS, signal).loaded) {
    throwIfAborted(signal);
    runChecked("launchctl", ["bootstrap", launchDomain(), plistPath()], {
      signal,
      timeout: LAUNCHCTL_MUTATION_TIMEOUT_MS,
    });
  }
  return getTunnelServiceStatus(LAUNCHCTL_PRINT_TIMEOUT_MS, signal);
}

async function waitForTunnelServiceUnloaded(timeoutMs = 20_000, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`launchd did not unload ${LABEL} after ${timeoutMs}ms`);
    if (!getTunnelServiceStatus(Math.min(LAUNCHCTL_PRINT_TIMEOUT_MS, remaining), signal).loaded) return;
    const pause = Math.min(50, deadline - Date.now());
    if (pause <= 0) throw new Error(`launchd did not unload ${LABEL} after ${timeoutMs}ms`);
    await new Promise<void>((resolveWait, rejectWait) => {
      const onAbort = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        rejectWait(signal?.reason instanceof Error
          ? signal.reason
          : new DOMException("The operation was aborted", "AbortError"));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolveWait();
      }, pause);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
  }
}

export async function stopTunnelService(signal?: AbortSignal): Promise<TunnelServiceStatus> {
  assertMacOs();
  throwIfAborted(signal);
  if (getTunnelServiceStatus(LAUNCHCTL_PRINT_TIMEOUT_MS, signal).loaded) {
    runChecked("launchctl", ["bootout", serviceTarget()], {
      signal,
      timeout: LAUNCHCTL_MUTATION_TIMEOUT_MS,
    });
    await waitForTunnelServiceUnloaded(20_000, signal);
  }
  return getTunnelServiceStatus(LAUNCHCTL_PRINT_TIMEOUT_MS, signal);
}

export async function restartTunnelService(signal?: AbortSignal): Promise<TunnelServiceStatus> {
  await stopTunnelService(signal);
  return startTunnelService(signal);
}

export async function uninstallTunnelService(signal?: AbortSignal): Promise<TunnelServiceStatus> {
  assertMacOs();
  await stopTunnelService(signal);
  throwIfAborted(signal);
  rmSync(plistPath(), { force: true });
  return getTunnelServiceStatus(LAUNCHCTL_PRINT_TIMEOUT_MS, signal);
}


/** Explicit global legacy retirement. Account migration remains with its existing peer owner. */
export async function finalizeTunnelCredentialMigration(options: {
  credentialProvider?: Pick<TunnelCredentialProvider, "resolve">;
  service?: { status(): TunnelServiceStatus; stop(): Promise<unknown>; install(config: AppConfig): unknown };
  idle?: (config: AppConfig) => Promise<unknown>;
} = {}): Promise<{ retired: boolean; ready: boolean }> {
  const read = readConfigForSetup(); const config = read.config;
  if (!config || config.mode !== "full" || !config.tunnel?.credential) throw new Error("No protected Full-mode tunnel credential is saved");
  if (config.accountTunnelMode) throw new Error("Finalize this credential through its selected account runtime owner");
  if (!config.tunnel.legacyCredentialRetirement) return { retired: true, ready: false };
  // A locked or unavailable vault is discovered before disturbing the existing runtime owner.
  (options.credentialProvider ?? tunnelCredentialProvider()).resolve(config.tunnel.credential, tunnelCredentialScope(config));
  const service = options.service ?? { status: getTunnelServiceStatus, stop: stopTunnelService, install: installTunnelService };
  const assertCurrent = () => {
    if (!fileSnapshotsMatch(snapshotFile(read.snapshot.path), read.snapshot)) throw new Error("Tunnel config changed during credential migration; preserving the concurrent generation");
  };
  const assertStopped = () => {
    const observed = runCommand(config.tunnel!.binaryPath, ["runtimes", "status", config.tunnel!.alias, "--json"], { timeout: 10_000 });
    if (!runtimeStatusReportsStopped(observed)) throw new Error("Previous tunnel process is not confirmed stopped; legacy key retirement remains pending");
  };
  await (options.idle ?? assertServiceIdle)(config);
  assertCurrent();
  const before = service.status();
  if (before.loaded) await service.stop();
  stopTunnel(config);
  assertStopped(); assertCurrent();
  connectTunnel(config, undefined, options.credentialProvider);
  assertProtectedTunnelProfile(config);
  const ready = await waitForTunnelReady(config);
  if (!ready.ok) throw new Error("New protected tunnel is not ready; legacy key retirement remains pending");
  if (before.loaded) {
    // The validation SDK process is owned by this command; the service resolves anew on start.
    assertCurrent();
    stopTunnel(config); assertStopped();
    service.install(config);
    const serviceReady = await waitForTunnelReady(config);
    if (!serviceReady.ok) throw new Error("Protected tunnel service is not ready; legacy key retirement remains pending");
  }
  return { retired: retireGlobalLegacyCredential(config, read.snapshot), ready: true };
}
