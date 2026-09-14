import { expect, test } from "bun:test";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { observeMcpTransport, type McpTransportEvidence } from "../src/adapters/chatgpt-web/mcp-diagnostics";

test("MCP evidence preserves transport bytes and distinguishes SDK rejection without copying payloads", async () => {
  const evidence: McpTransportEvidence[] = [];
  const sent: unknown[] = [];
  const inner: Transport = { start: async () => {}, close: async () => {}, send: async message => { sent.push(message); } };
  const observed = observeMcpTransport(inner, new Set(["codex_tool_call"]), e => { evidence.push(e); });
  let received: unknown;
  observed.onmessage = message => { received = message; };
  await observed.start();
  const message = { jsonrpc: "2.0" as const, id: "private-request-id", method: "tools/call", params: { name: "secret-tool-name", arguments: { payload: "private contents" } } };
  inner.onmessage!(message);
  const reply = { jsonrpc: "2.0" as const, id: message.id, error: { code: -32602, message: "private validation details" } };
  await observed.send(reply);
  expect(received).toBe(message);
  expect(sent[0]).toBe(reply);
  expect(evidence.map(e => [e.phase, e.tool, e.outcome, e.code])).toEqual([
    ["received", "unrecognized", undefined, undefined], ["reply_sent", "unrecognized", "protocol_error", -32602],
  ]);
  expect(JSON.stringify(evidence)).not.toMatch(/private|secret-tool/);
  await observed.close();
});
