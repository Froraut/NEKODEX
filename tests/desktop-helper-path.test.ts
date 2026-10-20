import { expect, test } from 'bun:test';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolveDesktopHelper, resolveDevelopmentDesktopHelper } from '../src/browser-companion/desktop-helper-path';

test.skipIf(process.platform === 'win32')('desktop helper relocation uses its own bundle and refuses changed DEV pins without source fallback', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nekodex-desktop-layout-')));
  try {
    const app = join(root, 'app'); const helperDirectory = join(app, 'desktop-helper', 'darwin-arm64');
    mkdirSync(helperDirectory, { recursive: true });
    const helper = join(helperDirectory, 'nekodex-desktop-helper');
    const bytes = Buffer.from('inert resolver fixture; never executed');
    writeFileSync(helper, bytes, { mode: 0o755 });
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const options = { runtimeEntry: join(app, 'cli.js'), platform: 'darwin' as const, arch: 'arm64' };
    expect(resolveDesktopHelper(options)).toEqual({ executable: helper, sha256 });
    const moved = join(root, 'relocated', 'app');
    const movedHelper = join(moved, 'desktop-helper', 'darwin-arm64', 'nekodex-desktop-helper');
    mkdirSync(join(moved, 'desktop-helper', 'darwin-arm64'), { recursive: true });
    copyFileSync(helper, movedHelper); chmodSync(movedHelper, 0o755);
    expect(resolveDesktopHelper({ ...options, runtimeEntry: join(moved, 'cli.js') })?.executable).toBe(movedHelper);
    rmSync(movedHelper);
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

test.skipIf(process.platform === 'win32')('source CLI binds only its fixed checkout helper while bundled CLI has no development fallback', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nekodex-desktop-source-')));
  const platform = 'darwin' as const, arch = 'arm64';
  try {
    mkdirSync(join(root, 'src')); const entry = join(root, 'src', 'cli.ts'); writeFileSync(entry, '// inert source fixture');
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'codex-chatgpt-web' }));
    const url = pathToFileURL(entry).href;
    expect(resolveDevelopmentDesktopHelper(url, { platform, arch })).toBeUndefined();
    const directory = join(root, 'launcher', 'electron', 'desktop-helper', 'darwin-arm64'); mkdirSync(directory, { recursive: true });
    const executable = join(directory, 'nekodex-desktop-helper'); writeFileSync(executable, 'inert helper', { mode: 0o755 });
    expect(resolveDevelopmentDesktopHelper(url, { platform, arch })?.executable).toBe(executable);
    expect(resolveDevelopmentDesktopHelper(pathToFileURL(join(root, 'app', 'cli.js')).href, { platform, arch })).toBeUndefined();
    expect(resolveDevelopmentDesktopHelper(url, { platform: 'linux', arch })).toBeUndefined();
    chmodSync(executable, 0o777);
    expect(() => resolveDevelopmentDesktopHelper(url, { platform, arch })).toThrow('layout is invalid');
    chmodSync(executable, 0o755); writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'other-package' }));
    expect(() => resolveDevelopmentDesktopHelper(url, { platform, arch })).toThrow('package identity changed');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
