import { createHash } from 'node:crypto';
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface PinnedDesktopHelper { executable: string; sha256: string }

/** Equal to scripts/build-desktop-helper.cjs (a test keeps them equal). macOS TCC keys the
 * self-responsible helper by this bundle's identifier and designated requirement, so the
 * executable is admitted only inside its fixed bundle. */
export const DESKTOP_HELPER_BUNDLE = 'NEKODEX Desktop Helper.app';
export const DESKTOP_HELPER_EXECUTABLE_PATH = `${DESKTOP_HELPER_BUNDLE}/Contents/MacOS/nekodex-desktop-helper`;
const bundleExecutable = (directory: string) => join(directory, ...DESKTOP_HELPER_EXECUTABLE_PATH.split('/'));
const bundleOf = (executable: string) => dirname(dirname(dirname(executable)));
const infoPlist = (executable: string) => join(dirname(dirname(executable)), 'Info.plist');

/** One location per user, outside every other app bundle and outside the per-version runtime
 * directories, so the path to add in System Settings never changes or disappears with an update.
 * TCC itself keys the grant by bundle identifier and designated requirement, not by this path. */
export const STABLE_DESKTOP_HELPER_SEGMENTS = ['Library', 'Application Support', 'NEKODEX', 'Desktop Helper'] as const;
export const stableDesktopHelperRoot = (home = homedir()) => join(home, ...STABLE_DESKTOP_HELPER_SEGMENTS);

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

/** tccd judges Screen Recording for the outermost enclosing .app: a helper nested in
 * NEKODEX.app is evaluated as NEKODEX (live 6.1.33-nekodex.10 probe), never as itself. */
export function insideAnotherAppBundle(bundle: string) {
  return dirname(bundle).split(sep).some(part => part.toLowerCase().endsWith('.app'));
}
function sameHelper(executable: string, source: PinnedDesktopHelper) {
  try {
    return inspectHelper(executable, source.sha256)?.sha256 === source.sha256
      && readFileSync(infoPlist(executable)).equals(readFileSync(infoPlist(source.executable)));
  } catch { return false; }
}
function ownedDirectory(path: string) {
  const info = lstatSync(path);
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(path) !== path || (info.mode & 0o022) !== 0
    || (typeof process.getuid === 'function' && info.uid !== process.getuid())) throw new Error('Stable desktop helper directory is unsafe');
}

/** Installs or refreshes the stable copy from this runtime's own verified sibling bundle and
 * returns its pin. It is a byte copy of the signed bundle, so bundle identifier and designated
 * requirement are those of the shipped helper. An existing equal copy is left untouched; a
 * different one (another version, or damage) is replaced by an atomic rename, so a helper that
 * is still running keeps its open image. Nothing here launches the helper or touches TCC. */
export function ensureStableDesktopHelper(source: PinnedDesktopHelper, root = stableDesktopHelperRoot()): PinnedDesktopHelper {
  if (!isAbsolute(root) || resolve(root) !== root || insideAnotherAppBundle(join(root, DESKTOP_HELPER_BUNDLE))) throw new Error('Stable desktop helper directory is invalid');
  const verified = inspectHelper(source.executable, source.sha256);
  if (!verified) throw new Error('Desktop helper is unavailable');
  const target = bundleExecutable(root), bundle = join(root, DESKTOP_HELPER_BUNDLE);
  mkdirSync(root, { recursive: true, mode: 0o700 }); ownedDirectory(root);
  if (sameHelper(target, verified)) return { executable: target, sha256: verified.sha256 };
  const staging = mkdtempSync(join(root, '.install-'));
  try {
    const candidate = join(staging, DESKTOP_HELPER_BUNDLE);
    cpSync(bundleOf(verified.executable), candidate, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
    if (!sameHelper(bundleExecutable(staging), verified)) throw new Error('Stable desktop helper copy changed');
    if (lstatSync(bundle, { throwIfNoEntry: false })) renameSync(bundle, join(staging, 'previous.app'));
    try { renameSync(candidate, bundle); }
    catch (error) { if (!sameHelper(target, verified)) throw error; } // Another owner installed the same bytes first.
  } finally { rmSync(staging, { recursive: true, force: true }); }
  const installed = inspectHelper(target, verified.sha256);
  if (!installed || !sameHelper(target, verified)) throw new Error('Stable desktop helper copy changed');
  return installed;
}
