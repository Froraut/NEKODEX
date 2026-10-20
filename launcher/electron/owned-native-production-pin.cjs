'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { WRAPPER_INFO, canonical, digest, fail } = require('./owned-native-admission.cjs');
const TEAM = 'CNMWGJF2CG', APP_ID = 'dev.codexwebgpt.launcher', IDENTIFIER = 'dev.nekodex.owned-native-worker.v1';
const BOOTSTRAP_SHA = '943ca7fe1d19ed019054158303f0dbbd80b3bef43b3aa425a71aa7cb3fb52c2b';
const TARGETS = { arm64: 'aarch64-apple-darwin', x64: 'x86_64-apple-darwin' };
const SOURCE_FILES = { 'Cargo.toml': 'manifestSha256', 'Cargo.lock': 'cargoLockSha256', 'src/main.rs': 'mainSha256' };
function check(value, message) { if (!value) throw fail('production_native_unavailable', message); }
function stat(file, maximum) {
  const s = fs.lstatSync(file);
  check(fs.realpathSync(file) === file && s.isFile() && !s.isSymbolicLink() && s.nlink === 1 && !(s.mode & 0o022)
    && [0, process.getuid()].includes(s.uid) && s.size > 0 && s.size <= maximum, 'Production Native artifact is not a fixed regular file');
  return s;
}
function read(file, maximum = 16384) {
  const before = stat(file, maximum), fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd); check(before.dev === opened.dev && before.ino === opened.ino, 'Production Native artifact changed');
    const bytes = fs.readFileSync(fd), after = fs.lstatSync(file);
    check(['dev', 'ino', 'size', 'mode', 'mtimeMs', 'ctimeMs'].every(key => before[key] === after[key]), 'Production Native artifact changed');
    return bytes;
  } finally { fs.closeSync(fd); }
}
function hashFile(file) {
  const before = stat(file, 512 * 1024 * 1024), fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd); check(before.dev === opened.dev && before.ino === opened.ino, 'Production Native binary changed');
    const hash = createHash('sha256'), chunk = Buffer.allocUnsafe(1024 * 1024);
    for (;;) { const count = fs.readSync(fd, chunk, 0, chunk.length, null); if (!count) break; hash.update(chunk.subarray(0, count)); }
    const after = fs.lstatSync(file);
    check(['dev', 'ino', 'size', 'mode', 'mtimeMs', 'ctimeMs'].every(key => before[key] === after[key]), 'Production Native binary changed');
    return { sha256: hash.digest('hex'), bytes: before.size };
  } finally { fs.closeSync(fd); }
}
function layout(sourceRoot, target) {
  check(Object.values(TARGETS).includes(target) && fs.realpathSync(sourceRoot) === sourceRoot, 'Production Native target/root is invalid');
  const output = path.join(sourceRoot, 'build', target);
  return { output, executable: path.join(output, WRAPPER_INFO.artifact), metadataPath: path.join(output, 'build-info.json'),
    catalogPath: path.join(output, 'official-bootstrap-models.json'), manifestPath: path.join(output, 'production-manifest.json') };
}
/** Packaging-only pure producer: the original build receipt remains unchanged.
 * Signing changes Mach-O bytes, so original and distributed digests stay distinct. */
function createOwnedNativeProductionManifest({ sourceRoot, executable, target }) {
  const p = layout(sourceRoot, target); check(executable === p.executable, 'Production Native executable layout differs');
  const metadataBytes = read(p.metadataPath), metadata = JSON.parse(metadataBytes);
  const sourceBytes = read(path.join(sourceRoot, 'source-pin.json'));
  check(canonical(JSON.parse(sourceBytes)) === canonical(WRAPPER_INFO), 'Production Native source policy differs');
  for (const [key, expected] of Object.entries(WRAPPER_INFO)) check(metadata[key] === expected, 'Production Native original build policy differs');
  check(metadata.target === target && /^[a-f0-9]{64}$/.test(metadata.sha256 || '') && Number.isSafeInteger(metadata.bytes)
    && metadata.bytes > 0, 'Production Native original build receipt differs');
  const sourceFiles = {};
  for (const [file, key] of Object.entries(SOURCE_FILES)) {
    const hash = digest(read(path.join(sourceRoot, file), 2 * 1024 * 1024));
    check(hash === metadata[key], 'Production Native source closure differs from its original build receipt'); sourceFiles[file] = hash;
  }
  const toolchain = read(path.join(sourceRoot, 'rust-toolchain.toml'));
  check(toolchain.toString('utf8') === '[toolchain]\nchannel = "1.95.0"\nprofile = "minimal"\n', 'Production Native toolchain source differs');
  const toolchainSha256 = digest(toolchain);
  const bootstrap = read(p.catalogPath, 1024 * 1024);
  check(digest(bootstrap) === BOOTSTRAP_SHA && metadata.officialBootstrapCatalog?.sha256 === BOOTSTRAP_SHA
    && metadata.officialBootstrapCatalog?.codexRevision === WRAPPER_INFO.codexRevision && metadata.officialBootstrapCatalog?.bootstrapOnly === true,
  'Production Native official bootstrap provenance differs');
  const binary = hashFile(executable);
  return { schemaVersion: 1, artifact: WRAPPER_INFO.artifact, distribution: 'publisher-signed-app', target,
    publisherTeamId: TEAM, identifier: IDENTIFIER, sourcePinSha256: digest(sourceBytes), buildInfoSha256: digest(metadataBytes),
    unsignedExecutableSha256: metadata.sha256, executableSha256: binary.sha256, executableBytes: binary.bytes,
    sourceFiles, toolchainSha256, officialBootstrapCatalog: { sha256: BOOTSTRAP_SHA, bytes: bootstrap.length } };
}
function validateOwnedNativeProductionManifest(input) {
  const p = layout(input.sourceRoot, input.target), bytes = read(p.manifestPath, 65536), manifest = JSON.parse(bytes);
  check(canonical(manifest) === canonical(createOwnedNativeProductionManifest(input)), 'Production Native sealed artifact closure changed');
  return manifest;
}
function run(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', timeout: 15000, maxBuffer: 65536,
    env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }, stdio: ['ignore', 'pipe', 'pipe'] });
}
function publisher(target, identifier, execute) {
  execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', target]);
  const details = execute('/usr/bin/codesign', ['--display', '--verbose=4', target]);
  // codesign writes display metadata to stderr, so the default runner captures it.
  check(details.split(/\r?\n/).includes(`Identifier=${identifier}`) && details.split(/\r?\n/).includes(`TeamIdentifier=${TEAM}`)
    && /^Authority=Developer ID Application: .+ \(CNMWGJF2CG\)$/m.test(details) && /^Timestamp=.+$/m.test(details)
    && !/^Signature=adhoc$/m.test(details) && /flags=0x[0-9a-f]+\([^\n)]*runtime[^\n)]*\)/i.test(details), 'Production Native publisher signature differs');
}
function bundleLayout(resourcesPath, executablePath) {
  check(typeof resourcesPath === 'string' && path.isAbsolute(resourcesPath) && fs.realpathSync(resourcesPath) === resourcesPath
    && path.basename(resourcesPath) === 'Resources' && path.basename(path.dirname(resourcesPath)) === 'Contents', 'Production Native requires the fixed installed app resources');
  const appBundlePath = path.dirname(path.dirname(resourcesPath));
  check(path.basename(appBundlePath).endsWith('.app') && fs.realpathSync(appBundlePath) === appBundlePath
    && executablePath === path.join(appBundlePath, 'Contents', 'MacOS', 'NEKODEX') && fs.realpathSync(executablePath) === executablePath,
  'Production Native app executable origin differs');
  return { appBundlePath, sourceRoot: path.join(resourcesPath, 'runtime', 'app', 'owned-native') };
}
/** Revalidated at account prestart. No source checkout, environment or PATH fallback. */
function verifyOwnedNativeProductionWrapper(executable, executableSha256, pin, hooks = {}) {
  check(process.platform === 'darwin' && TARGETS[process.arch], 'Production Native is unavailable on this platform');
  const origin = bundleLayout(pin.resourcesPath, pin.mainExecutablePath), p = layout(origin.sourceRoot, TARGETS[process.arch]);
  check(pin.kind === 'publisher-signed-app' && pin.appBundlePath === origin.appBundlePath && pin.sourceRoot === origin.sourceRoot
    && executable === p.executable && pin.metadataPath === p.metadataPath, 'Production Native admission layout differs');
  const execute = hooks.run || runWithMetadata;
  publisher(origin.appBundlePath, APP_ID, execute); publisher(executable, IDENTIFIER, execute);
  const manifestBytes = read(p.manifestPath, 65536), manifest = JSON.parse(manifestBytes);
  check(digest(manifestBytes) === pin.productionManifestSha256 && manifest.executableSha256 === executableSha256
    && manifest.buildInfoSha256 === pin.metadataSha256 && manifest.sourcePinSha256 === pin.sourcePinSha256,
  'Production Native sealed admission pins changed');
  validateOwnedNativeProductionManifest({ sourceRoot: origin.sourceRoot, executable, target: TARGETS[process.arch] });
  let reported;
  try { reported = JSON.parse(execute(executable, ['--build-info'])); }
  catch { throw fail('production_native_unavailable', 'Production Native static build receipt is unavailable'); }
  check(canonical(reported) === canonical(WRAPPER_INFO), 'Production Native reported runtime policy differs');
}
function runWithMetadata(command, args) {
  // Preserve stderr only for the fixed codesign display operation; helper probes
  // return stdout and never run with credentials or a profile environment.
  if (command === '/usr/bin/codesign') {
    const { spawnSync } = require('node:child_process');
    const result = spawnSync(command, args, { encoding: 'utf8', timeout: 15000, maxBuffer: 65536,
      env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    check(!result.error && result.status === 0, 'Production Native signature verification failed');
    return `${result.stdout || ''}\n${result.stderr || ''}`;
  }
  return run(command, args);
}
function reviewedOwnedNativeProductionPin({ resourcesPath, executablePath = process.execPath }, hooks = {}) {
  check(process.platform === 'darwin' && TARGETS[process.arch], 'Production Native is unavailable on this platform');
  const origin = bundleLayout(resourcesPath, executablePath), target = TARGETS[process.arch], p = layout(origin.sourceRoot, target);
  const manifestBytes = read(p.manifestPath, 65536), manifest = JSON.parse(manifestBytes);
  const wrapperBuildPin = { kind: 'publisher-signed-app', ...origin, resourcesPath, mainExecutablePath: executablePath,
    metadataPath: p.metadataPath, metadataSha256: manifest.buildInfoSha256, sourcePinSha256: manifest.sourcePinSha256,
    productionManifestSha256: digest(manifestBytes) };
  verifyOwnedNativeProductionWrapper(p.executable, manifest.executableSha256, wrapperBuildPin, hooks);
  return { executable: p.executable, executableSha256: manifest.executableSha256, wrapperBuildPin, target,
    officialBootstrapCatalog: { path: p.catalogPath, sha256: BOOTSTRAP_SHA, bytes: manifest.officialBootstrapCatalog.bytes,
      sourceRelativePath: 'codex-rs/models-manager/models.json', codexRevision: WRAPPER_INFO.codexRevision, bootstrapOnly: true } };
}
function readProductionNativeBootstrap(pin) {
  const p = layout(pin.wrapperBuildPin.sourceRoot, pin.target);
  check(pin.wrapperBuildPin.kind === 'publisher-signed-app' && pin.officialBootstrapCatalog?.path === p.catalogPath,
    'Production Native bootstrap layout differs');
  const bytes = read(p.catalogPath, 1024 * 1024); check(digest(bytes) === BOOTSTRAP_SHA, 'Production Native bootstrap bytes changed'); return bytes;
}
module.exports = { reviewedOwnedNativeProductionPin, verifyOwnedNativeProductionWrapper, createOwnedNativeProductionManifest,
  readProductionNativeBootstrap, validateOwnedNativeProductionManifest, NATIVE_PUBLISHER_TEAM_ID: TEAM, NATIVE_HELPER_IDENTIFIER: IDENTIFIER };
