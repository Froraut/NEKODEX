import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { uniqueVmPaths, VM_LIMITS, vmAssert, type VmFile } from './protocol';
export interface VmSnapshotRoot { path: string; dev: bigint; ino: bigint }
interface Pin extends VmSnapshotRoot { size: bigint; mtimeNs: bigint; ctimeNs: bigint; mode: bigint }
export function overlapsVmPath(left: string, right: string): boolean {
  const contains = (a: string, b: string) => { const r = relative(a, b); return !r || !isAbsolute(r) && r !== '..' && !r.startsWith(`..${sep}`); };
  return contains(left, right) || contains(right, left);
}
export function pinVmSnapshotRoot(path: string): VmSnapshotRoot {
  vmAssert(isAbsolute(path) && realpathSync(path) === path && path.length <= 4096, 'vm-workspace-not-canonical');
  const s = lstatSync(path, { bigint: true }); vmAssert(s.isDirectory() && !s.isSymbolicLink(), 'vm-workspace-not-directory');
  return { path, dev: s.dev, ino: s.ino };
}
export function assertVmSnapshotRoot(root: VmSnapshotRoot): void {
  const now = pinVmSnapshotRoot(root.path); vmAssert(now.dev === root.dev && now.ino === root.ino, 'vm-workspace-changed');
}
export function canonicalVmProtectedPath(path: string): string {
  vmAssert(isAbsolute(path), 'vm-protected-path-invalid');
  try { vmAssert(!lstatSync(path).isSymbolicLink(), 'vm-protected-path-symlink'); return realpathSync(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || dirname(path) === path) throw error;
    // Absence never creates a private authority. Canonical existing ancestors
    // still fence a root that would contain the future user-wide VM store.
    return join(canonicalVmProtectedPath(dirname(path)), path.slice(dirname(path).length + 1));
  }
}
function pin(path: string, directory: boolean): Pin {
  const s = lstatSync(path, { bigint: true });
  vmAssert(realpathSync(path) === path && !s.isSymbolicLink() && (directory ? s.isDirectory() : s.isFile() && s.nlink === 1n), 'vm-input-not-regular');
  return { path, dev: s.dev, ino: s.ino, size: s.size, mtimeNs: s.mtimeNs, ctimeNs: s.ctimeNs, mode: s.mode };
}
export function snapshotVmInputs(root: VmSnapshotRoot, inputPaths: string[], assertCurrent: () => void): { files: VmFile[]; assertCurrent(): void } {
  const paths = uniqueVmPaths(inputPaths, VM_LIMITS.inputFiles), pins = new Map<string, Pin>(), files: VmFile[] = []; let total = 0;
  assertCurrent(); assertVmSnapshotRoot(root);
  for (const name of paths) {
    assertCurrent(); assertVmSnapshotRoot(root);
    const path = join(root.path, name);
    for (let dir = dirname(path); ; dir = dirname(dir)) { pins.set(dir, pin(dir, true)); if (dir === root.path) break; }
    const before = pin(path, false); vmAssert(before.size >= 0n && before.size <= BigInt(VM_LIMITS.inputBytes - total), 'vm-input-budget');
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = fstatSync(fd, { bigint: true }); vmAssert(opened.dev === before.dev && opened.ino === before.ino, 'vm-input-changed');
      const chunks: Buffer[] = []; let bytes = 0;
      for (;;) { const buffer = Buffer.alloc(Math.min(65536, VM_LIMITS.inputBytes - total - bytes + 1)); const n = readSync(fd, buffer); if (!n) break;
        bytes += n; vmAssert(total + bytes <= VM_LIMITS.inputBytes && BigInt(bytes) <= before.size, 'vm-input-budget'); chunks.push(buffer.subarray(0, n)); }
      const after = pin(path, false); vmAssert(['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'mode'].every(key => after[key as keyof Pin] === before[key as keyof Pin]) && BigInt(bytes) === before.size, 'vm-input-changed');
      pins.set(path, before); files.push({ path: name, mode: before.mode & 0o111n ? 0o700 : 0o600, bytes: Buffer.concat(chunks, bytes) }); total += bytes;
    } finally { closeSync(fd); }
    assertCurrent();
  }
  const check = () => {
    assertCurrent(); assertVmSnapshotRoot(root);
    for (const old of pins.values()) { const now = pin(old.path, (old.mode & 0o170000n) === 0o040000n);
      vmAssert(['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'mode'].every(key => now[key as keyof Pin] === old[key as keyof Pin]), 'vm-input-changed'); }
  };
  check(); return { files, assertCurrent: check };
}
