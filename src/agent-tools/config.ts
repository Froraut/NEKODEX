import { createHash } from "node:crypto";
import { chmodSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { installedTreeDigest } from "./package-tree";
import type { TrustedSandboxConfig } from "./sandbox";
import { sandboxProviderAvailable, validateTrustedSandboxConfig } from "./sandbox";

/** A trusted setup surface supplies recipes; prompts and server output cannot configure these. */
export interface ServerRecipe {
  id: string;
  enabled: boolean;
  transport: "stdio";
  source: { kind: "user-installed"; label: string; version: string };
  command: string;
  commandSha256: string;
  args: string[];
  /** Pin script/package entry files as well as the executable. No npx/bunx or installers. */
  pinnedFiles: { path: string; sha256: string }[];
  cwd: string;
  envSecretRefs: Record<string, string>;
  /** Reviewed non-secret official server settings; never a general inherited environment. */
  env?: { MEMORY_FILE_PATH?: string; DISABLE_THOUGHT_LOGGING?: "true" };
  managedInstallation?: { actionId: string; package: string; version: string; integrity: string; graphSha256: string; treeRoot: string; treeSha256: string; treeFiles: number };
  trustedSandbox?: TrustedSandboxConfig;
}
export interface ToolsConfig { version: 1; enabled: boolean; servers: ServerRecipe[] }
export const defaultToolsConfig = (): ToolsConfig => ({ version: 1, enabled: false, servers: [] });
export const sha256 = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");
function onlyKeys(value: object, allowed: string[]): boolean { return Object.keys(value).every(key => allowed.includes(key)); }
export function validateToolsConfig(value: unknown): ToolsConfig {
  const config = value as ToolsConfig;
  if (!config || !onlyKeys(config, ["version", "enabled", "servers"]) || config.version !== 1 || typeof config.enabled !== "boolean" || !Array.isArray(config.servers) || config.servers.length > 32) throw new Error("Invalid standalone tools configuration");
  const ids = new Set<string>();
  for (const server of config.servers) {
    if (!server || !onlyKeys(server, ["id", "enabled", "transport", "source", "command", "commandSha256", "args", "pinnedFiles", "cwd", "envSecretRefs", "env", "managedInstallation", "trustedSandbox"])) throw new Error("Unsupported server configuration field");
    if (!server || !/^[a-zA-Z0-9_-]{1,80}$/.test(server.id) || ids.has(server.id) || typeof server.enabled !== "boolean" || server.transport !== "stdio" || server.source?.kind !== "user-installed" || typeof server.source.label !== "string" || !server.source.label || typeof server.source.version !== "string" || !server.source.version || !isAbsolute(server.command) || !isAbsolute(server.cwd) || !/^[a-f0-9]{64}$/.test(server.commandSha256) || !Array.isArray(server.args) || server.args.length > 128 || server.args.some(arg => typeof arg !== "string" || arg.length > 8192) || !Array.isArray(server.pinnedFiles) || server.pinnedFiles.length > 32 || !server.envSecretRefs || typeof server.envSecretRefs !== "object" || Array.isArray(server.envSecretRefs)) throw new Error("Invalid pinned server recipe");
    ids.add(server.id);
    for (const file of server.pinnedFiles) if (!file || !isAbsolute(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error("Invalid pinned server file");
    for (const [name, ref] of Object.entries(server.envSecretRefs)) if (!/^[A-Z_][A-Z0-9_]{0,100}$/.test(name) || typeof ref !== "string" || ref.length > 240 || !/^[a-z][a-z0-9+.-]{1,31}:[a-zA-Z0-9._/-]+$/.test(ref) || ["NODE_OPTIONS", "BUN_OPTIONS", "LD_PRELOAD", "DYLD_INSERT_LIBRARIES", "PATH", "HOME", "SHELL"].includes(name)) throw new Error("Invalid secret reference");
    if (server.env !== undefined) {
      if (!server.env || typeof server.env !== "object" || Array.isArray(server.env) || !onlyKeys(server.env, ["MEMORY_FILE_PATH", "DISABLE_THOUGHT_LOGGING"])) throw new Error("Unsupported reviewed server environment");
      if (server.env.DISABLE_THOUGHT_LOGGING !== undefined && server.env.DISABLE_THOUGHT_LOGGING !== "true") throw new Error("Thought logging must remain disabled");
      if (server.env.MEMORY_FILE_PATH !== undefined && (typeof server.env.MEMORY_FILE_PATH !== "string" || !isAbsolute(server.env.MEMORY_FILE_PATH) || server.env.MEMORY_FILE_PATH.length > 8192 || /[\u0000-\u001f]/.test(server.env.MEMORY_FILE_PATH))) throw new Error("Memory storage requires an absolute reviewed path");
      if (Object.keys(server.env).some(name => Object.hasOwn(server.envSecretRefs, name))) throw new Error("Reviewed settings cannot overlap credential references");
    }
    const managed = server.managedInstallation;
    if (managed && (typeof managed.actionId !== "string" || !managed.actionId || typeof managed.package !== "string" || typeof managed.version !== "string" || !/^sha512-[a-zA-Z0-9+/]+=*$/.test(managed.integrity) || !/^[a-f0-9]{64}$/.test(managed.graphSha256) || !isAbsolute(managed.treeRoot) || !/^[a-f0-9]{64}$/.test(managed.treeSha256) || !Number.isInteger(managed.treeFiles) || managed.treeFiles < 1)) throw new Error("Invalid managed installation provenance");
    const sandbox = server.trustedSandbox;
    if (sandbox) {
      if (sandbox.version !== 1 || sandbox.provider !== "macos-seatbelt" || !onlyKeys(sandbox, ["version", "provider", "codeRoots", "readRoots", "writeRoots"])) throw new Error("Invalid reviewed sandbox metadata");
      for (const roots of [sandbox.codeRoots, sandbox.readRoots, sandbox.writeRoots]) if (!Array.isArray(roots) || roots.length > 32 || roots.some(root => !root || !onlyKeys(root, ["path", "dev", "ino"]) || !isAbsolute(root.path) || !/^\d+$/.test(root.dev) || !/^\d+$/.test(root.ino))) throw new Error("Invalid reviewed sandbox root identity");
      // Live identities are checked at admission, not parsing; stale grants remain visible/revocable.
    }
  }
  return structuredClone(config);
}
export function verifyRecipeFiles(recipe: ServerRecipe): void {
  const memoryPath = recipe.env?.MEMORY_FILE_PATH;
  if (memoryPath) {
    const parent = dirname(memoryPath);
    if (realpathSync(parent) !== parent || !lstatSync(parent).isDirectory()) throw new Error("Memory storage parent must be a canonical directory");
    if (existsSync(memoryPath) && (!lstatSync(memoryPath).isFile() || realpathSync(memoryPath) !== memoryPath)) throw new Error("Memory storage must be a canonical regular file");
  }
  if (recipe.trustedSandbox) {
    if (!sandboxProviderAvailable()) throw new Error("Requested OS sandbox is unavailable on this platform");
    validateTrustedSandboxConfig(recipe.trustedSandbox);
  }
  if (recipe.managedInstallation) {
    const tree = installedTreeDigest(recipe.managedInstallation.treeRoot);
    if (tree.sha256 !== recipe.managedInstallation.treeSha256 || tree.files !== recipe.managedInstallation.treeFiles) throw new Error("Pinned installed dependency tree changed");
  }
  // Canonical files avoid path substitution through a symlink between setup and launch.
  for (const file of [{ path: recipe.command, sha256: recipe.commandSha256 }, ...recipe.pinnedFiles]) {
    const stat = lstatSync(file.path);
    if (!stat.isFile() || realpathSync(file.path) !== file.path || sha256(readFileSync(file.path)) !== file.sha256) throw new Error("Pinned server file changed");
  }
  if (!lstatSync(recipe.cwd).isDirectory() || realpathSync(recipe.cwd) !== recipe.cwd) throw new Error("Server working directory must be canonical");
}
function assertPrivate(path: string): void {
  if (process.platform === "win32") throw new Error("Private tools metadata requires a Windows ACL backend, which is unavailable");
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error("Tools metadata must be a private regular file");
}
export function readToolsConfig(path: string): ToolsConfig {
  if (!existsSync(path)) return defaultToolsConfig();
  assertPrivate(path);
  return validateToolsConfig(JSON.parse(readFileSync(path, "utf8")));
}
export function writeToolsConfig(path: string, value: ToolsConfig): void {
  if (process.platform === "win32") throw new Error("Private tools metadata requires a Windows ACL backend, which is unavailable");
  const config = validateToolsConfig(value);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (existsSync(path)) assertPrivate(path);
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  const fd = openSync(temporary, "wx", 0o600);
  try { writeFileSync(fd, `${JSON.stringify(config, null, 2)}\n`); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temporary, path);
  chmodSync(path, 0o600);
  const directory = openSync(dirname(path), "r"); try { fsyncSync(directory); } finally { closeSync(directory); }
}
