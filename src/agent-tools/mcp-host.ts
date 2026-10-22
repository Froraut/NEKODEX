import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, DEFAULT_INHERITED_ENV_VARS } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ValidateFunction } from "ajv";
import { compileToolInputSchema } from "./schema-validator";
import { sha256, validateToolsConfig, verifyRecipeFiles, type ServerRecipe, type ToolsConfig } from "./config";
import { invocationFingerprint, ToolJournal, validateToolScope } from "./journal";
import type { StandaloneBuiltinToolsProvider, StandaloneToolsPort, ToolDescriptor, ToolInvocation, ToolOutcome, ToolScope } from "./types";
import { mcpTerminalReference, resolveMcpTerminalEvidence } from "./evidence";
import type { AgentTask } from "../agent-mode/types";
import type { AgentEvidenceReference } from "../agent-mode/http";
import { mkdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { buildTrustedMcpSandboxLaunch, type McpSandboxBoundary } from "./sandbox";

interface ToolEntry { descriptor: ToolDescriptor; validate?: ValidateFunction; builtin?: StandaloneBuiltinToolsProvider }
interface Session { client: Client; transport: StdioClientTransport; tools: Map<string, ToolEntry>; boundary?: McpSandboxBoundary }
export interface McpHostOptions {
  config: ToolsConfig;
  journalPath: string;
  /** Trusted credential owner resolves references at launch; values are never persisted here. */
  resolveSecret?: (reference: string) => Promise<string | undefined>;
  /** Trusted task owner must reject stale generations and stopped tasks on every call. */
  isScopeActive: (scope: ToolScope) => boolean;
  requestTimeoutMs?: number;
  /** Pure built-ins share this exact approval and durable execution owner. */
  builtins?: readonly StandaloneBuiltinToolsProvider[];
}
/** One session/owned stdio child per configured server. No client registry is read or modified. */
export class StandaloneMcpHost implements StandaloneToolsPort {
  private config: ToolsConfig;
  private sessions = new Map<string, Session>();
  private starting = new Map<string, Promise<Session>>();
  private grants = new Map<string, string>();
  private activeCalls = new Set<Promise<unknown>>();
  private pendingBuiltinWork = new Set<Promise<ToolOutcome>>();
  private builtinProviders = new Map<string, StandaloneBuiltinToolsProvider>();
  private builtinEntries = new Map<string, ToolEntry>();
  private abort = new AbortController();
  private journal: ToolJournal;
  private closed = false;
  private timeout: number;
  constructor(private options: McpHostOptions) {
    this.config = validateToolsConfig(options.config);
    this.journal = new ToolJournal(options.journalPath);
    this.timeout = options.requestTimeoutMs ?? 15_000;
    if (!Number.isInteger(this.timeout) || this.timeout < 10 || this.timeout > 120_000) throw new Error("Invalid MCP request timeout");
    for (const provider of options.builtins ?? []) {
      if (!/^[a-z][a-z0-9_-]{0,39}$/.test(provider.serverId) || provider.serverId === "mcp" || this.builtinProviders.has(provider.serverId)) throw new Error("Invalid or duplicate trusted builtin tool namespace");
      this.builtinProviders.set(provider.serverId, provider);
    }
  }
  private active(scope: ToolScope): void {
    validateToolScope(scope);
    if (this.closed || !this.options.isScopeActive(scope)) throw new Error("Standalone tool scope is unavailable");
  }
  private async start(recipe: ServerRecipe): Promise<Session> {
    const existing = this.sessions.get(recipe.id); if (existing) return existing;
    const starting = this.starting.get(recipe.id); if (starting) return starting;
    const promise = (async () => {
      verifyRecipeFiles(recipe);
      const env: Record<string, string> = { ...recipe.env };
      if (recipe.trustedSandbox && Object.keys(recipe.envSecretRefs).length) throw new Error("Sandboxed MCP credential grants are unsupported");
      for (const [name, reference] of Object.entries(recipe.envSecretRefs)) {
        const value = await this.options.resolveSecret?.(reference);
        if (value === undefined) throw new Error("Required MCP credential reference is unavailable");
        env[name] = value;
      }
      if (this.closed) throw new Error("MCP host is closed");
      let sandbox: ReturnType<typeof buildTrustedMcpSandboxLaunch> | undefined;
      if (recipe.trustedSandbox) {
        const authorityHome = realpathSync(dirname(this.options.journalPath));
        const contains = (root: string, path: string) => { const rel = relative(root, path); return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`)); };
        const expectedRuntime = recipe.managedInstallation ? join(authorityHome, "agent-mcp-installs", "packages", sha256(recipe.managedInstallation.actionId)) : undefined;
        const ownedReadRoot = expectedRuntime && recipe.cwd === expectedRuntime && recipe.managedInstallation?.treeRoot === join(expectedRuntime, "node_modules") ? expectedRuntime : undefined;
        const ownedCodeRoot = ownedReadRoot ? join(ownedReadRoot, "node_modules") : undefined;
        if (recipe.trustedSandbox.writeRoots.some(root => contains(root.path, authorityHome) || contains(authorityHome, root.path)) || recipe.trustedSandbox.readRoots.some(root => root.path !== ownedReadRoot && (contains(root.path, authorityHome) || contains(authorityHome, root.path))) || recipe.trustedSandbox.codeRoots.some(root => root.path !== ownedCodeRoot && (contains(root.path, authorityHome) || contains(authorityHome, root.path)))) throw new Error("Sandbox data/code roots must not overlap tools authority metadata");
        const home = join(dirname(this.options.journalPath), "agent-tools-sandboxes", recipe.id, "home"); const tmp = join(dirname(this.options.journalPath), "agent-tools-sandboxes", recipe.id, "tmp");
        mkdirSync(home, { recursive: true, mode: 0o700 }); mkdirSync(tmp, { recursive: true, mode: 0o700 });
        sandbox = buildTrustedMcpSandboxLaunch({ config: recipe.trustedSandbox, executable: recipe.command, executableSha256: recipe.commandSha256, args: recipe.args, cwd: recipe.cwd, privateHome: realpathSync(home), privateTmp: realpathSync(tmp) });
      }
      const sandboxEnv = sandbox ? { ...Object.fromEntries(DEFAULT_INHERITED_ENV_VARS.map(name => [name, ""])), ...sandbox.env, ...env } : undefined;
      const transport = new StdioClientTransport({ command: sandbox?.command ?? recipe.command, args: sandbox?.args ?? recipe.args, env: sandboxEnv ?? env, cwd: sandbox?.cwd ?? recipe.cwd, stderr: "pipe", maxBufferSize: 512 * 1024 });
      // Drain and discard stderr. Server output may contain credentials; no diagnostics copying.
      transport.stderr?.on("data", () => {});
      const client = new Client({ name: "nekodex-standalone-tools", version: "1.0.0" }, { capabilities: {} });
      try {
        sandbox?.assertCurrent();
        await client.connect(transport, { timeout: this.timeout, maxTotalTimeout: this.timeout });
        if (this.closed) throw new Error("MCP host is closed");
        const session: Session = { client, transport, tools: new Map(), boundary: sandbox?.boundary };
        client.onclose = () => { if (this.sessions.get(recipe.id) === session) this.sessions.delete(recipe.id); };
        this.sessions.set(recipe.id, session);
        return session;
      } catch { await transport.close(); throw new Error("MCP server connection unavailable"); }
    })();
    this.starting.set(recipe.id, promise);
    try { return await promise; } finally { this.starting.delete(recipe.id); }
  }
  async discover(scope: ToolScope, options: { signal?: AbortSignal } = {}): Promise<ToolDescriptor[]> {
    this.active(scope); options.signal?.throwIfAborted();
    const signal = AbortSignal.any([AbortSignal.timeout(this.timeout), ...(options.signal ? [options.signal] : [])]);
    const descriptors: ToolDescriptor[] = [];
    // Concurrent workers build independent candidates. Only a complete, still
    // active scan may replace the lookup catalog used by approval and invoke.
    const builtinEntries = new Map<string, ToolEntry>();
    const sessionEntries = new Map<Session, Map<string, ToolEntry>>();
    let descriptorBytes = 0;
    for (const recipe of this.config.servers.filter(server => this.config.enabled && server.enabled)) {
      if (this.builtinProviders.has(recipe.id)) continue; // Never replace a configured source with a builtin alias.
      signal.throwIfAborted();
      const session = await this.start(recipe);
      let cursor: string | undefined;
      const next = new Map<string, { descriptor: ToolDescriptor; validate?: ValidateFunction }>();
      const seenCursors = new Set<string>();
      do {
        this.active(scope);
        signal.throwIfAborted();
        const result = await session.client.listTools(cursor ? { cursor } : {}, { signal, timeout: this.timeout, maxTotalTimeout: this.timeout });
        for (const tool of result.tools) {
          if (next.size >= 128 || !/^[a-zA-Z0-9_.-]{1,120}$/.test(tool.name) || next.has(tool.name)) throw new Error("MCP discovery limit or duplicate tool");
          const descriptor: ToolDescriptor = { id: `${recipe.id}/${tool.name}`, serverId: recipe.id, name: tool.name, description: tool.description?.slice(0, 4000), inputSchema: tool.inputSchema, supported: true };
          descriptorBytes += Buffer.byteLength(JSON.stringify(descriptor));
          if (descriptors.length >= 256 || descriptorBytes > 1024 * 1024) throw new Error("MCP aggregate discovery limit");
          let validate: ValidateFunction | undefined;
          try {
            if (Buffer.byteLength(JSON.stringify(tool.inputSchema)) > 64 * 1024) throw new Error("Schema too large");
            validate = compileToolInputSchema(tool.inputSchema);
            descriptor.schemaSupported = true;
          } catch { descriptor.supported = false; descriptor.schemaSupported = false; descriptor.unsupportedReason = "Input schema is unsupported by the host validator"; }
          next.set(tool.name, { descriptor, validate }); descriptors.push(structuredClone(descriptor));
        }
        cursor = result.nextCursor;
        if (cursor) { if (seenCursors.has(cursor) || seenCursors.size >= 8) throw new Error("MCP discovery pagination limit"); seenCursors.add(cursor); }
      } while (cursor);
      sessionEntries.set(session, next);
    }
    for (const provider of this.builtinProviders.values()) {
      this.active(scope); signal.throwIfAborted();
      if (this.config.servers.some(server => server.id === provider.serverId)) {
        descriptors.push({ id: `${provider.serverId}/namespace_conflict`, serverId: provider.serverId, name: "namespace_conflict", inputSchema: { type: "object", properties: {}, additionalProperties: false }, supported: false, unsupportedReason: "Reserved builtin namespace conflicts with a configured MCP server; no source was substituted" });
        continue;
      }
      const discovered = await provider.discover(scope, { signal });
      if (discovered.length > 64) throw new Error("Builtin discovery tool limit exceeded");
      for (const raw of discovered) {
        if (raw.serverId !== provider.serverId || raw.id !== `${provider.serverId}/${raw.name}` || !/^[a-zA-Z0-9_.-]{1,120}$/.test(raw.name) || builtinEntries.has(raw.id)) throw new Error("Builtin tool identity mismatch");
        const descriptor = structuredClone(raw); descriptor.description = descriptor.description?.slice(0, 4000);
        descriptorBytes += Buffer.byteLength(JSON.stringify(descriptor)); if (descriptors.length >= 256 || descriptorBytes > 1024 * 1024) throw new Error("Aggregate builtin discovery limit exceeded");
        let validate: ValidateFunction | undefined;
        try { if (Buffer.byteLength(JSON.stringify(descriptor.inputSchema)) > 64 * 1024) throw new Error("Schema too large"); validate = compileToolInputSchema(descriptor.inputSchema); descriptor.schemaSupported = true; }
        catch { descriptor.supported = false; descriptor.schemaSupported = false; descriptor.unsupportedReason = "Builtin input schema is unsupported by the host validator"; }
        builtinEntries.set(descriptor.id, { descriptor, validate, builtin: provider }); descriptors.push(descriptor);
      }
    }
    this.active(scope);
    signal.throwIfAborted();
    for (const [session, entries] of sessionEntries) session.tools = entries;
    this.builtinEntries = builtinEntries;
    return descriptors;
  }
  /** Call only after the trusted human/policy owner approved these exact arguments. */
  authorize(request: Pick<ToolInvocation, "scope" | "tool" | "arguments">): string {
    this.active(request.scope);
    const fingerprint = invocationFingerprint(request);
    const entry = this.entry(request.tool);
    if (!entry?.descriptor.supported || !entry.validate || !entry.validate(request.arguments)) throw new Error("Tool is unsupported or arguments do not match its schema");
    if (this.grants.size >= 1024) throw new Error("Outstanding tool approval limit reached");
    const grantId = crypto.randomUUID(); this.grants.set(grantId, `${fingerprint}:${JSON.stringify(entry.descriptor.inputSchema)}`); return grantId;
  }
  private entry(tool: string): ToolEntry | undefined {
    const [serverId, name, extra] = tool.split("/");
    if (extra) return undefined;
    if (this.builtinProviders.has(serverId!)) return this.builtinEntries.get(tool);
    return this.config.enabled ? this.sessions.get(serverId!)?.tools.get(name!) : undefined;
  }
  invoke(request: ToolInvocation, options: { signal?: AbortSignal } = {}): Promise<ToolOutcome> {
    const operation = this.invokeOnce(request, options); this.activeCalls.add(operation);
    void operation.then(() => this.activeCalls.delete(operation), () => this.activeCalls.delete(operation));
    return operation;
  }
  private async invokeOnce(request: ToolInvocation, options: { signal?: AbortSignal }): Promise<ToolOutcome> {
    this.active(request.scope); options.signal?.throwIfAborted();
    const fingerprint = invocationFingerprint(request);
    // Receipt reads do not authorize new execution and may be performed after grant consumption.
    const prior = this.journal.existing(request); if (prior) return prior;
    const [serverId, name, extra] = request.tool.split("/");
    const session = this.sessions.get(serverId!); const entry = this.entry(request.tool);
    if (extra || (!session && !entry?.builtin) || !entry?.descriptor.supported || !entry.validate) throw new Error("Tool is undiscovered or unsupported");
    if (this.grants.get(request.grantId) !== `${fingerprint}:${JSON.stringify(entry.descriptor.inputSchema)}`) throw new Error("Exact tool invocation approval required");
    if (!entry.validate(request.arguments)) throw new Error("Tool arguments do not match the discovered schema");
    this.grants.delete(request.grantId);
    const admitted = this.journal.begin(request, entry.builtin?.serverId ?? "mcp"); if (!admitted.inserted) return admitted.outcome;
    try {
      this.active(request.scope);
      if (entry.builtin) {
        // A transport observation wait must never become a cancellation signal for accepted input.
        const signal = AbortSignal.any([this.abort.signal, ...(options.signal ? [options.signal] : [])]);
        const work = (async () => {
          try {
            const result = await entry.builtin!.execute({ scope: request.scope, tool: request.tool, arguments: request.arguments, idempotencyKey: request.idempotencyKey }, { signal });
            if (!["completed", "failed", "outcome_unknown"].includes(result.state)) throw new Error("Builtin outcome state mismatch");
            return this.journal.settle({ idempotencyKey: request.idempotencyKey, scope: request.scope, tool: request.tool, state: result.state, result: result.result, reason: result.reason });
          } catch { return this.journal.get(request.idempotencyKey)!; }
        })();
        this.pendingBuiltinWork.add(work); void work.then(() => this.pendingBuiltinWork.delete(work), () => this.pendingBuiltinWork.delete(work));
        // An exact approved foreground handoff retains its task owner until the
        // person returns or revokes it. Recording an observation timeout here
        // would pause the task and invalidate the very scope that is waiting.
        if (entry.builtin.waitsForUser?.(request)) return await work;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try { return await Promise.race([work, new Promise<ToolOutcome>(resolve => { timer = setTimeout(() => resolve(this.journal.get(request.idempotencyKey)!), this.timeout); })]); }
        finally { if (timer) clearTimeout(timer); }
      }
      const result = await session!.client.callTool({ name: name!, arguments: request.arguments }, undefined, { signal: options.signal, timeout: this.timeout, maxTotalTimeout: this.timeout });
      return this.journal.settle({ idempotencyKey: request.idempotencyKey, scope: request.scope, tool: request.tool, state: result.isError ? "failed" : "completed", result });
    } catch {
      // Timeout/cancel/connection loss does not prove that an external mutation did not occur.
      return this.journal.get(request.idempotencyKey)!;
    }
  }
  getOutcome(idempotencyKey: string): ToolOutcome | undefined { return this.journal.get(idempotencyKey); }
  get pendingBuiltinCount(): number { return this.pendingBuiltinWork.size; }
  async waitForIdle(): Promise<void> { await Promise.allSettled([...this.activeCalls, ...this.pendingBuiltinWork]); }
  existingOutcome(request: Omit<ToolInvocation, "grantId">): ToolOutcome | undefined { return this.journal.existing(request); }
  reconcileExisting(request: Omit<ToolInvocation, "grantId">, options: { signal?: AbortSignal } = {}): Promise<ToolOutcome | undefined> {
    const operation = (async () => {
      const prior = this.journal.existing(request); if (!prior || prior.state !== "outcome_unknown") return prior;
      const provider = this.builtinProviders.get(request.tool.split("/")[0]!); if (!provider?.reconcile || this.closed) return prior;
      const terminal = await provider.reconcile(request, options);
      if (!terminal || terminal.state === "outcome_unknown") return prior;
      if (!["completed", "failed"].includes(terminal.state)) throw new Error("Builtin reconciliation outcome mismatch");
      return this.journal.settle({ idempotencyKey: prior.idempotencyKey, scope: prior.scope, tool: prior.tool, state: terminal.state, result: terminal.result, reason: terminal.reason });
    })(); this.activeCalls.add(operation); void operation.then(() => this.activeCalls.delete(operation), () => this.activeCalls.delete(operation)); return operation;
  }
  terminalReference(idempotencyKey: string, requirementId: string): AgentEvidenceReference {
    const outcome = this.journal.get(idempotencyKey); if (!outcome) throw new Error("MCP result receipt missing");
    if (this.builtinProviders.has(outcome.tool.split("/")[0]!)) throw new Error("Unsupported MCP terminal evidence source");
    return mcpTerminalReference(outcome, requirementId);
  }
  resolveTerminalEvidence(task: AgentTask, reference: AgentEvidenceReference) {
    return resolveMcpTerminalEvidence(task, reference, sourceEventId => this.journal.getBySourceEvent(sourceEventId));
  }
  snapshot(): { enabled: boolean; servers: { id: string; connected: boolean; pid: number | null; sandbox: string; boundary?: McpSandboxBoundary }[]; sandbox: "external-server-process" } {
    return { enabled: this.config.enabled && !this.closed, servers: this.config.servers.map(server => ({ id: server.id, connected: this.sessions.has(server.id), pid: this.sessions.get(server.id)?.transport.pid ?? null, sandbox: this.sessions.get(server.id)?.boundary?.provider ?? (server.trustedSandbox ? "requested-unverified" : "user-privileged"), boundary: this.sessions.get(server.id)?.boundary })), sandbox: "external-server-process" };
  }
  async close(): Promise<void> {
    if (this.closed) return; this.closed = true; this.grants.clear(); this.abort.abort();
    await Promise.allSettled([...this.starting.values()]);
    await Promise.allSettled([...this.sessions.values()].map(session => session.client.close()));
    await this.waitForIdle();
    this.sessions.clear(); this.builtinEntries.clear(); this.journal.close();
  }
}
