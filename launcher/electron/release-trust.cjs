const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DOMAIN = Buffer.from("codex-web-gpt.release.v1\0", "utf8");
const MAX_METADATA_BYTES = 512 * 1024;
const MAX_LIFETIME_MS = 180 * 24 * 60 * 60 * 1000;
const MAX_ASSET_BYTES = 1024 * 1024 * 1024;
const defaultTrust = require("../release-trust.json");

function timestamp(value, name) {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) {
    throw new Error(`Release ${name} is invalid`);
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) throw new Error(`Release ${name} is invalid`);
  return time;
}

function base64(value, maxBytes) {
  if (typeof value !== "string" || value.length > Math.ceil(maxBytes / 3) * 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("Release metadata contains invalid base64");
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.length > maxBytes || decoded.toString("base64") !== value) throw new Error("Release metadata exceeds its limit");
  return decoded;
}

function keyIdFor(publicKey) {
  const key = crypto.createPublicKey(publicKey);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("Release keys must use Ed25519");
  return crypto.createHash("sha256").update(key.export({ type: "spki", format: "der" })).digest("hex");
}

function validateTrust(trust = defaultTrust, now = Date.now()) {
  if (trust?.schemaVersion !== 1 || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trust.repository || "")
    || !Number.isSafeInteger(trust.threshold) || trust.threshold < 1 || trust.threshold > 8
    || !Array.isArray(trust.keys) || trust.keys.length > 16) throw new Error("Invalid packaged release trust policy");
  if (trust.keys.length < trust.threshold) {
    throw new Error("Automatic updates are disabled: the publisher's verified release public key has not been provisioned in this build. See docs/release-signing.md.");
  }
  const keys = new Map();
  const seen = new Set();
  for (const entry of trust.keys) {
    if (typeof entry?.publicKey !== "string" || entry.publicKey.length > 1024
      || entry.keyId !== keyIdFor(entry.publicKey) || seen.has(entry.keyId)) throw new Error("Invalid or duplicate packaged release key");
    seen.add(entry.keyId);
    const notBefore = timestamp(entry.notBefore, "key notBefore");
    const notAfter = timestamp(entry.notAfter, "key notAfter");
    if (notAfter <= notBefore) throw new Error("Invalid release key validity interval");
    if (now >= notBefore && now < notAfter) keys.set(entry.keyId, { ...entry, notBefore, notAfter });
  }
  if (keys.size < trust.threshold) throw new Error("The packaged release keys have expired or are not active; install a publisher-verified current build manually.");
  return keys;
}

function verifyReleaseMetadata(input, { repository, tag, version, now = Date.now(), trust = defaultTrust } = {}) {
  const keys = validateTrust(trust, now);
  const text = typeof input === "string" ? input : Buffer.isBuffer(input) ? input.toString("utf8") : JSON.stringify(input);
  if (typeof text !== "string" || Buffer.byteLength(text) > MAX_METADATA_BYTES) throw new Error("Release metadata exceeds its limit");
  const envelope = JSON.parse(text);
  if (envelope?.schemaVersion !== 1 || !Array.isArray(envelope.signatures)
    || envelope.signatures.length < trust.threshold || envelope.signatures.length > 16) throw new Error("Invalid signed release metadata envelope");
  const payloadBytes = base64(envelope.payload, MAX_METADATA_BYTES);
  const signedBytes = Buffer.concat([DOMAIN, payloadBytes]);
  const verifiedKeys = new Set();
  for (const signature of envelope.signatures) {
    const key = keys.get(signature?.keyId);
    if (!key || verifiedKeys.has(signature.keyId)) continue;
    const decodedSignature = base64(signature.signature, 64);
    if (decodedSignature.length === 64 && crypto.verify(null, signedBytes, key.publicKey, decodedSignature)) verifiedKeys.add(signature.keyId);
  }
  if (verifiedKeys.size < trust.threshold) throw new Error("Release metadata signature does not meet the packaged publisher trust threshold");
  const payload = JSON.parse(payloadBytes.toString("utf8"));
  if (typeof version !== "string" || typeof tag !== "string" || typeof repository !== "string"
    || payload?.schemaVersion !== 1 || payload.repository !== repository || repository !== trust.repository
    || payload.tag !== tag || payload.version !== version || tag !== `v${version}`) throw new Error("Signed release identity does not match the requested fork/version");
  const issuedAt = timestamp(payload.issuedAt, "issuedAt");
  const expiresAt = timestamp(payload.expiresAt, "expiresAt");
  if (issuedAt > now + 5 * 60 * 1000 || expiresAt <= now || expiresAt <= issuedAt || expiresAt - issuedAt > MAX_LIFETIME_MS) {
    throw new Error("Signed release metadata is expired or has an invalid validity interval");
  }
  if ([...verifiedKeys].filter(id => issuedAt >= keys.get(id).notBefore && issuedAt < keys.get(id).notAfter).length < trust.threshold) {
    throw new Error("Release was issued outside the publisher key validity interval");
  }
  if (!/^[a-f0-9]{40}$/.test(payload.source?.commit || "") || !/^\d+$/.test(payload.source?.runId || "")
    || payload.source?.workflow !== ".github/workflows/release.yml"
    || !["github-actions", "local"].includes(payload.source?.buildType)
    || (payload.source.buildType === "local") !== (payload.source.runId === "0")) throw new Error("Signed release provenance identity is invalid");
  if (!Array.isArray(payload.assets) || payload.assets.length < 1 || payload.assets.length > 256) throw new Error("Invalid signed release asset list");
  const names = new Set();
  for (const asset of payload.assets) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(asset?.name || "") || asset.name === "release-metadata.json"
      || names.has(asset.name) || !Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > MAX_ASSET_BYTES
      || !/^[a-f0-9]{64}$/.test(asset.sha256 || "")) throw new Error("Invalid or duplicate signed release asset");
    names.add(asset.name);
  }
  return payload;
}

async function verifyReleaseAsset(assetPath, { metadata, assetName = path.basename(assetPath) } = {}) {
  const asset = metadata?.assets?.find(entry => entry.name === assetName);
  if (!asset) throw new Error("Asset is absent from authenticated release metadata");
  const info = fs.lstatSync(assetPath);
  if (!info.isFile() || info.isSymbolicLink() || info.size !== asset.size) throw new Error("Authenticated release asset size mismatch");
  const digest = crypto.createHash("sha256");
  for await (const bytes of fs.createReadStream(assetPath)) digest.update(bytes);
  if (digest.digest("hex") !== asset.sha256) throw new Error("Authenticated release asset checksum mismatch");
  return asset;
}

module.exports = { DOMAIN, MAX_METADATA_BYTES, MAX_LIFETIME_MS, MAX_ASSET_BYTES, keyIdFor, validateTrust, verifyReleaseMetadata, verifyReleaseAsset };
