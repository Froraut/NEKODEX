import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection, createServer, type Socket } from "node:net";
import { TurnBroker, RemoteTurnBroker, callTurnBroker, type BrokerOwnedOperationSnapshot } from "../src/adapters/chatgpt-web/turn-broker";
import { OwnedToolOperationStore } from "../src/adapters/chatgpt-web/turn-broker-owned-operations";
import { resolveThreadEnvironment } from "../src/adapters/chatgpt-web/thread-environment-resolver";
import type { ChatGptTurnEnvironment } from "../src/adapters/chatgpt-web/environment";
import type { CodexParsedRequest } from "../src/types";

const environment: ChatGptTurnEnvironment = {
  cwd: tmpdir(), roots: [tmpdir()], writableRoots: [],
  sandboxPolicy: { type: "readOnly", networkAccess: false }, tools: [],
};

async function fixture(run: (path: string, broker: TurnBroker, remote: RemoteTurnBroker) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), "lane04-"));
  const path = join(directory, "b.sock");
  const broker = TurnBroker.forSocket(path);
  try {
    await broker.listen();
    await run(path, broker, new RemoteTurnBroker(path));
  } finally {
    await broker.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test("lane04 remote ownership retains retry identity and fences terminal results until exact acknowledgement", async () => {
  await fixture(async (path, broker, remote) => {
    await remote.assertCompatible();
    const token = await remote.register(environment);
    const claim = await callTurnBroker<{ bindingId: string; activityId: string }>(path, { method: "claim", token });
    const request = { method: "invoke_async" as const, bindingId: claim.bindingId,
      operationId: `operation_${"a".repeat(32)}`, wireName: "fixture", arguments: { x: 1, y: 2 } };
    const first = await callTurnBroker<BrokerOwnedOperationSnapshot>(path, request);
    expect(await callTurnBroker<BrokerOwnedOperationSnapshot>(path, { ...request, arguments: { y: 2, x: 1 } })).toEqual(first);
    await expect(callTurnBroker(path, { ...request, arguments: { x: 2 } })).rejects.toThrow("different invocation");
    const batch = await remote.nextToolBatch(token);
    expect(batch).toHaveLength(1);
    expect(batch[0]?.wireName).toBe("fixture");
    await callTurnBroker(path, { method: "activity_complete", token, activityId: claim.activityId });
    // Exercise the synchronous interval before the result promise reaction records termination.
    broker.completeTool(token, batch[0]!.callId, { content: ["result"] });
    expect(broker.beginCompletionFence(token)).toEqual({ blockedReason: "active_work", blockedCount: 1 });
    const result = await callTurnBroker<BrokerOwnedOperationSnapshot>(path,
      { method: "operation_poll", token, operationId: request.operationId });
    expect(result.state).toBe("completed");
    expect(await remote.beginCompletionFence(token)).toEqual({ blockedReason: "unacknowledged_async_result", blockedCount: 1 });
    await expect(callTurnBroker(path, { method: "operation_poll", token,
      operationId: request.operationId, deliveryId: "wrong" })).rejects.toThrow("acknowledgement is invalid");
    if (result.state !== "completed") throw new Error("completion boundary not reached");
    expect(result.result.content).toEqual(["result"]);
    await callTurnBroker(path, { method: "operation_poll", token, operationId: request.operationId, deliveryId: result.deliveryId });
    expect(await callTurnBroker<BrokerOwnedOperationSnapshot>(path, request)).toEqual({ operationId: request.operationId, state: "acknowledged" });
    const fence = await remote.beginCompletionFence(token);
    if (!("revision" in fence)) throw new Error("acknowledgement did not release fence");
    expect(await remote.commitCompletionFence(token, fence.revision)).toBe(true);
  });
}, 5000);

test("lane04 queued cancellation prevents delivery and dispatched cancellation swallows late completion", async () => {
  await fixture(async (path, _broker, remote) => {
    const token = await remote.register(environment);
    const { bindingId } = await callTurnBroker<{ bindingId: string }>(path, { method: "claim", token });
    const start = (letter: string) => callTurnBroker<BrokerOwnedOperationSnapshot>(path, {
      method: "invoke_async", bindingId, wireName: "fixture", operationId: `operation_${letter.repeat(32)}`,
    });
    const queued = await start("q");
    expect(await callTurnBroker<BrokerOwnedOperationSnapshot>(path, { method: "operation_cancel", token, operationId: queued.operationId }))
      .toMatchObject({ state: "cancelled", cancellationScope: "queued" });
    const dispatched = await start("d");
    const batch = await remote.nextToolBatch(token);
    expect(batch).toHaveLength(1);
    const cancelled = await callTurnBroker<BrokerOwnedOperationSnapshot>(path, { method: "operation_cancel", token, operationId: dispatched.operationId });
    expect(cancelled).toMatchObject({ state: "cancelled", cancellationScope: "observation_only" });
    await remote.completeTool(token, batch[0]!.callId, { content: ["late external result"] });
    expect(await callTurnBroker<BrokerOwnedOperationSnapshot>(path, { method: "operation_poll", token, operationId: dispatched.operationId })).toEqual(cancelled);
  });
}, 5000);

test("lane04 malformed methods reject on wire with the original request identity", async () => {
  await fixture(async (path, _broker, remote) => {
    const response = await new Promise<string>((resolve, reject) => {
      const socket = createConnection(path);
      let text = "";
      socket.setEncoding("utf8");
      socket.on("error", reject);
      socket.on("data", chunk => { text += chunk; socket.end(); });
      socket.on("close", () => resolve(text));
      socket.on("connect", () => socket.write(`${JSON.stringify({ id: "invalid", method: "toString" })}\n`));
    });
    expect(JSON.parse(response)).toEqual({ id: "invalid", error: "turn broker method is invalid" });
    await remote.assertCompatible();
  });
}, 5000);

test("lane04 cancellation closes an unbounded call after the server received its request", async () => {
  const directory = mkdtempSync(join(tmpdir(), "lane04-abort-"));
  const path = join(directory, "b.sock");
  let markReached!: () => void;
  let markClosed!: () => void;
  const reached = new Promise<void>(resolve => { markReached = resolve; });
  const closed = new Promise<void>(resolve => { markClosed = resolve; });
  let active: Socket | undefined;
  const server = createServer(socket => {
    active = socket;
    socket.on("data", () => markReached());
    socket.on("close", () => markClosed());
  });
  try {
    await new Promise<void>(resolve => server.listen(path, resolve));
    const abort = new AbortController();
    const pending = callTurnBroker(path, { method: "owner_next", token: "fixture" }, null, abort.signal);
    await reached;
    abort.abort();
    await expect(pending).rejects.toThrow("aborted");
    await closed;
    expect(active?.destroyed).toBe(true);
  } finally {
    active?.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
}, 5000);

test("lane04 payload expiry retains replay identity and status never supplies delivery credentials", async () => {
  let now = 1;
  let revisions = 0;
  const store = new OwnedToolOperationStore(() => { revisions++; }, () => now);
  const identity = { bindingId: "binding", wireName: "fixture", freeform: false, arguments: { x: 1 } };
  store.start("token", "operation", "call", identity, Promise.resolve({ content: ["retained"] }));
  await Promise.resolve();
  const terminal = await store.poll("token", "operation");
  expect(terminal.state).toBe("completed");
  now += 30 * 60_000 + 1;
  const expired = await store.poll("token", "operation");
  expect(expired.state).toBe("expired");
  expect(store.status("token").operations).toEqual([
    { operation_id: "operation", state: "expired", acknowledgement_required: true },
  ]);
  expect(store.lookup("token", "operation", identity)).toEqual(expired);
  expect(() => store.lookup("other", "operation", identity)).toThrow("different invocation");
  expect(() => store.lookup("token", "operation", { ...identity, arguments: { x: 2 } })).toThrow("different invocation");
  if (expired.state !== "expired" || terminal.state !== "completed") throw new Error("expiry boundary not reached");
  expect(expired.deliveryId).toBe(terminal.deliveryId);
  await store.poll("token", "operation", expired.deliveryId);
  expect(store.lookup("token", "operation", identity)).toEqual({ operationId: "operation", state: "acknowledged" });
  expect(revisions).toBe(4);
});

test("lane04 Hermes resolution never consults native authority or requests persistence", () => {
  const tools = [{ name: "hermes_tool", description: "fixture", parameters: { type: "object" } }];
  const request: CodexParsedRequest = {
    modelId: "fixture", stream: false, options: {}, context: { messages: [], tools },
    _hermesContext: { threadId: "hermes_thread", turnId: "hermes_turn", root: tmpdir() },
  };
  const decision = resolveThreadEnvironment(request, {
    readCache: () => { throw new Error("native cache must not be consulted"); },
    resolveRollout: () => { throw new Error("native rollout must not be consulted"); },
  });
  expect(decision.persistForThreadId).toBeUndefined();
  expect(decision.environment).toMatchObject({ producer: "hermes", writableRoots: [], sandboxPolicy: { type: "readOnly", networkAccess: false } });
  expect(decision.environment.tools).toBe(tools);
});
