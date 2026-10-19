import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute } from "node:path";
import { z } from "zod";
import { readRequestBodyBytes } from "../http-body";
import type { ToolInvocation, ToolOutcome } from "../agent-tools/types";
import type * as Contract from "./export-contract";

const descriptorSchema = z.object({ version: z.literal(1), kind: z.literal("nekodex-agent-vm-export"), profile: z.enum(["production", "development"]),
  pid: z.number().int().positive(), instanceId: z.string().uuid(), createdAt: z.string().datetime(),
  control: z.object({ endpoint: z.string().max(128), token: z.string().regex(/^[A-Za-z0-9_-]{40,256}$/) }).strict() }).strict();
type Descriptor = z.infer<typeof descriptorSchema>;
export interface LauncherVmExportBridgeOptions {
  /** Trusted exact core/runtime/launcher-agent-vm-export.json; never model or renderer input. */
  descriptorPath: string;
  expectedProfile: "production" | "development";
  fetch?: typeof fetch;
  /** Ends observation only. Main retains any operation already offered. */
  requestWaitMs?: number;
}
function readDescriptor(options: LauncherVmExportBridgeOptions): Descriptor {
  try {
  const file = options.descriptorPath, directory = dirname(file);
  if (!isAbsolute(file) || basename(file) !== "launcher-agent-vm-export.json" || basename(directory) !== "runtime"
    || realpathSync(file) !== file || realpathSync(directory) !== directory) throw new Error("VM export launcher descriptor is not canonical");
  const parent = lstatSync(directory);
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o077) !== 0
    || typeof process.getuid === "function" && parent.uid !== process.getuid()) throw new Error("VM export launcher directory is not private");
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > 8192 || (before.mode & 0o077) !== 0
      || typeof process.getuid === "function" && before.uid !== process.getuid()) throw new Error("VM export launcher descriptor is not private");
    const buffer = Buffer.alloc(8193); let count = 0;
    while (count < buffer.length) { const size = readSync(fd, buffer, count, buffer.length - count, null); if (!size) break; count += size; }
    const after = fstatSync(fd), current = lstatSync(file);
    if (count > 8192 || after.ino !== before.ino || after.dev !== before.dev || after.mtimeMs !== before.mtimeMs
      || after.ctimeMs !== before.ctimeMs || current.ino !== before.ino || current.dev !== before.dev || current.isSymbolicLink()
      || realpathSync(directory) !== directory) throw new Error("VM export launcher descriptor changed");
    const value = descriptorSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, count))));
    const endpoint = new URL(value.control.endpoint);
    if (value.profile !== options.expectedProfile || endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" || !endpoint.port
      || endpoint.username || endpoint.password || endpoint.pathname !== "/" || endpoint.search || endpoint.hash) throw new Error("VM export launcher descriptor scope differs");
    try { process.kill(value.pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EPERM") throw new Error("VM export launcher is absent"); }
    return value;
  } finally { closeSync(fd); }
  } catch { throw new Error('VM export launcher descriptor unavailable'); }
}


const identity = z.string().min(1).max(512).regex(/^[^\u0000-\u001f]+$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const taskScope = z.object({ taskId: z.string().uuid(), generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict();
const path = z.string().min(1).max(512).regex(/^[A-Za-z0-9_.+@/-]+$/).refine(value => !value.startsWith('/') && value.split('/').every(part => part && part !== '.' && part !== '..'));
const reviewSchema = z.object({ reviewId: z.string().uuid(), reviewDigest: hash,
  scope: taskScope.extend({ familyId: z.string().uuid() }).strict(), workspaceId: z.string().uuid(), destinationPath: path,
  operationId: identity, candidatePath: path, candidateSha256: hash, bytes: z.number().int().min(0).max(16 * 1024 * 1024),
  expectedRevision: identity.nullable(), currentSha256: hash.nullable(), currentBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
}).strict() satisfies z.ZodType<Contract.VmExportReview>; // wire schema stays bound to the shared renderer/main contract
const resultSchema = z.object({ receiptId: z.string().uuid().nullable().optional(), reviewId: z.string().uuid().nullable().optional(),
  reviewDigest: hash.optional(), workspaceId: z.string().uuid().optional(), path: path.optional(), revision: identity.optional(),
  sha256: hash.optional(), bytes: z.number().int().min(0).max(16 * 1024 * 1024).optional(), ownerHeld: z.boolean().optional(), reconciled: z.boolean().optional(),
}).passthrough();
const outcomeSchema = z.object({ state: z.enum(['completed', 'failed', 'outcome_unknown']),
  reason: z.string().max(4096).optional(), result: resultSchema.optional() }).strict();
const requestSchema = z.object({ scope: taskScope.extend({ toolCallId: identity }).strict(), tool: z.literal('vm-shell/export'),
  arguments: z.object({ reviewId: z.string().uuid(), reviewDigest: hash }).strict(), idempotencyKey: identity }).strict();
const listedReceiptSchema = outcomeSchema.extend({ request: requestSchema.optional() }).strict();
export type VmExportListedReceipt = z.infer<typeof listedReceiptSchema>;
export type VmExportReview = z.infer<typeof reviewSchema>;
export type VmExportScope = z.infer<typeof taskScope>;
export type VmExportOutcome = Pick<ToolOutcome, 'state' | 'reason' | 'result'>;
export type VmExportRequest = Omit<ToolInvocation, 'grantId'>;
export interface LauncherVmExportBridge {
  list(scope: VmExportScope): Promise<{ reviews: VmExportReview[]; receipts: VmExportListedReceipt[] }>;
  execute(request: VmExportRequest): Promise<VmExportOutcome>;
  receipt(request: VmExportRequest): Promise<VmExportOutcome | undefined>;
  /** Main may reconcile its existing publication proof; this never reoffers export. */
  reconcile(request: VmExportRequest): Promise<VmExportOutcome | undefined>;
}

/** Private fixed-action bridge. It never starts a VM or retries a publication offer. */
export function createLauncherVmExportBridge(options: LauncherVmExportBridgeOptions): LauncherVmExportBridge {
  const waitMs = options.requestWaitMs ?? 50_000;
  if (!Number.isSafeInteger(waitMs) || waitMs < 1 || waitMs > 60_000) throw new Error('Invalid VM export observation wait');
  const offeredScopes = new Set<string>(), offeredKeys = new Set<string>();
  const reviews = new Map<string, { instanceId: string; taskId: string; generation: number }>();
  async function post(action: 'list' | 'execute' | 'receipt' | 'reconcile', body: unknown, expectedInstance?: string) {
    const source = readDescriptor(options);
    if (expectedInstance && source.instanceId !== expectedInstance) throw new Error('VM export launcher instance changed; no request was sent');
    const encoded = JSON.stringify(body);
    if (Buffer.byteLength(encoded) > 64 * 1024) throw new Error('VM export request exceeds its bound');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), waitMs);
    try {
      const response = await (options.fetch ?? fetch)(`${source.control.endpoint}/v1/agent-vm-export/${action}`, {
        method: 'POST', redirect: 'error', proxy: '', signal: controller.signal,
        headers: { authorization: `Bearer ${source.control.token}`, 'content-type': 'application/json', 'x-nekodex-vm-export-instance': source.instanceId }, body: encoded,
      });
      if (!response.ok) { void response.body?.cancel().catch(() => {}); throw new Error('unavailable'); }
      const bytes = await readRequestBodyBytes(new Request('http://127.0.0.1/vm-export-receipt', { method: 'POST', body: response.body, signal: controller.signal }), 224 * 1024);
      const packet = z.object({ ok: z.literal(true), instanceId: z.literal(source.instanceId), value: z.unknown() }).strict()
        .parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
      return { value: packet.value, instanceId: source.instanceId };
    } catch { throw new Error('VM export response unavailable; reconcile the exact request without replay'); }
    finally { clearTimeout(timer); }
  }
  async function outcome(action: 'execute' | 'receipt' | 'reconcile', input: VmExportRequest) {
    const request = requestSchema.parse(input);
    let instanceId: string | undefined;
    if (action === 'execute') {
      const review = reviews.get(JSON.stringify([request.arguments.reviewId, request.arguments.reviewDigest]));
      if (!review || review.taskId !== request.scope.taskId || review.generation !== request.scope.generation) throw new Error('VM export requires a listed exact review');
      instanceId = review.instanceId;
      const scopeKey = JSON.stringify([request.scope.taskId, request.scope.generation, request.scope.toolCallId]);
      if (offeredScopes.has(scopeKey) || offeredKeys.has(request.idempotencyKey) || offeredKeys.size >= 512) throw new Error('VM export offer already consumed or capacity reached; reconcile without replay');
      // Consume before any asynchronous boundary, including descriptor/transport failure.
      offeredScopes.add(scopeKey); offeredKeys.add(request.idempotencyKey);
    }
    const response = await post(action, request, instanceId);
    if (response.value === null && action !== 'execute') return undefined;
    const parsed = outcomeSchema.parse(response.value);
    if (parsed.result?.reviewId != null && parsed.result.reviewId !== request.arguments.reviewId
      || parsed.result?.reviewDigest != null && parsed.result.reviewDigest !== request.arguments.reviewDigest) throw new Error('VM export receipt differs');
    return parsed;
  }
  return {
    async list(input) {
      const scope = taskScope.parse(input), response = await post('list', scope);
      const result = z.object({ reviews: z.array(reviewSchema).max(64), receipts: z.array(listedReceiptSchema).max(64) }).strict().parse(response.value);
      if (result.reviews.some(review => review.scope.taskId !== scope.taskId || review.scope.generation !== scope.generation)) throw new Error('VM export review scope differs');
      if (result.receipts.some(receipt => receipt.request && (receipt.request.scope.taskId !== scope.taskId || receipt.request.scope.generation !== scope.generation
        || receipt.result?.reviewId != null && receipt.result.reviewId !== receipt.request.arguments.reviewId
        || receipt.result?.reviewDigest != null && receipt.result.reviewDigest !== receipt.request.arguments.reviewDigest))) throw new Error('VM export listed receipt scope differs');
      // One bounded snapshot per task; stale instance observations never authorize execute.
      for (const [key, review] of reviews) if (review.taskId === scope.taskId) reviews.delete(key);
      if (reviews.size + result.reviews.length > 512) throw new Error('VM export review capacity reached');
      for (const review of result.reviews) reviews.set(JSON.stringify([review.reviewId, review.reviewDigest]), { instanceId: response.instanceId, ...scope });
      return result;
    },
    async execute(request) { const result = await outcome('execute', request); if (!result) throw new Error('VM export returned no receipt'); return result; },
    receipt: request => outcome('receipt', request),
    reconcile: request => outcome('reconcile', request),
  };
}
