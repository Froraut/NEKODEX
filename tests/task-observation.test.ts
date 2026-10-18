import { requestRetainedCompactionHandoff } from "../src/adapters/chatgpt-web/compaction-handoff";
import { CompactionCheckpointStore } from "../src/adapters/chatgpt-web/compaction-checkpoint-store";
import { TurnBroker, callTurnBroker } from "../src/adapters/chatgpt-web/turn-broker";
import { ChatGptTurnSession } from "../src/adapters/chatgpt-web/turn-session";
import { ChatGptTextFeed, ChatGptTraceFeed } from "../src/adapters/chatgpt-web/turn-feeds";
import type { BrowserTurn, ChatGptBrowserWorker } from "../src/adapters/chatgpt-web/browser-worker";
import { Database } from "bun:sqlite";
import { verifyCurrentCodexObservationIdentity } from "../src/adapters/chatgpt-web/codex-rollout-environment";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { CodexParsedRequest } from "../src/types";
import { boundTaskObservation, taskObservationForRequest, taskObservationWithProgress } from "../src/adapters/chatgpt-web/task-observation";
import { ChatGptExternalTurnProgress, ChatGptMirroredTurnProgress } from "../src/adapters/chatgpt-web/turn-progress";
const require = createRequire(import.meta.url);
const { BrowserTaskLedger } = require("../launcher/electron/browser-task-ledger.cjs");
const { BrowserTurnLifecycle } = require("../launcher/electron/browser-turn-lifecycle.cjs");
const { BrowserControlServer } = require("../launcher/electron/control-server.cjs");
const { notifyLauncherTurn } = await import("../src/launcher-browser-control");
const { LAUNCHER_BROWSER_IDLE_URL } = await import("../src/launcher-browser-descriptor");
const { assertTaskObservation } = require("../launcher/electron/task-observation.cjs");
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "nekodex-observation-")); dirs.push(dir);
  const file = join(dir, "tasks.json");
  let now = 100;
  const ledger = new BrowserTaskLedger(file, () => ++now);
  return { file, ledger };
}
function request(): CodexParsedRequest {
  return { modelId: "chatgpt-web/high", stream: true, options: { toolChoice: { name: "mcp__files__read" } },
    _rawBody: { client_metadata: { "x-codex-turn-metadata": { thread_id: "thread_123", turn_id: "turn_123", parent_thread_id: "other_123" } } },
    context: { tools: [{ namespace: "mcp__files", name: "read", description: "PRIVATE_DESCRIPTION", parameters: { secret: "PRIVATE_SCHEMA" } }],
      messages: [{ role: "user", timestamp: 1, origin: "codex_skill", content: "<skill><name>inspect</name><path>/PRIVATE_SKILL_LOCATION</path>PRIVATE_INSTRUCTIONS</skill>" },
        { role: "user", timestamp: 1, content: "PRIVATE_PROMPT" }] } };
}
describe("bounded current-task observations", () => {
  test("native association requires the indexed canonical parent and exact latest native turn", () => {
    const dir = mkdtempSync(join(tmpdir(), "nekodex-native-observation-")); dirs.push(dir);
    mkdirSync(join(dir, "sessions")); writeFileSync(join(dir, "config.toml"), `sqlite_home = ${JSON.stringify(dir)}\n`);
    const threadId = "019c6e27-e55b-73d1-87d8-4e01f1f75043";
    const parentThreadId = "019c7714-3b77-74d1-9866-e1f484aae2ab";
    const turnId = "019c7714-3b77-74d1-9866-e1f484aae2ac";
    const path = join(dir, "sessions", `rollout-2026-10-18T01-00-00-${threadId}.jsonl`);
    writeFileSync(path, [
      { type: "session_meta", payload: { id: threadId, parent_thread_id: parentThreadId, thread_source: "subagent", agent_path: "/root/reader",
        source: { subagent: { thread_spawn: { parent_thread_id: parentThreadId, agent_path: "/root/reader" } } } } },
      { type: "turn_context", payload: { turn_id: turnId } },
    ].map(value => JSON.stringify(value)).join("\n") + "\n");
    const database = new Database(join(dir, "state_5.sqlite"));
    database.exec("CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT, agent_path TEXT); CREATE TABLE thread_spawn_edges (child_thread_id TEXT, parent_thread_id TEXT, status TEXT)");
    database.query("INSERT INTO threads VALUES (?, ?, ?)").run(threadId, path, "/root/reader");
    database.query("INSERT INTO thread_spawn_edges VALUES (?, ?, ?)").run(threadId, parentThreadId, "open"); database.close();
    const owner = { threadId, parentThreadId, agentName: "/root/reader", sandboxType: "readOnly" as const, workspaceRoots: [] };
    expect(verifyCurrentCodexObservationIdentity(dir, owner, turnId)).toBe(true);
    expect(verifyCurrentCodexObservationIdentity(dir, { ...owner, parentThreadId: turnId }, turnId)).toBe(false);
    expect(verifyCurrentCodexObservationIdentity(dir, owner, parentThreadId)).toBe(false);
    const forged = { ...request(), _rawBody: { client_metadata: { "x-codex-turn-metadata": { thread_id: threadId, turn_id: turnId,
      parent_thread_id: parentThreadId, agent_name: "/root/reader", subagent_kind: "thread_spawn", request_kind: "turn", sandbox_mode: "read-only", workspaces: {} } } } };
    expect(taskObservationForRequest(forged, 100).native).toBeUndefined();
    expect(taskObservationForRequest(forged, 100, verifyCurrentCodexObservationIdentity(dir, owner, turnId)).native?.parentThreadId).toBe(parentThreadId);
  });
  test("request projection retains exact inventory and digests without content, syntax-only parent is excluded", () => {
    const observation = taskObservationForRequest(request(), 100, true);
    expect(taskObservationForRequest(request(), 100).native).toBeUndefined();
    expect(observation.native).toEqual({ threadId: "thread_123", turnId: "turn_123", source: "codex-client", state: "request-observed" });
    expect(observation.tools[0]).toMatchObject({ namespace: "mcp__files", name: "read", advertised: true, selected: true, observed: "unobserved" });
    expect(observation.skills[0]?.contentDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(observation.skills[0]?.sourceDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(observation)).not.toContain("PRIVATE_");
    expect(() => assertTaskObservation({ ...observation, prompt: "SECRET" })).toThrow();
    const many = { ...observation, tools: Array.from({ length: 128 }, (_, index) => ({ ...observation.tools[0]!, name: `tool_${index}_${"x".repeat(100)}` })) };
    const bounded = boundTaskObservation(many);
    expect(Buffer.byteLength(JSON.stringify(bounded))).toBeLessThanOrEqual(12_000);
    expect(bounded.toolsTruncated).toBe(true);
    expect(() => assertTaskObservation(bounded)).not.toThrow();
  });
  test("durable milestones and allowed metadata survive restart; old v1 records remain readable", () => {
    const { ledger, file } = fixture();
    const id = ledger.start("trace_123", "tab_123", 1);
    const observation = taskObservationForRequest(request(), 100, true);
    ledger.progress(id, "preparing", 1, observation);
    ledger.progress(id, "sending", 2, observation);
    const restored = new BrowserTaskLedger(file, () => 200);
    expect(restored.storageIssue).toBeNull();
    expect(restored.get(id)).toMatchObject({ phase: "interrupted", submission: "uncertain", observation });
    expect(restored.get(id).delivery.map((row: { phase: string }) => row.phase)).toEqual(["preparing", "sending", "interrupted"]);
    const snapshot = restored.snapshot(); snapshot[0].observation.tools[0].name = "mutated";
    expect(restored.get(id).observation.tools[0].name).toBe("read");
    const saved = JSON.parse(readFileSync(file, "utf8")); delete saved.records[0].observation; delete saved.records[0].delivery;
    writeFileSync(file, JSON.stringify(saved));
    expect(new BrowserTaskLedger(file).storageIssue).toBeNull();
  });
  test("wrong surface and changed native owner cannot attach metadata or erase prior send evidence", () => {
    const { ledger, file } = fixture();
    const id = ledger.start("trace_123", "tab_123", 1);
    const observation = taskObservationForRequest(request(), 100, true);
    const lifecycle = new BrowserTurnLifecycle({ tabs: new Map([["tab_123", { traceId: "trace_123", helperPid: 12, surfaceId: "surface_123", status: "running", taskRecordId: id }]]), context: { ledger }, presentation: { requestStatePublication() {} } });
    expect(() => lifecycle.taskProgress("trace_123", 12, "other_surface", "preparing", 1, observation)).toThrow("live browser owner");
    expect(ledger.get(id).observation).toBeUndefined();
    lifecycle.taskProgress("trace_123", 12, "surface_123", "sending", 1, observation);
    const committed = readFileSync(file, "utf8");
    expect(() => ledger.progress(id, "responding", 2, { ...observation, native: { ...observation.native!, threadId: "other_thread" } })).toThrow("native owner mismatch");
    expect(readFileSync(file, "utf8")).toBe(committed);
    for (let sequence = 2; sequence < 44; sequence++) ledger.progress(id, sequence % 2 ? "waiting-tools" : "responding", sequence, observation);
    expect(ledger.get(id).delivery.some((receipt: { phase: string; submission: string }) => receipt.phase === "sending" && receipt.submission === "uncertain")).toBe(true);
    expect(ledger.get(id).delivery.length).toBeLessThanOrEqual(16);
  });
  test("real control serialization forwards only bounded metadata through the exact live owner", async () => {
    const { ledger } = fixture(); const id = ledger.start("trace_123", "tab_123", 1);
    const surfaceId = "s".repeat(32);
    const lifecycle = new BrowserTurnLifecycle({ tabs: new Map([["tab_123", { traceId: "trace_123", helperPid: process.pid,
      surfaceId, status: "running", taskRecordId: id }]]), context: { ledger }, presentation: { requestStatePublication() {} } });
    const host = { browserInteractionMode: () => "automatic", taskProgress: (...args: unknown[]) => lifecycle.taskProgress(...args) };
    const server = new BrowserControlServer({ logger: { info() {}, warn() {}, error() {}, debug() {} },
      getBrowserHost: () => host, getPreferences: () => ({}), resolveNativeProxy: () => null });
    await server.start();
    try {
      const descriptor = server.descriptor(); const file = join(dirs.at(-1)!, "descriptor.json");
      writeFileSync(file, JSON.stringify({ version: 3, kind: "codex-web-gpt-launcher", profile: "development", pid: process.pid,
        endpoint: descriptor.endpoint, control: descriptor, helper: { executable: process.execPath, script: import.meta.path },
        partition: "persist:codex-web-gpt-dev-chatgpt", idleUrl: LAUNCHER_BROWSER_IDLE_URL, surfaceId,
        surfaceTargets: {}, createdAt: new Date().toISOString() }), { mode: 0o600 });
      const observation = taskObservationForRequest(request(), 100, true);
      await notifyLauncherTurn(file, { phase: "progress", traceId: "trace_123", helperPid: process.pid,
        surfaceId, sequence: 1, taskPhase: "preparing", observation }, 1000);
      expect(ledger.get(id).observation).toEqual(observation);
      const committed = JSON.stringify(ledger.snapshot());
      const send = (value: unknown) => fetch(`${descriptor.endpoint}/v1/turn/progress`, { method: "POST",
        headers: { authorization: `Bearer ${descriptor.token}`, "content-type": "application/json" }, body: JSON.stringify(value) });
      const base = { phase: "progress", traceId: "trace_123", helperPid: process.pid, surfaceId, sequence: 2, taskPhase: "sending" };
      expect((await send({ ...base, surfaceId: "z".repeat(32), observation })).status).not.toBe(200);
      expect((await send({ ...base, observation: { ...observation, toolArguments: "PRIVATE_ARGS" } })).status).not.toBe(200);
      expect(JSON.stringify(ledger.snapshot())).toBe(committed);
    } finally { await server.close(); }
  }, 5000);
  test("actual retained compaction publishes owned source lineage through control and durable task history", async () => {
    const dir = mkdtempSync(join(process.platform === "win32" ? tmpdir() : "/tmp", "nk-lineage-")); dirs.push(dir);
    const oldHome = process.env.CODEX_HOME;
    const oldAppHome = process.env.CODEX_CHATGPT_WEB_HOME;
    process.env.CODEX_HOME = dir; process.env.CODEX_CHATGPT_WEB_HOME = dir;
    const nativeThread = "019c6e27-e55b-73d1-87d8-4e01f1f75043";
    const nativeSourceTurn = "019c7714-3b77-74d1-9866-e1f484aae2ab";
    const nativeCompactionTurn = "019c7714-3b77-74d1-9866-e1f484aae2ac";
    mkdirSync(join(dir, "sessions"));
    writeFileSync(join(dir, "config.toml"), `sqlite_home = ${JSON.stringify(dir)}\n`);
    const rollout = join(dir, "sessions", `rollout-2026-10-18T01-00-00-${nativeThread}.jsonl`);
    writeFileSync(rollout, [
      { type: "session_meta", payload: { id: nativeThread, source: "cli", agent_path: "/root" } },
      { type: "turn_context", payload: { turn_id: nativeCompactionTurn } },
    ].map(value => JSON.stringify(value)).join("\n") + "\n");
    const nativeDb = new Database(join(dir, "state_5.sqlite"));
    nativeDb.exec("CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT, agent_path TEXT); CREATE TABLE thread_spawn_edges (child_thread_id TEXT, parent_thread_id TEXT, status TEXT)");
    nativeDb.query("INSERT INTO threads VALUES (?, ?, ?)").run(nativeThread, rollout, "/root"); nativeDb.close();
    const broker = TurnBroker.forSocket(join(dir, "broker.sock"));
    const traceId = "trace_handoff_123"; const sourceTraceId = "trace_source_123";
    const surfaceId = "h".repeat(32); const journal = join(dir, "tasks.json");
    const ledger = new BrowserTaskLedger(journal); const id = ledger.start(traceId, "tab_handoff_123", 1);
    const lifecycle = new BrowserTurnLifecycle({ tabs: new Map([["tab_handoff_123", { traceId, helperPid: process.pid,
      surfaceId, status: "running", taskRecordId: id }]]), context: { ledger }, presentation: { requestStatePublication() {} } });
    const server = new BrowserControlServer({ logger: { info() {}, warn() {}, error() {}, debug() {} },
      getBrowserHost: () => ({ browserInteractionMode: () => "automatic", taskProgress: (...args: unknown[]) => lifecycle.taskProgress(...args) }),
      getPreferences: () => ({}), resolveNativeProxy: () => null });
    try {
      await server.start(); const control = server.descriptor(); const descriptor = join(dir, "descriptor.json");
      writeFileSync(descriptor, JSON.stringify({ version: 3, kind: "codex-web-gpt-launcher", profile: "development", pid: process.pid,
        endpoint: control.endpoint, control, helper: { executable: process.execPath, script: import.meta.path },
        partition: "persist:codex-web-gpt-dev-chatgpt", idleUrl: LAUNCHER_BROWSER_IDLE_URL, surfaceId,
        surfaceTargets: {}, createdAt: new Date().toISOString() }), { mode: 0o600 });
      const parsed = { ...request(), _compactionRequest: true, _rawBody: { input: [{ type: "message", role: "user", content: "PRIVATE_SOURCE_REQUEST" }],
        client_metadata: { "x-codex-turn-metadata": { thread_id: nativeThread, turn_id: nativeCompactionTurn,
          request_kind: "compaction", sandbox_mode: "read-only", workspaces: {}, agent_name: "/root" } } } };
      const source = new ChatGptTurnSession({ mode: "read-only", browser: Promise.resolve("PRIVATE_SOURCE_ANSWER"),
        physicalSettlement: Promise.resolve(), trace: new ChatGptTraceFeed(), text: new ChatGptTextFeed(),
        conversationKey: "a".repeat(64), cancel() {} }, sourceTraceId, "fixture_native_owner", nativeSourceTurn, nativeThread);
      let runs = 0; let capturedToken = ""; let capturedHandoffId = "";
      const worker = { run: async (turn: BrowserTurn) => {
        runs += 1;
        // The real production handoff constructs this observation; this driver only transports it.
        await notifyLauncherTurn(descriptor, { phase: "progress", traceId: turn.traceId, helperPid: process.pid,
          surfaceId, sequence: 1, taskPhase: "preparing", observation: turn.observation }, 1000);
        const prepared = await turn.prepare();
        capturedToken = /turn_token (control_[a-f0-9]+)/.exec(prepared.text)![1]!;
        capturedHandoffId = /handoff_id (handoff_[a-f0-9]+)/.exec(prepared.text)![1]!;
        const stopped = new Promise<string>(resolve => {
          if (turn.abortSignal?.aborted) resolve("");
          else turn.abortSignal?.addEventListener("abort", () => resolve(""), { once: true });
        });
        await turn.onSendActivated?.();
        await notifyLauncherTurn(descriptor, { phase: "progress", traceId: turn.traceId, helperPid: process.pid,
          surfaceId, sequence: 2, taskPhase: "accepted", observation: turn.observation }, 1000);
        await callTurnBroker(broker.socketPath, { method: "submit_compaction_handoff", token: capturedToken,
          handoffId: capturedHandoffId, summary: "Synthetic accepted checkpoint" });
        return stopped;
      } } as ChatGptBrowserWorker;
      expect(await requestRetainedCompactionHandoff(worker, parsed, source, broker,
        { localToolsEnabled: true, solAvailable: true, proAvailable: true }, traceId, undefined, 3000)).toBe("Synthetic accepted checkpoint");
      expect(runs).toBe(1);
      const checkpoint = new CompactionCheckpointStore().listDiagnostics();
      expect(checkpoint).toHaveLength(1); expect(checkpoint[0]?.outcome).toBe("accepted");
      const observation = ledger.get(id).observation;
      expect(observation.native).toMatchObject({ threadId: nativeThread, turnId: nativeCompactionTurn, source: "codex-client" });
      expect(observation.lineage).toEqual([expect.objectContaining({ kind: "compaction", sourceTraceId, fromId: nativeSourceTurn })]);
      expect(JSON.stringify(observation)).not.toContain("PRIVATE_");
      ledger.end(id, "completed");
      expect(new BrowserTaskLedger(journal).get(id).observation.lineage).toEqual(observation.lineage);
      expect(readFileSync(journal, "utf8")).not.toContain("PRIVATE_");
      await expect(callTurnBroker(broker.socketPath, { method: "submit_compaction_handoff", token: capturedToken,
        handoffId: capturedHandoffId, summary: "Replay must fail" })).rejects.toThrow("invalid, expired, or consumed");
      expect(runs).toBe(1);
    } finally {
      await server.close(); await broker.close();
      if (oldHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = oldHome;
      if (oldAppHome === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME; else process.env.CODEX_CHATGPT_WEB_HOME = oldAppHome;
    }
  }, 5000);
  test("observed success, errors and latency use returned results; retirement and redelivery invent no outcomes", () => {
    const progress = new ChatGptExternalTurnProgress();
    progress.recordToolBatch(["call_a", "call_b", "call_c"], 100);
    progress.recordToolBatch(["call_a"], 150);
    progress.recordToolResult("call_a", 200, "mcp__files__read", "succeeded");
    progress.recordToolResult("call_b", 250, undefined, "error");
    progress.retire(new Error("owner retired"));
    expect(progress.snapshot().toolCounters).toEqual({ total: 3, succeeded: 1, errors: 1, samples: 2, totalLatencyMs: 250, minLatencyMs: 100, maxLatencyMs: 150 });
    const mirror = new ChatGptMirroredTurnProgress(); mirror.apply(JSON.parse(JSON.stringify(progress.snapshot())));
    const observation = taskObservationWithProgress(taskObservationForRequest(request(), 100, true), mirror.snapshot());
    expect(observation?.tools[0]).toMatchObject({ advertised: true, selected: true, observed: "succeeded", observedAt: 200 });
    expect(observation?.toolCounters?.errors).toBe(1);
    const longNameRequest = request(); longNameRequest.context.tools![0]!.namespace = `mcp__${"n".repeat(100)}`;
    const longWire = `${longNameRequest.context.tools![0]!.namespace}__read`;
    const longProgress = new ChatGptExternalTurnProgress(); longProgress.recordToolBatch(["call_long"], 10);
    longProgress.recordToolResult("call_long", 20, longWire, "succeeded");
    expect(longProgress.snapshot().lastCompletedTool).toBeUndefined(); // Preserve the account proof's existing narrow contract.
    expect(taskObservationWithProgress(taskObservationForRequest(longNameRequest, 100, true), longProgress.snapshot())?.tools[0]?.observed).toBe("succeeded");
    const { ledger, file } = fixture(); const id = ledger.start("trace_123", "tab_123", 1);
    ledger.progress(id, "responding", 1, observation); ledger.end(id, "completed");
    expect(new BrowserTaskLedger(file).get(id).observation.toolCounters.samples).toBe(2);
  });
});
