import { stdin, stdout } from "node:process";
import { parseLocalControlClientArguments } from "./client";
import { NekodexTaskMonitor } from "./task-monitor";

/** Bundled CLI entry point: no service startup, credential copying or implicit actions. */
export async function localControlTaskMonitorCommand(args: readonly string[]): Promise<boolean> {
  const usage = "Usage: codex-chatgpt-web task-monitor <snapshot|pause|reconcile> --origin http://127.0.0.1:PORT --journal-dir PATH --token-stdin; pause requires --task-id --action-id --family-id --generation --revision; reconcile requires --action-id";
  const [operation, ...rest] = args;
  if (!["snapshot", "pause", "reconcile"].includes(operation ?? "")) throw new Error(usage);
  const values = new Map<string, string>(); let piped = false;
  const allowed = new Set(["--origin", "--journal-dir", ...(operation === "pause" ? ["--task-id", "--action-id", "--family-id", "--generation", "--revision"] : operation === "reconcile" ? ["--action-id"] : [])]);
  for (let index = 0; index < rest.length; index++) {
    const name = rest[index]!;
    if (name === "--token-stdin") { if (piped) throw new Error(usage); piped = true; continue; }
    const value = rest[++index];
    if (!allowed.has(name) || values.has(name) || !value || value.startsWith("--")) throw new Error(usage);
    values.set(name, value);
  }
  if (!piped || stdin.isTTY || !values.has("--origin") || !values.has("--journal-dir")) throw new Error(usage);
  const origin = values.get("--origin")!, directory = values.get("--journal-dir")!;
  const monitor = new NekodexTaskMonitor({ cli: [process.execPath, process.argv[1]!], origin, journalDirectory: directory });
  let scope;
  if (operation === "pause") {
    const actionOptions = [...values].filter(([key]) => key !== "--journal-dir").flatMap(([key, value]) => [key, value]);
    scope = parseLocalControlClientArguments(["action", "--operation", "pause", ...actionOptions, "--token-stdin"]).action!;
  }
  const actionId = values.get("--action-id");
  if (operation === "reconcile" && (!actionId || !/^[^\u0000-\u001f\u007f]{1,128}$/u.test(actionId))) throw new Error(usage);
  const chunks: Buffer[] = []; let bytes = 0, token: string;
  try {
    for await (const chunk of stdin) { bytes += chunk.length; if (bytes > 1024) throw new Error("Credential stdin exceeds its bound"); chunks.push(Buffer.from(chunk)); }
    token = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)).replace(/\r?\n$/, "");
  } catch { throw new Error("Provide one bounded UTF-8 credential line on stdin"); }
  finally { for (const chunk of chunks) chunk.fill(0); }
  const result = operation === "snapshot" ? await monitor.snapshot(token) : operation === "pause" ? await monitor.pause(scope!, token) : await monitor.reconcile(actionId!, token);
  if (JSON.stringify(result).includes(token)) throw new Error("Unsafe monitor output");
  stdout.write(JSON.stringify(result, null, 2) + "\n");
  return "state" in result ? result.state === "completed" : [result.status, result.agentTasks, result.historyCoverage].every(value => value.ok);
}
