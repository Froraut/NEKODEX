import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { existsSync, readFileSync, watch, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const [counter, release] = process.argv.slice(2) as [string, string];
const server = new Server({ name: "owned-held-tool-fixture", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: "record", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false } }] }));
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  if (request.params.name !== "record") throw new Error("Unknown fixture tool");
  const count = existsSync(counter) ? Number(readFileSync(counter, "utf8")) + 1 : 1;
  writeFileSync(counter, String(count));
  await new Promise<void>(resolve => {
    const finish = () => { watcher.close(); extra.signal.removeEventListener("abort", finish); resolve(); };
    const watcher = watch(dirname(release), () => { if (existsSync(release)) finish(); });
    extra.signal.addEventListener("abort", finish, { once: true });
    if (existsSync(release) || extra.signal.aborted) finish();
  });
  return { content: [{ type: "text", text: String(request.params.arguments?.text) }], structuredContent: { count, released: existsSync(release) } };
});
await server.connect(new StdioServerTransport());
