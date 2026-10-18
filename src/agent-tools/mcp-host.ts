import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, DEFAULT_INHERITED_ENV_VARS } from "@modelcontextprotocol/sdk/client/stdio.js";
import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { sha256, validateToolsConfig, verifyRecipeFiles, type ServerRecipe, type ToolsConfig } from "./config";
import { invocationFingerprint, ToolJournal, validateToolScope } from "./journal";
import type { StandaloneToolsPort, ToolDescriptor, ToolInvocation, ToolOutcome, ToolScope } from "./types";
import { mcpTerminalReference, resolveMcpTerminalEvidence } from "./evidence";
import type { AgentTask } from "../agent-mode/types";
import type { AgentEvidenceReference } from "../agent-mode/http";
import { mkdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { buildTrustedMcpSandboxLaunch, type McpSandboxBoundary } from "./sandbox";

interface Session { client: Client; transport: StdioClientTransport; tools: Map<string, { descriptor: ToolDescriptor; validate?: ValidateFunction }>; boundary?: McpSandboxBoundary }
export interface McpHostOptions {
  config: ToolsConfig;
  journalPath: string;
  /** Trusted credential owner resolves references at launch; values are never persisted here. */
  resolveSecret?: (reference: string) => Promise<string | undefined>;
  /** Trusted task owner must reject stale generations and stopped tasks on every call. */
  isScopeActive: (scope: ToolScope) => boolean;
  requestTimeoutMs?: number;
}
/** One session/owned stdio child per configured server. No client registry is read or modified. */
export class StandaloneMcpHost implements StandaloneToolsPort {
  private config: ToolsConfig;
  private sessions = new Map<string, Session>();
  private starting = new Map<string, Promise<Session>>();
  private grants = new Map<string, string>();
  private activeCalls = new Set<Promise<ToolOutcome>>();
  private journal: ToolJournal;
  private closed = false;
  private timeout: number;
  constructor(private options: McpHostOptions) {
    this.config = validateToolsConfig(options.config);
    this.journal = new ToolJournal(options.journalPath);
    this.timeout = options.requestTimeoutMs ?? 15_000;
    if (!Number.isInteger(this.timeout) || this.timeout < 10 || this.timeout > 120_000) throw new Error("Invalid MCP request timeout");
  }
  private active(scope: ToolScope): void {
    validateToolScope(scope);
    if (this.closed || !this.config.enabled || !this.options.isScopeActive(scope)) throw new Error("Standalone tool scope is unavailable");
  }
  private async start(recipe: ServerRecipe): Promise<Session> {
    const existing = this.sessions.get(recipe.id); if (existing) return existing;
    const starting = this.starting.get(recipe.id); if (starting) return starting;
    const promise = (async () => {
      verifyRecipeFiles(recipe);
      const env: Record<string, string> = {};
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
      const sandboxEnv = sandbox ? { ...Object.fromEntries(DEFAULT_INHERITED_ENV_VARS.map(name => [name, ""])), ...sandbox.env } : undefined;
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
    let descriptorBytes = 0;
    for (const recipe of this.config.servers.filter(server => server.enabled)) {
      signal.throwIfAborted();
      const session = await this.start(recipe);
      session.tools.clear();
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
            const ajv = new Ajv({ strict: true, allErrors: false }); addFormats(ajv);
            validate = ajv.compile(tool.inputSchema);
          } catch { descriptor.supported = false; descriptor.unsupportedReason = "Input schema is unsupported by the host validator"; }
          next.set(tool.name, { descriptor, validate }); descriptors.push(structuredClone(descriptor));
        }
        cursor = result.nextCursor;
        if (cursor) { if (seenCursors.has(cursor) || seenCursors.size >= 8) throw new Error("MCP discovery pagination limit"); seenCursors.add(cursor); }
      } while (cursor);
      session.tools = next;
    }
    this.active(scope);
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
  private entry(tool: string): Session["tools"] extends Map<string, infer Entry> ? Entry | undefined : never {
    const [serverId, name, extra] = tool.split("/");
    return extra ? undefined : this.sessions.get(serverId!)?.tools.get(name!);
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
    const prior = this.journal.get(request.idempotencyKey);
    if (prior) return this.journal.begin(request).outcome;
    const [serverId, name, extra] = request.tool.split("/");
    const session = this.sessions.get(serverId!); const entry = session?.tools.get(name!);
    if (extra || !session || !entry?.descriptor.supported || !entry.validate) throw new Error("Tool is undiscovered or unsupported");
    if (this.grants.get(request.grantId) !== `${fingerprint}:${JSON.stringify(entry.descriptor.inputSchema)}`) throw new Error("Exact tool invocation approval required");
    if (!entry.validate(request.arguments)) throw new Error("Tool arguments do not match the discovered schema");
    this.grants.delete(request.grantId);
    const admitted = this.journal.begin(request); if (!admitted.inserted) return admitted.outcome;
    try {
      this.active(request.scope);
      const result = await session.client.callTool({ name: name!, arguments: request.arguments }, undefined, { signal: options.signal, timeout: this.timeout, maxTotalTimeout: this.timeout });
      return this.journal.settle({ idempotencyKey: request.idempotencyKey, scope: request.scope, tool: request.tool, state: result.isError ? "failed" : "completed", result });
    } catch {
      // Timeout/cancel/connection loss does not prove that an external mutation did not occur.
      return this.journal.get(request.idempotencyKey)!;
    }
  }
  getOutcome(idempotencyKey: string): ToolOutcome | undefined { return this.journal.get(idempotencyKey); }
  terminalReference(idempotencyKey: string, requirementId: string): AgentEvidenceReference {
    const outcome = this.journal.get(idempotencyKey); if (!outcome) throw new Error("MCP result receipt missing");
    return mcpTerminalReference(outcome, requirementId);
  }
  resolveTerminalEvidence(task: AgentTask, reference: AgentEvidenceReference) {
    return resolveMcpTerminalEvidence(task, reference, sourceEventId => this.journal.getBySourceEvent(sourceEventId));
  }
  snapshot(): { enabled: boolean; servers: { id: string; connected: boolean; pid: number | null; sandbox: string; boundary?: McpSandboxBoundary }[]; sandbox: "external-server-process" } {
    return { enabled: this.config.enabled && !this.closed, servers: this.config.servers.map(server => ({ id: server.id, connected: this.sessions.has(server.id), pid: this.sessions.get(server.id)?.transport.pid ?? null, sandbox: this.sessions.get(server.id)?.boundary?.provider ?? (server.trustedSandbox ? "requested-unverified" : "user-privileged"), boundary: this.sessions.get(server.id)?.boundary })), sandbox: "external-server-process" };
  }
  async close(): Promise<void> {
    if (this.closed) return; this.closed = true; this.grants.clear();
    await Promise.allSettled([...this.starting.values()]);
    await Promise.allSettled([...this.sessions.values()].map(session => session.client.close()));
    await Promise.allSettled([...this.activeCalls]);
    this.sessions.clear(); this.journal.close();
  }
}
