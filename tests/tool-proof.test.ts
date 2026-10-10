import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertChatGptTurnProgressSnapshot, ChatGptExternalTurnProgress, ChatGptMirroredTurnProgress,
} from "../src/adapters/chatgpt-web/turn-progress";

const require = createRequire(import.meta.url);
const { AccountToolProof } = require("../launcher/electron/account-tool-proof.cjs");
const { BrowserControlServer } = require("../launcher/electron/control-server.cjs");

const principal = "a".repeat(64);

test("only a tool result returned without an error becomes the turn's tool proof", () => {
  const progress = new ChatGptExternalTurnProgress();
  progress.recordToolBatch(["call_a", "call_b"]);
  progress.recordToolResult("call_a", 1_000);
  expect(progress.snapshot().lastCompletedTool).toBeUndefined();
  progress.recordToolResult("call_b", 2_000, "codex_exec");
  expect(progress.snapshot()).toMatchObject({ completedToolResults: 1, lastCompletedTool: "codex_exec" });
  progress.recordToolBatch(["call_c"]);
  progress.recordToolResult("call_c", 3_000, "bad name with spaces");
  expect(progress.snapshot()).toMatchObject({ completedToolResults: 1, lastCompletedTool: "codex_exec" });
  // The helper mirror carries the proof unchanged.
  const mirror = new ChatGptMirroredTurnProgress();
  expect(mirror.apply(progress.snapshot())).toBe(true);
  expect(mirror.snapshot().lastCompletedTool).toBe("codex_exec");
});

test("a malformed proof in a progress frame is rejected", () => {
  const base = { revision: 2, lastToolBatchRevision: 1, activeToolCalls: 0, lastProgressAt: 1 };
  expect(() => assertChatGptTurnProgressSnapshot({ ...base, completedToolResults: 1, lastCompletedTool: "codex_exec" })).not.toThrow();
  expect(() => assertChatGptTurnProgressSnapshot({ ...base, completedToolResults: 1 })).toThrow();
  expect(() => assertChatGptTurnProgressSnapshot({ ...base, lastCompletedTool: "codex_exec" })).toThrow();
  expect(() => assertChatGptTurnProgressSnapshot({ ...base, completedToolResults: 0, lastCompletedTool: "codex_exec" })).toThrow();
  expect(() => assertChatGptTurnProgressSnapshot({ ...base, completedToolResults: 1, lastCompletedTool: "<script>" })).toThrow();
});

test("the account proof persists, belongs to its sign-in and survives a corrupt entry", () => {
  const dir = mkdtempSync(join(tmpdir(), "nekodex-tool-proof-"));
  try {
    let now = 1_760_000_000_000;
    const store = new AccountToolProof(dir, () => now);
    expect(store.snapshot("default", principal)).toBeNull();
    store.record("default", "codex_exec", principal);
    expect(store.snapshot("default", principal)).toEqual({ at: now, tool: "codex_exec" });
    // A different or unknown ChatGPT sign-in does not inherit the proof.
    expect(store.snapshot("default", "b".repeat(64))).toBeNull();
    expect(store.snapshot("default", null)).toBeNull();
    now += 1;
    const reloaded = new AccountToolProof(dir, () => now);
    expect(reloaded.snapshot("default", principal)).toEqual({ at: now - 1, tool: "codex_exec" });
    const saved = JSON.parse(readFileSync(join(dir, "account-tool-proof.json"), "utf8"));
    expect(Object.keys(saved.accounts.default).sort()).toEqual(["at", "principalFingerprint", "tool"]);
    expect(() => reloaded.record("default", "rm -rf /", principal)).toThrow("Invalid tool proof name");
    reloaded.forget("default");
    expect(new AccountToolProof(dir).snapshot("default", principal)).toBeNull();
    writeFileSync(join(dir, "account-tool-proof.json"), JSON.stringify({ version: 1, accounts: {
      default: { at: 5, tool: "codex_exec", extra: true } } }));
    expect(new AccountToolProof(dir).snapshot("default", null)).toBeNull();
    writeFileSync(join(dir, "account-tool-proof.json"), "{");
    expect(new AccountToolProof(dir).snapshot("default", null)).toBeNull();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the control server forwards a valid tool proof with a completed turn and rejects a malformed one", async () => {
  const ended: unknown[][] = [];
  const host = { browserInteractionMode: () => "automatic", async endTurn(...args: unknown[]) { ended.push(args); return {}; } };
  const logger = { info() {}, warn() {}, error() {}, debug() {} };
  const server = new BrowserControlServer({ logger, getBrowserHost: () => host, getPreferences: () => ({}), resolveNativeProxy: () => null });
  await server.start();
  try {
    const { endpoint, token } = server.descriptor();
    const end = (body: Record<string, unknown>) => fetch(`${endpoint}/v1/turn/end`, { method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ phase: "end", traceId: "trace_proof01", helperPid: process.pid, ...body }) });
    expect((await end({ status: "completed", connectorBound: true, toolProof: { tool: "codex_exec" } })).status).toBe(200);
    expect(ended.at(-1)?.[8]).toEqual({ tool: "codex_exec" });
    expect((await end({ status: "failed", toolProof: { tool: "codex_exec" } })).status).toBe(200);
    expect(ended.at(-1)?.[8]).toBeUndefined();
    const count = ended.length;
    expect((await end({ status: "completed", toolProof: { tool: "codex_exec", output: "secret" } })).status).not.toBe(200);
    expect((await end({ status: "completed", toolProof: { tool: "x y" } })).status).not.toBe(200);
    expect(ended.length).toBe(count);
  } finally { await server.close(); }
});
