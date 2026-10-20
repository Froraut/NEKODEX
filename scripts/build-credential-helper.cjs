const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { signCredentialHelper } = require("../launcher/scripts/release-signing.cjs");

/** Compile the fixed native port. Runtime config never supplies an executable or output path. */
function compileCredentialHelper({
  repositoryRoot = path.resolve(__dirname, ".."),
  platform = process.platform,
  arch = process.arch,
  env = process.env,
  development = false,
} = {}) {
  if (platform !== "darwin") return { supported: false, executable: null, platform, arch };
  const targetArch = { arm64: "arm64", x64: "x86_64" }[arch];
  if (!targetArch) throw new Error(`Credential helper does not support macOS architecture ${arch}`);
  const root = fs.realpathSync(repositoryRoot);
  const source = path.join(root, "launcher", "native", "tunnel-credential-helper.swift");
  const sourceInfo = fs.lstatSync(source, { throwIfNoEntry: false });
  if (!sourceInfo?.isFile() || sourceInfo.isSymbolicLink()) throw new Error("Credential helper Swift source is missing or invalid");
  const compiler = spawnSync("/usr/bin/xcrun", ["--find", "swiftc"], {
    env, encoding: "utf8", stdio: "pipe", shell: false, timeout: 15_000,
  });
  if (compiler.error || compiler.status !== 0 || !path.isAbsolute(compiler.stdout?.trim() || "")) {
    throw new Error("Credential helper requires Apple's Swift compiler (swiftc). Install or select Xcode Command Line Tools, then retry the build.");
  }
  const sdk = spawnSync("/usr/bin/xcrun", ["--sdk", "macosx", "--show-sdk-path"], {
    env, encoding: "utf8", stdio: "pipe", shell: false, timeout: 15_000,
  });
  if (sdk.error || sdk.status !== 0 || !path.isAbsolute(sdk.stdout?.trim() || "")) {
    throw new Error("Credential helper requires a selected macOS SDK; select Xcode Command Line Tools, then retry the build.");
  }
  const directory = path.join(root, "launcher", "electron", "credential-helper", `${platform}-${arch}`);
  const executable = path.join(directory, "nekodex-credential-helper");
  // Preserve the last usable helper if compilation or signing fails. Only our
  // temporary build directory is removed; no prior signature or vault item changes.
  for (const target of [path.dirname(directory), directory]) {
    const info = fs.lstatSync(target, { throwIfNoEntry: false });
    if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new Error("Credential helper output directory must be a regular generated directory");
  }
  fs.mkdirSync(directory, { recursive: true });
  const previous = fs.lstatSync(executable, { throwIfNoEntry: false });
  if (previous && (!previous.isFile() || previous.isSymbolicLink())) throw new Error("Credential helper output must be a regular generated file");
  const temporary = fs.mkdtempSync(path.join(directory, ".build-"));
  const candidate = path.join(temporary, "nekodex-credential-helper");
  try {
    const build = spawnSync(compiler.stdout.trim(), ["-O", "-sdk", sdk.stdout.trim(), "-target", `${targetArch}-apple-macos13.0`, source, "-o", candidate], {
      cwd: root, env, stdio: "inherit", shell: false, timeout: 120_000,
    });
    if (build.error || build.status !== 0) throw new Error("Credential helper Swift compilation failed; the previous helper was preserved");
    fs.chmodSync(candidate, 0o755);
    // This owner enforces stable designated identity, explicit local/release
    // signing and the development-only ad-hoc exception before publication.
    signCredentialHelper(candidate, platform, env, { development });
    const current = fs.lstatSync(executable, { throwIfNoEntry: false });
    if (Boolean(current) !== Boolean(previous) || current && previous
      && (current.ino !== previous.ino || current.dev !== previous.dev || current.isSymbolicLink())) {
      throw new Error("Credential helper output changed during compilation; refusing to replace another build");
    }
    fs.renameSync(candidate, executable);
    return { supported: true, executable, platform, arch };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

module.exports = { compileCredentialHelper };

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== "--development") || args.length > 1) throw new Error("Usage: node scripts/build-credential-helper.cjs [--development]");
    const result = compileCredentialHelper({ development: args.includes("--development") });
    process.stdout.write(result.supported ? `${result.executable}\n` : `Credential helper is unavailable on ${result.platform}; no native executable is required.\n`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
