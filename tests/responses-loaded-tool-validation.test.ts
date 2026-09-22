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
