'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { digest, canonical, fail, plain, freeze, privateDirectory, regular, fileDigest, VERSION, SOURCE,
  verifyWrapper, probeManagedPreferences, DISABLED_FEATURES, toml, contains, absent } = require('./owned-native-admission.cjs');
const { compileAgentNativeOutputSchema } = require('./agent-native-bridge.cjs');
const HASH = /^[a-f0-9]{64}$/;
function metadata(p) {
  const s = fs.lstatSync(path.join(p.codexHome, 'auth.json'));
  if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.uid !== process.getuid() || (s.mode & 0o077)) throw fail('unsafe_auth_metadata', 'Native auth metadata is not private');
  return canonical({ dev: s.dev, ino: s.ino, size: s.size, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs });
}
function sealedWrite(file, text) {
  fs.writeFileSync(file, text, { flag: 'wx', mode: 0o600 });
  const fd = fs.openSync(file, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
/** Qualified inventory is the sole source. Existing fixture admission stays unchanged. */
function makeNativeAccountAdmission({ authority, lease, profile, inventory, inventoryActionId, pin, serverGeneration, generationRoot, modelIds, testHooks = {} }) {
  const original = JSON.parse(JSON.stringify(inventory)), wrapperPin = JSON.parse(JSON.stringify(pin));
  if (!plain(original.authStat) || canonical(original.authStat) !== metadata(profile)) throw fail('profile_epoch_changed', 'Native auth metadata changed since qualified inventory');
  const fresh = () => {
    const fetched = Date.parse(original.fetchedAt), now = Date.now();
    if (!Number.isFinite(fetched) || fetched > now + 1000 || now - fetched > 300000) throw fail('inventory_refresh_required', 'Refresh Native catalog provenance before starting a new account generation');
  };
  fresh();
  if (fileDigest(wrapperPin.executable) !== wrapperPin.executableSha256) throw fail('native_wrapper_pin_changed', 'Native account executable changed');
  (testHooks.verifyWrapper || verifyWrapper)(wrapperPin.executable, wrapperPin.executableSha256, wrapperPin.wrapperBuildPin);
  if (process.platform !== 'darwin' || lease.kind !== 'execution' || original.profileId !== profile.profileId || original.epoch !== profile.epoch
    || original.sourceRevision !== SOURCE || original.clientVersion !== VERSION || original.executableSha256 !== wrapperPin.executableSha256
    || original.configSha256 !== profile.configSha256 || !HASH.test(original.cacheSha256 || '') || !HASH.test(original.identity || '')
    || original.account?.type !== 'chatgpt' || original.account.planType !== 'pro' || original.usage?.ordinaryUsageAllowed !== true
    || original.usage.identityConfidence !== 'native-active-account-match' || typeof original.usage.accountId !== 'string'
    || !Array.isArray(original.picker) || !Array.isArray(original.catalog?.models) || !original.catalog.models.length) throw fail('unqualified_inventory', 'Current own-profile Native inventory is required');
  const cacheBytes = regular(path.join(profile.codexHome, 'models_cache.json'), 8 * 1024 * 1024);
  const cache = JSON.parse(cacheBytes);
  if (digest(cacheBytes) !== original.cacheSha256 || cache.identity !== original.identity || cache.fetched_at !== original.fetchedAt
    || cache.etag !== undefined && cache.etag !== original.etag || cache.client_version !== VERSION
    || canonical(cache.models) !== canonical(original.catalog.models)) throw fail('catalog_provenance_changed', 'Native inventory catalog bytes changed');
  const chosen = modelIds ?? [original.picker[0]?.id];
  if (!Array.isArray(chosen) || !chosen.length || chosen.length > 2 || new Set(chosen).size !== chosen.length) throw fail('invalid_model_selection', 'Select one or two actual Native inventory models');
  const selected = chosen.map(id => {
    const model = original.catalog.models.find(row => row.slug === id);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(id || '') || !original.picker.some(row => row.id === id) || !plain(model)
      || typeof model.model_messages?.instructions_template !== 'string' && typeof model.base_instructions !== 'string'
      || !Object.hasOwn(model, 'shell_type') || !Object.hasOwn(model, 'apply_patch_tool_type') || !Array.isArray(model.experimental_supported_tools)) throw fail('full_model_metadata_unavailable', 'Selected Native model metadata is incomplete');
    return { ...model, shell_type: 'disabled', apply_patch_tool_type: null, tool_mode: 'direct', experimental_supported_tools: [],
      supports_search_tool: false, node_repl_disabled: true, use_responses_lite: false, prefer_websockets: false };
  });
  const root = generationRoot, paths = { root, home: profile.home, codexHome: profile.codexHome, cwd: profile.cwd,
    sqliteHome: path.join(profile.sqliteHome, 'execution', serverGeneration), config: profile.config,
    catalog: path.join(root, 'sealed-models.json'), journal: path.join(root, 'bindings'), tmp: profile.tmp };
  for (const dir of [root, path.dirname(paths.sqliteHome), paths.sqliteHome, paths.journal, path.join(root, 'log')]) privateDirectory(dir);
  const originalText = JSON.stringify(original.catalog), catalogText = JSON.stringify({ models: selected });
  if (Buffer.byteLength(catalogText) > 2 * 1024 * 1024) throw fail('full_model_metadata_unavailable', 'Selected Native catalog exceeds the admitted bound');
  sealedWrite(path.join(root, 'original-models.json'), originalText); sealedWrite(paths.catalog, catalogText);
  const config = { model: chosen[0], model_provider: 'openai', model_catalog_json: paths.catalog, sqlite_home: paths.sqliteHome,
    log_dir: path.join(root, 'log'), approval_policy: 'never', approvals_reviewer: 'user', sandbox_mode: 'read-only',
    web_search: 'disabled', notify: [], project_root_markers: [], project_doc_max_bytes: 0,
    include_environment_context: false, include_environment_context_time: false, check_for_update_on_startup: false,
    cli_auth_credentials_store: 'file', features: Object.fromEntries([...DISABLED_FEATURES.map(key => [key, false]), ['skip_host_skill_discovery', true]]),
    tools: { update_plan: { enabled: false }, experimental_request_user_input: { enabled: false } }, agents: { enabled: false },
    memories: { use_memories: false, generate_memories: false }, skills: { include_instructions: false, bundled: { enabled: false } },
    cloud: { skills: { enabled: false } }, analytics: { enabled: false }, feedback: { enabled: false }, history: { persistence: 'none' } };
  const configText = Object.entries(config).map(([key, value]) => `${key} = ${toml(value)}\n`).join('');
  const published = authority.publishProfileConfig({ profileId: profile.profileId, epoch: profile.epoch, actionId: serverGeneration,
    expectedConfigSha256: profile.configSha256, configText, profileOwner: lease });
  const baselineAuth = canonical(original.authStat), configSha256 = published.configSha256;
  if (metadata(profile) !== baselineAuth) throw fail('profile_epoch_changed', 'Native auth metadata changed during admission');
  const sharedIdentity = { profileId: profile.profileId, epoch: profile.epoch, serverGeneration, inventoryActionId,
    source: SOURCE, version: VERSION, executableSha256: wrapperPin.executableSha256, cacheSha256: original.cacheSha256,
    accountId: original.usage.accountId, nativeIdentity: original.identity, sealedCatalogSha256: digest(catalogText), configSha256 };
  const historySource = freeze({ sourceId: digest(canonical(['owned-native-history-source-v1', profile.profileId, profile.epoch, original.usage.accountId])),
    profileId: profile.profileId, backendAccountId: original.usage.accountId, authEpoch: profile.epoch });
  const modelRows = selected.map(model => ({ id: model.slug, label: model.display_name || model.slug, provider: 'owned-native', available: true, accepting: true, historySource,
    imageInput: Array.isArray(model.input_modalities) && model.input_modalities.includes('image')
      && original.picker.some(row => row.id === model.slug && Array.isArray(row.inputModalities) && row.inputModalities.includes('image')),
    admissionId: digest(canonical({ ...sharedIdentity, originalModelSha256: digest(canonical(original.catalog.models.find(row => row.slug === model.slug))), modelId: model.slug })) }));
  let started = false;
  function unchanged(checkExecutable = false) {
    const current = authority.resolveProfile(profile.profileId, profile.epoch, lease);
    if (current.configSha256 !== configSha256 || current.root !== profile.root || digest(regular(paths.config, 2 * 1024 * 1024)) !== configSha256
      || !regular(paths.catalog, 2 * 1024 * 1024).equals(Buffer.from(catalogText))) throw fail('admission_changed', 'Native account admission changed');
    if (checkExecutable) {
      if (fileDigest(wrapperPin.executable) !== wrapperPin.executableSha256) throw fail('native_wrapper_pin_changed', 'Native account executable changed');
      (testHooks.verifyWrapper || verifyWrapper)(wrapperPin.executable, wrapperPin.executableSha256, wrapperPin.wrapperBuildPin);
    }
    for (const file of ['/etc/codex/config.toml', '/etc/codex/managed_config.toml', '/etc/codex/requirements.toml']) absent(file);
    (testHooks.probeManagedPreferences || probeManagedPreferences)();
    absent(path.join(profile.cwd, '.codex'));
    for (let dir = profile.cwd;; dir = path.dirname(dir)) { absent(path.join(dir, '.git')); if (dir === path.dirname(dir)) break; }
  }
  const admission = { serverGeneration, paths: freeze(paths), config: freeze(config), provider: 'openai', models: freeze(modelRows), historySource, compileOutputSchema: compileAgentNativeOutputSchema,
    availability: () => ({ available: true, reasonCode: null }),
    prestart() {
      unchanged(true);
      if (!started) {
        fresh();
        if (metadata(profile) !== baselineAuth) throw fail('profile_epoch_changed', 'Native account auth metadata changed before execution');
      }
      started = true;
      return { executable: wrapperPin.executable, args: ['--stdio'], paths, provider: 'openai',
        environment: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: profile.home, CODEX_HOME: profile.codexHome,
          CODEX_SQLITE_HOME: paths.sqliteHome, TMPDIR: profile.tmp } };
    },
    checkEffective(read, requirements) {
      if (!plain(read?.config) || !Array.isArray(read.layers) || !plain(requirements) || !Object.hasOwn(requirements, 'requirements')
        || requirements.requirements !== null && (!plain(requirements.requirements) || Object.values(requirements.requirements).some(value => value !== null))) throw fail('unsupported_effective_policy', 'Native execution requirements are unavailable');
      for (const [key, expected] of Object.entries(config)) if (key !== 'tools' && !contains(read.config[key], expected)) throw fail('unsupported_effective_policy', 'Native execution effective configuration differs');
      if (read.config.model_providers != null && Object.keys(read.config.model_providers).length || read.config.chatgpt_base_url != null
        && !['https://chatgpt.com/backend-api', 'https://chatgpt.com/backend-api/'].includes(read.config.chatgpt_base_url)
        || read.config.tools != null && (!plain(read.config.tools) || read.config.tools.web_search != null)) throw fail('unsupported_effective_policy', 'Native execution provider/tool route differs');
      for (const layer of read.layers) {
        if (!plain(layer?.name) || !plain(layer.config) || layer.disabledReason != null) throw fail('unsupported_effective_policy', 'Native execution config layer differs');
        if (['system', 'project'].includes(layer.name.type) && !Object.keys(layer.config).length || layer.name.type === 'packagedDefaults') continue;
        if (layer.name.type === 'user' && layer.name.file === paths.config && layer.name.profile == null && canonical(layer.config) === canonical(config)) continue;
        throw fail('unsupported_effective_policy', 'Native execution has an unadmitted config source');
      }
      unchanged();
    },
    checkAccount(account, usage) {
      if (canonical(account?.account) !== canonical(original.account) || usage?.accountId !== original.usage.accountId || usage.ordinaryUsageAllowed !== true) throw fail('account_changed', 'Native execution account or ordinary usage changed');
    },
    forBinding(binding) {
      const row = modelRows.find(value => value.id === binding.model && value.admissionId === binding.admissionId);
      if (!row || typeof binding.workerBindingId !== 'string') throw fail('invalid_admission', 'Native binding does not match the qualified account model');
      const journal = path.join(paths.journal, digest(binding.workerBindingId));
      return { ...admission, admissionId: row.admissionId, modelId: row.id, imageInput: row.imageInput, paths: { ...paths, journal } };
    },
  };
  return Object.freeze(admission);
}
module.exports = { makeNativeAccountAdmission };
