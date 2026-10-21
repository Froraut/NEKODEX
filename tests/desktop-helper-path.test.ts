import { expect, test } from 'bun:test';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { DESKTOP_HELPER_BUNDLE, DESKTOP_HELPER_EXECUTABLE_PATH, ensureStableDesktopHelper, insideAnotherAppBundle, resolveDesktopHelper,
  resolveDevelopmentDesktopHelper, stableDesktopHelperRoot } from '../src/browser-companion/desktop-helper-path';

const builder = createRequire(import.meta.url)('../scripts/build-desktop-helper.cjs');
const signing = createRequire(import.meta.url)('../launcher/scripts/release-signing.cjs');

/** Inert bundle fixture; never executed. */
function writeBundle(directory: string, bytes: string | Buffer = 'inert resolver fixture; never executed', plist: string = builder.desktopHelperInfoPlist()) {
  const executable = join(directory, ...DESKTOP_HELPER_EXECUTABLE_PATH.split('/'));
  mkdirSync(join(directory, DESKTOP_HELPER_BUNDLE, 'Contents', 'MacOS'), { recursive: true });
  writeFileSync(join(directory, DESKTOP_HELPER_BUNDLE, 'Contents', 'Info.plist'), plist);
  writeFileSync(executable, bytes, { mode: 0o755 });
  return executable;
}

test('runtime resolver and builder agree on the fixed bundle and its stable TCC identity', () => {
  expect(DESKTOP_HELPER_BUNDLE).toBe(builder.DESKTOP_HELPER_BUNDLE);
  expect(DESKTOP_HELPER_EXECUTABLE_PATH).toBe(builder.DESKTOP_HELPER_EXECUTABLE_PATH);
  const plist: string = builder.desktopHelperInfoPlist();
  expect(plist).toContain('<key>CFBundleIdentifier</key>\n\t<string>dev.nekodex.desktop-provider.v1</string>');
  expect(plist).toContain('<key>CFBundleExecutable</key>\n\t<string>nekodex-desktop-helper</string>');
  expect(plist).toContain('<key>LSUIElement</key>\n\t<true/>');
  // No release version or path: identity inputs stay byte-equal across updates.
  expect(plist).not.toMatch(/\d+\.\d+\.\d+|nekodex\.\d|\/Users\//);
  expect(builder.desktopHelperInfoPlist()).toBe(plist);
});

test.skipIf(process.platform === 'win32')('desktop helper relocation uses its own bundle and refuses changed DEV pins without source fallback', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nekodex-desktop-layout-')));
  try {
    const app = join(root, 'app'); const helperDirectory = join(app, 'desktop-helper', 'darwin-arm64');
    const bytes = Buffer.from('inert resolver fixture; never executed');
    const helper = writeBundle(helperDirectory, bytes);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const options = { runtimeEntry: join(app, 'cli.js'), platform: 'darwin' as const, arch: 'arm64' };
    expect(resolveDesktopHelper(options)).toEqual({ executable: helper, sha256 });
    const moved = join(root, 'relocated', 'app'); const movedDirectory = join(moved, 'desktop-helper', 'darwin-arm64');
    mkdirSync(movedDirectory, { recursive: true });
    cpSync(join(helperDirectory, DESKTOP_HELPER_BUNDLE), join(movedDirectory, DESKTOP_HELPER_BUNDLE), { recursive: true });
    const movedHelper = join(movedDirectory, ...DESKTOP_HELPER_EXECUTABLE_PATH.split('/'));
    expect(resolveDesktopHelper({ ...options, runtimeEntry: join(moved, 'cli.js') })?.executable).toBe(movedHelper);
    rmSync(movedHelper);
    expect(resolveDesktopHelper({ ...options, runtimeEntry: join(moved, 'cli.js') })).toBeUndefined();
    // The pre-bundle bare executable is never admitted: TCC would key it by a per-version path.
    writeFileSync(join(movedDirectory, 'nekodex-desktop-helper'), bytes, { mode: 0o755 });
    expect(resolveDesktopHelper({ ...options, runtimeEntry: join(moved, 'cli.js') })).toBeUndefined();
    expect(resolveDesktopHelper({ ...options, runtimeEntry: join(root, 'src', 'cli.ts') })).toBeUndefined();
    expect(resolveDesktopHelper({ ...options, explicit: { executable: helper, sha256 } })?.sha256).toBe(sha256);
    writeFileSync(helper, 'changed helper bytes');
    expect(() => resolveDesktopHelper({ ...options, explicit: { executable: helper, sha256 } })).toThrow('bytes changed');
    symlinkSync(helper, movedHelper);
    expect(() => resolveDesktopHelper({ ...options, runtimeEntry: join(moved, 'cli.js') })).toThrow('layout is invalid');
    expect(resolveDesktopHelper({ ...options, platform: 'linux' })).toBeUndefined();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test.skipIf(process.platform === 'win32')('desktop helper bundle needs real directories and its own Info.plist', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nekodex-desktop-bundle-')));
  try {
    const directory = join(root, 'app', 'desktop-helper', 'darwin-arm64'); const options = { runtimeEntry: join(root, 'app', 'cli.js'), platform: 'darwin' as const, arch: 'arm64' };
    writeBundle(directory);
    const plist = join(directory, DESKTOP_HELPER_BUNDLE, 'Contents', 'Info.plist');
    rmSync(plist);
    expect(() => resolveDesktopHelper(options)).toThrow('layout is invalid');
    symlinkSync(join(root, 'elsewhere.plist'), plist); writeFileSync(join(root, 'elsewhere.plist'), builder.desktopHelperInfoPlist());
    expect(() => resolveDesktopHelper(options)).toThrow('layout is invalid');
    rmSync(plist); writeFileSync(plist, builder.desktopHelperInfoPlist());
    expect(resolveDesktopHelper(options)).toBeDefined();
    // A bundle directory that is itself a symlink to another bundle is refused.
    const other = join(root, 'other'); mkdirSync(other); writeBundle(other);
    rmSync(join(directory, DESKTOP_HELPER_BUNDLE), { recursive: true });
    symlinkSync(join(other, DESKTOP_HELPER_BUNDLE), join(directory, DESKTOP_HELPER_BUNDLE));
    expect(() => resolveDesktopHelper(options)).toThrow();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test.skipIf(process.platform === 'win32')('source CLI binds only its fixed checkout helper while bundled CLI has no development fallback', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nekodex-desktop-source-')));
  const platform = 'darwin' as const, arch = 'arm64';
  try {
    mkdirSync(join(root, 'src')); const entry = join(root, 'src', 'cli.ts'); writeFileSync(entry, '// inert source fixture');
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'codex-chatgpt-web' }));
    const url = pathToFileURL(entry).href;
    expect(resolveDevelopmentDesktopHelper(url, { platform, arch })).toBeUndefined();
    const directory = join(root, 'launcher', 'electron', 'desktop-helper', 'darwin-arm64');
    const executable = writeBundle(directory, 'inert helper');
    expect(resolveDevelopmentDesktopHelper(url, { platform, arch })?.executable).toBe(executable);
    expect(resolveDevelopmentDesktopHelper(pathToFileURL(join(root, 'app', 'cli.js')).href, { platform, arch })).toBeUndefined();
    expect(resolveDevelopmentDesktopHelper(url, { platform: 'linux', arch })).toBeUndefined();
    chmodSync(executable, 0o777);
    expect(() => resolveDevelopmentDesktopHelper(url, { platform, arch })).toThrow('layout is invalid');
    chmodSync(executable, 0o755); writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'other-package' }));
    expect(() => resolveDevelopmentDesktopHelper(url, { platform, arch })).toThrow('package identity changed');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// Live 6.1.33-nekodex.10: the Accessibility row for the release identifier held an ad-hoc DEV
// cdhash, recorded when a DEV build with the same identifier created it; no signed copy matched.
test('ad-hoc builds carry a separate development identity and signing refuses to cross them', () => {
  const release: string = builder.desktopHelperInfoPlist(), development: string = builder.desktopHelperInfoPlist({ development: true });
  expect(builder.DESKTOP_HELPER_DEVELOPMENT_IDENTIFIER).toBe('dev.nekodex.desktop-provider.development.v1');
  expect(development).toContain('<key>CFBundleIdentifier</key>\n\t<string>dev.nekodex.desktop-provider.development.v1</string>');
  expect(development).toContain('<key>CFBundleName</key>\n\t<string>NEKODEX Desktop Helper (Development)</string>');
  expect(development).not.toContain('<string>dev.nekodex.desktop-provider.v1</string>');
  expect(release).not.toContain('development');
  // The native helper admits exactly these two identities, equal to the builder's.
  const swift = readFileSync(join(import.meta.dir, '..', 'launcher', 'native', 'desktop-provider.swift'), 'utf8');
  expect(swift).toContain(`let helperBundleIdentifiers: Set<String> = ["${builder.DESKTOP_HELPER_IDENTIFIER}", "${builder.DESKTOP_HELPER_DEVELOPMENT_IDENTIFIER}"]`);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nekodex-desktop-identity-')));
  try {
    const target = join(root, DESKTOP_HELPER_BUNDLE); mkdirSync(join(target, 'Contents'), { recursive: true });
    const plist = join(target, 'Contents', 'Info.plist');
    writeFileSync(plist, release);
    expect(signing.desktopHelperIdentifierFor(target, true)).toBe('dev.nekodex.desktop-provider.v1');
    expect(() => signing.desktopHelperIdentifierFor(target, false)).toThrow('never the release one');
    writeFileSync(plist, development);
    expect(signing.desktopHelperIdentifierFor(target, false)).toBe('dev.nekodex.desktop-provider.development.v1');
    expect(() => signing.desktopHelperIdentifierFor(target, true)).toThrow('must carry the release identity');
  } finally { rmSync(root, { recursive: true, force: true }); }
  expect(signing.desktopHelperPublisherIdentity('darwin', {})).toBeUndefined();
  expect(signing.desktopHelperPublisherIdentity('darwin', { NEKODEX_LOCAL_APP_SIGNING_IDENTITY: 'Developer ID Application: Fixture (ABCDE12345)' })).toContain('Developer ID');
  expect(signing.desktopHelperPublisherIdentity('linux', { NEKODEX_LOCAL_APP_SIGNING_IDENTITY: 'Developer ID Application: Fixture (ABCDE12345)' })).toBeUndefined();
});

test('the stable per-user location is fixed and never inside another app bundle', () => {
  expect(stableDesktopHelperRoot('/Users/fixture')).toBe('/Users/fixture/Library/Application Support/NEKODEX/Desktop Helper');
  expect(insideAnotherAppBundle(join(stableDesktopHelperRoot('/Users/fixture'), DESKTOP_HELPER_BUNDLE))).toBe(false);
  // Nested in NEKODEX.app, tccd judges Screen Recording for NEKODEX instead of the helper.
  expect(insideAnotherAppBundle('/Applications/NEKODEX.app/Contents/Resources/runtime/app/desktop-helper/darwin-arm64/NEKODEX Desktop Helper.app')).toBe(true);
  expect(insideAnotherAppBundle('/Users/fixture/.codex-chatgpt-web/versions/6.1.33-nekodex.10-darwin-arm64/app/desktop-helper/darwin-arm64/NEKODEX Desktop Helper.app')).toBe(false);
  expect(() => ensureStableDesktopHelper({ executable: '/nonexistent/helper', sha256: 'a'.repeat(64) }, '/Applications/NEKODEX.app/Contents/Library/Helpers')).toThrow('directory is invalid');
  expect(() => ensureStableDesktopHelper({ executable: '/nonexistent/helper', sha256: 'a'.repeat(64) }, 'relative/root')).toThrow('directory is invalid');
});

test.skipIf(process.platform === 'win32')('each runtime installs its own bundle at the stable path, keeps an equal copy and replaces a different one in place', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nekodex-desktop-stable-')));
  try {
    const stable = join(root, 'home', 'Library', 'Application Support', 'NEKODEX', 'Desktop Helper');
    const pin = (name: string, bytes: string) => {
      const app = join(root, 'versions', name, 'app');
      writeBundle(join(app, 'desktop-helper', 'darwin-arm64'), bytes);
      return resolveDesktopHelper({ runtimeEntry: join(app, 'cli.js'), platform: 'darwin', arch: 'arm64' })!;
    };
    const first = pin('6.1.33-nekodex.10-darwin-arm64', 'helper bytes of .10');
    const installed = ensureStableDesktopHelper(first, stable);
    const target = join(stable, ...DESKTOP_HELPER_EXECUTABLE_PATH.split('/'));
    expect(installed).toEqual({ executable: target, sha256: first.sha256 });
    expect(readFileSync(join(stable, DESKTOP_HELPER_BUNDLE, 'Contents', 'Info.plist'), 'utf8')).toBe(builder.desktopHelperInfoPlist());
    expect(lstatSync(stable).mode & 0o077).toBe(0);
    const inode = lstatSync(target).ino;
    expect(ensureStableDesktopHelper(first, stable)).toEqual(installed);
    expect(lstatSync(target).ino).toBe(inode); // An equal copy is left untouched.
    // The next update ships other bytes from its own runtime: the same path now holds them.
    const second = pin('6.1.33-nekodex.11-darwin-arm64', 'helper bytes of .11');
    expect(ensureStableDesktopHelper(second, stable)).toEqual({ executable: target, sha256: second.sha256 });
    expect(readFileSync(target, 'utf8')).toBe('helper bytes of .11');
    expect(readdirSync(stable).sort()).toEqual([DESKTOP_HELPER_BUNDLE]); // No staging or previous copy is left behind.
    // Damage or tampering at the stable path is repaired from the runtime's own verified bundle.
    writeFileSync(target, 'tampered');
    expect(ensureStableDesktopHelper(second, stable).sha256).toBe(second.sha256);
    rmSync(join(stable, DESKTOP_HELPER_BUNDLE, 'Contents', 'Info.plist')); writeFileSync(join(stable, DESKTOP_HELPER_BUNDLE, 'Contents', 'Info.plist'), builder.desktopHelperInfoPlist({ development: true }));
    ensureStableDesktopHelper(second, stable);
    expect(readFileSync(join(stable, DESKTOP_HELPER_BUNDLE, 'Contents', 'Info.plist'), 'utf8')).toBe(builder.desktopHelperInfoPlist());
    // A symlinked stable bundle is replaced by a real copy, never followed.
    const elsewhere = join(root, 'elsewhere'); writeBundle(elsewhere, 'helper bytes of .11');
    rmSync(join(stable, DESKTOP_HELPER_BUNDLE), { recursive: true }); symlinkSync(join(elsewhere, DESKTOP_HELPER_BUNDLE), join(stable, DESKTOP_HELPER_BUNDLE));
    ensureStableDesktopHelper(second, stable);
    expect(lstatSync(join(stable, DESKTOP_HELPER_BUNDLE)).isSymbolicLink()).toBe(false);
    expect(existsSync(join(elsewhere, DESKTOP_HELPER_BUNDLE, 'Contents', 'Info.plist'))).toBe(true);
    // The source pin must still hold: changed runtime bytes are refused before anything is copied.
    writeFileSync(second.executable, 'changed runtime bytes');
    expect(() => ensureStableDesktopHelper(second, stable)).toThrow('bytes changed');
    // An unsafe stable directory is refused.
    const loose = join(root, 'loose'); mkdirSync(loose); chmodSync(loose, 0o777);
    expect(() => ensureStableDesktopHelper(first, loose)).toThrow('directory is unsafe');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
