import { createHash, randomUUID } from "node:crypto";
import { chmodSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { unzipSync } from "fflate";
import type { AppConfig, BrowserInteractionMode, TunnelConfig } from "./config";
import {
  CHATGPT_ASYNC_CONNECTOR_NAME,
  PREVIOUS_ASYNC_CONNECTOR_NAME,
  PREVIOUS_ASYNC_DEV_CONNECTOR_NAME,
  DEV_CHATGPT_ASYNC_CONNECTOR_NAME,
  atomicWriteFile,
  getConfigDir,
} from "./config";
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
const WINDOWS_REMOVE_RETRY_DELAYS_MS = [100, 200, 500, 1_000, 2_000] as const;

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
  const entry = lstatSync(path, { throwIfNoEntry: false });
  if (!entry) return {};
  if (entry.isSymbolicLink()) {
    throw new Error(`Refusing to manage symbolic link at ${path}; preserving the existing installation`);
  }
  if (!entry.isFile()) {
    throw new Error(`Refusing to manage non-file installation entry at ${path}; preserving the existing installation`);
  }
  return {
    bytes: new Uint8Array(readFileSync(path)),
    ...(executable && process.platform !== "win32" ? { mode: entry.mode & 0o777 } : {}),
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

function acquireTunnelInstallLock(lockPath: string): () => Error | undefined {
  const token = randomUUID();
  let fd: number | undefined;
  try {
    fd = openSync(lockPath, "wx", 0o600);
    writeFileSync(fd, `${token}\n`);
    fsyncSync(fd);
    closeSync(fd);
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("Tunnel client installation is already in progress; preserving the existing installation");
    }
    throw error;
  }
  return () => {
    try {
      if (readFileSync(lockPath, "utf8") !== `${token}\n`) {
        return new Error("Tunnel client installation lock ownership changed; preserving the lock");
      }
      unlinkSync(lockPath);
      return undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      return error instanceof Error ? error : new Error(String(error));
    }
  };
}

export async function removeTunnelInstallFile(
  path: string,
  options: {
    platform?: NodeJS.Platform;
    remove?: (path: string) => void;
    wait?: (delayMs: number) => Promise<void>;
    retryDelaysMs?: readonly number[];
  } = {},
): Promise<void> {
  const platform = options.platform ?? process.platform;
  const remove = options.remove ?? (target => rmSync(target, { force: true }));
  const wait = options.wait ?? (delayMs => new Promise(resolve => setTimeout(resolve, delayMs)));
  const retryDelays = options.retryDelaysMs ?? WINDOWS_REMOVE_RETRY_DELAYS_MS;
  for (let attempt = 0; ; attempt += 1) {
    try {
      remove(path);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const retryable = platform === "win32" && (code === "EBUSY" || code === "EPERM");
      if (!retryable || attempt >= retryDelays.length) throw error;
      await wait(retryDelays[attempt]!);
    }
  }
}

function tunnelInstallCleanupError(primary: unknown, cleanup: unknown): Error {
  const primaryMessage = primary instanceof Error ? primary.message : String(primary);
  const cleanupMessage = cleanup instanceof Error ? cleanup.message : String(cleanup);
  return new AggregateError(
    [primary, cleanup],
    `${primaryMessage}; temporary tunnel-client cleanup also failed: ${cleanupMessage}`,
    { cause: primary },
  );
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
  let verificationError: unknown;
  try {
    if (process.platform !== "win32") chmodSync(stagedExecutable, 0o700);
    const version = runChecked(stagedExecutable, ["--version"], { timeout: 10_000 });
    if (!version.stdout.includes(TUNNEL_VERSION) && !version.stderr.includes(TUNNEL_VERSION)) {
      throw new Error(`Installed tunnel-client did not report version ${TUNNEL_VERSION}`);
    }
  } catch (error) {
    verificationError = error;
  }
  try {
    await removeTunnelInstallFile(stagedExecutable);
  } catch (cleanupError) {
    if (verificationError) throw tunnelInstallCleanupError(verificationError, cleanupError);
    throw cleanupError;
  }
  if (verificationError) throw verificationError;
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
  const releaseInstallLock = acquireTunnelInstallLock(`${manifestFile}.lock`);
  let binaryWritten = false;
  let manifestWritten = false;
  let ownedBinaryMode = 0o600;
  let failure: Error | undefined;
  try {
    if (!sameInstallation(snapshotTunnelClientInstallation(), beforeInstall)) {
      throw new Error("Tunnel client changed while the upgrade was prepared; preserving the concurrent edit");
    }
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
      failure = new Error(`${error instanceof Error ? error.message : String(error)}; tunnel-client rollback also failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
    }
    if (!failure) failure = error instanceof Error ? error : new Error(String(error));
  } finally {
    const releaseError = releaseInstallLock();
    if (releaseError) {
      if (failure) {
        failure = new Error(`${failure.message}; tunnel-client install lock release failed: ${releaseError.message}`);
      } else {
        console.warn(`Tunnel client installed, but its coordination lock could not be released: ${releaseError.message}`);
      }
    }
  }
  if (failure) throw failure;
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
  const asyncConnector = config.experimentalAsyncToolOperations === true
    && config.browserInteractionMode === "automatic"
    && config.mode === "full"
    && (config.appName === CHATGPT_ASYNC_CONNECTOR_NAME
      || config.appName === DEV_CHATGPT_ASYNC_CONNECTOR_NAME
      || config.appName === PREVIOUS_ASYNC_CONNECTOR_NAME
      || config.appName === PREVIOUS_ASYNC_DEV_CONNECTOR_NAME);
  const command = [
    ...config.runtimeCommand,
    "mcp",
    ...(asyncConnector ? ["--async-tool-operations",
      ...([CHATGPT_ASYNC_CONNECTOR_NAME, DEV_CHATGPT_ASYNC_CONNECTOR_NAME].includes(config.appName) ? ["--native6"] : [])] : []),
    config.allowWebSubagents === false ? "--no-web-subagents" : "--allow-web-subagents",
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

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted", "AbortError");
  }
}

export function connectTunnel(config: AppConfig, signal?: AbortSignal): void {
  throwIfAborted(signal);
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
  ], { timeout: TUNNEL_READY_TIMEOUT_MS, signal });
  throwIfAborted(signal);
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

export function stopTunnel(config: AppConfig, signal?: AbortSignal): void {
  throwIfAborted(signal);
  const settings = tunnel(config);
  const result = runCommand(
    settings.binaryPath,
    ["runtimes", "stop", settings.alias, "--json"],
    { timeout: 15_000, signal },
  );
  throwIfAborted(signal);
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

export function parseTunnelStatus(output: string, alias: string, exitStatus = 0): TunnelRuntimeStatus {
  if (exitStatus !== 0) {
    return { ok: false, processRunning: false, healthy: false, ready: false, detail: safeTunnelDetail(output) };
  }
  try {
    const parsed = JSON.parse(output) as Record<string, unknown>;
    if (!Array.isArray(parsed.entries)) throw new Error("local inventory has no entries array");
    const matches = parsed.entries.filter(entry => entry && typeof entry === "object" && entry.alias === alias);
    if (matches.length > 1) throw new Error("local inventory contains duplicate aliases");
    const state = matches.length === 0 ? "stopped" : matches[0].runtime_state;
    if (!["stopped", "starting", "healthy", "ready"].includes(state)) {
      throw new Error("local inventory has an unsupported runtime state");
    }
    // tunnel-client 0.0.12 derives inventory state from the local process and health probes.
    const processRunning = state !== "stopped";
    const healthy = state === "healthy" || state === "ready";
    const ready = state === "ready";
    const ok = processRunning && healthy && ready;
    const detail = ok
      ? "process_running=true healthy=true ready=true"
      : safeTunnelDetail([
        `process_running=${processRunning}`,
        `healthy=${healthy}`,
        `ready=${ready}`,
        `state=${state}`,
        ...(matches.length === 0 ? ["local_inventory=absent"] : []),
      ].join("; "));
    return { ok, processRunning, healthy, ready, state, detail };
  } catch (error) {
    return { ok: false, processRunning: false, healthy: false, ready: false, detail: `tunnel-client returned invalid local inventory: ${safeTunnelDetail(error instanceof Error ? error.message : String(error))}` };
  }
}

export function tunnelStatus(config: AppConfig, signal?: AbortSignal): TunnelRuntimeStatus {
  throwIfAborted(signal);
  const settings = tunnel(config);
  if (!existsSync(settings.binaryPath)) {
    return { ok: false, processRunning: false, healthy: false, ready: false, detail: `Missing ${settings.binaryPath}` };
  }
  const result = runCommand(
    settings.binaryPath,
    ["runtimes", "cleanup", "--json"],
    { timeout: 10_000, signal },
  );
  throwIfAborted(signal);
  return parseTunnelStatus(tunnelCommandOutput(result), settings.alias, result.status);
}

export async function waitForTunnelReady(
  config: AppConfig,
  timeoutMs = TUNNEL_READY_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<TunnelRuntimeStatus> {
  throwIfAborted(signal);
  const deadline = Date.now() + timeoutMs;
  let status = tunnelStatus(config, signal);
  while (!status.ok && Date.now() < deadline) {
    const pause = Math.min(TUNNEL_STATUS_POLL_INTERVAL_MS, Math.max(0, deadline - Date.now()));
    await new Promise<void>((resolveWait, rejectWait) => {
      const onAbort = () => {
        clearTimeout(timer);
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
    status = tunnelStatus(config, signal);
  }
  return status;
}
