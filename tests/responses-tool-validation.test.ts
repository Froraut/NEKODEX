import { expect, test } from "bun:test";
import { parseRequest } from "../src/responses/parser";

const request = (tools: unknown[]) => ({ model: "chatgpt-web/medium", input: "Use a tool", tools });

test("malformed top-level function tools cannot fall through to extension tools", () => {
  for (const tool of [
    { type: "function" },
    { type: "function", name: "lookup", parameters: "invalid-schema" },
    { type: "function", name: "" },
    { type: "function", name: "lookup", strict: "true" },
  ]) {
    expect(() => parseRequest(request([tool]))).toThrow();
  }
});

test("valid function definitions retain their parameters and optional settings", () => {
  const parameters = { type: "object", properties: { query: { type: "string" } }, required: ["query"] };
  const parsed = parseRequest(request([
    { type: "function", name: "lookup", description: "Find a record", parameters, strict: true },
    { type: "function", name: "ping" },
  ]));
  expect(parsed.context.tools).toEqual([
    { name: "lookup", description: "Find a record", parameters, strict: true },
    { name: "ping", description: "", parameters: {} },
  ]);
});

test("Responses Lite namespaces, custom tools and extension tools remain accepted", () => {
  const parsed = parseRequest(request([
    { type: "namespace", name: "functions", tools: [
      { type: "function", name: "wait", parameters: { type: "object" } },
      { type: "custom", name: "exec", format: { type: "text" } },
    ] },
    { type: "custom", name: "apply_patch", format: { type: "text" } },
    { type: "tool_search" },
    { type: "web_search_preview" },
    { type: "future_extension", option: { enabled: true } },
  ]));
  expect(parsed.context.tools?.map(tool => tool.name)).toEqual(["wait", "exec", "apply_patch", "tool_search"]);
  expect(parsed.context.tools?.find(tool => tool.name === "wait")).toEqual({
    name: "wait", description: "", parameters: { type: "object" },
  });
  for (const name of ["exec", "apply_patch"]) {
    expect(parsed.context.tools?.find(tool => tool.name === name)?.freeform).toBe(true);
  }
});
