const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DOMAIN, keyIdFor, verifyReleaseMetadata, validateTrust } = require("../launcher/electron/release-trust.cjs");
const manifest = require("../package.json");
const trust = require("../launcher/release-trust.json");

async function signRelease(directory, env = process.env) {
  validateTrust(trust);
  if (env.GITHUB_REPOSITORY !== trust.repository || env.GITHUB_REF_NAME !== `v${manifest.version}`
    || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || "") || !/^\d+$/.test(env.GITHUB_RUN_ID || "")) throw new Error("Release workflow identity does not match this fork/version");
  let signingKeys;
  if (env.RELEASE_METADATA_PRIVATE_KEY_FILE) {
    const privateKey = crypto.createPrivateKey(fs.readFileSync(env.RELEASE_METADATA_PRIVATE_KEY_FILE));
    signingKeys = [{ keyId: keyIdFor(privateKey), privateKey: privateKey.export({ type: "pkcs8", format: "pem" }) }];
  } else {
    if (!env.RELEASE_METADATA_SIGNING_KEYS) throw new Error("Configure RELEASE_METADATA_SIGNING_KEYS or RELEASE_METADATA_PRIVATE_KEY_FILE");
    try { signingKeys = JSON.parse(env.RELEASE_METADATA_SIGNING_KEYS); } catch { throw new Error("RELEASE_METADATA_SIGNING_KEYS must be a JSON key array"); }
  }
  if (!Array.isArray(signingKeys) || signingKeys.length < trust.threshold || signingKeys.length > 16) throw new Error("Invalid release signing key count");
  const assets = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    if (!entry.isFile() || entry.isSymbolicLink() || entry.name === "release-metadata.json") throw new Error("Release directory must contain only final asset files and no previous metadata");
    const file = path.join(directory, entry.name);
    const sha = crypto.createHash("sha256");
    for await (const chunk of fs.createReadStream(file)) sha.update(chunk);
    assets.push({ name: entry.name, size: fs.statSync(file).size, sha256: sha.digest("hex") });
  }
  const now = Date.now();
  const payload = Buffer.from(JSON.stringify({ schemaVersion: 1, repository: trust.repository, tag: env.GITHUB_REF_NAME,
    version: manifest.version, issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 90 * 86400000).toISOString(),
    source: { commit: env.GITHUB_SHA, workflow: ".github/workflows/release.yml", runId: env.GITHUB_RUN_ID, buildType: env.GITHUB_ACTIONS === "true" ? "github-actions" : "local" }, assets }));
  const signatures = signingKeys.map(entry => {
    const privateKey = crypto.createPrivateKey(entry.privateKey);
    if (privateKey.asymmetricKeyType !== "ed25519" || keyIdFor(privateKey) !== entry.keyId) throw new Error("Publisher release key identity mismatch");
    return { keyId: entry.keyId, signature: crypto.sign(null, Buffer.concat([DOMAIN, payload]), privateKey).toString("base64") };
  });
  const envelope = { schemaVersion: 1, payload: payload.toString("base64"), signatures };
  verifyReleaseMetadata(envelope, { repository: trust.repository, tag: env.GITHUB_REF_NAME, version: manifest.version });
  fs.writeFileSync(path.join(directory, "release-metadata.json"), `${JSON.stringify(envelope, null, 2)}\n`, { flag: "wx", mode: 0o644 });
}

if (require.main === module) {
  const env = { ...process.env };
  if (process.argv.includes("--offline")) {
    const { execFileSync } = require("node:child_process");
    env.GITHUB_ACTIONS = "false";
    env.GITHUB_REPOSITORY = trust.repository;
    env.GITHUB_REF_NAME = `v${manifest.version}`;
    env.GITHUB_SHA = execFileSync("git", ["rev-parse", "HEAD"], { cwd: path.resolve(__dirname, ".."), encoding: "utf8" }).trim();
    env.GITHUB_RUN_ID = "0";
  }
  signRelease(path.resolve(process.argv[2] || "release-assets"), env).catch(error => {
  // Do not print input/key objects or crypto error context from secret material.
  process.stderr.write(`Release signing failed: ${error.code ? "key material or file operation was invalid" : error.message}\n`);
  process.exitCode = 1;
  });
}
module.exports = { signRelease };
