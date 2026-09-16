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

test("MCP evidence marks duplicate in-flight IDs ambiguous through transport closure", async () => {
  const evidence: McpTransportEvidence[] = [];
  const inner: Transport = { start: async () => {}, close: async () => {}, send: async () => {} };
  const observed = observeMcpTransport(inner, new Set(["codex_tool_call"]), e => { evidence.push(e); });
  observed.onmessage = () => {};
  await observed.start();
  const request = { jsonrpc: "2.0" as const, id: "private-duplicate-id", method: "tools/call", params: { name: "codex_tool_call", arguments: { secret: "private payload" } } };
  inner.onmessage!(request);
  inner.onmessage!(request);
  await observed.send({ jsonrpc: "2.0", id: request.id, result: { content: [] } });
  expect(evidence.map(({ phase, call, reason }) => [phase, call, reason])).toEqual([
    ["received", 1, undefined],
    ["received", 2, undefined],
    ["uncorrelated", 1, "duplicate_id"],
    ["uncorrelated", 2, "duplicate_id"],
  ]);
  inner.onclose!();
  expect(evidence.at(-1)).toMatchObject({ phase: "transport_closed", pendingCount: 1, processId: process.pid });
  expect(JSON.stringify(evidence)).not.toMatch(/private|payload/);
});
