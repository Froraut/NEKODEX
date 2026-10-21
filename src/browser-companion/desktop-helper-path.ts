import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface PinnedDesktopHelper { executable: string; sha256: string }

/** Equal to scripts/build-desktop-helper.cjs (a test keeps them equal). macOS TCC keys the
 * self-responsible helper by this bundle's identifier and designated requirement, so the
 * executable is admitted only inside its fixed bundle. */
export const DESKTOP_HELPER_BUNDLE = 'NEKODEX Desktop Helper.app';
export const DESKTOP_HELPER_EXECUTABLE_PATH = `${DESKTOP_HELPER_BUNDLE}/Contents/MacOS/nekodex-desktop-helper`;
const bundleExecutable = (directory: string) => join(directory, ...DESKTOP_HELPER_EXECUTABLE_PATH.split('/'));

function realDirectory(path: string) {
  const info = lstatSync(path); return info.isDirectory() && !info.isSymbolicLink() && realpathSync(path) === path;
}
/** The bundle, its Contents and MacOS directories are real directories and Info.plist a real file. */
function inspectBundle(executable: string) {
  const macos = dirname(executable), contents = dirname(macos), bundle = dirname(contents);
  try {
    const plist = lstatSync(join(contents, 'Info.plist'));
    if (basename(bundle) === DESKTOP_HELPER_BUNDLE && basename(contents) === 'Contents' && basename(macos) === 'MacOS'
      && [bundle, contents, macos].every(realDirectory) && plist.isFile() && !plist.isSymbolicLink() && plist.size <= 64 * 1024) return;
  } catch {}
  throw new Error('Desktop helper layout is invalid');
}

function inspectHelper(executable: string, expectedSha256?: string): PinnedDesktopHelper | undefined {
  let info;
  try { info = lstatSync(executable); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !expectedSha256) return undefined; throw new Error('Desktop helper is unavailable'); }
  if (!info.isFile() || info.isSymbolicLink() || realpathSync(executable) !== executable || !(info.mode & 0o111)
    || (info.mode & 0o022) !== 0 || info.size > 16 * 1024 * 1024) throw new Error('Desktop helper layout is invalid');
  inspectBundle(executable);
  const sha256 = createHash('sha256').update(readFileSync(executable)).digest('hex');
  if (expectedSha256 && sha256 !== expectedSha256) throw new Error('Trusted desktop helper bytes changed');
  return { executable, sha256 };
}

/** Called only by the source CLI with its own import.meta.url. A bundled cli.js
 * never enters this layout and cannot fall back to a checkout after relocation. */
export function resolveDevelopmentDesktopHelper(sourceEntryUrl: string, options: {
  platform?: NodeJS.Platform; arch?: string;
} = {}): PinnedDesktopHelper | undefined {
  const platform = options.platform ?? process.platform, arch = options.arch ?? process.arch;
  if (platform !== 'darwin' || !['arm64', 'x64'].includes(arch)) return undefined;
  const entry = fileURLToPath(sourceEntryUrl);
  if (basename(entry) !== 'cli.ts' || basename(dirname(entry)) !== 'src') return undefined;
  if (!lstatSync(entry).isFile() || realpathSync(entry) !== entry) throw new Error('Source CLI layout is invalid');
  const root = dirname(dirname(entry));
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (manifest.name !== 'codex-chatgpt-web') throw new Error('Source CLI package identity changed');
  return inspectHelper(bundleExecutable(join(root, 'launcher', 'electron', 'desktop-helper', `${platform}-${arch}`)));
}

/** A composition-root override is for an owned DEV harness. Installed code uses
 * its sibling manifest layout only; missing bytes never select a source checkout. */
export function resolveDesktopHelper(options: {
  runtimeEntry?: string;
  platform?: NodeJS.Platform;
  arch?: string;
  explicit?: PinnedDesktopHelper;
} = {}): PinnedDesktopHelper | undefined {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  if (platform !== 'darwin' || !['arm64', 'x64'].includes(arch)) return undefined;
  let executable: string;
  if (options.explicit) {
    if (!isAbsolute(options.explicit.executable) || !/^[a-f0-9]{64}$/.test(options.explicit.sha256)) throw new Error('Invalid trusted desktop helper pin');
    executable = options.explicit.executable;
  } else {
    const entry = options.runtimeEntry ?? process.argv[1];
    if (!entry || !isAbsolute(entry) || basename(entry) !== 'cli.js') return undefined;
    executable = bundleExecutable(join(dirname(resolve(entry)), 'desktop-helper', `${platform}-${arch}`));
  }
  return inspectHelper(executable, options.explicit?.sha256);
}
