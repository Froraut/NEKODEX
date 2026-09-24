import { createHash, randomUUID } from "node:crypto";
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, lstatSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getConfigDir } from "../../config";

export type CheckpointOutcome = "intent" | "accepted" | "ambiguous" | "interrupted";
export interface CompactionCheckpoint {
  version: 1;
  id: string;
  binding: string;
  createdAt: number;
  expiresAt: number;
  outcome: CheckpointOutcome;
}
const COLUMNS = "version, id, binding, createdAt, expiresAt, outcome";
export const MAX_COMPACTION_CHECKPOINT_RECORDS = 256;
export const MAX_COMPACTION_CHECKPOINT_SUMMARY_BYTES = 128 * 1024;
const TTL_MS = 24 * 60 * 60_000;
type Identity = Pick<CompactionCheckpoint, "id" | "binding">;
function valid(record: CompactionCheckpoint): boolean {
  return record.version === 1
    && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(record.id)
    && /^[a-f0-9]{64}$/.test(record.binding)
    && Number.isSafeInteger(record.createdAt) && Number.isSafeInteger(record.expiresAt)
    && record.createdAt <= Date.now() && record.expiresAt > Date.now()
    && record.expiresAt - record.createdAt === TTL_MS
    && ["intent", "accepted", "ambiguous", "interrupted"].includes(record.outcome);
}

/** Local inspection only: no tokens, executable recovery, or replay authorization. */
export class CompactionCheckpointStore {
  constructor(readonly directory = join(getConfigDir(), "compaction-checkpoints")) {}

  private open(write: boolean): Database | undefined {
    const path = join(this.directory, "checkpoints.sqlite");
    if (!write && !existsSync(path)) return undefined;
    if (write) mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const stat = lstatSync(this.directory);
    if (!stat.isDirectory() || (process.platform !== "win32" &&
      ((stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())))) {
      throw new Error("Unsafe compaction checkpoint directory");
    }
    const file = lstatSync(path, { throwIfNoEntry: false });
    if (file && !file.isFile()) throw new Error("Unsafe compaction checkpoint database");
    const db = new Database(path, write ? { create: true } : { readonly: true });
    try {
      db.exec("PRAGMA busy_timeout=5000");
      if (write) {
        if (process.platform !== "win32") chmodSync(path, 0o600);
        // SQLite owns all locking/recovery. DELETE avoids an indefinitely growing WAL.
        db.exec("PRAGMA auto_vacuum=FULL; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON; PRAGMA max_page_count=12288");
        db.exec(`CREATE TABLE IF NOT EXISTS checkpoints (
          version INTEGER NOT NULL, id TEXT PRIMARY KEY, binding TEXT NOT NULL,
          createdAt INTEGER NOT NULL, expiresAt INTEGER NOT NULL, outcome TEXT NOT NULL,
          summary TEXT
        )`);
      }
      return db;
    } catch (error) { db.close(); throw error; }
  }

  begin(binding: unknown): CompactionCheckpoint {
    const createdAt = Date.now();
    const record: CompactionCheckpoint = {
      version: 1, id: randomUUID(), binding: createHash("sha256").update(JSON.stringify(binding)).digest("hex"),
      createdAt, expiresAt: createdAt + TTL_MS, outcome: "intent",
    };
    const db = this.open(true)!;
    try {
      db.transaction(() => {
        db.query("DELETE FROM checkpoints WHERE expiresAt<=?").run(createdAt);
        const { count } = db.query("SELECT count(*) AS count FROM checkpoints").get() as { count: number };
        if (count >= MAX_COMPACTION_CHECKPOINT_RECORDS) {
          // Retention must not impose a daily compaction quota. Only settled diagnostics
          // are replaceable; an uncertain intent remains protected until expiry.
          const removed = db.query(`DELETE FROM checkpoints WHERE id IN (
            SELECT id FROM checkpoints WHERE outcome IN ('accepted', 'ambiguous', 'interrupted')
            ORDER BY createdAt, id LIMIT ?
          )`).run(count - MAX_COMPACTION_CHECKPOINT_RECORDS + 1);
          if (removed.changes < count - MAX_COMPACTION_CHECKPOINT_RECORDS + 1) {
            throw new Error("Compaction checkpoint store full of unresolved operations");
          }
        }
        db.query("INSERT INTO checkpoints VALUES (?, ?, ?, ?, ?, ?, NULL)")
          .run(record.version, record.id, record.binding, record.createdAt, record.expiresAt, record.outcome);
      }).immediate();
      return record;
    } finally { db.close(); }
  }

  finish(record: Identity, outcome: Exclude<CheckpointOutcome, "intent">, summary?: string): void {
    if (outcome === "accepted" && (typeof summary !== "string" || Buffer.byteLength(summary, "utf8") > MAX_COMPACTION_CHECKPOINT_SUMMARY_BYTES)) {
      throw new Error("Compaction checkpoint summary missing or exceeds byte limit");
    }
    const db = this.open(true)!;
    try {
      db.query("UPDATE checkpoints SET outcome=?, summary=? WHERE id=? AND binding=? AND outcome='intent' AND expiresAt>?")
        .run(outcome, outcome === "accepted" ? summary ?? null : null, record.id, record.binding, Date.now());
    } finally { db.close(); }
  }

  listDiagnostics(): CompactionCheckpoint[] {
    const db = this.open(false);
    if (!db) return [];
    try { return (db.query(`SELECT ${COLUMNS} FROM checkpoints WHERE expiresAt>? ORDER BY createdAt, id`).all(Date.now()) as CompactionCheckpoint[]).filter(valid); }
    finally { db.close(); }
  }

  readDiagnostic(expected: Identity): CompactionCheckpoint | undefined {
    return this.listDiagnostics().find(record => record.id === expected.id && record.binding === expected.binding);
  }

  readSummary(expected: Identity): string | undefined {
    const db = this.open(false);
    if (!db) return undefined;
    try {
      const row = db.query(`SELECT ${COLUMNS}, summary FROM checkpoints WHERE id=? AND binding=? AND outcome='accepted' AND expiresAt>? AND length(CAST(summary AS BLOB))<=?`)
        .get(expected.id, expected.binding, Date.now(), MAX_COMPACTION_CHECKPOINT_SUMMARY_BYTES) as (CompactionCheckpoint & { summary: string }) | null;
      return row && valid(row) && typeof row.summary === "string" ? row.summary : undefined;
    } finally { db.close(); }
  }
}
