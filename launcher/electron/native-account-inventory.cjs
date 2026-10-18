'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');
const { DETACH_OWNED_CHILD, terminateOwnedProcessTree } = require('./process-tree.cjs');
const { fail, digest, fileDigest, canonical, plain, privateDirectory, regular, VERSION, SOURCE,
  verifyWrapper, probeManagedPreferences, DISABLED_FEATURES, toml, contains, absent } = require('./owned-native-admission.cjs');
const { uuid } = require('./owned-native-journal.cjs');
const METHODS = new Set(['initialize', 'config/read', 'configRequirements/read', 'account/read', 'account/rateLimits/read', 'model/list']);
const MAX_LINE = 2 * 1024 * 1024, MAX_CACHE = 8 * 1024 * 1024;
const BOOTSTRAP_SHA = '943ca7fe1d19ed019054158303f0dbbd80b3bef43b3aa425a71aa7cb3fb52c2b';
const CLASSIFIER_SANDBOX = '(version 1)(allow default)(deny network*)(deny process-fork)';
const clone = value => JSON.parse(JSON.stringify(value));
const reasonCode = error => /^[a-z][a-z0-9_]{0,79}$/.test(error?.code || '') ? error.code : 'inventory_failed';
function authStat(p) {
  // Metadata only. Credential bytes never enter this owner.
  const s = fs.lstatSync(path.join(p.codexHome, 'auth.json'));
  if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.uid !== process.getuid() || (s.mode & 0o077)) throw fail('unsafe_auth_metadata', 'Native auth storage is not private');
  return canonical({ dev: s.dev, ino: s.ino, size: s.size, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs });
}
function boundedPrivate(file, max, modeMask = 0o077, normalizePrivate = false) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try { const s = fs.fstatSync(fd);
    if (!s.isFile() || s.nlink !== 1 || s.uid !== process.getuid() || (s.mode & modeMask) || s.size > max) throw fail('unsafe_inventory_storage', 'Native inventory storage is unsupported');
    if (normalizePrivate && (s.mode & 0o077)) fs.fchmodSync(fd, 0o600);
    const bytes = fs.readFileSync(fd), after = fs.fstatSync(fd);
    if (after.size !== s.size || after.mtimeMs !== s.mtimeMs || !normalizePrivate && after.ctimeMs !== s.ctimeMs) throw fail('inventory_changed', 'Native inventory bytes changed during read');
    return bytes;
  } finally { fs.closeSync(fd); }
}
function configFor(p, catalogPath) {
  return { model_provider: 'openai', ...(catalogPath ? { model_catalog_json: catalogPath } : {}), sqlite_home: p.sqliteHome,
    log_dir: path.join(p.root, 'log'), approval_policy: 'never', approvals_reviewer: 'user', sandbox_mode: 'read-only',
    web_search: 'disabled', notify: [], project_root_markers: [], project_doc_max_bytes: 0,
    include_environment_context: false, include_environment_context_time: false, check_for_update_on_startup: false,
    cli_auth_credentials_store: 'file', features: Object.fromEntries([...DISABLED_FEATURES.map(key => [key, false]), ['skip_host_skill_discovery', true]]),
    tools: { update_plan: { enabled: false }, experimental_request_user_input: { enabled: false } }, agents: { enabled: false },
    memories: { use_memories: false, generate_memories: false }, skills: { include_instructions: false, bundled: { enabled: false } },
    cloud: { skills: { enabled: false } }, analytics: { enabled: false }, feedback: { enabled: false }, history: { persistence: 'none' } };
}
function effective(read, requirements, expected, p) {
  if (!plain(read?.config) || !Array.isArray(read.layers) || !plain(requirements) || !Object.hasOwn(requirements, 'requirements')
    || requirements.requirements !== null && (!plain(requirements.requirements) || Object.values(requirements.requirements).some(v => v !== null))) {
    throw fail('unsupported_effective_policy', 'Native requirements require separate admission');
  }
  for (const [key, value] of Object.entries(expected)) if (key !== 'tools' && !contains(read.config[key], value)) throw fail('unsupported_effective_policy', 'Native effective policy differs');
  if (read.config.model_providers != null && Object.keys(read.config.model_providers).length || read.config.chatgpt_base_url != null
    && !['https://chatgpt.com/backend-api', 'https://chatgpt.com/backend-api/'].includes(read.config.chatgpt_base_url)
    || read.config.tools != null && (!plain(read.config.tools) || read.config.tools.web_search != null)) throw fail('unsupported_effective_policy', 'Native auth/provider/tool route differs');
  for (const layer of read.layers) {
    if (!plain(layer?.name) || !plain(layer.config) || layer.disabledReason != null) throw fail('unsupported_effective_policy', 'Native config layer differs');
    if (['system', 'project'].includes(layer.name.type) && !Object.keys(layer.config).length) continue;
    if (layer.name.type === 'packagedDefaults') continue;
    if (layer.name.type === 'user' && layer.name.file === p.config && layer.name.profile == null && canonical(layer.config) === canonical(expected)) continue;
    throw fail('unsupported_effective_policy', 'Native config source requires separate admission');
  }
}
function accountDescriptor(response) {
  const a = response?.account;
  if (!plain(a) || a.type !== 'chatgpt' || a.planType !== 'pro' || a.email !== null && typeof a.email !== 'string'
    || typeof a.email === 'string' && (a.email.length > 320 || /\p{C}/u.test(a.email))) throw fail('unsupported_account', 'Native account is not supported personal Pro');
  return { type: 'chatgpt', planType: 'pro', email: a.email };
}
function usageProjection(value) {
  if (!plain(value) || typeof value.ordinaryUsageAllowed !== 'boolean' || typeof value.accountId !== 'string' || !value.accountId
    || value.accountId.length > 512 || /\p{C}/u.test(value.accountId)) throw fail('active_identity_unavailable', 'Native active account match is unavailable');
  if (!value.ordinaryUsageAllowed) throw fail('ordinary_usage_denied', 'Native ordinary included usage is unavailable');
  if (Buffer.byteLength(JSON.stringify({rateLimits:value.rateLimits,rateLimitsByLimitId:value.rateLimitsByLimitId})) > 65536) throw fail('usage_metadata_oversized', 'Native usage metadata exceeded bound');
  // Arbitrary upsell payloads are deliberately excluded.
  return { accountId: value.accountId, ordinaryUsageAllowed: true, identityConfidence: 'native-active-account-match',
    rateLimits: value.rateLimits ?? null, rateLimitsByLimitId: value.rateLimitsByLimitId ?? null };
}
// Single writer, fixed methods, one outstanding request. Never exported as generic RPC.
function childOwner({ executable, args, p, spawnProcess, terminateProcess, timeoutMs, stopGraceMs, classifier }) {
  let child, closed = false, closePromise, resolveClosed, pending, nextId = 1, buffer = '', total = 0, classifierText = '', fault;
  const decoder = new StringDecoder('utf8'); closePromise = new Promise(resolve => { resolveClosed = resolve; });
  function reject(error) { fault ||= error; if (pending) { clearTimeout(pending.timer); pending.reject(error); pending = null; } }
  function write(value) { if (closed || fault) throw fault || fail('client_closed', 'Native inventory owner is closed'); child.stdin.write(JSON.stringify(value) + '\n'); }
  function receive(chunk) {
    const text = decoder.write(chunk); total += Buffer.byteLength(text);
    if (classifier) { if (total > 4096) reject(fail('classifier_invalid', 'Native classifier output exceeded bound')); else classifierText += text; return; }
    buffer += text;
    if (Buffer.byteLength(buffer) > MAX_LINE) { reject(fail('response_too_large', 'Native inventory output exceeded bound')); return; }
    for (;;) { const end = buffer.indexOf('\n'); if (end < 0) break; const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); if (!line.trim()) continue;
      let v; try { v = JSON.parse(line); } catch { reject(fail('invalid_response', 'Native inventory output is invalid')); return; }
      if (!plain(v)) { reject(fail('invalid_response', 'Native inventory envelope is invalid')); return; }
      if (v.method) { if (Object.hasOwn(v, 'id')) reject(fail('unsupported_server_request', 'Native requested client authority')); continue; }
      if (!pending || v.id !== pending.id) { reject(fail('invalid_response', 'Native inventory response has no owned request')); return; }
      const row = pending; pending = null; clearTimeout(row.timer);
      if (Object.hasOwn(v, 'result')) row.resolve(v.result); else row.reject(fail('rpc_rejected', 'Native inventory request was rejected'));
    }
  }
  function start() {
    child = spawnProcess(executable, args, { cwd: p.cwd, env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: p.home,
      CODEX_HOME: p.codexHome, CODEX_SQLITE_HOME: p.sqliteHome, TMPDIR: p.tmp }, stdio: ['pipe', 'pipe', 'pipe'], detached: DETACH_OWNED_CHILD, windowsHide: true });
    child.stdout.on('data', receive); child.stdout.on('error', () => reject(fail('transport_error', 'Native stdout failed')));
    child.stderr.on('data', () => {}); child.stderr.on('error', () => {});
    child.stdin.on('error', () => reject(fail('transport_error', 'Native stdin failed')));
    child.once('error', () => { reject(fail('spawn_failed', 'Native inventory could not start')); });
    child.once('close', (code, signal) => { closed = true; resolveClosed({ code, signal }); if (!classifier) reject(fail('client_closed', 'Native inventory owner closed')); });
  }
  async function wait(ms) { let timer; try { return await Promise.race([closePromise.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), ms); })]); } finally { clearTimeout(timer); } }
  async function close() {
    if (!child || closed) return;
    reject(fail('client_closed', 'Native inventory owner is closing')); child.stdin.end();
    if (await wait(stopGraceMs)) return; terminateProcess(child, 'SIGTERM');
    if (await wait(stopGraceMs)) return; terminateProcess(child, 'SIGKILL');
    if (!await wait(stopGraceMs)) throw fail('process_not_settled', 'Exact Native inventory owner is still held');
  }
  function request(method, params) {
    if (!METHODS.has(method) || pending || classifier || fault || closed) return Promise.reject(fault || fail('unsupported_rpc', 'Inventory RPC ownership differs'));
    return new Promise((resolve, rejectRequest) => { const id = nextId++; pending = { id, resolve, reject: rejectRequest,
      timer: setTimeout(() => reject(fail('rpc_timeout', 'Native inventory response unavailable')), timeoutMs) }; try { write({ id, method, params }); } catch (e) { reject(e); } });
  }
  async function classify() {
    if (!await wait(timeoutMs)) throw fail('classifier_timeout', 'Native classifier did not settle');
    const result = await closePromise;
    if (fault || result.code !== 0 || result.signal) throw fault || fail('classifier_failed', 'Native classifier failed');
    let value; try { value = JSON.parse(classifierText); } catch { throw fail('classifier_invalid', 'Native classifier output is invalid'); }
    if (canonical(Object.keys(value).sort()) !== canonical(['classification','planType','schemaVersion','type','usesCodexBackend'])
      || value.schemaVersion !== 1 || value.type !== 'chatgpt' || value.planType !== 'pro' || value.usesCodexBackend !== true
      || value.classification !== 'personal-pro') throw fail('unsupported_account', 'Native classifier did not establish personal Pro');
    return value;
  }
  return { classifier, start, request, initialized: () => write({ method: 'initialized', params: {} }), close, classify, get closed() { return closed; } };
}

function createNativeAccountInventoryService({ authority, getWrapperPin, acquireProfileOwner, storageRoot, onChange,
  requestTimeoutMs = 15000, stopGraceMs = 1000, testHooks = {} } = {}) {
  if (!authority?.resolveProfile || !authority?.publishProfileConfig || typeof getWrapperPin !== 'function' || typeof acquireProfileOwner !== 'function'
    || typeof storageRoot !== 'string' || !path.isAbsolute(storageRoot)) throw fail('invalid_inventory_owner', 'Trusted Native inventory dependencies are required');
  for (const v of [requestTimeoutMs, stopGraceMs]) if (!Number.isSafeInteger(v) || v < 1 || v > 120000) throw fail('invalid_inventory_owner', 'Invalid Native observation bound');
  const receipts = new Map(), inventories = new Map(); let live = null, destroyed = false;
  function notify() { try { onChange?.(); } catch {} }
  function save(row) {
    privateDirectory(storageRoot); const file = path.join(storageRoot, row.actionId + '.json'), temporary = path.join(storageRoot, randomUUID() + '.tmp');
    const bytes = JSON.stringify(row) + '\n'; fs.writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
    const fd = fs.openSync(temporary, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, file); const dir = fs.openSync(storageRoot, 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
    receipts.set(row.actionId, clone(row)); notify();
  }
  function inspect() {
    if (fs.existsSync(storageRoot)) for (const entry of fs.readdirSync(storageRoot)) if (/^[0-9a-f-]{36}\.json$/.test(entry)) {
      const row = JSON.parse(boundedPrivate(path.join(storageRoot, entry), 256 * 1024)); uuid(row.actionId);
      if (!receipts.has(row.actionId)) receipts.set(row.actionId, { ...row, ...(row.ownerHeld ? { state: 'unknown', reasonCode: 'previous_owner_unverified' } : {}) });
    }
    return { activeCount: live ? 1 : 0, receipts: [...receipts.values()].map(clone), models: [], executionAvailable: false };
  }
  async function run(input = {}) {
    if (process.platform !== 'darwin') throw fail('mac_only', 'Native inventory is currently available on macOS');
    const { actionId, profileId, epoch, explicitUserAction } = input; uuid(actionId); uuid(profileId); uuid(epoch);
    if (Object.keys(input).some(k => !['actionId','profileId','epoch','explicitUserAction'].includes(k)) || explicitUserAction !== true) throw fail('explicit_inventory_required', 'Native inventory requires the explicit selected profile action');
    inspect();
    if (destroyed || live) throw fail('inventory_busy', 'Native inventory owner is unavailable');
    if (receipts.has(actionId) || fs.existsSync(path.join(storageRoot, actionId + '.json'))) throw fail('intent_already_recorded', 'Inspect the inventory receipt instead of replay');
    let lease, lock, lockBytes, owner, p, baselineAuth, expectedHash, row = { actionId, profileId, epoch, state: 'prepared', phase: 'preflight', ownerHeld: true, createdAt: Date.now(), updatedAt: Date.now() };
    let finish; const operation = { actionId, owner: null, settled: new Promise(resolve => { finish = resolve; }), release: null }; live = operation;
    operation.release = async () => {
      if (owner && !owner.closed) return;
      if (lock && lockBytes && fs.existsSync(lock) && boundedPrivate(lock,4096).toString() === lockBytes) {
        if (row.ownerHeld && receipts.has(actionId)) { Object.assign(row, {state:'unknown',ownerHeld:false,updatedAt:Date.now()}); save(row); }
        fs.unlinkSync(lock);
      }
      if (lease) { const heldLease = lease; lease = null; if (typeof heldLease.release === 'function') await heldLease.release(); else authority.releaseProfileOwner(heldLease); }
      if (live === operation) live = null;
    };
    try {
      lease = await acquireProfileOwner({ profileId, epoch, actionId, kind: 'inventory' });
      if (!lease || typeof lease.release !== 'function' && typeof authority.releaseProfileOwner !== 'function') throw fail('profile_owner_unavailable', 'Exclusive Native profile ownership is required');
      p = authority.resolveProfile(profileId, epoch, lease); expectedHash = p.configSha256; baselineAuth = authStat(p);
      lock = path.join(p.root, '.inventory-owner'); lockBytes = JSON.stringify({ actionId, pid: process.pid, nonce: randomUUID() });
      fs.writeFileSync(lock, lockBytes, { flag: 'wx', mode: 0o600 }); save(row);
      const pin = clone(await getWrapperPin());
      if (fileDigest(pin.executable) !== pin.executableSha256) throw fail('native_wrapper_pin_changed', 'Native wrapper binary changed');
      (testHooks.verifyWrapper || verifyWrapper)(pin.executable, pin.executableSha256, pin.wrapperBuildPin);
      const bootstrapPath = path.join(pin.wrapperBuildPin.sourceRoot, 'build', pin.target, 'official-bootstrap-models.json');
      if (pin.officialBootstrapCatalog?.path !== bootstrapPath || pin.officialBootstrapCatalog?.sha256 !== BOOTSTRAP_SHA
        || digest(regular(bootstrapPath, MAX_LINE)) !== BOOTSTRAP_SHA) throw fail('bootstrap_pin_changed', 'Official bundled bootstrap source changed');
      function unchanged() {
        const current = authority.resolveProfile(profileId, epoch, lease);
        if (current.configSha256 !== expectedHash || current.root !== p.root || (!(owner && !owner.closed && !owner.classifier) && authStat(p) !== baselineAuth)
          || boundedPrivate(lock, 4096).toString() !== lockBytes) throw fail('profile_epoch_changed', 'Native profile changed during inventory');
        for (const f of ['/etc/codex/config.toml','/etc/codex/managed_config.toml','/etc/codex/requirements.toml']) absent(f);
        (testHooks.probeManagedPreferences || probeManagedPreferences)();
        absent(path.join(p.cwd, '.codex'));
        for (let dir = p.cwd;; dir = path.dirname(dir)) { absent(path.join(dir, '.git')); if (dir === path.dirname(dir)) break; }
      }
      function launch(classifier = false) {
        if (destroyed) throw fail('inventory_destroyed', 'Native inventory owner is closing');
        unchanged(); owner = childOwner({ executable: classifier ? '/usr/bin/sandbox-exec' : pin.executable,
          args: classifier ? ['-p', CLASSIFIER_SANDBOX, pin.executable, '--account-info'] : ['--stdio'], p,
          spawnProcess: testHooks.spawnProcess || spawn, terminateProcess: testHooks.terminateProcess || terminateOwnedProcessTree,
          timeoutMs: requestTimeoutMs, stopGraceMs, classifier }); operation.owner = owner; owner.start(); return owner;
      }
      async function settleGeneration(rpc) {
        // Only a native generation bracketed by qualified identity/usage may refresh auth.
        await rpc.close(); owner = null; operation.owner = null;
        const after = authStat(p);
        if (after !== baselineAuth) {
          baselineAuth = after;
          await launch(true).classify(); await owner.close(); owner = null; operation.owner = null;
        }
        unchanged();
      }
      const transition = phase => { Object.assign(row, { state: 'running', phase, updatedAt: Date.now() }); save(row); };
      transition('classify'); await launch(true).classify(); await owner.close(); owner = null; operation.owner = null; unchanged();
      privateDirectory(path.join(p.root, 'log'));
      const bootstrap = path.join(p.root, 'official-bootstrap-models.json');
      try { fs.writeFileSync(bootstrap, regular(bootstrapPath, MAX_LINE), { flag: 'wx', mode: 0o600 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
      if (digest(boundedPrivate(bootstrap, MAX_LINE)) !== BOOTSTRAP_SHA) throw fail('bootstrap_pin_changed', 'Private bootstrap bytes changed');
      async function publish(config) {
        unchanged(); const configText = Object.entries(config).map(([k,v]) => `${k} = ${toml(v)}\n`).join('');
        const result = authority.publishProfileConfig({ profileId, epoch, actionId: randomUUID(), expectedConfigSha256: expectedHash, configText, profileOwner: lease });
        expectedHash = result.configSha256; unchanged();
      }
      async function connect(config) {
        const rpc = launch(); const init = await rpc.request('initialize', { clientInfo: { name: 'nekodex-account-inventory', title: 'NEKODEX', version: '1' }, capabilities: { experimentalApi: false, requestAttestation: false } });
        if (init?.codexHome !== p.codexHome || typeof init.userAgent !== 'string' || init.userAgent.length > 4096) throw fail('initialize_mismatch', 'Native inventory profile differs');
        rpc.initialized(); effective(await rpc.request('config/read', { includeLayers: true, cwd: p.cwd }), await rpc.request('configRequirements/read', {}), config, p); unchanged(); return rpc;
      }
      const staticConfig = configFor(p, bootstrap); transition('bootstrap'); await publish(staticConfig);
      let rpc = await connect(staticConfig); const account = accountDescriptor(await rpc.request('account/read', { refreshToken: false }));
      const usage = usageProjection(await rpc.request('account/rateLimits/read', {}));
      const staticAccountAfter = accountDescriptor(await rpc.request('account/read', { refreshToken: false }));
      const staticUsageAfter = usageProjection(await rpc.request('account/rateLimits/read', {}));
      if (canonical(staticAccountAfter) !== canonical(account) || staticUsageAfter.accountId !== usage.accountId) throw fail('account_changed', 'Native identity changed during bootstrap');
      await settleGeneration(rpc);
      transition('online-inventory'); const onlineConfig = configFor(p); await publish(onlineConfig);
      const cacheFile = path.join(p.codexHome, 'models_cache.json'); let beforeCache = null;
      try { beforeCache = digest(boundedPrivate(cacheFile, MAX_CACHE, 0o022)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      const onlineStartedAt = Date.now(); rpc = await connect(onlineConfig);
      const checkAccount = async () => {
        const next = accountDescriptor(await rpc.request('account/read', { refreshToken: false })); const limits = usageProjection(await rpc.request('account/rateLimits/read', {}));
        if (canonical(next) !== canonical(account) || limits.accountId !== usage.accountId) throw fail('account_changed', 'Native identity changed during inventory'); return limits;
      };
      await checkAccount(); const picker = [], cursors = new Set(); let cursor = null;
      for (let page = 0; page < 8; page++) {
        const result = await rpc.request('model/list', { cursor, limit: 100, includeHidden: true });
        if (!Array.isArray(result?.data) || result.data.length > 100 || picker.length + result.data.length > 512) throw fail('models_invalid', 'Native picker inventory exceeded bound');
        for (const item of result.data) { if (typeof item?.id !== 'string' || item.id.length > 128 || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(item.id)) throw fail('models_invalid', 'Native picker identifier differs'); picker.push(item); }
        cursor = result.nextCursor ?? null; if (cursor === null) break;
        if (typeof cursor !== 'string' || cursor.length > 4096 || cursors.has(cursor) || page === 7) throw fail('models_pagination_unavailable', 'Native picker pagination did not settle'); cursors.add(cursor);
      }
      const finalUsage = await checkAccount(); await settleGeneration(rpc); transition('cache-provenance');
      // Upstream cache writes are non-atomic: read only after exact process close.
      const cacheBytes = boundedPrivate(cacheFile, MAX_CACHE, 0o022, true), cache = JSON.parse(cacheBytes), fetchedAt = Date.parse(cache.fetched_at), now = Date.now();
      if (cache.client_version !== VERSION || !Number.isFinite(fetchedAt) || fetchedAt < onlineStartedAt - 1000 || fetchedAt > now + 1000 || now - fetchedAt > 300000
        || !/^[a-f0-9]{64}$/.test(cache.identity || '') || cache.etag != null && (typeof cache.etag !== 'string' || cache.etag.length > 4096)
        || !Array.isArray(cache.models) || !cache.models.length || cache.models.length > 512 || beforeCache === digest(cacheBytes)) throw fail('catalog_provenance_unavailable', 'Fresh own-profile Native catalog provenance is unavailable');
      const ids = new Set();
      for (const model of cache.models) {
        if (!plain(model) || typeof model.slug !== 'string' || ids.has(model.slug) || typeof model.display_name !== 'string'
          || typeof model.model_messages?.instructions_template !== 'string' && typeof model.base_instructions !== 'string'
          || !Object.hasOwn(model, 'shell_type') || !Object.hasOwn(model, 'apply_patch_tool_type')
          || !Array.isArray(model.experimental_supported_tools) || Buffer.byteLength(JSON.stringify(model)) > MAX_LINE) throw fail('full_model_metadata_unavailable', 'Native complete model metadata is unavailable');
        ids.add(model.slug);
      }
      if (!picker.length || picker.some(item => !ids.has(item.id))) throw fail('picker_catalog_mismatch', 'Native picker IDs do not match the own-profile catalog');
      const evidence = { profileId, epoch, sourceRevision: SOURCE, executableSha256: pin.executableSha256, configSha256: expectedHash,
        authStat: JSON.parse(baselineAuth),
        cacheSha256: digest(cacheBytes), identity: cache.identity, fetchedAt: cache.fetched_at, etag: cache.etag ?? null,
        clientVersion: VERSION, account, usage: finalUsage, picker, catalog: { models: cache.models } };
      inventories.set(actionId, evidence);
      Object.assign(row, { state: 'completed', ownerHeld: false, phase: 'complete', updatedAt: Date.now(), metadata: {
        account, usage: finalUsage, modelCount: cache.models.length, cacheSha256: evidence.cacheSha256, nativeIdentity: cache.identity,
        fetchedAt: cache.fetched_at, etag: cache.etag ?? null, clientVersion: VERSION, executionAvailable: false } }); save(row); return clone(row);
    } catch (error) {
      let settled = true; try { if (owner) await owner.close(); } catch { settled = false; }
      Object.assign(row, { state: 'unknown', ownerHeld: !settled, reasonCode: settled ? reasonCode(error) : 'process_not_settled', updatedAt: Date.now() });
      // An unrecorded validation rejection does not overwrite another owner's receipt.
      if (lockBytes && lock && fs.existsSync(lock) && boundedPrivate(lock,4096).toString() === lockBytes) save(row);
      throw Object.assign(fail(row.reasonCode, 'Native inventory requires receipt reconciliation'), { actionRecorded: receipts.has(actionId) });
    } finally {
      try { await operation.release(); } finally { finish(); }
    }
  }
  return Object.freeze({ run, inspect, currentOperation: () => live ? 'Native account inventory' : null,
    trustedInventory: actionId => { uuid(actionId); return inventories.has(actionId) ? clone(inventories.get(actionId)) : null; },
    async destroy() { destroyed = true; const operation = live; if (!operation) return; if (operation.owner) await operation.owner.close(); await operation.settled; await operation.release(); } });
}
module.exports = { createNativeAccountInventoryService };
