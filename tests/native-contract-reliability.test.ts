import { afterEach, expect, setSystemTime, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defaultBrokerEndpoint } from "../src/config";
import { parseRequest } from "../src/responses/parser";
import { callTurnBroker, isBrokerPromotedInvocation, TurnBroker, type BrokerToolRequest } from "../src/adapters/chatgpt-web/turn-broker";
import { opaqueId } from "../src/adapters/chatgpt-web/turn-broker-protocol";
import { configureTurnBrokerEventLog } from "../src/adapters/chatgpt-web/turn-broker-diagnostics";
import { ChatGptExternalTurnProgress } from "../src/adapters/chatgpt-web/turn-progress";
import { ChatGptTextFeed, ChatGptTraceFeed, ChatGptTurnSessions } from "../src/adapters/chatgpt-web/turn-execution";
import type { ChatGptTurnRuntime } from "../src/adapters/chatgpt-web/turn-feeds";
import { extractToolResultCallIds, rejectUnparseableChatGptToolResults } from "../src/adapters/chatgpt-web/rejected-tool-results";
import { installMcpShutdownHandlers } from "../src/adapters/chatgpt-web/mcp-main";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  setSystemTime();
  configureTurnBrokerEventLog(undefined);
  while (cleanups.length) await cleanups.pop()!();
});

type Channel = {
  activities: Map<string, number>;
  queuedCallIds: string[];
  invocations: Map<string, unknown>;
};

function environment(root: string, extraTools: Array<Record<string, unknown>> = []) {
  return {
    cwd: root, roots: [root], writableRoots: [root],
    sandboxPolicy: { type: "dangerFullAccess" as const },
    tools: [{ name: "fixture_tool", description: "Synthetic tool", parameters: { type: "object" } }, ...extraTools],
  };
}

function fixture() {
  const root = mkdtempSync(join(process.platform === "win32" ? tmpdir() : "/tmp", "ncr-"));
  const socket = defaultBrokerEndpoint(root);
  const broker = TurnBroker.forSocket(socket);
  cleanups.push(async () => { await broker.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, socket, broker, env: environment(root) };
}

function channelOf(broker: TurnBroker, token: string): Channel {
  return (broker as unknown as { channels: Map<string, Channel> }).channels.get(token)!;
}

async function claim(socket: string, token: string, invokeIntent = false) {
  const activityId = opaqueId("activity");
  const claimed = await callTurnBroker<{ bindingId: string }>(socket, {
    method: "claim", token, contract: "native", activityId, ...(invokeIntent ? { invokeIntent } : {}),
  });
  return { bindingId: claimed.bindingId, activityId };
}

async function until(condition: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition was not reached in time");
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

function toolsRuntime(overrides: Partial<Extract<ChatGptTurnRuntime, { mode: "tools" }>> = {}) {
  let settle!: () => void;
  const physicalSettlement = new Promise<void>(resolve => { settle = resolve; });
  const cancelled: Error[] = [];
  const runtime: Extract<ChatGptTurnRuntime, { mode: "tools" }> = {
    mode: "tools",
    token: Promise.resolve("unused"),
    externalProgress: new ChatGptExternalTurnProgress(),
    browser: new Promise<string>(() => {}),
    physicalSettlement,
    trace: new ChatGptTraceFeed(),
    text: new ChatGptTextFeed(),
    cancel: reason => { cancelled.push(reason ?? new Error("cancelled")); settle(); },
    ...overrides,
  };
  return { runtime, cancelled };
}

// --- 1. A rejected follow-up answers its dispatched calls instead of leaving them waiting -----

test("tool result call ids are read leniently without touching outputs", () => {
  const ids = extractToolResultCallIds({
    model: "m",
    input: [
      { type: "function_call", call_id: "call_ignored", name: "x" },
      { type: "function_call_output", call_id: "call_a", output: { not: "valid" } },
      { type: "custom_tool_call_output", call_id: "call_b", output: 42 },
      { type: "function_call_output", call_id: 7 },
      "garbage",
    ],
  });
  expect([...ids]).toEqual(["call_a", "call_b"]);
  expect(extractToolResultCallIds("not a body").size).toBe(0);
});

test("a parse error names the item type and nested schema failure without content", () => {
  let message = "";
  try {
    parseRequest({ model: "gpt-5", input: [
      { type: "message", role: "user", content: "hi" },
      { type: "function_call_output", call_id: "call_a", output: [{ type: "weird_block", secret: "TOP-SECRET-VALUE" }] },
    ] });
  } catch (error) {
    message = (error as Error).message;
  }
  expect(message).toContain("type=function_call_output");
  expect(message).toContain("output[0]: unsupported type");
  expect(message).toContain("weird_block");
  expect(message).not.toContain("TOP-SECRET-VALUE");
});

test("a rejected Codex follow-up completes its dispatched call with an explicit error and fails the turn", async () => {
  const f = fixture();
  const token = await f.broker.register(f.env, undefined, "trace_rejected");
  const { bindingId } = await claim(f.socket, token);
  const started = Date.now();
  const pending = callTurnBroker<{ isError?: boolean; content: Array<{ text: string }> }>(f.socket, {
    method: "invoke", bindingId, wireName: "fixture_tool", freeform: false, arguments: {}, softDeadlineMs: 30_000,
  }, 40_000);
  const requests = await f.broker.nextToolBatch(token);
  const { runtime, cancelled } = toolsRuntime({
    completeTool: async (callId, result) => f.broker.completeTool(token, callId, result),
  });
  const sessions = new ChatGptTurnSessions();
  const session = sessions.getOrCreate("execution_rejected", () => runtime, "trace_rejected");
  runtime.externalProgress.recordToolBatch(requests.map(request => request.callId));
  session.setOutstanding(requests);
  const callId = requests[0]!.callId;
  const raw = { model: "gpt-5", input: [
    { type: "function_call", call_id: callId, name: "fixture_tool", arguments: "{}" },
    { type: "function_call_output", call_id: callId, output: [{ type: "weird_block", value: "x" }] },
  ] };
  let detail = "";
  try { parseRequest(raw); } catch (error) { detail = (error as Error).message; }
  expect(detail).toContain("responses parse error");

  expect(await rejectUnparseableChatGptToolResults(raw, detail, sessions)).toBe(1);
  const answered = await pending;
  expect(Date.now() - started).toBeLessThan(5_000);
  expect(answered.isError).toBe(true);
  expect(answered.content[0]!.text).toContain("the tool may have executed");
  expect(answered.content[0]!.text).toContain("type=function_call_output");
  expect(session.outstanding()).toEqual([]);
  expect(sessions.find("execution_rejected")).toBeUndefined();
  expect(cancelled[0]).toMatchObject({ code: "tool_result_rejected", retryable: false });
  // A second rejection of the same body finds nothing left to answer.
  expect(await rejectUnparseableChatGptToolResults(raw, detail, sessions)).toBe(0);
});

test("a rejected body whose call ids match no outstanding call is a no-op", async () => {
  const sessions = new ChatGptTurnSessions();
  const { runtime, cancelled } = toolsRuntime();
  const session = sessions.getOrCreate("execution_other", () => runtime, "trace_other");
  session.setOutstanding([{ callId: "call_live", wireName: "fixture_tool", freeform: false, arguments: {} } as BrokerToolRequest]);
  const raw = { model: "gpt-5", input: [{ type: "function_call_output", call_id: "call_unrelated", output: 1 }] };
  expect(await rejectUnparseableChatGptToolResults(raw, "detail", sessions)).toBe(0);
  expect(session.outstanding()).toHaveLength(1);
  expect(cancelled).toEqual([]);
});

// --- 2. A queued call without any consumer is cancelled instead of polled until the TTL -------

test("an owned call that Codex never consumes is cancelled as queued after the idle window", async () => {
  const f = fixture();
  const token = await f.broker.register(f.env, undefined, "trace_idle_async");
  const { bindingId } = await claim(f.socket, token);
  const operationId = `operation_${"i".repeat(40)}`;
  await callTurnBroker(f.socket, {
    method: "invoke_async", bindingId, operationId, wireName: "fixture_tool", freeform: false, arguments: {},
  });
  const running = await callTurnBroker<{ state: string }>(f.socket, { method: "operation_poll", token, operationId, waitMs: 0 });
  expect(running.state).toBe("running");
  setSystemTime(new Date(Date.now() + 26_000));
  const polled = await callTurnBroker<{ state: string; error: string; cancellationScope: string }>(
    f.socket, { method: "operation_poll", token, operationId, waitMs: 0 });
  expect(polled).toMatchObject({ state: "cancelled", cancellationScope: "queued" });
  expect(polled.error).toContain("was not executed");
  expect(channelOf(f.broker, token).queuedCallIds).toEqual([]);
  // A late Codex request finds nothing to dispatch.
  const abort = new AbortController();
  const next = f.broker.nextToolBatch(token, abort.signal);
  await new Promise(resolve => setTimeout(resolve, 50));
  abort.abort();
  await expect(next).rejects.toThrow(/aborted/);
});

test("a Codex request that arrives after the idle window still receives the queued call", async () => {
  const f = fixture();
  const token = await f.broker.register(f.env, undefined, "trace_idle_reconnect");
  const { bindingId } = await claim(f.socket, token);
  const operationId = `operation_${"r".repeat(40)}`;
  await callTurnBroker(f.socket, {
    method: "invoke_async", bindingId, operationId, wireName: "fixture_tool", freeform: false, arguments: {},
  });
  setSystemTime(new Date(Date.now() + 40_000));
  const batch = await f.broker.nextToolBatch(token);
  expect(batch).toHaveLength(1);
  f.broker.completeTool(token, batch[0]!.callId, { content: [{ type: "text", text: "ran" }] });
  const polled = await callTurnBroker<{ state: string }>(f.socket, { method: "operation_poll", token, operationId, waitMs: 0 });
  expect(polled.state).toBe("completed");
});

test("a waiting sync call without a consumer answers as never dispatched instead of being promoted", async () => {
  const f = fixture();
  const token = await f.broker.register(f.env, undefined, "trace_idle_sync");
  const { bindingId } = await claim(f.socket, token);
  const pending = callTurnBroker<{ isError?: boolean; structuredContent?: Record<string, unknown> }>(f.socket, {
    method: "invoke", bindingId, wireName: "fixture_tool", freeform: false, arguments: {}, softDeadlineMs: 60_000,
  }, 70_000);
  await until(() => channelOf(f.broker, token).queuedCallIds.length === 1, 2_000);
  setSystemTime(new Date(Date.now() + 26_000));
  const started = performance.now();
  const answered = await pending;
  expect(performance.now() - started).toBeLessThan(3_000);
  expect(answered.isError).toBe(true);
  expect(answered.structuredContent).toMatchObject({
    code: "codex_tool_not_dispatched", executed: false, cancellation_scope: "queued",
  });
  const status = await callTurnBroker<{ operations: unknown[] }>(f.socket, { method: "operation_status", token });
  expect(status.operations).toEqual([]);
});

test("a call queued behind a dispatched batch is kept and reported as queued behind it", async () => {
  const f = fixture();
  const token = await f.broker.register(f.env, undefined, "trace_behind");
  const { bindingId } = await claim(f.socket, token);
  void callTurnBroker(f.socket, {
    method: "invoke", bindingId, wireName: "fixture_tool", freeform: false, arguments: { first: true }, softDeadlineMs: 60_000,
  }, 70_000).catch(() => {});
  const [first] = await f.broker.nextToolBatch(token); // Codex is now executing this batch.
  setSystemTime(new Date(Date.now() + 30_000));
  const second = await callTurnBroker<unknown>(f.socket, {
    method: "invoke", bindingId, wireName: "fixture_tool", freeform: false, arguments: { second: true }, softDeadlineMs: 1_000,
  }, 10_000);
  expect(isBrokerPromotedInvocation(second)).toBe(true);
  expect((second as { promoted: Record<string, unknown> }).promoted).toMatchObject({ dispatched: false, queuedBehind: true });
  expect(channelOf(f.broker, token).queuedCallIds).toHaveLength(1);
  f.broker.completeTool(token, first!.callId, { content: [{ type: "text", text: "done" }] });
});

test("an undispatched promotion with no batch in flight is not described as queued behind one", async () => {
  const f = fixture();
  const token = await f.broker.register(f.env, undefined, "trace_not_behind");
  const { bindingId } = await claim(f.socket, token);
  const promoted = await callTurnBroker<unknown>(f.socket, {
    method: "invoke", bindingId, wireName: "fixture_tool", freeform: false, arguments: {}, softDeadlineMs: 1_000,
  }, 10_000);
  expect((promoted as { promoted: Record<string, unknown> }).promoted).toMatchObject({ dispatched: false, queuedBehind: false });
});

// --- 3. Broker lifecycle evidence survives a daemon with ignored stdio -------------------------

test("broker lifecycle events go to a size-rotated JSONL file without tool content", async () => {
  const f = fixture();
  const log = join(f.root, "diagnostics", "turn-broker-events.jsonl");
  configureTurnBrokerEventLog(log, { maxBytes: 4_096, rotations: 2 });
  const token = await f.broker.register(f.env, undefined, "trace_events");
  const { bindingId } = await claim(f.socket, token);
  await callTurnBroker(f.socket, {
    method: "invoke", bindingId, wireName: "fixture_tool", freeform: false, arguments: { secret: "ARGUMENT-SECRET" },
    softDeadlineMs: 1_000,
  }, 10_000);
  f.broker.revoke(token, new Error("test retirement"));
  const events = readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line) as Record<string, unknown>);
  expect(events.map(event => event.event)).toEqual(["broker_registered", "broker_promoted", "broker_retired"]);
  expect(events[1]).toMatchObject({ traceId: "trace_events", dispatched: false, reason: "deadline", tool: "fixture_tool" });
  expect(events[2]).toMatchObject({ reason: "test retirement", runningOperations: 1 });
  expect(readFileSync(log, "utf8")).not.toContain("ARGUMENT-SECRET");
  for (let index = 0; index < 60; index += 1) await f.broker.register(f.env, undefined, `trace_rotation_${index}`);
  expect(readFileSync(`${log}.1`, "utf8").length).toBeGreaterThan(0);
  expect(readFileSync(log, "utf8").length).toBeLessThanOrEqual(4_096);
});

// --- 4. SIGTERM releases live leases instead of leaving them for the 3-minute expiry -----------

test("shutdown handlers release leases once within the budget, then exit", async () => {
  const fakeProcess = Object.assign(new EventEmitter(), { stdin: new EventEmitter() });
  const budgets: number[] = [];
  const exits: number[] = [];
  let finished!: () => void;
  const done = new Promise<void>(resolve => { finished = resolve; });
  installMcpShutdownHandlers({ releaseActivities: async budget => { budgets.push(budget ?? -1); return 2; } }, {
    processLike: fakeProcess as never,
    exit: code => { exits.push(code); finished(); },
  });
  fakeProcess.emit("SIGTERM");
  fakeProcess.stdin.emit("end");
  await done;
  expect(budgets).toEqual([1_000]);
  expect(exits).toEqual([143]);
});

async function mcpClient(socket: string, flags: string[]) {
  const transport = new StdioClientTransport({
    command: process.execPath, args: ["src/cli.ts", "mcp", "--broker-socket", socket, ...flags],
    cwd: process.cwd(), stderr: "pipe",
  });
  const client = new Client({ name: "native-contract-reliability", version: "1" });
  await client.connect(transport);
  cleanups.push(() => client.close().catch(() => {}));
  return { client, transport };
}

test("a SIGTERM to the MCP process retires its live broker lease immediately", async () => {
  const f = fixture();
  const { client, transport } = await mcpClient(f.socket, ["--async-tool-operations", "--native6"]);
  const token = await f.broker.register(f.env, undefined, "trace_sigterm");
  void client.callTool({ name: "codex_tool_call", arguments: { turn_token: token, wire_name: "fixture_tool", arguments: {} } })
    .catch(() => {});
  await until(() => channelOf(f.broker, token).activities.size === 1
    && channelOf(f.broker, token).queuedCallIds.length === 1, 10_000);
  const started = Date.now();
  process.kill(transport.pid!, "SIGTERM");
  await until(() => channelOf(f.broker, token).activities.size === 0, 3_000);
  expect(Date.now() - started).toBeLessThan(3_000);
}, 20_000);

// --- 5. codex_tool_inventory answers quickly and reuses its nested catalog per binding ---------

const execTool = { name: "exec", description: "Run a program", parameters: { type: "object" }, freeform: true };

test("inventory withdraws a queued catalog lookup after a short deadline instead of waiting 80 s", async () => {
  const f = fixture();
  const { client } = await mcpClient(f.socket, ["--async-tool-operations", "--native6"]);
  const token = await f.broker.register(environment(f.root, [execTool]), undefined, "trace_inventory_wait");
  const started = Date.now();
  const listed = await client.callTool({ name: "codex_tool_inventory", arguments: { turn_token: token } });
  const elapsed = Date.now() - started;
  expect(elapsed).toBeGreaterThan(2_500);
  expect(elapsed).toBeLessThan(8_000);
  const content = listed.structuredContent as { tools: Array<{ wire_name: string }>; nested_inventory_pending?: Record<string, unknown> };
  expect(content.tools.map(tool => tool.wire_name)).toContain("fixture_tool");
  expect(content.nested_inventory_pending).toBeDefined();
  expect(content.nested_inventory_pending).not.toHaveProperty("operation_id");
  // The withdrawn lookup neither runs later nor holds the completion fence.
  expect(channelOf(f.broker, token).queuedCallIds).toEqual([]);
  expect(f.broker.beginCompletionFence(token)).toHaveProperty("revision");
}, 20_000);

test("inventory reuses the nested catalog of the same binding without another gateway call", async () => {
  const f = fixture();
  const { client } = await mcpClient(f.socket, ["--async-tool-operations", "--native6"]);
  const token = await f.broker.register(environment(f.root, [execTool]), undefined, "trace_inventory_cache");
  let gatewayCalls = 0;
  const consumer = (async () => {
    const [request] = await f.broker.nextToolBatch(token);
    gatewayCalls += 1;
    const marker = /codex-tool-catalog:[0-9a-f]{32}:/.exec(request!.input ?? "")![0];
    f.broker.completeTool(token, request!.callId, { content: [{ type: "text", text:
      `${marker}${JSON.stringify({ tools: [{ name: "nested_tool", description: "Nested" }], total: 1 })}` }] });
  })();
  const first = await client.callTool({ name: "codex_tool_inventory", arguments: { turn_token: token } });
  await consumer;
  const wireNames = (value: unknown) => (value as { tools: Array<{ wire_name: string }> }).tools.map(tool => tool.wire_name);
  expect(wireNames(first.structuredContent)).toContain("nested_tool");
  const started = Date.now();
  const second = await client.callTool({ name: "codex_tool_inventory", arguments: { turn_token: token } });
  expect(Date.now() - started).toBeLessThan(1_500);
  expect(wireNames(second.structuredContent)).toContain("nested_tool");
  expect(gatewayCalls).toBe(1);
  expect(channelOf(f.broker, token).queuedCallIds).toEqual([]);
}, 20_000);

// --- 6. An unconfirmed call names the operation that retains it --------------------------------

test("a promoted call keeps the client-proposed operation id", async () => {
  const f = fixture();
  const token = await f.broker.register(f.env, undefined, "trace_proposed");
  const { bindingId } = await claim(f.socket, token);
  const operationId = `operation_${"p".repeat(43)}`;
  const promoted = await callTurnBroker<unknown>(f.socket, {
    method: "invoke", bindingId, wireName: "fixture_tool", freeform: false, arguments: {}, softDeadlineMs: 1_000, operationId,
  }, 10_000);
  expect((promoted as { promoted: { operationId: string } }).promoted.operationId).toBe(operationId);
  await expect(callTurnBroker(f.socket, {
    method: "invoke", bindingId, wireName: "fixture_tool", freeform: false, arguments: {}, softDeadlineMs: 1_000,
    operationId: "operation_short",
  })).rejects.toThrow(/operation id is invalid/);
});

test("codex_tool_unconfirmed carries the operation_id the MCP proposed to the broker", async () => {
  const root = mkdtempSync(join(process.platform === "win32" ? tmpdir() : "/tmp", "ncr-"));
  const socket = join(root, "fake.sock");
  const invokes: Array<Record<string, unknown>> = [];
  const claims: Array<Record<string, unknown>> = [];
  const server = createServer(connection => {
    let buffered = "";
    connection.setEncoding("utf8");
    connection.on("error", () => {});
    connection.on("data", chunk => {
      buffered += chunk;
      const newline = buffered.indexOf("\n");
      if (newline < 0) return;
      const request = JSON.parse(buffered.slice(0, newline)) as Record<string, unknown>;
      const reply = (result: unknown) => connection.end(`${JSON.stringify({ id: request.id, result })}\n`);
      if (request.method === "owner_status") reply({ features: ["soft-deadline-promotion"] });
      else if (request.method === "claim") {
        claims.push(request);
        reply({ bindingId: "binding_fake", environment: { ...environment(root), expiresAt: Date.now() + 8_000 } });
      } else if (request.method === "invoke") invokes.push(request); // never answered
      else reply({ completed: true, released: true });
    });
  });
  await new Promise<void>(resolve => server.listen(socket, resolve));
  cleanups.push(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  });
  const { client } = await mcpClient(socket, ["--async-tool-operations", "--native6"]);
  const answered = await client.callTool({ name: "codex_tool_call", arguments: {
    turn_token: "turn_fake_token_value_000000", wire_name: "fixture_tool", arguments: {} } });
  expect(answered.isError).toBe(true);
  const content = answered.structuredContent as { code: string; operation_id: string };
  expect(content.code).toBe("codex_tool_unconfirmed");
  expect(invokes).toHaveLength(1);
  expect(invokes[0]!.operationId).toMatch(/^operation_[A-Za-z0-9_-]{32,128}$/);
  expect(content.operation_id).toBe(invokes[0]!.operationId as string);
  expect(claims[0]).toMatchObject({ invokeIntent: true });
  expect(invokes[0]!.activityId).toBe(claims[0]!.activityId as string);
}, 20_000);

// --- 7. Parallel ChatGPT calls reach Codex as one round ----------------------------------------

function invokeFrom(socket: string, bindingId: string, activityId: string | undefined, index: number) {
  return callTurnBroker(socket, {
    method: "invoke", bindingId, wireName: "fixture_tool", freeform: false, arguments: { index }, softDeadlineMs: 60_000,
    ...(activityId ? { activityId } : {}),
  }, 70_000).catch(() => {});
}

test("an announced invoke extends the batch window so parallel calls share one round", async () => {
  const f = fixture();
  const token = await f.broker.register(f.env, undefined, "trace_batch");
  const first = await claim(f.socket, token, true);
  const second = await claim(f.socket, token, true);
  const batch = f.broker.nextToolBatch(token);
  void invokeFrom(f.socket, first.bindingId, first.activityId, 1);
  await new Promise(resolve => setTimeout(resolve, 50));
  void invokeFrom(f.socket, second.bindingId, second.activityId, 2);
  expect((await batch).map(request => request.arguments?.index)).toEqual([1, 2]);
});

test("without announced invokes the batch window stays short", async () => {
  const f = fixture();
  const token = await f.broker.register(f.env, undefined, "trace_batch_short");
  const { bindingId } = await claim(f.socket, token);
  const batch = f.broker.nextToolBatch(token);
  void invokeFrom(f.socket, bindingId, undefined, 1);
  await new Promise(resolve => setTimeout(resolve, 80));
  void invokeFrom(f.socket, bindingId, undefined, 2);
  expect((await batch).map(request => request.arguments?.index)).toEqual([1]);
});

test("an announced invoke that never arrives delays the batch by at most the extended window", async () => {
  const f = fixture();
  const token = await f.broker.register(f.env, undefined, "trace_batch_bound");
  const first = await claim(f.socket, token, true);
  await claim(f.socket, token, true); // never invokes
  const batch = f.broker.nextToolBatch(token);
  const started = performance.now();
  void invokeFrom(f.socket, first.bindingId, first.activityId, 1);
  expect((await batch).map(request => request.arguments?.index)).toEqual([1]);
  expect(performance.now() - started).toBeLessThan(400);
});
