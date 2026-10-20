const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { validateAccountId } = require('./account-registry.cjs');
const { writePrivateFileAtomic } = require('./atomic-file.cjs');
const { createCredentialProvider, isCredentialReference } = require('./tunnel-credentials.cjs');

function tunnelCredentialReferences(config) {
  return [config?.tunnel, config?.automaticTunnel, config?.manualTunnel,
    ...(config?.accountTunnels ?? []).map(item => item.tunnel)]
    .map(tunnel => tunnel?.credential).filter(isCredentialReference);
}
function credentialScope(accountId, interactionMode, tunnelId) { return { accountId, interactionMode, tunnelId }; }
function persistCredentialRecovery(receipt, coreHome, configPath) {
  const recovery = path.join(coreHome, 'runtime', 'credential-recovery', `${receipt.reference.id}.json`);
  const safe = { version: receipt.version, reference: receipt.reference, scope: receipt.scope,
    scopeHash: receipt.scopeHash, owner: receipt.owner };
  writePrivateFileAtomic(recovery, JSON.stringify({ version: 1, receipt: safe, configPath }) + '\n', { durable: true });
}
function prepareCredential(provider, scope, secret, coreHome, configPath) {
  const directory = path.join(coreHome, 'runtime', 'credential-recovery');
  if (fs.existsSync(directory)) {
    for (const name of fs.readdirSync(directory)) {
      if (!/^(?:rollback-)?[a-f0-9-]{36}\.json$/i.test(name)) continue;
      const file = path.join(directory, name), stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024) throw new Error('Protected credential recovery journal needs inspection');
      const pending = JSON.parse(fs.readFileSync(file, 'utf8'));
      const pendingScope = pending.receipt?.scope ?? (pending.operation === 'outer-setup-rollback' ? pending.scope : undefined);
      if (pending?.configPath === configPath && pendingScope?.accountId === scope.accountId
        && pendingScope.interactionMode === scope.interactionMode && pendingScope.tunnelId === scope.tunnelId) {
        const error = new Error('Protected tunnel credential preparation requires recovery before another attempt');
        error.recoveryRequired = true; throw error;
      }
    }
  }
  try { return provider.prepare(scope, secret); }
  catch (error) {
    const receipt = error?.preparedReceipt;
    if (receipt && isCredentialReference(receipt.reference)) {
      // A native put may have committed before its readback failed. Retain the
      // exact owner receipt, never the key or a serialized native error.
      try { persistCredentialRecovery(receipt, coreHome, configPath); }
      catch { /* The error still carries the exact receipt for the operation owner. */ }
      error.recoveryRequired = true;
    }
    throw error;
  }
}
function validateTunnelCredential(tunnel, platform = process.platform) {
  const absolute = platform === 'win32' ? path.win32.isAbsolute : path.isAbsolute;
  const file = tunnel.runtimeKeyFile;
  if (tunnel.credential !== undefined) {
    if (file !== undefined || !isCredentialReference(tunnel.credential)) throw new Error('Tunnel credential reference is invalid or conflicts with a key file');
  } else if (typeof file !== 'string' || !absolute(file) || /[\x00-\x1f]/.test(file)) {
    throw new Error('Tunnel runtimeKeyFile must be an absolute path');
  }
  const pending = tunnel.legacyCredentialRetirement;
  if (pending !== undefined && (!tunnel.credential || pending?.version !== 1
    || typeof pending.path !== 'string' || !absolute(pending.path) || /[\x00-\x1f]/.test(pending.path)
    || !/^[a-f0-9]{64}$/.test(pending.sha256 ?? '')
    || !Number.isSafeInteger(pending.dev) || !Number.isSafeInteger(pending.ino))) {
    throw new Error('Legacy tunnel credential retirement receipt is invalid');
  }
}

function readLegacyCredential(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 65536
    || process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || process.getuid && stat.uid !== process.getuid())) {
    throw new Error('Legacy tunnel key must be a private regular file owned by this user');
  }
  const bytes = fs.readFileSync(file);
  const after = fs.lstatSync(file);
  if (stat.dev !== after.dev || stat.ino !== after.ino || stat.size !== after.size || stat.mtimeMs !== after.mtimeMs) {
    throw new Error('Legacy tunnel key changed during migration preparation');
  }
  return { secret: bytes.toString('utf8').trim(), retirement: { version: 1, path: file,
    sha256: createHash('sha256').update(bytes).digest('hex'), dev: stat.dev, ino: stat.ino } };
}

function interactionMode(value = 'automatic') {
  if (value !== 'automatic' && value !== 'manual') throw new Error('Tunnel interaction mode is invalid');
  return value;
}
function validateAccountTunnelBindings(value, platform = process.platform) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 64) throw new Error('Account tunnel bindings are invalid');
  const accounts = new Set(), ids = new Set(), profiles = new Set(), keys = new Set(), aliases = new Set();
  const absolute = platform === 'win32' ? path.win32.isAbsolute : path.isAbsolute;
  const canonical = value => platform === 'win32' ? path.win32.resolve(value).toLowerCase() : path.resolve(value);
  return value.map(binding => {
    if (!binding || typeof binding !== 'object' || Array.isArray(binding)) throw new Error('Account tunnel binding is invalid');
    validateAccountId(binding.accountId);
    const mode = interactionMode(binding.interactionMode), tunnel = binding.tunnel;
    if (!tunnel || typeof tunnel !== 'object' || Array.isArray(tunnel)
      || !/^tunnel_[a-f0-9]{32}$/.test(tunnel.tunnelId || '')) throw new Error('Account tunnel ID is invalid');
    for (const field of ['binaryPath', 'profileDir']) {
      if (typeof tunnel[field] !== 'string' || !absolute(tunnel[field]) || /[\x00-\x1f]/.test(tunnel[field])) {
        throw new Error(`Account tunnel ${field} must be an absolute path`);
      }
    }
    validateTunnelCredential(tunnel, platform);
    for (const field of ['profileName', 'alias']) {
      if (typeof tunnel[field] !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(tunnel[field])) {
        throw new Error(`Account tunnel ${field} is invalid`);
      }
    }
    const owner = `${binding.accountId}:${mode}`;
    const profile = `${canonical(tunnel.profileDir)}:${tunnel.profileName}`;
    const key = tunnel.credential ? `vault:${tunnel.credential.id.toLowerCase()}` : canonical(tunnel.runtimeKeyFile);
    if (accounts.has(owner) || ids.has(tunnel.tunnelId) || profiles.has(profile) || keys.has(key) || aliases.has(tunnel.alias)) {
      throw new Error('Each account and interaction mode needs its own tunnel, profile and key');
    }
    accounts.add(owner); ids.add(tunnel.tunnelId); profiles.add(profile); keys.add(key); aliases.add(tunnel.alias);
    if (binding.principalFingerprint !== undefined && (typeof binding.principalFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(binding.principalFingerprint))) {
      throw new Error('Account tunnel principal fingerprint is invalid');
    }
    return { accountId: binding.accountId, interactionMode: mode, tunnel: { ...tunnel },
      ...(binding.principalFingerprint ? { principalFingerprint: binding.principalFingerprint } : {}) };
  });
}
function accountTunnelFor(config, accountId, mode = config?.browserInteractionMode ?? 'automatic') {
  validateAccountId(accountId); interactionMode(mode);
  if (config?.accountTunnelMode !== true) return undefined;
  return validateAccountTunnelBindings(config.accountTunnels).find(item => item.accountId === accountId && item.interactionMode === mode);
}
function accountTunnelView(config, accountId, mode, runtimeStatus, principalFingerprint) {
  const binding = accountTunnelFor(config, accountId, mode);
  if (!binding) return { accountId, interactionMode: mode, status: 'unconfigured', ready: false,
    credentialStorage: 'unavailable', credentialMigrationPending: false };
  const credentialView = { credentialStorage: binding.tunnel.credential ? 'protected' : 'legacy',
    credentialMigrationPending: Boolean(binding.tunnel.legacyCredentialRetirement
      && fs.existsSync(binding.tunnel.legacyCredentialRetirement.path)) };
  if (binding.principalFingerprint && principalFingerprint && binding.principalFingerprint !== principalFingerprint) {
    return { accountId, interactionMode: mode, tunnelId: binding.tunnel.tunnelId, status: 'error', ready: false,
      ...credentialView, detail: 'This tunnel belongs to the previous sign-in. Configure the current account’s own tunnel.' };
  }
  const same = runtimeStatus?.tunnelId === binding.tunnel.tunnelId;
  const ready = same && runtimeStatus.ready === true;
  const status = same && ['starting', 'ready', 'stopped', 'error', 'unknown'].includes(runtimeStatus.status)
    ? runtimeStatus.status : 'unknown';
  // Keep the supervisor's cause (for example an OpenAI outage behind a running
  // tunnel) so admission and the account page can name it.
  const cause = same && !ready ? {
    ...(typeof runtimeStatus.reason === 'string' ? { reason: runtimeStatus.reason } : {}),
    ...(typeof runtimeStatus.detail === 'string' ? { detail: runtimeStatus.detail } : {}),
  } : {};
  return { accountId, interactionMode: mode, tunnelId: binding.tunnel.tunnelId,
    status: ready ? 'ready' : status, ready, ...cause, ...credentialView };
}
function projectAccountTunnels(config, bindings) {
  const next = { ...config, accountTunnelMode: true, accountTunnels: validateAccountTunnelBindings(bindings) };
  const active = next.accountTunnels.find(binding => binding.interactionMode === next.browserInteractionMode);
  if (active) {
    next.mode = 'full'; next.tunnel = active.tunnel;
    next.automaticTunnel = next.accountTunnels.find(binding => binding.interactionMode === 'automatic')?.tunnel;
    next.manualTunnel = next.accountTunnels.find(binding => binding.interactionMode === 'manual')?.tunnel;
  }
  return next;
}

/** Captures exact config bytes and resolves the managed generation link instead of replacing it. */
function accountTunnelConfigSnapshot(configPath) {
  const actual = fs.realpathSync(configPath);
  const bytes = fs.readFileSync(actual);
  return { configPath, path: actual, bytes, config: JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')) };
}
function writeAccountTunnelConfig(snapshot, config) {
  if (fs.realpathSync(snapshot.configPath) !== snapshot.path || !fs.readFileSync(snapshot.path).equals(snapshot.bytes)) throw new Error('Runtime configuration changed; retry the account tunnel change');
  const bytes = Buffer.from(`${JSON.stringify(config, null, 2)}\n`);
  writePrivateFileAtomic(snapshot.path, bytes, { durable: true });
  return { ...snapshot, bytes, config };
}

function prepareAccountTunnel({ coreHome, configPath, accountId, mode = 'automatic', tunnelId, runtimeKey,
  reuseSavedCredentials = false, migrateSavedCredentials = false, principalFingerprint,
  credentialStorage = 'os-vault',
  credentialProvider = createCredentialProvider({ coreHome }) }) {
  validateAccountId(accountId); interactionMode(mode);
  if (!['os-vault', 'legacy-file'].includes(credentialStorage)) throw new Error('Tunnel credential storage choice is invalid');
  if (!/^tunnel_[a-f0-9]{32}$/.test(tunnelId || '')) throw new Error('Tunnel ID must be tunnel_ followed by 32 lowercase hexadecimal characters');
  const before = accountTunnelConfigSnapshot(configPath);
  const prior = accountTunnelFor(before.config, accountId, mode);
  const remaining = validateAccountTunnelBindings(before.config.accountTunnels)
    .filter(binding => binding.accountId !== accountId || binding.interactionMode !== mode);
  if (remaining.some(binding => binding.tunnel.tunnelId === tunnelId)) throw new Error('This tunnel already belongs to another account or interaction mode');
  let credential, keyFile, preparedCredential, legacyCredentialRetirement, createdKeyHash;
  const scope = credentialScope(accountId, mode, tunnelId);
  // tunnel-client stores aliases globally, even when profile directories differ. Include
  // the application home so DEV's "default" account cannot occupy production's alias.
  const home = fs.realpathSync(coreHome);
  const owner = createHash('sha256').update(`${process.platform === 'win32' ? home.toLowerCase() : home}\0${accountId}\0${mode}`).digest('hex').slice(0, 24);
  if (migrateSavedCredentials) {
    if (!prior || prior.tunnel.tunnelId !== tunnelId) throw new Error('This account has no saved tunnel to migrate');
    if (prior.tunnel.credential) {
      credentialProvider.resolve(prior.tunnel.credential, scope);
      credential = prior.tunnel.credential;
      legacyCredentialRetirement = prior.tunnel.legacyCredentialRetirement;
    } else {
      const legacy = readLegacyCredential(prior.tunnel.runtimeKeyFile);
      preparedCredential = prepareCredential(credentialProvider, scope, legacy.secret, coreHome, configPath);
      credential = preparedCredential.reference;
      legacyCredentialRetirement = legacy.retirement;
    }
  } else if (reuseSavedCredentials) {
    if (!prior || prior.tunnel.tunnelId !== tunnelId) {
      throw new Error('This account has no saved key for this tunnel');
    }
    if (prior.tunnel.credential) {
      credentialProvider.resolve(prior.tunnel.credential, scope);
      credential = prior.tunnel.credential;
      legacyCredentialRetirement = prior.tunnel.legacyCredentialRetirement;
    } else {
      if (!fs.existsSync(prior.tunnel.runtimeKeyFile)) throw new Error('This account has no saved key for this tunnel');
      keyFile = prior.tunnel.runtimeKeyFile;
    }
  } else {
    if (typeof runtimeKey !== 'string' || !runtimeKey.trim() || Buffer.byteLength(runtimeKey) > 65536) {
      throw new Error('A Tunnels Read + Use runtime key is required');
    }
    if (credentialStorage === 'legacy-file') {
      keyFile = path.join(coreHome, 'secrets', 'account-tunnels', `${owner}-${randomUUID()}.key`);
      writePrivateFileAtomic(keyFile, runtimeKey.trim(), { durable: true });
      createdKeyHash = createHash('sha256').update(runtimeKey.trim()).digest('hex');
    } else {
      preparedCredential = prepareCredential(credentialProvider, scope, runtimeKey.trim(), coreHome, configPath);
      credential = preparedCredential.reference;
    }
  }
  const tunnel = { ...(migrateSavedCredentials ? prior.tunnel : {}), binaryPath: prior?.tunnel.binaryPath ?? before.config.tunnel?.binaryPath
      ?? path.join(coreHome, 'bin', process.platform === 'win32' ? 'tunnel-client.exe' : 'tunnel-client'),
    tunnelId, ...(credential ? { credential } : { runtimeKeyFile: keyFile }), profileDir: migrateSavedCredentials ? prior.tunnel.profileDir : path.join(coreHome, 'tunnel', 'accounts', owner),
    profileName: migrateSavedCredentials ? prior.tunnel.profileName : `nekodex-${owner}`, alias: migrateSavedCredentials ? prior.tunnel.alias : `nekodex-${owner}`,
    ...(legacyCredentialRetirement ? { legacyCredentialRetirement } : {}) };
  if (credential) delete tunnel.runtimeKeyFile;
  try {
    const binding = { accountId, interactionMode: mode, tunnel,
      ...(principalFingerprint ? { principalFingerprint } : {}) };
    const config = projectAccountTunnels(before.config, [...remaining, binding]);
    return { before, config, preparedCredential, credentialProvider, coreHome, binding,
      ...(createdKeyHash ? { createdKey: keyFile, createdKeyHash } : {}) };
  } catch (error) {
    if (preparedCredential) discardAccountTunnel({ before, preparedCredential, credentialProvider, coreHome });
    if (createdKeyHash) fs.rmSync(keyFile, { force: true });
    throw error;
  }
}
function prepareRemoveAccountTunnel({ configPath, accountId, mode = 'automatic' }) {
  validateAccountId(accountId); interactionMode(mode);
  const before = accountTunnelConfigSnapshot(configPath);
  const bindings = validateAccountTunnelBindings(before.config.accountTunnels)
    .filter(binding => binding.accountId !== accountId || binding.interactionMode !== mode);
  // Key bytes and old profiles stay available for recovery; removal retires only the binding.
  return { before, config: projectAccountTunnels(before.config, bindings) };
}
function commitAccountTunnel(change) { return writeAccountTunnelConfig(change.before, change.config); }
function discardAccountTunnel(change) {
  if (change?.preparedCredential) {
    try { change.credentialProvider.discardPrepared(change.preparedCredential,
      tunnelCredentialReferences(accountTunnelConfigSnapshot(change.before.configPath).config)); }
    catch {
      try { persistCredentialRecovery(change.preparedCredential, change.coreHome, change.before.configPath); }
      catch { /* Uncertain configuration ownership preserves the prepared secret. */ }
    }
    return;
  }
  if (!change?.createdKey) return;
  try {
    const current = accountTunnelConfigSnapshot(change.before.configPath).config;
    if (current.accountTunnels?.some(binding => binding.tunnel.runtimeKeyFile === change.createdKey)) return;
    const stat = fs.lstatSync(change.createdKey);
    if (!stat.isFile() || stat.isSymbolicLink()) return;
    const hash = createHash('sha256').update(fs.readFileSync(change.createdKey)).digest('hex');
    if (hash === change.createdKeyHash) fs.unlinkSync(change.createdKey);
  } catch { /* Uncertain ownership is preserved for recovery. */ }
}

// Called only after the runtime owner proves a fresh exact-reference process and
// its SDK profile selector. No await separates the config/file ownership checks.
function retireMigratedAccountTunnel({ configPath, accountId, mode, reference, verified }) {
  if (verified !== true) return false;
  const snapshot = accountTunnelConfigSnapshot(configPath);
  const binding = accountTunnelFor(snapshot.config, accountId, mode);
  if (!binding || JSON.stringify(binding.tunnel.credential) !== JSON.stringify(reference)) return false;
  const pending = binding.tunnel.legacyCredentialRetirement;
  if (!pending) return true;
  const tunnels = [snapshot.config.tunnel, snapshot.config.automaticTunnel, snapshot.config.manualTunnel,
    ...(snapshot.config.accountTunnels ?? []).map(item => item.tunnel)];
  if (tunnels.some(item => item?.runtimeKeyFile && path.resolve(item.runtimeKeyFile) === path.resolve(pending.path))) return false;
  if (fs.existsSync(pending.path)) {
    const current = readLegacyCredential(pending.path).retirement;
    if (JSON.stringify(current) !== JSON.stringify(pending)) return false;
    // Recheck the captured generation before removing this exact retired file.
    if (fs.realpathSync(configPath) !== snapshot.path || !fs.readFileSync(snapshot.path).equals(snapshot.bytes)) return false;
    fs.unlinkSync(pending.path);
  }
  // Keep the nonsecret receipt with the committed binding. Clearing it would
  // change the live peer's config identity solely for housekeeping. Absence of
  // the exact retired file settles it without another runtime/config mutation.
  return true;
}
module.exports = { interactionMode, validateAccountTunnelBindings, accountTunnelFor, accountTunnelView,
  projectAccountTunnels, accountTunnelConfigSnapshot, writeAccountTunnelConfig, prepareAccountTunnel, prepareRemoveAccountTunnel, commitAccountTunnel, discardAccountTunnel,
  validateTunnelCredential, tunnelCredentialReferences, retireMigratedAccountTunnel };
