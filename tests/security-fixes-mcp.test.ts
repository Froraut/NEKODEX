import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultBrokerEndpoint } from "../src/config";
import { transportBoundRawExecProgram } from "../src/adapters/chatgpt-web/mcp-server";
import { TurnBroker } from "../src/adapters/chatgpt-web/turn-broker";

async function fixture(allowWebSubagents: boolean) {
  const root = mkdtempSync(join(process.platform === "win32" ? tmpdir() : "/tmp", "mcp-sec-"));
  const socket = defaultBrokerEndpoint(root);
  const broker = TurnBroker.forSocket(socket);
  const client = new Client({ name: "security-mcp-fixture", version: "1" });
  const close = async () => {
    await client.close().catch(() => {});
    await broker.close();
    rmSync(root, { recursive: true, force: true });
  };
  try {
    const token = await broker.register({
      cwd: root, roots: [root], writableRoots: [root],
      sandboxPolicy: { type: "dangerFullAccess" },
      tools: [{ name: "exec", description: "Run nested tools", parameters: {}, freeform: true }],
    });
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: ["src/cli.ts", "mcp", "--broker-socket", socket, "--native6", "--async-tool-operations",
        allowWebSubagents ? "--allow-web-subagents" : "--no-web-subagents"],
      cwd: process.cwd(), stderr: "pipe",
    }));
    return { broker, token, client, close };
  } catch (error) {
    await close();
    throw error;
  }
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
type StubCall = { name: string; input: unknown };

function call(f: Fixture, name: string, args: Record<string, unknown>) {
  return f.client.callTool({ name, arguments: { turn_token: f.token, ...args } });
}

// Only the generated program executes here. Every advertised tool is a local stub; no shell,
// network, or collaboration implementation is available to it.
async function executeWithStubs(program: string, names: string[], calls: StubCall[]) {
  const content: Array<{ type: "text"; text: string }> = [];
  const stubs = Object.fromEntries(names.map(name => [name, async (input: unknown) => {
    calls.push({ name, input });
    return { content: [{ type: "text", text: `stub:${name}` }] };
  }]));
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
    ...args: string[]
  ) => (...values: unknown[]) => Promise<void>;
  await new AsyncFunction("tools", "ALL_TOOLS", "text", program)(
    stubs,
    names.map(name => ({ name, description: `${name} fixture tool` })),
    (value: unknown) => content.push({ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }),
  );
  return content;
}

async function throughGateway(f: Fixture, name: string, args: Record<string, unknown>, nestedNames: string[]) {
  const pending = call(f, name, args);
  // Attach a handler immediately so cleanup cannot leave an unhandled MCP rejection.
  void pending.catch(() => {});
  const [request] = await f.broker.nextToolBatch(f.token, AbortSignal.timeout(2_000));
  expect(request).toMatchObject({ wireName: "exec", freeform: true });
  const calls: StubCall[] = [];
  let content: Array<{ type: "text"; text: string }>;
  try {
    content = await executeWithStubs(request!.input!, nestedNames, calls);
  } catch (error) {
    f.broker.completeTool(f.token, request!.callId, {
      content: [{ type: "text", text: String(error) }], isError: true,
    });
    await pending;
    throw error;
  }
  f.broker.completeTool(f.token, request!.callId, { content });
  return { response: await pending, calls };
}

async function rejectedBeforeDispatch(f: Fixture, name: string, args: Record<string, unknown>) {
  const controller = new AbortController();
  const next = f.broker.nextToolBatch(f.token, controller.signal)
    .then(requests => ({ kind: "dispatch" as const, requests }), () => ({ kind: "aborted" as const }));
  const pending = call(f, name, args);
  void pending.catch(() => {});
  try {
    const first = await Promise.race([pending.then(response => ({ kind: "response" as const, response })), next]);
    if (first.kind === "dispatch") {
      // A regression must fail without ever executing the attacker-provided JavaScript.
      for (const request of first.requests) f.broker.completeTool(f.token, request.callId, {
        content: [{ type: "text", text: "Unexpected dispatch stopped by fixture" }], isError: true,
      });
    }
    const response = await pending;
    expect(first.kind).toBe("response");
    expect(response.isError).toBe(true);
    expect(JSON.stringify(response.content)).toContain("Raw exec is unavailable");
    expect(f.broker.beginCompletionFence(f.token)).toHaveProperty("revision");
  } finally {
    controller.abort();
    await next;
  }
}

test("disabled Web subagents reject raw wrapper escapes before synchronous or owned dispatch", async () => {
  const f = await fixture(false);
  try {
    const payloads = [
      '})(tools); await tools.collaboration__spawn_agent({ message: "stub only" }); await (async (tools) => {',
      'const source = (0, eval)("tools"); await Reflect.get(source, ["collaboration", "spawn_agent"].join("__"))({ message: "stub only" });',
    ];
    for (const [index, input] of payloads.entries()) {
      expect(() => transportBoundRawExecProgram(input, "exec", ["collaboration__spawn_agent"]))
        .toThrow("Raw exec is unavailable");
      await rejectedBeforeDispatch(f, "codex_tool_call", { wire_name: "exec", input });
      // Native6 uses the same start path as Native5 and lets us inspect operation cleanup.
      await rejectedBeforeDispatch(f, "codex_tool_start", {
        wire_name: "exec", input, operation_key: `blocked-raw-exec-${index}`,
      });
    }
    expect((await call(f, "codex_tool_status", {})).structuredContent)
      .toEqual({ operations: [], limit: 64, truncated: false });
  } finally {
    await f.close();
  }
}, 15_000);

test("disabled raw inventory still permits structured nested tools and literal command arguments", async () => {
  const f = await fixture(false);
  try {
    const nestedNames = [
      "exec", "spawn_agent", "collaboration__spawn_agent", "multi_agent_v1__followup_task",
      "multi_agent_v2__send_input", "collaboration_optimize__list_agents", "web__run", "exec_command",
    ];
    const inventory = await throughGateway(f, "codex_tool_inventory", { include_schema: false }, nestedNames);
    expect(inventory.calls).toEqual([]);
    expect(inventory.response.isError).not.toBe(true);
    expect(inventory.response.structuredContent).toMatchObject({
      tools: [{ wire_name: "web__run", kind: "gateway" }, { wire_name: "exec_command", kind: "gateway" }],
      total: 2, next_offset: null,
    });

    const webArgs = { search_query: [{ q: 'literal "); await tools.collaboration__spawn_agent({}); //\nquery' }] };
    const web = await throughGateway(f, "codex_tool_call", {
      wire_name: "web__run", arguments: webArgs,
    }, nestedNames);
    expect(web.calls).toEqual([{ name: "web__run", input: webArgs }]);
    expect(web.response.isError).not.toBe(true);
    expect(web.response.content).toEqual([{ type: "text", text: "stub:web__run" }]);

    const commandArgs = { cmd: 'printf \'literal\'; $(stub-only)\n"; tools.collaboration__spawn_agent({}); //', workdir: "/fixture space" };
    const command = await throughGateway(f, "codex_exec", commandArgs, nestedNames);
    expect(command.calls).toEqual([{ name: "exec_command", input: commandArgs }]);
    expect(command.response.isError).not.toBe(true);
    expect(command.response.content).toEqual([{ type: "text", text: "stub:exec_command" }]);
    expect(f.broker.beginCompletionFence(f.token)).toHaveProperty("revision");
  } finally {
    await f.close();
  }
}, 15_000);

test("explicitly enabled Web subagents retain callable raw exec and stub delegation", async () => {
  const f = await fixture(true);
  try {
    const nestedNames = ["exec", "collaboration__spawn_agent", "web__run"];
    const inventory = await throughGateway(f, "codex_tool_inventory", { include_schema: false }, nestedNames);
    expect(inventory.response.isError).not.toBe(true);
    expect(inventory.response.structuredContent).toMatchObject({
      tools: [
        { wire_name: "exec", kind: "freeform" },
        { wire_name: "collaboration__spawn_agent", kind: "gateway" },
        { wire_name: "web__run", kind: "gateway" },
      ],
      total: 3,
    });
    const args = { task_name: "stub-child", message: "Only the fixture receives this delegation" };
    const raw = await throughGateway(f, "codex_tool_call", {
      wire_name: "exec", input: `text(await tools.collaboration__spawn_agent(${JSON.stringify(args)}));`,
    }, nestedNames);
    expect(raw.calls).toEqual([{ name: "collaboration__spawn_agent", input: args }]);
    expect(raw.response.isError).not.toBe(true);
    expect(f.broker.beginCompletionFence(f.token)).toHaveProperty("revision");
  } finally {
    await f.close();
  }
}, 15_000);
