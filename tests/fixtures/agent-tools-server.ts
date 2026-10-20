import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const counter = process.argv[2]!;
const server = new Server({ name: "nekodex-offline-tools-fixture", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
  { name: "record", description: "Write an isolated fixture counter and return its exact value.", inputSchema: { type: "object", properties: { text: { type: "string" }, wait: { type: "boolean" } }, required: ["text"], additionalProperties: false } },
  { name: "unsupported", inputSchema: { type: "object", imaginaryKeyword: true } },
] }));
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  if (request.params.name !== "record") throw new Error("Unknown tool");
  const count = existsSync(counter) ? Number(readFileSync(counter, "utf8")) + 1 : 1;
  writeFileSync(counter, String(count));
  if (request.params.arguments?.wait) await new Promise<void>((resolve) => { extra.signal.addEventListener("abort", () => resolve(), { once: true }); });
  return { content: [{ type: "text", text: String(request.params.arguments?.text) }], structuredContent: { count, text: request.params.arguments?.text } };
});
await server.connect(new StdioServerTransport());
