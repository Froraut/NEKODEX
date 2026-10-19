import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { z } from "zod";
import { Database } from "bun:sqlite";
import { defaultToolsConfig, readToolsConfig, sha256, verifyRecipeFiles, writeToolsConfig, type ServerRecipe, type ToolsConfig } from "./config";
import { StandaloneMcpHost } from "./mcp-host";
import { ReadOnlySkillLibrary, type SelectedSkill, type SkillIdentity, type SkillRootGrant } from "./skills";
import { invocationFingerprint, readExistingToolOutcome, validateToolScope } from "./journal";
import type { AgentRemoteToolsProvider } from "../remote-workspace/agent-tools";
import type { RemoteTaskScope } from "../remote-workspace/protocol";
import type { StandaloneBuiltinToolsProvider, StandaloneToolsPort, ToolDescriptor, ToolInvocation, ToolOutcome, ToolScope } from "./types";
import type { AgentBrowserToolsProvider } from "../browser-companion/agent-tools";
import type { BrowserBinding } from "../browser-companion/protocol";
import type { AgentDesktopToolsProvider } from "../browser-companion/agent-desktop-tools";
import type { MacosWindowSelection } from "../browser-companion/macos-desktop";
import type { AgentTask } from "../agent-mode/types";
import type { AgentEvidenceReference } from "../agent-mode/http";
import { createAgentToolsRoutes } from "./http";
import { readPrivateMetadata, writePrivateMetadata } from "./private-metadata";
import { ManagedMcpInstaller, OFFICIAL_MCP_CATALOG, managedMcpLaunchPlan } from "./installer";
import { reviewTrustedSandboxConfig, sandboxProviderAvailable } from "./sandbox";
import { ManagedSkillStore } from "./managed-skills";
import { createSkillResourceToolsProvider, type AttachedSkillResource, type SkillResourceToolsProvider } from "./skill-resource-tools";
import { SkillScriptExecutor } from "./skill-script-executor";
import { admitApplePythonRuntime, pythonRuntimeStatus, type AdmittedPythonRuntime } from "./skill-python-runtime";
import { SkillPythonEnvironmentStore, pythonEnvironmentPublicReason, asPythonEnvironmentPublicError, type SkillPythonEnvironmentReviewInput } from "./skill-python-environment";
import { createSkillScriptToolsProvider, type SkillScriptExecutorPort, type SkillScriptToolsProvider } from "./skill-script-tools";
import { SkillPdfExtractor, type SkillPdfExtractorPort } from "./skill-pdf-extractor";
import type { PinnedSkillPdfHelper } from "./skill-pdf-helper-path";
import { selectedPdfBytes, projectPdfExtraction, unavailablePdfProjection } from "./skill-pdf-resources";
import type { SkillResource } from "./skill-resources";
import { VmProductController } from '../execution-environments/product';
import type { VmRuntimeSelection } from '../execution-environments/executor';
import type { VmExecutorPort } from '../execution-environments/types';
import type { PythonBuildSelection } from '../execution-environments/python-build';
import type { VmNetworkGrantInput, VmNetworkScope, VmNetworkLedger, VmNetworkTransport } from '../execution-environments/network';

export interface AgentToolsCompositionOptions {
  home: string;
  authorize: (request: Request) => boolean;
  /** Local owner admission (running and attached), independent of Web broker/tunnel readiness. */
  canStart?: () => boolean;
  isScopeActive: (scope: ToolScope) => boolean;
  resolveToolCall?: (scope: ToolScope) => { tool: string; arguments: Record<string, unknown>; idempotencyKey: string } | undefined;
  /** Trusted canonical saved calls only, for exact read-only VM output recovery. */
  resolveSavedVmCalls?: (scope: Pick<ToolScope, 'taskId' | 'generation'>) => readonly Omit<ToolInvocation, 'grantId'>[];
  onOutcome?: (outcome: ToolOutcome) => void | Promise<void>;
  /** Pure browser leaf; root owns companion runtime, while this host owns approval/journal. */
  browserTools?: AgentBrowserToolsProvider;
  /** Explicit native controller; status is passive and registration never creates its helper. */
  desktopTools?: AgentDesktopToolsProvider;
  remoteTools?: AgentRemoteToolsProvider;
  oauthMcpTools?: StandaloneBuiltinToolsProvider;
  /** Other trusted pure executors (for example an independently configured desktop provider). */
  builtins?: readonly StandaloneBuiltinToolsProvider[];
  /** Trusted test/platform port; never supplied through HTTP or model arguments. */
  scriptExecutor?: SkillScriptExecutorPort;
  /** Trusted runtime admission shared by execution and environment preparation, never HTTP input. */
  pythonRuntime?: AdmittedPythonRuntime;
  /** Trusted process/helper pin or injected platform port; never accepted from HTTP/model input. */
  pdfHelper?: PinnedSkillPdfHelper;
  pdfExtractor?: SkillPdfExtractorPort;
  /** Fixed main/development artifact selection, never renderer/model paths. */
  vmRuntimeSelection?: VmRuntimeSelection;
  vmExecutor?: VmExecutorPort;
  /** Trusted deterministic owner ports only; never renderer or model values. */
  vmNetworkLedger?: VmNetworkLedger;
  vmNetworkTransport?: VmNetworkTransport;
  /** Main picker retains immutable bytes; renderer supplies only its opaque selection ID. */
  resolvePythonBuildSelection?: (selectionId: string, scope: ToolScope) => PythonBuildSelection | Promise<PythonBuildSelection>;
  vmExport?: Pick<StandaloneBuiltinToolsProvider, 'discover' | 'execute' | 'reconcile'>;
}
function ownedPdfExtractor(home: string, helper?: PinnedSkillPdfHelper): SkillPdfExtractorPort {
  let extractor: SkillPdfExtractor | undefined;
  const get = () => {
    if (!extractor) {
      const command = realpathSync(process.execPath);
      if (process.platform !== "darwin" || !/^bun(?:\.exe)?$/.test(basename(command))) throw new Error("Owned PDF extraction runtime is unavailable");
      extractor = new SkillPdfExtractor({ home, bunPath: command, bunSha256: pinnedFile(command, 512 * 1024 * 1024).sha256, helper });
    }
    return extractor;
  };
  return {
    capabilities() { try { return get().capabilities(); } catch { return { supported: false, provider: "macos-pdfkit", recoveryRequired: existsSync(join(home, "skill-pdf-runs")), extractor: { provider: "macos-pdfkit", version: 1 }, reason: "Owned PDF extraction runtime is unavailable" }; } },
    extract: input => get().extract(input),
    cancel: id => extractor?.cancel(id),
    reconcile: id => { try { return get().reconcile(id); } catch { return undefined; } },
    close: () => extractor ? extractor.close() : existsSync(join(home, "skill-pdf-runs")) ? get().close() : Promise.resolve(),
  };
}
/** Passive lazy binding to the owned Bun and an optional fixed, pinned Apple Python closure. */
function ownedScriptExecutor(home: string, getPythonRuntime: () => AdmittedPythonRuntime | undefined): SkillScriptExecutorPort {
  let executor: SkillScriptExecutor | undefined;
  const get = () => {
    if (!executor) {
      const command = realpathSync(process.execPath);
      if (process.platform !== "darwin" || !/^bun(?:\.exe)?$/.test(basename(command))) throw new Error("Restricted skill script runtime is unavailable");
      executor = new SkillScriptExecutor({ bunPath: command, bunSha256: pinnedFile(command, 512 * 1024 * 1024).sha256, home, pythonRuntime: getPythonRuntime() });
    }
    return executor;
  };
  return {
    capabilities() { try { return get().capabilities(); } catch { return { supported: false, platform: process.platform, reason: "Restricted owned Bun runtime is unavailable" }; } },
    execute: input => get().execute({ ...input, timeoutMs: 15_000, maxOutputBytes: 16_384 }),
    cancel: id => executor?.cancel(id),
    reconcile: id => { try { return get().reconcile(id); } catch { return undefined; } },
    close: () => executor ? executor.close() : existsSync(join(home, "skill-script-runs")) ? get().close() : undefined,
  };
}
const recipeInput = z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), label: z.string().min(1).max(200), version: z.string().min(1).max(100), command: z.string().min(1).max(4096), args: z.array(z.string().max(8192)).max(128), cwd: z.string().min(1).max(4096), pinnedFiles: z.array(z.string().min(1).max(4096)).max(32), sandbox: z.boolean().optional() }).strict();
const savedScope = z.object({ taskId: z.string().min(1).max(200), generation: z.number().int().positive(), toolCallId: z.string().min(1).max(200) }).strict();
const savedIdentity = z.object({ id: z.string().min(1).max(8192), grantId: z.string().min(1).max(80), relativePath: z.string().min(1).max(4096), source: z.enum(["user", "workspace", "official-plugin", "vendor-plugin"]), digest: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().nonnegative().max(512 * 1024) }).strict();
const savedSkills = z.object({ version: z.literal(1), roots: z.array(z.object({ id: z.string().uuid(), root: z.string().min(1).max(4096), source: z.literal("user"), label: z.string().min(1).max(200) }).strict()).max(16), selections: z.array(z.object({ scope: savedScope, skills: z.array(savedIdentity).max(16) }).strict()).max(64) }).strict();
type Selection = { scope: ToolScope; skills: SkillIdentity[] };
function pinnedFile(path: string, maxBytes: number) {
  const canonical = realpathSync(path); const stat = lstatSync(canonical);
  if (!stat.isFile() || stat.size > maxBytes) throw new Error("Pinned server input must be a bounded regular file");
  return { path: canonical, sha256: sha256(readFileSync(canonical)) };
}
/** Local admin composition. Merely constructing or reading status never starts a child. */
export class AgentToolsComposition {
  private host?: StandaloneMcpHost;
  private closing = false;
  private closingPromise?: Promise<void>;
  private changing = false;
  private configSettling?: Promise<void>;
  private pending = new Set<Promise<unknown>>();
  private reviews = new Map<string, { recipe: ServerRecipe; configDigest: string }>();
  private skillRoots: SkillRootGrant[] = [];
  private selections = new Map<string, Selection>();
  private descriptors: ToolDescriptor[] = [];
  private configPath: string;
  private journalPath: string;
  private skillStatePath: string;
  private managedSkillStore?: ManagedSkillStore;
  private readonly skillResourceTools: SkillResourceToolsProvider;
  private readonly skillScriptTools: SkillScriptToolsProvider;
  private readonly pythonRuntime: () => AdmittedPythonRuntime | undefined;
  private readonly pythonEnvironments: SkillPythonEnvironmentStore;
  private readonly pdfExtractor: SkillPdfExtractorPort;
  private readonly vm: VmProductController;
  readonly installer: ManagedMcpInstaller;
  readonly toolsPort: StandaloneToolsPort;
  readonly handle: (request: Request) => Promise<Response | undefined>;
  constructor(readonly options: AgentToolsCompositionOptions) {
    this.configPath = join(options.home, "agent-tools.json"); this.journalPath = join(options.home, "agent-tool-calls.sqlite");
    this.skillStatePath = join(options.home, "agent-skills.json");
    this.vm = new VmProductController({ home: options.home, runtimeSelection: options.vmRuntimeSelection,
      executor: options.vmExecutor, export: options.vmExport, networkLedger: options.vmNetworkLedger, networkTransport: options.vmNetworkTransport,
      isScopeActive: scope => !this.closing && !this.changing && this.options.canStart?.() !== false && this.options.isScopeActive(scope),
      assertMutation: explicit => this.vmMutation(explicit), assertScope: scope => this.scope(scope),
      savedCalls: scope => this.options.resolveSavedVmCalls?.(scope) ?? [],
      existingOutcome: request => this.host?.existingOutcome(request) ?? readExistingToolOutcome(this.journalPath, request) });
    let pythonRuntime = options.pythonRuntime;
    let pythonAdmissionAttempted = Boolean(pythonRuntime);
    this.pythonRuntime = () => {
      if (!pythonAdmissionAttempted) {
        pythonAdmissionAttempted = true;
        try { pythonRuntime = admitApplePythonRuntime(); } catch { /* Python absence does not change JavaScript authority. */ }
      }
      return pythonRuntime;
    };
    this.pythonEnvironments = new SkillPythonEnvironmentStore({ home: join(options.home, "skill-python-environments"), getRuntime: this.pythonRuntime });
    this.pdfExtractor = options.pdfExtractor ?? ownedPdfExtractor(options.home, options.pdfHelper);
    this.skillResourceTools = createSkillResourceToolsProvider({
      isScopeActive: scope => !this.closing && !this.changing && this.options.canStart?.() !== false && this.options.isScopeActive(scope),
      resources: scope => this.attachedSkillResources(scope),
      readResource: (scope, versionId, packageDigest, path, digest) => this.managedSkills().readResource(scope, versionId, packageDigest, path, digest),
      pdfExtractor: this.pdfExtractor,
    });
    this.skillScriptTools = createSkillScriptToolsProvider({
      isScopeActive: scope => !this.closing && !this.changing && this.options.canStart?.() !== false && this.options.isScopeActive(scope),
      resources: scope => this.attachedSkillResources(scope),
      readResource: (scope, versionId, packageDigest, path, digest) => this.managedSkills().readResource(scope, versionId, packageDigest, path, digest),
      executor: options.scriptExecutor ?? ownedScriptExecutor(options.home, this.pythonRuntime), privateOwnerHome: options.home,
      resolvePythonEnvironment: environmentId => this.pythonEnvironmentControl(() => this.pythonEnvironments.admit(environmentId)),
    });
    this.installer = new ManagedMcpInstaller(options.home);
    const persisted = readPrivateMetadata(this.skillStatePath);
    if (persisted !== undefined) { const saved = savedSkills.parse(persisted); this.skillRoots = saved.roots; this.selections = new Map(saved.selections.map(row => [JSON.stringify([row.scope.taskId, row.scope.generation]), row])); }
    this.handle = createAgentToolsRoutes(this);
    this.toolsPort = {
      discover: (scope, opts) => this.track(async () => {
        this.scope(scope);
        if (!readToolsConfig(this.configPath).enabled && !this.options.browserTools && !this.options.desktopTools && !this.options.remoteTools && !this.hasSkillResourceTools() && !this.hasSkillScriptTools() && !this.hasVmShellTools([scope]) && !this.hasVmNetworkTools(scope) && !this.options.oauthMcpTools && !this.options.builtins?.length) return [];
        this.descriptors = await this.getHost().discover(scope, opts); return structuredClone(this.descriptors);
      }),
      invoke: (request, opts) => this.track(() => this.getHost().invoke(request, opts)),
    };
  }
  private scope(scope: ToolScope): void {
    validateToolScope(scope);
    if (this.closing || this.changing || this.options.canStart?.() === false || !this.options.isScopeActive(scope)) throw new Error("Current owned Agent task scope is unavailable");
  }
  private getHost(): StandaloneMcpHost {
    if (this.closing || this.changing) throw new Error("Tools host is unavailable");
    if (!this.host) {
      const config = readToolsConfig(this.configPath);
      // Existing user MCP configuration keeps its namespace; remote attachment
      // remains unavailable until that explicit collision is resolved by its owner.
      const remote = this.options.remoteTools && !config.servers.some(server => server.id === this.options.remoteTools!.serverId) ? [this.options.remoteTools] : [];
      const resources = config.servers.some(server => server.id === this.skillResourceTools.serverId) ? [] : [this.skillResourceTools];
      const scripts = config.servers.some(server => server.id === this.skillScriptTools.serverId) ? [] : [this.skillScriptTools];
      const vm = config.servers.some(server => server.id === this.vm.provider.serverId) ? [] : [this.vm.provider];
      const network = config.servers.some(server => server.id === this.vm.networkProvider.serverId) ? [] : [this.vm.networkProvider];
      this.host = new StandaloneMcpHost({ config, journalPath: this.journalPath, isScopeActive: scope => !this.closing && !this.changing && this.options.canStart?.() !== false && this.options.isScopeActive(scope), builtins: [...(this.options.builtins ?? []), ...(this.options.oauthMcpTools ? [this.options.oauthMcpTools] : []), ...(this.options.browserTools ? [this.options.browserTools] : []), ...(this.options.desktopTools ? [this.options.desktopTools] : []), ...remote, ...resources, ...scripts, ...vm, ...network] });
    }
    return this.host;
  }
  private track<T>(operation: () => Promise<T>): Promise<T> {
    const pending = operation(); this.pending.add(pending);
    void pending.then(() => this.pending.delete(pending), () => this.pending.delete(pending)); return pending;
  }
  get activeCount(): number {
    const pdf = this.pdfExtractor.capabilities();
    const heldPdf = Number.isSafeInteger(pdf.activeCount) && Number(pdf.activeCount) >= 0 ? Number(pdf.activeCount) : 0;
    return Math.max(this.pending.size, this.host?.pendingBuiltinCount ?? 0, this.options.desktopTools?.status().activeCount ?? 0,
      this.options.remoteTools?.status().activeCount ?? 0, this.skillScriptTools.status().activeOperations.length,
      this.skillResourceTools.activeCount, this.vm.provider.activeCount, this.vm.buildActiveCount, this.vm.networkStatus().activeCount, heldPdf, pdf.recoveryRequired ? 1 : 0) + (this.changing ? 1 : 0) + this.installer.activeCount;
  }
  private managedSkills() { if (this.closing) throw new Error("Managed skill store is closing"); return this.managedSkillStore ??= new ManagedSkillStore(this.options.home); }
  private managedSkillStatus() {
    if (this.managedSkillStore) return this.managedSkillStore.list();
    if (!this.closing && existsSync(join(this.options.home, "managed-skills", "metadata.sqlite"))) return this.managedSkills().list();
    return { versions: [], attachments: [], actions: [], retainedVersions: 0, forgottenVersions: 0, cleanup: "not-performed; immutable referenced versions retained" };
  }
  /** Metadata-only model catalog; image bytes require an approved resource read. */
  private attachedSkillResources(scope: ToolScope): AttachedSkillResource[] {
    this.scope(scope);
    if (!this.managedSkillStore && !existsSync(join(this.options.home, "managed-skills", "metadata.sqlite"))) return [];
    return this.managedSkills().selected(scope).flatMap(skill => {
      const versionId = skill.versionId ?? (skill.id.startsWith('managed:') ? skill.id.slice('managed:'.length) : undefined);
      if (!versionId || !skill.packageDigest) return [];
      return (skill.resources ?? []).map(resource => {
        const { role: _role, ...metadata } = resource;
        if (metadata.kind !== 'image' && metadata.kind !== 'document') { const { content: _content, ...identity } = metadata; return { ...identity, versionId, packageDigest: skill.packageDigest! }; }
        return { ...metadata, versionId, packageDigest: skill.packageDigest! };
      });
    });
  }
  hasSkillResourceTools(): boolean {
    if (this.closing || this.changing || readToolsConfig(this.configPath).servers.some(server => server.id === this.skillResourceTools.serverId)) return false;
    const state = this.managedSkillStatus();
    const versions = new Set(state.versions.filter(version => !version.revoked && !version.forgotten && (version.resourceCount ?? 0) > 0).map(version => version.versionId));
    return state.attachments.some(packet => this.options.isScopeActive(packet.scope) && packet.versionIds.some(id => versions.has(id)));
  }
  hasSkillScriptTools(): boolean {
    if (this.closing || this.changing || readToolsConfig(this.configPath).servers.some(server => server.id === this.skillScriptTools.serverId)) return false;
    return this.skillScriptTools.status().grants.some(grant => this.options.isScopeActive({ taskId: grant.taskId, generation: grant.generation, toolCallId: "script-discovery" }));
  }
  scriptStatus(scope?: ToolScope) { return this.skillScriptTools.status(scope); }
  hasVmShellTools(currentScopes: readonly ToolScope[] = []): boolean {
    if (this.closing || this.changing || readToolsConfig(this.configPath).servers.some(server => server.id === this.vm.provider.serverId)) return false;
    return this.vm.available(currentScopes);
  }
  vmStatus(scope?: ToolScope) { return this.vm.status(scope); }
  private vmMutation(explicit: boolean) {
    if (!explicit || this.closing || this.changing || this.options.canStart?.() === false) throw new Error('Explicit current VM control action is required');
    if (readToolsConfig(this.configPath).servers.some(server => server.id === this.vm.provider.serverId)) throw new Error('Reserved builtin VM namespace conflicts with an existing MCP server');
  }
  reviewVmEnvironment(actionId: string, explicit: boolean) { return this.vm.review(actionId, explicit); }
  prepareVmEnvironment(actionId: string, reviewDigest: string, explicit: boolean) { return this.vm.prepare(actionId, reviewDigest, explicit); }
  attachVmWorkspace(scope: ToolScope, root: string, acknowledged: boolean, explicit: boolean) { return this.vm.attach(scope, root, acknowledged, explicit); }
  revokeVmWorkspace(scope: ToolScope, bindingId: string, explicit: boolean) { return this.vm.provider.revoke(scope, bindingId, explicit); }
  cancelVmOperation(scope: ToolScope, operationId: string, explicit: boolean) { return this.vm.provider.cancel(scope, operationId, explicit); }
  reconcileVmOperation(scope: ToolScope, operationId: string, explicit: boolean) { return this.vm.provider.reconcileOperation(scope, operationId, explicit); }
  readVmCandidate(scope: { taskId: string; generation: number }, operationId: string, path: string, sha256: string) {
    return this.vm.readCandidate(scope, operationId, path, sha256);
  }
  private hasVmNetworkTools(scope: ToolScope) {
    return !readToolsConfig(this.configPath).servers.some(server => server.id === this.vm.networkProvider.serverId)
      && this.vm.networkStatus(scope).grants.some(row => !row.revoked);
  }
  vmNetworkStatus(scope?: ToolScope) { return this.vm.networkStatus(scope); }
  grantVmNetwork(input: VmNetworkGrantInput, explicit: boolean) {
    if (readToolsConfig(this.configPath).servers.some(server => server.id === this.vm.networkProvider.serverId)) throw new Error('Reserved builtin network namespace conflicts with an existing MCP server');
    return this.vm.grantNetwork(input, explicit);
  }
  revokeVmNetwork(scope: VmNetworkScope, grantId: string, explicit: boolean) { return this.vm.revokeNetwork(scope, grantId, explicit); }
  pythonBuildStatus(scope?: ToolScope) { return { ...this.vm.pythonBuildStatus(scope), selectionAvailable: Boolean(this.options.resolvePythonBuildSelection) }; }
  reviewPythonBuild(actionId: string, selectionId: string, scope: ToolScope, explicit: boolean) {
    this.vmMutation(explicit); this.scope(scope);
    if (!this.options.resolvePythonBuildSelection) throw new Error('Explicit native Python build picker is unavailable');
    return this.track(async () => {
      const selection = await this.options.resolvePythonBuildSelection!(selectionId, scope); this.scope(scope);
      return this.vm.reviewPythonBuild(actionId, selection, scope, true);
    });
  }
  preparePythonBuild(actionId: string, digest: string, scope: ToolScope, explicit: boolean) { return this.track(() => this.vm.preparePythonBuild(actionId, digest, scope, explicit)); }
  attachPythonBuild(actionId: string, scope: ToolScope, explicit: boolean) { return this.vm.attachPythonBuild(actionId, scope, explicit); }
  revokePythonBuild(scope: ToolScope, explicit: boolean) { return this.vm.revokePythonBuild(scope, explicit); }
  cancelPythonBuild(actionId: string, explicit: boolean) { return this.vm.cancelPythonBuild(actionId, explicit); }
  reconcilePythonBuild(actionId: string, explicit: boolean) { return this.vm.reconcilePythonBuild(actionId, explicit); }
  validateBegunVmExportInvocation(request: Omit<ToolInvocation, 'grantId'>): void {
    if (request.tool !== 'vm-shell/export') throw new Error('Unsupported VM export source'); this.scope(request.scope);
    const current = this.options.resolveToolCall?.(request.scope);
    if (!current || current.idempotencyKey !== request.idempotencyKey || invocationFingerprint({ scope: request.scope, ...current }) !== invocationFingerprint(request)) throw new Error('No exact pending VM export tool call');
    const prior = this.host?.existingOutcome(request);
    if (!prior || prior.state !== 'outcome_unknown') throw new Error('VM export tool intent has not begun');
  }
  private pythonEnvironmentControl<T>(work: () => T): T {
    try { return work(); } catch (cause) { throw asPythonEnvironmentPublicError(cause); }
  }
  pythonEnvironmentStatus() {
    try {
      const runtime = pythonRuntimeStatus(this.pythonRuntime());
      return { supported: runtime.supported, ...(runtime.reason ? { reason: runtime.reason } : {}),
        environments: this.pythonEnvironments.list(), actions: this.pythonEnvironments.actions() };
    } catch (cause) {
      // A damaged optional environment store does not hide unrelated tools or create an empty-ready claim.
      return { supported: false, reason: pythonEnvironmentPublicReason(cause), environments: [], actions: [] };
    }
  }
  private pythonEnvironmentMutation(explicitUserAction: boolean) {
    if (!explicitUserAction || this.closing || this.changing || this.options.canStart?.() === false) throw new Error("Explicit current local Python environment action required");
  }
  reviewPythonEnvironment(actionId: string, wheelPaths: string[], explicitUserAction: boolean, options: Omit<SkillPythonEnvironmentReviewInput, "wheelPaths"> = {}) {
    this.pythonEnvironmentMutation(explicitUserAction);
    return this.pythonEnvironmentControl(() => this.pythonEnvironments.review(actionId, { ...options, wheelPaths }, true));
  }
  preparePythonEnvironment(actionId: string, reviewDigest: string, explicitUserAction: boolean) {
    this.pythonEnvironmentMutation(explicitUserAction);
    return this.pythonEnvironmentControl(() => this.pythonEnvironments.prepare(actionId, reviewDigest, true));
  }
  pythonEnvironmentAction(actionId: string) { return this.pythonEnvironmentControl(() => this.pythonEnvironments.inspect(actionId)); }
  reconcilePythonEnvironment(actionId: string, explicitUserAction: boolean) {
    if (!explicitUserAction) throw new Error("Explicit exact environment reconciliation required");
    return this.pythonEnvironmentControl(() => this.pythonEnvironments.reconcile(actionId, true));
  }
  bindPythonEnvironment(scope: ToolScope, environmentId: string, explicitUserAction: boolean) {
    this.scope(scope);
    if (!explicitUserAction || readToolsConfig(this.configPath).servers.some(server => server.id === this.skillScriptTools.serverId)) throw new Error("Explicit available builtin Python environment selection required");
    return this.skillScriptTools.bindPythonEnvironment(scope, environmentId, true);
  }
  revokePythonEnvironment(scope: ToolScope, bindingId: string, explicitUserAction: boolean) { return this.skillScriptTools.revokePythonEnvironment(scope, bindingId, explicitUserAction); }
  grantScriptWorkspace(scope: ToolScope, root: string, access: "read-only" | "read-write", acknowledged: boolean, explicitUserAction: boolean) {
    if (!acknowledged || !explicitUserAction) throw new Error("Explicit restricted script workspace acknowledgement required");
    this.scope(scope);
    if (readToolsConfig(this.configPath).servers.some(server => server.id === this.skillScriptTools.serverId)) throw new Error("Reserved builtin script namespace is configured by an existing MCP server");
    return this.skillScriptTools.grant(scope, { root, access }, true);
  }
  revokeScriptWorkspace(scope: ToolScope, grantId: string, explicitUserAction: boolean) { return this.skillScriptTools.revoke(scope, grantId, explicitUserAction); }
  status() {
    const config = readToolsConfig(this.configPath);
    return { config, runtime: this.host?.snapshot() ?? { enabled: config.enabled, servers: config.servers.map(server => ({ id: server.id, connected: false, pid: null })), sandbox: "external-server-process" },
      activeCount: this.activeCount, descriptors: structuredClone(this.descriptors), skillRoots: structuredClone(this.skillRoots), selections: [...this.selections.values()].map(row => structuredClone(row)),
      installCatalog: OFFICIAL_MCP_CATALOG, installations: this.installer.list(), serverConfigDigests: Object.fromEntries(config.servers.map(server => [server.id, sha256(JSON.stringify(server))])),
      managedSkills: this.managedSkillStatus(),
      browserTools: this.options.browserTools?.status() ?? null,
      desktopTools: this.options.desktopTools?.status() ?? null,
      remoteTools: this.options.remoteTools?.status() ?? null,
      scriptTools: this.scriptStatus(),
      pythonEnvironments: this.pythonEnvironmentStatus(),
      pythonBuilds: this.pythonBuildStatus(),
      vmNetwork: this.vmNetworkStatus(),
      ...this.vm.projection(),
      capabilities: { stdio: process.platform !== "win32", install: process.platform !== "win32", oauth: false, secrets: false, nativeSandbox: false, mcpSandboxAvailable: sandboxProviderAvailable(), skillWrites: false, managedSkillImports: process.platform !== "win32", skillResourceReads: process.platform !== 'win32' && !config.servers.some(server => server.id === this.skillResourceTools.serverId), skillScripts: this.skillScriptTools.status().capabilities.supported && !config.servers.some(server => server.id === this.skillScriptTools.serverId), pendingToolCalls: Boolean(this.options.resolveToolCall) } };
  }
  private reviewedSandbox(input: { codeRoots: string[]; readRoots: string[]; writeRoots: string[] }, ownedReadRoots: string[] = [], ownedCodeRoots: string[] = []) {
    const contains = (root: string, path: string) => { const rel = relative(root, path); return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`)); };
    const authority = realpathSync(this.options.home);
    if (input.writeRoots.some(root => contains(root, authority) || contains(authority, root)) || input.readRoots.some(root => !ownedReadRoots.includes(root) && (contains(root, authority) || contains(authority, root))) || input.codeRoots.some(root => !ownedCodeRoots.includes(root) && (contains(root, authority) || contains(authority, root)))) throw new Error("Sandbox data/code roots must not overlap tools authority metadata");
    if (input.writeRoots.some(write => input.codeRoots.some(code => contains(write, code) || contains(code, write)))) throw new Error("Sandbox writable grants must not overlap package code roots");
    return reviewTrustedSandboxConfig(input);
  }
  reviewServer(input: unknown, explicitUserAction: boolean) {
    if (!explicitUserAction || this.closing || this.changing) throw new Error("Explicit trusted configuration review required");
    const value = recipeInput.parse(input);
    if (value.id === this.options.oauthMcpTools?.serverId || value.id === this.options.browserTools?.serverId || value.id === this.options.desktopTools?.serverId || value.id === this.options.remoteTools?.serverId || value.id === this.skillResourceTools.serverId || value.id === this.vm.provider.serverId || value.id === this.vm.networkProvider.serverId || this.options.builtins?.some(provider => provider.serverId === value.id)) throw new Error("Reserved builtin tool namespace cannot be used by an MCP server");
    const command = realpathSync(value.command); const cwd = realpathSync(value.cwd);
    if (["sh", "bash", "zsh", "fish", "cmd", "cmd.exe", "powershell", "powershell.exe", "pwsh", "npx", "bunx", "uvx", "npm", "pnpm", "yarn", "pip", "pip3"].includes(basename(command).toLowerCase()) || value.args.some(arg => ["-e", "--eval", "-c", "--command"].includes(arg))) throw new Error("Installers, shell commands and inline evaluation are unsupported server recipes");
    const recipe: ServerRecipe = { id: value.id, enabled: false, transport: "stdio", source: { kind: "user-installed", label: value.label, version: value.version }, command, commandSha256: pinnedFile(command, 512 * 1024 * 1024).sha256, args: value.args, pinnedFiles: value.pinnedFiles.map(path => pinnedFile(path, 32 * 1024 * 1024)), cwd, envSecretRefs: {} };
    // An interpreter must pin its actual script entry; no implicit runtime/package fetch.
    if (/^(?:bun|node|nodejs|python[0-9.]*)$/.test(basename(command)) && (!value.args[0] || !recipe.pinnedFiles.some(file => file.path === value.args[0]))) throw new Error("Interpreter recipes must pin an absolute first script argument");
    if (value.sandbox) {
      if (!sandboxProviderAvailable()) throw new Error("Requested OS sandbox is unavailable on this platform");
      recipe.trustedSandbox = this.reviewedSandbox({ codeRoots: [...new Set(recipe.pinnedFiles.map(file => dirname(file.path)))], readRoots: [cwd], writeRoots: [cwd] });
    }
    verifyRecipeFiles(recipe);
    if (this.reviews.size >= 32) throw new Error("Pending configuration review limit reached");
    const reviewId = crypto.randomUUID(); this.reviews.set(reviewId, { recipe, configDigest: sha256(JSON.stringify(readToolsConfig(this.configPath))) });
    return { reviewId, recipe, trust: "This explicitly configured server runs with your OS user permissions; tool approval does not sandbox the server process." };
  }
  private async changeConfig(make: (current: ToolsConfig) => ToolsConfig): Promise<ReturnType<AgentToolsComposition["status"]>> {
    if (this.closing || this.changing || this.pending.size || this.host?.pendingBuiltinCount || this.options.desktopTools?.status().activeCount || this.vm.buildActiveCount || this.vm.provider.activeCount || this.vm.networkStatus().activeCount || this.installer.activeCount) throw new Error("Wait for owned tool operations before changing configuration");
    this.changing = true;
    let settled!: () => void; this.configSettling = new Promise<void>(resolve => { settled = resolve; });
    try {
      const current = readToolsConfig(this.configPath); const next = make(current);
      await this.host?.close(); this.host = undefined; this.descriptors = [];
      writeToolsConfig(this.configPath, next); return this.status();
    } finally { this.changing = false; settled(); this.configSettling = undefined; }
  }
  saveServer(reviewId: string, enabled: boolean, explicitUserAction: boolean) {
    if (!explicitUserAction) throw new Error("Explicit reviewed server save required");
    return this.changeConfig(current => {
      const review = this.reviews.get(reviewId); if (!review || review.configDigest !== sha256(JSON.stringify(current))) throw new Error("Configuration review is missing or stale");
      if (review.recipe.managedInstallation && enabled) throw new Error("Explicit installed recipe must first be saved disabled");
      verifyRecipeFiles(review.recipe); this.reviews.delete(reviewId);
      const servers = current.servers.filter(server => server.id !== review.recipe.id); servers.push({ ...review.recipe, enabled }); return { ...current, servers };
    });
  }
  setEnabled(enabled: boolean, explicitUserAction: boolean) {
    if (!explicitUserAction) throw new Error("Explicit tools enable/disable action required");
    return this.changeConfig(current => ({ ...current, enabled }));
  }
  setServerEnabled(serverId: string, enabled: boolean, expectedRecipeSha256: string, explicitUserAction: boolean) {
    if (!explicitUserAction) throw new Error("Explicit reviewed server enable action required");
    return this.changeConfig(current => {
      const server = current.servers.find(row => row.id === serverId);
      if (!server || sha256(JSON.stringify(server)) !== expectedRecipeSha256) throw new Error("Configuration changed before exact server enable action");
      if (enabled) verifyRecipeFiles(server);
      return { ...current, servers: current.servers.map(row => row.id === serverId ? { ...row, enabled } : row) };
    });
  }
  removeServer(serverId: string, explicitUserAction: boolean) {
    if (!explicitUserAction) throw new Error("Explicit server configuration removal required");
    return this.changeConfig(current => ({ ...current, servers: current.servers.filter(server => server.id !== serverId) }));
  }
  async approveInvoke(scope: ToolScope, explicitUserAction: boolean): Promise<ToolOutcome> {
    if (!explicitUserAction) throw new Error("Explicit exact tool invocation approval required"); validateToolScope(scope);
    const call = this.options.resolveToolCall?.(scope); if (!call) throw new Error("No exact pending owned Agent tool call is available");
    return this.track(async () => {
      const host = this.getHost();
      const prior = host.existingOutcome({ scope, ...call });
      if (prior) { await this.options.onOutcome?.(prior); return prior; }
      this.scope(scope);
      await host.discover(scope);
      this.scope(scope);
      const current = this.options.resolveToolCall?.(scope);
      if (!current || JSON.stringify(current) !== JSON.stringify(call)) throw new Error("Pending Agent tool call changed before approval");
      const grantId = host.authorize({ scope, tool: call.tool, arguments: call.arguments });
      const outcome = await host.invoke({ scope, ...call, grantId });
      await this.options.onOutcome?.(outcome); return outcome;
    });
  }
  /** Trusted observer lookup only. Read-only existing journal; no host/client creation. */
  getEvidenceOutcomeBySourceEvent(sourceEventId: string): ToolOutcome | undefined {
    if (!/^[a-z][a-z0-9_-]{0,39}:[a-f0-9]{64}$/.test(sourceEventId) || !existsSync(this.journalPath)) return;
    const stat = lstatSync(this.journalPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || stat.mode & 0o077) return;
    const db = new Database(this.journalPath, { readonly: true });
    try {
      const row = db.query('SELECT receipt FROM tool_calls WHERE event_id=?').get(sourceEventId) as { receipt: string } | null;
      if (!row) return; const outcome = JSON.parse(row.receipt) as ToolOutcome;
      if (!sourceEventId.endsWith(':' + sha256(outcome.idempotencyKey))) return;
      validateToolScope(outcome.scope); return structuredClone(outcome);
    } finally { db.close(); }
  }
  receipt(idempotencyKey: string): ToolOutcome | undefined { return this.getHost().getOutcome(idempotencyKey); }
  /** Passive cross-process proof of the exact already-approved journal intent. */
  validateBegunRemoteInvocation(request: Omit<ToolInvocation, "grantId">): void {
    if (!request.tool.startsWith("remote/")) throw new Error("Unsupported remote tool source");
    this.scope(request.scope);
    const call = this.options.resolveToolCall?.(request.scope);
    if (!call || call.idempotencyKey !== request.idempotencyKey || invocationFingerprint({ scope: request.scope, ...call }) !== invocationFingerprint(request)) throw new Error("No exact pending remote tool call");
    const prior = this.host?.existingOutcome(request);
    if (!prior || prior.state !== "outcome_unknown") throw new Error("Remote tool intent has not begun");
  }
  /** Main transport asks independently; only the immutable pending call plus begun journal can admit an effect. */
  validateBegunOAuthMcpInvocation(request: Omit<ToolInvocation, "grantId">): void {
    if (!request.tool.startsWith("oauth_mcp_tools/")) throw new Error("Unsupported OAuth MCP source");
    this.scope(request.scope);
    const call = this.options.resolveToolCall?.(request.scope);
    if (!call || call.idempotencyKey !== request.idempotencyKey || invocationFingerprint({ scope: request.scope, ...call }) !== invocationFingerprint(request)) throw new Error("No exact pending OAuth MCP tool call");
    const prior = this.host?.existingOutcome(request);
    if (!prior || prior.state !== "outcome_unknown") throw new Error("OAuth MCP intent has not begun");
  }
  remoteStatus(scope?: ToolScope) { return this.options.remoteTools?.inspect(scope ? { taskId: scope.taskId, generation: scope.generation } : undefined) ?? null; }
  bindRemoteTools(scope: RemoteTaskScope, hostId: string, explicitUserAction: boolean) {
    if (!explicitUserAction || this.closing || this.changing || this.options.canStart?.() === false || !this.options.remoteTools) throw new Error("Explicit current remote attachment is unavailable");
    this.scope({ taskId: scope.taskId, generation: scope.generation, toolCallId: "remote-control" });
    if (readToolsConfig(this.configPath).servers.some(server => server.id === "remote")) throw new Error("Reserved remote namespace conflicts with an existing MCP server");
    return this.track(() => this.options.remoteTools!.attach(scope, hostId, true));
  }
  revokeRemoteTools(scope: ToolScope, explicitUserAction: boolean) {
    validateToolScope(scope);
    if (!explicitUserAction || !this.options.remoteTools) throw new Error("Explicit remote revocation is unavailable");
    return this.options.remoteTools.revoke({ taskId: scope.taskId, generation: scope.generation });
  }
  /** Trusted core callback derives request from immutable dispatch; no user/model result accepted. */
  reconcileReceipt(request: Omit<ToolInvocation, "grantId">): Promise<ToolOutcome | undefined> { return this.track(() => this.getHost().reconcileExisting(request)); }
  browserStatus(scope?: ToolScope) { return this.options.browserTools?.status(scope) ?? null; }
  bindBrowserTools(scope: ToolScope, expectedBinding: BrowserBinding, explicitUserAction: boolean) {
    if (!explicitUserAction || !this.options.browserTools) throw new Error("Explicit selected browser attachment is unavailable"); this.scope(scope);
    if (readToolsConfig(this.configPath).servers.some(server => server.id === this.options.browserTools!.serverId)) throw new Error("Reserved browser namespace conflicts with an existing MCP server; no source was replaced");
    return this.options.browserTools.bind(scope, expectedBinding);
  }
  revokeBrowserTools(scope: ToolScope, explicitUserAction: boolean) {
    if (!explicitUserAction || !this.options.browserTools) throw new Error("Explicit browser attachment revocation required"); validateToolScope(scope); return this.options.browserTools.revoke(scope);
  }
  invalidateBrowserTask(taskId: string): void { this.options.browserTools?.invalidate(taskId); }
  invalidateTaskTools(taskId: string): void {
    this.options.browserTools?.invalidate(taskId);
    this.options.desktopTools?.invalidate(taskId);
    this.options.remoteTools?.invalidate(taskId);
    this.options.oauthMcpTools?.invalidate?.(taskId);
    this.skillScriptTools.invalidate?.(taskId);
    this.vm.provider.invalidate?.(taskId);
    this.vm.networkProvider.invalidate?.(taskId);
    void this.vm.invalidateBuilds(taskId);
    this.skillResourceTools.invalidate?.(taskId);
    for (const provider of this.options.builtins ?? []) provider.invalidate?.(taskId);
  }
  private desktopControl(explicitUserAction: boolean, newWork = false) {
    if (!explicitUserAction || this.closing || !this.options.desktopTools) throw new Error("Explicit native desktop controller action is unavailable");
    if (newWork && (this.changing || this.options.canStart?.() === false)) throw new Error("Local tools admission is closed");
    return this.options.desktopTools;
  }
  inspectDesktopPermissions(explicitUserAction: boolean) { return this.track(async () => { await this.desktopControl(explicitUserAction, true).inspectPermissions(explicitUserAction); return this.status().desktopTools; }); }
  listDesktopWindows(explicitUserAction: boolean) { return this.track(async () => { await this.desktopControl(explicitUserAction, true).listWindows(explicitUserAction); return this.status().desktopTools; }); }
  setDesktopEnabled(enabled: boolean, explicitUserAction: boolean) { return this.track(async () => { await this.desktopControl(explicitUserAction, enabled).setEnabled(enabled, explicitUserAction); return this.status().desktopTools; }); }
  selectDesktopWindow(scope: ToolScope, expectedSelection: MacosWindowSelection, explicitUserAction: boolean) {
    this.scope(scope);
    if (readToolsConfig(this.configPath).servers.some(server => server.id === this.options.desktopTools?.serverId)) throw new Error("Reserved desktop namespace conflicts with an existing MCP server; no source was replaced");
    return this.track(async () => { await this.desktopControl(explicitUserAction).selectAndBind(scope, expectedSelection, explicitUserAction); return this.status().desktopTools; });
  }
  revokeDesktopTools(scope: ToolScope, explicitUserAction: boolean) { validateToolScope(scope); return this.desktopControl(explicitUserAction).revoke(scope); }
  terminalReference(idempotencyKey: string, requirementId: string) { return this.getHost().terminalReference(idempotencyKey, requirementId); }
  prepareInstall(actionId: string, catalogId: string, allowedRoot: string, explicitUserAction: boolean) {
    if (!explicitUserAction || this.closing || this.changing) throw new Error("Explicit managed package preparation required");
    return this.installer.prepare(actionId, catalogId, allowedRoot);
  }
  installReviewed(actionId: string, graphSha256: string, explicitUserAction: boolean) {
    if (!explicitUserAction || this.closing || this.changing) throw new Error("Explicit reviewed dependency graph approval required");
    return this.installer.install(actionId, graphSha256);
  }
  reviewInstalled(actionId: string, explicitUserAction: boolean) {
    if (!explicitUserAction || this.closing || this.changing) throw new Error("Explicit installed runtime review required");
    const receipt = this.installer.receipt(actionId); const catalog = OFFICIAL_MCP_CATALOG.find(row => row.id === receipt?.catalogId);
    if (!receipt || receipt.state !== "installed" || !receipt.runtime || !receipt.tree || !receipt.graphSha256 || !catalog) throw new Error("Exact installed runtime receipt required");
    const id = `npm-${catalog.id.slice("official-".length)}-${sha256(actionId).slice(0, 12)}`, launch = managedMcpLaunchPlan(catalog.id, receipt.allowedRoot);
    const current = readToolsConfig(this.configPath); if (current.servers.some(server => server.id === id)) throw new Error("Installed recipe configuration already exists; inspect it instead of replacing it");
    const command = realpathSync(process.execPath); const entry = join(receipt.runtime, "node_modules", catalog.package, catalog.entrypoint);
    const bunfig = join(receipt.runtime, "bunfig.toml");
    const recipe: ServerRecipe = { id, enabled: false, transport: "stdio", source: { kind: "user-installed", label: catalog.label, version: catalog.version }, command, commandSha256: pinnedFile(command, 512 * 1024 * 1024).sha256, args: ["--no-install", "--no-env-file", `--config=${bunfig}`, entry, ...launch.args], pinnedFiles: [pinnedFile(entry, 32 * 1024 * 1024), pinnedFile(bunfig, 64 * 1024), pinnedFile(join(receipt.runtime, "package.json"), 64 * 1024), pinnedFile(join(receipt.runtime, "bun.lock"), 1024 * 1024)], cwd: receipt.runtime, envSecretRefs: {}, env: launch.env, managedInstallation: { actionId, package: catalog.package, version: catalog.version, integrity: catalog.integrity, graphSha256: receipt.graphSha256, treeRoot: join(receipt.runtime, "node_modules"), treeSha256: receipt.tree.sha256, treeFiles: receipt.tree.files } };
    if (sandboxProviderAvailable()) recipe.trustedSandbox = this.reviewedSandbox({ codeRoots: [join(receipt.runtime, "node_modules")], readRoots: [receipt.runtime, ...(launch.readData ? [receipt.allowedRoot] : [])], writeRoots: launch.writeData ? [receipt.allowedRoot] : [] }, [receipt.runtime], [join(receipt.runtime, "node_modules")]);
    verifyRecipeFiles(recipe); const reviewId = crypto.randomUUID(); this.reviews.set(reviewId, { recipe, configDigest: sha256(JSON.stringify(current)) });
    return { reviewId, recipe, trust: "Review the installed dependency tree and exact allowed root. Save disabled first; enabling and connecting are separate actions." };
  }
  async uninstallManaged(actionId: string, explicitUserAction: boolean) {
    if (!explicitUserAction || this.closing || this.changing) throw new Error("Explicit managed runtime archive required");
    await this.changeConfig(current => ({ ...current, servers: current.servers.map(server => server.managedInstallation?.actionId === actionId ? { ...server, enabled: false } : server) }));
    return this.installer.uninstall(actionId);
  }
  addSkillRoot(input: { root: string; label: string }, explicitUserAction: boolean) {
    if (!explicitUserAction || this.closing || this.skillRoots.length >= 16) throw new Error("Explicit user selected skill root required");
    const grant: SkillRootGrant = { id: crypto.randomUUID(), root: realpathSync(z.string().min(1).max(4096).parse(input.root)), source: "user", label: z.string().min(1).max(200).parse(input.label) };
    new ReadOnlySkillLibrary([grant]); const roots = [...this.skillRoots, grant];
    writePrivateMetadata(this.skillStatePath, { version: 1, roots, selections: [...this.selections.values()] }); this.skillRoots = roots; return structuredClone(grant);
  }
  discoverSkills(grantId: string) { return new ReadOnlySkillLibrary(this.skillRoots).discover(grantId); }
  removeSkillRoot(grantId: string, explicitUserAction: boolean) {
    if (!explicitUserAction || this.closing) throw new Error("Explicit skill root revocation required");
    const roots = this.skillRoots.filter(root => root.id !== grantId);
    const selections = new Map([...this.selections].map(([key, row]) => [key, { ...row, skills: row.skills.filter(skill => skill.grantId !== grantId) }]));
    writePrivateMetadata(this.skillStatePath, { version: 1, roots, selections: [...selections.values()] }); this.skillRoots = roots; this.selections = selections;
    return this.status();
  }
  selectSkill(scope: ToolScope, identity: SkillIdentity, explicitUserAction: boolean): SelectedSkill {
    if (!explicitUserAction) throw new Error("Explicit selected skill approval required"); this.scope(scope);
    const selected = new ReadOnlySkillLibrary(this.skillRoots).select(identity); const key = JSON.stringify([scope.taskId, scope.generation]);
    const previous = this.selections.get(key)?.skills ?? []; const next = [...previous.filter(row => row.id !== identity.id), identity];
    if (next.length > 16) throw new Error("Selected skill limit exceeded");
    const library = new ReadOnlySkillLibrary(this.skillRoots); if (next.reduce((bytes, row) => bytes + library.select(row).bytes, 0) > 128 * 1024) throw new Error("Selected skill content limit exceeded");
    const managed = this.managedSkillStore || existsSync(join(this.options.home, "managed-skills", "metadata.sqlite")) ? this.managedSkills().selected(scope) : [];
    if (next.length + managed.length > 16 || next.reduce((bytes, row) => bytes + row.bytes, 0) + managed.reduce((bytes, row) => bytes + (row.promptBytes ?? row.bytes), 0) > 128 * 1024) throw new Error("Selected skill combined content limit exceeded");
    const selections = new Map(this.selections); selections.set(key, { scope, skills: structuredClone(next) });
    if (selections.size > 64) throw new Error("Selected skill task scope limit exceeded");
    writePrivateMetadata(this.skillStatePath, { version: 1, roots: this.skillRoots, selections: [...selections.values()] }); this.selections = selections; return selected;
  }
  selectedSkillContent(scope: ToolScope): SelectedSkill[] {
    this.scope(scope);
    const selections = this.selections.get(JSON.stringify([scope.taskId, scope.generation]))?.skills ?? [];
    const roots = this.skillRoots.filter(root => selections.some(identity => identity.grantId === root.id));
    const library = selections.length ? new ReadOnlySkillLibrary(roots) : undefined;
    const local = selections.map(identity => library!.select(identity));
    const managed = this.managedSkillStore || existsSync(join(this.options.home, "managed-skills", "metadata.sqlite")) ? this.managedSkills().selected(scope) : [];
    if (local.length + managed.length > 16 || [...local, ...managed].reduce((bytes, row) => bytes + (row.promptBytes ?? row.bytes), 0) > 128 * 1024) throw new Error("Selected skill combined content limit exceeded");
    return [...local, ...managed];
  }
  reviewSkillImport(actionId: string, identity: SkillIdentity, label: string, updateLineageId: string | undefined, explicitUserAction: boolean) {
    if (!explicitUserAction || this.closing) throw new Error("Explicit managed skill source review required");
    const grant = this.skillRoots.find(row => row.id === identity.grantId); if (!grant) throw new Error("Skill source root is not currently granted");
    return this.managedSkills().review(actionId, grant, identity, label, updateLineageId);
  }
  reviewSkillPackageImport(actionId: string, selection: { identity: SkillIdentity; resources: string[] }, label: string, updateLineageId: string | undefined, explicitUserAction: boolean) {
    if (!explicitUserAction || this.closing) throw new Error("Explicit managed skill package source review required");
    const grant = this.skillRoots.find(row => row.id === selection.identity.grantId);
    if (!grant) throw new Error("Skill source root is not currently granted");
    return this.managedSkills().reviewPackage(actionId, grant, selection, label, updateLineageId);
  }
  commitSkillImport(actionId: string, reviewDigest: string, explicitUserAction: boolean) {
    if (!explicitUserAction || this.closing) throw new Error("Explicit reviewed managed skill import approval required");
    const store = this.managedSkills(); const action = store.action(actionId); if (!action) throw new Error("Managed skill review receipt missing");
    if (action.reviewDigest !== reviewDigest) throw new Error("Exact reviewed managed skill approval required");
    if (action.state === "imported") return action;
    const grant = this.skillRoots.find(row => row.id === action.manifest.grant.id); if (!grant) throw new Error("Skill source root was revoked after review");
    return store.commit(actionId, reviewDigest, grant);
  }
  managedSkillAction(actionId: string) { return this.managedSkills().inspect(actionId); }
  /** Admin-only local preview. Raw PDFs stay in the private store; parsing is owned out of process. */
  presentSkillReview(value: unknown): Promise<unknown> {
    return this.track(async () => {
      if (this.closing) throw new Error("Managed skill preview is unavailable while closing");
      if (!value || typeof value !== "object" || !Array.isArray((value as { resources?: unknown }).resources)) return value;
      const packet = value as { action?: { actionId?: unknown }; actionId?: unknown; resources: SkillResource[] };
      const actionId = packet.action?.actionId ?? packet.actionId;
      if (typeof actionId !== "string") throw new Error("Managed skill preview has no retained review identity");
      const resources = [];
      for (const resource of packet.resources) {
        if (resource.kind !== "document") { resources.push(resource); continue; }
        const bytes = selectedPdfBytes(resource);
        let preview = unavailablePdfProjection(resource, "PDF text extractor is unavailable");
        if (this.pdfExtractor.capabilities().supported) {
          const operationId = sha256(JSON.stringify(["selected-pdf-preview-v1", actionId, resource.relativePath, resource.digest]));
          try { preview = projectPdfExtraction(await this.pdfExtractor.extract({ operationId, bytes, sha256: resource.digest }), resource); }
          catch { preview = { ...unavailablePdfProjection(resource, "PDF preview outcome is unknown; inspect its retained owner before another request"), state: "unknown" }; }
        }
        if (this.closing) throw new Error("Managed skill preview was closed before delivery");
        const { data: _data, ...metadata } = resource;
        resources.push({ ...metadata, preview });
      }
      const projected = { ...packet, resources };
      if (Buffer.byteLength(JSON.stringify(projected)) > 768 * 1024) throw new Error("Managed skill review projection exceeds transport bounds; choose fewer or smaller supporting files");
      return projected;
    });
  }
  attachManagedSkill(scope: ToolScope, versionId: string, explicitUserAction: boolean) {
    if (!explicitUserAction) throw new Error("Explicit managed skill attachment required"); this.scope(scope);
    const local = this.selections.get(JSON.stringify([scope.taskId, scope.generation]))?.skills ?? [];
    const existing = this.managedSkills().selected(scope); const incoming = this.managedSkills().content(versionId); const version = this.managedSkills().version(versionId)!;
    const retained = existing.filter(skill => skill.grantId !== `managed:${version.lineageId}`);
    if (local.length + retained.length + 1 > 16 || local.reduce((bytes, row) => bytes + row.bytes, 0) + retained.reduce((bytes, row) => bytes + (row.promptBytes ?? row.bytes), 0) + (incoming.promptBytes ?? incoming.bytes) > 128 * 1024) throw new Error("Selected skill combined content limit exceeded");
    return this.managedSkills().attach(scope, versionId);
  }
  detachManagedSkill(scope: ToolScope, versionId: string, explicitUserAction: boolean) {
    if (!explicitUserAction) throw new Error("Explicit managed skill detachment required"); this.scope(scope); this.managedSkills().detach(scope, versionId);
    return Promise.all([this.skillScriptTools.revokePackage(versionId, scope), this.skillResourceTools.revokePackage(versionId, scope)]).then(() => undefined);
  }
  revokeManagedSkill(versionId: string, forget: boolean, explicitUserAction: boolean) {
    if (!explicitUserAction || this.closing) throw new Error("Explicit managed skill revoke/forget required");
    const receipt = this.managedSkills().revoke(versionId, forget);
    return Promise.all([this.skillScriptTools.revokePackage(versionId), this.skillResourceTools.revokePackage(versionId)]).then(() => receipt);
  }
  resolveEvidence(task: AgentTask, reference: AgentEvidenceReference) { return this.getHost().resolveTerminalEvidence(task, reference); }
  close(): Promise<void> {
    if (this.closingPromise) return this.closingPromise;
    if (!this.closing) {
      this.closing = true;
      this.options.browserTools?.invalidate();
      this.options.desktopTools?.invalidate();
      this.options.oauthMcpTools?.invalidate?.();
      this.skillScriptTools.invalidate?.();
      this.vm.provider.invalidate?.();
      this.vm.networkProvider.invalidate?.();
      this.skillResourceTools.invalidate?.();
      for (const provider of this.options.builtins ?? []) provider.invalidate?.();
    }
    this.closingPromise = (async () => {
      await this.configSettling;
      await this.installer.close();
      // Physical owners and exact remote revocations settle before their journal closes.
      await this.options.desktopTools?.close();
      await this.options.remoteTools?.close();
      await this.skillScriptTools.close();
      await this.vm.closeNetwork();
      await this.vm.closeBuilds();
      await this.vm.provider.close();
      await Promise.all([this.skillResourceTools.close(), this.pdfExtractor.close()]);
      await this.host?.close(); await Promise.allSettled([...this.pending]); this.host = undefined;
      this.managedSkillStore?.close(); this.managedSkillStore = undefined;
    })().catch(error => { this.closingPromise = undefined; throw error; });
    return this.closingPromise;
  }
}
export const createAgentToolsComposition = (options: AgentToolsCompositionOptions) => new AgentToolsComposition(options);
