import { createHash } from "node:crypto";
import { constants, closeSync, existsSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, sep } from "node:path";
import { validateTrustedSandboxConfig, type SandboxRootGrant } from "./sandbox";
import { pythonRuntimeStatus, type AdmittedPythonRuntime } from "./skill-python-runtime";
import { pythonEnvironmentStatus, type AdmittedPythonEnvironment } from './skill-python-environment';

export interface SkillScriptBoundary {
  provider: "macos-seatbelt"; deprecatedOSInterface: true;
  network: "deny-network-operations"; processFork: "deny"; processExec: "deny";
  filesystemMetadata: "all-paths"; systemReadRoots: string[]; systemReadFiles: string[];
  ancestorDirectoryReads: string[]; sysctlRead: { prefixes: string[]; names: string[] };
  codeRoot: string; readRoots: string[]; writeRoots: string[]; privateScratch: string;
  inheritedDescriptors: "stdio-only-after-trusted-bootstrap";
  runtime?: "python"; runtimeReadRoots?: string[]; runtimeReadFiles?: string[]; closureDigest?: string;
  pythonEnvironment?: { environmentId: string; closureDigest: string };
}
export function scriptPath(path: string): void {
  if (!isAbsolute(path) || path.length > 4096 || /["\\\u0000-\u001f\u007f]/.test(path)) throw new Error("Invalid script sandbox path");
}
export function scriptWithin(root: string, path: string): boolean {
  const rel = relative(root, path); return !rel || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}
export function assertPinnedBun(path: string, sha256: string): void {
  scriptPath(path);
  if (!/^[a-f0-9]{64}$/.test(sha256) || realpathSync(path) !== path) throw new Error("Bun must have an exact canonical executable pin");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd); const after = lstatSync(path);
    if (!before.isFile() || !(before.mode & 0o111) || after.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino
      || createHash("sha256").update(readFileSync(fd)).digest("hex") !== sha256) throw new Error("Pinned Bun executable changed");
    const final = lstatSync(path);
    if (final.dev !== before.dev || final.ino !== before.ino || final.size !== before.size || final.mtimeMs !== before.mtimeMs || final.ctimeMs !== before.ctimeMs) throw new Error("Pinned Bun executable changed during validation");
  } finally { closeSync(fd); }
}
/** Used only by a fixed trusted bootstrap before any selected code is imported. */
export function buildSkillScriptSandbox(input: { bunPath: string; bunSha256: string; codeRoot: string; scratch: string;
  readRoots: SandboxRootGrant[]; writeRoots: SandboxRootGrant[]; pythonRuntime?: AdmittedPythonRuntime; pythonEnvironment?: AdmittedPythonEnvironment }): { profile: string; boundary: SkillScriptBoundary; assertCurrent(): void } {
  if (process.platform !== "darwin") throw new Error("Skill scripts require macOS Seatbelt");
  const captured = (path: string): SandboxRootGrant => {
    scriptPath(path); const st = lstatSync(path, { bigint: true });
    if (!st.isDirectory() || realpathSync(path) !== path) throw new Error("Script sandbox directory must be canonical");
    return { path, dev: String(st.dev), ino: String(st.ino) };
  };
  const code = captured(input.codeRoot), scratch = captured(input.scratch);
  const config = validateTrustedSandboxConfig({ version: 1, provider: "macos-seatbelt", codeRoots: [code], readRoots: input.readRoots, writeRoots: input.writeRoots });
  const writes = [...config.writeRoots.map(x => x.path), scratch.path];
  if (input.pythonRuntime && !pythonRuntimeStatus(input.pythonRuntime).supported) throw new Error("Python requires its current owner-admitted runtime");
  const runtimeRoots = input.pythonRuntime ? [...input.pythonRuntime.readRoots] : [];
  const runtimeFiles = input.pythonRuntime ? [...input.pythonRuntime.readFiles] : [];
  if (input.pythonEnvironment) {
    if (!input.pythonRuntime) throw new Error('Python environment requires its admitted runtime');
    if (!pythonEnvironmentStatus(input.pythonEnvironment, input.pythonRuntime).supported) throw new Error('Python environment admission changed');
  }
  const environmentRoots = input.pythonEnvironment ? [input.pythonEnvironment.readRoot] : [];
  if (writes.some(root => environmentRoots.some(environment => scriptWithin(root, environment) || scriptWithin(environment, root)))) throw new Error('Script writes overlap immutable Python environment');
  if (writes.some(root => runtimeRoots.some(runtime => scriptWithin(root, runtime) || scriptWithin(runtime, root)) || runtimeFiles.some(runtime => scriptWithin(root, runtime)))) throw new Error("Script writes overlap admitted Python runtime dependencies");
  if (writes.some(root => scriptWithin(root, input.bunPath) || scriptWithin(root, code.path) || scriptWithin(code.path, root))) throw new Error("Script writes overlap immutable code or interpreter");
  const parents = new Map<string, SandboxRootGrant>();
  for (const root of [code, scratch, ...config.readRoots, ...config.writeRoots, captured(dirname(input.bunPath)), ...runtimeRoots.map(captured), ...runtimeFiles.map(file => captured(dirname(file)))]) {
    for (let path = root.path; ; path = dirname(path)) { parents.set(path, captured(path)); if (dirname(path) === path) break; }
  }
  // Environment/store paths remain trusted profile inputs, never public model metadata.
  const publicAncestorDirectoryReads = [...parents.keys()];
  for (const root of environmentRoots.map(captured)) {
    for (let path = root.path; ; path = dirname(path)) { parents.set(path, captured(path)); if (dirname(path) === path) break; }
  }
  const systemReadRoots = ["/System/Library", "/usr/lib", "/usr/share", "/System/Volumes/Preboot/Cryptexes/OS/System/Library", "/System/Volumes/Preboot/Cryptexes/OS/usr/lib", "/System/Cryptexes/OS/System/Library", "/System/Cryptexes/OS/usr/lib"].filter(existsSync);
  const systemReadFiles = ["/", "/dev/random", "/dev/urandom", "/dev/null", "/dev/zero"];
  const names = ["kern.osrelease", "kern.osversion", "kern.ostype", "kern.maxfilesperproc", "vm.pagesize", "sysctl.proc_translated"];
  const literal = (path: string) => { scriptPath(path); return `(literal "${path}")`; };
  const subpath = (path: string) => { scriptPath(path); return `(subpath "${path}")`; };
  const profile = `(version 1)\n(deny default)\n(deny process-fork)\n(deny process-exec)\n(allow signal (target self))\n(allow sysctl-read (sysctl-name-prefix "hw.") ${names.map(x => `(sysctl-name "${x}")`).join(" ")})\n(allow file-read-metadata)\n(allow file-read-data ${[...systemReadRoots, ...runtimeRoots, ...environmentRoots, code.path, ...config.readRoots.map(x => x.path), ...writes].map(subpath).join(" ")} ${[input.bunPath, ...runtimeFiles, ...systemReadFiles, ...parents.keys()].map(literal).join(" ")})\n(allow file-map-executable ${[...systemReadRoots, ...runtimeRoots, code.path].map(subpath).join(" ")} ${[input.bunPath, ...runtimeFiles].map(literal).join(" ")})\n(allow file-write* ${writes.map(subpath).join(" ")})\n(allow file-write-data (literal "/dev/null") (literal "/dev/zero"))\n`;
  const assertCurrent = () => {
    assertPinnedBun(input.bunPath, input.bunSha256);
    if (input.pythonRuntime && !pythonRuntimeStatus(input.pythonRuntime).supported) throw new Error("Admitted Python runtime changed");
    if (input.pythonEnvironment && !pythonEnvironmentStatus(input.pythonEnvironment, input.pythonRuntime).supported) throw new Error('Python environment admission changed');
    validateTrustedSandboxConfig(config);
    for (const old of parents.values()) { const now = captured(old.path); if (old.dev !== now.dev || old.ino !== now.ino) throw new Error("Script directory identity changed"); }
  };
  assertCurrent();
  return { profile, assertCurrent, boundary: { provider: "macos-seatbelt", deprecatedOSInterface: true, network: "deny-network-operations", processFork: "deny", processExec: "deny", filesystemMetadata: "all-paths", systemReadRoots, systemReadFiles, ancestorDirectoryReads: publicAncestorDirectoryReads, sysctlRead: { prefixes: ["hw."], names }, codeRoot: code.path, readRoots: config.readRoots.map(x => x.path), writeRoots: config.writeRoots.map(x => x.path), privateScratch: scratch.path, inheritedDescriptors: "stdio-only-after-trusted-bootstrap",
    ...(input.pythonRuntime ? { runtime: "python" as const, runtimeReadRoots: runtimeRoots, runtimeReadFiles: runtimeFiles, closureDigest: input.pythonRuntime.closureDigest } : {}),
    ...(input.pythonEnvironment ? { pythonEnvironment: { environmentId: input.pythonEnvironment.environmentId, closureDigest: input.pythonEnvironment.closureDigest } } : {}) } };
}
