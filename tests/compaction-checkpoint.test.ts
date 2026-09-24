import { afterEach, expect, test } from "bun:test";
import { mock } from "node:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, readdirSync, mkdirSync, chmodSync, symlinkSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CompactionCheckpointStore } from "../src/adapters/chatgpt-web/compaction-checkpoint-store";
import { runStructuredCompactionOnce, requestRetainedCompactionHandoff } from "../src/adapters/chatgpt-web/compaction-handoff";
const roots: string[] = [];
afterEach(() => { for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true }); });
function root() { const p = mkdtempSync(join(tmpdir(), "cc-")); roots.push(p); return p; }
const parsed: any = { modelId: "test", options: {}, context: { messages: [{ role: "user", content: "secret task", timestamp: 1 }] }, _rawBody: { input: [{ role: "user", content: "secret task" }] } };
const source: any = { conversationKey: () => "private-conversation", ownerKey: "owner", nativeThreadId: "thread", nativeTurnId: "source-turn" };
function broker() { return { beginCompactionTransaction: async () => ({ token: "secret-control", handoffId: "secret-handoff" }), waitForCompactionHandoff: async () => "secret-summary", abortCompactionTransaction: () => {} } as any; }
test("post-settlement disk failure preserves live summary and warns metadata only without replay", async () => {
 await atHome(async store => {
  let calls = 0; const warnings: unknown[][] = [];
  const warn = mock.method(console, "warn", (...args: unknown[]) => { warnings.push(args); });
  const finish = mock.method(CompactionCheckpointStore.prototype, "finish", () => { throw new Error("secret disk path"); });
  try {
   const start = () => requestRetainedCompactionHandoff({ run() { calls++; return Promise.resolve(""); } } as any, parsed, source, broker(), {} as any, "trace");
   const key = crypto.randomUUID(); const owner = { ownerKey: key, traceIds: ["trace"] };
   expect(await runStructuredCompactionOnce(key, owner, start)).toBe("secret-summary");
   await Promise.resolve();
   expect(await runStructuredCompactionOnce(key, owner, start)).toBe("secret-summary");
   expect(calls).toBe(1); expect(store.listDiagnostics()[0].outcome).toBe("intent");
   expect(warnings.length).toBe(1); expect(JSON.stringify(warnings)).not.toContain("secret");
  } finally { finish.mock.restore(); warn.mock.restore(); }
 });
});

test("summary storage has a UTF-8 byte limit and never stores partial summaries", () => {
 const store = new CompactionCheckpointStore(join(root(), "records"));
 const r = store.begin("binding");
 expect(() => store.finish(r, "accepted", "é".repeat(65537))).toThrow("summary");
 expect(store.readSummary(r)).toBeUndefined();
 store.finish(r, "accepted", "é".repeat(65536));
 expect(store.readSummary(r)).toBe("é".repeat(65536));
});

test("full store preserves active operations, recycles settled records, and reclaims expired space", () => {
 const store = new CompactionCheckpointStore(join(root(), "records"));
 const first = store.begin("first");
 for (let i = 1; i < 256; i++) store.begin(i);
 expect(() => store.begin("overflow")).toThrow("full");
 expect(store.readDiagnostic(first)).toEqual(first);
 store.finish(first, "accepted", "summary");
 const admitted = store.begin("overflow");
 expect(store.readDiagnostic(admitted)?.outcome).toBe("intent");
 expect(store.readSummary(first)).toBeUndefined();
 expect(store.listDiagnostics()).toHaveLength(256);
 expect(store.listDiagnostics().every(r => r.outcome === "intent")).toBe(true);
 const clock = mock.method(Date, "now", () => first.expiresAt + 60_000);
 try {
  expect(store.listDiagnostics()).toEqual([]); expect(store.readSummary(first)).toBeUndefined();
  store.begin("after expiry"); expect(store.listDiagnostics()).toHaveLength(1);
 } finally { clock.mock.restore(); }
});

test("SQLite physical retention uses bounded pages, truncating rollback journals and reclaiming deleted summaries", () => {
 const store = new CompactionCheckpointStore(join(root(), "records"));
 const r = store.begin("large"); store.finish(r, "accepted", "x".repeat(128 * 1024));
 const path = join(store.directory, "checkpoints.sqlite");
 const before = statSync(path).size;
 const db = new Database(path);
 try {
  expect(db.query("PRAGMA auto_vacuum").get()).toEqual({ auto_vacuum: 1 });
  expect(db.query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "delete" });
 } finally { db.close(); }
 const clock = mock.method(Date, "now", () => r.expiresAt + 1);
 try { store.begin("new"); } finally { clock.mock.restore(); }
 expect(statSync(path).size).toBeLessThan(before);
 expect(readdirSync(store.directory)).toEqual(["checkpoints.sqlite"]);
 if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600);
});

test("read-only missing storage creates nothing", () => {
 const home = root(); const store = new CompactionCheckpointStore(join(home, "absent"));
 expect(store.listDiagnostics()).toEqual([]);
 expect(store.readDiagnostic({ id: "missing", binding: "0".repeat(64) })).toBeUndefined();
 expect(store.readSummary({ id: "missing", binding: "0".repeat(64) })).toBeUndefined();
 expect(readdirSync(home)).toEqual([]);
});

test("SIGKILL mid-SQLite transaction rolls back; repeated same-binding operation is not blocked", async () => {
 const store = new CompactionCheckpointStore(join(root(), "records")); const record = store.begin("same");
 const path = join(store.directory, "checkpoints.sqlite");
 const child = Bun.spawn([process.execPath, "--eval", `
  import { Database } from "bun:sqlite";
  const db = new Database(${JSON.stringify(path)});
  db.exec("PRAGMA cache_size=1; BEGIN IMMEDIATE");
  db.query("UPDATE checkpoints SET outcome='accepted',summary=? WHERE id=?").run("x".repeat(128*1024), ${JSON.stringify(record.id)});
  console.log("MID_WRITE"); setInterval(() => {}, 1000);
 `], { stdout: "pipe", stderr: "pipe" });
 try {
  expect(new TextDecoder().decode((await child.stdout.getReader().read()).value)).toContain("MID_WRITE");
  child.kill("SIGKILL"); await child.exited;
  // A write-open lets SQLite recover a hot rollback journal; a read-only CLI never repairs it.
  const next = store.begin("same");
  expect(next.binding).toBe(record.binding); expect(next.id).not.toBe(record.id);
  expect(store.readDiagnostic(record)?.outcome).toBe("intent"); expect(store.readSummary(record)).toBeUndefined();
  store.finish(next, "accepted", "recovered normally"); expect(store.readSummary(next)).toBe("recovered normally");
 } finally { child.kill(); await child.exited; }
});

test("concurrent processes preserve distinct operations with the same binding", async () => {
 const directory = join(root(), "records");
 const modulePath = new URL("../src/adapters/chatgpt-web/compaction-checkpoint-store.ts", import.meta.url).pathname;
 const children = Array.from({ length: 6 }, () => Bun.spawn([process.execPath, "--eval", `
  import { CompactionCheckpointStore } from ${JSON.stringify(modulePath)};
  const store = new CompactionCheckpointStore(${JSON.stringify(directory)});
  for (let i=0;i<8;i++) { const r=store.begin("same"); store.finish(r,"accepted","child summary"); }
 `], { stdout: "pipe", stderr: "pipe" }));
 const results = await Promise.all(children.map(async child => ({ code: await child.exited, error: await new Response(child.stderr).text() })));
 expect(results).toEqual(results.map(() => ({ code: 0, error: "" })));
 const store = new CompactionCheckpointStore(directory); const rows = store.listDiagnostics();
 expect(rows).toHaveLength(48); expect(new Set(rows.map(r => r.id)).size).toBe(48);
 expect(rows.every(r => r.outcome === "accepted" && store.readSummary(r) === "child summary")).toBe(true);
});

test("failed and cancelled sends remain uncertain and never retry", async () => {
 for (const cancelled of [false, true]) await atHome(async store => {
  let calls = 0; const abort = new AbortController(); const b = broker();
  b.waitForCompactionHandoff = () => new Promise(() => {});
  await expect(requestRetainedCompactionHandoff({ run() {
   calls++; if (cancelled) abort.abort(new Error("cancelled")); return Promise.reject(new Error("uncertain"));
  } } as any, parsed, source, b, {} as any, "trace", abort.signal)).rejects.toThrow();
  expect(calls).toBe(1); const [r] = store.listDiagnostics();
  expect(r.outcome).toBe(cancelled ? "interrupted" : "ambiguous"); expect(store.readSummary(r)).toBeUndefined();
 });
});

test("real SQLite acceptance write failure preserves shared successful run on reconnect", async () => {
 await atHome(async store => {
  let calls = 0; const warnings: unknown[][] = [];
  const warn = mock.method(console, "warn", (...args: unknown[]) => { warnings.push(args); });
  const start = () => requestRetainedCompactionHandoff({ run() {
   calls++;
   const db = new Database(join(store.directory, "checkpoints.sqlite"));
   try { db.exec("CREATE TRIGGER deny_accept BEFORE UPDATE ON checkpoints BEGIN SELECT RAISE(ABORT, 'disk unavailable'); END"); }
   finally { db.close(); }
   return Promise.resolve("");
  } } as any, parsed, source, broker(), {} as any, "trace");
  const key = crypto.randomUUID(); const owner = { ownerKey: key, traceIds: [key] };
  try {
   expect(await runStructuredCompactionOnce(key, owner, start)).toBe("secret-summary");
   await Promise.resolve();
   expect(await runStructuredCompactionOnce(key, owner, start)).toBe("secret-summary");
   expect(calls).toBe(1); expect(warnings).toHaveLength(1);
   expect(store.listDiagnostics()[0].outcome).toBe("intent");
  } finally { warn.mock.restore(); }
 });
});

test("pre-send database failure and full store invoke zero workers", async () => {
 for (const failure of ["corrupt", "full"]) await atHome(async store => {
  if (failure === "corrupt") { mkdirSync(store.directory, { mode: 0o700 }); writeFileSync(join(store.directory, "checkpoints.sqlite"), "corrupt"); }
  else for (let i=0;i<256;i++) store.begin(i);
  let calls = 0;
  await expect(requestRetainedCompactionHandoff({ run() { calls++; return Promise.resolve(""); } } as any, parsed, source, broker(), {} as any, "trace")).rejects.toThrow();
  expect(calls).toBe(0);
 });
});

test("pre-cancelled operation creates no storage or worker", async () => {
 await atHome(async store => {
  const abort = new AbortController(); abort.abort(); let calls = 0;
  await expect(requestRetainedCompactionHandoff({ run() { calls++; return Promise.resolve(""); } } as any, parsed, source, broker(), {} as any, "trace", abort.signal)).rejects.toThrow();
  expect(calls).toBe(0); expect(store.listDiagnostics()).toEqual([]);
 });
});

test("exact binding fences separate owner and context revisions, late writes cannot overwrite final records", () => {
 const store = new CompactionCheckpointStore(join(root(), "records"));
 const first = store.begin({ owner: "one", context: "first" });
 const owner = store.begin({ owner: "two", context: "first" });
 const revision = store.begin({ owner: "one", context: "second" });
 expect(new Set([first.binding, owner.binding, revision.binding]).size).toBe(3);
 store.finish(first, "accepted", "first summary"); store.finish(first, "interrupted");
 expect(store.readSummary(first)).toBe("first summary"); expect(store.readDiagnostic(revision)?.outcome).toBe("intent");
 store.finish({ ...revision, binding: first.binding }, "accepted", "wrong");
 expect(store.readSummary(revision)).toBeUndefined();
});

test("malformed metadata is never exposed and oversized stored summaries are rejected", () => {
 const store = new CompactionCheckpointStore(join(root(), "records")); const r = store.begin("same");
 store.finish(r, "accepted", "summary"); const db = new Database(join(store.directory, "checkpoints.sqlite"));
 try {
  db.exec("UPDATE checkpoints SET version=2");
  expect(store.listDiagnostics()).toEqual([]); expect(store.readSummary(r)).toBeUndefined();
  db.exec("UPDATE checkpoints SET version=1");
  db.query("UPDATE checkpoints SET summary=?").run("x".repeat(131073));
  expect(store.readSummary(r)).toBeUndefined();
 } finally { db.close(); }
});

test("unsafe directories and dangling database symlinks fail closed", () => {
 for (const kind of ["public", "symlink", "file", "database-link"]) {
  if (process.platform === "win32" && (kind === "public" || kind.includes("link"))) continue;
  const directory = join(root(), "records"); const store = new CompactionCheckpointStore(directory);
  if (kind === "public") { mkdirSync(directory); chmodSync(directory, 0o755); }
  if (kind === "symlink") symlinkSync(root(), directory);
  if (kind === "file") writeFileSync(directory, "file");
  if (kind === "database-link") { mkdirSync(directory, { mode: 0o700 }); symlinkSync(join(root(), "missing"), join(directory, "checkpoints.sqlite")); }
  expect(() => store.begin("same")).toThrow();
 }
});

test("SIGKILL after actual retained send leaves intent and never reconstructs broker control", async () => {
 const home = root();
 const modulePath = new URL("../src/adapters/chatgpt-web/compaction-handoff.ts", import.meta.url).pathname;
 const child = Bun.spawn([process.execPath, "--eval", `
  import { requestRetainedCompactionHandoff } from ${JSON.stringify(modulePath)};
  const worker = { run() { console.log("INTENT_DURABLE"); return new Promise(() => {}); } };
  const source = { conversationKey: () => "private", ownerKey: "owner" };
  const broker = { beginCompactionTransaction: async () => ({ token: "control_secret", handoffId: "handoff_secret" }), waitForCompactionHandoff: () => new Promise(() => {}), abortCompactionTransaction() {} };
  setInterval(() => {}, 1000);
  await requestRetainedCompactionHandoff(worker, ${JSON.stringify(parsed)}, source, broker, {}, "trace");
 `], { env: { ...process.env, CODEX_CHATGPT_WEB_HOME: home }, stdout: "pipe", stderr: "pipe" });
 try {
  expect(new TextDecoder().decode((await child.stdout.getReader().read()).value)).toContain("INTENT_DURABLE");
  child.kill("SIGKILL"); await child.exited;
  const store = new CompactionCheckpointStore(join(home, "compaction-checkpoints"));
  const [r] = store.listDiagnostics(); expect(r.outcome).toBe("intent");
  expect(store.readSummary(r)).toBeUndefined(); expect(JSON.stringify(r)).not.toContain("secret");
 } finally { child.kill(); await child.exited; }
});

async function atHome(fn: (store: CompactionCheckpointStore) => Promise<void>) {
 const old = process.env.CODEX_CHATGPT_WEB_HOME; const home = root(); process.env.CODEX_CHATGPT_WEB_HOME = home;
 try { await fn(new CompactionCheckpointStore(join(home, "compaction-checkpoints"))); }
 finally { if (old === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME; else process.env.CODEX_CHATGPT_WEB_HOME = old; }
}
test("retained handoff persists intent before one send and accepted summary only for explicit exact read", async () => {
 await atHome(async store => {
  let calls = 0;
  const worker: any = { run() { calls++; expect(store.listDiagnostics()[0].outcome).toBe("intent"); return Promise.resolve(""); } };
  expect(await requestRetainedCompactionHandoff(worker, parsed, source, broker(), {} as any, "trace")).toBe("secret-summary");
  expect(calls).toBe(1);
  const [record] = store.listDiagnostics();
  expect(record.outcome).toBe("accepted");
  expect(store.readDiagnostic(record)).toEqual(record);
  expect(store.readSummary(record)).toBe("secret-summary");
  expect(JSON.stringify(store.listDiagnostics())).not.toContain("secret");
  expect(store.readSummary({ ...record, binding: "0".repeat(64) })).toBeUndefined();
  expect(store.readSummary({ ...record, id: "00000000-0000-4000-8000-000000000000" })).toBeUndefined();
 });
});
