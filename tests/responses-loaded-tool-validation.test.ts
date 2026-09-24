import { expect, test } from "bun:test";
import { parseRequest } from "../src/responses/parser";

test("known functions are validated across namespace and deferred tool entry points", () => {
  for (const tool of [
    { type: "function" },
    { type: "function", name: "" },
    { type: "function", name: "lookup", parameters: "invalid-schema" },
    { type: "function", name: "lookup", strict: "true" },
  ]) {
    const namespace = { type: "namespace", name: "records", tools: [tool] };
    for (const body of [
      { tools: [namespace] },
      { input: [{ type: "additional_tools", tools: [tool, namespace] }] },
      { input: [{ type: "tool_search_output", call_id: "search", tools: [namespace] }] },
    ]) {
      expect(() => parseRequest({ model: "chatgpt-web/medium", ...body })).toThrow();
    }
  }
});

test("deferred functions preserve namespace and settings alongside open extension tools", () => {
  const parameters = { type: "object", properties: { key: { type: "string" } } };
  const parsed = parseRequest({ model: "chatgpt-web/medium", input: [{
    type: "additional_tools", tools: [
      { type: "namespace", name: "records", tools: [
        { type: "function", name: "lookup", description: "Find", parameters, strict: true },
      ] },
      { type: "namespace", name: "functions", tools: [{ type: "custom", name: "exec" }] },
      { type: "future_extension", name: "extension", parameters: { vendor: true } },
    ],
  }] });
  expect(parsed.context.tools).toContainEqual({ name: "lookup", namespace: "records", description: "Find", parameters, strict: true });
  expect(parsed.context.tools).toContainEqual(expect.objectContaining({ name: "exec", freeform: true }));
  expect(parsed.context.tools).toContainEqual({ name: "extension", description: "", parameters: { vendor: true } });
});

test("tool discovery advertises only callable wire names using the same projection as tools", () => {
  const parsed = parseRequest({ model: "chatgpt-web/medium", input: [{
    type: "tool_search_output", call_id: "search", tools: [
      { type: "namespace", name: "functions", tools: [{ type: "custom", name: "exec" }] },
      { type: "namespace", name: "records", tools: [
        { type: "function", name: "lookup" },
        { type: "custom", name: "unsupported" },
      ] },
      { type: "web_search", name: "hosted" },
      { type: "tool_search" },
    ],
  }] });
  expect(parsed.context.tools?.map(tool => tool.namespace ? `${tool.namespace}.${tool.name}` : tool.name))
    .toEqual(["exec", "records.lookup", "tool_search"]);
  const result = parsed.context.messages.find(message => message.role === "toolResult");
  expect(result?.content).toBe("Tool search loaded these tools — they are now in your available tools. Call one by its EXACT name: exec, records__lookup, tool_search.");
});

test("discovery and active tools share collaboration policy with declared precedence", () => {
  const body = { model: "chatgpt-web/medium", tools: [
    { type: "function", name: "lookup", description: "declared" },
  ], input: [{ type: "tool_search_output", call_id: "search", tools: [
    { type: "function", name: "spawn_agent" },
    { type: "function", name: "lookup", description: "loaded" },
    { type: "namespace", name: "records", tools: [{ type: "function", name: "lookup" }] },
  ] }] };
  const blocked = parseRequest(body, { allowWebSubagents: false });
  expect(blocked.context.tools?.map(tool => tool.name)).toEqual(["lookup", "lookup"]);
  expect(blocked.context.tools?.[0]?.description).toBe("declared");
  expect(blocked.context.messages[0]?.content).not.toContain("spawn_agent");
  expect(blocked.context.messages[0]?.content).toContain("records__lookup");
  const enabled = parseRequest(body, { allowWebSubagents: true });
  expect(enabled.context.tools?.some(tool => tool.name === "spawn_agent")).toBe(true);
  expect(enabled.context.messages[0]?.content).toContain("spawn_agent");
});

test("blocked-only discovery does not advertise callable tools and preserves failure status", () => {
  for (const status of ["completed", "failed"]) {
    const parsed = parseRequest({ model: "chatgpt-web/medium", input: [{
      type: "tool_search_output", call_id: "search", status,
      tools: [{ type: "function", name: "spawn_agent" }],
    }] }, { allowWebSubagents: false });
    expect(parsed.context.tools).toBeUndefined();
    const result = parsed.context.messages[0];
    expect(result?.role).toBe("toolResult");
    if (result?.role !== "toolResult") throw new Error("discovery result missing");
    expect(result.content).toBe(status === "failed" ? "Tool search failed (status: failed)." : "Tool search returned no tools.");
    expect(result.isError).toBe(status === "failed");
  }
});
