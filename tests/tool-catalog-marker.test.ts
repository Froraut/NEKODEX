import { expect, test } from "bun:test";
import { gatewayToolCatalogPage, gatewayToolCatalogProgram } from "../src/adapters/chatgpt-web/mcp-tool-routing";

const marker = "codex-tool-catalog:abc:";
const record = `${marker}${JSON.stringify({ tools: [{ name: "shell", description: "run\ncommands" }], total: 1 })}`;

test("the catalog program tags its single record with the request marker", () => {
  expect(gatewayToolCatalogProgram({ offset: 0, limit: 5, excludedNames: [], marker })).toContain(JSON.stringify(marker));
});

test("exec status text around the catalog record does not break discovery", () => {
  const page = gatewayToolCatalogPage({ content: [{ type: "text", text: `Wall time: 0.1s\nExit code: 0\n${record}\n` }] }, new Set(), marker);
  expect(page).toEqual({ tools: [{ name: "shell", description: "run\ncommands" }], total: 1 });
});

test("unmarked or duplicated JSON is never taken as the catalog", () => {
  const unmarked = JSON.stringify({ tools: [], total: 0 });
  expect(() => gatewayToolCatalogPage({ content: [{ type: "text", text: unmarked }] }, new Set(), marker)).toThrow();
  expect(() => gatewayToolCatalogPage({ content: [{ type: "text", text: `${record}\n${record}` }] }, new Set(), marker)).toThrow();
});
