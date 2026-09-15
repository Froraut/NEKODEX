import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { unzipSync } from "fflate";
import type { AppConfig, BrowserInteractionMode, TunnelConfig } from "./config";
import { atomicWriteFile, getConfigDir } from "./config";
import { runCommand, runChecked } from "./process";

export const TUNNEL_VERSION = "0.0.12";
const MIGRATABLE_TUNNEL_VERSIONS = new Set(["0.0.10"]);
const RELEASE_BASE = `https://github.com/openai/tunnel-client/releases/download/v${TUNNEL_VERSION}`;
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
const MAX_CHECKSUM_BYTES = 1024 * 1024;
const MAX_ZIP_ENTRIES = 128;
const MAX_BINARY_BYTES = 100 * 1024 * 1024;
export const TUNNEL_READY_TIMEOUT_MS = 120_000;
const TUNNEL_STATUS_POLL_INTERVAL_MS = 1_000;

interface TunnelInstallManifest {
  version: 1;
  tunnelClientVersion: string;
  asset: string;
  archiveSha256: string;
  binarySha256: string;
}

interface TunnelInstallFile {
  bytes?: Uint8Array;
  mode?: number;
}

export interface TunnelClientInstallSnapshot {
  binary: TunnelInstallFile;
  manifest: TunnelInstallFile;
}

function installFileSnapshot(path: string, executable = false): TunnelInstallFile {
  if (!existsSync(path)) return {};
  return {
    bytes: new Uint8Array(readFileSync(path)),
    ...(executable && process.platform !== "win32" ? { mode: statSync(path).mode & 0o777 } : {}),
  };
}

export function snapshotTunnelClientInstallation(): TunnelClientInstallSnapshot {
  return {
    binary: installFileSnapshot(binaryPath(), true),
    manifest: installFileSnapshot(manifestPath()),
  };
}

function sameInstallFile(left: TunnelInstallFile, right: TunnelInstallFile): boolean {
  return Boolean(left.bytes) === Boolean(right.bytes)
    && (!left.bytes || Boolean(right.bytes && Buffer.from(left.bytes).equals(right.bytes)))
    && left.mode === right.mode;
}

function sameInstallation(left: TunnelClientInstallSnapshot, right: TunnelClientInstallSnapshot): boolean {
  return sameInstallFile(left.binary, right.binary)
    && sameInstallFile(left.manifest, right.manifest);
}

/** Restore only bytes and executable mode still matching this install attempt. */
export function restoreTunnelClientInstallation(
  before: TunnelClientInstallSnapshot,
  owned: TunnelClientInstallSnapshot,
): void {
  if (sameInstallFile(before.binary, owned.binary)
    && sameInstallFile(before.manifest, owned.manifest)) return;
  const current = snapshotTunnelClientInstallation();
  if (!sameInstallFile(current.binary, owned.binary)
    || !sameInstallFile(current.manifest, owned.manifest)) {
    throw new Error("Tunnel client changed after setup installed it; preserving the concurrent edit");
  }
  if (!sameInstallFile(before.binary, owned.binary)) {
    if (before.binary.bytes) {
      atomicWriteFile(binaryPath(), before.binary.bytes);
      if (process.platform !== "win32") chmodSync(binaryPath(), before.binary.mode!);
    } else rmSync(binaryPath(), { force: true });
  }
  if (!sameInstallFile(before.manifest, owned.manifest)) {
    if (before.manifest.bytes) atomicWriteFile(manifestPath(), before.manifest.bytes);
    else rmSync(manifestPath(), { force: true });
  }
}

export function tunnelClientInstallAction(installedVersion: string): "reuse" | "upgrade" {
  if (installedVersion === TUNNEL_VERSION) return "reuse";
  if (MIGRATABLE_TUNNEL_VERSIONS.has(installedVersion)) return "upgrade";
  throw new Error(`Installed tunnel-client version ${installedVersion} is not a trusted upgrade source`);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function platformAsset(): string {
  const os = process.platform === "darwin" ? "darwin"
    : process.platform === "linux" ? "linux"
      : process.platform === "win32" ? "windows"
        : undefined;
  const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "amd64" : undefined;
  if (!os || !arch) throw new Error(`openai/tunnel-client has no pinned build for ${process.platform}/${process.arch}`);
  return `tunnel-client-v${TUNNEL_VERSION}-${os}-${arch}.zip`;
}

/** Read at most maxBytes before materializing a complete download. */
export async function readBoundedResponse(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let complete = false;
  try {
    const length = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(length) && length > maxBytes) throw new Error(`Download exceeds ${maxBytes} bytes`);
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > maxBytes - size) throw new Error(`Download exceeds ${maxBytes} bytes`);
      size += value.byteLength;
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    complete = true;
    return bytes;
  } finally {
    if (!complete) {
      // Request cancellation but do not let a stalled source's cancel callback
      // extend the download deadline or hide the original read/size error.
      try { void reader.cancel().catch(() => {}); } catch { /* Preserve the original error. */ }
    }
    reader.releaseLock();
  }
}

async function fetchBytes(url: string, maxBytes = MAX_DOWNLOAD_BYTES, timeoutMs = 120_000): Promise<Uint8Array> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const response = await fetch(url, { redirect: "follow", signal: controller.signal });
    if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
    return await readBoundedResponse(response, maxBytes);
  } catch (error) {
    if (timedOut) throw new Error(`Download timed out after ${timeoutMs}ms: ${url}`);
    if (error instanceof Error && error.message.startsWith("Download exceeds ")) {
      controller.abort();
      throw new Error(`${error.message}: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/** Select one safe executable without expanding unrelated archive members. */
export function extractTunnelBinary(archive: Uint8Array, expectedName: string): Uint8Array {
  let entries = 0;
  let matches = 0;
  const files = unzipSync(archive, {
    filter(file) {
      if (++entries > MAX_ZIP_ENTRIES) throw new Error(`Tunnel archive has more than ${MAX_ZIP_ENTRIES} entries`);
      const name = file.name;
      const parts = name.replace(/\/$/, "").split("/");
      if (!name || name.startsWith("/") || name.includes("\\") || name.includes("\0")
        || parts.some(part => !part || part === "." || part === "..")) {
        throw new Error(`Tunnel archive has an unsafe entry path: ${name}`);
      }
      if (basename(name) !== expectedName) return false;
      if (++matches > 1) throw new Error(`Tunnel archive contains multiple ${expectedName} entries`);
      if (!Number.isSafeInteger(file.originalSize) || file.originalSize < 1
        || file.originalSize > MAX_BINARY_BYTES) {
        throw new Error(`Tunnel binary exceeds ${MAX_BINARY_BYTES} bytes or has an invalid size`);
      }
      return true;
    },
  });
  const entry = Object.entries(files).find(([name]) => basename(name) === expectedName);
  if (!entry || matches !== 1) throw new Error(`Tunnel archive does not contain ${expectedName}`);
  if (entry[1].byteLength > MAX_BINARY_BYTES) throw new Error(`Tunnel binary exceeds ${MAX_BINARY_BYTES} bytes`);
  return entry[1];
}

function parseExpectedChecksum(text: string, asset: string): string {
  const line = text.split(/\r?\n/).find(candidate => candidate.trim().endsWith(asset));
  const checksum = line?.trim().split(/\s+/)[0]?.toLowerCase();
  if (!checksum || !/^[a-f0-9]{64}$/.test(checksum)) throw new Error(`SHA256SUMS.txt has no valid entry for ${asset}`);
  return checksum;
}

function binaryPath(): string {
  return join(getConfigDir(), "bin", process.platform === "win32" ? "tunnel-client.exe" : "tunnel-client");
}

function manifestPath(): string {
  return join(getConfigDir(), "bin", "tunnel-client-manifest.json");
}

export async function installTunnelClient(
  expectedBefore?: TunnelClientInstallSnapshot,
  onInstalled?: (owned: TunnelClientInstallSnapshot) => void,
): Promise<string> {
  const executable = binaryPath();
  const manifestFile = manifestPath();
  const beforeInstall = snapshotTunnelClientInstallation();
  if (expectedBefore && !sameInstallation(beforeInstall, expectedBefore)) {
    throw new Error("Tunnel client changed after setup took its snapshot; preserving the concurrent edit");
  }
  let upgrading = false;
  if (existsSync(executable) && existsSync(manifestFile)) {
    const manifestText = readFileSync(manifestFile, "utf8");
    const manifest = JSON.parse(manifestText) as Partial<TunnelInstallManifest>;
    const installedBinary = new Uint8Array(readFileSync(executable));
    const actual = sha256(installedBinary);
    if (manifest.version !== 1 || typeof manifest.tunnelClientVersion !== "string"
      || manifest.binarySha256 !== actual) {
      throw new Error(`Existing tunnel-client failed integrity validation: ${executable}`);
    }
    if (process.platform !== "win32" && (statSync(executable).mode & 0o111) === 0) {
      throw new Error(`Existing tunnel-client is not executable: ${executable}`);
    }
    const action = tunnelClientInstallAction(manifest.tunnelClientVersion);
    const installedVersion = runChecked(executable, ["--version"], { timeout: 10_000 });
    if (!installedVersion.stdout.includes(manifest.tunnelClientVersion)
      && !installedVersion.stderr.includes(manifest.tunnelClientVersion)) {
      throw new Error(`Existing tunnel-client did not report version ${manifest.tunnelClientVersion}`);
    }
    if (action === "reuse") {
      onInstalled?.(beforeInstall);
      return executable;
    }
    upgrading = true;
  }
  if (!upgrading && (existsSync(executable) || existsSync(manifestFile))) {
    throw new Error("Existing tunnel-client installation is incomplete; preserving its files for manual recovery");
  }

  const asset = platformAsset();
  const [archive, sums] = await Promise.all([
    fetchBytes(`${RELEASE_BASE}/${asset}`),
    fetchBytes(`${RELEASE_BASE}/SHA256SUMS.txt`, MAX_CHECKSUM_BYTES),
  ]);
  const expected = parseExpectedChecksum(new TextDecoder().decode(sums), asset);
  const archiveHash = sha256(archive);
  if (archiveHash !== expected) throw new Error(`Checksum mismatch for ${asset}`);
  const expectedName = process.platform === "win32" ? "tunnel-client.exe" : "tunnel-client";
  const binary = extractTunnelBinary(archive, expectedName);
  mkdirSync(dirname(executable), { recursive: true, mode: 0o700 });
  const stagedExecutable = `${executable}.install-${process.pid}-${randomUUID()}${process.platform === "win32" ? ".exe" : ""}`;
  atomicWriteFile(stagedExecutable, binary);
  let version: ReturnType<typeof runChecked>;
  try {
    if (process.platform !== "win32") chmodSync(stagedExecutable, 0o700);
    version = runChecked(stagedExecutable, ["--version"], { timeout: 10_000 });
    if (!version.stdout.includes(TUNNEL_VERSION) && !version.stderr.includes(TUNNEL_VERSION)) {
      throw new Error(`Installed tunnel-client did not report version ${TUNNEL_VERSION}`);
    }
  } finally {
    rmSync(stagedExecutable, { force: true });
  }
  const manifest: TunnelInstallManifest = {
    version: 1,
    tunnelClientVersion: TUNNEL_VERSION,
    asset,
    archiveSha256: archiveHash,
    binarySha256: sha256(binary),
  };
  if (!sameInstallation(snapshotTunnelClientInstallation(), beforeInstall)) {
    throw new Error("Tunnel client changed while the upgrade was prepared; preserving the concurrent edit");
  }
  const manifestBytes = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
  let binaryWritten = false;
  let manifestWritten = false;
  let ownedBinaryMode = 0o600;
  try {
    atomicWriteFile(executable, binary);
    binaryWritten = true;
    if (process.platform !== "win32") {
      chmodSync(executable, 0o700);
      ownedBinaryMode = 0o700;
    }
    atomicWriteFile(manifestFile, manifestBytes);
    manifestWritten = true;
  } catch (error) {
    try {
      restoreTunnelClientInstallation(beforeInstall, {
        binary: binaryWritten
          ? { bytes: binary, ...(process.platform !== "win32" ? { mode: ownedBinaryMode } : {}) }
          : beforeInstall.binary,
        manifest: manifestWritten ? { bytes: manifestBytes } : beforeInstall.manifest,
      });
    } catch (rollbackError) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}; tunnel-client rollback also failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
    }
    throw error;
  }
  onInstalled?.({
    binary: { bytes: binary, ...(process.platform !== "win32" ? { mode: 0o700 } : {}) },
    manifest: { bytes: manifestBytes },
  });
  return executable;
}

export function installRuntimeKey(
  sourcePath: string,
  interactionMode: BrowserInteractionMode = "automatic",
  onWritten?: (bytes: Uint8Array) => void,
  expectedBefore?: Uint8Array | null,
): string {
  if (!existsSync(sourcePath)) throw new Error(`Tunnel runtime key file does not exist: ${sourcePath}`);
  const key = readFileSync(sourcePath);
  if (key.byteLength === 0 || key.byteLength > 64 * 1024) throw new Error("Tunnel runtime key file is empty or unexpectedly large");
  return installRuntimeKeyBytes(key, interactionMode, onWritten, expectedBefore);
}

export function managedRuntimeKeyPath(interactionMode: BrowserInteractionMode = "automatic"): string {
  const fileName = interactionMode === "manual"
    ? "tunnel-runtime-zero-risk.key"
    : "tunnel-runtime-automatic.key";
  return join(getConfigDir(), "secrets", fileName);
}

export function installRuntimeKeyBytes(
  key: Uint8Array | string,
  interactionMode: BrowserInteractionMode = "automatic",
  onWritten?: (bytes: Uint8Array) => void,
  expectedBefore?: Uint8Array | null,
): string {
  const bytes = typeof key === "string" ? new TextEncoder().encode(key.trim()) : key;
  if (bytes.byteLength === 0 || bytes.byteLength > 64 * 1024) throw new Error("Tunnel runtime key is empty or unexpectedly large");
  const destination = managedRuntimeKeyPath(interactionMode);
  if (expectedBefore !== undefined) {
    const current = existsSync(destination) ? readFileSync(destination) : null;
    if ((current === null) !== (expectedBefore === null)
      || (current !== null && expectedBefore !== null && !current.equals(expectedBefore))) {
      throw new Error("Tunnel runtime key changed after setup took its snapshot; preserving the concurrent edit");
    }
  }
  atomicWriteFile(destination, bytes);
  onWritten?.(bytes);
  return destination;
}

export function createTunnelConfig(options: {
  binaryPath: string;
  tunnelId: string;
  runtimeKeyFile: string;
  profileName?: string;
  alias?: string;
}): TunnelConfig {
  if (!/^tunnel_[a-f0-9]{32}$/.test(options.tunnelId)) throw new Error("--tunnel-id must be tunnel_ followed by 32 lowercase hexadecimal characters");
  const profileName = options.profileName ?? "codex-chatgpt-web";
  const alias = options.alias ?? "codex-chatgpt-web";
  if (!/^[A-Za-z0-9._-]+$/.test(profileName) || !/^[A-Za-z0-9._-]+$/.test(alias)) {
    throw new Error("Tunnel profile and alias may contain only letters, digits, dot, underscore, and dash");
  }
  return {
    binaryPath: options.binaryPath,
    tunnelId: options.tunnelId,
    runtimeKeyFile: options.runtimeKeyFile,
    profileDir: join(getConfigDir(), "tunnel", "profiles"),
    profileName,
    alias,
  };
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function tunnelCommandQuoted(value: string): string {
  if (/[\r\n]/.test(value)) throw new Error("Tunnel MCP command values must not contain newlines");
  // tunnel-client parses mcp.command with backslash escapes on every platform.
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function mcpCommand(config: AppConfig, platform = process.platform): string {
  const contract = config.browserInteractionMode === "manual" ? "safe" : "native";
  const command = [
    ...config.runtimeCommand,
    "mcp",
    "--contract",
    contract,
    "--broker-socket",
    config.brokerSocketPath,
  ];
  if (platform === "win32") {
    return command.map(tunnelCommandQuoted).join(" ");
  }
  return command.map(shellQuote).join(" ");
}

function tunnel(config: AppConfig): TunnelConfig {
  if (config.mode !== "full" || !config.tunnel) throw new Error("Tunnel commands require full mode");
  return config.tunnel;
}

export function connectTunnel(config: AppConfig): void {
  const settings = tunnel(config);
  mkdirSync(settings.profileDir, { recursive: true, mode: 0o700 });
  const result = runCommand(settings.binaryPath, [
    "runtimes", "connect",
    "--alias", settings.alias,
    "--profile", settings.profileName,
    "--profile-dir", settings.profileDir,
    "--tunnel-client-bin", settings.binaryPath,
    "--tunnel-id", settings.tunnelId,
    "--runtime-api-key", `file:${settings.runtimeKeyFile}`,
    "--mcp-command", mcpCommand(config),
    "--json",
  ], { timeout: TUNNEL_READY_TIMEOUT_MS });
  const structuredOutput = result.stdout.trim();
  const launchError = structuredOutput
    ? tunnelConnectLaunchError(structuredOutput)
    : undefined;
  if (result.status !== 0) {
    const detail = launchError && launchError !== "tunnel-client returned non-JSON connect output"
      ? launchError
      : safeTunnelDetail(tunnelCommandOutput(result) || `exit ${result.status}`);
    throw new Error(`Tunnel managed startup failed: ${detail}`);
  }
  if (launchError) throw new Error(`Tunnel runtime exited during launch: ${launchError}`);
}

export function stopTunnel(config: AppConfig): void {
  const settings = tunnel(config);
  const result = runCommand(
    settings.binaryPath,
    ["runtimes", "stop", settings.alias, "--json"],
    { timeout: 15_000 },
  );
  if (result.status !== 0
    && !/not found|not running|unknown alias|\balias\b[^\r\n]{0,160}\bis not known\b/i.test(
      `${result.stdout}\n${result.stderr}`,
    )) {
    throw new Error(`Failed to stop tunnel runtime: ${result.stderr.trim() || result.stdout.trim()}`);
  }
}

export interface TunnelRuntimeStatus {
  ok: boolean;
  processRunning: boolean;
  healthy: boolean;
  ready: boolean;
  state?: string;
  detail: string;
}

export function tunnelCommandOutput(result: {
  status: number;
  stdout: string;
  stderr: string;
}): string {
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  return result.status === 0
    ? (stdout || stderr)
    : [stderr, stdout].filter(Boolean).join("\n");
}

function safeTunnelDetail(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text
    .replace(/tunnel_[a-f0-9]{32}/g, "[tunnel-id]")
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "[redacted-key]")
    .slice(0, 2_000);
}

function nestedRecord(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const nested = (value as Record<string, unknown>)[key];
  return nested && typeof nested === "object" && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : undefined;
}

function runtimeLogTail(parsed: Record<string, unknown>): string | undefined {
  const launchTail = nestedRecord(parsed, "launch_diagnostics")?.log_tail;
  if (typeof launchTail === "string" && launchTail.trim()) return launchTail.trim();
  const statusTail = nestedRecord(nestedRecord(parsed, "local"), "log")?.tail;
  return typeof statusTail === "string" && statusTail.trim() ? statusTail.trim() : undefined;
}

export function tunnelConnectLaunchError(output: string): string | undefined {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(output) as Record<string, unknown>;
  } catch {
    return "tunnel-client returned non-JSON connect output";
  }
  const running = parsed.running === true;
  const healthy = parsed.healthy === true;
  const ready = parsed.ready === true;
  if (running && healthy) return undefined;
  const diagnostics = nestedRecord(parsed, "launch_diagnostics");
  const exitCode = typeof parsed.exit_code === "number" ? parsed.exit_code
    : typeof diagnostics?.exit_code === "number" ? diagnostics.exit_code
      : undefined;
  const remoteError = typeof parsed.remote_error === "string" && parsed.remote_error.trim()
    ? parsed.remote_error.trim()
    : undefined;
  const logTail = runtimeLogTail(parsed);
  return safeTunnelDetail([
    `running=${running}`,
    `healthy=${healthy}`,
    `ready=${ready}`,
    ...(exitCode !== undefined ? [`exit_code=${exitCode}`] : []),
    ...(remoteError ? [`remote_error=${remoteError}`] : []),
    ...(logTail ? [`runtime_log=${logTail}`] : []),
    ...(!remoteError && !logTail ? ["runtime did not complete a healthy launch"] : []),
  ].join("; "));
}

export function parseTunnelStatus(output: string, exitStatus = 0): TunnelRuntimeStatus {
  if (exitStatus !== 0) {
    return { ok: false, processRunning: false, healthy: false, ready: false, detail: safeTunnelDetail(output) };
  }
  try {
    const parsed = JSON.parse(output) as Record<string, unknown>;
    const processRunning = parsed.process_running === true;
    const healthy = parsed.healthy === true;
    const ready = parsed.ready === true;
    const state = typeof parsed.runtime_state === "string" ? parsed.runtime_state
      : typeof parsed.status === "string" ? parsed.status
        : undefined;
    const issues = parsed.local && typeof parsed.local === "object" && Array.isArray((parsed.local as { issues?: unknown }).issues)
      ? ((parsed.local as { issues: unknown[] }).issues).filter(issue => typeof issue === "string").slice(0, 3)
      : [];
    const explicitError = typeof parsed.error === "string" && parsed.error ? parsed.error : undefined;
    const logTail = runtimeLogTail(parsed);
    const ok = processRunning && healthy && ready;
    const detail = ok
      ? "process_running=true healthy=true ready=true"
      : safeTunnelDetail([
        `process_running=${processRunning}`,
        `healthy=${healthy}`,
        `ready=${ready}`,
        ...(state ? [`state=${state}`] : []),
        ...(explicitError ? [explicitError] : []),
        ...issues,
        ...(logTail ? [`runtime_log=${logTail}`] : []),
      ].join("; "));
    return { ok, processRunning, healthy, ready, ...(state ? { state } : {}), detail };
  } catch {
    return { ok: false, processRunning: false, healthy: false, ready: false, detail: `tunnel-client returned non-JSON status: ${safeTunnelDetail(output)}` };
  }
}

export function tunnelStatus(config: AppConfig): TunnelRuntimeStatus {
  const settings = tunnel(config);
  if (!existsSync(settings.binaryPath)) {
    return { ok: false, processRunning: false, healthy: false, ready: false, detail: `Missing ${settings.binaryPath}` };
  }
  const result = runCommand(
    settings.binaryPath,
    ["runtimes", "status", settings.alias, "--json"],
    { timeout: 10_000 },
  );
  return parseTunnelStatus(tunnelCommandOutput(result), result.status);
}

export async function waitForTunnelReady(
  config: AppConfig,
  timeoutMs = TUNNEL_READY_TIMEOUT_MS,
): Promise<TunnelRuntimeStatus> {
  const deadline = Date.now() + timeoutMs;
  let status = tunnelStatus(config);
  while (!status.ok && Date.now() < deadline) {
    await new Promise(resolveWait => setTimeout(resolveWait, TUNNEL_STATUS_POLL_INTERVAL_MS));
    status = tunnelStatus(config);
  }
  return status;
}
