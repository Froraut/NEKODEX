'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');

// Accepted macOS arm64 Native release inputs: the Owned Native worker build and
// the execution VM guest bundle. Both are reviewed local builds, not CI builds.
// The tracked lock pins every byte; the hosting release is only transport.
const LOCK = 'launcher/native/release-inputs.json';
const REPOSITORY = 'Froraut/NEKODEX';
const WORKER_OUTPUT = 'launcher/native/owned-worker/build/aarch64-apple-darwin/';
const GUEST_OUTPUT = 'launcher/native/execution-guest/.build/bundle/';
const WORKER_FILES = { executable: 'nekodex-owned-native-worker', metadata: 'build-info.json', catalog: 'official-bootstrap-models.json' };
const GUEST_REQUIRED = ['manifest.json', 'Image', 'initrd.gz'];
const fail = message => { throw new Error(`Native release inputs: ${message}`); };

function loadReleaseInputs(root = path.resolve(__dirname, '..')) {
  const raw = fs.readFileSync(path.join(root, LOCK), 'utf8'), lock = JSON.parse(raw);
  if (lock?.schemaVersion !== 1 || lock.repository !== REPOSITORY || lock.target !== 'darwin-arm64'
    || !/^native-inputs-[a-f0-9]{8}-[a-f0-9]{8}$/.test(lock.tag || '') || !Array.isArray(lock.files)) fail('lock has an unsupported shape');
  const assets = new Set(), paths = new Set();
  for (const entry of lock.files) {
    const allowed = [WORKER_OUTPUT, GUEST_OUTPUT].find(prefix => typeof entry?.path === 'string' && entry.path.startsWith(prefix));
    const name = allowed && entry.path.slice(allowed.length);
    if (!allowed || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name) || path.posix.normalize(entry.path) !== entry.path
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(entry.asset || '') || !/^[a-f0-9]{64}$/.test(entry.sha256 || '')
      || !Number.isSafeInteger(entry.size) || entry.size < 1 || entry.size > 1024 ** 3
      || (entry.executable !== undefined && entry.executable !== true) || assets.has(entry.asset) || paths.has(entry.path)) {
      fail(`lock entry is invalid: ${String(entry?.asset)}`);
    }
    assets.add(entry.asset); paths.add(entry.path);
  }
  for (const required of [...Object.values(WORKER_FILES).map(name => WORKER_OUTPUT + name), ...GUEST_REQUIRED.map(name => GUEST_OUTPUT + name)]) {
    if (!paths.has(required)) fail(`lock does not pin ${required}`);
  }
  if (lock.files.filter(entry => entry.executable).map(entry => entry.path).join() !== WORKER_OUTPUT + WORKER_FILES.executable) {
    fail('only the Owned Native worker may be executable');
  }
  return Object.freeze({ ...lock, files: Object.freeze(lock.files.map(entry => Object.freeze({ ...entry }))) });
}
const lockEntry = (lock, relative) => lock.files.find(entry => entry.path === relative) || fail(`lock does not pin ${relative}`);

function hashRegularFile(file, maximum = 1024 ** 3) {
  const before = fs.lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maximum || fs.realpathSync(file) !== path.resolve(file)) {
    fail(`${file} is not a canonical regular file`);
  }
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd);
    if (opened.ino !== before.ino || opened.dev !== before.dev) fail(`${file} changed while being checked`);
    const hash = crypto.createHash('sha256'), chunk = Buffer.allocUnsafe(1024 * 1024);
    for (;;) { const count = fs.readSync(fd, chunk, 0, chunk.length, null); if (!count) break; hash.update(chunk.subarray(0, count)); }
    const after = fs.fstatSync(fd);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) fail(`${file} changed while being checked`);
    return { sha256: hash.digest('hex'), size: before.size };
  } finally { fs.closeSync(fd); }
}
function verifyInputFile(file, entry) {
  const actual = hashRegularFile(file);
  if (actual.size !== entry.size || actual.sha256 !== entry.sha256) fail(`${entry.asset} differs from its pinned bytes`);
  return actual;
}
function verifyReleaseInputs({ root = path.resolve(__dirname, '..'), source = root, lock = loadReleaseInputs(root) } = {}) {
  source = fs.realpathSync(source);
  for (const entry of lock.files) verifyInputFile(path.join(source, entry.path), entry);
  return lock;
}

function ghDownload(lock, directory) {
  const patterns = lock.files.flatMap(entry => ['--pattern', entry.asset]);
  const result = spawnSync('gh', ['release', 'download', lock.tag, '--repo', lock.repository, '--dir', directory, ...patterns],
    { stdio: ['ignore', 'inherit', 'inherit'], shell: false, timeout: 20 * 60 * 1000 });
  if (result.error || result.status !== 0) fail(`could not download release ${lock.tag}`);
}
/** CI materializes the pinned inputs into the fixed local build layouts that
 * packaging already consumes. Existing files must already be the pinned bytes. */
function fetchReleaseInputs({ root = path.resolve(__dirname, '..'), lock = loadReleaseInputs(root), download = ghDownload } = {}) {
  root = fs.realpathSync(root);
  const pending = lock.files.filter(entry => {
    const destination = path.join(root, entry.path);
    if (!fs.existsSync(destination)) return true;
    verifyInputFile(destination, entry);
    return false;
  });
  if (!pending.length) return { fetched: 0 };
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nekodex-native-inputs-')));
  try {
    download({ ...lock, files: pending }, temporary);
    const received = fs.readdirSync(temporary).sort();
    if (received.join('\n') !== pending.map(entry => entry.asset).sort().join('\n')) fail('download returned unexpected files');
    for (const entry of pending) verifyInputFile(path.join(temporary, entry.asset), entry);
    for (const entry of pending) {
      const destination = path.join(root, entry.path);
      fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o755 });
      fs.copyFileSync(path.join(temporary, entry.asset), destination, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(destination, entry.executable ? 0o755 : 0o644);
      verifyInputFile(destination, entry);
    }
    return { fetched: pending.length };
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

/** Copies verified local inputs under their release asset names for upload. */
function stageReleaseInputs({ root = path.resolve(__dirname, '..'), source = root, lock = loadReleaseInputs(root), out } = {}) {
  verifyReleaseInputs({ root, source, lock });
  fs.mkdirSync(out, { mode: 0o755 });
  out = fs.realpathSync(out);
  for (const entry of lock.files) {
    const destination = path.join(out, entry.asset);
    fs.copyFileSync(path.join(fs.realpathSync(source), entry.path), destination, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(destination, 0o644);
    verifyInputFile(destination, entry);
  }
  return out;
}
function gh(args) {
  const result = spawnSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], shell: false });
  if (result.error || result.status !== 0) fail(`GitHub release operation failed: ${args.slice(0, 2).join(' ')}`);
  return result.stdout;
}
/** Maintainer-only: publishes the transport release, then checks GitHub's digests
 * before it leaves draft state. The tag is content-named and never reused. */
function publishReleaseInputs({ root = path.resolve(__dirname, '..'), source = root, lock = loadReleaseInputs(root) } = {}) {
  if (spawnSync('gh', ['release', 'view', lock.tag, '--repo', lock.repository], { stdio: 'ignore' }).status === 0) fail(`${lock.tag} already exists`);
  const out = path.join(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nekodex-native-inputs-stage-'))), 'assets');
  try {
    stageReleaseInputs({ root, source, lock, out });
    const notes = path.join(path.dirname(out), 'notes.md');
    fs.writeFileSync(notes, `Build inputs for CI-built NEKODEX macOS arm64 releases. Not an installable NEKODEX release.\n\n`
      + `Release packaging accepts these files only when their bytes match \`${LOCK}\` in the reviewed source. `
      + 'See docs/development/native-release-inputs.md.\n');
    gh(['release', 'create', lock.tag, ...lock.files.map(entry => path.join(out, entry.asset)), '--repo', lock.repository,
      '--draft', '--prerelease', '--latest=false', '--title', `Native release inputs ${lock.tag.slice('native-inputs-'.length)}`, '--notes-file', notes]);
    const remote = JSON.parse(gh(['release', 'view', lock.tag, '--repo', lock.repository, '--json', 'assets']));
    if (remote.assets.length !== lock.files.length) fail('draft asset count mismatch; draft remains unpublished');
    for (const entry of lock.files) {
      const asset = remote.assets.find(item => item.name === entry.asset);
      if (asset?.digest !== `sha256:${entry.sha256}` || asset.size !== entry.size) fail(`draft digest mismatch for ${entry.asset}; draft remains unpublished`);
    }
    gh(['release', 'edit', lock.tag, '--repo', lock.repository, '--draft=false', '--prerelease', '--latest=false']);
  } finally { fs.rmSync(path.dirname(out), { recursive: true, force: true }); }
}

/** Packaging admission of the accepted worker by content, independent of the
 * checkout path it was built in. Same pins as the development receipt, minus
 * its absolute-path binding; the production manifest records hashes only. */
function acceptedOwnedNativeInput(root, { platform = process.platform, arch = process.arch, probe } = {}) {
  if (platform !== 'darwin' || arch !== 'arm64') fail('the accepted Owned Native build targets macOS arm64');
  root = fs.realpathSync(root);
  const { WRAPPER_INFO, canonical, digest, fileDigest, regular } = require(path.join(root, 'launcher/electron/owned-native-admission.cjs'));
  const { REVIEWED_OWNED_NATIVE_DEV_PIN: PIN } = require(path.join(root, 'launcher/electron/owned-native-dev-pin.cjs'));
  const lock = loadReleaseInputs(root);
  if (lockEntry(lock, WORKER_OUTPUT + WORKER_FILES.executable).sha256 !== PIN.executableSha256
    || lockEntry(lock, WORKER_OUTPUT + WORKER_FILES.metadata).sha256 !== PIN.metadataSha256) fail('lock and reviewed Owned Native pin disagree');
  const sourceRoot = fs.realpathSync(path.join(root, 'launcher/native/owned-worker'));
  const output = path.join(sourceRoot, 'build', PIN.target);
  const executable = path.join(output, WORKER_FILES.executable), metadataPath = path.join(output, WORKER_FILES.metadata);
  const catalogPath = path.join(output, WORKER_FILES.catalog);
  if (fileDigest(executable) !== PIN.executableSha256) fail('Owned Native executable differs from the reviewed pin');
  const metadataBytes = regular(metadataPath, 16384);
  if (digest(metadataBytes) !== PIN.metadataSha256) fail('Owned Native build receipt differs from the reviewed pin');
  const metadata = JSON.parse(metadataBytes);
  for (const [key, expected] of Object.entries(WRAPPER_INFO)) if (metadata[key] !== expected) fail('Owned Native build policy differs');
  if (metadata.target !== PIN.target || metadata.sha256 !== PIN.executableSha256 || metadata.bytes !== fs.statSync(executable).size) {
    fail('Owned Native binary is not bound to its build receipt');
  }
  for (const [file, key] of [['Cargo.toml', 'manifestSha256'], ['Cargo.lock', 'cargoLockSha256'], ['src/main.rs', 'mainSha256']]) {
    if (fileDigest(path.join(sourceRoot, file), 2 * 1024 * 1024) !== metadata[key]) fail(`Owned Native source ${file} differs from the accepted build`);
  }
  const sourcePin = regular(path.join(sourceRoot, 'source-pin.json'), 16384);
  if (digest(sourcePin) !== PIN.sourcePinSha256 || canonical(JSON.parse(sourcePin)) !== canonical(WRAPPER_INFO)) fail('Owned Native source pin differs');
  if (fileDigest(catalogPath, 1024 * 1024) !== metadata.officialBootstrapCatalog?.sha256
    || lockEntry(lock, WORKER_OUTPUT + WORKER_FILES.catalog).sha256 !== metadata.officialBootstrapCatalog.sha256) fail('Owned Native bootstrap catalog differs');
  // Every byte pin above passes before the static build-info branch runs.
  const reported = (probe || (file => execFileSync(file, ['--build-info'], { encoding: 'utf8', timeout: 10_000, maxBuffer: 16384,
    env: { PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'pipe', 'ignore'] })))(executable);
  if (canonical(JSON.parse(reported)) !== canonical(WRAPPER_INFO)) fail('Owned Native reported unsupported runtime options');
  return { executable, executableSha256: PIN.executableSha256, metadataPath, metadataSha256: PIN.metadataSha256,
    catalogPath, sourceRoot, sourcePinSha256: PIN.sourcePinSha256, target: PIN.target };
}
/** The guest manifest is pinned by the lock; it pins kernel and initrd bytes and
 * names the guest source closure, which must match the reviewed tree. */
function assertAcceptedExecutionGuest(root, guestManifestBytes) {
  root = fs.realpathSync(root);
  const lock = loadReleaseInputs(root);
  if (crypto.createHash('sha256').update(guestManifestBytes).digest('hex') !== lockEntry(lock, GUEST_OUTPUT + 'manifest.json').sha256) {
    fail('execution VM guest manifest differs from the accepted lock');
  }
  const guest = JSON.parse(guestManifestBytes.toString('utf8'));
  if (lockEntry(lock, GUEST_OUTPUT + 'Image').sha256 !== guest.kernel?.sha256 || lockEntry(lock, GUEST_OUTPUT + 'initrd.gz').sha256 !== guest.initrd?.sha256) {
    fail('execution VM guest lock and manifest disagree');
  }
  const sources = guest.sourceSha256;
  if (!sources || typeof sources !== 'object' || !Object.keys(sources).length) fail('execution VM guest manifest has no source closure');
  for (const [name, expected] of Object.entries(sources)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) fail('execution VM guest source name is invalid');
    if (hashRegularFile(path.join(root, 'launcher/native/execution-guest', name), 2 * 1024 * 1024).sha256 !== expected) {
      fail(`execution VM guest source ${name} differs from the accepted image`);
    }
  }
  return guest;
}

module.exports = { loadReleaseInputs, verifyReleaseInputs, fetchReleaseInputs, stageReleaseInputs, publishReleaseInputs,
  acceptedOwnedNativeInput, assertAcceptedExecutionGuest, LOCK };

if (require.main === module) {
  const [command, ...rest] = process.argv.slice(2);
  const option = name => { const index = rest.indexOf(name); return index >= 0 ? path.resolve(rest[index + 1] || fail(`${name} needs a value`)) : undefined; };
  const source = option('--from');
  try {
    if (command === 'verify') verifyReleaseInputs({ source });
    else if (command === 'fetch') console.log(JSON.stringify(fetchReleaseInputs()));
    else if (command === 'stage') stageReleaseInputs({ source, out: option('--out') || fail('stage needs --out <new directory>') });
    else if (command === 'publish') publishReleaseInputs({ source });
    else fail('usage: native-release-inputs.cjs verify|fetch|stage --out <dir>|publish [--from <accepted checkout>]');
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
