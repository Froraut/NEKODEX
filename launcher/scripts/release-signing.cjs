const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const { CHROME_COMPANION_ID } = require("../electron/ipc/browser-companion.cjs");
const { DESKTOP_HELPER_IDENTIFIER, DESKTOP_HELPER_EXECUTABLE_PATH, DESKTOP_HELPER_INFO_PLIST_PATH } = require("../../scripts/build-desktop-helper.cjs");

/** Chrome derives an unpacked extension's ID from its manifest key: SHA-256 of the DER SPKI, a-p digits. */
function chromeExtensionIdFromKey(key) {
  if (typeof key !== "string" || !/^[A-Za-z0-9+/]{100,1000}={0,2}$/.test(key)) return undefined;
  return [...createHash("sha256").update(Buffer.from(key, "base64")).digest("hex").slice(0, 32)]
    .map(digit => String.fromCharCode(97 + Number.parseInt(digit, 16))).join("");
}

// Every file both shipped companion directories load: the pages, every bundled script (chatgpt.js
// runs the ChatGPT send) and the manifest icons. Kept equal to BROWSER_COMPANION_FILES by a test.
const BROWSER_COMPANION_RESOURCES = Object.freeze(["popup.html", "popup.css", "popup.js", "page.js", "chatgpt.js", "dispatch.js", "transport.js",
  "session.html", "session.js", "icons/icon-16.png", "icons/icon-32.png", "icons/icon-48.png", "icons/icon-128.png"]);

// This checks the installed asset contract without launching any helper, browser
// or VM. The outer runtime manifest additionally authenticates every file byte.
function validatePackagedRuntimeAssets(runtimeRoot, { platform = process.platform, arch = process.arch } = {}) {
  const app = path.join(runtimeRoot, "app");
  const required = ["cli.js", "browser-helper.cjs", "browser-companion/manifest.json",
    "browser-companion/manifest.firefox.json", "browser-companion/firefox/manifest.json"];
  for (const name of BROWSER_COMPANION_RESOURCES) required.push(`browser-companion/${name}`, `browser-companion/firefox/${name}`);
  if (platform === "darwin") {
    for (const [directory, executable] of [["credential-helper", "nekodex-credential-helper"], ["oauth-vault-helper", "nekodex-oauth-vault-helper"],
      ["desktop-helper", DESKTOP_HELPER_EXECUTABLE_PATH], ["desktop-helper", DESKTOP_HELPER_INFO_PLIST_PATH], ["skill-pdf-helper", "nekodex-skill-pdf-helper"]]) {
      required.push(`${directory}/${platform}-${arch}/${executable}`);
    }
    required.push(`skill-pdf-helper/${platform}-${arch}/manifest.json`);
  }
  const read = file => {
    const metadata = fs.lstatSync(file);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1) throw new Error(`Packaged runtime asset is missing or unsafe: ${file}`);
    return fs.readFileSync(file);
  };
  for (const name of required) read(path.join(app, name));
  // A missing or changed key would give the unpacked Chrome extension a path-derived ID that the pinned app refuses.
  let chromeManifest;
  try { chromeManifest = JSON.parse(read(path.join(app, "browser-companion/manifest.json"))); } catch { chromeManifest = undefined; }
  if (chromeExtensionIdFromKey(chromeManifest?.key) !== CHROME_COMPANION_ID) throw new Error("Packaged Chrome companion manifest key does not produce the pinned extension ID");
  if (platform === "darwin" && arch === "arm64") {
    const directory = path.join(app, "execution-vm", "darwin-arm64");
    const names = ["Image", "guest-manifest.json", "helper-manifest.json", "initrd.gz", "nekodex-execution-vm-helper", "runtime-manifest.json"];
    if (!isDeepStrictEqual(fs.readdirSync(directory).sort(), names)) throw new Error("Packaged execution VM must contain exactly its six fixed runtime files");
    const { createProductionVmRuntimeManifest } = require("../../scripts/build-execution-vm-helper.cjs");
    const expected = createProductionVmRuntimeManifest(read(path.join(directory, "helper-manifest.json")), read(path.join(directory, "guest-manifest.json")));
    if (!isDeepStrictEqual(JSON.parse(read(path.join(directory, "runtime-manifest.json"))), expected)) throw new Error("Packaged execution VM metadata closure is invalid");
    for (const [name, digest] of [[expected.helper.path, expected.helper.sha256],
      [expected.guest.kernelPath, expected.guest.kernelSha256], [expected.guest.initrdPath, expected.guest.initrdSha256]]) {
      if (createHash("sha256").update(read(path.join(directory, name))).digest("hex") !== digest) throw new Error(`Packaged execution VM checksum mismatch: ${name}`);
    }
    const executable = path.join(directory, expected.helper.path);
    if ((fs.statSync(executable).mode & 0o111) === 0) throw new Error("Packaged execution VM helper is not executable");
  }
  return { platform, arch, executionVm: platform === "darwin" && arch === "arm64", browserCompanion: ["chrome", "firefox"] };
}

function validateOwnedNativePackagedAssets(runtimeRoot, { platform = process.platform, arch = process.arch } = {}) {
  if (platform !== "darwin" || arch !== "arm64") return { ownedNative: false };
  const sourceRoot = path.join(runtimeRoot, "app", "owned-native"), target = "aarch64-apple-darwin";
  const executable = path.join(sourceRoot, "build", target, "nekodex-owned-native-worker");
  const { validateOwnedNativeProductionManifest } = require("../electron/owned-native-production-pin.cjs");
  const manifest = validateOwnedNativeProductionManifest({ sourceRoot, executable, target });
  if ((fs.statSync(executable).mode & 0o111) === 0) throw new Error("Packaged Owned Native worker is not executable");
  return { ownedNative: true, distribution: manifest.distribution, target };
}

function signingConfiguration(platform, env = process.env) {
  if (env.CODEX_WEB_GPT_RELEASE !== "1") return { release: false };
  const required = platform === "darwin"
    ? ["CSC_NAME", "CODEX_WEB_GPT_SIGNING_KEYCHAIN", "APPLE_TEAM_ID", ...(env.APPLE_KEYCHAIN_PROFILE ? [] : ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"])]
    : platform === "win32" ? ["CODEX_WEB_GPT_WINDOWS_CERT_SHA1", "CODEX_WEB_GPT_SIGNTOOL"] : [];
  for (const name of required) if (!env[name]) throw new Error(`Publisher release requires ${name}`);
  if (platform === "darwin" && (!env.CSC_NAME.startsWith("Developer ID Application:") || !/^[A-Z0-9]{10}$/.test(env.APPLE_TEAM_ID))) {
    throw new Error("Publisher release requires a Developer ID Application identity and Apple team ID; Development/ad-hoc identities are not distributable publisher signatures");
  }
  if (platform === "win32" && !/^[A-Fa-f0-9]{40}$/.test(env.CODEX_WEB_GPT_WINDOWS_CERT_SHA1)) throw new Error("Windows publisher certificate thumbprint is invalid");
  return { release: true };
}
function run(command, args, { env = process.env, capture = false } = {}) {
  const result = spawnSync(command, args, { env, encoding: "utf8", stdio: capture ? "pipe" : "inherit", shell: false });
  if (result.error || result.status !== 0) throw new Error(`Publisher signature command ${path.basename(command)} failed`);
  return `${result.stdout || ""}\n${result.stderr || ""}`;
}
// `stapler validate` asks Apple's CloudKit ticket service; a dropped connection there
// (exit 68, "The network connection was lost") says nothing about the stapled ticket.
// Retry only that transient failure; any other result still fails the release.
function staplerValidate(target, env, { attempts = 4, sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) } = {}) {
  for (let attempt = 1; ; attempt++) {
    const result = spawnSync("xcrun", ["stapler", "validate", target], { env, encoding: "utf8", stdio: "pipe", shell: false });
    process.stdout.write(result.stdout || ""); process.stderr.write(result.stderr || "");
    if (!result.error && result.status === 0) return;
    const transient = !result.error && result.status === 68 && /network connection was lost|NSURLErrorDomain/i.test(`${result.stdout}\n${result.stderr}`);
    if (!transient || attempt >= attempts) throw new Error("Publisher signature command xcrun failed");
    sleep(15_000 * attempt);
  }
}
function assertMacPublisher(details, expectedTeam) {
  if (!/^Authority=Developer ID Application:/m.test(details) || !details.includes(`TeamIdentifier=${expectedTeam}\n`)
    || !/^Timestamp=/m.test(details) || /^Signature=adhoc$/m.test(details)) throw new Error("macOS signature is not a timestamped Developer ID signature from the configured team");
}
function verifyMacPublisher(target, env = process.env, { notarized = false } = {}) {
  run("codesign", ["--verify", "--deep", "--strict", target], { env });
  assertMacPublisher(run("codesign", ["--display", "--verbose=4", target], { env, capture: true }), env.APPLE_TEAM_ID);
  if (notarized) {
    staplerValidate(target, env);
    run("spctl", ["--assess", "--type", "execute", "--verbose=2", target], { env });
  }
}
function verifyWindowsPublisher(target, env = process.env) {
  run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
    path.join(__dirname, "verify-windows-publisher.ps1"), "-Path", target, "-ExpectedThumbprint", env.CODEX_WEB_GPT_WINDOWS_CERT_SHA1], { env });
}
function signEmbeddedRuntime(target, platform = process.platform, env = process.env) {
  const release = signingConfiguration(platform, env).release;
  const localMacIdentity = platform === "darwin" && env.NEKODEX_LOCAL_APP_SIGNING_IDENTITY;
  if (!release && !localMacIdentity) return;
  if (platform === "darwin") {
    const identity = release ? env.CSC_NAME : localMacIdentity;
    const keychain = release ? env.CODEX_WEB_GPT_SIGNING_KEYCHAIN : env.NEKODEX_LOCAL_APP_SIGNING_KEYCHAIN;
    if (!identity.startsWith("Developer ID Application:")) throw new Error("Local application update requires a Developer ID Application identity");
    run("codesign", ["--force", "--options", "runtime", "--timestamp", "--entitlements",
      path.resolve(__dirname, "../assets/entitlements.bun.plist"), ...(keychain ? ["--keychain", keychain] : []), "--sign", identity, target], { env });
    if (release) verifyMacPublisher(target, env);
    else run("codesign", ["--verify", "--strict", target], { env });
  } else if (platform === "win32") {
    run(env.CODEX_WEB_GPT_SIGNTOOL, ["sign", "/sha1", env.CODEX_WEB_GPT_WINDOWS_CERT_SHA1, "/s", "My", "/fd", "SHA256", "/tr", "https://timestamp.digicert.com", "/td", "SHA256", target], { env });
    verifyWindowsPublisher(target, env);
  }
}
// The copied Native worker has a separate stable identity and no JIT, VM,
// Keychain or desktop entitlements. Its original DEV provenance stays unchanged.
function signOwnedNativeWorker(target, platform = process.platform, env = process.env) {
  if (platform !== "darwin") throw new Error("Owned Native production signing requires macOS");
  const release = signingConfiguration(platform, env).release;
  const identity = release ? env.CSC_NAME : env.NEKODEX_LOCAL_APP_SIGNING_IDENTITY;
  const keychain = release ? env.CODEX_WEB_GPT_SIGNING_KEYCHAIN : env.NEKODEX_LOCAL_APP_SIGNING_KEYCHAIN;
  if (typeof identity !== "string" || !/^Developer ID Application: .+ \(CNMWGJF2CG\)$/.test(identity)
    || release && env.APPLE_TEAM_ID !== "CNMWGJF2CG") throw new Error("Owned Native production signing requires the configured NEKODEX publisher");
  run("codesign", ["--force", "--options", "runtime", "--timestamp", "--identifier", "dev.nekodex.owned-native-worker.v1",
    ...(keychain ? ["--keychain", keychain] : []), "--sign", identity, target], { env });
  run("codesign", ["--verify", "--strict", target], { env });
  const details = run("codesign", ["--display", "--verbose=4", target], { env, capture: true });
  assertMacPublisher(details, "CNMWGJF2CG");
  if (!details.split(/\r?\n/).includes("Identifier=dev.nekodex.owned-native-worker.v1")) throw new Error("Owned Native production signing identifier changed");
}
// The Keychain ACL follows this helper's stable designated requirement. Sign
// before copying it into either bundle and before sealing runtime file hashes.
function signCredentialHelper(target, platform = process.platform, env = process.env, { development = false } = {}) {
  if (platform !== "darwin") return;
  const identifier = "dev.nekodex.tunnel-credential-helper.v1";
  const release = signingConfiguration(platform, env).release;
  const identity = release ? env.CSC_NAME : env.NEKODEX_LOCAL_APP_SIGNING_IDENTITY;
  const keychain = release ? env.CODEX_WEB_GPT_SIGNING_KEYCHAIN : env.NEKODEX_LOCAL_APP_SIGNING_KEYCHAIN;
  if (identity) {
    if (!identity.startsWith("Developer ID Application:")) throw new Error("Protected credential helper requires a Developer ID Application identity");
    run("codesign", ["--force", "--options", "runtime", "--timestamp", "--identifier", identifier,
      ...(keychain ? ["--keychain", keychain] : []), "--sign", identity, target], { env });
    run("codesign", ["--verify", "--strict", target], { env });
    if (release) verifyMacPublisher(target, env);
    return;
  }
  if (!development) throw new Error("Protected credential helper requires an explicit publisher identity outside development");
  run("codesign", ["--force", "--identifier", identifier, "--sign", "-", target], { env });
}
// Desktop TCC identity is distinct from the vault helper and needs no Bun/JIT entitlements.
// The target is the whole app bundle: TCC keys the self-responsible helper by its bundle
// identifier and this designated requirement, which stay equal across releases.
function signDesktopHelper(target, platform = process.platform, env = process.env, { development = false } = {}) {
  if (platform !== "darwin") return;
  if (path.extname(target) !== ".app") throw new Error("Desktop helper signing target must be its app bundle");
  const identifier = DESKTOP_HELPER_IDENTIFIER;
  const release = signingConfiguration(platform, env).release;
  const identity = release ? env.CSC_NAME : env.NEKODEX_LOCAL_APP_SIGNING_IDENTITY;
  const keychain = release ? env.CODEX_WEB_GPT_SIGNING_KEYCHAIN : env.NEKODEX_LOCAL_APP_SIGNING_KEYCHAIN;
  if (identity) {
    if (!identity.startsWith("Developer ID Application:")) throw new Error("Desktop helper requires a Developer ID Application identity");
    run("codesign", ["--force", "--options", "runtime", "--timestamp", "--identifier", identifier,
      ...(keychain ? ["--keychain", keychain] : []), "--sign", identity, target], { env });
    run("codesign", ["--verify", "--strict", target], { env });
    if (release) verifyMacPublisher(target, env);
    return;
  }
  if (!development) throw new Error("Desktop helper requires an explicit publisher identity outside development");
  run("codesign", ["--force", "--identifier", identifier, "--sign", "-", target], { env });
}
// PDF parsing has its own identity; it must never borrow the desktop/TCC identity.
function signSkillPdfHelper(target, platform = process.platform, env = process.env, { development = false } = {}) {
  if (platform !== "darwin") return;
  const identifier = "dev.nekodex.skill-pdf-reader.v1";
  const release = signingConfiguration(platform, env).release;
  const identity = release ? env.CSC_NAME : env.NEKODEX_LOCAL_APP_SIGNING_IDENTITY;
  const keychain = release ? env.CODEX_WEB_GPT_SIGNING_KEYCHAIN : env.NEKODEX_LOCAL_APP_SIGNING_KEYCHAIN;
  if (identity) {
    if (!identity.startsWith("Developer ID Application:")) throw new Error("PDF helper requires a Developer ID Application identity");
    run("codesign", ["--force", "--options", "runtime", "--timestamp", "--identifier", identifier,
      ...(keychain ? ["--keychain", keychain] : []), "--sign", identity, target], { env });
    run("codesign", ["--verify", "--strict", target], { env });
    if (release) verifyMacPublisher(target, env);
    return;
  }
  if (!development) throw new Error("PDF helper requires an explicit publisher identity outside development");
  run("codesign", ["--force", "--identifier", identifier, "--sign", "-", target], { env });
}
function verifyWindowsTree(directory, env = process.env) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) verifyWindowsTree(file, env);
    else if (entry.isFile() && /\.exe$/i.test(entry.name)) verifyWindowsPublisher(file, env);
  }
}
module.exports = { BROWSER_COMPANION_RESOURCES, staplerValidate, chromeExtensionIdFromKey, validatePackagedRuntimeAssets, validateOwnedNativePackagedAssets, signingConfiguration, assertMacPublisher, verifyMacPublisher, verifyWindowsPublisher, verifyWindowsTree, signEmbeddedRuntime, signOwnedNativeWorker, signCredentialHelper, signDesktopHelper, signSkillPdfHelper };
