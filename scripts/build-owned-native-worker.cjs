'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');

const SOURCE = '83086188ae0614bd882818ff1aa23f3194962012';
const TOOLCHAIN = '1.95.0';
const NAME = 'nekodex-owned-native-worker';
const BUNDLED_CATALOG_SHA256 = '943ca7fe1d19ed019054158303f0dbbd80b3bef43b3aa425a71aa7cb3fb52c2b';
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** Copy only pinned official bootstrap data; this proves no account availability. */
function publishOfficialBootstrapCatalog({ directory, artifacts }) {
  const source = `git+https://github.com/openai/codex.git?rev=${SOURCE}#${SOURCE}`;
  const host = `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin`;
  const result = spawnSync('cargo', [`+${TOOLCHAIN}`, 'metadata', '--offline', '--locked', '--format-version', '1', '--filter-platform', host,
    '--manifest-path', path.join(directory, 'Cargo.toml')], {
    cwd: directory, encoding: 'utf8', timeout: 30000, maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, CARGO_TARGET_DIR: path.join(directory, 'target') },
  });
  if (result.error || result.status !== 0) throw new Error('Offline official catalog source resolution failed');
  const matches = JSON.parse(result.stdout).packages.filter(entry => entry.name === 'codex-models-manager' && entry.source === source);
  if (matches.length !== 1) throw new Error('Exact official models-manager source is required');
  const catalogSource = path.join(path.dirname(matches[0].manifest_path), 'models.json');
  const stat = fs.lstatSync(catalogSource);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1048576 || sha256(catalogSource) !== BUNDLED_CATALOG_SHA256) {
    throw new Error('Official bundled catalog pin mismatch');
  }
  const catalog = path.join(artifacts, 'official-bootstrap-models.json');
  const temporary = `${catalog}.${crypto.randomUUID()}.tmp`;
  try {
    fs.copyFileSync(catalogSource, temporary, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(temporary, 0o600);
    fs.renameSync(temporary, catalog);
  } finally { fs.rmSync(temporary, { force: true }); }
  return { path: catalog, sha256: BUNDLED_CATALOG_SHA256, bytes: stat.size,
    sourceRelativePath: 'codex-rs/models-manager/models.json', codexRevision: SOURCE, bootstrapOnly: true };
}

/** Builds one DEV Mac helper, never launches app-server/profile/model/release work. */
async function buildOwnedNativeWorker({ development = false, resolveLock = false,
  repositoryRoot = path.resolve(__dirname, '..') } = {}) {
  if (!development) throw new Error('Use explicit --development; distribution is a separate owner');
  if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(process.arch)) throw new Error('Owned Native worker is Mac-first');
  const root = fs.realpathSync(repositoryRoot);
  const directory = path.join(root, 'launcher', 'native', 'owned-worker');
  const manifest = path.join(directory, 'Cargo.toml'), lockfile = path.join(directory, 'Cargo.lock');
  const sourcePin = JSON.parse(fs.readFileSync(path.join(directory, 'source-pin.json'), 'utf8'));
  if (sourcePin.codexRevision !== SOURCE || sourcePin.rustToolchain !== TOOLCHAIN || !sourcePin.developmentOnly) throw new Error('Owned Native source pin changed');
  const host = `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin`;
  const target = path.join(directory, 'target'), output = path.join(directory, 'build');
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  const ownerPath = path.join(output, 'owner.lock'), checkpoint = path.join(output, 'checkpoint.json');
  const nonce = crypto.randomUUID(); const owner = JSON.stringify({ pid: process.pid, nonce, startedAt: new Date().toISOString() });
  try { fs.writeFileSync(ownerPath, owner, { flag: 'wx', mode: 0o600 }); }
  catch { throw new Error('Another or stale owned-worker build exists; inspect build/owner.lock and checkpoint before recovery'); }
  const logPath = path.join(output, 'build.log');
  const log = fs.openSync(logPath, 'w', 0o600);
  let child = null, interrupted = false;
  const state = { schemaVersion: 1, ownerPid: process.pid, ownerNonce: nonce,
    cargoPid: null, startedAt: new Date().toISOString(), updatedAt: null, phase: 'prepared',
    source: SOURCE, toolchain: TOOLCHAIN, target: host, developmentOnly: true,
    deploymentTargetRequested: '13.0', manifest, lockfile, targetDirectory: target,
    logPath, logBytes: 0, lastProgress: null, exitCode: null };
  function save(phase, extra = {}) {
    Object.assign(state, extra, { phase, updatedAt: new Date().toISOString() });
    const temporary = `${checkpoint}.${nonce}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, checkpoint);
  }
  function stop(signal) {
    interrupted = true;
    if (child?.pid) { try { process.kill(-child.pid, signal); } catch (reason) { if (reason.code !== 'ESRCH') throw reason; } }
  }
  const onInterrupt = () => stop('SIGINT'), onTerminate = () => stop('SIGTERM');
  process.on('SIGINT', onInterrupt); process.on('SIGTERM', onTerminate);
  async function cargo(phase, args) {
    if (interrupted) throw new Error('Owned build interrupted');
    save(phase); process.stdout.write(`${JSON.stringify({ phase, checkpoint, logPath })}\n`);
    // Project-selected toolchain; preserve shared Cargo/rustup caches and global defaults.
    const env = { ...process.env, CARGO_TARGET_DIR: target, MACOSX_DEPLOYMENT_TARGET: '13.0' };
    delete env.RUSTUP_TOOLCHAIN; delete env.RUSTFLAGS; delete env.CARGO_ENCODED_RUSTFLAGS;
    child = spawn('cargo', [`+${TOOLCHAIN}`, ...args], { cwd: directory, env,
      detached: true, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    save(phase, { cargoPid: child.pid || null });
    let text = '', lastSaved = 0;
    const receive = chunk => {
      fs.writeSync(log, chunk); state.logBytes += chunk.length;
      text += chunk.toString();
      const lines = text.split('\n'); text = lines.pop().slice(-4096);
      if (lines.length) state.lastProgress = lines.at(-1).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 512);
      if (Date.now() - lastSaved > 1000) { lastSaved = Date.now(); save(phase); }
    };
    child.stdout.on('data', receive); child.stderr.on('data', receive);
    const running = child;
    const code = await new Promise((resolve, reject) => {
      running.once('error', reject);
      running.once('close', (code, signal) => resolve(code ?? (signal ? 128 : 1)));
    });
    child = null; save(phase, { cargoPid: null, exitCode: code });
    if (code !== 0) throw new Error(`Owned Native ${phase} failed (${code}); inspect ${logPath}`);
  }
  try {
    save('prepared');
    if (resolveLock) await cargo('resolve-lock', ['generate-lockfile', '--offline', '--manifest-path', manifest]);
    if (!fs.existsSync(lockfile)) throw new Error('Own Cargo.lock is required; first use --resolve-lock after reviewing the manifest');
    const lockText = fs.readFileSync(lockfile, 'utf8');
    if (!lockText.includes(`git+https://github.com/openai/codex.git?rev=${SOURCE}#${SOURCE}`)) throw new Error('Cargo.lock does not contain the exact admitted Codex source');
    const jobs = Math.max(1, Math.min(4, os.availableParallelism()));
    await cargo('compile', ['build', '--offline', '--locked', '--manifest-path', manifest, '--target', host, '--bin', NAME, '--jobs', String(jobs)]);
    const built = path.join(target, host, 'debug', NAME);
    const stat = fs.lstatSync(built); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Built helper is not a regular file');
    const artifacts = path.join(output, host); fs.mkdirSync(artifacts, { recursive: true, mode: 0o700 });
    const executable = path.join(artifacts, NAME), candidate = `${executable}.${nonce}.tmp`;
    try { fs.copyFileSync(built, candidate, fs.constants.COPYFILE_EXCL); fs.chmodSync(candidate, 0o755); fs.renameSync(candidate, executable); }
    finally { fs.rmSync(candidate, { force: true }); }
    const metadata = { ...sourcePin, builtAt: new Date().toISOString(), target: host,
      deploymentTargetRequested: '13.0', minimumOSVerified: false, executable, bytes: fs.statSync(executable).size,
      sha256: sha256(executable), cargoLockSha256: sha256(lockfile), manifestSha256: sha256(manifest),
      mainSha256: sha256(path.join(directory, 'src', 'main.rs')),
      resolvedPackages: (lockText.match(/^\[\[package\]\]$/gm) || []).length,
      runtimeVerified: false, realProviderVerified: false };
    metadata.officialBootstrapCatalog = publishOfficialBootstrapCatalog({ directory, artifacts });
    fs.writeFileSync(path.join(artifacts, 'build-info.json'), `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });
    save('compiled', { executable, bytes: metadata.bytes, sha256: metadata.sha256, exitCode: 0 });
    return metadata;
  } catch (reason) {
    save(interrupted ? 'interrupted' : 'failed', { cargoPid: null, error: reason.message });
    throw reason;
  } finally {
    process.removeListener('SIGINT', onInterrupt); process.removeListener('SIGTERM', onTerminate);
    fs.closeSync(log);
    if (fs.readFileSync(ownerPath, 'utf8') === owner) fs.unlinkSync(ownerPath);
  }
}
module.exports = { buildOwnedNativeWorker, publishOfficialBootstrapCatalog };
if (require.main === module) {
  const args = process.argv.slice(2);
  if (!args.includes('--development') || args.some(arg => !['--development', '--resolve-lock'].includes(arg))
    || new Set(args).size !== args.length) {
    console.error('Usage: node scripts/build-owned-native-worker.cjs --development [--resolve-lock]'); process.exitCode = 1;
  } else buildOwnedNativeWorker({ development: true, resolveLock: args.includes('--resolve-lock') })
    .then(value => process.stdout.write(`${JSON.stringify(value)}\n`))
    .catch(reason => { console.error(reason.message); process.exitCode = 1; });
}
