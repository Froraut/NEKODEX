import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileToolInputSchema } from "../src/agent-tools/schema-validator";
import { nativeToolValidator } from "../src/agent-mode/native-protocol";

test("strict local tool dialect selection preserves default/draft07 and 2020-12 semantics without weakening formats or unknown schemas", () => {
  const legacy = { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"], additionalProperties: false };
  for (const schema of [legacy, { ...legacy, $schema: "http://json-schema.org/draft-07/schema#" }, { ...legacy, $schema: "https://json-schema.org/draft/2020-12/schema" }]) {
    const before = JSON.stringify(schema), validate = compileToolInputSchema(schema);
    expect(validate({ path: "inert", content: "literal" })).toBe(true);
    expect(validate({ path: "inert" })).toBe(false); expect(validate({ path: "inert", content: "literal", unexpected: true })).toBe(false);
    const native = nativeToolValidator({ id: "official/write_file", inputSchema: schema });
    expect(native({ path: "inert", content: "literal" })).toBe(true); expect(native({ path: 5, content: "literal" })).toBe(false);
    expect(JSON.stringify(schema)).toBe(before);
  }
  const tuple = compileToolInputSchema({ $schema: "https://json-schema.org/draft/2020-12/schema", type: "array", prefixItems: [{ type: "string" }], minItems: 1, maxItems: 1, items: false });
  expect(tuple(["only"])).toBe(true); expect(tuple([5])).toBe(false); expect(tuple(["only", "extra"])).toBe(false);
  const email = compileToolInputSchema({ $schema: "https://json-schema.org/draft/2020-12/schema", type: "string", format: "email" });
  expect(email("fixture@example.invalid")).toBe(true); expect(email("invalid")).toBe(false);
  for (const $schema of ["http://json-schema.org/draft-07/schema#", "https://json-schema.org/draft/2020-12/schema"]) {
    const union = compileToolInputSchema({ $schema, type: "object", properties: { next: { type: ["boolean", "string"] } }, required: ["next"], additionalProperties: false });
    expect(union({ next: false })).toBe(true); expect(union({ next: "false" })).toBe(true);
    for (const input of [{ next: 0 }, { next: null }, { next: [] }, {}, { next: true, extra: true }]) expect(union(input)).toBe(false);
  }
  for (const schema of [{ ...legacy, $schema: "https://arbitrary.invalid/schema" }, { ...legacy, $schema: 7 }, { ...legacy, $schema: "http://json-schema.org/draft-04/schema#" },
    { ...legacy, unknownKeyword: true }, { $ref: "https://arbitrary.invalid/remote-schema" },
    { ...legacy, $async: true }, { ...legacy, properties: { nested: { $async: true, type: "string" } } }]) expect(() => compileToolInputSchema(schema)).toThrow();
});

const sequentialSchemaFile = process.env.NEKODEX_OFFICIAL_SEQUENTIAL_SCHEMA_FILE;
test.skipIf(!sequentialSchemaFile)("actual frozen official sequential-thinking union schema accepts only advertised input types in host and Native", () => {
  const actual = JSON.parse(readFileSync(sequentialSchemaFile!, "utf8")) as { name: string; inputSchema: Record<string, unknown> }[];
  const tool = actual.find(tool => tool.name === "sequentialthinking")!;
  expect(tool).toBeDefined(); const before = JSON.stringify(tool.inputSchema);
  const valid = { thought: "Recipe connectivity check completed.", nextThoughtNeeded: false, thoughtNumber: 1, totalThoughts: 1 };
  for (const validate of [compileToolInputSchema(tool.inputSchema), nativeToolValidator({ id: "official/sequentialthinking", inputSchema: tool.inputSchema })]) {
    expect(validate(valid)).toBe(true); expect(validate({ ...valid, nextThoughtNeeded: "false" })).toBe(true);
    for (const input of [{ ...valid, nextThoughtNeeded: 0 }, { ...valid, thoughtNumber: 0 }, { ...valid, totalThoughts: "1" }, { ...valid, thought: null }, { thought: valid.thought }]) expect(validate(input)).toBe(false);
  }
  expect(JSON.stringify(tool.inputSchema)).toBe(before);
});

const officialModule = process.env.NEKODEX_OFFICIAL_FILESYSTEM_SCHEMA_MODULE;
test.skipIf(!officialModule)("actual frozen official filesystem advertised schemas compile unchanged in host and Native without invoking tools", async () => {
  const { createServer } = await import(officialModule!);
  const allowed = realpathSync(mkdtempSync(join(tmpdir(), "nekodex-official-schema-")));
  const server = createServer([allowed]), client = new Client({ name: "nekodex-schema-dialect-proof", version: "1" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const actual = await client.listTools(); expect(actual.tools).toHaveLength(14);
    for (const tool of actual.tools) {
      expect(tool.inputSchema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
      const before = JSON.stringify(tool.inputSchema);
      expect(typeof compileToolInputSchema(tool.inputSchema)).toBe("function");
      expect(typeof nativeToolValidator({ id: `official/${tool.name}`, inputSchema: tool.inputSchema })).toBe("function");
      expect(JSON.stringify(tool.inputSchema)).toBe(before);
    }
    const write = actual.tools.find(tool => tool.name === "write_file")!;
    expect(compileToolInputSchema(write.inputSchema)({ path: "/inert/not-read", content: "not executed" })).toBe(true);
    expect(compileToolInputSchema(write.inputSchema)({ path: "/inert/not-read" })).toBe(false);
  } finally { await client.close(); await server.close(); rmSync(allowed, { recursive: true, force: true }); }
}, 5000);
