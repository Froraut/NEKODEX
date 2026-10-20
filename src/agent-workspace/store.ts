import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { verifyAgentWorkspaceGrant } from "../../launcher/electron/agent-workspace-grant.cjs";
import { captureFiles, chain, assertChain, type CapturedWorkspaceFile } from "../../launcher/electron/workspace-file-capture.cjs";

const LIMITS = Object.freeze({ snapshots: 48, attempts: 512, storedBytes: 64 * 1024 * 1024 });
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
function fail(code: string, message: string): never { throw Object.assign(new Error(message), { code }); }
function id(value: string): void {
  if (typeof value !== "string" || !/^[a-f0-9-]{36}$/.test(value)) fail("INVALID_ID", "Invalid task snapshot identity.");
}
export interface SnapshotTask {
  id: string; familyId: string; generation: number; workspaceSnapshotGrant?: unknown;
}
export interface TaskSnapshotReceipt {
  version: 1; id: string; snapshotId: string; state: "admitted";
  taskId: string; familyId: string; generation: number; dispatchId: string;
  grantId: string; workspaceId: string; totalBytes: number; createdAt: number;
  files: { path: string; revision: string | null; contentHash: string | null; missing: boolean; size: number }[];
}
type Attempt = { dispatchId: string; identityDigest: string; state: "preparing" | "admitted" | "failed";
  receipt: string | null; snapshot: string | null; totalBytes: number; failure: string | null };
export type BeforeTurnReceipt = { state: "skipped" } | { state: "ready"; duplicate: boolean; receipt: TaskSnapshotReceipt };

/** One Bun writer. Capture is opt-in; opening/reading this owner never snapshots a workspace. */
export function createAgentWorkspaceSnapshots({ storagePath, keyPath, now = Date.now }: {
  storagePath: string; keyPath: string; now?: () => number;
}) {
  if (!isAbsolute(storagePath) || !isAbsolute(keyPath)) fail("INVALID_STORAGE", "Use trusted absolute task snapshot storage paths.");
  const directory = dirname(storagePath);
  let existing = directory;
  while (!lstatSync(existing, { throwIfNoEntry: false })) existing = dirname(existing);
  chain(existing);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const storageChain = chain(directory);
  const privateStat = lstatSync(directory);
  if (realpathSync(directory) !== directory || (process.getuid && privateStat.uid !== process.getuid())
      || (process.platform !== "win32" && (privateStat.mode & 0o077) !== 0)) fail("UNSAFE_STORAGE", "Task snapshots require a private owned directory.");
  const file = lstatSync(storagePath, { throwIfNoEntry: false });
  if (file && (!file.isFile() || file.isSymbolicLink() || (process.getuid && file.uid !== process.getuid())
      || (process.platform !== "win32" && (file.mode & 0o077) !== 0))) fail("UNSAFE_STORAGE", "Task snapshot database is unsafe.");
  const db = new Database(storagePath, { create: true, strict: true });
  try {
    if (process.platform !== "win32") chmodSync(storagePath, 0o600);
    db.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA max_page_count=32768");
    const version = (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
    if (version > 1) fail("SCHEMA_UNSUPPORTED", "Task snapshot database is newer than this reader.");
    db.exec(`CREATE TABLE IF NOT EXISTS task_snapshot_attempts (
      dispatchId TEXT PRIMARY KEY, taskId TEXT NOT NULL, generation INTEGER NOT NULL,
      identityDigest TEXT NOT NULL, state TEXT NOT NULL, receipt TEXT, snapshot TEXT,
      totalBytes INTEGER NOT NULL DEFAULT 0, failure TEXT);
      CREATE INDEX IF NOT EXISTS task_snapshot_task ON task_snapshot_attempts(taskId);
      PRAGMA user_version=1`);
  } catch (error) { db.close(); throw error; }

  const databaseNode = lstatSync(storagePath);
  function assertStorage() {
    assertChain(storageChain);
    const directoryStat = lstatSync(directory); const current = lstatSync(storagePath);
    if (!current.isFile() || current.isSymbolicLink() || current.ino !== databaseNode.ino || current.dev !== databaseNode.dev
        || (process.getuid && (current.uid !== process.getuid() || directoryStat.uid !== process.getuid()))
        || (process.platform !== "win32" && ((current.mode & 0o077) !== 0 || (directoryStat.mode & 0o077) !== 0))) {
      fail("UNSAFE_STORAGE", "Task snapshot storage changed; preserve it before continuing.");
    }
  }
  const getAttempt = (dispatchId: string) => db.query("SELECT * FROM task_snapshot_attempts WHERE dispatchId=?").get(dispatchId) as Attempt | null;
  function decode(attempt: Attempt): { receipt: TaskSnapshotReceipt; files: CapturedWorkspaceFile[] } {
    if (attempt.state !== "admitted" || !attempt.receipt || !attempt.snapshot) fail("SNAPSHOT_NOT_ADMITTED", "This dispatch has no completed pre-turn snapshot.");
    const receipt = JSON.parse(attempt.receipt) as TaskSnapshotReceipt;
    const files = JSON.parse(attempt.snapshot) as CapturedWorkspaceFile[];
    if (!Array.isArray(files) || files.length !== receipt.files.length || receipt.dispatchId !== attempt.dispatchId
        || files.some((file, index) => file.path !== receipt.files[index].path
          || file.revision !== receipt.files[index].revision || (file.bytes !== null
            && hash(Buffer.from(file.bytes, "base64")) !== file.contentHash))) {
      fail("SNAPSHOT_INTEGRITY", "Retain this snapshot for integrity recovery; do not execute its dispatch.");
    }
    return { receipt, files };
  }
  async function beforeTurn({ task, generation, dispatchId }: {
    task: SnapshotTask; generation: number; dispatchId: string;
  }): Promise<BeforeTurnReceipt> {
    if (task.workspaceSnapshotGrant === undefined || task.workspaceSnapshotGrant === null) return { state: "skipped" };
    id(task.id); id(task.familyId); id(dispatchId);
    if (!Number.isSafeInteger(generation) || generation < 1 || task.generation !== generation) fail("GENERATION_CHANGED", "Task generation changed before snapshot admission.");
    assertStorage();
    const grant = verifyAgentWorkspaceGrant({ keyPath, grant: task.workspaceSnapshotGrant,
      taskId: task.id, familyId: task.familyId, generation });
    const identityDigest = hash(JSON.stringify({ taskId: task.id, familyId: task.familyId, generation, dispatchId,
      grantId: grant.id, signature: grant.signature, paths: grant.paths }));
    const old = getAttempt(dispatchId);
    if (old) {
      if (old.identityDigest !== identityDigest) fail("SNAPSHOT_IDENTITY_CONFLICT", "Dispatch snapshot identity changed.");
      if (old.state !== "admitted") fail("SNAPSHOT_RECOVERY_REQUIRED", "An incomplete or failed capture is retained. Do not recapture this dispatch or replay its execution.");
      const existingSnapshot = decode(old);
      const current = captureFiles(grant.rootPath, grant.paths);
      verifyAgentWorkspaceGrant({ keyPath, grant, taskId: task.id, familyId: task.familyId, generation });
      if (current.some((file, index) => file.revision !== existingSnapshot.files[index].revision)) {
        fail("SNAPSHOT_BASELINE_CHANGED", "The admitted pre-turn baseline changed. Preserve its snapshot and require a new explicit task action.");
      }
      return { state: "ready", duplicate: true, receipt: existingSnapshot.receipt };
    }
    // A durable preparing row precedes all workspace content reads. A crash at
    // any later boundary leaves an attempt that recovery cannot silently repeat.
    db.transaction(() => {
      const counts = db.query("SELECT COUNT(*) AS attempts, SUM(CASE WHEN state='admitted' THEN 1 ELSE 0 END) AS snapshots FROM task_snapshot_attempts").get() as { attempts: number; snapshots: number };
      if (counts.attempts >= LIMITS.attempts || counts.snapshots >= LIMITS.snapshots) fail("SNAPSHOT_QUOTA", "Task snapshot history is full; preserve existing records before proceeding.");
      db.query("INSERT INTO task_snapshot_attempts(dispatchId,taskId,generation,identityDigest,state) VALUES (?,?,?,?, 'preparing')")
        .run(dispatchId, task.id, generation, identityDigest);
    }).immediate();
    try {
      const files = captureFiles(grant.rootPath, grant.paths);
      const rechecked = captureFiles(grant.rootPath, grant.paths);
      verifyAgentWorkspaceGrant({ keyPath, grant, taskId: task.id, familyId: task.familyId, generation });
      assertStorage();
      if (files.some((file, index) => file.revision !== rechecked[index].revision)) fail("SNAPSHOT_BASELINE_CHANGED", "A selected file changed during pre-turn capture.");
      const totalBytes = files.reduce((sum, file) => sum + (file.bytes === null ? 0 : Buffer.byteLength(file.bytes, "base64")), 0);
      const receipt: TaskSnapshotReceipt = { version: 1, id: randomUUID(), snapshotId: randomUUID(), state: "admitted",
        taskId: task.id, familyId: task.familyId, generation, dispatchId, grantId: grant.id, workspaceId: grant.workspaceId,
        totalBytes, createdAt: now(), files: files.map((file) => ({ path: file.path, revision: file.revision,
          contentHash: file.bytes === null ? null : file.contentHash!, missing: file.bytes === null,
          size: file.bytes === null ? 0 : Buffer.byteLength(file.bytes, "base64") })) };
      db.transaction(() => {
        const total = db.query("SELECT COALESCE(SUM(totalBytes),0) AS bytes FROM task_snapshot_attempts").get() as { bytes: number };
        if (total.bytes + totalBytes > LIMITS.storedBytes) fail("SNAPSHOT_QUOTA", "Private pre-turn snapshot storage is full; no files were removed.");
        db.query("UPDATE task_snapshot_attempts SET state='admitted',receipt=?,snapshot=?,totalBytes=? WHERE dispatchId=? AND state='preparing'")
          .run(JSON.stringify(receipt), JSON.stringify(files), totalBytes, dispatchId);
      }).immediate();
      return { state: "ready", duplicate: false, receipt };
    } catch (error) {
      // No provider offer has happened. Keep a terminal failure, never a new
      // before-image on retry. Diagnostic text/paths/content stay out of this row.
      try { db.query("UPDATE task_snapshot_attempts SET state='failed',failure='snapshot_capture_failed' WHERE dispatchId=? AND state='preparing'").run(dispatchId); } catch {}
      throw error;
    }
  }
  return Object.freeze({ beforeTurn,
    listTask(taskId: string) {
      id(taskId); assertStorage();
      const rows = db.query("SELECT dispatchId,state,receipt,failure FROM task_snapshot_attempts WHERE taskId=? ORDER BY rowid LIMIT 512").all(taskId) as {
        dispatchId: string; state: Attempt["state"]; receipt: string | null; failure: string | null;
      }[];
      return rows.map((row) => ({ dispatchId: row.dispatchId, state: row.state,
          receipt: row.receipt ? JSON.parse(row.receipt) as TaskSnapshotReceipt : null, failure: row.failure }));
    },
    readSnapshot(dispatchId: string) { id(dispatchId); assertStorage(); const attempt = getAttempt(dispatchId);
      if (!attempt) fail("SNAPSHOT_UNKNOWN", "Unknown pre-turn snapshot."); return decode(attempt); },
    close() { db.close(); },
  });
}
