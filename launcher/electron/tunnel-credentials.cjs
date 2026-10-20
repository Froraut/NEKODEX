// Secret-bearing APIs are internal launch/transaction ports. Never expose this
// provider, its records or resolve() return value over renderer/helper HTTP IPC.
const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID, timingSafeEqual } = require("node:crypto");
const { spawnSync } = require("node:child_process");

const VERSION = 1;
const MAX_PROTOCOL_BYTES = 24 * 1024;
const MAX_SECRET_BYTES = 8192;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const CODES = new Set(["locked", "unavailable", "not-found", "scope-mismatch", "corrupt", "unsupported", "conflict", "referenced", "owner-mismatch", "invalid-input", "owner-proof-required"]);
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

class CredentialProviderError extends Error {
  constructor(code) {
    const safeCode = CODES.has(code) ? code : "unavailable";
    super(`Protected tunnel credential ${safeCode}`);
    this.name = "CredentialProviderError";
    this.code = safeCode;
  }
}
function fail(code) { throw new CredentialProviderError(code); }
function isCredentialReference(value) {
  return exactKeys(value, ["version", "provider", "id", "revision"]) && value.version === VERSION
    && value.provider === "os-vault" && typeof value.id === "string" && UUID.test(value.id)
    && typeof value.revision === "string" && UUID.test(value.revision);
}
function isCredentialScope(value) {
  return exactKeys(value, ["accountId", "interactionMode", "tunnelId"])
    && typeof value.accountId === "string" && (["legacy", "default"].includes(value.accountId) || UUID.test(value.accountId))
    && ["automatic", "manual"].includes(value.interactionMode)
    && typeof value.tunnelId === "string" && /^tunnel_[a-f0-9]{32}$/.test(value.tunnelId);
}
function canonicalHome(coreHome) {
  if (typeof coreHome !== "string" || !coreHome || !path.isAbsolute(coreHome) || /[\u0000-\u001f\u007f]/.test(coreHome)) fail("invalid-input");
  // Resolve existing parent links even before a new DEV home has been created.
  let candidate = path.resolve(coreHome);
  const missing = [];
  for (;;) {
    try { return path.join(fs.realpathSync.native(candidate), ...missing.reverse()); }
    catch (error) {
      if (error?.code !== "ENOENT") fail("unavailable");
      const parent = path.dirname(candidate);
      if (parent === candidate) fail("unavailable");
      missing.push(path.basename(candidate)); candidate = parent;
    }
  }
}
function scopeHashForCanonicalHome(home, scope) {
  if (!isCredentialScope(scope)) fail("invalid-input");
  return createHash("sha256").update(JSON.stringify([VERSION, home, scope.accountId.toLowerCase(), scope.interactionMode, scope.tunnelId])).digest("hex");
}
function credentialScopeHash(coreHome, scope) { return scopeHashForCanonicalHome(canonicalHome(coreHome), scope); }
function sameReference(left, right) {
  return isCredentialReference(left) && isCredentialReference(right)
    && left.id.toLowerCase() === right.id.toLowerCase() && left.revision.toLowerCase() === right.revision.toLowerCase();
}
function secretValid(value) {
  return typeof value === "string" && value.length > 0 && Buffer.byteLength(value) <= MAX_SECRET_BYTES
    && !/[\u0000-\u0020\u007f]/.test(value);
}
function validRecord(record) {
  return exactKeys(record, ["version", "reference", "scopeHash", "owner", "secret"]) && record.version === VERSION
    && isCredentialReference(record.reference) && typeof record.scopeHash === "string" && HASH.test(record.scopeHash)
    && typeof record.owner === "string" && UUID.test(record.owner) && secretValid(record.secret);
}
function equalSecret(left, right) {
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function defaultHelperPath(platform, arch) {
  const binary = path.join(`${platform}-${arch}`, `nekodex-credential-helper${platform === "win32" ? ".exe" : ""}`);
  const candidates = [
    // Installed Electron: native executables must live outside app.asar.
    path.join(__dirname.replace(/app\.asar(?=[\\/])/, "app.asar.unpacked"), "credential-helper", binary),
    path.join(__dirname, "credential-helper", binary),
    // The Bun runtime bundle places the provider beside app/credential-helper.
    path.join(__dirname, "..", "credential-helper", binary),
  ];
  return candidates.find(candidate => { try { return fs.statSync(candidate).isFile(); } catch { return false; } }) ?? candidates[0];
}
function nativeBackend({ platform, helperPath }) {
  return {
    kind: platform === "darwin" ? "macos-keychain" : "unsupported",
    request(request) {
      if (platform !== "darwin") return { version: VERSION, status: "unsupported" };
      let result;
      try {
        const input = JSON.stringify(request);
        if (Buffer.byteLength(input) > MAX_PROTOCOL_BYTES) fail("invalid-input");
        // No shell, secret argv, inherited stdout/stderr, profile file or plaintext mirror.
        result = spawnSync(helperPath, [], { input, encoding: "utf8", timeout: 10_000,
          maxBuffer: MAX_PROTOCOL_BYTES, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      } catch (error) { if (error instanceof CredentialProviderError) throw error; fail("unavailable"); }
      if (result.error || result.signal || result.status !== 0 || typeof result.stdout !== "string"
        || Buffer.byteLength(result.stdout) > MAX_PROTOCOL_BYTES) fail("unavailable");
      try { return JSON.parse(result.stdout); } catch { fail("corrupt"); }
    },
  };
}

function createCredentialProvider({ coreHome, platform = process.platform, backend, helperPath } = {}) {
  const home = canonicalHome(coreHome);
  const adapter = backend ?? nativeBackend({ platform, helperPath: helperPath ?? defaultHelperPath(platform, process.arch) });
  if (!adapter || typeof adapter.request !== "function") fail("invalid-input");
  function request(payload) {
    let response;
    try { response = adapter.request({ version: VERSION, ...payload }); }
    catch (error) { if (error instanceof CredentialProviderError) throw error; fail("unavailable"); }
    if (!object(response) || response.version !== VERSION || typeof response.status !== "string") fail("corrupt");
    if (response.status !== "ok") fail(response.status);
    return response;
  }
  function read(reference, expectedScopeHash) {
    if (!isCredentialReference(reference)) fail("invalid-input");
    const result = request({ operation: "resolve", reference, scopeHash: expectedScopeHash });
    if (!validRecord(result.record) || !sameReference(reference, result.record.reference)) fail("corrupt");
    if (result.record.scopeHash !== expectedScopeHash) fail("scope-mismatch");
    return result.record;
  }
  function referenced(reference, currentReferences) {
    if (!Array.isArray(currentReferences) || !currentReferences.every(isCredentialReference)) fail("invalid-input");
    return currentReferences.some(candidate => sameReference(reference, candidate));
  }
  function removeOwned(reference, scopeHash, owner) {
    const response = request({ operation: "remove", reference, scopeHash, owner });
    if (response.removed !== true) fail("corrupt");
    return true;
  }
  function capabilities() {
    let status = "ok";
    try { request({ operation: "capabilities" }); }
    catch (error) { status = error instanceof CredentialProviderError ? error.code : "unavailable"; }
    return Object.freeze({ version: VERSION, provider: "os-vault", platform,
      backend: backend ? "injected" : platform === "darwin" ? "macos-keychain" : "unsupported",
      supported: Boolean(backend || platform === "darwin"), available: status === "ok", status,
      noninteractive: true, plaintextFallback: false });
  }
  function prepare(scope, secret) {
    if (!secretValid(secret)) fail("invalid-input");
    const scopeHash = scopeHashForCanonicalHome(home, scope);
    const reference = Object.freeze({ version: VERSION, provider: "os-vault", id: randomUUID(), revision: randomUUID() });
    const owner = randomUUID();
    const record = { version: VERSION, reference, scopeHash, owner, secret };
    const receipt = Object.freeze({ version: VERSION, reference,
      scope: Object.freeze({ ...scope }), scopeHash, owner });
    try {
      request({ operation: "prepare", record });
      // A successful put is not enough: prove exact scoped readback before handing
      // the immutable reference to the config transaction owner.
      const stored = read(reference, scopeHash);
      if (stored.owner !== owner || !equalSecret(secret, stored.secret)) fail("corrupt");
      return receipt;
    } catch (error) {
      // A timeout/readback error may follow a committed vault insert. Preserve an
      // exact, secret-free owner receipt for the transaction's recovery journal;
      // never retry a mutation or delete an uncertain record here.
      error.preparedReceipt = receipt;
      throw error;
    }
  }
  function resolve(reference, expectedScope) {
    return read(reference, scopeHashForCanonicalHome(home, expectedScope)).secret;
  }
  function discardPrepared(receipt, currentReferences) {
    if (!exactKeys(receipt, ["version", "reference", "scope", "scopeHash", "owner"]) || receipt.version !== VERSION
      || !isCredentialReference(receipt.reference) || !isCredentialScope(receipt.scope)
      || typeof receipt.scopeHash !== "string" || !HASH.test(receipt.scopeHash)
      || typeof receipt.owner !== "string" || !UUID.test(receipt.owner)) fail("invalid-input");
    if (scopeHashForCanonicalHome(home, receipt.scope) !== receipt.scopeHash) fail("scope-mismatch");
    if (referenced(receipt.reference, currentReferences)) return false;
    let record;
    try { record = read(receipt.reference, receipt.scopeHash); }
    catch (error) { if (error.code === "not-found") return false; throw error; }
    if (record.owner !== receipt.owner) fail("owner-mismatch");
    return removeOwned(receipt.reference, receipt.scopeHash, receipt.owner);
  }
  function retire(reference, expectedScope, proof) {
    if (!object(proof) || proof.ownerProof !== true) fail("owner-proof-required");
    if (!isCredentialReference(reference)) fail("invalid-input");
    if (referenced(reference, proof.currentReferences)) return false;
    let record;
    try { record = read(reference, scopeHashForCanonicalHome(home, expectedScope)); }
    catch (error) { if (error.code === "not-found") return false; throw error; }
    return removeOwned(reference, record.scopeHash, record.owner);
  }
  return Object.freeze({ prepare, resolve, discardPrepared, retire, remove: retire, capabilities });
}

module.exports = { createCredentialProvider, CredentialProviderError, isCredentialReference, isCredentialScope, credentialScopeHash };
