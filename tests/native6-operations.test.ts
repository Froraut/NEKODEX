import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultBrokerEndpoint } from "../src/config";
import { TurnBroker } from "../src/adapters/chatgpt-web/turn-broker";

async function fixture() {
  const root = mkdtempSync(join(process.platform === "win32" ? tmpdir() : "/tmp", "n6-"));
  const socket = defaultBrokerEndpoint(root);
  const broker = TurnBroker.forSocket(socket);
  const clients: Client[] = [];
  const environment = {
    cwd: root, roots: [root], writableRoots: [root],
    sandboxPolicy: { type: "dangerFullAccess" as const },
    tools: [{ name: "fixture_tool", description: "Synthetic tool", parameters: { type: "object" } }],
  };
  return {
    broker,
    register: () => broker.register(environment),
    async client(generation: 4 | 5 | 6) {
      const client = new Client({ name: `native${generation}-fixture`, version: "1" });
      clients.push(client);
      await client.connect(new StdioClientTransport({
        command: process.execPath,
        args: ["src/cli.ts", "mcp", "--broker-socket", socket,
          generation === 4 ? "--synchronous-tool-operations" : "--async-tool-operations",
          ...(generation === 6 ? ["--native6"] : [])],
        cwd: process.cwd(), stderr: "pipe",
      }));
      return client;
    },
    async close() {
      await Promise.allSettled(clients.map(client => client.close()));
      await broker.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  return client.callTool({ name, arguments: args });
}

function start(client: Client, token: string, key: string, args = { secret: "private-arguments" }) {
  return call(client, "codex_tool_start", {
    turn_token: token, operation_key: key, wire_name: "fixture_tool", arguments: args,
  });
}

test("Native6 recovers private owned metadata with explicit ack and isolates legacy schemas", async () => {
  const f = await fixture();
  try {
    const native4 = await f.client(4);
    const native5 = await f.client(5);
    const native6 = await f.client(6);
    const tools4 = (await native4.listTools()).tools;
    const tools5 = (await native5.listTools()).tools;
    const tools6 = (await native6.listTools()).tools;
    expect(tools4.some(tool => tool.name === "codex_tool_status")).toBe(false);
    expect(tools5.some(tool => tool.name === "codex_tool_status")).toBe(false);
    const asyncNames = ["codex_tool_start", "codex_tool_poll", "codex_tool_cancel"];
    for (const name of asyncNames) {
      expect(tools6.find(tool => tool.name === name)?.description).toStartWith("Native6 only.");
      expect(tools5.find(tool => tool.name === name)?.description).toStartWith("Native5 only.");
    }
    // Only the generation label differs; all legacy schemas and remaining descriptions match.
    expect(tools6.filter(tool => tool.name !== "codex_tool_status").map(tool => (
      asyncNames.includes(tool.name)
        ? { ...tool, description: tool.description?.replace(/^Native6 only\./, "Native5 only.") }
        : tool
    ))).toEqual(tools5);
    expect(tools5.filter(tool => !["codex_tool_start", "codex_tool_poll", "codex_tool_cancel"].includes(tool.name)))
      .toEqual(tools4);
    const token = await f.register();
    const otherToken = await f.register();
    // Deliberately discard the start response: discovery must recover its identity.
    await start(native6, token, "recover-operation-key");
    const running = await call(native6, "codex_tool_status", { turn_token: token });
    const runningData = running.structuredContent as {
      operations: Array<{ operation_id: string; state: string; acknowledgement_required: boolean }>;
    };
    expect(runningData.operations).toHaveLength(1);
    expect(runningData.operations[0]).toMatchObject({ state: "running", acknowledgement_required: false });
    const id = runningData.operations[0]!.operation_id;
    const [request] = await f.broker.nextToolBatch(token);
    f.broker.completeTool(token, request!.callId, {
      content: [{ type: "text", text: "private-payload-and-error" }],
      structuredContent: { input: "private-input", arguments: "private-arguments" },
      isError: true,
    });
    const terminal = await call(native6, "codex_tool_status", { turn_token: token });
    expect(terminal.structuredContent).toEqual({
      operations: [{ operation_id: id, state: "completed", acknowledgement_required: true }],
      limit: 64, truncated: false,
    });
    expect(JSON.stringify(terminal)).not.toContain("delivery_id");
    expect(JSON.stringify(terminal)).not.toContain("private-");
    expect((await call(native6, "codex_tool_status", { turn_token: otherToken })).structuredContent)
      .toEqual({ operations: [], limit: 64, truncated: false });
    expect((await call(native6, "codex_tool_poll", {
      turn_token: otherToken, operation_id: id, wait_ms: 0,
    })).isError).toBe(true);
    expect(f.broker.beginCompletionFence(token)).toMatchObject({ blockedReason: "unacknowledged_async_result" });
    const payload = await call(native6, "codex_tool_poll", { turn_token: token, operation_id: id, wait_ms: 0 });
    expect(JSON.stringify(payload)).toContain("private-payload-and-error");
    const delivery = payload.structuredContent as { delivery_id: string };
    expect(delivery.delivery_id).toMatch(/^delivery_/);
    const ackArgs = { turn_token: token, operation_id: id, wait_ms: 0, ack_delivery_id: delivery.delivery_id };
    expect((await call(native6, "codex_tool_poll", ackArgs)).structuredContent).toMatchObject({ state: "acknowledged" });
    expect((await call(native6, "codex_tool_poll", ackArgs)).structuredContent).toMatchObject({ state: "acknowledged" });
    expect((await call(native6, "codex_tool_status", { turn_token: token })).structuredContent).toEqual({
      operations: [{ operation_id: id, state: "acknowledged", acknowledgement_required: false }], limit: 64, truncated: false,
    });
    expect(f.broker.beginCompletionFence(token)).toHaveProperty("revision");
    f.broker.revoke(token);
    expect((await call(native6, "codex_tool_status", { turn_token: token })).isError).toBe(true);
  } finally {
    await f.close();
  }
}, 15_000);

test("Native6 start retries retain identity across compaction and new starts return control only", async () => {
  const f = await fixture();
  try {
    const client = await f.client(6);
    const token = await f.register();
    const first = await start(client, token, "compaction-existing-key");
    const initial = first.structuredContent as { operation_id: string };
    const [request] = await f.broker.nextToolBatch(token);
    const control = {
      content: [{ type: "text", text: "fixture-compaction-handoff" }],
      structuredContent: { compaction_required: true },
    };
    f.broker.requestCompaction(token, control);
    expect((await start(client, token, "compaction-existing-key")).structuredContent).toEqual(first.structuredContent);
    expect((await start(client, token, "compaction-existing-key", { secret: "changed" })).isError).toBe(true);
    const fresh = await start(client, token, "compaction-new-key");
    expect(fresh.content).toEqual(control.content);
    expect(fresh.structuredContent).toEqual(control.structuredContent);
    expect(fresh.structuredContent).not.toHaveProperty("operation_id");
    f.broker.completeTool(token, request!.callId, {
      content: [{ type: "text", text: "original-tool-result" }],
    });
    const retry = await start(client, token, "compaction-existing-key");
    const terminal = retry.structuredContent as { operation_id: string; delivery_id: string };
    expect(terminal).toMatchObject({ operation_id: initial.operation_id, state: "completed" });
    expect(JSON.stringify(retry.content)).toContain("original-tool-result");
    const discovered = await call(client, "codex_tool_status", { turn_token: token });
    expect(JSON.stringify(discovered)).not.toContain("delivery_id");
    const polled = await call(client, "codex_tool_poll", {
      turn_token: token, operation_id: terminal.operation_id, wait_ms: 0,
    });
    expect(JSON.stringify(polled.content)).toContain("original-tool-result");
    const delivery = polled.structuredContent as { delivery_id: string };
    expect(delivery.delivery_id).toBe(terminal.delivery_id);
    await call(client, "codex_tool_poll", {
      turn_token: token, operation_id: terminal.operation_id, wait_ms: 0, ack_delivery_id: delivery.delivery_id,
    });
    expect((await start(client, token, "compaction-existing-key")).structuredContent)
      .toEqual({ operation_id: initial.operation_id, state: "acknowledged" });
    expect((await call(client, "codex_tool_status", { turn_token: token })).structuredContent).toEqual({
      operations: [{ operation_id: initial.operation_id, state: "acknowledged", acknowledgement_required: false }],
      limit: 64, truncated: false,
    });
    expect(f.broker.beginCompletionFence(token)).toHaveProperty("revision");
    expect(f.broker.compactionDeliveryCount(token)).toBe(1);
  } finally {
    await f.close();
  }
}, 15_000);
