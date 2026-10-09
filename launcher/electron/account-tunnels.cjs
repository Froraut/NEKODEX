const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { validateAccountId } = require('./account-registry.cjs');
const { writePrivateFileAtomic } = require('./atomic-file.cjs');

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
    for (const field of ['binaryPath', 'runtimeKeyFile', 'profileDir']) {
      if (typeof tunnel[field] !== 'string' || !absolute(tunnel[field]) || /[\x00-\x1f]/.test(tunnel[field])) {
        throw new Error(`Account tunnel ${field} must be an absolute path`);
      }
    }
    for (const field of ['profileName', 'alias']) {
      if (typeof tunnel[field] !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(tunnel[field])) {
        throw new Error(`Account tunnel ${field} is invalid`);
      }
    }
    const owner = `${binding.accountId}:${mode}`;
    const profile = `${canonical(tunnel.profileDir)}:${tunnel.profileName}`;
    const key = canonical(tunnel.runtimeKeyFile);
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
  if (!binding) return { accountId, interactionMode: mode, status: 'unconfigured', ready: false };
  if (binding.principalFingerprint && principalFingerprint && binding.principalFingerprint !== principalFingerprint) {
    return { accountId, interactionMode: mode, tunnelId: binding.tunnel.tunnelId, status: 'error', ready: false,
      detail: 'This tunnel belongs to the previous sign-in. Configure the current account’s own tunnel.' };
  }
  const same = runtimeStatus?.tunnelId === binding.tunnel.tunnelId;
  const ready = same && runtimeStatus.ready === true;
  const status = same && ['starting', 'ready', 'stopped', 'error', 'unknown'].includes(runtimeStatus.status)
    ? runtimeStatus.status : 'unknown';
  return { accountId, interactionMode: mode, tunnelId: binding.tunnel.tunnelId,
    status: ready ? 'ready' : status, ready };
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
  reuseSavedCredentials = false, principalFingerprint }) {
  validateAccountId(accountId); interactionMode(mode);
  if (!/^tunnel_[a-f0-9]{32}$/.test(tunnelId || '')) throw new Error('Tunnel ID must be tunnel_ followed by 32 lowercase hexadecimal characters');
  const before = accountTunnelConfigSnapshot(configPath);
  const prior = accountTunnelFor(before.config, accountId, mode);
  const remaining = validateAccountTunnelBindings(before.config.accountTunnels)
    .filter(binding => binding.accountId !== accountId || binding.interactionMode !== mode);
  if (remaining.some(binding => binding.tunnel.tunnelId === tunnelId)) throw new Error('This tunnel already belongs to another account or interaction mode');
  let keyFile, created = false;
  // tunnel-client stores aliases globally, even when profile directories differ. Include
  // the application home so DEV's "default" account cannot occupy production's alias.
  const home = fs.realpathSync(coreHome);
  const owner = createHash('sha256').update(`${process.platform === 'win32' ? home.toLowerCase() : home}\0${accountId}\0${mode}`).digest('hex').slice(0, 24);
  if (reuseSavedCredentials) {
    if (!prior || prior.tunnel.tunnelId !== tunnelId || !fs.existsSync(prior.tunnel.runtimeKeyFile)) {
      throw new Error('This account has no saved key for this tunnel');
    }
    keyFile = prior.tunnel.runtimeKeyFile;
  } else {
    if (typeof runtimeKey !== 'string' || !runtimeKey.trim() || Buffer.byteLength(runtimeKey) > 65536) {
      throw new Error('A Tunnels Read + Use runtime key is required');
    }
    keyFile = path.join(coreHome, 'secrets', 'account-tunnels', `${owner}-${randomUUID()}.key`);
    writePrivateFileAtomic(keyFile, runtimeKey.trim(), { durable: true }); created = true;
  }
  const tunnel = { binaryPath: prior?.tunnel.binaryPath ?? before.config.tunnel?.binaryPath
      ?? path.join(coreHome, 'bin', process.platform === 'win32' ? 'tunnel-client.exe' : 'tunnel-client'),
    tunnelId, runtimeKeyFile: keyFile, profileDir: path.join(coreHome, 'tunnel', 'accounts', owner),
    profileName: `nekodex-${owner}`, alias: `nekodex-${owner}` };
  try {
    const binding = { accountId, interactionMode: mode, tunnel,
      ...(principalFingerprint ? { principalFingerprint } : {}) };
    const config = projectAccountTunnels(before.config, [...remaining, binding]);
    return { before, config, createdKey: created ? keyFile : undefined,
      createdKeyHash: created ? createHash('sha256').update(runtimeKey.trim()).digest('hex') : undefined,
      binding };
  } catch (error) {
    if (created) fs.rmSync(keyFile, { force: true });
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
module.exports = { interactionMode, validateAccountTunnelBindings, accountTunnelFor, accountTunnelView,
  projectAccountTunnels, accountTunnelConfigSnapshot, writeAccountTunnelConfig, prepareAccountTunnel, prepareRemoveAccountTunnel, commitAccountTunnel, discardAccountTunnel };
