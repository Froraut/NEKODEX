const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

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
function assertMacPublisher(details, expectedTeam) {
  if (!/^Authority=Developer ID Application:/m.test(details) || !details.includes(`TeamIdentifier=${expectedTeam}\n`)
    || !/^Timestamp=/m.test(details) || /^Signature=adhoc$/m.test(details)) throw new Error("macOS signature is not a timestamped Developer ID signature from the configured team");
}
function verifyMacPublisher(target, env = process.env, { notarized = false } = {}) {
  run("codesign", ["--verify", "--deep", "--strict", target], { env });
  assertMacPublisher(run("codesign", ["--display", "--verbose=4", target], { env, capture: true }), env.APPLE_TEAM_ID);
  if (notarized) {
    run("xcrun", ["stapler", "validate", target], { env });
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
function verifyWindowsTree(directory, env = process.env) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) verifyWindowsTree(file, env);
    else if (entry.isFile() && /\.exe$/i.test(entry.name)) verifyWindowsPublisher(file, env);
  }
}
module.exports = { signingConfiguration, assertMacPublisher, verifyMacPublisher, verifyWindowsPublisher, verifyWindowsTree, signEmbeddedRuntime, signCredentialHelper };
