import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import type { AppConfig } from "./config";
import { atomicWriteFile, getConfigDir } from "./config";
import { runCommand, runChecked } from "./process";

const LABEL = "io.github.codex-chatgpt-web.tunnel";
const LAUNCHCTL_PRINT_TIMEOUT_MS = 5_000;

export interface TunnelServiceStatus {
  supported: boolean;
  installed: boolean;
  loaded: boolean;
  running: boolean;
  label: string;
  definitionPath?: string;
}

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function plistPath(): string {
  return join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
}

function launchDomain(): string {
  return `gui/${userInfo().uid}`;
}

function serviceTarget(): string {
  return `${launchDomain()}/${LABEL}`;
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
  const args = [tunnel.binaryPath, "run", "--profile-dir", tunnel.profileDir, "--profile", tunnel.profileName];
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
  // runCommand throws on ETIMEDOUT; an ordinary nonzero print still means unloaded.
  const result = runCommand("launchctl", ["print", serviceTarget()],
    { timeout: printTimeoutMs, signal });
  throwIfAborted(signal);
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
  onDefinitionWritten?: (definition: { path: string; data: string }) => void,
  signal?: AbortSignal,
): TunnelServiceStatus {
  throwIfAborted(signal);
  assertMacOs();
  const tunnel = settings(config);
  const profile = join(tunnel.profileDir, `${tunnel.profileName}.yaml`);
  if (!existsSync(tunnel.binaryPath)) throw new Error(`Tunnel client is missing: ${tunnel.binaryPath}`);
  if (!existsSync(profile)) throw new Error(`Tunnel profile is missing: ${profile}`);
  const current = getTunnelServiceStatus(LAUNCHCTL_PRINT_TIMEOUT_MS, signal);
  const next = tunnelServiceDefinition(config);
  if (current.loaded && (!current.installed || readFileSync(plistPath(), "utf8") !== next)) {
    throw new Error("Refusing to replace a loaded tunnel service definition; stop it before installing the update");
  }
  throwIfAborted(signal);
  mkdirSync(dirname(plistPath()), { recursive: true, mode: 0o700 });
  mkdirSync(join(getConfigDir(), "logs"), { recursive: true, mode: 0o700 });
  if (!current.installed || readFileSync(plistPath(), "utf8") !== next) {
    throwIfAborted(signal);
    atomicWriteFile(plistPath(), next);
    onDefinitionWritten?.({ path: plistPath(), data: next });
  }
  if (!current.loaded) {
    throwIfAborted(signal);
    runChecked("launchctl", ["bootstrap", launchDomain(), plistPath()], { signal });
  }
  return getTunnelServiceStatus(LAUNCHCTL_PRINT_TIMEOUT_MS, signal);
}

export function startTunnelService(signal?: AbortSignal): TunnelServiceStatus {
  throwIfAborted(signal);
  assertMacOs();
  if (!existsSync(plistPath())) throw new Error("Tunnel service is not installed; rerun full setup");
  if (!getTunnelServiceStatus(LAUNCHCTL_PRINT_TIMEOUT_MS, signal).loaded) {
    throwIfAborted(signal);
    runChecked("launchctl", ["bootstrap", launchDomain(), plistPath()], { signal });
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
    runChecked("launchctl", ["bootout", serviceTarget()], { signal });
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
