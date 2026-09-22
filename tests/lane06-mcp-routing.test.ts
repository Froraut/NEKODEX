import { expect, test } from "bun:test";
import { browserToolParameters, gatewayExcludedNames, resolveBrowserInvocation, safeVisibleTools, type McpToolRoutingPolicy } from "../src/adapters/chatgpt-web/mcp-tool-routing";
import type { ChatGptTurnEnvironment } from "../src/adapters/chatgpt-web/environment";
import type { CodexTool } from "../src/types";

const policy: McpToolRoutingPolicy = Object.freeze({ contract: "safe", allowWebSubagents: false });
const gateway: CodexTool = { name: "exec", freeform: true, description: "gateway", parameters: {} };
function environment(tools: CodexTool[]): ChatGptTurnEnvironment {
  return { cwd: "/work", roots: ["/work"], writableRoots: [], sandboxPolicy: { type: "readOnly", networkAccess: false }, tools };
}

test("lane06 routing hides inactive bridge namespaces and rebuilds exclusions from the claimed environment", () => {
  const hidden: CodexTool = { name: "codex_tool_status", namespace: "mcp__bridge", description: "not registered in safe mode", parameters: {} };
  const bound = environment([gateway, hidden]);
  expect(safeVisibleTools(bound, policy)).toEqual([]);
  expect(gatewayExcludedNames(bound, policy)).toContain("mcp__bridge__codex_tool_status");
  expect(() => resolveBrowserInvocation(policy, bound, "mcp__bridge__codex_tool_status", {}, undefined)).toThrow("not available");
  const otherTurn = environment([gateway]);
  expect(gatewayExcludedNames(otherTurn, policy)).not.toContain("mcp__bridge__codex_tool_status");
});

test("lane06 routing projects and enforces the same wait interval on direct and nested tools", () => {
  const wait: CodexTool = { name: "wait_agent", namespace: "multi_agent_v1", description: "wait", parameters: {
    type: "object", properties: { timeout_ms: { type: "number", default: 1000 } },
  } };
  expect(browserToolParameters(wait)).toMatchObject({ properties: { timeout_ms: { const: 30000 } }, required: ["timeout_ms"] });
  expect(wait.parameters).toMatchObject({ properties: { timeout_ms: { default: 1000 } } });
  for (const tools of [[wait], [gateway]]) {
    const bound = environment(tools);
    expect(() => resolveBrowserInvocation(policy, bound, "multi_agent_v1__wait_agent", { timeout_ms: 1000 }, undefined)).toThrow("timeout_ms=30000");
    const selected = resolveBrowserInvocation(policy, bound, "multi_agent_v1__wait_agent", { timeout_ms: 30000 }, undefined);
    expect(selected.tool).toBe(tools[0]);
    expect(() => resolveBrowserInvocation(policy, bound, "multi_agent_v1__wait_agent", undefined, "{}" )).toThrow();
  }
});
