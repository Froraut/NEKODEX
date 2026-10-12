import { defaultBrokerEndpoint, resolveBrokerEndpoint } from "../../config";
import { timestampMcpStderrLines } from "./mcp-diagnostics";
import { CHATGPT_WEB_MCP_SHUTDOWN_BUDGET_MS, runChatGptMcpServer, type ChatGptMcpContract,
  type ChatGptMcpServerHandle } from "./mcp-server";

function option(args: string[], name: string, fallback: string): string {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1]?.trim();
  if (!value) throw new Error(`${name} requires a value`);
  args.splice(index, 2);
  return value;
}

/**
 * A terminated MCP process cannot settle its broker leases from the request handlers, and each
 * lease would block the turn's completion fence until it expires. Release them within a short
 * budget on SIGTERM, SIGINT or a closed stdin (the client is gone), then exit.
 */
export function installMcpShutdownHandlers(
  handle: Pick<ChatGptMcpServerHandle, "releaseActivities">,
  options: {
    budgetMs?: number;
    exit?: (code: number) => void;
    processLike?: Pick<NodeJS.Process, "once"> & { stdin: Pick<NodeJS.ReadStream, "once"> };
  } = {},
): (reason: "SIGTERM" | "SIGINT" | "stdin_closed") => Promise<void> {
  const target = options.processLike ?? process;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  let shutdown: Promise<void> | undefined;
  const begin = (reason: "SIGTERM" | "SIGINT" | "stdin_closed"): Promise<void> => {
    shutdown ??= (async () => {
      console.error(`[chatgpt-web-mcp] shutdown reason=${reason}`);
      try {
        await handle.releaseActivities(options.budgetMs ?? CHATGPT_WEB_MCP_SHUTDOWN_BUDGET_MS);
      } catch (error) {
        console.error(`[chatgpt-web-mcp] shutdown lease release failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      exit(reason === "SIGTERM" ? 143 : reason === "SIGINT" ? 130 : 0);
    })();
    return shutdown;
  };
  target.once("SIGTERM", () => { void begin("SIGTERM"); });
  target.once("SIGINT", () => { void begin("SIGINT"); });
  target.stdin.once("end", () => { void begin("stdin_closed"); });
  target.stdin.once("close", () => { void begin("stdin_closed"); });
  return begin;
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
  timestampMcpStderrLines();
  const handle = await runChatGptMcpServer({
    brokerSocketPath,
    allowWebSubagents: !deny,
    contract: requestedContract as ChatGptMcpContract,
    asyncToolOperations: enableAsyncToolOperations && !disableAsyncToolOperations,
    native6,
  });
  installMcpShutdownHandlers(handle);
}
