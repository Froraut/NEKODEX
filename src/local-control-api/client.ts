import { stdin, stdout } from "node:process";
import { Agent, request as httpRequest } from "node:http";
import { connect } from "node:net";
import { Readable } from "node:stream";
import type { ScopedAgentAction } from "./types";

type ReadOperation = "status" | "tasks" | "agent-tasks" | "history-coverage";
export interface ClientRequest { origin: string; operation: ReadOperation | "action" | "action-receipt"; limit?: number; offset?: number; action?: ScopedAgentAction }
export interface LocalControlClientResult {
  apiVersion: "1"; ok: boolean; httpStatus?: number; value?: unknown; error?: { code: string };
  actionId?: string; outcome?: "unknown";
}
export interface LocalControlClientDependencies {
  input?: AsyncIterable<Uint8Array | string>; write?: (text: string) => void;
  request?: (url: string, init: RequestInit) => Promise<Response>; timeoutMs?: number;
}
const READ_TOKEN = /^nk-read-[a-f0-9]{64}$/;
const USAGE = "Usage: codex-chatgpt-web local-api <status|tasks|agent-tasks|history-coverage|action|action-receipt> --origin http://127.0.0.1:PORT --token-stdin [--limit N --offset N]; action requires --operation --task-id --action-id --family-id --generation --revision";
const invalid = (): never => { throw new Error(USAGE); };
class CredentialInputError extends Error {}
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const identity = (value: unknown): value is string => typeof value === "string" && value.length > 0 && Buffer.byteLength(value) <= 512 && !/[\u0000-\u001f\u007f]/u.test(value);
function origin(value: string): string {
  const match = /^http:\/\/(127\.0\.0\.1|\[::1\]):([0-9]{1,5})\/?$/.exec(value);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 65535) invalid();
  return new URL(value).origin;
}
function decimal(value: string | undefined, min: number, max: number): number {
  if (value === undefined || !/^\d{1,7}$/.test(value)) invalid();
  const result = Number(value); if (result < min || result > max) invalid(); return result;
}
/** Parse only fixed routes and opaque scopes. Never reflect unknown arguments. */
export function parseLocalControlClientArguments(args: readonly string[]): ClientRequest {
  const [operation, ...rest] = args;
  if (!["status", "tasks", "agent-tasks", "history-coverage", "action", "action-receipt"].includes(operation || "")) invalid();
  const options = new Map<string, string>(); let tokenStdin = false;
  const allowed = new Set(["--origin", ...(["action", "action-receipt"].includes(operation!) ? ["--operation", "--task-id", "--action-id", "--family-id", "--generation", "--revision"] : ["tasks", "agent-tasks"].includes(operation) ? ["--limit", "--offset"] : [])]);
  for (let index = 0; index < rest.length; index++) {
    const option = rest[index];
    if (option === "--token-stdin") { if (tokenStdin) invalid(); tokenStdin = true; continue; }
    if (!allowed.has(option) || options.has(option) || index + 1 >= rest.length || rest[index + 1].startsWith("--")) invalid();
    options.set(option, rest[++index]);
  }
  if (!tokenStdin || !options.has("--origin")) invalid();
  const request: ClientRequest = { origin: origin(options.get("--origin")!), operation: operation as ClientRequest["operation"] };
  if (operation === "action" || operation === "action-receipt") {
    const taskId = options.get("--task-id"), actionId = options.get("--action-id"), familyId = options.get("--family-id"), actionOperation = options.get("--operation");
    if (![taskId, actionId, familyId].every(value => identity(value) && value!.length <= 128) || !["pause", "resume", "stop", "step", "review"].includes(actionOperation || "")) invalid();
    request.action = { taskId: taskId!, actionId: actionId!, familyId: familyId!, operation: actionOperation as ScopedAgentAction["operation"],
      generation: decimal(options.get("--generation"), 0, 1_000_000), revision: decimal(options.get("--revision"), 0, 1_000_000), explicitUserAction: true };
  } else {
    if (options.has("--limit")) request.limit = decimal(options.get("--limit"), 1, 100);
    if (options.has("--offset")) request.offset = decimal(options.get("--offset"), 0, 1_000_000);
  }
  return request;
}
async function tokenLine(input: AsyncIterable<Uint8Array | string>, administrative: boolean): Promise<string> {
  const chunks: Buffer[] = []; let bytes = 0;
  try {
    for await (const chunk of input) {
      const buffer = Buffer.from(chunk); bytes += buffer.length;
      if (bytes > 1024) throw new CredentialInputError("Credential stdin exceeds its 1 KiB bound");
      chunks.push(buffer);
    }
    let value: string;
    try { value = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)); }
    catch { throw new CredentialInputError("Credential stdin must contain one UTF-8 token line"); }
    value = value.replace(/\r?\n$/, "");
    if (administrative ? !/^[A-Za-z0-9_-]{40,512}$/.test(value) || value.startsWith("nk-read-") : !READ_TOKEN.test(value)) {
      throw new CredentialInputError(administrative ? "An administrative control credential is required on stdin" : "An nk-read credential is required on stdin");
    }
    return value;
  } catch (reason) {
    if (reason instanceof CredentialInputError) throw reason;
    throw new Error("Credential stdin could not be read safely");
  } finally { for (const chunk of chunks) chunk.fill(0); }
}
function taskMetadata(value: unknown): Record<string, unknown> {
  if (!object(value) || !identity(value.id) || !identity(value.state)) throw new Error();
  const result: Record<string, unknown> = { id: value.id, state: value.state };
  for (const key of ["kind", "mode", "familyId"]) if (value[key] !== undefined) { if (!identity(value[key])) throw new Error(); result[key] = value[key]; }
  for (const key of ["generation", "revision", "createdAt", "updatedAt"]) if (value[key] !== undefined) { if (!integer(value[key])) throw new Error(); result[key] = value[key]; }
  return result;
}
function projection(request: ClientRequest, value: unknown): unknown {
  if (!object(value)) throw new Error();
  if (request.operation === "action" || request.operation === "action-receipt") {
    if (request.operation === "action-receipt" && value.found === false && value.actionId === request.action!.actionId) return { found: false, actionId: request.action!.actionId };
    if (!object(value.task) || value.task.familyId !== request.action!.familyId) throw new Error();
    const task = taskMetadata({ ...value.task, state: value.task.status });
    if (task.id !== request.action!.taskId || !integer(task.generation) || task.generation < request.action!.generation || task.revision !== request.action!.revision) throw new Error();
    return { actionId: request.action!.actionId, operation: request.action!.operation, task,
      ...(typeof value.duplicate === "boolean" ? { duplicate: value.duplicate } : {}),
      ...(identity(value.dispatchId) ? { dispatchId: value.dispatchId } : {}) };
  }
  if (request.operation === "status") {
    if (!identity(value.version) || typeof value.ready !== "boolean" || !Array.isArray(value.permissions) || value.permissions.some(item => !identity(item))) throw new Error();
    const result: Record<string, unknown> = { version: value.version, ready: value.ready, permissions: value.permissions };
    for (const key of ["activeHttpTurns", "activeAgentTasks"]) if (value[key] !== undefined) { if (!integer(value[key])) throw new Error(); result[key] = value[key]; }
    return result;
  }
  if (request.operation === "history-coverage") {
    if (typeof value.recordingEnabled !== "boolean" || typeof value.contentAccess !== "boolean" || value.transcriptCoverage !== "unknown"
      || ![value.totalMessages, value.indexedMessages, value.incompleteMessages].every(integer)) throw new Error();
    return { recordingEnabled: value.recordingEnabled, totalMessages: value.totalMessages, indexedMessages: value.indexedMessages,
      incompleteMessages: value.incompleteMessages, transcriptCoverage: "unknown", contentAccess: value.contentAccess };
  }
  if (!Array.isArray(value.items) || value.items.length > 100 || ![value.total, value.limit, value.offset].every(integer)
    || typeof value.hasMore !== "boolean" || value.content !== "metadata-only") throw new Error();
  return { items: value.items.map(taskMetadata), total: value.total, limit: value.limit, offset: value.offset, hasMore: value.hasMore, content: "metadata-only" };
}
async function boundedResponse(response: Response): Promise<string> {
  const reader = response.body?.getReader(); if (!reader) throw new Error();
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      bytes += next.value.byteLength; if (bytes > 2 * 1024 * 1024) throw new Error(); chunks.push(next.value);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch { await reader.cancel().catch(() => {}); throw new Error(); }
  finally { reader.releaseLock(); }
}
/** A literal TCP destination and private one-shot Agent bypass proxy environment
 * routing without changing global environment or another consumer's Agent. */
export async function directLoopbackRequest(url: string, init: RequestInit): Promise<Response> {
  const target = new URL(url), hostname = target.hostname.replace(/^\[|\]$/g, ""), port = Number(target.port || "80");
  const agent = new Agent({ keepAlive: false });
  agent.createConnection = () => connect({ host: hostname, port });
  return await new Promise<Response>((resolve, reject) => {
    const headers: Record<string, string> = {}; new Headers(init.headers).forEach((value, name) => { headers[name] = value; });
    const request = httpRequest({ hostname, port, method: init.method, path: target.pathname + target.search, headers, agent, signal: init.signal ?? undefined }, response => {
      try {
        const status = response.statusCode ?? 500;
        response.once("close", () => { agent.destroy(); });
        if (status >= 300 && status < 400) throw new Error();
        const outputHeaders = new Headers();
        for (const [name, value] of Object.entries(response.headers)) if (value !== undefined) outputHeaders.set(name, Array.isArray(value) ? value.join(", ") : value);
        resolve(new Response(Readable.toWeb(response) as unknown as ReadableStream<Uint8Array>, { status, headers: outputHeaders }));
      } catch { response.destroy(); agent.destroy(); reject(new Error("Local API response unavailable")); }
    });
    request.once("error", () => { agent.destroy(); reject(new Error("Local API transport unavailable")); });
    request.end(typeof init.body === "string" ? init.body : undefined);
  });
}
/** Exactly one HTTP request. A POST failure is never an instruction to retry. */
export async function runLocalControlClient(args: readonly string[], dependencies: LocalControlClientDependencies = {}): Promise<LocalControlClientResult> {
  const request = parseLocalControlClientArguments(args);
  if (dependencies.input === undefined && stdin.isTTY) throw new Error("Pipe one credential line through stdin; interactive token entry is unavailable");
  const token = await tokenLine(dependencies.input ?? stdin, Boolean(request.action));
  if (args.some(value => value.includes(token))) throw new Error("Credentials must be supplied through stdin only");
  const timeout = dependencies.timeoutMs ?? 15000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 30000) throw new Error("Invalid local API request timeout");
  const url = new URL(request.action ? "/admin/local-control-api-action" : request.operation === "history-coverage" ? "/api/v1/history?view=coverage" : `/api/v1/${request.operation}`, request.origin);
  if (request.operation === "action-receipt") for (const [key, value] of Object.entries(request.action!)) url.searchParams.set(key, String(value));
  if (request.limit !== undefined) url.searchParams.set("limit", String(request.limit));
  if (request.offset !== undefined) url.searchParams.set("offset", String(request.offset));
  try {
    const response = await (dependencies.request ?? directLoopbackRequest)(url.href, { method: request.operation === "action" ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(timeout),
      headers: { authorization: `Bearer ${token}`, ...(request.operation === "action" ? { "content-type": "application/json" } : {}) }, ...(request.operation === "action" ? { body: JSON.stringify(request.action) } : {}) });
    const body = await boundedResponse(response);
    // Even an unexpected local server response must never echo the supplied secret.
    if (body.includes(token)) throw new Error();
    const envelope: unknown = JSON.parse(body);
    if (!object(envelope) || envelope.apiVersion !== "1" || typeof envelope.ok !== "boolean") throw new Error();
    if (request.action && (response.status === 409 || response.status >= 500)) throw new Error();
    if (!envelope.ok) {
      if (!object(envelope.error) || typeof envelope.error.code !== "string" || !/^[a-z][a-z0-9_]{0,79}$/.test(envelope.error.code)) throw new Error();
      const result: LocalControlClientResult = { apiVersion: "1", ok: false, httpStatus: response.status, error: { code: envelope.error.code }, ...(request.action ? { actionId: request.action.actionId } : {}) };
      if (JSON.stringify(result).includes(token)) throw new Error();
      return result;
    }
    if (!response.ok) throw new Error();
    const value = projection(request, envelope.value);
    if (JSON.stringify(value).includes(token)) throw new Error();
    return { apiVersion: "1", ok: true, httpStatus: response.status, value, ...(request.action ? { actionId: request.action.actionId } : {}) };
  } catch {
    return { apiVersion: "1", ok: false, error: { code: request.action ? "action_outcome_unknown" : "local_api_response_unavailable" },
      ...(request.action ? { actionId: request.action.actionId, outcome: "unknown" as const } : {}) };
  }
}
export async function localControlApiCommand(args: readonly string[], dependencies: LocalControlClientDependencies = {}): Promise<boolean> {
  const result = await runLocalControlClient(args, dependencies);
  (dependencies.write ?? (text => { stdout.write(text); }))(JSON.stringify(result, null, 2) + "\n");
  return result.ok;
}
