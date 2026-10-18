'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const VERSION = '0.163.0';
const SOURCE = '83086188ae0614bd882818ff1aa23f3194962012';
const WRAPPER_INFO = Object.freeze({ schemaVersion: 1, artifact: 'nekodex-owned-native-worker', developmentOnly: true,
  codexVersion: VERSION, codexRepository: 'https://github.com/openai/codex.git', codexRevision: SOURCE,
  rustToolchain: '1.95.0', sessionSource: 'nekodex-owned-worker', transport: 'stdio', ownerMaxLineBytes: 1048576,
  childInternalLineBound: false, strictConfig: true, pluginStartupTasks: 'skip',
  remoteControl: 'disabled-ephemeral', managedDaemon: false, managedPolicyBypass: false,
  runtimeVerified: false, realProviderVerified: false, authClassifier: true, authClassifierVersion: 1 });
const fail = (code, message) => Object.assign(new Error(message), { code });
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, (_key, entry) => plain(entry)
  ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry);
const DISABLED_FEATURES = Object.freeze(['shell_tool', 'view_image', 'request_permissions_tool',
  'deferred_executor', 'current_time_reminder', 'sleep_tool', 'token_budget',
  'send_message_to_user_async', 'code_mode', 'code_mode_only', 'code_mode_host',
  'code_mode_prewarm', 'multi_agent_v2', 'multi_agent', 'agent_message_board', 'goals',
  'memories', 'image_generation', 'plugins', 'apps', 'remote_plugin', 'browser_use',
  'browser_use_external', 'in_app_browser', 'computer_use', 'hooks', 'shell_snapshot',
  'skill_search', 'skill_mcp_dependency_install', 'unbounded_connection_retries',
  'enable_request_compression', 'async_compaction', 'chronicle', 'api_key_model_discovery',
  'api_key_cyber_access_programs', 'auth_elicitation', 'mentions_v2', 'tool_suggest', 'remote_control', 'network_proxy', 'omit_app_server_notification_media']);
const MDM_PROBE = `ObjC.import('CoreFoundation');
const domain = $('com.openai.codex');
JSON.stringify({configForced:Boolean($.CFPreferencesAppValueIsForced($('config_toml_base64'),domain)),requirementsForced:Boolean($.CFPreferencesAppValueIsForced($('requirements_toml_base64'),domain))});`;

function absolute(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /[\0\r\n]/.test(value)) {
    throw fail('invalid_admission', 'Native worker paths must be supplied by trusted main');
  }
  return path.resolve(value);
}
function absent(file) {
  try { fs.lstatSync(file); } catch (reason) {
    if (reason.code === 'ENOENT') return;
    throw fail('policy_probe_failed', 'Native startup policy could not be checked');
  }
  throw fail('unsupported_startup_policy', 'An external native startup configuration requires admission');
}
function regular(file, maxBytes) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes
    || stat.uid !== process.getuid() || (stat.mode & 0o022)) {
    throw fail('invalid_admission', 'Native admission file is not a pinned private regular file');
  }
  return fs.readFileSync(file);
}
function fileDigest(file, maxBytes = 512 * 1024 * 1024) {
  // The DEV wrapper is large. Hash bounded chunks instead of retaining a second
  // full executable Buffer in Electron's main process.
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > maxBytes || stat.uid !== process.getuid() || (stat.mode & 0o022)) {
      throw fail('invalid_admission', 'Native digest input is not an admitted regular file');
    }
    const hash = createHash('sha256'), chunk = Buffer.allocUnsafe(1024 * 1024);
    for (;;) { const count = fs.readSync(fd, chunk, 0, chunk.length, null); if (!count) break; hash.update(chunk.subarray(0, count)); }
    const after = fs.fstatSync(fd);
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) {
      throw fail('admission_changed', 'Native digest input changed while being checked');
    }
    return hash.digest('hex');
  } finally { fs.closeSync(fd); }
}
function verifyWrapper(executable, executableSha256, pin) {
  const sourceRoot = pin.sourceRoot;
  if (fs.realpathSync(sourceRoot) !== sourceRoot) throw fail('invalid_admission', 'Wrapper source root must be canonical');
  const target = { arm64: 'aarch64-apple-darwin', x64: 'x86_64-apple-darwin' }[process.arch];
  const output = path.join(sourceRoot, 'build', target || 'unsupported');
  if (executable !== path.join(output, WRAPPER_INFO.artifact) || pin.metadataPath !== path.join(output, 'build-info.json')) {
    throw fail('invalid_admission', 'Wrapper executable and build metadata must share the fixed owned output');
  }
  const bytes = regular(pin.metadataPath, 16384);
  if (digest(bytes) !== pin.metadataSha256) throw fail('admission_changed', 'Wrapper build metadata pin changed');
  let metadata;
  try { metadata = JSON.parse(bytes); } catch { throw fail('invalid_admission', 'Wrapper build metadata is invalid'); }
  for (const [key, expected] of Object.entries(WRAPPER_INFO)) if (metadata[key] !== expected) {
    throw fail('unsupported_wrapper', 'Wrapper build does not match its admitted runtime options');
  }
  if (metadata.target !== target || metadata.executable !== executable || metadata.sha256 !== executableSha256
    || metadata.bytes !== fs.statSync(executable).size) throw fail('admission_changed', 'Wrapper binary is not bound to its build metadata');
  for (const [file, key] of [['Cargo.toml', 'manifestSha256'], ['Cargo.lock', 'cargoLockSha256'], ['src/main.rs', 'mainSha256']]) {
    if (!/^[a-f0-9]{64}$/.test(metadata[key] || '') || fileDigest(path.join(sourceRoot, file), 2 * 1024 * 1024) !== metadata[key]) {
      throw fail('admission_changed', 'Wrapper source input no longer matches the admitted build');
    }
  }
  const sourceBytes = regular(path.join(sourceRoot, 'source-pin.json'), 16384);
  if (digest(sourceBytes) !== pin.sourcePinSha256 || canonical(JSON.parse(sourceBytes)) !== canonical(WRAPPER_INFO)) {
    throw fail('admission_changed', 'Wrapper fixed source metadata changed');
  }
  // All binary/source/build pins above pass BEFORE executing even this static
  // branch. No profile/auth environment is present and no app-server is started.
  let reported;
  try { reported = JSON.parse(execFileSync(executable, ['--build-info'], { encoding: 'utf8', timeout: 10_000,
    maxBuffer: 16384, env: { PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'pipe', 'ignore'] })); }
  catch { throw fail('wrapper_probe_failed', 'Pinned wrapper static metadata is unavailable'); }
  if (canonical(reported) !== canonical(WRAPPER_INFO)) throw fail('unsupported_wrapper', 'Wrapper reported unsupported runtime options');
}
function privateDirectory(directory) {
  const parent = path.dirname(directory);
  if (parent !== directory && !fs.existsSync(parent)) privateDirectory(parent);
  try { fs.mkdirSync(directory, { mode: 0o700 }); } catch (reason) { if (reason.code !== 'EEXIST') throw reason; }
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077)) {
    throw fail('invalid_admission', 'Native worker storage must be an owned private directory');
  }
}
function writeSealed(file, bytes) {
  try { fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 }); }
  catch (reason) { if (reason.code !== 'EEXIST') throw reason; }
  if (!regular(file, 2 * 1024 * 1024).equals(Buffer.from(bytes))) {
    throw fail('admission_changed', 'Native worker configuration has changed');
  }
}
function probeManagedPreferences() {
  let value;
  try {
    value = JSON.parse(execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', MDM_PROBE], {
      encoding: 'utf8', timeout: 5000, maxBuffer: 4096,
      env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }, stdio: ['ignore', 'pipe', 'ignore'],
    }));
  } catch { throw fail('policy_probe_failed', 'Native managed preferences could not be checked'); }
  if (!plain(value) || typeof value.configForced !== 'boolean' || typeof value.requirementsForced !== 'boolean') {
    throw fail('policy_probe_failed', 'Native managed preferences returned unsupported metadata');
  }
  // Same effective CFPreferences application/key/forced API as the pinned CLI.
  // Conservative: even a forced-but-empty value is not silently bypassed.
  if (value.configForced || value.requirementsForced) {
    throw fail('unsupported_startup_policy', 'Managed native policy requires explicit admission');
  }
}
function makeAdmission({ executable, executableSha256, executableVariant = 'stock-cli', wrapperBuildPin, authorityHome, catalog, route,
  testHooks = {} } = {}) {
  executable = absolute(executable); authorityHome = absolute(authorityHome);
  if (!/^[a-f0-9]{64}$/.test(executableSha256 || '') || !plain(catalog)
    || typeof catalog.json !== 'string' || Buffer.byteLength(catalog.json) > 2 * 1024 * 1024
    || digest(catalog.json) !== catalog.sha256 || typeof catalog.modelId !== 'string'
    || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(catalog.modelId)) {
    throw fail('invalid_admission', 'Native executable and single-model catalog pins are required');
  }
  // Admission binds immutable bytes/identity, never caller-owned mutable objects.
  catalog = Object.freeze({ json: catalog.json, sha256: catalog.sha256, modelId: catalog.modelId });
  testHooks = Object.freeze({ ...testHooks });
  if (!['stock-cli', 'owned-wrapper'].includes(executableVariant) || executableVariant === 'stock-cli' && wrapperBuildPin !== undefined) {
    throw fail('invalid_admission', 'Native executable variant requires explicit trusted admission');
  }
  if (executableVariant === 'owned-wrapper') {
    if (!plain(wrapperBuildPin) || !/^[a-f0-9]{64}$/.test(wrapperBuildPin.metadataSha256 || '')
      || !/^[a-f0-9]{64}$/.test(wrapperBuildPin.sourcePinSha256 || '')) throw fail('invalid_admission', 'Wrapper build pins are required');
    wrapperBuildPin = Object.freeze({ metadataPath: absolute(wrapperBuildPin.metadataPath),
      metadataSha256: wrapperBuildPin.metadataSha256, sourceRoot: absolute(wrapperBuildPin.sourceRoot), sourcePinSha256: wrapperBuildPin.sourcePinSha256 });
  }
  let parsed;
  try { parsed = JSON.parse(catalog.json); } catch { throw fail('invalid_admission', 'Invalid native model catalog'); }
  const model = parsed?.models?.[0];
  if (!Array.isArray(parsed?.models) || parsed.models.length !== 1 || model?.slug !== catalog.modelId
    || model.shell_type !== 'disabled' || model.apply_patch_tool_type !== null || model.tool_mode !== 'direct'
    || !Array.isArray(model.experimental_supported_tools) || model.experimental_supported_tools.length
    || model.supports_search_tool !== false || model.node_repl_disabled !== true
    || model.use_responses_lite !== false || model.prefer_websockets === true
    || typeof model.model_messages?.instructions_template !== 'string' && typeof model.base_instructions !== 'string') {
    throw fail('invalid_admission', 'Native model capability metadata is not sealed for inference only');
  }
  if (!plain(route) || !['official-openai', 'local-fixture'].includes(route.kind)) {
    throw fail('invalid_admission', 'Native route must be selected by trusted main');
  }
  route = Object.freeze({ kind: route.kind, baseUrl: route.baseUrl });
  let baseUrl;
  if (route.kind === 'local-fixture') {
    try { baseUrl = new URL(route.baseUrl); } catch { throw fail('invalid_admission', 'Invalid local fixture route'); }
    if (baseUrl.protocol !== 'http:' || baseUrl.hostname !== '127.0.0.1' || !baseUrl.port
      || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash || baseUrl.pathname !== '/v1') {
      throw fail('invalid_admission', 'Fixture inference must use an explicit owned loopback endpoint');
    }
    baseUrl = baseUrl.href;
  }
  const paths = Object.freeze({ root: authorityHome, home: path.join(authorityHome, 'home'),
    codexHome: path.join(authorityHome, 'profile'), sqliteHome: path.join(authorityHome, 'sqlite'),
    cwd: path.join(authorityHome, 'home', 'work'), catalog: path.join(authorityHome, 'catalog.json'),
    config: path.join(authorityHome, 'profile', 'config.toml'), journal: path.join(authorityHome, 'receipts') });
  const provider = route.kind === 'local-fixture' ? 'nekodex_fixture' : 'openai';
  const config = {
    model: catalog.modelId, model_provider: provider, model_catalog_json: paths.catalog,
    sqlite_home: paths.sqliteHome, log_dir: path.join(authorityHome, 'log'),
    approval_policy: 'never', approvals_reviewer: 'user', sandbox_mode: 'read-only',
    thread_unload_delay_secs: 0,
    web_search: 'disabled', notify: [], project_root_markers: [], project_doc_max_bytes: 0,
    include_environment_context: false, include_environment_context_time: false,
    check_for_update_on_startup: false, cli_auth_credentials_store: 'file',
    features: Object.fromEntries([...DISABLED_FEATURES.map(key => [key, false]), ['skip_host_skill_discovery', true]]),
    tools: { update_plan: { enabled: false }, experimental_request_user_input: { enabled: false } },
    agents: { enabled: false }, memories: { use_memories: false, generate_memories: false },
    skills: { include_instructions: false, bundled: { enabled: false } }, cloud: { skills: { enabled: false } },
    analytics: { enabled: false }, feedback: { enabled: false }, history: { persistence: 'none' },
  };
  if (route.kind === 'local-fixture') config.model_providers = { [provider]: {
    name: 'NEKODEX local contract fixture', base_url: baseUrl, wire_api: 'responses',
    env_key: 'NEKODEX_NATIVE_FIXTURE_TOKEN', requires_openai_auth: false,
    request_max_retries: 0, stream_max_retries: 0, supports_websockets: false,
  } };
  freeze(config);
  const configText = Object.entries(config).map(([key, value]) => `${key} = ${toml(value)}\n`).join('');
  const identity = { version: VERSION, source: SOURCE, executableSha256,
    catalogSha256: catalog.sha256, config, route: route.kind };
  // Preserve existing stock receipt identity; only the new variant adds pins.
  if (executableVariant === 'owned-wrapper') Object.assign(identity, { executableVariant, wrapperBuildPin });
  const admissionId = digest(canonical(identity));
  function availability() {
    if (process.platform !== 'darwin') return { available: false, reasonCode: 'mac_only' };
    if (route.kind === 'official-openai') return { available: false, reasonCode: 'official_policy_preflight_unverified' };
    return { available: true, reasonCode: null };
  }
  function prestart() {
    const status = availability();
    if (!status.available) throw fail(status.reasonCode, 'This native route has not completed admission');
    // No profile/auth read: system sources are refused on presence, including unreadable/symlink sources.
    for (const file of ['/etc/codex/config.toml', '/etc/codex/managed_config.toml', '/etc/codex/requirements.toml']) absent(file);
    (testHooks.probeManagedPreferences || probeManagedPreferences)();
    if (fileDigest(executable) !== executableSha256) throw fail('admission_changed', 'Native executable pin changed');
    if (executableVariant === 'owned-wrapper') verifyWrapper(executable, executableSha256, wrapperBuildPin);
    else {
      const metadata = JSON.parse(regular(path.join(path.dirname(path.dirname(executable)), 'codex-package.json'), 16384));
      if (metadata.version !== VERSION || metadata.layoutVersion !== 1 || metadata.entrypoint !== 'bin/codex'
        || metadata.variant !== 'codex' || !['aarch64-apple-darwin', 'x86_64-apple-darwin'].includes(metadata.target)) {
        throw fail('unsupported_version', 'This native worker requires the admitted official CLI 0.163.0 layout');
      }
    }
    // Reject possible checkout/project configuration before Codex can discover it.
    for (let dir = paths.cwd;; dir = path.dirname(dir)) {
      absent(path.join(dir, '.codex')); absent(path.join(dir, '.git'));
      if (dir === path.dirname(dir)) break;
    }
    for (const dir of [paths.root, paths.home, paths.codexHome, paths.sqliteHome, paths.cwd, path.join(authorityHome, 'log')]) privateDirectory(dir);
    // This implementation is fixture-only. Never load/copy/authenticate an existing real profile.
    for (const entry of fs.readdirSync(paths.codexHome)) if (!['config.toml', 'log', 'tmp'].includes(entry)) {
      throw fail('unsupported_profile_state', 'Native profile contains state that requires explicit admission');
    }
    writeSealed(paths.catalog, catalog.json); writeSealed(paths.config, configText);
    return Object.freeze({ executable, paths, provider, modelId: catalog.modelId, admissionId,
      environment: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: paths.home, CODEX_HOME: paths.codexHome,
        CODEX_SQLITE_HOME: paths.sqliteHome, TMPDIR: paths.home, NO_PROXY: '127.0.0.1',
        NEKODEX_NATIVE_FIXTURE_TOKEN: 'nekodex-dummy-fixture-auth',
        HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9', ALL_PROXY: 'http://127.0.0.1:9' },
      args: executableVariant === 'owned-wrapper' ? ['--stdio'] : ['app-server', '--stdio', '--strict-config'],
    });
  }
  function checkEffective(read, requirements) {
    testHooks.observeEffective?.(read, requirements);
    if (!plain(read?.config) || !Array.isArray(read.layers) || !plain(requirements)
      || !Object.hasOwn(requirements, 'requirements') || requirements.requirements !== null
        && (!plain(requirements.requirements) || Object.values(requirements.requirements).some(value => value !== null))) {
      throw fail('unsupported_effective_policy', 'Native managed requirements require explicit admission');
    }
    // The public Config projection materializes default fields inside tools,
    // providers, agents, memories, history and features. Check every admitted leaf;
    // raw layers below must still match the complete sealed input exactly.
    for (const [key, expected] of Object.entries(config)) if (key !== 'tools' && !contains(read.config[key], expected)) {
      throw Object.assign(fail('unsupported_effective_policy', 'Native effective configuration differs from admission'), { field: key });
    }
    // Public ToolsV2 only contains web_search. update_plan/request_user_input are
    // accepted strict ConfigToml fields retained in the exact raw user layer;
    // this public projection cannot independently echo those two leaf values.
    if (read.config.tools != null && (!plain(read.config.tools)
      || read.config.tools.web_search != null)) throw fail('unsupported_effective_policy', 'Native web tool projection differs from admission');
    for (const layer of read.layers) {
      if (!plain(layer?.name) || !plain(layer.config) || layer.disabledReason != null) {
        throw fail('unsupported_effective_policy', 'Native configuration layer is unsupported');
      }
      const type = layer.name.type;
      if (['system', 'project'].includes(type) && Object.keys(layer.config).length === 0) continue;
      if (type === 'user' && path.resolve(layer.name.file || '') === paths.config && layer.name.profile == null
        && canonical(layer.config) === canonical(config)) continue;
      if (type === 'packagedDefaults') continue; // Exact pinned executable embeds these defaults.
      throw fail('unsupported_effective_policy', 'Native configuration has an unadmitted source');
    }
    // Re-probe local policy/config pins after bootstrap and before any thread/turn.
    for (const file of ['/etc/codex/config.toml', '/etc/codex/managed_config.toml', '/etc/codex/requirements.toml']) absent(file);
    (testHooks.probeManagedPreferences || probeManagedPreferences)();
    if (!regular(paths.config, 2 * 1024 * 1024).equals(Buffer.from(configText))
      || digest(regular(paths.catalog, 2 * 1024 * 1024)) !== catalog.sha256) {
      throw fail('admission_changed', 'Native admission changed after bootstrap');
    }
  }
  return Object.freeze({ availability, prestart, checkEffective, admissionId, paths, config,
    modelId: catalog.modelId, imageInput: Array.isArray(model.input_modalities) && model.input_modalities.includes('image'), provider, version: VERSION, source: SOURCE });
}
function toml(value) {
  if (plain(value)) return `{ ${Object.entries(value).map(([key, entry]) => `${JSON.stringify(key)} = ${toml(entry)}`).join(', ')} }`;
  if (Array.isArray(value)) return `[${value.map(toml).join(', ')}]`;
  return JSON.stringify(value);
}
function contains(actual, expected) {
  if (plain(expected)) return plain(actual) && Object.entries(expected).every(([key, value]) => contains(actual[key], value));
  return canonical(actual) === canonical(expected);
}
function freeze(value) {
  if (value && typeof value === 'object') { for (const entry of Object.values(value)) freeze(entry); Object.freeze(value); }
  return value;
}
module.exports = { makeAdmission, digest, fileDigest, canonical, fail, plain, freeze, privateDirectory, regular, VERSION, SOURCE, verifyWrapper, probeManagedPreferences, DISABLED_FEATURES, toml, contains, absent };
