import { createCredentialProvider } from "../launcher/electron/tunnel-credentials.cjs";
import { existsSync, lstatSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { fileSnapshotsMatch, snapshotFile, atomicWriteFile, type FileSnapshot } from "./file-transactions";
import { type AppConfig, type BrowserInteractionMode, type TunnelCredentialReference, getConfigDir, getConfigPath, isTunnelCredentialReference, readConfigForSetup, saveConfig } from "./config";

export const TUNNEL_RUNTIME_KEY_ENV = "NEKODEX_TUNNEL_RUNTIME_KEY";
export const TUNNEL_RUNTIME_KEY_SELECTOR = `env:${TUNNEL_RUNTIME_KEY_ENV}`;
export interface TunnelCredentialScope {
  accountId: string;
  interactionMode: BrowserInteractionMode;
  tunnelId: string;
}
export interface PreparedTunnelCredential {
  version: 1;
  reference: TunnelCredentialReference;
  scope: TunnelCredentialScope;
  scopeHash: string;
  owner: string;
}
export interface TunnelCredentialProvider {
  prepare(scope: TunnelCredentialScope, key: string): PreparedTunnelCredential;
  resolve(reference: TunnelCredentialReference, expectedScope: TunnelCredentialScope): string;
  discardPrepared(receipt: PreparedTunnelCredential, currentReferences: TunnelCredentialReference[]): boolean;
}
/** Bun inlines CJS __dirname during bundling; the running entry owns the packaged helper. */
export function tunnelCredentialHelperPath(entry = Bun.main): string | undefined {
  if (basename(entry) !== "cli.js") return undefined;
  return join(dirname(entry), "credential-helper", `${process.platform}-${process.arch}`,
    `nekodex-credential-helper${process.platform === "win32" ? ".exe" : ""}`);
}
export function tunnelCredentialProvider(): TunnelCredentialProvider {
  const helperPath = tunnelCredentialHelperPath();
  return createCredentialProvider({ coreHome: getConfigDir(), ...(helperPath ? { helperPath } : {}) }) as TunnelCredentialProvider;
}
export function tunnelCredentialScope(config: AppConfig): TunnelCredentialScope {
  if (!config.tunnel) throw new Error("Tunnel credential scope requires a configured tunnel");
  const binding = config.accountTunnelMode === true ? config.accountTunnels?.find(candidate =>
    candidate.interactionMode === config.browserInteractionMode && candidate.tunnel.tunnelId === config.tunnel!.tunnelId) : undefined;
  if (config.accountTunnelMode === true && !binding) throw new Error("Tunnel credential has no matching account owner");
  return { accountId: binding?.accountId ?? "legacy",
    interactionMode: config.browserInteractionMode, tunnelId: config.tunnel.tunnelId };
}
export function tunnelCredentialReferences(config: unknown): TunnelCredentialReference[] {
  if (!config || typeof config !== "object") return [];
  const value = config as Partial<AppConfig>;
  const refs = [value.tunnel, value.automaticTunnel, value.manualTunnel,
    ...(Array.isArray(value.accountTunnels) ? value.accountTunnels.map(binding => binding.tunnel) : [])]
    .map(tunnel => tunnel?.credential).filter(isTunnelCredentialReference);
  return [...new Map(refs.map(ref => [`${ref.id}:${ref.revision}`, ref])).values()];
}
/** A failed current-config read keeps the prepared entry; never guess that it is unreferenced. */
export function discardUncommittedTunnelCredential(receipt: PreparedTunnelCredential,
  provider: TunnelCredentialProvider = tunnelCredentialProvider()): void {
  let current: unknown;
  try { current = JSON.parse(readFileSync(getConfigPath(), "utf8").replace(/^\uFEFF/, "")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Cannot establish current credential references; preserving prepared credential"); }
  const references = tunnelCredentialReferences(current);
  const retained = references.some(reference => reference.id === receipt.reference.id && reference.revision === receipt.reference.revision);
  provider.discardPrepared(receipt, references);
  if (!retained) {
    const recovery = join(getConfigDir(), "runtime", "credential-recovery", `${receipt.reference.id}.json`);
    if (existsSync(recovery)) {
      const saved = JSON.parse(readFileSync(recovery, "utf8"));
      if (saved.receipt?.owner === receipt.owner && saved.receipt?.scopeHash === receipt.scopeHash
        && saved.receipt?.reference?.revision === receipt.reference.revision) unlinkSync(recovery);
    }
  }
}
export function tunnelLaunchEnvironment(config: AppConfig,
  provider: Pick<TunnelCredentialProvider, "resolve"> = tunnelCredentialProvider()): NodeJS.ProcessEnv {
  if (!config.tunnel) throw new Error("Tunnel credential launch requires a configured tunnel");
  const env: NodeJS.ProcessEnv = { ...process.env, MCP_STDIO_SEND_INITIALIZED_NOTIFICATION: "true" };
  delete env[TUNNEL_RUNTIME_KEY_ENV];
  // The daemon's listener admission key never belongs to the tunnel client or its MCP children.
  delete env.CODEX_CHATGPT_WEB_API_KEY;
  if (config.tunnel.credential) env[TUNNEL_RUNTIME_KEY_ENV] = provider.resolve(config.tunnel.credential, tunnelCredentialScope(config));
  return env;
}
/** SDK launches MCP with inherited environment. Remove only our injected runtime secret. */
export function clearTunnelRuntimeKeyEnvironment(): void { delete process.env[TUNNEL_RUNTIME_KEY_ENV]; }

/** Rotate the saved reference only. Legacy profile migration belongs to full setup. */
export function importSavedTunnelCredential(key: string, provider = tunnelCredentialProvider(), expectedConfig?: FileSnapshot): TunnelCredentialReference {
  const read = readConfigForSetup(); const config = read.config;
  if (expectedConfig && !fileSnapshotsMatch(read.snapshot, expectedConfig)) throw new Error("Tunnel config changed while entering the key; preserving the concurrent edit");
  if (!config || config.mode !== "full" || !config.tunnel) throw new Error("Configure Full mode before importing a runtime key");
  if (config.accountTunnelMode) throw new Error("Import this runtime key through its selected account setup");
  if (!config.tunnel.credential) throw new Error("Run Full setup with the runtime key to migrate the existing profile before key-import");
  let receipt: PreparedTunnelCredential | undefined;
  try {
    receipt = prepareProtectedTunnelCredential(tunnelCredentialScope(config), key, provider);
    const previous = config.tunnel.credential;
    for (const tunnel of [config.tunnel, config.automaticTunnel, config.manualTunnel]) {
      if (tunnel?.credential?.id === previous.id && tunnel.credential.revision === previous.revision) tunnel.credential = receipt.reference;
    }
    saveConfig(config, read.snapshot);
    return receipt.reference;
  } catch (error) {
    try { if (receipt) discardUncommittedTunnelCredential(receipt, provider); } catch { /* retain uncertain owned preparation */ }
    throw error;
  }
}

/** An uncertain vault put owns a durable secret-free receipt before any future retry. */
export function prepareProtectedTunnelCredential(scope: TunnelCredentialScope, key: string,
  provider = tunnelCredentialProvider()): PreparedTunnelCredential {
  const directory = join(getConfigDir(), "runtime", "credential-recovery");
  if (existsSync(directory)) {
    const files = readdirSync(directory).filter(file => /^(?:rollback-)?[a-f0-9-]{36}\.json$/i.test(file));
    if (files.length > 256) throw new Error("Credential recovery history needs review before preparing another credential");
    for (const file of files) {
      let recovery: { receipt?: PreparedTunnelCredential; scope?: TunnelCredentialScope };
      try {
        const bytes = readFileSync(join(directory, file));
        if (bytes.length > 4096) throw new Error("Invalid recovery record");
        recovery = JSON.parse(bytes.toString("utf8"));
      } catch { throw new Error("Credential recovery history is unavailable; preserve it before retrying"); }
      const pendingScope = recovery.receipt?.scope ?? recovery.scope;
      if (pendingScope?.accountId === scope.accountId
        && pendingScope.interactionMode === scope.interactionMode && pendingScope.tunnelId === scope.tunnelId) {
        throw new Error("A prior credential preparation requires recovery before retrying this scope");
      }
    }
  }
  try { return provider.prepare(scope, key); }
  catch (error) {
    const receipt = (error as { preparedReceipt?: PreparedTunnelCredential }).preparedReceipt;
    if (receipt && isTunnelCredentialReference(receipt.reference)) {
      const safe = { version: receipt.version, reference: receipt.reference, scope: receipt.scope,
        scopeHash: receipt.scopeHash, owner: receipt.owner };
      try { atomicWriteFile(join(directory, `${receipt.reference.id}.json`), JSON.stringify({ version: 1, receipt: safe, configPath: getConfigPath() }) + "\n"); }
      catch { /* Preserve the immutable receipt on the thrown operation error. */ }
      (error as { recoveryRequired?: boolean }).recoveryRequired = true;
    }
    throw error;
  }
}

/** Called only by a launch owner after stopped proof, a new healthy SDK launch, and selector verification. */
export function retireGlobalLegacyCredential(config: AppConfig, expectedConfig: FileSnapshot): boolean {
  const tunnel = config.tunnel; const pending = tunnel?.legacyCredentialRetirement;
  if (config.accountTunnelMode) throw new Error("Account credential retirement belongs to its account runtime owner");
  if (!tunnel?.credential || !pending) return true;
  if (!fileSnapshotsMatch(snapshotFile(getConfigPath()), expectedConfig)) throw new Error("Config changed during credential migration; preserving the legacy key");
  if (dirname(resolve(pending.path)) !== join(getConfigDir(), "secrets")) throw new Error("Legacy key is outside the app-owned secrets directory; preserve the external source");
  const all = [config.tunnel, config.automaticTunnel, config.manualTunnel, ...(config.accountTunnels ?? []).map(binding => binding.tunnel)];
  if (all.some(item => item?.runtimeKeyFile && resolve(item.runtimeKeyFile) === resolve(pending.path))) return false;
  if (!existsSync(pending.path)) return true;
  const stat = lstatSync(pending.path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.dev !== pending.dev || stat.ino !== pending.ino
    || createHash("sha256").update(readFileSync(pending.path)).digest("hex") !== pending.sha256) {
    throw new Error("Legacy key changed after migration preparation; preserving the concurrent edit");
  }
  if (!fileSnapshotsMatch(snapshotFile(getConfigPath()), expectedConfig)) throw new Error("Config changed during credential retirement");
  const final = lstatSync(pending.path);
  if (!final.isFile() || final.isSymbolicLink() || final.dev !== stat.dev || final.ino !== stat.ino
    || final.mtimeMs !== stat.mtimeMs || final.size !== stat.size) throw new Error("Legacy key changed before retirement; preserving it");
  unlinkSync(pending.path); return true;
}

export async function readRuntimeKeyInput(input: AsyncIterable<Uint8Array | string>): Promise<string> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const part of input) {
    const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part); size += chunk.length;
    if (size > 64 * 1024) throw new Error("Runtime key input exceeds 64KiB");
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  const key = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim();
  bytes.fill(0);
  if (!key) throw new Error("Runtime key input is empty");
  return key;
}
