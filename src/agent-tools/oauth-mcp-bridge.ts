import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute } from "node:path";
import { z } from "zod";
import { readRequestBodyBytes } from "../http-body";
import { oauthMcpScopeSchema, oauthMcpInvocationSchema, oauthMcpDescriptorSchema, oauthMcpOutcomeSchema, type OAuthMcpBridge } from './oauth-mcp-types';

const descriptorSchema = z.object({ version: z.literal(1), kind: z.literal("nekodex-agent-oauth-mcp"), profile: z.enum(["production", "development"]),
  pid: z.number().int().positive(), instanceId: z.string().uuid(), createdAt: z.string().datetime(),
  control: z.object({ endpoint: z.string().max(128), token: z.string().regex(/^[A-Za-z0-9_-]{40,256}$/) }).strict() }).strict();
type Descriptor = z.infer<typeof descriptorSchema>;
export interface LauncherOAuthMcpBridgeOptions {
  /** Trusted exact core/runtime/launcher-agent-oauth-mcp.json; never model or renderer input. */
  descriptorPath: string;
  expectedProfile: "production" | "development";
  fetch?: typeof fetch;
  /** Ends observation only. Main retains any operation already offered. */
  requestWaitMs?: number;
}
function readDescriptor(options: LauncherOAuthMcpBridgeOptions): Descriptor {
  const file = options.descriptorPath, directory = dirname(file);
  if (!isAbsolute(file) || basename(file) !== "launcher-agent-oauth-mcp.json" || basename(directory) !== "runtime"
    || realpathSync(file) !== file || realpathSync(directory) !== directory) throw new Error("OAuth MCP launcher descriptor is not canonical");
  const parent = lstatSync(directory);
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o077) !== 0
    || typeof process.getuid === "function" && parent.uid !== process.getuid()) throw new Error("OAuth MCP launcher directory is not private");
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > 8192 || (before.mode & 0o077) !== 0
      || typeof process.getuid === "function" && before.uid !== process.getuid()) throw new Error("OAuth MCP launcher descriptor is not private");
    const buffer = Buffer.alloc(8193); let count = 0;
    while (count < buffer.length) { const size = readSync(fd, buffer, count, buffer.length - count, null); if (!size) break; count += size; }
    const after = fstatSync(fd), current = lstatSync(file);
    if (count > 8192 || after.ino !== before.ino || after.dev !== before.dev || after.mtimeMs !== before.mtimeMs
      || after.ctimeMs !== before.ctimeMs || current.ino !== before.ino || current.dev !== before.dev || current.isSymbolicLink()
      || realpathSync(directory) !== directory) throw new Error("OAuth MCP launcher descriptor changed");
    const value = descriptorSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, count))));
    const endpoint = new URL(value.control.endpoint);
    if (value.profile !== options.expectedProfile || endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" || !endpoint.port
      || endpoint.username || endpoint.password || endpoint.pathname !== "/" || endpoint.search || endpoint.hash) throw new Error("OAuth MCP launcher descriptor scope differs");
    try { process.kill(value.pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EPERM") throw new Error("OAuth MCP launcher is absent"); }
    return value;
  } finally { closeSync(fd); }
}

/** Fixed private main bridge. Credentials never enter core; submitted effects are never retried. */
export function createLauncherOAuthMcpBridge(options: LauncherOAuthMcpBridgeOptions): OAuthMcpBridge {
  const waitMs = options.requestWaitMs ?? 35_000;
  if (!Number.isSafeInteger(waitMs) || waitMs < 1 || waitMs > 60_000) throw new Error('Invalid OAuth MCP observation bound');
  const offered = new Set<string>();
  async function post(action: string, body: unknown) {
    const source = readDescriptor(options), controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), waitMs);
    try {
      const response = await (options.fetch ?? fetch)(`${source.control.endpoint}/v1/agent-oauth-mcp/${action}`, {
        method: 'POST', redirect: 'error', proxy: '', signal: controller.signal,
        headers: { authorization: `Bearer ${source.control.token}`, 'content-type': 'application/json', 'x-nekodex-oauth-mcp-instance': source.instanceId }, body: JSON.stringify(body),
      });
      if (!response.ok) { void response.body?.cancel().catch(() => {}); throw new Error('OAuth MCP main observation unavailable'); }
      const bytes = await readRequestBodyBytes(new Request('http://127.0.0.1/oauth-mcp-receipt', { method: 'POST', body: response.body, signal: controller.signal }), 256 * 1024);
      return z.object({ ok: z.literal(true), instanceId: z.literal(source.instanceId), value: z.unknown() }).strict().parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))).value;
    } finally { clearTimeout(timer); }
  }
  return {
    async discover(scope) { return z.array(oauthMcpDescriptorSchema).max(64).parse(await post('discover', { scope: oauthMcpScopeSchema.parse(scope) })); },
    async execute(input) {
      const request = oauthMcpInvocationSchema.parse(input), identity = JSON.stringify(request.scope);
      if (offered.has(identity) || offered.has(request.idempotencyKey) || offered.size >= 1024) throw new Error('OAuth MCP offer consumed; reconcile retained receipt');
      offered.add(identity); offered.add(request.idempotencyKey);
      return oauthMcpOutcomeSchema.parse(await post('execute', request));
    },
    async receipt(input) { const value = await post('receipt', oauthMcpInvocationSchema.parse(input)); return value === null ? undefined : oauthMcpOutcomeSchema.parse(value); },
    async invalidate(taskId) { await post('invalidate', { taskId: oauthMcpScopeSchema.shape.taskId.parse(taskId) }); },
  };
}
