const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { release } = require('node:os');

/** Fixed native source/output. This leaf never requests permissions or launches the helper. */
function compileDesktopHelper({ repositoryRoot = path.resolve(__dirname, '..'), platform = process.platform,
  arch = process.arch, development = false, sign, env = process.env } = {}) {
  if (platform !== 'darwin') return { supported: false, executable: null, platform, arch };
  if (development && Number(release().split('.')[0]) < 23) return { supported: false, executable: null, platform, arch, reason: 'Native desktop helper requires macOS 14; the macOS 13 application remains usable without it' };
  if (!development && typeof sign !== 'function') throw new Error('Desktop helper distribution requires its explicit signing owner; use --development for local compilation');
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
  const executable = path.join(directory, 'nekodex-desktop-helper');
  for (let current = root; current !== directory;) {
    const next = path.relative(current, directory).split(path.sep)[0]; current = path.join(current, next);
    if (!fs.existsSync(current)) fs.mkdirSync(current);
    const stat = fs.lstatSync(current); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Desktop helper build ancestry is unsafe');
  }
  const previous = fs.lstatSync(executable, { throwIfNoEntry: false });
  if (previous && (!previous.isFile() || previous.isSymbolicLink())) throw new Error('Desktop helper output changed');
  const staging = fs.mkdtempSync(path.join(directory, '.build-')); const candidate = path.join(staging, 'nekodex-desktop-helper');
  try {
    const built = spawnSync(compiler, ['-parse-as-library', '-O', '-sdk', sdk, '-target', `${target}-apple-macos14.0`, source, '-o', candidate],
      { cwd: root, env, shell: false, stdio: 'inherit', timeout: 120000 });
    if (built.status !== 0) throw new Error('Desktop helper compilation failed; previous output retained');
    fs.chmodSync(candidate, 0o755);
    if (typeof sign === 'function') sign(candidate);
    else {
      const signed = spawnSync('/usr/bin/codesign', ['--force', '--sign', '-', '--identifier', 'dev.nekodex.desktop-provider.v1', '--timestamp=none', candidate],
        { env, shell: false, encoding: 'utf8', timeout: 15000 });
      if (signed.status !== 0) throw new Error('Desktop helper development signature failed');
    }
    const current = fs.lstatSync(executable, { throwIfNoEntry: false });
    if (!!current !== !!previous || current && (current.ino !== previous.ino || current.dev !== previous.dev || current.isSymbolicLink())) throw new Error('Another owner changed desktop helper output');
    fs.renameSync(candidate, executable);
    return { supported: true, executable, sha256: crypto.createHash('sha256').update(fs.readFileSync(executable)).digest('hex'), platform, arch };
  } finally { fs.rmSync(staging, { recursive: true, force: true }); }
}
module.exports = { compileDesktopHelper };
if (require.main === module) {
  try {
    if (process.argv.slice(2).some(arg => arg !== '--development') || process.argv.length !== 3) throw new Error('Usage: node scripts/build-desktop-helper.cjs --development');
    process.stdout.write(JSON.stringify(compileDesktopHelper({ development: true })) + '\n');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
