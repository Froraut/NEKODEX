import { randomUUID } from "node:crypto";
import { chmodSync, fchmodSync, fstatSync, fsyncSync, mkdirSync, openSync, closeSync, renameSync, rmSync, writeFileSync, readFileSync, existsSync, lstatSync, readlinkSync, realpathSync, symlinkSync } from "node:fs";
import { dirname } from "node:path";

export interface FileSnapshot {
  path: string;
  exists: boolean;
  data?: Buffer;
  identity?: { dev: number; ino: number };
  mode?: number;
  symlink?: { link: string; target: string; mode: number; linkIdentity: { dev: number; ino: number }; identity: { dev: number; ino: number } };
}

/** A receipt returned only after publication, with the staging inode identity.
 * An observed before-image or a post-error read is never proof of ownership. */
export type CommittedFileReceipt = FileSnapshot;

const atomicWaitCell = new Int32Array(new SharedArrayBuffer(4));
const WINDOWS_RENAME_RETRY_DELAYS_MS = [25, 50, 100, 150, 250, 350, 500] as const;

/** Rename, retrying transient Windows sharing violations. `beforeAttempt` runs before every
 * attempt, outside the retry handling, so its failure is never retried. */
function renameWithTransientWindowsRetry(source: string, destination: string, beforeAttempt?: () => void): void {
  for (let attempt = 0; ; attempt += 1) {
    beforeAttempt?.();
    try {
      renameSync(source, destination);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const transientWindowsError = process.platform === "win32"
        && (code === "EBUSY" || code === "EPERM" || code === "EACCES");
      const delay = WINDOWS_RENAME_RETRY_DELAYS_MS[attempt];
      if (!transientWindowsError || delay === undefined) throw error;
      Atomics.wait(atomicWaitCell, 0, 0, delay);
    }
  }
}

export function atomicWriteFile(
  path: string,
  data: string | Uint8Array,
  { mode = 0o600, protectDirectory = true }: { mode?: number; protectDirectory?: boolean } = {},
): CommittedFileReceipt {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (protectDirectory) {
    try { chmodSync(directory, 0o700); } catch { /* Windows ACLs are managed by the installer. */ }
  }
  const temp = `${path}.tmp-${process.pid}-${randomUUID()}`;
  const fd = openSync(temp, "wx", mode);
  let open = true;
  try {
    writeFileSync(fd, data);
    try { fchmodSync(fd, mode); } catch { /* Windows ACLs are managed by the installer. */ }
    // Flush contents before the rename publishes them, so a crash cannot leave an empty file
    // under the final name on filesystems that reorder metadata and data writes.
    fsyncSync(fd);
    const stat = fstatSync(fd);
    open = false;
    closeSync(fd);
    renameWithTransientWindowsRetry(temp, path);
    syncDirectory(directory);
    return { path, exists: true, data: Buffer.from(data), mode: stat.mode & 0o777, identity: { dev: stat.dev, ino: stat.ino } };
  } catch (error) {
    // Never close twice: the descriptor number may already belong to another open file.
    if (open) try { closeSync(fd); } catch {}
    rmSync(temp, { force: true });
    throw error;
  }
}

/** Best-effort durability for the rename itself; directories cannot be opened this way on Windows. */
function syncDirectory(directory: string): void {
  if (process.platform === "win32") return;
  let fd: number | undefined;
  try {
    fd = openSync(directory, "r");
    fsyncSync(fd);
  } catch {
    // Some filesystems reject directory fsync; the file contents are already durable.
  } finally {
    if (fd !== undefined) try { closeSync(fd); } catch {}
  }
}

export function snapshotFile(path: string, options?: { followSymlink?: boolean }): FileSnapshot {
  if (options?.followSymlink) {
    let stat;
    try { stat = lstatSync(path); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (stat?.isSymbolicLink()) {
      const link = readlinkSync(path);
      const target = realpathSync(path);
      const targetStat = lstatSync(target);
      if (!targetStat.isFile()) throw new Error(`Codex config symlink target is not a regular file: ${path}`);
      return {
        path,
        exists: true,
        data: readFileSync(target),
        symlink: {
          link,
          linkIdentity: { dev: stat.dev, ino: stat.ino },
          target,
          mode: targetStat.mode & 0o777,
          identity: { dev: targetStat.dev, ino: targetStat.ino },
        },
      };
    }
  }
  if (!existsSync(path)) return { path, exists: false };
  const stat = lstatSync(path);
  return { path, exists: true, data: readFileSync(path), mode: stat.mode & 0o777, identity: { dev: stat.dev, ino: stat.ino } };
}

/** Write the snapshotted config target, never replace its symbolic link or follow a new target. */
export function assertFileSnapshotCurrent(snapshot: FileSnapshot): void {
  const current = snapshotFile(snapshot.path, { followSymlink: Boolean(snapshot.symlink) });
  if (!fileSnapshotsMatch(current, snapshot)) {
    throw new Error(`Codex integration file changed before the managed mutation; preserving the external edit: ${snapshot.path}`);
  }
}

export function fileSnapshotsMatch(current: FileSnapshot, expected: FileSnapshot): boolean {
  if (current.path !== expected.path || current.exists !== expected.exists) return false;
  if (!expected.exists) return true;
  if (!current.data?.equals(expected.data ?? Buffer.alloc(0))) return false;
  if (expected.symlink) {
    return Boolean(current.symlink)
      && current.symlink!.link === expected.symlink.link
      && current.symlink!.linkIdentity.dev === expected.symlink.linkIdentity.dev
      && current.symlink!.linkIdentity.ino === expected.symlink.linkIdentity.ino
      && current.symlink!.mode === expected.symlink.mode
      && current.symlink!.target === expected.symlink.target
      && current.symlink!.identity.dev === expected.symlink.identity.dev
      && current.symlink!.identity.ino === expected.symlink.identity.ino;
  }
  return Boolean(current.identity)
    && current.mode === expected.mode
    && current.identity!.dev === expected.identity?.dev
    && current.identity!.ino === expected.identity?.ino;
}

// Capture the inode before publication. Reading the destination after a write can
// accidentally claim another process's replacement as our rollback receipt.
function commitFileSnapshot(snapshot: FileSnapshot, data: string | Uint8Array, expected?: FileSnapshot): FileSnapshot {
  const target = snapshot.symlink?.target ?? snapshot.path;
  const staging = `${target}.integration-${randomUUID()}`;
  let staged: FileSnapshot | undefined;
  try {
    atomicWriteFile(staging, data, snapshot.symlink
      ? { mode: snapshot.symlink.mode, protectDirectory: false } : undefined);
    staged = snapshotFile(staging);
    // Backoff lets other writers run; every publication attempt needs a fresh guard.
    renameWithTransientWindowsRetry(staging, target, expected ? () => assertFileSnapshotCurrent(expected) : undefined);
    return {
      path: snapshot.path, exists: true, data: staged.data!,
      ...(snapshot.symlink
        ? { symlink: { ...snapshot.symlink, identity: staged.identity! } }
        : { identity: staged.identity!, mode: staged.mode }),
    };
  } catch (error) {
    if (staged) {
      try {
        assertFileSnapshotCurrent(staged);
        rmSync(staging);
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], `${String(error)}; integration staging cleanup also failed: ${String(cleanup)}`, { cause: error });
      }
    }
    throw error;
  }
}

export function writeFileSnapshot(
  snapshot: FileSnapshot,
  data: string | Uint8Array,
  options?: { expectedData?: Uint8Array; expectedSnapshot?: FileSnapshot },
): CommittedFileReceipt {
  const expectedSnapshot = options?.expectedSnapshot;
  if (expectedSnapshot || options?.expectedData !== undefined) {
    const current = snapshotFile(snapshot.path, {
      followSymlink: Boolean(expectedSnapshot?.symlink ?? snapshot.symlink),
    });
    if (expectedSnapshot
      ? !fileSnapshotsMatch(current, expectedSnapshot)
      : (!snapshot.exists || !current.exists || !current.data?.equals(options!.expectedData!)
        || !fileSnapshotsMatch(current, snapshot))) {
      throw new Error(`Codex integration file changed before the managed write; preserving the external edit: ${snapshot.path}`);
    }
  }
  const symlink = snapshot.symlink;
  if (!symlink) {
    return commitFileSnapshot(snapshot, data,
      expectedSnapshot ?? (options?.expectedData !== undefined ? snapshot : undefined));
  }
  const linkStat = lstatSync(snapshot.path);
  if (!linkStat.isSymbolicLink()
    || linkStat.dev !== symlink.linkIdentity.dev || linkStat.ino !== symlink.linkIdentity.ino
    || readlinkSync(snapshot.path) !== symlink.link
    || realpathSync(snapshot.path) !== symlink.target
    || (() => {
      const targetStat = lstatSync(realpathSync(snapshot.path));
      const expectedIdentity = options?.expectedSnapshot?.symlink?.identity ?? symlink.identity;
      return targetStat.dev !== expectedIdentity.dev || targetStat.ino !== expectedIdentity.ino;
    })()) {
    throw new Error(`Codex config symlink changed during the operation: ${snapshot.path}`);
  }
  return commitFileSnapshot(snapshot, data, expectedSnapshot ?? snapshot);
}

export function restoreFileSnapshot(snapshot: FileSnapshot, options?: { expectedCurrent?: FileSnapshot }): void {
  if (snapshot.exists) {
    if (!snapshot.data) throw new Error(`File snapshot is missing data: ${snapshot.path}`);
    if (snapshot.symlink && !options?.expectedCurrent && !existsSync(snapshot.path)) {
      const targetStat = lstatSync(snapshot.symlink.target);
      if (targetStat.dev !== snapshot.symlink.identity.dev || targetStat.ino !== snapshot.symlink.identity.ino) {
        throw new Error(`Codex integration symlink target changed before rollback; preserving the external edit: ${snapshot.path}`);
      }
      symlinkSync(snapshot.symlink.link, snapshot.path);
      return;
    }
    writeFileSnapshot(snapshot, snapshot.data, { expectedSnapshot: options?.expectedCurrent });
  } else {
    if (options?.expectedCurrent) {
      const current = snapshotFile(snapshot.path, { followSymlink: Boolean(options.expectedCurrent.symlink) });
      if (!fileSnapshotsMatch(current, options.expectedCurrent)) {
        throw new Error(`Codex integration file changed before rollback removal; preserving the external edit: ${snapshot.path}`);
      }
    }
    rmSync(snapshot.path, { force: true });
  }
}

export function writeFilesWithCompensation(
  writes: Array<{
    path: string;
    data: string | Uint8Array;
    followSymlink?: boolean;
    expectedData?: Uint8Array;
    managed?: boolean;
    expectedSnapshot?: FileSnapshot;
  }>,
  removals: string[] = [],
): void {
  const paths = [...new Set([...writes.map(write => write.path), ...removals])];
  const snapshots = new Map(paths.map(path => [path, snapshotFile(path, {
    followSymlink: writes.some(write => write.path === path && write.followSymlink === true)
      || removals.includes(path),
  })]));
  const guardedWrites = writes.map(write => ({
    ...write,
    expectedSnapshot: write.expectedSnapshot ?? (write.managed ? snapshots.get(write.path) : undefined),
  }));
  const startedWrites = new Set<string>();
  const startedRemovals = new Set<string>();
  const ownedAfterWrite = new Map<string, FileSnapshot>();
  try {
    for (const write of guardedWrites) {
      if (write.expectedData !== undefined) {
        const snapshot = snapshots.get(write.path)!;
        const current = snapshotFile(write.path, { followSymlink: write.followSymlink });
        if (!snapshot.exists || !snapshot.data?.equals(write.expectedData)
          || !current.exists || !current.data?.equals(write.expectedData)) {
          throw new Error(`Codex integration file changed before the managed write; preserving the external edit: ${write.path}`);
        }
      }
      startedWrites.add(write.path);
      const committed = writeFileSnapshot(snapshots.get(write.path)!, write.data, {
        expectedData: write.expectedData,
        expectedSnapshot: write.expectedSnapshot,
      });
      ownedAfterWrite.set(write.path, committed);
    }
    for (const removal of removals) {
      const snapshot = snapshots.get(removal)!;
      assertFileSnapshotCurrent(snapshot);
      rmSync(removal, { force: true });
      startedRemovals.add(removal);
    }
  } catch (error) {
    const rollbackFailures: string[] = [];
    for (const snapshot of [...snapshots.values()].reverse()) {
      try {
        if (!startedWrites.has(snapshot.path) && !startedRemovals.has(snapshot.path)) continue;
        const write = guardedWrites.find(candidate => candidate.path === snapshot.path);
        const current = snapshotFile(snapshot.path, { followSymlink: Boolean(write?.followSymlink || snapshot.symlink) });
        if (fileSnapshotsMatch(current, snapshot)) continue;
        if (startedWrites.has(snapshot.path)) {
          const owned = ownedAfterWrite.get(snapshot.path);
          if (!owned || !fileSnapshotsMatch(current, owned)) {
            throw new Error("changed after the managed write; preserving the external edit");
          }
          restoreFileSnapshot(snapshot, { expectedCurrent: owned });
        } else if (startedRemovals.has(snapshot.path)) {
          if (current.exists) throw new Error("changed after the managed removal; preserving the external edit");
          restoreFileSnapshot(snapshot);
        }
      } catch (rollbackError) {
        rollbackFailures.push(`${snapshot.path}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
      }
    }
    const primary = error instanceof Error ? error.message : String(error);
    throw new Error(
      rollbackFailures.length > 0
        ? `${primary}; Codex integration rollback also failed: ${rollbackFailures.join("; ")}`
        : primary,
    );
  }
}
