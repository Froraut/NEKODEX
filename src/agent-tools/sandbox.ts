import { createHash } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, sep } from "node:path";

const SANDBOX_EXEC = "/usr/bin/sandbox-exec";
// Apple dyld-support.sb documents Cryptex-backed library locations on snapshot boots.
const SYSTEM_READ_ROOTS = ["/System/Library", "/usr/lib", "/usr/share",
  "/System/Volumes/Preboot/Cryptexes/OS/System/Library", "/System/Volumes/Preboot/Cryptexes/OS/usr/lib",
  "/System/Cryptexes/OS/System/Library", "/System/Cryptexes/OS/usr/lib"];
// dyld/libignition needs to open the root directory as an openat anchor; this is not a subpath grant.
const SYSTEM_READ_FILES = ["/", "/dev/random", "/dev/urandom", "/dev/null", "/dev/zero"];
const SYSCTL_NAMES = ["kern.osrelease", "kern.osversion", "kern.ostype", "kern.maxfilesperproc", "vm.pagesize", "sysctl.proc_translated"];
export interface SandboxRootGrant { path: string; dev: string; ino: string }
export interface TrustedSandboxConfig {
  version: 1;
  provider: "macos-seatbelt";
  codeRoots: SandboxRootGrant[];
  readRoots: SandboxRootGrant[];
  writeRoots: SandboxRootGrant[];
}
export interface McpSandboxBoundary {
  provider: "macos-seatbelt";
  deprecatedOSInterface: true;
  network: "deny-all-new-sockets";
  filesystemMetadata: "all-paths";
  sysctlRead: { prefixes: string[]; names: string[] };
  systemReadRoots: string[];
  systemReadFiles: string[];
  ancestorDirectoryReads: string[];
  codeRoots: string[];
  readRoots: string[];
  writeRoots: string[];
  privateHome: string;
  privateTmp: string;
  inheritedDescriptors: "stdio-only-from-transport-owner";
  descendantBoundary: "fork-inheritance-observed; post-parent-exit-lifecycle-unverified";
}
export interface TrustedMcpSandboxLaunch {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  boundary: McpSandboxBoundary;
  /** Call immediately before constructing/connecting the SDK transport after any await. */
  assertCurrent(): void;
}
function pathSyntax(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length > 4096 || !isAbsolute(value)
    || /["\\\u0000-\u001f\u007f]/.test(value)) throw new Error("Sandbox paths must be absolute without profile escapes or control characters");
}
function identity(path: string): SandboxRootGrant {
  pathSyntax(path);
  if (realpathSync(path) !== path) throw new Error("Sandbox paths must be canonical without symbolic links");
  const stat = lstatSync(path, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Sandbox root must be an existing directory");
  return { path, dev: stat.dev.toString(), ino: stat.ino.toString() };
}
function ancestorIdentities(path: string): SandboxRootGrant[] {
  const result: SandboxRootGrant[] = [];
  for (let current = path; ; current = dirname(current)) {
    result.push(identity(current));
    if (dirname(current) === current) return result;
  }
}
function sameRoot(grant: SandboxRootGrant): void {
  const current = identity(grant.path);
  if (current.dev !== grant.dev || current.ino !== grant.ino) throw new Error("Reviewed sandbox root changed");
}
function roots(value: unknown): asserts value is SandboxRootGrant[] {
  if (!Array.isArray(value) || value.length > 32) throw new Error("Sandbox grant count exceeded");
  for (const grant of value) {
    if (!grant || Object.keys(grant).sort().join(",") !== "dev,ino,path"
      || typeof grant.dev !== "string" || !/^\d+$/.test(grant.dev)
      || typeof grant.ino !== "string" || !/^\d+$/.test(grant.ino)) throw new Error("Invalid captured sandbox root");
    pathSyntax(grant.path); sameRoot(grant);
  }
  if (new Set(value.map(grant => grant.path)).size !== value.length) throw new Error("Duplicate sandbox grant");
}
export function validateTrustedSandboxConfig(value: unknown): TrustedSandboxConfig {
  const config = value as TrustedSandboxConfig;
  if (!config || Object.keys(config).sort().join(",") !== "codeRoots,provider,readRoots,version,writeRoots"
    || config.version !== 1 || config.provider !== "macos-seatbelt") throw new Error("Unsupported sandbox configuration");
  roots(config.codeRoots); roots(config.readRoots); roots(config.writeRoots);
  return structuredClone(config);
}
/** Only the trusted explicit configuration review may capture these identities. No prompt/tool input. */
export function reviewTrustedSandboxConfig(input: { codeRoots: string[]; readRoots: string[]; writeRoots: string[] }): TrustedSandboxConfig {
  const capture = (paths: string[]) => {
    if (!Array.isArray(paths) || paths.length > 32) throw new Error("Sandbox grant count exceeded");
    return paths.map(path => { const grant = identity(path); ancestorIdentities(path); return grant; });
  };
  return validateTrustedSandboxConfig({ version: 1, provider: "macos-seatbelt", codeRoots: capture(input.codeRoots),
    readRoots: capture(input.readRoots), writeRoots: capture(input.writeRoots) });
}
export function sandboxProviderAvailable(platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== "darwin") return false;
  try {
    const stat = lstatSync(SANDBOX_EXEC);
    return stat.isFile() && !stat.isSymbolicLink() && stat.uid === 0 && (stat.mode & 0o022) === 0
      && (stat.mode & 0o111) !== 0 && realpathSync(SANDBOX_EXEC) === SANDBOX_EXEC;
  } catch { return false; }
}
function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}
function pinnedExecutable(path: string, digest: string): void {
  pathSyntax(path);
  if (!/^[a-f0-9]{64}$/.test(digest) || realpathSync(path) !== path) throw new Error("Sandbox executable must be exactly pinned and canonical");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || (before.mode & 0o111) === 0 || before.nlink < 1
      || createHash("sha256").update(readFileSync(fd)).digest("hex") !== digest) throw new Error("Sandbox executable pin changed");
    const after = lstatSync(path);
    if (after.isSymbolicLink() || after.dev !== before.dev || after.ino !== before.ino
      || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new Error("Sandbox executable changed during validation");
  } finally { closeSync(fd); }
}
function privateDirectory(path: string): SandboxRootGrant {
  const grant = identity(path); const stat = lstatSync(path);
  if (stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) throw new Error("Sandbox HOME/TMP must be owner-only directories");
  return grant;
}

/** Generated SBPL only: no caller-supplied profile, inherited environment, shell or fallback. */
export function buildTrustedMcpSandboxLaunch(input: { config: TrustedSandboxConfig; executable: string;
  executableSha256: string; args: string[]; cwd: string; privateHome: string; privateTmp: string;
  platform?: NodeJS.Platform }): TrustedMcpSandboxLaunch {
  if (!sandboxProviderAvailable(input.platform)) throw new Error("Requested OS sandbox is unavailable on this platform");
  const config = validateTrustedSandboxConfig(input.config);
  if (!Array.isArray(input.args) || input.args.length > 128 || input.args.some(arg => typeof arg !== "string" || arg.length > 8192 || arg.includes("\0"))) throw new Error("Invalid sandbox server arguments");
  pinnedExecutable(input.executable, input.executableSha256);
  const home = privateDirectory(input.privateHome); const tmp = privateDirectory(input.privateTmp);
  const cwd = identity(input.cwd);
  const codeRoots = config.codeRoots.map(grant => grant.path);
  const writeRoots = [...config.writeRoots.map(grant => grant.path), home.path, tmp.path];
  if (!config.readRoots.concat(config.codeRoots, config.writeRoots, home, tmp).some(grant => within(grant.path, cwd.path))) throw new Error("Sandbox cwd has no reviewed access grant");
  if (writeRoots.some(root => within(root, input.executable) || codeRoots.some(code => within(root, code) || within(code, root)))) throw new Error("Sandbox writable grants must not overlap executable/code roots");
  const captured = [home, tmp, cwd, ...config.codeRoots, ...config.readRoots, ...config.writeRoots]
    .flatMap(grant => ancestorIdentities(grant.path));
  captured.push(...ancestorIdentities(dirname(input.executable)));
  const ancestorDirectoryReads = [...new Set(captured.map(grant => grant.path))];
  const systemReadRoots = SYSTEM_READ_ROOTS.filter(path => existsSync(path));
  const readRoots = [...new Set([...systemReadRoots, ...codeRoots,
    ...config.readRoots.map(grant => grant.path), ...writeRoots])];
  const quote = (path: string) => { pathSyntax(path); return `"${path}"`; };
  const subpaths = (paths: string[]) => paths.map(path => `(subpath ${quote(path)})`).join("\n  ");
  const profile = `(version 1)\n(deny default)\n(allow process-exec (literal ${quote(input.executable)}))\n(allow process-fork)\n(allow signal (target self))\n(allow sysctl-read (sysctl-name-prefix "hw.") ${SYSCTL_NAMES.map(name => `(sysctl-name "${name}")`).join(" ")})\n; Metadata visibility is global; data reads and writes remain scoped below.\n(allow file-read-metadata)\n(allow file-read-data\n  ${subpaths(readRoots)}\n  ${[input.executable, ...SYSTEM_READ_FILES, ...ancestorDirectoryReads].map(path => `(literal ${quote(path)})`).join("\n  ")})\n(allow file-map-executable\n  ${subpaths([...systemReadRoots, ...codeRoots])}\n  (literal ${quote(input.executable)}))\n(allow file-write*\n  ${subpaths(writeRoots)})\n(allow file-write-data (literal "/dev/null") (literal "/dev/zero"))\n`;
  const assertCurrent = () => {
    if (!sandboxProviderAvailable(input.platform)) throw new Error("Requested OS sandbox provider changed");
    captured.forEach(sameRoot);
    privateDirectory(home.path); privateDirectory(tmp.path);
    pinnedExecutable(input.executable, input.executableSha256);
  };
  assertCurrent();
  return { command: SANDBOX_EXEC, args: ["-p", profile, input.executable, ...input.args], cwd: cwd.path,
    env: { HOME: home.path, TMPDIR: tmp.path, TMP: tmp.path, TEMP: tmp.path, PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
    boundary: { provider: "macos-seatbelt", deprecatedOSInterface: true, network: "deny-all-new-sockets",
      filesystemMetadata: "all-paths", sysctlRead: { prefixes: ["hw."], names: [...SYSCTL_NAMES] },
      systemReadRoots, systemReadFiles: [...SYSTEM_READ_FILES], ancestorDirectoryReads,
      codeRoots, readRoots: config.readRoots.map(grant => grant.path), writeRoots: config.writeRoots.map(grant => grant.path),
      privateHome: home.path, privateTmp: tmp.path, inheritedDescriptors: "stdio-only-from-transport-owner",
      descendantBoundary: "fork-inheritance-observed; post-parent-exit-lifecycle-unverified" }, assertCurrent };
}
