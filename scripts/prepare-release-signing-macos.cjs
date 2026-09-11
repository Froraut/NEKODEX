const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const env = process.env;
for (const name of ["RUNNER_TEMP", "GITHUB_ENV", "CSC_P12_BASE64", "CSC_KEY_PASSWORD", "CSC_NAME", "APPLE_TEAM_ID", "APPLE_API_KEY_BASE64", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"]) {
  if (!env[name]) throw new Error(`Missing release signing input: ${name}`);
}
if (!env.CSC_NAME.startsWith("Developer ID Application:") || !/^[A-Z0-9]{10}$/.test(env.APPLE_TEAM_ID)) throw new Error("A Developer ID Application certificate and team ID are required");
const directory = path.join(env.RUNNER_TEMP, "codex-web-release-signing");
fs.mkdirSync(directory, { mode: 0o700 });
const keychain = path.join(directory, "release.keychain-db");
const certificate = path.join(directory, "certificate.p12");
const apiKey = path.join(directory, "AuthKey.p8");
fs.writeFileSync(certificate, Buffer.from(env.CSC_P12_BASE64, "base64"), { mode: 0o600 });
fs.writeFileSync(apiKey, Buffer.from(env.APPLE_API_KEY_BASE64, "base64"), { mode: 0o600 });
const password = crypto.randomBytes(32).toString("hex");
function security(args) {
  const result = spawnSync("security", args, { stdio: "pipe" });
  // Never echo commands or keychain/import output containing credential context.
  if (result.error || result.status !== 0) throw new Error("Temporary release keychain setup failed");
}
security(["create-keychain", "-p", password, keychain]);
security(["set-keychain-settings", "-lut", "21600", keychain]);
security(["unlock-keychain", "-p", password, keychain]);
security(["import", certificate, "-P", env.CSC_KEY_PASSWORD, "-k", keychain, "-T", "/usr/bin/codesign"]);
security(["set-key-partition-list", "-S", "apple-tool:,apple:", "-s", "-k", password, keychain]);
fs.rmSync(certificate);
for (const [name, value] of Object.entries({ CODEX_WEB_GPT_SIGNING_KEYCHAIN: keychain, CSC_KEYCHAIN: keychain, APPLE_API_KEY: apiKey })) {
  if (/[\r\n]/.test(value)) throw new Error("Invalid release credential file path");
  fs.appendFileSync(env.GITHUB_ENV, `${name}=${value}\n`);
}
