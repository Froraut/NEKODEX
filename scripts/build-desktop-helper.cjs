const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { release } = require('node:os');

// macOS TCC keys a self-responsible bundled client by bundle identifier plus designated
// requirement, so the helper ships as a fixed app bundle; the bare executable is never shipped.
const DESKTOP_HELPER_IDENTIFIER = 'dev.nekodex.desktop-provider.v1';
const DESKTOP_HELPER_NAME = 'NEKODEX Desktop Helper';
// TCC keeps one row per service and bundle identifier, and toggling it never rewrites the code
// requirement recorded when the row was created. An ad-hoc DEV build that shared the release
// identifier recorded its own cdhash, so no signed release could match that row again. Ad-hoc
// builds therefore always carry this separate identity and name.
const DESKTOP_HELPER_DEVELOPMENT_IDENTIFIER = 'dev.nekodex.desktop-provider.development.v1';
const DESKTOP_HELPER_DEVELOPMENT_NAME = 'NEKODEX Desktop Helper (Development)';
const DESKTOP_HELPER_BUNDLE = `${DESKTOP_HELPER_NAME}.app`;
const DESKTOP_HELPER_EXECUTABLE = 'nekodex-desktop-helper';
const DESKTOP_HELPER_EXECUTABLE_PATH = `${DESKTOP_HELPER_BUNDLE}/Contents/MacOS/${DESKTOP_HELPER_EXECUTABLE}`;
const DESKTOP_HELPER_INFO_PLIST_PATH = `${DESKTOP_HELPER_BUNDLE}/Contents/Info.plist`;
/** Fixed bytes: no version or path, so the identity and seal inputs stay equal across releases.
 * `development` selects the separate ad-hoc identity; only a Developer ID build carries the release one. */
function desktopHelperInfoPlist({ development = false } = {}) {
  const identifier = development ? DESKTOP_HELPER_DEVELOPMENT_IDENTIFIER : DESKTOP_HELPER_IDENTIFIER;
  const name = development ? DESKTOP_HELPER_DEVELOPMENT_NAME : DESKTOP_HELPER_NAME;
  const entries = [['CFBundleDevelopmentRegion', 'en'], ['CFBundleDisplayName', name], ['CFBundleExecutable', DESKTOP_HELPER_EXECUTABLE],
    ['CFBundleIdentifier', identifier], ['CFBundleInfoDictionaryVersion', '6.0'], ['CFBundleName', name],
    ['CFBundlePackageType', 'APPL'], ['CFBundleShortVersionString', '1.0'], ['CFBundleVersion', '1'], ['LSMinimumSystemVersion', '14.0']];
  return '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
    + '<plist version="1.0">\n<dict>\n' + entries.map(([key, value]) => `\t<key>${key}</key>\n\t<string>${value}</string>\n`).join('')
    + '\t<key>LSUIElement</key>\n\t<true/>\n</dict>\n</plist>\n';
}
const realDirectory = target => { const stat = fs.lstatSync(target, { throwIfNoEntry: false }); return !!stat && stat.isDirectory() && !stat.isSymbolicLink(); };

/** Fixed native source/output. This leaf never requests permissions or launches the helper.
 * `releaseIdentity` is true only when `sign` applies a Developer ID signature; otherwise the bundle
 * carries the development identity and is signed ad hoc. */
function compileDesktopHelper({ repositoryRoot = path.resolve(__dirname, '..'), platform = process.platform,
  arch = process.arch, development = false, releaseIdentity = false, sign, env = process.env } = {}) {
  if (platform !== 'darwin') return { supported: false, executable: null, platform, arch };
  if (development && Number(release().split('.')[0]) < 23) return { supported: false, executable: null, platform, arch, reason: 'Native desktop helper requires macOS 14; the macOS 13 application remains usable without it' };
  if (!development && typeof sign !== 'function') throw new Error('Desktop helper distribution requires its explicit signing owner; use --development for local compilation');
  if (releaseIdentity && typeof sign !== 'function') throw new Error('The release desktop helper identity requires its Developer ID signing owner');
  const target = { arm64: 'arm64', x64: 'x86_64' }[arch]; if (!target) throw new Error('Unsupported desktop helper architecture');
  const root = fs.realpathSync(repositoryRoot); const source = path.join(root, 'launcher', 'native', 'desktop-provider.swift');
  if (!fs.lstatSync(source).isFile() || fs.realpathSync(source) !== source) throw new Error('Desktop helper source is not a canonical file');
  const locate = args => {
    const value = spawnSync('/usr/bin/xcrun', args, { env, shell: false, encoding: 'utf8', timeout: 15000 });
    if (value.status !== 0 || !path.isAbsolute(value.stdout?.trim() || '')) throw new Error('Desktop helper requires the selected Apple Swift compiler and macOS SDK');
    return value.stdout.trim();
  };
  const compiler = locate(['--find', 'swiftc']); const sdk = locate(['--sdk', 'macosx', '--show-sdk-path']);
  const directory = path.join(root, 'launcher', 'electron', 'desktop-helper', `${platform}-${arch}`);
  const bundle = path.join(directory, DESKTOP_HELPER_BUNDLE);
  const executable = path.join(directory, ...DESKTOP_HELPER_EXECUTABLE_PATH.split('/'));
  for (let current = root; current !== directory;) {
    const next = path.relative(current, directory).split(path.sep)[0]; current = path.join(current, next);
    if (!fs.existsSync(current)) fs.mkdirSync(current);
    const stat = fs.lstatSync(current); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Desktop helper build ancestry is unsafe');
  }
  const previous = fs.lstatSync(bundle, { throwIfNoEntry: false });
  if (previous && !realDirectory(bundle)) throw new Error('Desktop helper output changed');
  // Earlier builds emitted a bare executable here; it must not linger beside the bundle.
  const legacy = path.join(directory, DESKTOP_HELPER_EXECUTABLE); const legacyStat = fs.lstatSync(legacy, { throwIfNoEntry: false });
  if (legacyStat && (!legacyStat.isFile() || legacyStat.isSymbolicLink())) throw new Error('Desktop helper output changed');
  const staging = fs.mkdtempSync(path.join(directory, '.build-')); const candidate = path.join(staging, DESKTOP_HELPER_BUNDLE);
  const candidateExecutable = path.join(staging, ...DESKTOP_HELPER_EXECUTABLE_PATH.split('/'));
  try {
    fs.mkdirSync(path.dirname(candidateExecutable), { recursive: true });
    fs.writeFileSync(path.join(staging, ...DESKTOP_HELPER_INFO_PLIST_PATH.split('/')), desktopHelperInfoPlist({ development: !releaseIdentity }), { mode: 0o644 });
    const built = spawnSync(compiler, ['-parse-as-library', '-O', '-sdk', sdk, '-target', `${target}-apple-macos14.0`, source, '-o', candidateExecutable],
      { cwd: root, env, shell: false, stdio: 'inherit', timeout: 120000 });
    if (built.status !== 0) throw new Error('Desktop helper compilation failed; previous output retained');
    fs.chmodSync(candidateExecutable, 0o755);
    if (typeof sign === 'function') sign(candidate);
    else {
      const signed = spawnSync('/usr/bin/codesign', ['--force', '--sign', '-', '--identifier', DESKTOP_HELPER_DEVELOPMENT_IDENTIFIER, '--timestamp=none', candidate],
        { env, shell: false, encoding: 'utf8', timeout: 15000 });
      if (signed.status !== 0) throw new Error('Desktop helper development signature failed');
    }
    const current = fs.lstatSync(bundle, { throwIfNoEntry: false });
    if (!!current !== !!previous || current && (current.ino !== previous.ino || current.dev !== previous.dev || !realDirectory(bundle))) throw new Error('Another owner changed desktop helper output');
    const retired = path.join(staging, 'previous.app');
    if (current) fs.renameSync(bundle, retired);
    fs.renameSync(candidate, bundle);
    if (legacyStat) fs.rmSync(legacy, { force: true });
    return { supported: true, bundle, executable, identifier: releaseIdentity ? DESKTOP_HELPER_IDENTIFIER : DESKTOP_HELPER_DEVELOPMENT_IDENTIFIER, sha256: crypto.createHash('sha256').update(fs.readFileSync(executable)).digest('hex'), platform, arch };
  } finally { fs.rmSync(staging, { recursive: true, force: true }); }
}
module.exports = { compileDesktopHelper, desktopHelperInfoPlist, DESKTOP_HELPER_IDENTIFIER, DESKTOP_HELPER_NAME, DESKTOP_HELPER_BUNDLE,
  DESKTOP_HELPER_DEVELOPMENT_IDENTIFIER, DESKTOP_HELPER_DEVELOPMENT_NAME,
  DESKTOP_HELPER_EXECUTABLE, DESKTOP_HELPER_EXECUTABLE_PATH, DESKTOP_HELPER_INFO_PLIST_PATH };
if (require.main === module) {
  try {
    if (process.argv.slice(2).some(arg => arg !== '--development') || process.argv.length !== 3) throw new Error('Usage: node scripts/build-desktop-helper.cjs --development');
    process.stdout.write(JSON.stringify(compileDesktopHelper({ development: true })) + '\n');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
