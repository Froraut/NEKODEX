const fs = require("node:fs");
const { createHash } = require("node:crypto");
const path = require("node:path");

function runtimeBundlePaths(runtimeRoot, platform = process.platform) {
  return {
    runtimeRoot,
    executable: path.join(runtimeRoot, "runtime", platform === "win32" ? "bun.exe" : "bun"),
    entrypoint: path.join(runtimeRoot, "app", "cli.js"),
  };
}

function packagedRuntimePaths(resourcesPath, platform = process.platform) {
  return runtimeBundlePaths(path.join(resourcesPath, "runtime"), platform);
}

const PACKAGED_VM_ORIGIN_ENV = "NEKODEX_PACKAGED_VM_ORIGIN";

// This binding supplies locators, not publisher authority. The copied CLI later
// verifies the app seal and hashes its actual executable/entrypoint against the
// sealed manifest before VM admission. Never use PATH or a source checkout here.
function packagedVmOriginEnvironment({ resourcesPath = process.resourcesPath, entrypoint, executable, platform = process.platform }) {
  if (platform !== "darwin") return { [PACKAGED_VM_ORIGIN_ENV]: "" };
  if (typeof resourcesPath !== "string" || !path.isAbsolute(resourcesPath)
    || path.basename(resourcesPath) !== "Resources" || path.basename(path.dirname(resourcesPath)) !== "Contents"
    || !path.basename(path.dirname(path.dirname(resourcesPath))).endsWith(".app")) {
    throw new Error("Packaged VM origin requires the launcher's fixed application Resources path");
  }
  const bundled = packagedRuntimePaths(resourcesPath, platform);
  const manifestPath = path.join(bundled.runtimeRoot, "manifest.json");
  const before = fs.lstatSync(manifestPath, { bigint: true });
  if (fs.realpathSync(manifestPath) !== manifestPath || !before.isFile() || before.nlink !== 1n
    || before.size < 1n || before.size > 16n * 1024n * 1024n || (before.mode & 0o022n)) {
    throw new Error("Packaged VM origin manifest is unsafe");
  }
  const fd = fs.openSync(manifestPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  let bytes;
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    if (opened.dev !== before.dev || opened.ino !== before.ino) throw new Error("Packaged VM origin changed");
    bytes = fs.readFileSync(fd);
    const after = fs.lstatSync(manifestPath, { bigint: true });
    if (["dev", "ino", "size", "mtimeNs", "ctimeNs", "mode"].some(key => before[key] !== after[key])) throw new Error("Packaged VM origin changed");
  } finally { fs.closeSync(fd); }
  return { [PACKAGED_VM_ORIGIN_ENV]: JSON.stringify({ version: 1, bundledEntryPath: bundled.entrypoint,
    runtimeEntryPath: entrypoint, runtimeExecutablePath: executable,
    runtimeManifestSha256: createHash("sha256").update(bytes).digest("hex") }) };
}

function sourceRuntimeInvocation(sourceRoot, args) {
  return {
    executable: process.env.CODEX_CHATGPT_WEB_BUN?.trim()
      || process.env.CODEX_WEB_GPT_BUN?.trim()
      || "bun",
    args: ["run", path.join(sourceRoot, "src", "cli.ts"), ...args],
    cwd: sourceRoot,
    env: { [PACKAGED_VM_ORIGIN_ENV]: "" },
  };
}

function runtimeInvocation({ app, sourceRoot, installedRuntimeRoot, args }) {
  if (!Array.isArray(args)) throw new Error("Runtime arguments must be an array");
  if (!app.isPackaged) return sourceRuntimeInvocation(sourceRoot, args);

  if (!installedRuntimeRoot || !path.isAbsolute(installedRuntimeRoot)) {
    throw new Error("Packaged launcher runtime has not been installed into durable local storage");
  }
  const { runtimeRoot, executable, entrypoint } = runtimeBundlePaths(installedRuntimeRoot);
  if (!fs.existsSync(executable)) throw new Error(`Bundled Bun runtime is missing: ${executable}`);
  if (!fs.existsSync(entrypoint)) throw new Error(`Bundled runtime entrypoint is missing: ${entrypoint}`);
  return {
    executable,
    args: [entrypoint, ...args],
    cwd: runtimeRoot,
    env: packagedVmOriginEnvironment({ entrypoint, executable }),
  };
}

function embeddedRuntimeInvocation({ app, sourceRoot, args }) {
  if (!Array.isArray(args)) throw new Error("Runtime arguments must be an array");
  if (!app.isPackaged) return sourceRuntimeInvocation(sourceRoot, args);
  const { runtimeRoot, executable, entrypoint } = packagedRuntimePaths(process.resourcesPath);
  if (!fs.existsSync(executable)) throw new Error(`Embedded Bun runtime is missing: ${executable}`);
  if (!fs.existsSync(entrypoint)) throw new Error(`Embedded runtime entrypoint is missing: ${entrypoint}`);
  return {
    executable,
    args: [entrypoint, ...args],
    cwd: runtimeRoot,
    env: packagedVmOriginEnvironment({ entrypoint, executable }),
  };
}

module.exports = {
  PACKAGED_VM_ORIGIN_ENV,
  packagedVmOriginEnvironment,
  embeddedRuntimeInvocation,
  packagedRuntimePaths,
  runtimeBundlePaths,
  runtimeInvocation,
};
