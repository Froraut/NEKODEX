'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { StringDecoder } = require('node:string_decoder');
const { spawn, execFileSync } = require('node:child_process');
const { fail, digest, fileDigest, privateDirectory, regular, VERSION, SOURCE } = require('./owned-native-admission.cjs');
const { uuid } = require('./owned-native-journal.cjs');
const { createNativeAccountRecovery } = require('./native-account-recovery.cjs');
const URL = 'https://auth.openai.com/codex/device';
const ACTIVE = new Set(['prepared', 'running', 'pending', 'cancel-requested']);
const LOGIN_STATES = new Set([...ACTIVE, 'signed-in-checking', 'failed', 'cancelled', 'auth-outcome-unknown']);
const PROFILE_STATES = new Set(['fresh', 'login-pending', 'signed-in-checking', 'login-failed', 'cancelled', 'auth-outcome-unknown']);
const safeReason = value => typeof value === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(value);
const CONFIG = 'model_provider = "openai"\ncli_auth_credentials_store = "file"\ncheck_for_update_on_startup = false\nproject_root_markers = []\n';
const MAX_BYTES = 2 * 1024 * 1024;
const CONFIG_KEYS = new Set(['model', 'model_provider', 'model_catalog_json', 'sqlite_home', 'log_dir', 'approval_policy',
  'approvals_reviewer', 'sandbox_mode', 'thread_unload_delay_secs', 'web_search', 'notify', 'project_root_markers', 'project_doc_max_bytes',
  'include_environment_context', 'include_environment_context_time', 'check_for_update_on_startup', 'cli_auth_credentials_store',
  'features', 'tools', 'agents', 'memories', 'skills', 'cloud', 'analytics', 'feedback', 'history']);
function validateConfigText(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 65536 || /[\x00-\x08\x0b-\x1f\x7f]/u.test(text)) throw fail('invalid_profile_config', 'Native config must be bounded owner-generated nonsecret TOML');
  const values = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const match = line.match(/^([a-z][a-z0-9_]*) = (.+)$/);
    if (!match || !CONFIG_KEYS.has(match[1]) || values.has(match[1]) || /(?:^|[\s{,])"?(?:api_key|access_token|refresh_token|id_token|password|secret|env_key|http_headers|env_http_headers)"?\s*=/i.test(match[2])) throw fail('invalid_profile_config', 'Native config contains unsupported fields or credential input');
    values.set(match[1], match[2]);
  }
  if (values.has('thread_unload_delay_secs') && values.get('thread_unload_delay_secs') !== '0') {
    throw fail('invalid_profile_config', 'Native thread unload delay must retain the reviewed zero value');
  }
  if (values.get('model_provider') !== '"openai"' || values.get('cli_auth_credentials_store') !== '"file"'
    || values.get('project_root_markers') !== '[]') throw fail('invalid_profile_config', 'Native config must retain the reviewed official provider and profile closure');
}
function privateFile(file, max = MAX_BYTES) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid() || (stat.mode & 0o077) || stat.size > max) {
      throw fail('unsafe_profile_storage', 'Native account metadata must be a private owned regular file');
    }
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}
function authMetadata(p) {
  // lstat only. This parent never opens a credential file.
  let stat;
  try { stat = fs.lstatSync(path.join(p.codex, 'auth.json')); }
  catch { throw fail('native_auth_metadata_unavailable', 'Native CLI credential persistence requires reconciliation'); }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== process.getuid() || (stat.mode & 0o077)) {
    throw fail('unsafe_native_auth_metadata', 'Native CLI auth storage metadata is unsupported');
  }
  return { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs };
}

function absent(file) {
  try { fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return; throw fail('policy_probe_failed', 'Native policy could not be checked'); }
  throw fail('unsupported_startup_policy', 'External Native policy or profile inputs require explicit admission');
}
function policy() {
  for (const file of ['/etc/codex/config.toml', '/etc/codex/managed_config.toml', '/etc/codex/requirements.toml']) absent(file);
  let result;
  try {
    result = JSON.parse(execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e',
      "ObjC.import('CoreFoundation');const d=$('com.openai.codex');JSON.stringify({configForced:Boolean($.CFPreferencesAppValueIsForced($('config_toml_base64'),d)),requirementsForced:Boolean($.CFPreferencesAppValueIsForced($('requirements_toml_base64'),d))});"],
    { encoding: 'utf8', timeout: 5000, maxBuffer: 4096, env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }, stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch { throw fail('policy_probe_failed', 'Native managed policy could not be checked'); }
  if (typeof result?.configForced !== 'boolean' || typeof result?.requirementsForced !== 'boolean') throw fail('policy_probe_failed', 'Native managed policy metadata is unsupported');
  if (result.configForced || result.requirementsForced) throw fail('unsupported_startup_policy', 'Managed Native policy requires explicit admission');
}
/** Bounded transient decoder; deliberately returns only the pinned prompt's code. */
function devicePromptParser() {
  let bytes = 0, text = '', rejected = false, accepted = false;
  const decoder = new StringDecoder('utf8');
  return {
    push(chunk) {
      if (rejected) return null;
      bytes += Buffer.byteLength(chunk);
      if (bytes > 16384) { rejected = true; text = ''; return null; }
      text += decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const clean = text.replace(/\x1b\[[0-9;]*m/g, '').replace(/\r\n/g, '\n');
      if (/[\x00-\x08\x0b-\x1f\x7f\ufffd]/u.test(clean)) {
        // An ANSI sequence can straddle chunks. Await its tail, but never expose partial data.
        if (/\x1b(?:\[[0-9;]*)?$/.test(clean)) return undefined;
        rejected = true; text = ''; return null;
      }
      const match = clean.match(/^\s*Welcome to Codex \[v0\.163\.0\]\nOpenAI's command-line coding agent\n\nFollow these steps to sign in with ChatGPT using device code authorization:\n\n1\. Open this link in your browser and sign in to your account\n   https:\/\/auth\.openai\.com\/codex\/device\n\n2\. Enter this one-time code \(expires in 15 minutes\)\n   ([^\n]{1,128})\n\nContinue only if you started this login in Codex\. If a website or another person gave you this code, cancel\.\n\s*$/u);
      if (!match) { if (accepted) { rejected = true; text = ''; return null; } return undefined; }
      if (match[1].trim() !== match[1] || /\p{C}/u.test(match[1])) { rejected = true; text = ''; return null; }
      accepted = true; return { verificationUrl: URL, userCode: match[1] };
    },
    clear() { text = ''; rejected = true; },
  };
}
function writePrivate(file, bytes) {
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function createNativeAccountAuthority({ authorityHome, executable, executableSha256, sourceRevision = SOURCE,
  cliVersion = VERSION, stopGraceMs = 2000, onChange, recovery, testHooks = {} } = {}) {
  if (![authorityHome, executable].every(value => typeof value === 'string' && path.isAbsolute(value) && !/[\0\r\n]/.test(value))
    || !/^[a-f0-9]{64}$/.test(executableSha256 || '') || sourceRevision !== SOURCE || cliVersion !== VERSION) {
    throw fail('invalid_native_account_authority', 'Trusted Native account paths and official CLI pins are required');
  }
  authorityHome = path.resolve(authorityHome); executable = path.resolve(executable);
  const registryFile = path.join(authorityHome, 'registry.json'), lockFile = path.join(authorityHome, 'owner.lock');
  const owner = JSON.stringify({ pid: process.pid, nonce: randomUUID() });
  let owned = false, lastHash, destroyed = false, closing = false, destroying;
  const live = new Map(), profileOwners = new Map();
  const platform = testHooks.platform || process.platform;
  const recoveryOwner = recovery ? createNativeAccountRecovery({ ...recovery, authorityHome, executable, executableSha256,
    isBusy: () => owned || live.size > 0 || profileOwners.size > 0 || destroyed || closing,
    testHooks: testHooks.recovery || {} }) : null;
  const notify = () => { try { onChange?.(); } catch { /* Observation cannot invalidate a durable outcome. */ } };
  function ownerStatus() {
    try {
      const bytes = privateFile(lockFile, 4096).toString();
      if (owned && bytes === owner) return 'current';
      const row = JSON.parse(bytes);
      if (Number.isSafeInteger(row.pid) && row.pid > 0) {
        try { process.kill(row.pid, 0); } catch (error) { if (error.code === 'ESRCH') return 'stale'; }
      }
      return 'elsewhere-or-unverified';
    } catch (error) { return error.code === 'ENOENT' ? 'unclaimed' : 'elsewhere-or-unverified'; }
  }
  function read() {
    let bytes;
    try { bytes = privateFile(registryFile); }
    catch (error) { if (error.code === 'ENOENT') return { version: 1, source: SOURCE, cliVersion: VERSION, profiles: [], receipts: [] }; throw error; }
    let value;
    try { value = JSON.parse(bytes); } catch { throw fail('registry_unavailable', 'Native account metadata is invalid'); }
    if (value.version !== 1 || value.source !== SOURCE || value.cliVersion !== VERSION || !Array.isArray(value.profiles)
      || !Array.isArray(value.receipts) || value.profiles.length > 128 || value.receipts.length > 512) throw fail('registry_unavailable', 'Native account metadata does not match this authority');
    for (const profile of value.profiles) {
      uuid(profile.id); uuid(profile.epoch);
      if (profile.configSha256 !== undefined && !/^[a-f0-9]{64}$/.test(profile.configSha256)) throw fail('registry_unavailable', 'Native config metadata is invalid');
      if (!PROFILE_STATES.has(profile.state) || typeof profile.label !== 'string' || profile.label.length > 80 || /\p{C}/u.test(profile.label)) throw fail('registry_unavailable', 'Native profile metadata is invalid');
      if (profile.login) { uuid(profile.login.id); uuid(profile.login.actionId);
        if (!LOGIN_STATES.has(profile.login.state) || profile.login.reasonCode !== undefined && !safeReason(profile.login.reasonCode)) throw fail('registry_unavailable', 'Native login metadata is invalid'); }
    }
    for (const receipt of value.receipts) { uuid(receipt.actionId); uuid(receipt.profileId); uuid(receipt.epoch);
      if (!['prepare-profile', 'device-login', 'cancel-login', 'profile-config', 'remove-profile'].includes(receipt.kind) || typeof receipt.state !== 'string' || !safeReason(receipt.state.replaceAll('-', '_'))
        || receipt.reasonCode !== undefined && !safeReason(receipt.reasonCode)) throw fail('registry_unavailable', 'Native action metadata is invalid');
      if (receipt.loginAttemptId !== undefined) uuid(receipt.loginAttemptId);
      if (receipt.kind === 'profile-config' && ![receipt.beforeConfigSha256, receipt.candidateConfigSha256].every(value => /^[a-f0-9]{64}$/.test(value || ''))) throw fail('registry_unavailable', 'Native config transition metadata is invalid'); }
    const hash = digest(bytes);
    if (owned && lastHash !== undefined && hash !== lastHash) throw fail('registry_changed', 'Native account metadata changed outside its owner');
    lastHash = hash; return value;
  }
  function save(value) {
    if (!owned || privateFile(lockFile, 4096).toString() !== owner) throw fail('owner_changed', 'Native account storage ownership changed');
    let actual;
    try { actual = digest(privateFile(registryFile)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (actual !== lastHash) throw fail('registry_changed', 'Native account metadata changed outside its owner');
    const bytes = `${JSON.stringify(value)}\n`;
    if (Buffer.byteLength(bytes) > MAX_BYTES) throw fail('registry_quota', 'Native account receipt storage is full');
    const temporary = path.join(authorityHome, `${randomUUID()}.tmp`);
    let fd;
    try {
      fd = fs.openSync(temporary, 'wx', 0o600); fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      fs.renameSync(temporary, registryFile);
      const directory = fs.openSync(authorityHome, 'r'); try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
      lastHash = digest(bytes);
    } finally { if (fd !== undefined) fs.closeSync(fd); fs.rmSync(temporary, { force: true }); }
  }
  function acquire() {
    if (platform !== 'darwin') throw fail('mac_only', 'Native account mutation is currently available on macOS');
    if (destroyed || closing) throw fail('authority_destroyed', 'Native account owner is closed');
    recoveryOwner?.assertNotRecovering();
    if (owned) return;
    privateDirectory(authorityHome);
    if (fs.realpathSync(authorityHome) !== authorityHome) throw fail('unsafe_profile_storage', 'Native account storage must use a canonical owned path');
    try { fs.writeFileSync(lockFile, owner, { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code === 'EEXIST') throw fail('owner_reconciliation_required', 'Existing Native account ownership requires reconciliation'); throw error; }
    owned = true;
    const value = read(); let changed = false;
    for (const profile of value.profiles) if (profile.login && ACTIVE.has(profile.login.state)) {
      profile.login.state = 'auth-outcome-unknown'; profile.login.reasonCode = 'previous_owner_lost'; profile.state = 'auth-outcome-unknown';
      const receipt = value.receipts.find(row => row.actionId === profile.login.actionId);
      if (receipt) Object.assign(receipt, { state: 'auth-outcome-unknown', reasonCode: 'previous_owner_lost' });
      changed = true;
    }
    if (changed) save(value);
    settleRemovals();
  }
  function paths(profile) {
    const root = path.join(authorityHome, 'profiles', profile.id, 'epochs', profile.epoch);
    return { root, home: path.join(root, 'home'), codex: path.join(root, 'codex'), cwd: path.join(root, 'home', 'work'),
      tmp: path.join(root, 'home', 'tmp'), sqlite: path.join(root, 'sqlite'), config: path.join(root, 'codex', 'config.toml') };
  }
  function projectLogin(profile, ownerState) {
    if (!profile.login) return undefined;
    const row = { id: profile.login.id, actionId: profile.login.actionId, state: profile.login.state,
      ...(profile.login.reasonCode ? { reasonCode: profile.login.reasonCode } : {}), profileId: profile.id, epoch: profile.epoch };
    if (ACTIVE.has(row.state) && !live.has(row.id) && ['unclaimed', 'stale'].includes(ownerState)) {
      row.state = 'auth-outcome-unknown'; row.reasonCode = 'previous_owner_lost';
    }
    const prompt = live.get(row.id)?.prompt;
    if (row.state === 'pending' && prompt) Object.assign(row, prompt);
    return row;
  }
  function profileProjection(profile, state = ownerStatus()) {
    const login = projectLogin(profile, state);
    return { id: profile.id, profileId: profile.id, epoch: profile.epoch, label: profile.label,
      state: login?.state === 'auth-outcome-unknown' ? 'auth-outcome-unknown' : profile.state, ...(login ? { login } : {}) };
  }
  function inspect() {
    const value = read(), storageOwner = ownerStatus();
    return { available: platform === 'darwin' && !destroyed && !closing && !['stale', 'elsewhere-or-unverified'].includes(storageOwner),
      reasonCode: destroyed || closing ? 'authority_destroyed' : platform !== 'darwin' ? 'mac_only' : ['stale', 'elsewhere-or-unverified'].includes(storageOwner) ? 'owner_reconciliation_required' : null,
      profiles: value.profiles.map(profile => profileProjection(profile, storageOwner)),
      receipts: value.receipts.map(receipt => {
        const profile = value.profiles.find(row => row.id === receipt.profileId);
        const login = profile && projectLogin(profile, storageOwner);
        return receipt.kind === 'device-login' && login?.actionId === receipt.actionId ? { ...receipt, state: login.state, ...(login.reasonCode ? { reasonCode: login.reasonCode } : {}) } : { ...receipt };
      }), activeCount: live.size + profileOwners.size + (recoveryOwner?.activeCount() || 0), executionAvailable: false, storageOwner,
      recoverySupported: Boolean(recoveryOwner && platform === 'darwin') };
  }
  function intent(value, actionId, row) {
    uuid(actionId);
    if (value.receipts.some(receipt => receipt.actionId === actionId)) throw fail('intent_already_recorded', 'Native account actions cannot be replayed; inspect their receipt');
    if (value.receipts.length >= 512) throw fail('registry_quota', 'Native account receipt storage is full');
    value.receipts.push({ actionId, ...row });
  }
  function prepareProfile({ actionId, label } = {}) {
    uuid(actionId);
    if (typeof label !== 'string' || !label.trim() || label.trim().length > 80 || /\p{C}/u.test(label)) throw fail('invalid_profile_label', 'Use a plain Native account label of 1–80 characters');
    acquire(); const value = read();
    if (value.profiles.length >= 128) throw fail('registry_quota', 'Native profile storage is full');
    const profile = { id: randomUUID(), epoch: randomUUID(), label: label.trim(), state: 'fresh', configSha256: digest(CONFIG) };
    intent(value, actionId, { kind: 'prepare-profile', profileId: profile.id, epoch: profile.epoch, state: 'prepared' });
    save(value); // Intent precedes every physical profile write.
    const p = paths(profile);
    for (const directory of [path.join(authorityHome, 'profiles'), path.dirname(path.dirname(p.root)), path.dirname(p.root), p.root, p.home, p.codex, p.cwd, p.tmp, p.sqlite]) privateDirectory(directory);
    writePrivate(p.config, CONFIG);
    writePrivate(path.join(p.root, 'metadata.json'), `${JSON.stringify({ version: 1, profileId: profile.id, epoch: profile.epoch, source: SOURCE, cliVersion: VERSION, executableSha256 })}\n`);
    for (const directory of [p.codex, p.root, path.dirname(p.root), path.dirname(path.dirname(p.root)), path.join(authorityHome, 'profiles')]) {
      const fd = fs.openSync(directory, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    }
    value.profiles.push(profile); value.receipts.at(-1).state = 'completed'; save(value); notify(); return profileProjection(profile);
  }
  function metadataFor(profile) {
    return { version: 1, profileId: profile.id, epoch: profile.epoch, source: SOURCE, cliVersion: VERSION, executableSha256 };
  }
  function resolveProfile(profileId, epoch, profileOwner) {
    uuid(profileId); uuid(epoch); acquire();
    const holder = profileOwners.get(`${profileId}:${epoch}`);
    if (holder && holder !== profileOwner || profileOwner && holder !== profileOwner) throw fail('profile_owner_busy', 'Native profile has another live owner');
    const profile = read().profiles.find(row => row.id === profileId && row.epoch === epoch);
    if (!profile || profile.state !== 'signed-in-checking' || !profile.login || live.has(profile.login.id)) {
      throw fail('profile_not_settled', 'Native account inventory requires a settled signed-in-checking epoch');
    }
    reconcileConfig(profile);
    const p = paths(profile);
    for (const directory of [p.root, p.home, p.codex, p.cwd, p.tmp, p.sqlite]) {
      const stat = fs.lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077)) throw fail('unsafe_profile_storage', 'Native account paths are not owned private directories');
    }
    if (privateFile(path.join(p.root, 'metadata.json'), 16384).toString() !== `${JSON.stringify(metadataFor(profile))}\n`
      || digest(privateFile(p.config, 65536)) !== (profile.configSha256 || digest(CONFIG))) throw fail('profile_config_changed', 'Native profile metadata or expected configuration changed');
    // Metadata only: never open, parse, hash, export or copy CLI-owned auth content.
    const authStat = authMetadata(p);
    verifyExecutable();
    return Object.freeze({ profileId: profile.id, epoch: profile.epoch, root: p.root, home: p.home,
      codexHome: p.codex, sqliteHome: p.sqlite, cwd: p.cwd, tmp: p.tmp, config: p.config, authStat, configSha256: profile.configSha256 || digest(CONFIG), cliVersion: VERSION, sourceRevision: SOURCE });
  }
  function acquireProfileOwner({ profileId, epoch, actionId, kind } = {}) {
    uuid(profileId); uuid(epoch); uuid(actionId);
    if (!['inventory', 'execution'].includes(kind)) throw fail('unsupported_profile_owner', 'Only reviewed Native profile owners are supported');
    resolveProfile(profileId, epoch);
    const lease = Object.freeze({ id: randomUUID(), profileId, epoch, actionId, kind });
    profileOwners.set(`${profileId}:${epoch}`, lease); return lease;
  }
  function releaseProfileOwner(lease) {
    if (!lease || profileOwners.get(`${lease.profileId}:${lease.epoch}`) !== lease) throw fail('profile_owner_changed', 'Native profile owner does not match its exact lease');
    profileOwners.delete(`${lease.profileId}:${lease.epoch}`);
  }
  function reconcileConfig(profile) {
    const value = read(), stored = value.profiles.find(row => row.id === profile.id && row.epoch === profile.epoch);
    const pending = value.receipts.filter(row => row.kind === 'profile-config' && row.profileId === profile.id && row.epoch === profile.epoch && ['prepared', 'config-outcome-unknown'].includes(row.state));
    if (!pending.length) return;
    if (pending.length !== 1) throw fail('profile_config_unresolved', 'Native config has multiple unresolved transitions');
    const receipt = pending[0], actual = digest(privateFile(paths(profile).config, 65536));
    if (actual === receipt.candidateConfigSha256) {
      stored.configSha256 = actual; profile.configSha256 = actual; receipt.state = 'completed'; receipt.reasonCode = 'config_write_reconciled';
    } else if (actual === receipt.beforeConfigSha256) {
      stored.configSha256 = actual; profile.configSha256 = actual; receipt.state = 'failed'; receipt.reasonCode = 'config_write_not_committed';
    } else throw fail('profile_config_unresolved', 'Native config bytes do not match the recorded transition');
    save(value); notify();
  }
  function publishProfileConfig({ profileId, epoch, actionId, expectedConfigSha256, configText, profileOwner } = {}) {
    uuid(profileId); uuid(epoch); uuid(actionId); validateConfigText(configText);
    if (!/^[a-f0-9]{64}$/.test(expectedConfigSha256 || '')) throw fail('invalid_profile_config', 'Native config transition requires the exact expected SHA256');
    const p = resolveProfile(profileId, epoch, profileOwner); // Main-only; claims owner, settles pending config metadata, validates pins.
    if (p.configSha256 !== expectedConfigSha256) throw fail('profile_config_changed', 'Native config expectation changed before publication');
    const value = read(), profile = value.profiles.find(row => row.id === profileId && row.epoch === epoch);
    const candidateConfigSha256 = digest(configText);
    intent(value, actionId, { kind: 'profile-config', profileId, epoch, state: 'prepared',
      beforeConfigSha256: expectedConfigSha256, candidateConfigSha256 });
    save(value);
    const temporary = path.join(p.codexHome, `${randomUUID()}.config.tmp`);
    try {
      writePrivate(temporary, configText);
      if (digest(privateFile(p.config, 65536)) !== expectedConfigSha256) throw fail('profile_config_changed', 'Native config changed during publication');
      fs.renameSync(temporary, p.config);
      const directory = fs.openSync(p.codexHome, 'r'); try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
      testHooks.afterConfigRename?.();
      if (digest(privateFile(p.config, 65536)) !== candidateConfigSha256) throw fail('profile_config_changed', 'Native config readback differs from its intended bytes');
      profile.configSha256 = candidateConfigSha256;
      const receipt = value.receipts.find(row => row.actionId === actionId); receipt.state = 'completed'; save(value); notify();
      return Object.freeze({ actionId, profileId, epoch, configSha256: candidateConfigSha256, state: 'completed' });
    } catch (error) {
      const current = read(), receipt = current.receipts.find(row => row.actionId === actionId);
      receipt.state = 'config-outcome-unknown'; receipt.reasonCode = 'config_publication_requires_reconciliation';
      save(current); notify(); throw error;
    } finally { fs.rmSync(temporary, { force: true }); }
  }
  function verifyExecutable() {
    if (fileDigest(executable) !== executableSha256) throw fail('native_cli_pin_changed', 'Native official CLI executable pin changed');
    let metadata;
    try { metadata = JSON.parse(regular(path.join(path.dirname(path.dirname(executable)), 'codex-package.json'), 16384)); }
    catch { throw fail('unsupported_native_cli', 'Native official CLI package metadata is unavailable'); }
    if (metadata.version !== VERSION || metadata.layoutVersion !== 1 || metadata.entrypoint !== 'bin/codex' || metadata.variant !== 'codex'
      || !['aarch64-apple-darwin', 'x86_64-apple-darwin'].includes(metadata.target)) throw fail('unsupported_native_cli', 'Native login requires the pinned official CLI 0.163.0 layout');
  }
  function inspectLogin(id) {
    uuid(id); const profile = read().profiles.find(row => row.login?.id === id);
    if (!profile) throw fail('unknown_login', 'This Native login receipt does not exist');
    return projectLogin(profile, ownerStatus());
  }
  function updateLogin(id, state, reasonCode) {
    const value = read(), profile = value.profiles.find(row => row.login?.id === id);
    if (!profile) throw fail('unknown_login', 'Native login receipt is missing');
    profile.login.state = state;
    if (reasonCode) profile.login.reasonCode = reasonCode; else delete profile.login.reasonCode;
    profile.state = state === 'signed-in-checking' ? state : state === 'auth-outcome-unknown' ? state : state === 'failed' ? 'login-failed' : state === 'cancelled' ? 'cancelled' : 'login-pending';
    const receipt = value.receipts.find(row => row.actionId === profile.login.actionId);
    Object.assign(receipt, { state }); if (reasonCode) receipt.reasonCode = reasonCode; else delete receipt.reasonCode;
    save(value); notify();
  }
  function beginDeviceLogin({ profileId, epoch, actionId } = {}) {
    uuid(profileId); uuid(epoch); uuid(actionId);
    if (platform !== 'darwin') throw fail('mac_only', 'Native account login is currently available on macOS');
    acquire(); const value = read(), profile = value.profiles.find(row => row.id === profileId && row.epoch === epoch);
    if (!profile || profile.state !== 'fresh' || profile.login) throw fail('fresh_epoch_required', 'Device login requires a new unused physical profile epoch');
    if (live.size) throw fail('native_login_busy', 'Another owned Native device login is pending');
    const id = randomUUID();
    intent(value, actionId, { kind: 'device-login', profileId, epoch, loginAttemptId: id, state: 'prepared' });
    profile.login = { id, actionId, state: 'prepared' }; profile.state = 'login-pending'; save(value);
    let child, entry;
    try {
      verifyExecutable(); (testHooks.probePolicy || policy)(); const p = paths(profile);
      for (const directory of [p.root, p.home, p.codex, p.cwd, p.tmp, p.sqlite]) privateDirectory(directory);
      if (!privateFile(p.config, 16384).equals(Buffer.from(CONFIG))
        || privateFile(path.join(p.root, 'metadata.json'), 16384).toString() !== `${JSON.stringify(metadataFor(profile))}\n`) throw fail('profile_config_changed', 'Native base configuration or epoch metadata changed');
      // Login revokes existing selected-profile auth. Never even open that file.
      for (const name of fs.readdirSync(p.codex)) if (name !== 'config.toml') throw fail('fresh_epoch_required', 'Native login requires an untouched profile epoch');
      // Empty project markers make the official loader use this cwd as its project root.
      // Do not inspect the user's global .codex merely because it is a physical ancestor.
      absent(path.join(p.cwd, '.codex')); absent(path.join(p.cwd, '.env')); absent(path.join(p.codex, '.env'));
      const environment = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: p.home, CODEX_HOME: p.codex,
        CODEX_SQLITE_HOME: p.sqlite, TMPDIR: p.tmp, XDG_CONFIG_HOME: path.join(p.home, '.config'), XDG_CACHE_HOME: path.join(p.home, '.cache'),
        LANG: 'en_US.UTF-8', TERM: 'dumb' };
      child = (testHooks.spawn || spawn)(executable, ['login', '--device-auth'], { cwd: p.cwd, env: environment, stdio: ['ignore', 'pipe', 'pipe'], detached: true, windowsHide: true });
      let close;
      const settled = new Promise(resolve => { close = resolve; });
      entry = { child, settled, close, parser: devicePromptParser(), prompt: null, cancelRequested: false, stopTimer: null, hadError: false };
      live.set(id, entry);
      child.stdout?.on('data', chunk => {
        const prompt = entry.parser.push(chunk);
        if (entry.cancelRequested || entry.hadError) return;
        if (prompt === null) { entry.prompt = null; notify(); return; }
        if (prompt) { entry.prompt = prompt; try { if (inspectLogin(id).state !== 'pending') updateLogin(id, 'pending'); else notify(); } catch { entry.prompt = null; } }
      });
      // Drain, never retain or project CLI stderr (it may include account or secret material).
      child.stderr?.on('data', () => {});
      child.once('error', () => { entry.hadError = true; entry.prompt = null; entry.parser.clear(); try { updateLogin(id, 'auth-outcome-unknown', 'login_process_error'); } catch {} });
      child.once('close', (code, signal) => {
        if (entry.stopTimer) clearTimeout(entry.stopTimer);
        entry.prompt = null; entry.parser.clear();
        try {
          let authPersisted = false;
          if (code === 0 && !signal && !entry.hadError) { try { authMetadata(paths(profile)); authPersisted = true; } catch {} }
          const state = code === 0 && !signal && !entry.hadError && authPersisted ? 'signed-in-checking' : entry.cancelRequested || signal || entry.hadError || code === 0 ? 'auth-outcome-unknown' : 'failed';
          updateLogin(id, state, state === 'signed-in-checking' ? undefined : state === 'failed' ? 'native_login_failed' : 'login_outcome_requires_inventory');
        } catch { /* Keep durable nonterminal intent; passive restart projection preserves uncertainty. */ }
        live.delete(id); entry.close(); notify();
      });
      updateLogin(id, 'running');
    } catch (error) {
      if (child) { try { updateLogin(id, 'auth-outcome-unknown', 'owner_setup_failed_after_spawn'); } catch {} }
      else updateLogin(id, 'failed', safeReason(error.code) ? error.code : 'login_preflight_failed');
      throw error;
    }
    return inspectLogin(id);
  }
  function stop(id, entry) {
    if (entry.cancelRequested) return entry.settled;
    entry.cancelRequested = true; entry.prompt = null; entry.parser.clear();
    const kill = signal => {
      if (!Number.isSafeInteger(entry.child.pid) || entry.child.pid < 2) return;
      try { (testHooks.killGroup || ((pid, value) => process.kill(-pid, value)))(entry.child.pid, signal); }
      catch (error) { if (error.code !== 'ESRCH') { try { updateLogin(id, 'auth-outcome-unknown', 'cancel_signal_unverified'); } catch {} } }
    };
    kill('SIGTERM');
    entry.stopTimer = setTimeout(() => { if (live.get(id) === entry) kill('SIGKILL'); }, Math.max(10, Math.min(stopGraceMs, 10000)));
    return entry.settled;
  }
  async function cancelLogin({ loginAttemptId, actionId } = {}) {
    uuid(loginAttemptId); uuid(actionId); acquire(); const value = read();
    const profile = value.profiles.find(row => row.login?.id === loginAttemptId);
    if (!profile) throw fail('unknown_login', 'This Native login receipt does not exist');
    const entry = live.get(loginAttemptId);
    intent(value, actionId, { kind: 'cancel-login', profileId: profile.id, epoch: profile.epoch, loginAttemptId,
      state: entry ? 'cancel-requested' : 'settled' });
    if (entry) { profile.login.state = 'cancel-requested'; value.receipts.find(row => row.actionId === profile.login.actionId).state = 'cancel-requested'; }
    save(value); notify();
    if (entry) await stop(loginAttemptId, entry);
    const terminal = read(), receipt = terminal.receipts.find(row => row.actionId === actionId);
    receipt.state = 'settled'; save(terminal); notify(); return inspectLogin(loginAttemptId);
  }
  function profileRoot(profileId) { return path.join(authorityHome, 'profiles', profileId); }
  function erasePrivateProfile(profileId) {
    const root = profileRoot(profileId);
    let stat;
    try { stat = fs.lstatSync(root); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid()) throw fail('unsafe_profile_storage', 'Native profile storage is not an owned private directory');
    // rmSync never follows links; the CLI auth file is unlinked without being opened.
    fs.rmSync(root, { recursive: true, force: true });
    const fd = fs.openSync(path.dirname(root), 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
  function settleRemovals() {
    // The registry row leaves with the intent, so an interrupted erase is finished
    // by the next owner. No other owner can hold markers under a removed profile.
    const value = read(), pending = value.receipts.filter(row => row.kind === 'remove-profile' && row.state === 'prepared');
    if (!pending.length) return;
    for (const receipt of pending) {
      if (value.profiles.some(row => row.id === receipt.profileId)) throw fail('profile_removal_unresolved', 'Native profile removal metadata contradicts the registry');
      erasePrivateProfile(receipt.profileId); receipt.state = 'completed';
    }
    save(value); notify();
  }
  function profileSignedIn(profile) {
    if (profile.state === 'signed-in-checking') return true;
    // lstat only: a persisted CLI credential means the epoch may still be signed in.
    try { fs.lstatSync(path.join(paths(profile).codex, 'auth.json')); return true; }
    catch (error) { if (error.code === 'ENOENT') return false; return true; }
  }
  /** Every removal refusal, with no intent or erase. Returns whether the profile may hold a credential. */
  function checkRemovable({ profileId, epoch, confirmSignedIn = false, executionHeld = false } = {}) {
    uuid(profileId); uuid(epoch);
    if (typeof confirmSignedIn !== 'boolean' || typeof executionHeld !== 'boolean') throw fail('invalid_profile_removal', 'Native profile removal confirmation must be explicit');
    acquire(); const value = read(), profile = value.profiles.find(row => row.id === profileId && row.epoch === epoch);
    if (!profile) throw fail('unknown_profile', 'This Native profile epoch does not exist');
    if (profile.login && live.has(profile.login.id)) throw fail('native_login_busy', 'Cancel the Native device login before removing its profile');
    // A precheck may tolerate only the execution lease that main closes next; inventory always refuses.
    const lease = profileOwners.get(`${profileId}:${epoch}`);
    if (lease && !(executionHeld && lease.kind === 'execution')) throw fail('profile_owner_busy', 'Close the Native profile execution or inventory before removing it');
    const signedIn = profileSignedIn(profile);
    if (signedIn && !confirmSignedIn) throw fail('profile_signed_in', 'This Native profile is signed in; removal requires explicit confirmation');
    return { value, signedIn };
  }
  function removeProfile({ profileId, epoch, actionId, confirmSignedIn = false } = {}) {
    uuid(actionId);
    const { value } = checkRemovable({ profileId, epoch, confirmSignedIn }); // Never tolerates a held lease.
    intent(value, actionId, { kind: 'remove-profile', profileId, epoch, state: 'prepared' });
    // One atomic registry write retires the row, its earlier receipts and records the intent.
    value.profiles = value.profiles.filter(row => row.id !== profileId);
    value.receipts = value.receipts.filter(row => row.profileId !== profileId || row.actionId === actionId);
    save(value); notify();
    testHooks.afterRemovalIntent?.();
    settleRemovals();
    return Object.freeze({ actionId, profileId, epoch, state: 'completed' });
  }
  async function destroy() {
    if (destroyed) return;
    if (destroying) return destroying;
    closing = true; // Close new admission before awaiting existing physical children.
    destroying = (async () => {
      // Shutdown owns exact children and awaits close; it never logs out/revokes/deletes profiles.
      const settlements = await Promise.allSettled([recoveryOwner?.destroy(), ...[...live].map(([id, entry]) => {
        try { updateLogin(id, 'cancel-requested', 'owner_shutdown'); } catch {}
        return stop(id, entry);
      })]);
      const failed = settlements.find(row => row.status === 'rejected'); if (failed) throw failed.reason;
      if (profileOwners.size) throw fail('profile_owner_active', 'Native account cleanup awaits the inventory owner physical settlement');
      if (owned) { if (privateFile(lockFile, 4096).toString() !== owner) throw fail('owner_changed', 'Native account storage ownership changed during cleanup');
        fs.unlinkSync(lockFile); owned = false; }
      destroyed = true;
    })();
    try { await destroying; } finally { destroying = undefined; }
  }
  function guardedMutation(operation) {
    return input => {
      const annotate = error => {
        try { error.actionRecorded = read().receipts.some(receipt => receipt.actionId === input?.actionId); }
        catch { error.actionRecorded = true; } // Unreadable journal means uncertainty, never a retry claim.
        throw error;
      };
      try {
        const result = operation(input);
        return result && typeof result.then === 'function' ? result.catch(annotate) : result;
      } catch (error) { return annotate(error); }
    };
  }
  return Object.freeze({ inspect, snapshot: inspect, prepareProfile: guardedMutation(prepareProfile),
    beginDeviceLogin: guardedMutation(beginDeviceLogin), inspectLogin, removeProfile: guardedMutation(removeProfile),
    checkRemovable: input => { try { return { signedIn: checkRemovable(input).signedIn }; } catch (error) { error.actionRecorded = false; throw error; } }, cancelLogin: guardedMutation(cancelLogin), resolveProfile,
    publishProfileConfig: guardedMutation(publishProfileConfig), acquireProfileOwner, releaseProfileOwner,
    previewRecovery: () => recoveryOwner ? recoveryOwner.previewRecovery() : Promise.resolve({ state: 'blocked', reasonCode: 'recovery_unavailable', observedAt: Date.now(), markers: [], unsettledActionCount: 0 }),
    recoverOwner: input => { if (!recoveryOwner) { const error = fail('recovery_unavailable', 'Native owner recovery is unavailable'); error.actionRecorded = false; throw error; } return recoveryOwner.recoverOwner(input); },
    inspectRecovery: actionId => recoveryOwner?.inspectRecovery(actionId),
    currentOperation: () => recoveryOwner?.currentOperation() || (live.size ? 'device-login' : [...profileOwners.values()].some(lease => lease.kind === 'inventory') ? 'inventory' : null), destroy });
}
module.exports = { createNativeAccountAuthority };
