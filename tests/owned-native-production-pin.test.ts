import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { mkdtempSync, realpathSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { reviewedOwnedNativeProductionPin, createOwnedNativeProductionManifest, validateOwnedNativeProductionManifest } = require('../launcher/electron/owned-native-production-pin.cjs');
const { WRAPPER_INFO } = require('../launcher/electron/owned-native-admission.cjs');

const fixtureRepository = dirname(dirname(fileURLToPath(import.meta.url)));
const bootstrapFixture = join(fixtureRepository, 'launcher/native/owned-worker/build/aarch64-apple-darwin/official-bootstrap-models.json');
// This focused packaged-artifact fixture uses the already accepted official data;
// source-only CI without staged Native artifacts does not fabricate that provenance.
test.skipIf(process.platform !== 'darwin' || process.arch !== 'arm64' || !existsSync(bootstrapFixture))('production Native requires sealed publisher origin and exact copied closure before a static probe', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'neko-production-native-')));
  try {
    const repository = dirname(dirname(fileURLToPath(import.meta.url))), source = join(repository, 'launcher/native/owned-worker');
    const app = join(root, 'NEKODEX.app'), resourcesPath = join(app, 'Contents/Resources');
    const mainExecutable = join(app, 'Contents/MacOS/NEKODEX'), sourceRoot = join(resourcesPath, 'runtime/app/owned-native');
    const target = 'aarch64-apple-darwin', output = join(sourceRoot, 'build', target), executable = join(output, WRAPPER_INFO.artifact);
    mkdirSync(dirname(mainExecutable), { recursive: true }); mkdirSync(join(sourceRoot, 'src'), { recursive: true }); mkdirSync(output, { recursive: true });
    writeFileSync(mainExecutable, 'inert Electron origin', { mode: 0o755 });
    for (const file of ['Cargo.toml', 'Cargo.lock', 'src/main.rs', 'source-pin.json', 'rust-toolchain.toml']) copyFileSync(join(source, file), join(sourceRoot, file));
    for (const file of ['build-info.json', 'official-bootstrap-models.json']) copyFileSync(join(source, 'build', target, file), join(output, file));
    const originalReceipt = readFileSync(join(output, 'build-info.json'));
    writeFileSync(executable, 'inert independently signed binary fixture', { mode: 0o755 });
    const manifest = createOwnedNativeProductionManifest({ sourceRoot, executable, target });
    writeFileSync(join(output, 'production-manifest.json'), JSON.stringify(manifest), { mode: 0o644 });
    const calls: any[] = []; let wrongPublisher = false;
    const run = (command: string, args: string[]) => {
      calls.push({ command, args });
      if (command === executable) return JSON.stringify(WRAPPER_INFO);
      expect(command).toBe('/usr/bin/codesign');
      if (args[0] === '--verify') return '';
      const identifier = args.at(-1) === app ? 'dev.codexwebgpt.launcher' : 'dev.nekodex.owned-native-worker.v1';
      return `Identifier=${identifier}\nTeamIdentifier=${wrongPublisher ? 'FOREIGNTEAM' : 'CNMWGJF2CG'}\nAuthority=Developer ID Application: Inert Publisher (CNMWGJF2CG)\nTimestamp=Oct 19 2026\nCodeDirectory v=20500 flags=0x10000(runtime)\n`;
    };
    const input = { resourcesPath, executablePath: mainExecutable };
    const pin = reviewedOwnedNativeProductionPin(input, { run });
    expect(pin.executable).toBe(executable); expect(pin.wrapperBuildPin.kind).toBe('publisher-signed-app');
    expect(calls.slice(0, 4).every(row => row.command === '/usr/bin/codesign')).toBe(true);
    expect(calls.at(-1)).toEqual({ command: executable, args: ['--build-info'] });
    expect(readFileSync(join(output, 'build-info.json'))).toEqual(originalReceipt);
    expect(JSON.parse(originalReceipt.toString()).developmentOnly).toBe(true);
    expect(validateOwnedNativeProductionManifest({ sourceRoot, executable, target }).distribution).toBe('publisher-signed-app');
    const staticCount = () => calls.filter(row => row.command === executable).length;
    writeFileSync(executable, 'changed binary fixture', { mode: 0o755 });
    expect(() => reviewedOwnedNativeProductionPin(input, { run })).toThrow('closure changed'); expect(staticCount()).toBe(1);
    writeFileSync(executable, 'inert independently signed binary fixture', { mode: 0o755 }); wrongPublisher = true;
    expect(() => reviewedOwnedNativeProductionPin(input, { run })).toThrow('publisher signature differs'); expect(staticCount()).toBe(1);
    expect(() => reviewedOwnedNativeProductionPin({ ...input, executablePath: '/bin/ls' }, { run })).toThrow('origin differs');
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 3000);
