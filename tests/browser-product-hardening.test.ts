import { afterEach, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ChatGptThreadEnvironmentStore } from "../src/adapters/chatgpt-web/thread-environment";
import {
  ChatGptLunaCheckpointStore,
  hashChatGptLunaAnswer,
} from "../src/adapters/chatgpt-web/rolling-checkpoint";
import { chatGptAccountRoutingKey } from "../src/adapters/chatgpt-web/turn-execution";
import { TurnBroker, type BrokerToolResult } from "../src/adapters/chatgpt-web/turn-broker";
import { defaultBrokerEndpoint } from "../src/config";
import { parseRequest } from "../src/responses/parser";
import type { CodexParsedRequest } from "../src/types";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function environmentRequest(root: string, threadId: string, turnId: string): CodexParsedRequest {
  const environment = `<environment_context>
  <cwd>${root}</cwd>
  <filesystem><workspace_roots><root>${root}</root></workspace_roots><permission_profile type="disabled"><file_system type="unrestricted" /></permission_profile></filesystem>
</environment_context>`;
  return {
    modelId: "gpt-5.6-sol",
    stream: true,
    context: { messages: [{ role: "user", content: `Work in ${threadId}`, timestamp: 1 }] },
    options: { reasoning: "high" },
    _rawBody: {
      client_metadata: {
        "x-codex-turn-metadata": JSON.stringify({
          request_kind: "turn",
          thread_id: threadId,
          turn_id: turnId,
          agent_name: "/root",
          sandbox_mode: "danger-full-access",
          workspaces: { [root]: { has_changes: false } },
        }),
      },
      input: [
        {
          type: "message",
          id: `context_${threadId}`,
          role: "user",
          content: [{ type: "input_text", text: environment }],
          internal_chat_message_metadata_passthrough: { turn_id: turnId },
        },
        {
          type: "message",
          id: `active_${threadId}`,
          role: "user",
          content: [{ type: "input_text", text: `Work in ${threadId}` }],
          internal_chat_message_metadata_passthrough: { turn_id: turnId },
        },
      ],
    },
  };
}

function lunaRequest(threadId: string, turnId: string, text: string) {
  return parseRequest({
    model: "gpt-5.6-luna",
    stream: true,
    client_metadata: {
      "x-codex-turn-metadata": JSON.stringify({ thread_id: threadId, turn_id: turnId }),
    },
    input: [{
      type: "message",
      id: `message_${threadId}`,
      role: "user",
      content: [{ type: "input_text", text }],
      internal_chat_message_metadata_passthrough: { turn_id: turnId },
    }],
  });
}

function routingRequest(turnId: string, threadId?: string, promptCacheKey?: string): CodexParsedRequest {
  return {
    modelId: "gpt-5.6-sol",
    stream: true,
    context: { messages: [] },
    options: { reasoning: "medium" },
    _rawBody: {
      ...(promptCacheKey ? { prompt_cache_key: promptCacheKey } : {}),
      client_metadata: {
        "x-codex-turn-metadata": JSON.stringify({
          ...(threadId ? { thread_id: threadId } : {}),
          turn_id: turnId,
        }),
      },
      input: [],
    },
  };
}

function brokerEndpoint(root: string): string {
  return process.platform === "win32"
    ? defaultBrokerEndpoint(root, "win32")
    : join(root, "broker.sock");
}

function toolResult(value: Record<string, unknown>): BrokerToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value,
  };
}

async function mcpClient(socketPath: string, asyncOperations: boolean) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      "src/cli.ts", "mcp", "--broker-socket", socketPath,
      asyncOperations ? "--async-tool-operations" : "--synchronous-tool-operations",
    ],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const client = new Client({
    name: asyncOperations ? "native5-owned-operation-fixture" : "native4-schema-fixture",
    version: "1.0.0",
  });
  await client.connect(transport);
  return client;
}

test("chatgpt browser state merge preserves parallel records and legacy thread affinity", () => {
  const root = mkdtempSync(join(tmpdir(), "nekodex-browser-state-"));
  temporaryRoots.push(root);
  const environmentPath = join(root, "thread-environments.json");
  const checkpointPath = join(root, "luna-checkpoints.json");

  const environmentA = new ChatGptThreadEnvironmentStore(environmentPath);
  const environmentB = new ChatGptThreadEnvironmentStore(environmentPath);
  environmentA.resolve(environmentRequest(root, "thread_parallel_a", "turn_parallel_a"));
  environmentB.resolve(environmentRequest(root, "thread_parallel_b", "turn_parallel_b"));

  const savedEnvironments = JSON.parse(readFileSync(environmentPath, "utf8")) as {
    threads: Record<string, unknown>;
  };
  expect(Object.keys(savedEnvironments.threads).sort()).toEqual([
    "thread_parallel_a",
    "thread_parallel_b",
  ]);

  const checkpointA = new ChatGptLunaCheckpointStore(checkpointPath);
  const checkpointB = new ChatGptLunaCheckpointStore(checkpointPath);
  const answerA = "First parallel answer";
  const answerB = "Second parallel answer";
  checkpointA.commit(
    lunaRequest("thread_luna_a", "turn_luna_a", "First task"),
    {
      checkpoint: { version: 2, summary: "First retained checkpoint" },
      answerHash: hashChatGptLunaAnswer(answerA),
    },
    answerA,
  );
  checkpointB.commit(
    lunaRequest("thread_luna_b", "turn_luna_b", "Second task"),
    {
      checkpoint: { version: 2, summary: "Second retained checkpoint" },
      answerHash: hashChatGptLunaAnswer(answerB),
    },
    answerB,
  );

  const savedCheckpoints = JSON.parse(readFileSync(checkpointPath, "utf8")) as {
    checkpoints: Array<{ threadId: string }>;
  };
  expect(savedCheckpoints.checkpoints.map(value => value.threadId).sort()).toEqual([
    "thread_luna_a",
    "thread_luna_b",
  ]);

  const existingThreadId = "thread_existing_affinity";
  expect(chatGptAccountRoutingKey(routingRequest("turn_existing", existingThreadId))).toBe(
    createHash("sha256").update(`account-thread:${existingThreadId}`).digest("hex"),
  );
  const promptFallback = chatGptAccountRoutingKey(routingRequest(
    "turn_prompt_fallback", undefined, "prompt-cache-stable",
  ));
  expect(promptFallback).toBe(chatGptAccountRoutingKey(routingRequest(
    "turn_prompt_fallback", undefined, "prompt-cache-stable",
  )));
  expect(promptFallback).not.toBe(chatGptAccountRoutingKey(routingRequest("turn_only_fallback")));
});

test("Native5 owned MCP operations fence terminal delivery until exact acknowledgement", async () => {
  const root = mkdtempSync(join(tmpdir(), "nekodex-native5-owned-operation-"));
  temporaryRoots.push(root);
  const socketPath = brokerEndpoint(root);
  const broker = TurnBroker.forSocket(socketPath);
  const environment = {
    cwd: resolve(root),
    roots: [resolve(root)],
    writableRoots: [resolve(root)],
    sandboxPolicy: { type: "dangerFullAccess" as const },
    tools: [
      { name: "slow_tool", description: "Synthetic pending tool", parameters: { type: "object" } },
      { name: "sibling_tool", description: "Synthetic sibling tool", parameters: { type: "object" } },
    ],
  };
  const token = await broker.register(environment, undefined, "native5-owned-operation");
  let native4: Client | undefined;
  let native5: Client | undefined;
  const realNow = Date.now;

  try {
    native4 = await mcpClient(socketPath, false);
    const native4Tools = (await native4.listTools()).tools.map(tool => tool.name);
    expect(native4Tools).not.toContain("codex_tool_start");
    expect(native4Tools).not.toContain("codex_tool_poll");
    expect(native4Tools).not.toContain("codex_tool_cancel");
    await native4.close();
    native4 = undefined;

    native5 = await mcpClient(socketPath, true);
    const native5Tools = (await native5.listTools()).tools.map(tool => tool.name);
    expect(native5Tools).toEqual(expect.arrayContaining([
      "codex_tool_start",
      "codex_tool_poll",
      "codex_tool_cancel",
    ]));

    const initialFence = broker.beginCompletionFence(token);
    if (!("revision" in initialFence)) throw new Error("initial completion fence was blocked");

    const startSibling = await native5.callTool({
      name: "codex_tool_start",
      arguments: {
        turn_token: token,
        operation_key: "stable-sibling-operation",
        wire_name: "sibling_tool",
        arguments: { alpha: 1, nested: { first: true, second: true } },
      },
    });
    const siblingOperationId = String((startSibling.structuredContent as Record<string, unknown>).operation_id);

    const reorderedRetry = await native5.callTool({
      name: "codex_tool_start",
      arguments: {
        turn_token: token,
        operation_key: "stable-sibling-operation",
        wire_name: "sibling_tool",
        arguments: { nested: { second: true, first: true }, alpha: 1 },
      },
    });
    expect((reorderedRetry.structuredContent as Record<string, unknown>).operation_id)
      .toBe(siblingOperationId);
    expect((reorderedRetry.structuredContent as Record<string, unknown>).state).toBe("running");

    const startCancelled = await native5.callTool({
      name: "codex_tool_start",
      arguments: {
        turn_token: token,
        operation_key: "stable-cancel-operation",
        wire_name: "slow_tool",
        arguments: { task: "remain pending until fixture completion" },
      },
    });
    const cancelledOperationId = String((startCancelled.structuredContent as Record<string, unknown>).operation_id);
    const delivered = await broker.nextToolBatch(token);
    expect(delivered.map(request => request.wireName).sort()).toEqual(["sibling_tool", "slow_tool"]);
    const siblingRequest = delivered.find(request => request.wireName === "sibling_tool");
    const cancelledRequest = delivered.find(request => request.wireName === "slow_tool");
    if (!siblingRequest || !cancelledRequest) throw new Error("fixture did not deliver both owned operations");
    const cancelled = await native5.callTool({
      name: "codex_tool_cancel",
      arguments: { turn_token: token, operation_id: cancelledOperationId },
    });
    expect(cancelled.structuredContent).toMatchObject({
      state: "cancelled",
      cancellation_scope: "observation_only",
    });

    broker.completeTool(token, siblingRequest.callId, toolResult({ sibling: "completed" }));
    broker.completeTool(token, cancelledRequest.callId, toolResult({ late: "consumed" }));

    const siblingTerminal = await native5.callTool({
      name: "codex_tool_poll",
      arguments: { turn_token: token, operation_id: siblingOperationId, wait_ms: 0 },
    });
    const siblingDeliveryId = String((siblingTerminal.structuredContent as Record<string, unknown>).delivery_id);
    expect(siblingTerminal.structuredContent).toMatchObject({ state: "completed" });
    const replayedTerminal = await native5.callTool({
      name: "codex_tool_poll",
      arguments: { turn_token: token, operation_id: siblingOperationId, wait_ms: 0 },
    });
    expect((replayedTerminal.structuredContent as Record<string, unknown>).delivery_id).toBe(siblingDeliveryId);

    const cancelledTerminal = await native5.callTool({
      name: "codex_tool_poll",
      arguments: { turn_token: token, operation_id: cancelledOperationId, wait_ms: 0 },
    });
    const cancelledDeliveryId = String((cancelledTerminal.structuredContent as Record<string, unknown>).delivery_id);
    expect(broker.beginCompletionFence(token)).toMatchObject({
      blockedReason: "unacknowledged_async_result",
      blockedCount: 2,
    });
    expect(broker.commitCompletionFence(token, initialFence.revision)).toBeFalse();

    await native5.callTool({
      name: "codex_tool_poll",
      arguments: {
        turn_token: token,
        operation_id: cancelledOperationId,
        wait_ms: 0,
        ack_delivery_id: cancelledDeliveryId,
      },
    });

    let now = realNow();
    Date.now = () => now;
    now += 31 * 60_000;
    const expiredRetry = await native5.callTool({
      name: "codex_tool_start",
      arguments: {
        turn_token: token,
        operation_key: "stable-sibling-operation",
        wire_name: "sibling_tool",
        arguments: { nested: { second: true, first: true }, alpha: 1 },
      },
    });
    expect(expiredRetry.structuredContent).toMatchObject({
      operation_id: siblingOperationId,
      state: "expired",
      delivery_id: siblingDeliveryId,
    });
    expect(broker.beginCompletionFence(token)).toMatchObject({
      blockedReason: "unacknowledged_async_result",
      blockedCount: 1,
    });

    await native5.callTool({
      name: "codex_tool_poll",
      arguments: {
        turn_token: token,
        operation_id: siblingOperationId,
        wait_ms: 0,
        ack_delivery_id: siblingDeliveryId,
      },
    });
    const acknowledgedRetry = await native5.callTool({
      name: "codex_tool_start",
      arguments: {
        turn_token: token,
        operation_key: "stable-sibling-operation",
        wire_name: "sibling_tool",
        arguments: { alpha: 1, nested: { first: true, second: true } },
      },
    });
    expect(acknowledgedRetry.structuredContent).toMatchObject({
      operation_id: siblingOperationId,
      state: "acknowledged",
    });
    const noRedispatch = new AbortController();
    const unexpectedBatch = broker.nextToolBatch(token, noRedispatch.signal);
    noRedispatch.abort();
    await expect(unexpectedBatch).rejects.toMatchObject({ name: "AbortError" });

    const finalFence = broker.beginCompletionFence(token);
    if (!("revision" in finalFence)) throw new Error("completion fence remained blocked after acknowledgements");
    expect(broker.commitCompletionFence(token, finalFence.revision)).toBeTrue();
  } finally {
    Date.now = realNow;
    if (native4) await native4.close().catch(() => {});
    if (native5) await native5.close().catch(() => {});
    broker.revoke(token);
    await broker.close();
  }
}, 30_000);
