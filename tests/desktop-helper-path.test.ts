import { expect, test } from 'bun:test';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { DESKTOP_HELPER_BUNDLE, DESKTOP_HELPER_EXECUTABLE_PATH, resolveDesktopHelper, resolveDevelopmentDesktopHelper } from '../src/browser-companion/desktop-helper-path';

const builder = createRequire(import.meta.url)('../scripts/build-desktop-helper.cjs');

/** Inert bundle fixture; never executed. */
function writeBundle(directory: string, bytes: string | Buffer = 'inert resolver fixture; never executed') {
  const executable = join(directory, ...DESKTOP_HELPER_EXECUTABLE_PATH.split('/'));
  mkdirSync(join(directory, DESKTOP_HELPER_BUNDLE, 'Contents', 'MacOS'), { recursive: true });
  writeFileSync(join(directory, DESKTOP_HELPER_BUNDLE, 'Contents', 'Info.plist'), builder.desktopHelperInfoPlist());
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
