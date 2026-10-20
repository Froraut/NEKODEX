import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { snapshotFile, writeFileSnapshot } from "../file-transactions";
import { parseLocalControlClientArguments, type LocalControlClientResult } from "./client";
import type { ScopedAgentAction } from "./types";

export interface TaskMonitorOptions {
  /** Exact existing bundled CLI invocation, e.g. [bun, /app/runtime/cli.js]. */
  cli: readonly string[];
  origin: string;
  journalDirectory: string;
  /** Fixture/integration seam; must run exactly once, never retry a POST. */
  invoke?: (args: readonly string[], token: string) => Promise<LocalControlClientResult>;
}
export interface TaskMonitorActionRecord {
  version: 1;
  consumer: "NekodexTaskMonitor";
  origin: string;
  action: ScopedAgentAction;
  /** unknown is published durably BEFORE invoking the CLI. */
  state: "unknown" | "completed" | "rejected";
  result?: LocalControlClientResult;
}
const actionArgs = (operation: "action" | "action-receipt", action: ScopedAgentAction) => [operation, "--operation", action.operation,
  "--task-id", action.taskId, "--action-id", action.actionId, "--family-id", action.familyId,
  "--generation", String(action.generation), "--revision", String(action.revision)];
const errorResult = (actionId: string): LocalControlClientResult => ({ apiVersion: "1", ok: false, actionId, outcome: "unknown", error: { code: "action_outcome_unknown" } });

/** A named external consumer, not an execution owner. Reads never start a service,
 * and Pause is submitted once. Reopening an interrupted record only permits GET
 * reconciliation; absence of a receipt never authorizes a second POST. */
export class NekodexTaskMonitor {
  private readonly directory: string;
  constructor(private readonly options: TaskMonitorOptions) {
    if (!options.cli.length || options.cli.some(item => typeof item !== "string" || !item || item.includes("\0"))) throw new Error("An exact bundled CLI invocation is required");
    parseLocalControlClientArguments(["status", "--origin", options.origin, "--token-stdin"]);
    this.directory = resolve(options.journalDirectory);
  }
  private args(args: string[]): string[] { return [...args, "--origin", this.options.origin, "--token-stdin"]; }
  private credential(args: string[], token: string): void {
    parseLocalControlClientArguments(args);
    if (args[0] === "action" || args[0] === "action-receipt") {
      if (!/^[A-Za-z0-9_-]{40,512}$/.test(token) || token.startsWith("nk-read-")) throw new Error("An administrative control credential is required");
    } else if (!/^nk-read-[a-f0-9]{64}$/.test(token)) throw new Error("An nk-read credential is required");
    if ([...args, ...this.options.cli, this.directory].some(value => value.includes(token))) throw new Error("Credentials must be supplied through stdin only");
  }
  private async invoke(args: string[], token: string): Promise<LocalControlClientResult> {
    this.credential(args, token);
    const result = await (this.options.invoke ?? ((input, secret) => invokeBundledLocalControlCli(this.options.cli, input, secret)))(args, token);
    if (JSON.stringify(result).includes(token)) throw new Error("Unsafe CLI response");
    return result;
  }
  /** Partial/unavailable sources stay explicit; no transcript route is requested. */
  async snapshot(readToken: string) {
    const status = await this.invoke(this.args(["status"]), readToken);
    const agentTasks = await this.invoke(this.args(["agent-tasks", "--limit", "100"]), readToken);
    const historyCoverage = await this.invoke(this.args(["history-coverage"]), readToken);
    return { consumer: "NekodexTaskMonitor" as const, content: "metadata-only" as const, status, agentTasks, historyCoverage };
  }
  private path(actionId: string): string { return join(this.directory, createHash("sha256").update(actionId).digest("hex") + ".json"); }
  private checkDirectory(create = false) {
    if (create) mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const stat = lstatSync(this.directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || process.platform !== "win32" && ((stat.mode & 0o077) !== 0 || process.getuid && stat.uid !== process.getuid())) throw new Error("Task monitor journal must be a private owned directory");
  }
  private read(actionId: string): TaskMonitorActionRecord {
    this.checkDirectory();
    const path = this.path(actionId), stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024 || process.platform !== "win32" && ((stat.mode & 0o077) !== 0 || process.getuid && stat.uid !== process.getuid())) throw new Error("Unsafe task monitor action record");
    const record = JSON.parse(readFileSync(path, "utf8")) as TaskMonitorActionRecord;
    if (record.version !== 1 || record.consumer !== "NekodexTaskMonitor" || record.origin !== this.options.origin || record.action?.actionId !== actionId || !["unknown", "completed", "rejected"].includes(record.state)) throw new Error("Invalid task monitor action record");
    parseLocalControlClientArguments(this.args(actionArgs("action", record.action)));
    return record;
  }
  /** Caller supplies exact observed scope and one stable action ID for this intent. */
  async pause(scope: Omit<ScopedAgentAction, "operation">, administrativeToken: string): Promise<TaskMonitorActionRecord> {
    // Construct the DTO explicitly: callers cannot persist extra prompt/secret fields.
    const action: ScopedAgentAction = { taskId: scope.taskId, familyId: scope.familyId, actionId: scope.actionId,
      generation: scope.generation, revision: scope.revision, explicitUserAction: scope.explicitUserAction, operation: "pause" };
    this.credential(this.args(actionArgs("action", action)), administrativeToken);
    if (action.explicitUserAction !== true) throw new Error("Explicit Pause is required");
    this.checkDirectory(true);
    const record: TaskMonitorActionRecord = { version: 1, consumer: "NekodexTaskMonitor", origin: this.options.origin, action, state: "unknown" };
    let fd: number;
    try { fd = openSync(this.path(action.actionId), "wx", 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const old = this.read(action.actionId);
      if (JSON.stringify(old.action) !== JSON.stringify(action)) throw new Error("Action identity conflict");
      return old;
    }
    try { writeFileSync(fd, JSON.stringify(record) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
    // Publish the directory entry before the external request where supported.
    if (process.platform !== "win32") {
      const directoryFd = openSync(this.directory, "r");
      try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
    }
    // A write/credential/process failure after publication conservatively remains unknown.
    let result: LocalControlClientResult;
    try { result = await this.invoke(this.args(actionArgs("action", action)), administrativeToken); }
    catch { result = errorResult(action.actionId); }
    return this.save(record, result);
  }
  async reconcile(actionId: string, administrativeToken: string): Promise<TaskMonitorActionRecord> {
    const record = this.read(actionId);
    if (record.state !== "unknown") return record;
    let result: LocalControlClientResult;
    try { result = await this.invoke(this.args(actionArgs("action-receipt", record.action)), administrativeToken); }
    catch { result = errorResult(actionId); }
    const absent = result.ok && (result.value as { found?: boolean } | undefined)?.found === false;
    return this.save(record, absent || !result.ok ? errorResult(actionId) : result);
  }
  private save(record: TaskMonitorActionRecord, result: LocalControlClientResult): TaskMonitorActionRecord {
    // Only the versioned CLI's whitelisted projection is persisted: no credentials or transcript.
    const state = result.ok ? "completed" : result.outcome === "unknown" ? "unknown" : "rejected";
    const path = this.path(record.action.actionId), before = snapshotFile(path), current = this.read(record.action.actionId);
    if (current.state !== "unknown") return current;
    const next: TaskMonitorActionRecord = { ...record, state, result };
    writeFileSnapshot(before, JSON.stringify(next) + "\n", { expectedSnapshot: before });
    return next;
  }
}

/** Spawn only the supplied existing CLI. Credentials use a pipe, never argv/env.
 * Nonzero CLI exits may carry a valid unknown receipt; stderr is never reflected. */
export async function invokeBundledLocalControlCli(cli: readonly string[], args: readonly string[], token: string): Promise<LocalControlClientResult> {
  return await new Promise((resolveResult, reject) => {
    const child = spawn(cli[0]!, [...cli.slice(1), "local-api", ...args], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const chunks: Buffer[] = []; let bytes = 0, failed = false;
    const fail = () => { failed = true; child.kill(); reject(new Error("Bundled local API CLI unavailable")); };
    const timer = setTimeout(fail, 20000);
    child.once("error", fail); child.stdin.on("error", () => {});
    child.stdout.on("data", chunk => { bytes += chunk.length; if (bytes > 2 * 1024 * 1024) fail(); else chunks.push(chunk); });
    child.stderr.resume();
    child.once("close", () => {
      clearTimeout(timer); if (failed) return;
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        if (text.includes(token)) throw new Error();
        const result = JSON.parse(text) as LocalControlClientResult;
        if (result?.apiVersion !== "1" || typeof result.ok !== "boolean") throw new Error();
        resolveResult(result);
      } catch { reject(new Error("Bundled local API CLI response unavailable")); }
    });
    child.stdin.end(token + "\n");
  });
}
