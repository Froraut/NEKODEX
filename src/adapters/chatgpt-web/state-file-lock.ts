import {
  closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync,
  statSync, writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { processRunning } from "../../process";

const LOCK_WAIT_MS = 25;
const LOCK_TIMEOUT_MS = 5_000;
const STALE_LOCK_MS = 60_000;
const waitCell = new Int32Array(new SharedArrayBuffer(4));

interface StateLockOwner {
  pid: number;
  token: string;
}

export function canonicalChatGptStatePath(path: string | undefined): string | undefined {
  if (path === undefined) return undefined;
  const absolute = resolve(path);
  let existingLeaf = false;
  try {
    lstatSync(absolute);
    existingLeaf = true;
    return realpathSync.native(absolute);
  } catch (error) {
    if (existingLeaf) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const leaf = basename(absolute);
  let ancestor = dirname(absolute);
  const suffix: string[] = [];
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
    suffix.unshift(basename(ancestor));
    ancestor = parent;
  }
  const physicalAncestor = existsSync(ancestor) ? realpathSync.native(ancestor) : ancestor;
  return join(physicalAncestor, ...suffix, leaf);
}

function lockOwner(path: string): StateLockOwner | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<StateLockOwner>;
    return Number.isSafeInteger(parsed.pid) && Number(parsed.pid) > 0
      && typeof parsed.token === "string" && parsed.token.length >= 16
      ? { pid: Number(parsed.pid), token: parsed.token }
      : undefined;
  } catch { return undefined; }
}

function removeStaleLock(path: string): void {
  const reaperPath = `${path}.reaper`;
  let reaperFd: number | undefined;
  try {
    reaperFd = openSync(reaperPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return;
    throw error;
  }
  try {
    if (!existsSync(path)) return;
    // Re-read after acquiring the reaper. Another reaper may have removed the stale inode and a new
    // live owner may already hold the ordinary lock path.
    const owner = lockOwner(path);
    const age = Date.now() - statSync(path).mtimeMs;
    // An unreadable owner cannot be proven stale. The acquisition path removes its own partial
    // record on write failure; a crash during that tiny boundary therefore fails closed.
    if (!owner || processRunning(owner.pid)) return;
    if (age < STALE_LOCK_MS) return;
    rmSync(path, { force: true });
  } finally {
    if (reaperFd !== undefined) closeSync(reaperFd);
    rmSync(reaperPath, { force: true });
  }
}

/** Serialize a synchronous read/merge/atomic-write transaction across daemon processes. */
export function withChatGptStateFileLock<T>(statePath: string, action: () => T): T {
  const lockPath = `${statePath}.lock`;
  mkdirSync(dirname(statePath), { recursive: true, mode: 0o700 });
  const owner: StateLockOwner = {
    pid: process.pid,
    token: randomBytes(18).toString("base64url"),
  };
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let fd: number | undefined;
  let lockIdentity: { dev: number; ino: number } | undefined;
  for (;;) {
    try {
      fd = openSync(lockPath, "wx", 0o600);
      try {
        const owned = fstatSync(fd);
        lockIdentity = { dev: owned.dev, ino: owned.ino };
        writeFileSync(fd, `${JSON.stringify(owner)}\n`);
      } catch (error) {
        closeSync(fd);
        fd = undefined;
        try {
          if (existsSync(lockPath)) {
            const current = statSync(lockPath);
            if (!lockIdentity || (current.dev === lockIdentity.dev && current.ino === lockIdentity.ino)) {
              rmSync(lockPath, { force: true });
            }
          }
        } catch { /* Preserve a replaced path; surface the original write failure. */ }
        throw error;
      }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      removeStaleLock(lockPath);
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for ChatGPT state ownership lock: ${lockPath}`);
      }
      Atomics.wait(waitCell, 0, 0, LOCK_WAIT_MS);
    }
  }
  try {
    return action();
  } finally {
    if (fd !== undefined) closeSync(fd);
    try {
      const currentOwner = lockOwner(lockPath);
      const current = existsSync(lockPath) ? statSync(lockPath) : undefined;
      if (currentOwner?.pid === owner.pid && currentOwner.token === owner.token
        && current && lockIdentity && current.dev === lockIdentity.dev && current.ino === lockIdentity.ino) {
        rmSync(lockPath, { force: true });
      }
    } catch {
      // Preserve a replaced/foreign lock. A stale lock is recovered by the next bounded owner.
    }
  }
}
