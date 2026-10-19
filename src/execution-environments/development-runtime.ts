import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { VmRuntimeSelection } from './executor';
import { isSha256, sha256, vmAssert } from './protocol';

const SOURCE_SHA256 = '19458105ceaa89cdafbf6f62d33d424a76e2401f55e4af8395cc8388c1616936';
function read(path: string, max = 2 * 1024 * 1024): Buffer {
  const before = lstatSync(path, { bigint: true });
  vmAssert(realpathSync(path) === path && before.isFile() && !(before.mode & 0o022n) && before.size <= BigInt(max), 'vm-development-input-invalid');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(fd, { bigint: true }); vmAssert(opened.dev === before.dev && opened.ino === before.ino);
    const bytes = readFileSync(fd), after = lstatSync(path, { bigint: true });
    vmAssert(bytes.length <= max && ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'mode'].every(k => before[k as keyof typeof before] === after[k as keyof typeof after]), 'vm-development-input-changed');
    return bytes;
  } finally { closeSync(fd); }
}
/** Explicit source-development layout only. Resolves metadata, never admits a
 * runtime, compiles/downloads artifacts or boots a VM. Installed CLI has no
 * checkout/PATH fallback and must gain its own publisher admission separately. */
export function resolveDevelopmentVmRuntimeSelection(sourceEntryUrl: string): VmRuntimeSelection | undefined {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') return;
  const entry = fileURLToPath(sourceEntryUrl);
  if (basename(entry) !== 'cli.ts' || basename(dirname(entry)) !== 'src') return;
  const root = dirname(dirname(entry));
  try {
    vmAssert(JSON.parse(read(join(root, 'package.json'), 65536).toString()).name === 'codex-chatgpt-web');
    vmAssert(sha256(read(join(root, 'launcher/native/execution-vm-helper.swift'), 128 * 1024)) === SOURCE_SHA256);
    const helperDir = join(root, 'launcher/electron/execution-vm-helper/darwin-arm64'), guestDir = join(root, 'launcher/native/execution-guest/.build/bundle');
    const helperManifestPath = join(helperDir, 'manifest.json'), guestManifestPath = join(guestDir, 'manifest.json');
    const helperBytes = read(helperManifestPath), guestBytes = read(guestManifestPath), helper = JSON.parse(helperBytes.toString()), guest = JSON.parse(guestBytes.toString());
    vmAssert(helper.sourceSha256 === SOURCE_SHA256 && helper.development === true && isSha256(helper.executableSha256));
    const names = ['agent.go', 'go.mod', 'init', 'platform_linux.go', 'platform_other.go'];
    vmAssert(guest.sourceSha256 && Object.keys(guest.sourceSha256).sort().join(',') === [...names].sort().join(','));
    for (const name of names) vmAssert(sha256(read(join(root, 'launcher/native/execution-guest', name), 128 * 1024)) === guest.sourceSha256[name]);
    const kernelPath = join(guestDir, 'Image'), initrdPath = join(guestDir, 'initrd.gz');
    vmAssert(guest.kernel.path === kernelPath && guest.initrd.path === initrdPath && isSha256(guest.kernel.sha256) && isSha256(guest.initrd.sha256));
    return { helperPath: join(helperDir, 'nekodex-execution-vm-helper'), helperSha256: helper.executableSha256,
      helperManifestPath, helperManifestSha256: sha256(helperBytes), kernelPath, kernelSha256: guest.kernel.sha256,
      initrdPath, initrdSha256: guest.initrd.sha256, guestManifestPath, guestManifestSha256: sha256(guestBytes) };
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw new Error('The fixed VM development artifacts are absent or changed; explicitly rebuild the reviewed source'); }
}
