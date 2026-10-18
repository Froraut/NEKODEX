import { CanonicalHistoryCapture } from "./canonical";
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, lstatSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import type {
  CaptureRecord, HistoryMarkdownExport, HistoryMessage, HistoryPage, HistoryPageOptions,
  HistorySearch, HistoryStatus, HistoryThread, MessageIdentity, RecordResult, ThreadIdentity,
} from "./types";

const owners = new Set<string>();
const DEFAULT_MESSAGE_BYTES = 512 * 1024;
const DEFAULT_STORED_BYTES = 256 * 1024 * 1024;
const MAX_EXPORT_MESSAGES = 1000;
const MAX_EXPORT_BYTES = 8 * 1024 * 1024;
const bytes = (text: string) => Buffer.byteLength(text, "utf8");
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const key = (id: MessageIdentity) => JSON.stringify([id.clientId, id.threadId, id.messageId]);
const integer = (value: number, name: string, minimum = 0) => {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`Invalid ${name}`);
  return value;
};
function identifier(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !value.trim() || bytes(value) > 512 || /[\u0000-\u001f]/u.test(value)) throw new Error(`Invalid ${name}`);
}
function validateIdentity(id: ThreadIdentity | MessageIdentity) {
  identifier(id.clientId, "clientId");
  identifier(id.threadId, "threadId");
  if ("messageId" in id) identifier(id.messageId, "messageId");
}
function validate(record: CaptureRecord) {
  validateIdentity(record);
  identifier(record.revisionId, "revisionId");
  integer(record.revisionNumber, "revisionNumber");
  integer(record.timestamp, "timestamp");
  for (const field of ["turnId", "compactionId"] as const) if (record[field] !== null) identifier(record[field], field);
  if (!["user", "assistant"].includes(record.role)) throw new Error("Only user/assistant message text is accepted");
  if (!["human", "assistant", "agent", "unknown"].includes(record.author)) throw new Error("Explicit author required");
  if (!["responses", "native", "chatgpt-web", "manual-import", "unknown"].includes(record.source)) throw new Error("Explicit source required");
  if (!["caller-validated", "unknown", "known-pattern-filtered"].includes(record.sensitivity)) throw new Error("Explicit sensitivity state required");
  if (!["user-assistant-text-v1","canonical-thread-text-v1"].includes(record.capturePolicy)) throw new Error("Explicit capture policy required");
  if(record.capturePolicy === "canonical-thread-text-v1") {
    const canonical=record.canonical;
    if(record.sensitivity!=="known-pattern-filtered"||record.source!=="native"||record.author!=="unknown"||record.coverage!=="partial"||!canonical||canonical.policyVersion!=="known-pattern-filter-v1"||!/^[a-f0-9]{64}$/.test(canonical.fingerprint)||!["native","observed-at"].includes(canonical.timestampSource)||!["complete","partial"].includes(canonical.sourceCoverage))throw new Error("Invalid canonical text policy");
    integer(canonical.observedAt,"canonical observation time");integer(canonical.originalBytes,"canonical original bytes");
    if(canonical.originalBytes>16*1024*1024||canonical.exclusionReason!==null&&typeof canonical.exclusionReason!=="string"||canonical.exclusionReason&&record.text!==""||!canonical.exclusionReason&&canonical.originalBytes!==bytes(record.text))throw new Error("Invalid canonical exclusion metadata");
  } else if(record.sensitivity==="known-pattern-filtered"||record.canonical!==undefined)throw new Error("Manual records cannot claim canonical filtering");
  if (!["complete", "partial"].includes(record.coverage) || typeof record.text !== "string") throw new Error("Invalid text coverage");
  if (record.coverageReason !== undefined && (typeof record.coverageReason !== "string" || bytes(record.coverageReason) > 1024)) throw new Error("Invalid coverageReason");
  if (record.coverage === "partial" && !record.coverageReason?.trim()) throw new Error("Partial text needs a coverage reason");
}
function pagination(options: HistoryPageOptions, maximum = 200) {
  return { limit: Math.min(integer(options.limit ?? 50, "limit", 1), maximum), offset: integer(options.offset ?? 0, "offset") };
}
export function historyMessageLink(record: Pick<CaptureRecord, "clientId" | "threadId" | "messageId" | "revisionId">) {
  const params = new URLSearchParams({ client: record.clientId, thread: record.threadId, message: record.messageId, revision: record.revisionId });
  return `nekodex://history?${params}`;
}
type StoredRow = { record_json: string; original_bytes: number };
function message(row: StoredRow): HistoryMessage {
  const record = JSON.parse(row.record_json) as HistoryMessage;
  return { ...record, originalBytes: row.original_bytes, link: historyMessageLink(record) };
}

/** Synchronous single-owner writer. Composition roots own and close one instance.
 * No transcript discovery, background jobs, automatic retention/purge, or network. */
export class ConversationHistoryStore {
  readonly path: string;
  readonly canonical: CanonicalHistoryCapture;
  private db: Database;
  private closed = false;
  private maxMessageBytes: number;
  private maxStoredBytes: number;

  constructor(options: { coreHome: string; maxMessageBytes?: number; maxStoredBytes?: number }) {
    if (!options.coreHome?.trim()) throw new Error("Explicit coreHome required");
    this.maxMessageBytes = integer(options.maxMessageBytes ?? DEFAULT_MESSAGE_BYTES, "maxMessageBytes", 1);
    this.maxStoredBytes = integer(options.maxStoredBytes ?? DEFAULT_STORED_BYTES, "maxStoredBytes", 1);
    const directory = resolve(options.coreHome, "conversation-history");
    this.path = join(directory, "history.sqlite");
    if (owners.has(this.path)) throw new Error("Conversation history already has a writer");
    for (const path of [directory, this.path]) if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error("History paths must not be symbolic links");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    this.db = new Database(this.path, { create: true, strict: true });
    try {
      chmodSync(this.path, 0o600);
      this.db.exec(`PRAGMA busy_timeout = 100; PRAGMA foreign_keys = ON; PRAGMA journal_mode = DELETE; PRAGMA secure_delete = ON; PRAGMA locking_mode = EXCLUSIVE;
        CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL DEFAULT 0,
          quota_reached INTEGER NOT NULL DEFAULT 0, quota_rejected INTEGER NOT NULL DEFAULT 0, stored_bytes INTEGER NOT NULL DEFAULT 0);
        INSERT OR IGNORE INTO settings(id) VALUES(1);
        CREATE TABLE IF NOT EXISTS revisions (
          id INTEGER PRIMARY KEY, message_key TEXT NOT NULL, revision_id TEXT NOT NULL, revision_number INTEGER NOT NULL,
          fingerprint TEXT NOT NULL, record_json TEXT NOT NULL, original_bytes INTEGER NOT NULL, stored_bytes INTEGER NOT NULL,
          UNIQUE(message_key, revision_id), UNIQUE(message_key, revision_number));
        CREATE TABLE IF NOT EXISTS messages (
          message_key TEXT PRIMARY KEY, client_id TEXT NOT NULL, thread_id TEXT NOT NULL, message_id TEXT NOT NULL,
          revision_row INTEGER NOT NULL REFERENCES revisions(id), revision_number INTEGER NOT NULL,
          timestamp INTEGER NOT NULL, incomplete INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS messages_thread ON messages(client_id, thread_id, timestamp, message_key);
        CREATE VIRTUAL TABLE IF NOT EXISTS message_search USING fts5(message_key UNINDEXED, text, tokenize='unicode61');`);
      this.canonical = new CanonicalHistoryCapture({db:this.db,record:record=>this.record(record),getMessage:identity=>this.getMessage(identity),status:()=>this.status()});
      owners.add(this.path);
    } catch (error) { this.db.close(); throw error; }
  }
  private assertOpen() { if (this.closed) throw new Error("Conversation history is closed"); }
  close() {
    if (this.closed) return;
    this.db.close(); this.closed = true; owners.delete(this.path);
  }
  status(): HistoryStatus {
    this.assertOpen();
    const state = this.db.query("SELECT * FROM settings WHERE id=1").get() as { enabled: number; quota_reached: number; quota_rejected: number; stored_bytes: number };
    const counts = this.db.query("SELECT COUNT(*) AS total, COALESCE(SUM(incomplete),0) AS incomplete FROM messages").get() as { total: number; incomplete: number };
    const revisions = this.db.query("SELECT COUNT(*) AS count FROM revisions").get() as { count: number };
    const indexed = this.db.query("SELECT COUNT(*) AS count FROM message_search").get() as { count: number };
    return { recordingEnabled: !!state.enabled, quotaReached: !!state.quota_reached, quotaRejected: state.quota_rejected,
      storedBytes: state.stored_bytes, maxStoredBytes: this.maxStoredBytes, maxMessageBytes: this.maxMessageBytes,
      totalMessages: counts.total, indexedMessages: indexed.count, incompleteMessages: counts.incomplete,
      revisions: revisions.count, captureScope: "explicit-policy-user-assistant-text", transcriptCoverage: "unknown" };
  }
  setRecordingEnabled(enabled: boolean): HistoryStatus {
    this.assertOpen();
    if (typeof enabled !== "boolean") throw new Error("Recording setting must be boolean");
    this.db.query("UPDATE settings SET recording_epoch=recording_epoch+CASE WHEN enabled!=? THEN 1 ELSE 0 END,enabled=? WHERE id=1").run(enabled ? 1 : 0,enabled ? 1 : 0);
    return this.status();
  }
  record(record: CaptureRecord): RecordResult {
    this.assertOpen();
    if (!(this.db.query("SELECT enabled FROM settings WHERE id=1").get() as {enabled:number}).enabled) return { outcome: "disabled" };
    validate(record);
    // Whitelist fields: arbitrary extra caller properties must never reach storage.
    const canonical: CaptureRecord = { clientId: record.clientId, threadId: record.threadId, messageId: record.messageId,
      revisionId: record.revisionId, revisionNumber: record.revisionNumber, turnId: record.turnId, compactionId: record.compactionId,
      role: record.role, author: record.author, source: record.source, text: record.text, timestamp: record.timestamp,
      coverage: record.coverage, ...(record.coverageReason === undefined ? {} : { coverageReason: record.coverageReason }), capturePolicy: record.capturePolicy, sensitivity: record.sensitivity, ...(record.canonical?{canonical:record.canonical}:{}) };
    const messageKey = key(record);
    const originalBytes = record.canonical?.originalBytes ?? bytes(record.text);
    const rejectionReason = record.canonical?.exclusionReason ?? (record.sensitivity === "unknown" ? "sensitivity-unverified" : originalBytes > this.maxMessageBytes ? "message-size-limit" : null);
    const rejected = rejectionReason !== null;
    const stored = rejected ? { ...canonical, text: null, coverage: "rejected", coverageReason: rejectionReason } : canonical;
    const recordJson = JSON.stringify(stored);
    // Rejected text (including unknown sensitivity) is never hashed or persisted.
    const fingerprint = digest(recordJson + ":" + originalBytes);
    const storedBytes = bytes(recordJson) + bytes(messageKey) + 256;
    return this.db.transaction((): RecordResult => {
      const duplicate = this.db.query("SELECT * FROM revisions WHERE message_key=? AND (revision_id=? OR revision_number=?)").all(messageKey, record.revisionId, record.revisionNumber) as Array<StoredRow & { id: number; fingerprint: string; revision_id: string; revision_number: number }>;
      if (duplicate.length) {
        const previous = duplicate[0]!;
        if (duplicate.length !== 1 || previous.revision_id !== record.revisionId || previous.revision_number !== record.revisionNumber || previous.fingerprint !== fingerprint) throw new Error("History revision identity conflict");
        const current = this.db.query("SELECT revision_row FROM messages WHERE message_key=?").get(messageKey) as { revision_row: number };
        return { outcome: "duplicate", latest: current.revision_row === previous.id, message: message(previous) };
      }
      const state = this.db.query("SELECT quota_reached,stored_bytes FROM settings WHERE id=1").get() as {quota_reached:number;stored_bytes:number};
      if (state.quota_reached || state.stored_bytes + storedBytes > this.maxStoredBytes) {
        this.db.query("UPDATE settings SET quota_reached=1, quota_rejected=quota_rejected+1 WHERE id=1").run();
        return { outcome: "quota-reached" };
      }
      const current = this.db.query("SELECT m.revision_number, r.record_json FROM messages m JOIN revisions r ON r.id=m.revision_row WHERE m.message_key=?").get(messageKey) as { revision_number: number; record_json: string } | null;
      if (current && JSON.parse(current.record_json).role !== record.role) throw new Error("Message role cannot change across revisions");
      const insert = this.db.query("INSERT INTO revisions(message_key,revision_id,revision_number,fingerprint,record_json,original_bytes,stored_bytes) VALUES(?,?,?,?,?,?,?)")
        .run(messageKey, record.revisionId, record.revisionNumber, fingerprint, recordJson, originalBytes, storedBytes);
      this.db.query("UPDATE settings SET stored_bytes=stored_bytes+? WHERE id=1").run(storedBytes);
      const latest = !current || record.revisionNumber > current.revision_number;
      if (latest) {
        this.db.query("INSERT INTO messages(message_key,client_id,thread_id,message_id,revision_row,revision_number,timestamp,incomplete) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(message_key) DO UPDATE SET revision_row=excluded.revision_row,revision_number=excluded.revision_number,timestamp=excluded.timestamp,incomplete=excluded.incomplete")
          .run(messageKey, record.clientId, record.threadId, record.messageId, Number(insert.lastInsertRowid), record.revisionNumber, record.timestamp, rejected || record.coverage === "partial" ? 1 : 0);
        this.db.query("DELETE FROM message_search WHERE message_key=?").run(messageKey);
        if (!rejected && record.text.length) this.db.query("INSERT INTO message_search(message_key,text) VALUES(?,?)").run(messageKey, record.text);
      }
      return { outcome: rejected ? "rejected" : "recorded", latest, message: message({ record_json: recordJson, original_bytes: originalBytes }) };
    }).immediate();
  }
  private page<T>(items: T[], total: number, limit: number, offset: number): HistoryPage<T> {
    const status = this.status();
    return { items, total, limit, offset, hasMore: offset + items.length < total, coverage: {
      totalMessages: status.totalMessages, indexedMessages: status.indexedMessages, incompleteMessages: status.incompleteMessages, transcriptCoverage: "unknown" } };
  }
  listThreads(options: HistoryPageOptions = {}): HistoryPage<HistoryThread> {
    this.assertOpen(); const { limit, offset } = pagination(options);
    const total = (this.db.query("SELECT COUNT(*) AS n FROM (SELECT 1 FROM messages GROUP BY client_id,thread_id)").get() as { n: number }).n;
    const rows = this.db.query("SELECT client_id AS clientId,thread_id AS threadId,COUNT(*) AS messages,SUM(incomplete) AS incompleteMessages,MAX(timestamp) AS updatedAt FROM messages GROUP BY client_id,thread_id ORDER BY updatedAt DESC,client_id,thread_id LIMIT ? OFFSET ?").all(limit, offset) as HistoryThread[];
    return this.page(rows, total, limit, offset);
  }
  getThread(options: ThreadIdentity & HistoryPageOptions): HistoryPage<HistoryMessage> {
    this.assertOpen(); validateIdentity(options); const { limit, offset } = pagination(options, 200);
    const total = (this.db.query("SELECT COUNT(*) AS n FROM messages WHERE client_id=? AND thread_id=?").get(options.clientId, options.threadId) as { n: number }).n;
    const rows = this.db.query("SELECT r.record_json,r.original_bytes FROM messages m JOIN revisions r ON r.id=m.revision_row WHERE m.client_id=? AND m.thread_id=? ORDER BY m.timestamp,m.message_key LIMIT ? OFFSET ?").all(options.clientId, options.threadId, limit, offset) as StoredRow[];
    return this.page(rows.map(message), total, limit, offset);
  }
  getMessage(identity: MessageIdentity & { revisionId?: string }): HistoryMessage | null {
    this.assertOpen(); validateIdentity(identity);
    if (identity.revisionId !== undefined) identifier(identity.revisionId, "revisionId");
    const row = (identity.revisionId === undefined
      ? this.db.query("SELECT r.record_json,r.original_bytes FROM messages m JOIN revisions r ON r.id=m.revision_row WHERE m.message_key=?").get(key(identity))
      : this.db.query("SELECT record_json,original_bytes FROM revisions WHERE message_key=? AND revision_id=?").get(key(identity), identity.revisionId)) as StoredRow | null;
    return row ? message(row) : null;
  }
  search(options: HistorySearch): HistoryPage<HistoryMessage> {
    this.assertOpen(); const { limit, offset } = pagination(options);
    if (typeof options.query !== "string" || bytes(options.query) > 1024) throw new Error("Search query must be at most 1024 bytes");
    if (options.clientId !== undefined) identifier(options.clientId, "clientId");
    if (options.threadId !== undefined) identifier(options.threadId, "threadId");
    // Literal terms avoid exposing arbitrary FTS expression syntax or expensive prefixes.
    const terms = options.query.match(/[\p{L}\p{N}_]+/gu) ?? [];
    if (terms.length > 32) throw new Error("Search supports at most 32 terms");
    if (!terms.length) return this.page([], 0, limit, offset);
    const query = terms.map(term => `"${term}"`).join(" AND ");
    const where = "message_search MATCH ?" + (options.clientId === undefined ? "" : " AND m.client_id=?") + (options.threadId === undefined ? "" : " AND m.thread_id=?");
    const args = [query, ...(options.clientId === undefined ? [] : [options.clientId]), ...(options.threadId === undefined ? [] : [options.threadId])];
    const from = "FROM message_search JOIN messages m ON m.message_key=message_search.message_key JOIN revisions r ON r.id=m.revision_row";
    const total = (this.db.query(`SELECT COUNT(*) AS n ${from} WHERE ${where}`).get(...args) as { n: number }).n;
    const rows = this.db.query(`SELECT r.record_json,r.original_bytes ${from} WHERE ${where} ORDER BY bm25(message_search),m.timestamp DESC,m.message_key LIMIT ? OFFSET ?`).all(...args, limit, offset) as StoredRow[];
    return this.page(rows.map(message), total, limit, offset);
  }
  deleteMessage(identity: MessageIdentity): { deletedMessages: number } {
    validateIdentity(identity); return this.remove("message_key=?", [key(identity)]);
  }
  deleteThread(identity: ThreadIdentity): { deletedMessages: number } {
    validateIdentity(identity); return this.remove("client_id=? AND thread_id=?", [identity.clientId, identity.threadId]);
  }
  private remove(where: string, args: string[]): { deletedMessages: number } {
    this.assertOpen();
    return this.db.transaction(() => {
      const rows = this.db.query(`SELECT message_key FROM messages WHERE ${where}`).all(...args) as Array<{ message_key: string }>;
      for (const row of rows) {
        const removed = this.db.query("SELECT COALESCE(SUM(stored_bytes),0) AS bytes FROM revisions WHERE message_key=?").get(row.message_key) as {bytes:number};
        this.db.query("UPDATE settings SET stored_bytes=stored_bytes-? WHERE id=1").run(removed.bytes);
        this.db.query("DELETE FROM message_search WHERE message_key=?").run(row.message_key);
        this.db.query("DELETE FROM messages WHERE message_key=?").run(row.message_key);
        this.db.query("DELETE FROM revisions WHERE message_key=?").run(row.message_key);
      }
      // Only an explicit delete releases a latched quota stop. Disabling preserves it.
      if (rows.length && this.status().storedBytes < this.maxStoredBytes) this.db.query("UPDATE settings SET quota_reached=0 WHERE id=1").run();
      return { deletedMessages: rows.length };
    }).immediate();
  }
  exportMarkdown(options: ThreadIdentity & { messageIds?: string[]; messageRevisions?: Array<{messageId:string;revisionId:string}> }): HistoryMarkdownExport {
    validateIdentity(options);
    if (options.messageIds !== undefined && (!Array.isArray(options.messageIds) || !options.messageIds.length || options.messageIds.length > MAX_EXPORT_MESSAGES)) throw new Error("Select between 1 and 1000 message IDs");
    for (const id of options.messageIds ?? []) identifier(id, "messageId");
    if (options.messageRevisions !== undefined && (!Array.isArray(options.messageRevisions) || !options.messageRevisions.length || options.messageRevisions.length > MAX_EXPORT_MESSAGES || options.messageIds !== undefined)) throw new Error("Select either message IDs or between 1 and 1000 exact revisions");
    const exact = options.messageRevisions ? [...new Map(options.messageRevisions.map(item => {
      identifier(item?.messageId, "messageId"); identifier(item?.revisionId, "revisionId"); return [JSON.stringify([item.messageId,item.revisionId]), item];
    })).values()] : null;
    const selected = options.messageIds ? new Set(options.messageIds) : null;
    this.assertOpen();
    let total: number;
    let records: Iterable<StoredRow>;
    if (exact) {
      total = exact.length;
      records = this.db.query(`SELECT r.record_json,r.original_bytes FROM messages m JOIN revisions r ON r.message_key=m.message_key WHERE m.client_id=? AND m.thread_id=? AND (m.message_id,r.revision_id) IN (${exact.map(() => "(?,?)").join(",")}) ORDER BY m.timestamp,m.message_key,r.revision_number`).iterate(options.clientId, options.threadId, ...exact.flatMap(item => [item.messageId,item.revisionId])) as Iterable<StoredRow>;
    } else if (selected) {
      const ids = [...selected]; total = selected.size;
      records = this.db.query(`SELECT r.record_json,r.original_bytes FROM messages m JOIN revisions r ON r.id=m.revision_row WHERE m.client_id=? AND m.thread_id=? AND m.message_id IN (${ids.map(() => "?").join(",")}) ORDER BY m.timestamp,m.message_key`).iterate(options.clientId, options.threadId, ...ids) as Iterable<StoredRow>;
    } else {
      total = (this.db.query("SELECT COUNT(*) AS n FROM messages WHERE client_id=? AND thread_id=?").get(options.clientId,options.threadId) as {n:number}).n;
      records = this.db.query("SELECT r.record_json,r.original_bytes FROM messages m JOIN revisions r ON r.id=m.revision_row WHERE m.client_id=? AND m.thread_id=? ORDER BY m.timestamp,m.message_key LIMIT ?").iterate(options.clientId,options.threadId,MAX_EXPORT_MESSAGES) as Iterable<StoredRow>;
    }
    const rows: HistoryMessage[] = [];
    let selectionBytes = 0;
    for (const row of records) {
      selectionBytes += bytes(row.record_json);
      if (selectionBytes > MAX_EXPORT_BYTES) throw new Error("Export exceeds 8 MiB; select fewer messages");
      rows.push(message(row));
    }
    const incompleteMessages = rows.filter(row => row.coverage !== "complete").length;
    const hasMore = rows.length < total;
    const partial = true; // Full transcript coverage cannot be inferred from recorded rows.
    const lines = ["# NEKODEX conversation text export", "", `Client: ${JSON.stringify(options.clientId)}`, `Thread: ${JSON.stringify(options.threadId)}`, "",
      "Scope: explicitly retained user/assistant text. Manual selections are caller-checked. Native canonical capture excludes structured machine items and known sensitive/generated patterns; unknown secrets may remain. The store does not certify exhaustive redaction.",
      "PARTIAL CORPUS — transcript coverage is unknown. Recording may have been disabled or messages may not have reached the capture boundary.",
      `Selection: ${exact ? "selected exact revisions" : selected ? "selected messages" : "thread latest messages"}; exported ${rows.length}/${total}; incomplete text ${incompleteMessages}${hasMore ? "; PARTIAL: some selected messages are unavailable or the 1000-message export limit was reached" : ""}.`, ""];
    for (const row of rows) lines.push(`## ${row.role} — ${JSON.stringify(row.messageId)}`, "", `[Open exact message revision](${row.link})`, "",
      `Author: ${row.author}; source: ${row.source}; revision: ${JSON.stringify(row.revisionId)} (${row.revisionNumber}); turn: ${JSON.stringify(row.turnId)}; compaction: ${JSON.stringify(row.compactionId)}.`,
      `Text coverage: ${row.coverage}${row.coverageReason ? ` (${row.coverageReason})` : ""}.`, "", row.text ?? `[Text rejected: ${row.originalBytes} UTF-8 bytes; ${row.coverageReason}.]`, "");
    const markdown = lines.join("\n");
    if (bytes(markdown) > MAX_EXPORT_BYTES) throw new Error("Export exceeds 8 MiB; select fewer messages");
    return { markdown, exportedMessages: rows.length, totalMessages: total, incompleteMessages, partial, hasMore };
  }
}
