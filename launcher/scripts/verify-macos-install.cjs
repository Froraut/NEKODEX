// Read-only delivery gate. This never launches the application, a helper or a VM.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { validateRuntimeBundle } = require("../electron/runtime-install.cjs");
const { assertMacPublisher, validatePackagedRuntimeAssets, validateOwnedNativePackagedAssets } = require("./release-signing.cjs");

const TEAM = "CNMWGJF2CG";
const APP_ID = "dev.codexwebgpt.launcher";

function assertIdentity(details, identifier) {
  assertMacPublisher(details, TEAM);
  if (!details.split(/\r?\n/).includes(`Identifier=${identifier}`)) {
    throw new Error(`Installed signature identifier mismatch: ${identifier}`);
  }
  if (!/^CodeDirectory .*flags=.*\([^\n)]*\bruntime\b[^\n)]*\)/m.test(details)) {
    throw new Error(`Installed signed code lacks hardened runtime: ${identifier}`);
  }
}

function assertVmEntitlements(entitlements) {
  if (!entitlements || Object.keys(entitlements).length !== 1
    || entitlements["com.apple.security.virtualization"] !== true) {
    throw new Error("Installed VM helper must have exactly virtualization:true");
  }
}

function assertNoEntitlements(entitlements, label) {
  if (!entitlements || Object.keys(entitlements).length !== 0) {
    throw new Error(`Installed ${label} must have no extra entitlements`);
  }
}

function assertVaultEntitlements(entitlements) {
  assertNoEntitlements(entitlements, "OAuth vault helper");
}

function run(command, args, input) {
  const result = spawnSync(command, args, {
    encoding: "utf8", input, shell: false, timeout: 30_000, maxBuffer: 1024 * 1024,
    env: { ...process.env, PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Read-only integrity command ${path.basename(command)} failed: ${result.error?.message || result.stderr?.trim() || result.status}`);
  }
  return result;
}

function inspectMacInstall({ appPath, version, arch = process.arch, durableRuntime, notarized = false }) {
  if (process.platform !== "darwin") throw new Error("Installed macOS inspection requires macOS");
  if (!path.isAbsolute(appPath) || !appPath.endsWith(".app") || fs.realpathSync(appPath) !== appPath
    || !["arm64", "x64"].includes(arch) || typeof version !== "string" || !version) {
    throw new Error("Supply the exact absolute .app path, expected version and supported architecture");
  }
  const info = JSON.parse(run("/usr/bin/plutil", ["-convert", "json", "-o", "-", path.join(appPath, "Contents/Info.plist")]).stdout);
  if (info.CFBundleIdentifier !== APP_ID || info.CFBundleShortVersionString !== version
    || info.CFBundleExecutable !== "NEKODEX") throw new Error("Installed application identity/version differs from the requested build");
  run("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath]);
  const signature = (target, identifier) => {
    run("/usr/bin/codesign", ["--verify", "--strict", target]);
    const details = run("/usr/bin/codesign", ["--display", "--verbose=4", target]);
    if (identifier) assertIdentity(`${details.stdout}\n${details.stderr}`, identifier);
    else assertMacPublisher(`${details.stdout}\n${details.stderr}`, TEAM);
  };
  const entitlements = target => {
    const xml = run("/usr/bin/codesign", ["--display", "--entitlements", "-", "--xml", target]).stdout;
    return xml.trim() ? JSON.parse(run("/usr/bin/plutil", ["-convert", "json", "-o", "-", "-"], xml).stdout) : {};
  };
  signature(appPath, APP_ID);
  const runtime = path.join(appPath, "Contents/Resources/runtime");
  validateRuntimeBundle(runtime, { version, platform: "darwin", arch });
  const assets = validatePackagedRuntimeAssets(runtime, { platform: "darwin", arch });
  const ownedNative = validateOwnedNativePackagedAssets(runtime, { platform: "darwin", arch });
  const manifest = JSON.parse(fs.readFileSync(path.join(runtime, "manifest.json"), "utf8"));
  signature(path.join(runtime, "runtime/bun"));
  const helperIdentities = [
    ["credential-helper", "nekodex-credential-helper", "dev.nekodex.tunnel-credential-helper.v1"],
    ["desktop-helper", "nekodex-desktop-helper", "dev.nekodex.desktop-provider.v1"],
    ["skill-pdf-helper", "nekodex-skill-pdf-helper", "dev.nekodex.skill-pdf-reader.v1"],
    ["oauth-vault-helper", "nekodex-oauth-vault-helper", "dev.nekodex.mcp-oauth-vault-helper.v1"],
  ];
  for (const [directory, executable, identifier] of helperIdentities) {
    const helper = path.join(runtime, "app", directory, `darwin-${arch}`, executable);
    signature(helper, identifier);
    if (directory === "oauth-vault-helper") assertVaultEntitlements(entitlements(helper));
  }
  // Main-process Keychain consumers load their unpacked Electron copies.
  for (const [directory, executable, identifier] of helperIdentities.filter(([directory]) => ["credential-helper", "oauth-vault-helper"].includes(directory))) {
    const helper = path.join(appPath, "Contents/Resources/app.asar.unpacked/electron", directory, `darwin-${arch}`, executable);
    const metadata = fs.lstatSync(helper);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`Unpacked Keychain helper is missing or unsafe: ${directory}`);
    signature(helper, identifier);
    if (directory === "oauth-vault-helper") assertVaultEntitlements(entitlements(helper));
  }
  if (arch === "arm64") {
    const worker = path.join(runtime, "app/owned-native/build/aarch64-apple-darwin/nekodex-owned-native-worker");
    signature(worker, "dev.nekodex.owned-native-worker.v1");
    assertNoEntitlements(entitlements(worker), "Owned Native worker");
    const helper = path.join(runtime, "app/execution-vm/darwin-arm64/nekodex-execution-vm-helper");
    signature(helper, "com.nekodex.execution-vm-helper");
    assertVmEntitlements(entitlements(helper));
  }
  const pty = path.join(appPath, "Contents/Resources/app.asar.unpacked/node_modules/node-pty/build/Release/pty.node");
  const ptyMetadata = fs.lstatSync(pty);
  if (!ptyMetadata.isFile() || ptyMetadata.isSymbolicLink() || ptyMetadata.size === 0) throw new Error("Installed node-pty native module is missing or unsafe");
  run("/usr/bin/lipo", ["-verify_arch", arch === "x64" ? "x86_64" : arch, pty]);
  const ptyHelper = path.join(path.dirname(pty), "spawn-helper");
  const ptyHelperMetadata = fs.lstatSync(ptyHelper);
  if (!ptyHelperMetadata.isFile() || ptyHelperMetadata.isSymbolicLink() || (ptyHelperMetadata.mode & 0o111) === 0) throw new Error("Installed node-pty spawn helper is missing or not executable");
  run("/usr/bin/lipo", ["-verify_arch", arch === "x64" ? "x86_64" : arch, ptyHelper]);
  if (durableRuntime) {
    if (!path.isAbsolute(durableRuntime) || fs.realpathSync(durableRuntime) !== durableRuntime) throw new Error("Durable runtime must be an exact absolute directory");
    validateRuntimeBundle(durableRuntime, { version, platform: "darwin", arch, bundleId: manifest.bundleId });
    validatePackagedRuntimeAssets(durableRuntime, { platform: "darwin", arch });
    validateOwnedNativePackagedAssets(durableRuntime, { platform: "darwin", arch });
  }
  if (notarized) {
    run("/usr/bin/xcrun", ["stapler", "validate", appPath]);
    run("/usr/sbin/spctl", ["--assess", "--type", "execute", "--verbose=2", appPath]);
  }
  return { ok: true, appPath, version, platform: "darwin", arch, publisherTeamId: TEAM,
    bundleId: manifest.bundleId, assets, ownedNative, nativePty: "present-matching-architecture",
    durableRuntime: durableRuntime || null, notarizationChecked: notarized,
    applicationLaunched: false, vmBooted: false };
}

function parseArguments(args) {
  const options = {};
  const keys = { "--app": "appPath", "--version": "version", "--arch": "arch", "--durable-runtime": "durableRuntime" };
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (key === "--notarized" && !options.notarized) { options.notarized = true; continue; }
    if (!Object.hasOwn(keys, key) || options[keys[key]] !== undefined || !args[index + 1] || args[index + 1].startsWith("--")) {
      throw new Error("Usage: node launcher/scripts/verify-macos-install.cjs --app /Applications/NEKODEX.app --version VERSION [--arch arm64|x64] [--durable-runtime /absolute/runtime] [--notarized]");
    }
    options[keys[key]] = args[++index];
  }
  if (!options.appPath || !options.version) throw new Error("Expected explicit --app and --version");
  return options;
}

module.exports = { inspectMacInstall, assertIdentity, assertVmEntitlements, assertVaultEntitlements, parseArguments };
if (require.main === module) {
  try { process.stdout.write(`MACOS_INSTALL_INTEGRITY_OK ${JSON.stringify(inspectMacInstall(parseArguments(process.argv.slice(2))))}\n`); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
