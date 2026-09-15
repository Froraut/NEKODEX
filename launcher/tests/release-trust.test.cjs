const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DOMAIN, keyIdFor, validateTrust, verifyReleaseMetadata, verifyReleaseAsset } = require("../electron/release-trust.cjs");
const now = Date.parse("2026-09-11T12:00:00.000Z");
function fixture() {
  const keys = [crypto.generateKeyPairSync("ed25519"), crypto.generateKeyPairSync("ed25519")];
  const trust = { schemaVersion: 1, repository: "Froraut/NEKODEX", threshold: 1, keys: keys.map(({ publicKey }) => {
    const pem = publicKey.export({ type: "spki", format: "pem" });
    return { keyId: keyIdFor(pem), publicKey: pem, notBefore: "2026-01-01T00:00:00.000Z", notAfter: "2027-01-01T00:00:00.000Z" };
  }) };
  const payload = { schemaVersion: 1, repository: trust.repository, tag: "v5.1.0-froraut.1", version: "5.1.0-froraut.1",
    issuedAt: "2026-09-11T11:00:00.000Z", expiresAt: "2026-12-01T00:00:00.000Z",
    source: { commit: "a".repeat(40), workflow: ".github/workflows/release.yml", runId: "123", buildType: "github-actions" },
    assets: [{ name: "test.zip", size: 3, sha256: crypto.createHash("sha256").update("abc").digest("hex") }] };
  const options = { trust, now, repository: payload.repository, tag: payload.tag, version: payload.version };
  const sign = (value = payload, indexes = [0]) => {
    const bytes = Buffer.from(JSON.stringify(value));
    return { schemaVersion: 1, payload: bytes.toString("base64"), signatures: indexes.map(i => ({ keyId: trust.keys[i].keyId,
      signature: crypto.sign(null, Buffer.concat([DOMAIN, bytes]), keys[i].privateKey).toString("base64") })) };
  };
  return { keys, trust, payload, options, sign };
}

test("accepts authenticated metadata and verifies exact asset bytes", async () => {
  const f = fixture(); const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-trust-"));
  try {
    const metadata = verifyReleaseMetadata(JSON.stringify(f.sign()), f.options);
    const asset = path.join(dir, "test.zip"); fs.writeFileSync(asset, "abc");
    await verifyReleaseAsset(asset, { metadata });
    fs.writeFileSync(asset, "abd"); await assert.rejects(verifyReleaseAsset(asset, { metadata }), /checksum/);
    fs.writeFileSync(asset, "ab"); await assert.rejects(verifyReleaseAsset(asset, { metadata }), /size/);
    await assert.rejects(verifyReleaseAsset(asset, { metadata, assetName: "other.zip" }), /absent/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test("rejects asset replacement even if a release API/checksum manifest agrees", () => {
  const f = fixture(); const envelope = f.sign(); const payload = { ...f.payload, assets: [{ ...f.payload.assets[0], sha256: "b".repeat(64) }] };
  envelope.payload = Buffer.from(JSON.stringify(payload)).toString("base64");
  assert.throws(() => verifyReleaseMetadata(envelope, f.options), /signature/);
});
test("rejects unsigned metadata and an unknown signing key", () => {
  const f = fixture(); assert.throws(() => verifyReleaseMetadata(f.payload, f.options), /envelope/);
  const envelope = f.sign(); envelope.signatures[0].keyId = "f".repeat(64);
  assert.throws(() => verifyReleaseMetadata(envelope, f.options), /signature/);
});
test("binds fork repository, tag and version", () => {
  const f = fixture();
  for (const patch of [{ repository: "miuuyy/codex-chatgpt-web" }, { tag: "v5.0.0" }, { version: "5.0.0" }]) {
    assert.throws(() => verifyReleaseMetadata(f.sign({ ...f.payload, ...patch }), f.options), /identity/);
  }
});
test("rejects expiration, future issue dates and overlong metadata validity", () => {
  const f = fixture();
  for (const patch of [{ expiresAt: "2026-09-11T11:59:00.000Z" }, { issuedAt: "2026-09-12T11:00:00.000Z" }, { expiresAt: "2027-06-01T00:00:00.000Z" }]) {
    assert.throws(() => verifyReleaseMetadata(f.sign({ ...f.payload, ...patch }), f.options), /expired|validity/);
  }
});
test("rotation requires unique keys meeting threshold and trusts no downloaded roots", () => {
  const f = fixture(); f.trust.threshold = 2;
  const one = f.sign(); one.signatures.push(one.signatures[0]);
  assert.throws(() => verifyReleaseMetadata(one, f.options), /threshold/);
  assert.equal(verifyReleaseMetadata(f.sign(f.payload, [0, 1]), f.options).version, f.payload.version);
  f.trust.keys = f.trust.keys.slice(1); f.trust.threshold = 1;
  assert.throws(() => verifyReleaseMetadata(f.sign(f.payload, [0]), f.options), /signature/);
});
test("rejects missing, expired and mismatched packaged public keys", () => {
  const f = fixture();
  assert.throws(() => validateTrust({ ...f.trust, keys: [] }, now), /not been provisioned/);
  assert.throws(() => validateTrust(f.trust, Date.parse("2028-01-01")), /expired/);
  f.trust.keys[0].keyId = "0".repeat(64); assert.throws(() => validateTrust(f.trust, now), /Invalid/);
});
test("rejects metadata issued before the signing key became valid", () => {
  const f = fixture(); f.trust.keys[0].notBefore = "2026-09-11T11:30:00.000Z";
  assert.throws(() => verifyReleaseMetadata(f.sign(), f.options), /outside/);
});
test("rejects path traversal, duplicate names and invalid asset sizes", () => {
  const f = fixture();
  for (const assets of [[{ ...f.payload.assets[0], name: "../test.zip" }], [...f.payload.assets, ...f.payload.assets], [{ ...f.payload.assets[0], size: 0 }], [{ ...f.payload.assets[0], size: 2 ** 31 }]]) {
    assert.throws(() => verifyReleaseMetadata(f.sign({ ...f.payload, assets }), f.options), /asset/);
  }
});
test("rejects malformed base64 and bounds metadata before parsing", () => {
  const f = fixture(); const signed = f.sign();
  assert.throws(() => verifyReleaseMetadata({ ...signed, payload: `${signed.payload}\n` }, f.options), /base64/);
  assert.throws(() => verifyReleaseMetadata(" ".repeat(512 * 1024 + 1), f.options), /limit/);
});
test("requires the exact release workflow and a full commit reference", () => {
  const f = fixture();
  assert.throws(() => verifyReleaseMetadata(f.sign({ ...f.payload, source: { ...f.payload.source, commit: "main" } }), f.options), /provenance/);
  assert.throws(() => verifyReleaseMetadata(f.sign({ ...f.payload, source: { ...f.payload.source, workflow: ".github/workflows/ci.yml" } }), f.options), /provenance/);
});

test("local provenance is explicit and cannot claim a positive GitHub workflow run", () => {
  const f = fixture();
  const local = { ...f.payload, source: { ...f.payload.source, buildType: "local", runId: "0" } };
  assert.equal(verifyReleaseMetadata(f.sign(local), f.options).source.buildType, "local");
  assert.throws(() => verifyReleaseMetadata(f.sign({ ...local, source: { ...local.source, runId: "123" } }), f.options), /provenance/);
  assert.throws(() => verifyReleaseMetadata(f.sign({ ...local, source: { ...local.source, buildType: "github-actions" } }), f.options), /provenance/);
});
