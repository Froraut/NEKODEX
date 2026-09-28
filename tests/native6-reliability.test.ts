import { afterEach, expect, setSystemTime, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, rmSync } from "node:fs";
import { createConnection } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defaultBrokerEndpoint } from "../src/config";
import { callTurnBroker, isBrokerPromotedInvocation, TurnBroker } from "../src/adapters/chatgpt-web/turn-broker";
import { opaqueId } from "../src/adapters/chatgpt-web/turn-broker-protocol";
import { ChatGptExternalTurnProgress } from "../src/adapters/chatgpt-web/turn-progress";
import { brokerToolResult } from "../src/adapters/chatgpt-web/broker-tool-result";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  setSystemTime();
  while (cleanups.length) await cleanups.pop()!();
});

function environment(root: string) {
  return {
    cwd: root, roots: [root], writableRoots: [root],
    sandboxPolicy: { type: "dangerFullAccess" as const },
    tools: [{ name: "fixture_tool", description: "Synthetic tool", parameters: { type: "object" } }],
  };
}

function fixture() {
  const root = mkdtempSync(join(process.platform === "win32" ? tmpdir() : "/tmp", "n6r-"));
  const socket = defaultBrokerEndpoint(root);
  const broker = TurnBroker.forSocket(socket);
  cleanups.push(async () => { await broker.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, socket, broker, env: environment(root) };
}

async function claim(socket: string, token: string) {
  const activityId = opaqueId("activity");
  const claimed = await callTurnBroker<{ bindingId: string }>(socket, { method: "claim", token, contract: "native", activityId });
  return { bindingId: claimed.bindingId, activityId };
}

test("a dispatched sync call is promoted at its soft deadline and keeps its late result", async () => {
  const f = fixture();
  const token = await f.broker.register(f.env);
  const { bindingId, activityId } = await claim(f.socket, token);
  const started = Date.now();
  const pending = callTurnBroker<unknown>(f.socket, {
    method: "invoke", bindingId, wireName: "fixture_tool", freeform: false, arguments: { a: 1 }, softDeadlineMs: 1_000,
  }, 10_000);
  const [request] = await f.broker.nextToolBatch(token);
  const response = await pending;
  expect(Date.now() - started).toBeGreaterThanOrEqual(950);
  expect(isBrokerPromotedInvocation(response)).toBe(true);
  const promoted = (response as { promoted: { operationId: string; reason: string; dispatched: boolean } }).promoted;
  expect(promoted).toMatchObject({ reason: "deadline", dispatched: true });
  expect(promoted.operationId).toMatch(/^operation_[A-Za-z0-9_-]{32,128}$/);
  const status = await callTurnBroker<{ operations: Array<{ operation_id: string; state: string }> }>(
    f.socket, { method: "operation_status", token });
  expect(status.operations).toEqual([{ operation_id: promoted.operationId, state: "running", acknowledgement_required: false }]);
  f.broker.completeTool(token, request!.callId, { content: [{ type: "text", text: "late result" }] });
  const polled = await callTurnBroker<{ state: string; deliveryId: string; result: { content: Array<{ text: string }> } }>(
    f.socket, { method: "operation_poll", token, operationId: promoted.operationId, waitMs: 1_000 }, 5_000);
  expect(polled.state).toBe("completed");
  expect(polled.result.content[0]!.text).toBe("late result");
  await callTurnBroker(f.socket, { method: "activity_complete", token, activityId });
  expect(f.broker.beginCompletionFence(token)).toMatchObject({ blockedReason: "unacknowledged_async_result" });
  const acked = await callTurnBroker<{ state: string }>(f.socket, {
    method: "operation_poll", token, operationId: promoted.operationId, deliveryId: polled.deliveryId, waitMs: 0,
  });
  expect(acked.state).toBe("acknowledged");
  expect(f.broker.beginCompletionFence(token)).toHaveProperty("revision");
}, 15_000);

test("a sync call that settles before its soft deadline answers directly without an owned operation", async () => {
  const f = fixture();
  const token = await f.broker.register(f.env);
  const { bindingId } = await claim(f.socket, token);
  const pending = callTurnBroker<unknown>(f.socket, {
    method: "invoke", bindingId, wireName: "fixture_tool", freeform: false, arguments: {}, softDeadlineMs: 5_000,
  }, 10_000);
  const [request] = await f.broker.nextToolBatch(token);
  f.broker.completeTool(token, request!.callId, { content: [{ type: "text", text: "fast" }] });
  expect(await pending).toEqual({ content: [{ type: "text", text: "fast" }] });
  const status = await callTurnBroker<{ operations: unknown[] }>(f.socket, { method: "operation_status", token });
  expect(status.operations).toEqual([]);
});

test("a disconnected sync request is promoted instead of losing its native result", async () => {
  const f = fixture();
  const token = await f.broker.register(f.env);
  const { bindingId } = await claim(f.socket, token);
  const raw = createConnection(f.socket);
  await new Promise<void>(resolve => raw.once("connect", () => resolve()));
  raw.write(`${JSON.stringify({ id: "raw_request", method: "invoke", bindingId, wireName: "fixture_tool", freeform: false,
    arguments: {}, softDeadlineMs: 60_000 })}\n`);
  await new Promise(resolve => setTimeout(resolve, 100));
  raw.destroy();
  await new Promise(resolve => setTimeout(resolve, 100));
  const status = await callTurnBroker<{ operations: Array<{ operation_id: string; state: string }> }>(
    f.socket, { method: "operation_status", token });
  expect(status.operations).toHaveLength(1);
  expect(status.operations[0]!.state).toBe("running");
  const [request] = await f.broker.nextToolBatch(token);
  f.broker.completeTool(token, request!.callId, { content: [{ type: "text", text: "kept" }] });
  const polled = await callTurnBroker<{ state: string; result: { content: Array<{ text: string }> } }>(f.socket, {
    method: "operation_poll", token, operationId: status.operations[0]!.operation_id, waitMs: 1_000 }, 5_000);
  expect(polled.state).toBe("completed");
  expect(polled.result.content[0]!.text).toBe("kept");
});

test("an old-style sync invoke without a soft deadline still waits for its result", async () => {
  const f = fixture();
  const token = await f.broker.register(f.env);
  const { bindingId } = await claim(f.socket, token);
  const pending = callTurnBroker<unknown>(f.socket, {
    method: "invoke", bindingId, wireName: "fixture_tool", freeform: false, arguments: {},
  }, 10_000);
  const [request] = await f.broker.nextToolBatch(token);
  await new Promise(resolve => setTimeout(resolve, 300));
  f.broker.completeTool(token, request!.callId, { content: [{ type: "text", text: "legacy" }] });
  expect(await pending).toEqual({ content: [{ type: "text", text: "legacy" }] });
});

test("compaction cancels queued owned operations instead of completing them with control text", async () => {
  const f = fixture();
  const token = await f.broker.register(f.env);
  const { bindingId, activityId } = await claim(f.socket, token);
  const operationId = opaqueId("operation").replace(/^operation_/, "operation_x");
  const started = await callTurnBroker<{ state: string }>(f.socket, {
    method: "invoke_async", bindingId, operationId, wireName: "fixture_tool", freeform: false, arguments: {},
  });
  expect(started.state).toBe("running");
  const syncPending = callTurnBroker<unknown>(f.socket, {
    method: "invoke", bindingId, wireName: "fixture_tool", freeform: false, arguments: { sync: true },
  }, 10_000);
  await new Promise(resolve => setTimeout(resolve, 50));
  const control = { content: [{ type: "text", text: "compaction control" }] };
  expect(f.broker.requestCompaction(token, control)).toBe(1);
  expect(await syncPending).toEqual(control);
  expect(f.broker.compactionDeliveryCount(token)).toBe(1);
  const polled = await callTurnBroker<{ state: string; error: string; cancellationScope: string }>(f.socket, {
    method: "operation_poll", token, operationId, waitMs: 0 });
  expect(polled).toMatchObject({ state: "cancelled", cancellationScope: "queued" });
  expect(polled.error).toContain("compaction");
  await callTurnBroker(f.socket, { method: "activity_complete", token, activityId });
  const now = Date.now();
  expect(f.broker.beginCompletionFence(token)).toMatchObject({ blockedReason: "unacknowledged_async_result" });
  setSystemTime(new Date(now + 6_000));
  expect(f.broker.beginCompletionFence(token)).toHaveProperty("revision");
  const fence = f.broker.beginCompletionFence(token) as { revision: number };
  expect(f.broker.commitCompletionFence(token, fence.revision)).toBe(true);
});

test("the completion fence auto-acknowledges unconsumed results after the settle window", async () => {
  const f = fixture();
  const token = await f.broker.register(f.env);
  const { bindingId, activityId } = await claim(f.socket, token);
  const operationId = "operation_" + "a".repeat(40);
  await callTurnBroker(f.socket, {
    method: "invoke_async", bindingId, operationId, wireName: "fixture_tool", freeform: false, arguments: {},
  });
  const [request] = await f.broker.nextToolBatch(token);
  f.broker.completeTool(token, request!.callId, { content: [{ type: "text", text: "never polled" }] });
  await callTurnBroker(f.socket, { method: "activity_complete", token, activityId });
  const now = Date.now();
  expect(f.broker.beginCompletionFence(token)).toMatchObject({ blockedReason: "unacknowledged_async_result", blockedCount: 1 });
  setSystemTime(new Date(now + 3_000));
  expect(f.broker.beginCompletionFence(token)).toMatchObject({ blockedReason: "unacknowledged_async_result" });
  setSystemTime(new Date(now + 5_500));
  const fence = f.broker.beginCompletionFence(token) as { revision: number };
  expect(fence).toHaveProperty("revision");
  expect(f.broker.commitCompletionFence(token, fence.revision)).toBe(true);
});

test("a stale MCP lease expires instead of blocking completion forever", async () => {
  const f = fixture();
  const token = await f.broker.register(f.env);
  await claim(f.socket, token); // the MCP process "dies" and never completes this activity
  const now = Date.now();
  expect(f.broker.beginCompletionFence(token)).toMatchObject({ blockedReason: "active_work" });
  setSystemTime(new Date(now + 2 * 60_000));
  expect(f.broker.beginCompletionFence(token)).toMatchObject({ blockedReason: "active_work" });
  setSystemTime(new Date(now + 3 * 60_000 + 1_000));
  const fence = f.broker.beginCompletionFence(token) as { revision: number };
  expect(fence).toHaveProperty("revision");
  expect(f.broker.commitCompletionFence(token, fence.revision)).toBe(true);
});

test("old completed-activity tombstones are reclaimed instead of retiring a long turn", async () => {
  const f = fixture();
  const token = await f.broker.register(f.env);
  const channel = (f.broker as unknown as { channels: Map<string, { completedActivities: Map<string, number> }> })
    .channels.get(token)!;
  const old = Date.now() - 11 * 60_000;
  for (let index = 0; index < 4_095; index += 1) channel.completedActivities.set(`activity_old${index}`.padEnd(30, "x"), old);
  const { activityId } = await claim(f.socket, token);
  const completed = await callTurnBroker<{ completed: boolean; retired?: boolean }>(
    f.socket, { method: "activity_complete", token, activityId });
  expect(completed).toEqual({ completed: true });
  expect(channel.completedActivities.size).toBe(1);
  await claim(f.socket, token); // still usable
});

test("retired turns report why they stopped", async () => {
  const f = fixture();
  const token = await f.broker.register(f.env, undefined, "trace_reason");
  const { bindingId } = await claim(f.socket, token);
  await callTurnBroker(f.socket, { method: "release", bindingId });
  await expect(claim(f.socket, token)).rejects.toThrow(
    /Codex turn trace_reason, which was stopped \(its MCP request abandoned a pending Codex Native call\)/);
});

test("async capacity rejects the call without retiring the turn", async () => {
  const f = fixture();
  const token = await f.broker.register(f.env);
  const { bindingId } = await claim(f.socket, token);
  for (let index = 0; index < 64; index += 1) {
    void callTurnBroker(f.socket, {
      method: "invoke", bindingId, wireName: "fixture_tool", freeform: false, arguments: { index }, softDeadlineMs: 60_000,
    }, 70_000).catch(() => {});
  }
  await new Promise(resolve => setTimeout(resolve, 200));
  await expect(callTurnBroker(f.socket, {
    method: "invoke_async", bindingId, operationId: "operation_" + "b".repeat(40), wireName: "fixture_tool",
    freeform: false, arguments: {},
  })).rejects.toThrow(/pending native tool calls/);
  await expect(callTurnBroker(f.socket, {
    method: "invoke", bindingId, wireName: "fixture_tool", freeform: false, arguments: { extra: true }, softDeadlineMs: 5_000,
  })).rejects.toThrow(/pending native tool calls/);
  await claim(f.socket, token); // the turn is still live
});

test("redelivered tool batches are counted once", () => {
  const progress = new ChatGptExternalTurnProgress();
  const first = progress.recordToolBatch(["call_a", "call_b"]);
  expect(progress.snapshot().activeToolCalls).toBe(2);
  expect(progress.recordToolBatch(["call_a", "call_b"])).toBe(first);
  expect(progress.snapshot().activeToolCalls).toBe(2);
  progress.recordToolResult("call_a");
  progress.recordToolResult("call_b");
  expect(progress.snapshot().activeToolCalls).toBe(0);
  expect(() => progress.recordToolResult("call_a")).toThrow(/without an active call/);
});

test("JSON arrays never become structuredContent", () => {
  expect(brokerToolResult({ role: "toolResult", toolCallId: "c", content: "[1,2,3]" } as never))
    .toEqual({ content: [{ type: "text", text: "[1,2,3]" }] });
  expect(brokerToolResult({ role: "toolResult", toolCallId: "c", content: "{\"ok\":true}" } as never))
    .toEqual({ content: [{ type: "text", text: "{\"ok\":true}" }], structuredContent: { ok: true } });
});

async function mcpClient(socket: string, flags: string[]) {
  const client = new Client({ name: "native6-reliability", version: "1" });
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: ["src/cli.ts", "mcp", "--broker-socket", socket, ...flags],
    cwd: process.cwd(), stderr: "pipe",
  }));
  cleanups.push(() => client.close());
  return client;
}

test("Native6 MCP returns a running handle instead of retiring the turn, then delivers the late result", async () => {
  const f = fixture();
  const client = await mcpClient(f.socket, ["--async-tool-operations", "--native6"]);
  const token = await f.broker.register(f.env, 15_000, "trace_mcp");
  const started = Date.now();
  const callPromise = client.callTool({ name: "codex_tool_call", arguments: { turn_token: token, wire_name: "fixture_tool", arguments: {} } });
  const [request] = await f.broker.nextToolBatch(token);
  const running = await callPromise;
  const elapsed = Date.now() - started;
  expect(elapsed).toBeGreaterThan(8_000);
  expect(elapsed).toBeLessThan(11_500);
  expect(running.isError).toBeFalsy();
  const handle = running.structuredContent as { state: string; operation_id: string; tool: string; dispatched: boolean };
  expect(handle).toMatchObject({ state: "running", tool: "fixture_tool", dispatched: true });
  f.broker.completeTool(token, request!.callId, { content: [{ type: "text", text: "approved later" }] });
  const polled = await client.callTool({ name: "codex_tool_poll", arguments: { turn_token: token, operation_id: handle.operation_id, wait_ms: 0 } });
  expect(JSON.stringify(polled.content)).toContain("approved later");
  const delivery = (polled.structuredContent as { delivery_id: string }).delivery_id;
  const acked = await client.callTool({ name: "codex_tool_poll", arguments: { turn_token: token, operation_id: handle.operation_id, wait_ms: 0, ack_delivery_id: delivery } });
  expect(acked.structuredContent).toMatchObject({ state: "acknowledged" });
}, 20_000);

test("Native4 keeps the legacy retirement on the MCP deadline", async () => {
  const f = fixture();
  const client = await mcpClient(f.socket, ["--synchronous-tool-operations"]);
  const token = await f.broker.register(f.env, 4_000, "trace_legacy");
  const callPromise = client.callTool({ name: "codex_tool_call", arguments: { turn_token: token, wire_name: "fixture_tool", arguments: {} } });
  await f.broker.nextToolBatch(token);
  const timedOut = await callPromise;
  expect(timedOut.isError).toBe(true);
  expect(JSON.stringify(timedOut.structuredContent)).toContain("codex_tool_timeout");
}, 15_000);

test("reusing an acknowledged operation_key says it did not run again", async () => {
  const f = fixture();
  const client = await mcpClient(f.socket, ["--async-tool-operations", "--native6"]);
  const token = await f.broker.register(f.env);
  const start = () => client.callTool({ name: "codex_tool_start", arguments: {
    turn_token: token, operation_key: "rerun-tests-key-0001", wire_name: "fixture_tool", arguments: {} } });
  const first = await start();
  const id = (first.structuredContent as { operation_id: string }).operation_id;
  const [request] = await f.broker.nextToolBatch(token);
  f.broker.completeTool(token, request!.callId, { content: [{ type: "text", text: "done" }] });
  const polled = await client.callTool({ name: "codex_tool_poll", arguments: { turn_token: token, operation_id: id, wait_ms: 0 } });
  const delivery = (polled.structuredContent as { delivery_id: string }).delivery_id;
  await client.callTool({ name: "codex_tool_poll", arguments: { turn_token: token, operation_id: id, wait_ms: 0, ack_delivery_id: delivery } });
  const again = await start();
  expect(again.structuredContent).toMatchObject({ state: "acknowledged" });
  expect(String((again.structuredContent as { message: string }).message)).toContain("use a new operation_key");
}, 15_000);
