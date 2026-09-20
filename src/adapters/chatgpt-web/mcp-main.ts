import { defaultBrokerEndpoint, resolveBrokerEndpoint } from "../../config";
import { runChatGptMcpServer, type ChatGptMcpContract } from "./mcp-server";

function option(args: string[], name: string, fallback: string): string {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1]?.trim();
  if (!value) throw new Error(`${name} requires a value`);
  args.splice(index, 2);
  return value;
}

export async function runChatGptMcpMain(args: string[]): Promise<void> {
  const remaining = [...args];
  const allow = remaining.includes("--allow-web-subagents");
  const deny = remaining.includes("--no-web-subagents");
  const native6 = remaining.includes("--native6");
  const enableAsyncToolOperations = remaining.includes("--async-tool-operations");
  const disableAsyncToolOperations = remaining.includes("--synchronous-tool-operations");
  if (allow && deny) throw new Error("Conflicting Web subagent flags");
  if (enableAsyncToolOperations && disableAsyncToolOperations) {
    throw new Error("Conflicting async tool operation flags");
  }
  for (const flag of ["--native6", "--allow-web-subagents", "--no-web-subagents", "--async-tool-operations", "--synchronous-tool-operations"]) {
    const index = remaining.indexOf(flag); if (index >= 0) remaining.splice(index, 1);
  }
  const brokerSocketPath = resolveBrokerEndpoint(option(remaining, "--broker-socket", defaultBrokerEndpoint()));
  const requestedContract = option(remaining, "--contract", "native");
  if (requestedContract !== "native" && requestedContract !== "safe") {
    throw new Error(`--contract must be native or safe, received ${requestedContract}`);
  }
  if (native6 && (!enableAsyncToolOperations || disableAsyncToolOperations || requestedContract !== "native")) {
    throw new Error("--native6 requires --async-tool-operations and --contract native");
  }
  if (remaining.length > 0) throw new Error(`Unknown MCP arguments: ${remaining.join(" ")}`);
  await runChatGptMcpServer({
    brokerSocketPath,
    allowWebSubagents: !deny,
    contract: requestedContract as ChatGptMcpContract,
    asyncToolOperations: enableAsyncToolOperations && !disableAsyncToolOperations,
    native6,
  });
}
