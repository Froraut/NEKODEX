const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { signingConfiguration, verifyMacPublisher } = require("../launcher/scripts/release-signing.cjs");
function signOAuthVaultHelper(target, platform, env, { development }) {
  const release = signingConfiguration(platform, env).release;
  const identity = release ? env.CSC_NAME : env.NEKODEX_LOCAL_APP_SIGNING_IDENTITY;
  const keychain = release ? env.CODEX_WEB_GPT_SIGNING_KEYCHAIN : env.NEKODEX_LOCAL_APP_SIGNING_KEYCHAIN;
  if (!identity && !development) throw new Error("OAuth vault requires an explicit publisher identity outside development");
  if (identity && !identity.startsWith("Developer ID Application:")) throw new Error("OAuth vault requires a Developer ID Application identity");
  const args = ["--force", "--identifier", "dev.nekodex.mcp-oauth-vault-helper.v1",
    ...(identity ? ["--options", "runtime", "--timestamp"] : []), ...(keychain ? ["--keychain", keychain] : []),
    "--sign", identity || "-", target];
  const signed = spawnSync("/usr/bin/codesign", args, { env, stdio: "inherit", shell: false, timeout: 30_000 });
  if (signed.error || signed.status !== 0) throw new Error("OAuth vault helper signing failed");
  const verified = spawnSync("/usr/bin/codesign", ["--verify", "--strict", target], { env, stdio: "inherit", shell: false, timeout: 15_000 });
  if (verified.error || verified.status !== 0) throw new Error("OAuth vault helper signature verification failed");
  if (release) verifyMacPublisher(target, env);
}

/** Compile the fixed native port. Runtime config never supplies an executable or output path. */
function compileOAuthVaultHelper({
  repositoryRoot = path.resolve(__dirname, ".."),
  platform = process.platform,
  arch = process.arch,
  env = process.env,
  development = false,
} = {}) {
  if (platform !== "darwin") return { supported: false, executable: null, platform, arch };
  const targetArch = { arm64: "arm64", x64: "x86_64" }[arch];
  if (!targetArch) throw new Error(`OAuth vault helper does not support macOS architecture ${arch}`);
  const root = fs.realpathSync(repositoryRoot);
  const source = path.join(root, "launcher", "native", "agent-oauth-vault-helper.swift");
  const sourceInfo = fs.lstatSync(source, { throwIfNoEntry: false });
  if (!sourceInfo?.isFile() || sourceInfo.isSymbolicLink()) throw new Error("OAuth vault helper Swift source is missing or invalid");
  const compiler = spawnSync("/usr/bin/xcrun", ["--find", "swiftc"], {
    env, encoding: "utf8", stdio: "pipe", shell: false, timeout: 15_000,
  });
  if (compiler.error || compiler.status !== 0 || !path.isAbsolute(compiler.stdout?.trim() || "")) {
    throw new Error("OAuth vault helper requires Apple's Swift compiler (swiftc). Install or select Xcode Command Line Tools, then retry the build.");
  }
  const sdk = spawnSync("/usr/bin/xcrun", ["--sdk", "macosx", "--show-sdk-path"], {
    env, encoding: "utf8", stdio: "pipe", shell: false, timeout: 15_000,
  });
  if (sdk.error || sdk.status !== 0 || !path.isAbsolute(sdk.stdout?.trim() || "")) {
    throw new Error("OAuth vault helper requires a selected macOS SDK; select Xcode Command Line Tools, then retry the build.");
  }
  const directory = path.join(root, "launcher", "electron", "oauth-vault-helper", `${platform}-${arch}`);
  const executable = path.join(directory, "nekodex-oauth-vault-helper");
  // Preserve the last usable helper if compilation or signing fails. Only our
  // temporary build directory is removed; no prior signature or vault item changes.
  for (const target of [path.dirname(directory), directory]) {
    const info = fs.lstatSync(target, { throwIfNoEntry: false });
    if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new Error("OAuth vault helper output directory must be a regular generated directory");
  }
  fs.mkdirSync(directory, { recursive: true });
  const previous = fs.lstatSync(executable, { throwIfNoEntry: false });
  if (previous && (!previous.isFile() || previous.isSymbolicLink())) throw new Error("OAuth vault helper output must be a regular generated file");
  const temporary = fs.mkdtempSync(path.join(directory, ".build-"));
  const candidate = path.join(temporary, "nekodex-oauth-vault-helper");
  try {
    const build = spawnSync(compiler.stdout.trim(), ["-O", "-sdk", sdk.stdout.trim(), "-target", `${targetArch}-apple-macos13.0`, source, "-o", candidate], {
      cwd: root, env, stdio: "inherit", shell: false, timeout: 120_000,
    });
    if (build.error || build.status !== 0) throw new Error("OAuth vault helper Swift compilation failed; the previous helper was preserved");
    fs.chmodSync(candidate, 0o755);
    // This owner enforces stable designated identity, explicit local/release
    // signing and the development-only ad-hoc exception before publication.
    signOAuthVaultHelper(candidate, platform, env, { development });
    const current = fs.lstatSync(executable, { throwIfNoEntry: false });
    if (Boolean(current) !== Boolean(previous) || current && previous
      && (current.ino !== previous.ino || current.dev !== previous.dev || current.isSymbolicLink())) {
      throw new Error("OAuth vault helper output changed during compilation; refusing to replace another build");
    }
    fs.renameSync(candidate, executable);
    return { supported: true, executable, platform, arch };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

module.exports = { compileOAuthVaultHelper };

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== "--development") || args.length > 1) throw new Error("Usage: node scripts/build-oauth-vault-helper.cjs [--development]");
    const result = compileOAuthVaultHelper({ development: args.includes("--development") });
    process.stdout.write(result.supported ? `${result.executable}\n` : `OAuth vault helper is unavailable on ${result.platform}; no native executable is required.\n`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
