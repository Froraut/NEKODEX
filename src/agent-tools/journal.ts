import { Database } from "bun:sqlite";
import { chmodSync, existsSync, lstatSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { sha256 } from "./config";
import type { ToolInvocation, ToolOutcome, ToolScope } from "./types";

function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value && Object.getPrototypeOf(value) === Object.prototype) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  throw new Error("Tool arguments must be JSON values");
}
export function validateToolScope(scope: ToolScope): void {
  if (!scope || typeof scope.taskId !== "string" || !scope.taskId || scope.taskId.length > 200 || !Number.isSafeInteger(scope.generation) || scope.generation < 1 || typeof scope.toolCallId !== "string" || !scope.toolCallId || scope.toolCallId.length > 200) throw new Error("Invalid tool scope");
}
export function invocationFingerprint(request: Pick<ToolInvocation, "scope" | "tool" | "arguments">): string {
  validateToolScope(request.scope);
  if (typeof request.tool !== "string" || !request.tool || request.tool.length > 240) throw new Error("Invalid tool identity");
  const bytes = canonical({ scope: request.scope, tool: request.tool, arguments: request.arguments });
  if (Buffer.byteLength(bytes) > 256 * 1024) throw new Error("Tool input limit exceeded");
  return sha256(bytes);
}
/** Exact existing receipt lookup for passive task recovery. No constructor,
 * CREATE/PRAGMA, grant, dispatch or new journal row is performed. */
export function readExistingToolOutcome(path: string, request: Pick<ToolInvocation, 'scope' | 'tool' | 'arguments' | 'idempotencyKey'>): ToolOutcome | undefined {
  if (!existsSync(path)) return;
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o077)) throw new Error('Unsafe retained tool journal');
  const fingerprint = invocationFingerprint(request), db = new Database(path, { readonly: true });
  try {
    const row = db.query('SELECT fingerprint,receipt FROM tool_calls WHERE id=?').get(request.idempotencyKey) as { fingerprint: string; receipt: string } | null;
    if (!row) return; if (row.fingerprint !== fingerprint) throw new Error('Retained tool identity conflict');
    const value = JSON.parse(row.receipt) as ToolOutcome;
    if (value.idempotencyKey !== request.idempotencyKey || canonical(value.scope) !== canonical(request.scope) || value.tool !== request.tool) throw new Error('Retained tool receipt identity conflict');
    return value;
  } finally { db.close(); }
}
/** Write an unknown receipt before dispatch. A process loss can never create a replayable gap. */
export class ToolJournal {
  private db: Database;
  constructor(path: string) {
    if (process.platform === "win32") throw new Error("Private tool journal requires an unavailable Windows ACL backend");
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    if (existsSync(path)) {
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error("Tool journal must be private");
    }
    this.db = new Database(path, { create: true });
    chmodSync(path, 0o600);
    this.db.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS tool_calls (id TEXT PRIMARY KEY, event_id TEXT UNIQUE NOT NULL, scope_key TEXT UNIQUE NOT NULL, fingerprint TEXT NOT NULL, receipt TEXT NOT NULL)");
  }
  get(id: string): ToolOutcome | undefined {
    const row = this.db.query("SELECT receipt FROM tool_calls WHERE id=?").get(id) as { receipt: string } | null;
    return row ? JSON.parse(row.receipt) : undefined;
  }
  getBySourceEvent(sourceEventId: string): ToolOutcome | undefined {
    const row = this.db.query("SELECT receipt FROM tool_calls WHERE event_id=?").get(sourceEventId) as { receipt: string } | null;
    return row ? JSON.parse(row.receipt) : undefined;
  }
  existing(request: Pick<ToolInvocation, "scope" | "tool" | "arguments" | "idempotencyKey">): ToolOutcome | undefined {
    if (typeof request.idempotencyKey !== "string" || !request.idempotencyKey || request.idempotencyKey.length > 240) throw new Error("Invalid tool idempotency key");
    const fingerprint = invocationFingerprint(request);
    const scopeKey = canonical(request.scope);
    const row = (this.db.query("SELECT fingerprint,receipt FROM tool_calls WHERE id=?").get(request.idempotencyKey) ?? this.db.query("SELECT fingerprint,receipt FROM tool_calls WHERE scope_key=?").get(scopeKey)) as { fingerprint: string; receipt: string } | null;
    if (!row) return undefined;
    if (row.fingerprint !== fingerprint) throw new Error("Tool idempotency identity conflict");
    return JSON.parse(row.receipt);
  }
  begin(request: ToolInvocation, sourcePrefix = "mcp"): { inserted: boolean; outcome: ToolOutcome } {
    if (!/^[a-z][a-z0-9_-]{0,39}$/.test(sourcePrefix)) throw new Error("Invalid trusted tool source namespace");
    const fingerprint = invocationFingerprint(request); const scopeKey = canonical(request.scope);
    const outcome: ToolOutcome = { idempotencyKey: request.idempotencyKey, scope: request.scope, tool: request.tool, state: "outcome_unknown", reason: "Dispatch admitted; terminal server receipt not established" };
    return this.db.transaction(() => {
      const existing = this.existing(request); if (existing) return { inserted: false, outcome: existing };
      this.db.query("INSERT INTO tool_calls VALUES (?,?,?,?,?)").run(request.idempotencyKey, `${sourcePrefix}:${sha256(request.idempotencyKey)}`, scopeKey, fingerprint, JSON.stringify(outcome));
      return { inserted: true, outcome };
    })();
  }
  settle(outcome: ToolOutcome): ToolOutcome {
    const encoded = JSON.stringify(outcome);
    if (Buffer.byteLength(encoded) > 240 * 1024) throw new Error("Tool result limit exceeded");
    const prior = this.get(outcome.idempotencyKey);
    if (!prior || prior.state !== "outcome_unknown") throw new Error("Tool receipt already settled or missing");
    if (canonical(prior.scope) !== canonical(outcome.scope) || prior.tool !== outcome.tool) throw new Error("Tool receipt scope conflict");
    this.db.query("UPDATE tool_calls SET receipt=? WHERE id=?").run(encoded, outcome.idempotencyKey);
    return structuredClone(outcome);
  }
  close(): void { this.db.close(); }
}
