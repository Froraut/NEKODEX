import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute } from "node:path";
import { z } from "zod";
import { readRequestBodyBytes } from "../http-body";
import { remoteAgentStatusSchema, remoteScopeSchema, remoteTaskScopeSchema, remoteToolOutcomeSchema, remoteToolRequestSchema,
  type AgentRemoteBridge, type RemoteToolRequest } from "./protocol";

const descriptorSchema = z.object({ version: z.literal(1), kind: z.literal("nekodex-agent-remote"), profile: z.enum(["production", "development"]),
  pid: z.number().int().positive(), instanceId: z.string().uuid(), createdAt: z.string().datetime(),
  control: z.object({ endpoint: z.string().max(128), token: z.string().regex(/^[A-Za-z0-9_-]{40,256}$/) }).strict() }).strict();
type Descriptor = z.infer<typeof descriptorSchema>;
export interface LauncherRemoteBridgeOptions {
  /** Trusted exact core/runtime/launcher-agent-remote.json; never model or renderer input. */
  descriptorPath: string;
  expectedProfile: "production" | "development";
  fetch?: typeof fetch;
  /** Ends observation only. Main retains any operation already offered. */
  requestWaitMs?: number;
}
function readDescriptor(options: LauncherRemoteBridgeOptions): Descriptor {
  const file = options.descriptorPath, directory = dirname(file);
  if (!isAbsolute(file) || basename(file) !== "launcher-agent-remote.json" || basename(directory) !== "runtime"
    || realpathSync(file) !== file || realpathSync(directory) !== directory) throw new Error("Remote launcher descriptor is not canonical");
  const parent = lstatSync(directory);
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o077) !== 0
    || typeof process.getuid === "function" && parent.uid !== process.getuid()) throw new Error("Remote launcher directory is not private");
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > 8192 || (before.mode & 0o077) !== 0
      || typeof process.getuid === "function" && before.uid !== process.getuid()) throw new Error("Remote launcher descriptor is not private");
    const buffer = Buffer.alloc(8193); let count = 0;
    while (count < buffer.length) { const size = readSync(fd, buffer, count, buffer.length - count, null); if (!size) break; count += size; }
    const after = fstatSync(fd), current = lstatSync(file);
    if (count > 8192 || after.ino !== before.ino || after.dev !== before.dev || after.mtimeMs !== before.mtimeMs
      || after.ctimeMs !== before.ctimeMs || current.ino !== before.ino || current.dev !== before.dev || current.isSymbolicLink()
      || realpathSync(directory) !== directory) throw new Error("Remote launcher descriptor changed");
    const value = descriptorSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, count))));
    const endpoint = new URL(value.control.endpoint);
    if (value.profile !== options.expectedProfile || endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" || !endpoint.port
      || endpoint.username || endpoint.password || endpoint.pathname !== "/" || endpoint.search || endpoint.hash) throw new Error("Remote launcher descriptor scope differs");
    try { process.kill(value.pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EPERM") throw new Error("Remote launcher is absent"); }
    return value;
  } finally { closeSync(fd); }
}

/** Thin fixed-action client. It neither owns SSH nor retries a submitted effect. */
export function createLauncherRemoteBridge(options: LauncherRemoteBridgeOptions): AgentRemoteBridge {
  const waitMs = options.requestWaitMs ?? 50_000;
  if (!Number.isSafeInteger(waitMs) || waitMs < 1 || waitMs > 60_000) throw new Error("Invalid remote bridge observation wait");
  const offered = new Set<string>();
  const identity = (request: RemoteToolRequest) => JSON.stringify([request.scope.taskId, request.scope.generation, request.scope.toolCallId]);
  async function post(action: "status" | "attach" | "revoke" | "execute" | "receipt" | "invalidate", body: unknown, expectedInstance?: string) {
    const source = readDescriptor(options);
    if (expectedInstance && source.instanceId !== expectedInstance) throw new Error("Remote launcher instance changed; no request was sent");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("Remote receipt observation ended; owner is retained")), waitMs);
    try {
      const response = await (options.fetch ?? fetch)(`${source.control.endpoint}/v1/agent-remote/${action}`, {
        method: "POST", redirect: "error", proxy: "", signal: controller.signal,
        headers: { authorization: `Bearer ${source.control.token}`, "content-type": "application/json", "x-nekodex-remote-instance": source.instanceId }, body: JSON.stringify(body),
      });
      if (!response.ok) { void response.body?.cancel().catch(() => {}); throw new Error("Remote launcher response unavailable"); }
      const bytes = await readRequestBodyBytes(new Request("http://127.0.0.1/remote-receipt", { method: "POST", body: response.body, signal: controller.signal }), 192 * 1024);
      const packet = z.object({ ok: z.literal(true), instanceId: z.literal(source.instanceId), value: z.unknown() }).strict()
        .parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
      return { value: packet.value, instanceId: source.instanceId };
    } finally { clearTimeout(timer); }
  }
  async function statusAction(action: "status" | "attach" | "revoke", body: unknown) {
    const response = await post(action, body), status = remoteAgentStatusSchema.parse(response.value);
    if (status.mainInstanceId !== response.instanceId || status.bindings.some(binding => binding.mainInstanceId !== response.instanceId)) throw new Error("Remote status owner differs");
    return status;
  }
  async function outcomeAction(action: "execute" | "receipt", input: RemoteToolRequest) {
    const request = remoteToolRequestSchema.parse(input), binding = request.arguments.binding as { mainInstanceId: string };
    if (action === "execute") {
      const key = identity(request);
      if (offered.has(key) || offered.has(request.idempotencyKey) || offered.size >= 512) throw new Error("Remote offer already consumed or capacity reached; reconcile without replay");
      offered.add(key); offered.add(request.idempotencyKey);
    }
    // A restarted main can read its signed durable old-instance receipt. Only execute
    // requires the attached live instance; receipt remains a pure full-request lookup.
    const { value } = await post(action, request, action === "execute" ? binding.mainInstanceId : undefined);
    if (action === "receipt" && value === null) return undefined;
    if (Buffer.byteLength(JSON.stringify(value)) > 180 * 1024) throw new Error("Remote outcome exceeds its bound");
    const result = remoteToolOutcomeSchema.parse(value);
    if (result.idempotencyKey !== request.idempotencyKey || result.tool !== request.tool || result.scope.taskId !== request.scope.taskId
      || result.scope.generation !== request.scope.generation || result.scope.toolCallId !== request.scope.toolCallId) throw new Error("Remote receipt identity differs");
    return result;
  }
  return {
    status: scope => statusAction("status", scope ? remoteScopeSchema.parse(scope) : {}),
    attach: input => statusAction("attach", z.object({ hostId: z.string().uuid(), scope: remoteTaskScopeSchema, explicitUserAction: z.literal(true) }).strict().parse(input)),
    revoke: scope => statusAction("revoke", remoteScopeSchema.parse(scope)),
    async invalidate(input) { return (await post("invalidate", z.object({ taskId: z.string().min(1).max(200), familyId: z.string().min(1).max(200), beforeGeneration: z.number().int().positive() }).strict().parse(input))).value; },
    async execute(request) { const result = await outcomeAction("execute", request); if (!result) throw new Error("Remote execute has no receipt"); return result; },
    receipt: request => outcomeAction("receipt", request),
  };
}
