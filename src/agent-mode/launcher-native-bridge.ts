import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import { z } from "zod";
import { readRequestBodyBytes } from "../http-body";
import type { AgentModelOption } from "./provider";
import type { AgentTask } from "./types";
import { AGENT_NATIVE_OUTPUT_SCHEMA_HASH, AGENT_NATIVE_PROTOCOL, type AgentNativeBridge, type AgentNativeLookup,
  type AgentNativeOfferEnvelope, type AgentNativeReceipt } from "./native-protocol";

const identity = z.string().min(1).max(128).regex(/^[^\u0000-\u001f]+$/u);
const historySource = z.object({ sourceId: z.string().regex(/^[a-f0-9]{64}$/), profileId: z.string().uuid(),
  backendAccountId: identity.regex(/^[^\u0000-\u0020]+$/u), authEpoch: z.string().uuid() }).strict();
const model = z.object({ id: identity, admissionId: identity, provider: z.literal("owned-native"), available: z.literal(true),
  accepting: z.boolean(), label: z.string().min(1).max(200).optional(), historySource: historySource.optional(), imageInput: z.boolean().optional(), maxConcurrent: z.number().int().min(1).max(2).optional() }).strict();
const descriptor = z.object({ version: z.literal(1), kind: z.literal("nekodex-agent-native"), profile: z.enum(["production", "development"]),
  pid: z.number().int().positive(), instanceId: z.string().uuid(), control: z.object({ endpoint: z.string(), token: z.string().regex(/^[A-Za-z0-9_-]{40,}$/) }).strict(),
  protocol: z.literal(AGENT_NATIVE_PROTOCOL), outputSchemaHash: z.literal(AGENT_NATIVE_OUTPUT_SCHEMA_HASH), accepting: z.boolean(),
  models: z.array(model).max(64), capabilities: z.object({ textInput: z.literal(true), imageInput: z.boolean() }).strict(), createdAt: z.string().datetime() }).strict();
type Descriptor = z.infer<typeof descriptor>;
export interface LauncherNativeBridgeOptions {
  /** Trusted core profile path; never supplied by a task, model or renderer. */
  descriptorPath: string;
  expectedProfile: "production" | "development";
  fetch?: typeof fetch;
  requestWaitMs?: number;
}
function readDescriptor(options: LauncherNativeBridgeOptions): Descriptor {
  const file = options.descriptorPath;
  if (!isAbsolute(file) || realpathSync(file) !== file) throw new Error("Native launcher descriptor is not canonical");
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > 128 * 1024 || (before.mode & 0o077) !== 0
      || typeof process.getuid === "function" && before.uid !== process.getuid()) throw new Error("Native launcher descriptor is not private");
    const buffer = Buffer.alloc(128 * 1024 + 1); let count = 0;
    while (count < buffer.length) { const read = readSync(fd, buffer, count, buffer.length - count, null); if (!read) break; count += read; }
    const bytes = buffer.subarray(0, count);
    const after = fstatSync(fd), current = lstatSync(file);
    if (bytes.length > 128 * 1024 || after.ino !== before.ino || after.dev !== before.dev || after.mtimeMs !== before.mtimeMs
      || after.ctimeMs !== before.ctimeMs || current.ino !== before.ino || current.dev !== before.dev || current.isSymbolicLink()) throw new Error("Native launcher descriptor changed");
    const value = descriptor.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    const endpoint = new URL(value.control.endpoint);
    if (value.profile !== options.expectedProfile || endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" || !endpoint.port
      || endpoint.username || endpoint.password || endpoint.pathname !== "/" || endpoint.search || endpoint.hash) throw new Error("Native launcher descriptor scope differs");
    try { process.kill(value.pid, 0); } catch (reason) { if ((reason as NodeJS.ErrnoException).code !== "EPERM") throw new Error("Native launcher is absent"); }
    if (new Set(value.models.map(row => `${row.id}:${row.admissionId}`)).size !== value.models.length) throw new Error("Native launcher models are ambiguous");
    return value;
  } finally { closeSync(fd); }
}

/** Private HTTP observations share main's existing listener, not its Web readiness or credentials. */
export function createLauncherNativeBridge(options: LauncherNativeBridgeOptions): AgentNativeBridge & { models(): AgentModelOption[]; invalidateTask(task: AgentTask): Promise<void> } {
  const waitMs = options.requestWaitMs ?? 50_000;
  if (!Number.isSafeInteger(waitMs) || waitMs < 1 || waitMs > 60_000) throw new Error("Invalid Native bridge observation wait");
  const offered = new Map<string, Descriptor>();
  const terminal = new Set<string>();
  const selected = (actionId: string) => offered.get(actionId) ?? readDescriptor(options);
  async function post(path: "offer" | "receipt" | "wait" | "invalidate", body: AgentNativeOfferEnvelope | AgentNativeLookup | (AgentNativeLookup & { afterRevision: number }) | { actionId: string; taskId: string; familyId: string; beforeGeneration: number }, signal: AbortSignal) {
    const source = path === "offer" ? readDescriptor(options) : selected(body.actionId);
    if (path === "offer") {
      if (offered.size >= 128) for (const actionId of terminal) { offered.delete(actionId); terminal.delete(actionId); }
      if (offered.has(body.actionId) || offered.size >= 128) throw new Error("Native bridge offer already consumed or capacity reached");
      offered.set(body.actionId, source);
    }
    const abort = new AbortController();
    const stop = () => abort.abort(signal.reason);
    if (signal.aborted) stop(); else signal.addEventListener("abort", stop, { once: true });
    const timer = setTimeout(() => abort.abort(new Error("Native receipt observation wait ended")), waitMs);
    try {
      const response = await (options.fetch ?? fetch)(`${source.control.endpoint}/v1/agent-native/${path}`, {
        method: "POST", redirect: "error", proxy: "", signal: abort.signal,
        headers: { authorization: `Bearer ${source.control.token}`, "content-type": "application/json", "x-nekodex-native-instance": source.instanceId }, body: JSON.stringify(body),
      });
      if (!response.ok) { await response.body?.cancel(); throw new Error("Native launcher receipt is unavailable"); }
      const bytes = await readRequestBodyBytes(new Request("http://127.0.0.1/native-receipt", { method: "POST", body: response.body, signal: abort.signal }), 512 * 1024);
      const result = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as { ok?: unknown; value?: unknown; instanceId?: unknown };
      if (result.ok !== true || result.instanceId !== source.instanceId) throw new Error("Native launcher response scope differs");
      const receipt = result.value === null ? undefined : result.value as AgentNativeReceipt;
      if (receipt && ["completed", "failed", "not_sent"].includes(receipt.state) && receipt.ownerHeld === false) terminal.add(body.actionId);
      return receipt;
    } finally { clearTimeout(timer); signal.removeEventListener("abort", stop); }
  }
  return {
    models() {
      try { const source = readDescriptor(options); return source.models.map(row => ({ ...row, accepting: source.accepting && row.accepting })); }
      catch { return []; }
    },
    async offer(envelope, input) {
      const result = await post("offer", envelope, input.signal);
      if (!result) throw new Error("Native offer has no receipt");
      input.onReceipt(result); return result;
    },
    readReceipt: (lookup, input) => post("receipt", lookup, input.signal),
    waitReceipt: (lookup, input) => post("wait", lookup, input.signal),
    async invalidateTask(task) {
      // This only retires older generations; delayed cleanup cannot cancel new work.
      await post("invalidate", { actionId: `invalidate:${task.id}:${task.generation}`, taskId: task.id, familyId: task.familyId, beforeGeneration: task.generation }, new AbortController().signal);
    },
  };
}
