import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * ChatGPT caches a connector's complete tools/list under its App ID, so every published connector
 * identity owns exactly one public ABI. A change to a snapshot below means the change needs a new
 * identity (for example Native7), not an in-place edit of an identity users have already created.
 */
const identities = [
  { file: "codex-native4.json", identity: "Codex Native4", flags: ["--synchronous-tool-operations"] },
  { file: "codex-native5.json", identity: "Codex Native5", flags: ["--async-tool-operations"] },
  { file: "codex-native6.json", identity: "Codex Native6", flags: ["--async-tool-operations", "--native6"] },
  { file: "codex-zero-risk4.json", identity: "Codex Zero Risk4", flags: ["--contract", "safe"] },
] as const;

const root = resolve(import.meta.dir, "..");
const snapshotDir = join(root, "docs/connector-abi");

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, entry]) => [key, canonical(entry)]));
}

async function publicAbi(flags: readonly string[], socketPath: string): Promise<string> {
  const client = new Client({ name: "nekodex-connector-abi", version: "1" });
  try {
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: ["src/cli.ts", "mcp", "--broker-socket", socketPath, ...flags],
      cwd: root,
      stderr: "pipe",
    }));
    const { tools } = await client.listTools();
    const abi = {
      instructions: client.getInstructions() ?? null,
      tools: tools.map(tool => ({
        name: tool.name,
        title: tool.title ?? null,
        description: tool.description ?? null,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema ?? null,
        annotations: tool.annotations ?? null,
      })).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0),
    };
    return `${JSON.stringify(canonical(abi), null, 2)}\n`;
  } finally {
    await client.close().catch(() => {});
  }
}

if (import.meta.main) {
  const mode = process.argv[2] ?? "--check";
  if (!["--check", "--write"].includes(mode)) throw new Error("Use --check or --write");
  // tools/list never reaches the broker; the socket only has to be a syntactically valid endpoint.
  const scratch = mkdtempSync(join(process.platform === "win32" ? tmpdir() : "/tmp", "nekodex-abi-"));
  const failures: string[] = [];
  try {
    if (mode === "--write") mkdirSync(snapshotDir, { recursive: true });
    for (const { file, identity, flags } of identities) {
      const actual = await publicAbi(flags, join(scratch, "broker.sock"));
      const path = join(snapshotDir, file);
      if (mode === "--write") {
        writeFileSync(path, actual);
        console.log(`Wrote ${identity} → docs/connector-abi/${file}`);
      } else if (!existsSync(path) || readFileSync(path, "utf8") !== actual) {
        failures.push(`${identity} (docs/connector-abi/${file})`);
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  if (failures.length > 0) {
    throw new Error(`Published connector ABI changed: ${failures.join(", ")}. A published identity must keep its exact`
      + " tools/list; add a new connector identity instead. Run bun run connector-abi:write only for an unpublished identity.");
  }
  if (mode === "--check") console.log(`Connector ABI snapshots match for ${identities.length} identities.`);
}
