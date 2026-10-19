'use strict';
// Main process only. Never expose this object or its records through IPC/logging.
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const VERSION = 1, LIMIT = 32 * 1024;
const REVISION = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/;
const CODES = new Set(['invalid-input', 'corrupt', 'conflict', 'locked', 'unavailable', 'unsupported']);
function fail(code) { throw Object.assign(new Error(`Protected OAuth vault ${CODES.has(code) ? code : 'unavailable'}`), { code: CODES.has(code) ? code : 'unavailable' }); }
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
function canonicalHome(home) {
  if (typeof home !== 'string' || !path.isAbsolute(home) || /[\x00-\x1f\x7f]/.test(home)) fail('invalid-input');
  let cursor = path.resolve(home); const missing = [];
  for (;;) {
    try { return path.join(fs.realpathSync.native(cursor), ...missing.reverse()); }
    catch (error) { if (error?.code !== 'ENOENT') fail('unavailable'); const parent = path.dirname(cursor);
      if (parent === cursor) fail('unavailable'); missing.push(path.basename(cursor)); cursor = parent; }
  }
}
function validUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) return false;
  try { const url = new URL(raw); return url.protocol === 'https:' && !url.username && !url.password && !url.hash && !url.search; } catch { return false; }
}
function validateScope(scope) {
  if (!exact(scope, ['kind', 'accountId', 'providerId', 'epoch', 'issuer', 'resource', 'clientId'])
    || scope.kind !== 'mcp-oauth' || typeof scope.accountId !== 'string' || !ID.test(scope.accountId)
    || typeof scope.providerId !== 'string' || !ID.test(scope.providerId)
    || !Number.isSafeInteger(scope.epoch) || scope.epoch < 1 || !validUrl(scope.issuer) || !validUrl(scope.resource)
    || typeof scope.clientId !== 'string' || !scope.clientId || scope.clientId.length > 2048 || /[\x00-\x20\x7f]/.test(scope.clientId)) fail('invalid-input');
}
function validRecord(record) {
  return exact(record, record?.refreshToken === undefined ? ['phase', 'accessToken', 'expiresAt'] : ['phase', 'accessToken', 'refreshToken', 'expiresAt'])
    && ['ready', 'refresh_pending', 'revocation_pending'].includes(record.phase)
    && typeof record.accessToken === 'string' && /^[\x21-\x7e]{1,8192}$/.test(record.accessToken)
    && (record.refreshToken === undefined || typeof record.refreshToken === 'string' && /^[\x21-\x7e]{1,8192}$/.test(record.refreshToken))
    && Number.isFinite(record.expiresAt) && record.expiresAt >= 0;
}
function scopeHash(home, scope) { validateScope(scope); return createHash('sha256').update(JSON.stringify([
  'nekodex-mcp-oauth-v1', home, scope.accountId, scope.providerId, scope.epoch, scope.issuer, scope.resource, scope.clientId,
])).digest('hex'); }
// Metadata only: this says the app-owned native port is present, never that a
// Keychain/Secret Service session is unlocked or an OAuth account is connected.
function helperMetadataAvailable(file, platform) {
  try {
    if (typeof file !== 'string' || !path.isAbsolute(file) || path.resolve(file) !== file
      || fs.realpathSync.native(file) !== file) return false;
    const info = fs.lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size < 1) return false;
    if (platform !== 'win32') {
      if ((info.mode & 0o111) === 0 || (info.mode & 0o022) !== 0) return false;
      if (typeof process.getuid === 'function' && info.uid !== process.getuid() && info.uid !== 0) return false;
    }
    fs.accessSync(file, platform === 'win32' ? fs.constants.R_OK : fs.constants.X_OK);
    return true;
  } catch { return false; }
}
function defaultHelperPath(platform, arch) {
  const leaf = path.join('oauth-vault-helper', `${platform}-${arch}`, `nekodex-oauth-vault-helper${platform === 'win32' ? '.exe' : ''}`);
  const candidates = [path.join(__dirname.replace(/app\.asar(?=[\\/])/, 'app.asar.unpacked'), leaf), path.join(__dirname, leaf), path.join(__dirname, '..', leaf)];
  return candidates.find(file => helperMetadataAvailable(file, platform)) ?? candidates[0];
}
function oauthProtectedVaultAvailable({ platform = process.platform, arch = process.arch, helperPath } = {}) {
  return ['darwin', 'win32', 'linux'].includes(platform) && ['arm64', 'x64'].includes(arch)
    && helperMetadataAvailable(helperPath ?? defaultHelperPath(platform, arch), platform);
}
function createNativeOAuthVaultBackend({ platform = process.platform, helperPath = defaultHelperPath(platform, process.arch) } = {}) {
  return Object.freeze({
    kind: { darwin: 'macos-keychain', win32: 'windows-credential-manager', linux: 'linux-secret-service' }[platform] ?? 'unsupported',
    request(payload) {
      if (!['darwin', 'win32', 'linux'].includes(platform)) return { version: VERSION, status: 'unsupported' };
      if (!helperMetadataAvailable(helperPath, platform)) fail('unavailable');
      // A missing packaged protected helper is unavailable. No shell, keychain CLI,
      // argv secret, process environment token, plaintext file or fallback backend.
      let result; try { result = spawnSync(helperPath, [], { input: JSON.stringify(payload), encoding: 'utf8',
        timeout: 10_000, maxBuffer: LIMIT, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], shell: false }); }
      catch { fail('unavailable'); }
      if (result.error || result.signal || result.status !== 0 || typeof result.stdout !== 'string' || Buffer.byteLength(result.stdout) > LIMIT) fail('unavailable');
      try { return JSON.parse(result.stdout); } catch { fail('corrupt'); }
    },
  });
}
function createOAuthProtectedVault({ coreHome, backend, platform = process.platform, helperPath } = {}) {
  const home = canonicalHome(coreHome), adapter = backend ?? createNativeOAuthVaultBackend({ platform, helperPath });
  if (typeof adapter?.request !== 'function') fail('invalid-input');
  async function request(payload) {
    let response; try { response = await adapter.request({ version: VERSION, ...payload }); }
    catch (error) { fail(error?.code); }
    if (!response || response.version !== VERSION || typeof response.status !== 'string') fail('corrupt');
    if (response.status !== 'ok' && response.status !== 'not-found') fail(response.status);
    return response;
  }
  return Object.freeze({
    async read(scope) {
      const hash = scopeHash(home, scope), response = await request({ operation: 'read', scopeHash: hash });
      if (response.status === 'not-found') return null;
      if (!exact(response.entry, ['scopeHash', 'revision', 'record']) || response.entry.scopeHash !== hash
        || !REVISION.test(response.entry.revision) || !validRecord(response.entry.record)) fail('corrupt');
      return { revision: response.entry.revision, record: { ...response.entry.record } };
    },
    async compareAndSet(scope, expectedRevision, record) {
      const hash = scopeHash(home, scope);
      if (expectedRevision !== null && (typeof expectedRevision !== 'string' || !REVISION.test(expectedRevision)) || !validRecord(record)) fail('invalid-input');
      const revision = randomUUID();
      const response = await request({ operation: 'compare-and-set', scopeHash: hash, expectedRevision,
        entry: { scopeHash: hash, revision, record: { ...record } } });
      if (response.status !== 'ok' || response.revision !== revision) fail(response.status === 'not-found' ? 'conflict' : 'corrupt');
      // Native successful CAS is the durable receipt. Never retry or delete after
      // timeout/unknown outcome; a read on this scope reconciles durable phase.
      return revision;
    },
    async remove(scope, expectedRevision) {
      const hash = scopeHash(home, scope);
      if (typeof expectedRevision !== 'string' || !REVISION.test(expectedRevision)) fail('invalid-input');
      const response = await request({ operation: 'remove', scopeHash: hash, expectedRevision });
      if (response.status !== 'ok' || response.removed !== true) fail(response.status === 'not-found' ? 'conflict' : 'corrupt');
    },
  });
}
module.exports = { createOAuthProtectedVault, createNativeOAuthVaultBackend, oauthProtectedVaultAvailable };
