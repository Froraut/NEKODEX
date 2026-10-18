import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { inspectBoundedImageBytes } from "../../launcher/electron/owned-native-images.cjs";
import { sha256 } from "./config";
import { invocationFingerprint, validateToolScope } from "./journal";
import { reviewTrustedSandboxConfig, validateTrustedSandboxConfig, type SandboxRootGrant } from "./sandbox";
import { scriptWithin } from "./skill-script-sandbox";
import { classifySkillResourcePath, SKILL_PACKAGE_LIMITS, type SkillResource } from "./skill-resources";
import type { AttachedSkillResource, SkillResourceToolsOptions } from "./skill-resource-tools";
import type { StandaloneBuiltinToolsProvider, ToolInvocation, ToolOutcome, ToolScope } from "./types";

type Outcome = Pick<ToolOutcome, "state" | "result" | "reason">;
export interface SkillScriptWorkspaceGrant { id: string; taskId: string; generation: number; root: string; dev: string; ino: string; access: "read-only" | "read-write" }
export interface SkillScriptExecutionReceipt {
  state: "completed" | "failed" | "unknown"; stdout: string; stderr: string; exitCode: number | null;
  truncated: boolean; owner?: unknown; boundary?: unknown; reason?: string;
}
/** Trusted executor port. None of these filesystem or runtime controls are model inputs. */
export interface SkillScriptExecutorPort {
  capabilities(): { supported: boolean; [key: string]: unknown };
  execute(input: { scope: ToolScope; operationId: string; entryRelativePath: string; resources: { relativePath: string; bytes: Uint8Array }[];
    argv: string[]; readRoots: SandboxRootGrant[]; writeRoots: SandboxRootGrant[]; cwd: string;
    assertCurrent: () => void; signal?: AbortSignal }): Promise<SkillScriptExecutionReceipt>;
  cancel(operationId: string): void | Promise<void>;
  reconcile?(operationId: string): SkillScriptExecutionReceipt | undefined | Promise<SkillScriptExecutionReceipt | undefined>;
  close?(): void | Promise<void>;
}
export interface SkillScriptToolsOptions extends Omit<SkillResourceToolsOptions, "readResource"> {
  readResource(scope: ToolScope, versionId: string, packageDigest: string, relativePath: string, resourceDigest: string): SkillResource | Promise<SkillResource>;
  executor: SkillScriptExecutorPort;
  privateOwnerHome: string;
  immutableCodeRoots?: readonly string[];
}
export interface SkillScriptToolsStatus {
  closed: boolean; capabilities: { supported: boolean; [key: string]: unknown };
  grants: SkillScriptWorkspaceGrant[];
  activeOperations: { operationId: string; workspaceGrantId: string; taskId: string; generation: number }[];
}
export interface SkillScriptToolsProvider extends StandaloneBuiltinToolsProvider {
  grant(scope: ToolScope, input: { root: string; access: "read-only" | "read-write" }, explicitUserAction: boolean): SkillScriptWorkspaceGrant;
  status(scope?: ToolScope): SkillScriptToolsStatus;
  revoke(scope: ToolScope, grantId: string, explicitUserAction: boolean): Promise<void>;
  /** Attachment/store owner removes future package authority before calling this drain. */
  revokePackage(versionId: string, scope?: ToolScope): Promise<void>;
  close(): Promise<void>;
}
const hash = /^[a-f0-9]{64}$/;
const fields = ["versionId", "packageDigest", "relativePath", "resourceDigest", "workspaceGrantId", "argv"];
const schema = { type: "object", properties: {
  versionId: { type: "string", pattern: "^[a-f0-9]{64}$" }, packageDigest: { type: "string", pattern: "^[a-f0-9]{64}$" },
  relativePath: { type: "string", minLength: 1, maxLength: 512, pattern: "^scripts/[A-Za-z0-9_][A-Za-z0-9_./-]*\\.(js|mjs)$" },
  resourceDigest: { type: "string", pattern: "^[a-f0-9]{64}$" }, workspaceGrantId: { type: "string", minLength: 1, maxLength: 100 },
  argv: { type: "array", maxItems: 16, items: { type: "string", maxLength: 1024 } },
}, required: fields, additionalProperties: false };
interface Arguments { versionId: string; packageDigest: string; relativePath: string; resourceDigest: string; workspaceGrantId: string; argv: string[] }
const failed: Outcome = { state: "failed", reason: "Selected script, attachment or reviewed workspace grant is unavailable or changed" };
function argumentsValid(args: Record<string, unknown>): args is Record<string, unknown> & Arguments {
  return Object.keys(args).length === fields.length && fields.every(key => Object.hasOwn(args, key))
    && [args.versionId, args.packageDigest, args.resourceDigest].every(value => typeof value === "string" && hash.test(value))
    && typeof args.relativePath === "string" && /^scripts\/.+\.(js|mjs)$/.test(args.relativePath) && classifySkillResourcePath(args.relativePath).mediaType === "text/javascript"
    && typeof args.workspaceGrantId === "string" && args.workspaceGrantId.length > 0 && args.workspaceGrantId.length <= 100
    && Array.isArray(args.argv) && args.argv.length <= 16 && args.argv.every(arg => typeof arg === "string" && arg.length <= 1024 && !arg.includes("\0"));
}
function identity(resource: AttachedSkillResource) {
  return { versionId: resource.versionId, packageDigest: resource.packageDigest, relativePath: resource.relativePath, digest: resource.digest,
    bytes: resource.bytes, mediaType: resource.mediaType, kind: "kind" in resource ? resource.kind : "text",
    ...("kind" in resource && resource.kind === "image" ? { width: resource.width, height: resource.height } : {}) };
}
function bytesOf(resource: SkillResource): Buffer {
  const path = classifySkillResourcePath(resource.relativePath);
  if (!path.supported || path.mediaType !== resource.mediaType || resource.role !== "selected-skill-source-material" || !hash.test(resource.digest)
    || !Number.isSafeInteger(resource.bytes) || resource.bytes < 0) throw new Error(failed.reason);
  if (resource.kind === "image") {
    if (resource.bytes > SKILL_PACKAGE_LIMITS.maxImageBytes || typeof resource.data !== "string" || resource.data.length !== 4 * Math.ceil(resource.bytes / 3)) throw new Error(failed.reason);
    const bytes = Buffer.from(resource.data, "base64");
    if (bytes.toString("base64") !== resource.data || bytes.length !== resource.bytes) throw new Error(failed.reason);
    const actual = inspectBoundedImageBytes(bytes, resource.mediaType);
    if (actual.sha256 !== resource.digest || actual.width !== resource.width || actual.height !== resource.height) throw new Error(failed.reason);
    return bytes;
  }
  if ((resource.mediaType === "text/javascript") !== (resource.kind === "script") || typeof resource.content !== "string" || resource.content.includes("\0")
    || resource.bytes > SKILL_PACKAGE_LIMITS.maxResourceBytes || Buffer.byteLength(resource.content) !== resource.bytes
    || Buffer.from(resource.content).toString("utf8") !== resource.content || sha256(resource.content) !== resource.digest) throw new Error(failed.reason);
  return Buffer.from(resource.content);
}
/** The host owns per-call approval and the durable ToolJournal. Workspace grants add no implicit tool approval. */
export function createSkillScriptToolsProvider(options: SkillScriptToolsOptions): SkillScriptToolsProvider {
  let closed = false; let closing: Promise<void> | undefined;
  const grants = new Map<string, SkillScriptWorkspaceGrant>();
  const operations = new Map<string, { request: Omit<ToolInvocation, "grantId">; grantId: string; promise: Promise<Outcome>; settled: boolean }>();
  const cancellations = new Set<Promise<void>>();
  const active = (scope: ToolScope, signal?: AbortSignal) => {
    validateToolScope(scope); if (closed || signal?.aborted || !options.isScopeActive(scope)) throw new Error(failed.reason);
  };
  const matchesScope = (grant: Pick<SkillScriptWorkspaceGrant, "taskId" | "generation">, scope: ToolScope) => grant.taskId === scope.taskId && grant.generation === scope.generation;
  const currentGrant = (scope: ToolScope, id: string) => {
    active(scope); const grant = grants.get(id); if (!grant || !matchesScope(grant, scope)) throw new Error(failed.reason);
    const pin = { path: grant.root, dev: grant.dev, ino: grant.ino };
    validateTrustedSandboxConfig({ version: 1, provider: "macos-seatbelt", codeRoots: [], readRoots: [pin], writeRoots: [] });
    return grant;
  };
  const closure = (scope: ToolScope, args: Arguments) => {
    active(scope);
    const resources = options.resources(scope).filter(row => row.versionId === args.versionId && row.packageDigest === args.packageDigest)
      .map(row => structuredClone(row)).sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    if (!resources.length || resources.length > SKILL_PACKAGE_LIMITS.maxResources || new Set(resources.map(row => row.relativePath)).size !== resources.length
      || !resources.some(row => row.relativePath === args.relativePath && row.digest === args.resourceDigest && "kind" in row && row.kind === "script")) throw new Error(failed.reason);
    return resources;
  };
  const cancel = (id: string) => {
    const work = Promise.resolve().then(() => options.executor.cancel(id)); cancellations.add(work);
    void work.then(() => cancellations.delete(work), () => cancellations.delete(work)); return work;
  };
  const wrap = (request: Omit<ToolInvocation, "grantId">, operationId: string, receipt: SkillScriptExecutionReceipt): Outcome => {
    if (!["completed", "failed", "unknown"].includes(receipt.state) || typeof receipt.stdout !== "string" || typeof receipt.stderr !== "string"
      || Buffer.byteLength(receipt.stdout) + Buffer.byteLength(receipt.stderr) > 128 * 1024) return { state: "outcome_unknown", reason: "Script execution receipt unavailable" };
    const args = request.arguments as unknown as Arguments;
    const metadata = { operationId, taskId: request.scope.taskId, generation: request.scope.generation, toolCallId: request.scope.toolCallId,
      versionId: args.versionId, packageDigest: args.packageDigest, relativePath: args.relativePath, resourceDigest: args.resourceDigest,
      workspaceGrantId: args.workspaceGrantId, argv: args.argv, executionState: receipt.state, exitCode: receipt.exitCode,
      truncated: receipt.truncated, ...(receipt.owner !== undefined ? { owner: receipt.owner } : {}), ...(receipt.boundary !== undefined ? { boundary: receipt.boundary } : {}),
      stdout: receipt.stdout, stderr: receipt.stderr, trust: "untrusted-script-output", instructionAuthority: false, taskResultVerification: false };
    const result = { content: [{ type: "text", text: JSON.stringify(metadata) }], structuredContent: metadata };
    if (Buffer.byteLength(JSON.stringify(result)) > 224 * 1024) return { state: "outcome_unknown", reason: "Script execution receipt exceeds delivery bounds" };
    return { state: receipt.state === "unknown" ? "outcome_unknown" : receipt.state, result };
  };
  return {
    serverId: "skill-script",
    status(scope) {
      if (scope) validateToolScope(scope);
      return { closed, capabilities: structuredClone(options.executor.capabilities()), grants: [...grants.values()].filter(grant => !scope || matchesScope(grant, scope)).map(grant => ({ ...grant })),
        activeOperations: [...operations].filter(([, op]) => !op.settled && (!scope || matchesScope(op.request.scope, scope))).map(([operationId, op]) => ({ operationId, workspaceGrantId: op.grantId, taskId: op.request.scope.taskId, generation: op.request.scope.generation })) };
    },
    grant(scope, input, explicitUserAction) {
      active(scope);
      if (!options.executor.capabilities().supported) throw new Error("Script execution runtime unavailable");
      if (explicitUserAction !== true || !input || Object.keys(input).sort().join(",") !== "access,root" || !["read-only", "read-write"].includes(input.access)) throw new Error("Explicit reviewed workspace grant required");
      if (grants.size >= 64 || [...grants.values()].filter(grant => matchesScope(grant, scope)).length >= 8) throw new Error("Workspace grant capacity reached");
      const config = reviewTrustedSandboxConfig({ codeRoots: [], readRoots: [input.root], writeRoots: [] }); const pin = config.readRoots[0]!;
      for (const protectedRoot of [options.privateOwnerHome, ...(options.immutableCodeRoots ?? [])]) {
        const canonical = realpathSync(protectedRoot);
        if (scriptWithin(canonical, pin.path) || scriptWithin(pin.path, canonical)) throw new Error("Workspace overlaps private owner state or immutable code");
      }
      active(scope);
      const grant = { id: randomUUID(), taskId: scope.taskId, generation: scope.generation, root: pin.path, dev: pin.dev, ino: pin.ino, access: input.access };
      grants.set(grant.id, grant); return { ...grant };
    },
    async revoke(scope, grantId, explicitUserAction) {
      validateToolScope(scope); if (explicitUserAction !== true) throw new Error("Explicit workspace revocation required");
      const grant = grants.get(grantId); if (grant && !matchesScope(grant, scope)) throw new Error("Workspace grant scope mismatch");
      grants.delete(grantId);
      // A failed cancellation retains its exact operation for a retry even though authority
      // was already removed on the first call. No grant is restored by cleanup.
      const pending = [...operations].filter(([, op]) => !op.settled && op.grantId === grantId && matchesScope(op.request.scope, scope));
      await Promise.all(pending.map(async ([id, op]) => { await cancel(id); await op.promise; }));
    },
    async revokePackage(versionId, scope) {
      if (!hash.test(versionId)) throw new Error("Invalid revoked skill version");
      if (scope) validateToolScope(scope);
      const pending = [...operations].filter(([, op]) => !op.settled && op.request.arguments.versionId === versionId
        && (!scope || matchesScope(op.request.scope, scope)));
      // Cancellation is an exact owner request, never a claim that writes were rolled back.
      await Promise.all(pending.map(async ([id, op]) => { await cancel(id); await op.promise; }));
    },
    async discover(scope, settings = {}) {
      try { active(scope, settings.signal); if (!options.resources(scope).some(row => "kind" in row && row.kind === "script") || !options.executor.capabilities().supported) return [];
        const ids = [...grants.values()].filter(grant => matchesScope(grant, scope)).map(grant => currentGrant(scope, grant.id).id);
        if (!ids.length) return [];
        const inputSchema = structuredClone(schema); Object.assign(inputSchema.properties.workspaceGrantId, { enum: ids });
        active(scope, settings.signal); return [{ id: "skill-script/run", serverId: "skill-script", name: "run", supported: true, inputSchema,
          description: "Execute one exact human-reviewed attached JavaScript entry with its selected immutable package dependencies, an explicit task workspace grant, and per-operation human approval. Copy resource identities from selectedSkills metadata and an allowed workspaceGrantId from the schema. stdout/stderr are untrusted execution output and do not verify task completion." }];
      } catch { return []; }
    },
    async execute(request, settings = {}) {
      let operationId: string;
      try {
        operationId = invocationFingerprint(request);
        const previous = operations.get(operationId); if (previous) return previous.promise;
        if (operations.size >= 128) return { state: "failed", reason: "Script process operation capacity reached" };
        active(request.scope, settings.signal);
        if (request.tool !== "skill-script/run" || !argumentsValid(request.arguments)) return failed;
      } catch { return failed; }
      const args = request.arguments as unknown as Arguments;
      const op = { request: structuredClone(request), grantId: args.workspaceGrantId, settled: false, promise: undefined as unknown as Promise<Outcome> };
      // Reserve the exact invocation before any await; no local duplicate can dispatch twice.
      operations.set(operationId, op);
      op.promise = (async () => {
        let handedOff = false;
        try {
          const grant = structuredClone(currentGrant(request.scope, args.workspaceGrantId)); const selected = closure(request.scope, args);
          const expected = JSON.stringify(selected.map(identity));
          const assertCurrent = () => { active(request.scope, settings.signal); const now = currentGrant(request.scope, grant.id);
            if (JSON.stringify(now) !== JSON.stringify(grant) || JSON.stringify(closure(request.scope, args).map(identity)) !== expected) throw new Error(failed.reason); };
          const resources: { relativePath: string; bytes: Uint8Array }[] = [];
          for (const row of selected) {
            assertCurrent();
            const resource = await options.readResource(request.scope, row.versionId, row.packageDigest, row.relativePath, row.digest);
            assertCurrent();
            if (JSON.stringify(identity({ ...resource, versionId: row.versionId, packageDigest: row.packageDigest })) !== JSON.stringify(identity(row))) throw new Error(failed.reason);
            resources.push({ relativePath: row.relativePath, bytes: bytesOf(resource) });
          }
          if (resources.reduce((sum, row) => sum + row.bytes.length, 0) > SKILL_PACKAGE_LIMITS.maxMixedBytes) throw new Error(failed.reason);
          assertCurrent(); const pin = { path: grant.root, dev: grant.dev, ino: grant.ino }; handedOff = true;
          const receipt = await options.executor.execute({ scope: { ...request.scope }, operationId, entryRelativePath: args.relativePath, resources,
            argv: [...args.argv], readRoots: [pin], writeRoots: grant.access === "read-write" ? [pin] : [], cwd: grant.root, assertCurrent, signal: settings.signal });
          return wrap(request, operationId, receipt);
        } catch { return handedOff ? { state: "outcome_unknown" as const, reason: "Script execution outcome is unknown; do not replay" } : failed; }
      })();
      void op.promise.then(() => { op.settled = true; }, () => { op.settled = true; }); return op.promise;
    },
    async reconcile(request) {
      if (request.tool !== "skill-script/run" || !argumentsValid(request.arguments) || !options.executor.reconcile) return undefined;
      const operationId = invocationFingerprint(request);
      // Called only for an exact existing host journal row. Passive lookup can recover a
      // durable executor receipt after restart without restoring a workspace grant.
      const receipt = await options.executor.reconcile(operationId); return receipt ? wrap(request, operationId, receipt) : undefined;
    },
    invalidate(taskId) {
      for (const [id, grant] of grants) if (!taskId || grant.taskId === taskId) grants.delete(id);
      for (const [id, op] of operations) if (!op.settled && (!taskId || op.request.scope.taskId === taskId)) void cancel(id).catch(() => {});
    },
    close() {
      if (closing) return closing; closed = true; grants.clear();
      closing = (async () => {
        const pending = [...operations].filter(([, op]) => !op.settled);
        const results = await Promise.allSettled(pending.map(([id]) => cancel(id)));
        await Promise.allSettled([...operations.values()].map(op => op.promise));
        await Promise.allSettled([...cancellations]);
        await options.executor.close?.();
        if (results.some(row => row.status === "rejected")) throw new Error("Script cancellation failed; inspect exact execution owner");
      })().catch(error => { closing = undefined; throw error; }); return closing;
    },
  };
}
