import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { z } from "zod";
import { defaultToolsConfig, readToolsConfig, sha256, verifyRecipeFiles, writeToolsConfig, type ServerRecipe, type ToolsConfig } from "./config";
import { StandaloneMcpHost } from "./mcp-host";
import { ReadOnlySkillLibrary, type SelectedSkill, type SkillIdentity, type SkillRootGrant } from "./skills";
import { validateToolScope } from "./journal";
import type { StandaloneBuiltinToolsProvider, StandaloneToolsPort, ToolDescriptor, ToolInvocation, ToolOutcome, ToolScope } from "./types";
import type { AgentBrowserToolsProvider } from "../browser-companion/agent-tools";
import type { BrowserBinding } from "../browser-companion/protocol";
import type { AgentDesktopToolsProvider } from "../browser-companion/agent-desktop-tools";
import type { MacosWindowSelection } from "../browser-companion/macos-desktop";
import type { AgentTask } from "../agent-mode/types";
import type { AgentEvidenceReference } from "../agent-mode/http";
import { createAgentToolsRoutes } from "./http";
import { readPrivateMetadata, writePrivateMetadata } from "./private-metadata";
import { ManagedMcpInstaller, OFFICIAL_MCP_CATALOG } from "./installer";
import { reviewTrustedSandboxConfig, sandboxProviderAvailable } from "./sandbox";
import { ManagedSkillStore } from "./managed-skills";

export interface AgentToolsCompositionOptions {
  home: string;
  authorize: (request: Request) => boolean;
  canStart?: () => boolean;
  isScopeActive: (scope: ToolScope) => boolean;
  resolveToolCall?: (scope: ToolScope) => { tool: string; arguments: Record<string, unknown>; idempotencyKey: string } | undefined;
  onOutcome?: (outcome: ToolOutcome) => void | Promise<void>;
  /** Pure browser leaf; root owns companion runtime, while this host owns approval/journal. */
  browserTools?: AgentBrowserToolsProvider;
  /** Explicit native controller; status is passive and registration never creates its helper. */
  desktopTools?: AgentDesktopToolsProvider;
  /** Other trusted pure executors (for example an independently configured desktop provider). */
  builtins?: readonly StandaloneBuiltinToolsProvider[];
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
  readonly installer: ManagedMcpInstaller;
  readonly toolsPort: StandaloneToolsPort;
  readonly handle: (request: Request) => Promise<Response | undefined>;
  constructor(readonly options: AgentToolsCompositionOptions) {
    this.configPath = join(options.home, "agent-tools.json"); this.journalPath = join(options.home, "agent-tool-calls.sqlite");
    this.skillStatePath = join(options.home, "agent-skills.json");
    this.installer = new ManagedMcpInstaller(options.home);
    const persisted = readPrivateMetadata(this.skillStatePath);
    if (persisted !== undefined) { const saved = savedSkills.parse(persisted); this.skillRoots = saved.roots; this.selections = new Map(saved.selections.map(row => [JSON.stringify([row.scope.taskId, row.scope.generation]), row])); }
    this.handle = createAgentToolsRoutes(this);
    this.toolsPort = {
      discover: (scope, opts) => this.track(async () => {
        this.scope(scope);
        if (!readToolsConfig(this.configPath).enabled && !this.options.browserTools && !this.options.desktopTools && !this.options.builtins?.length) return [];
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
    if (!this.host) this.host = new StandaloneMcpHost({ config: readToolsConfig(this.configPath), journalPath: this.journalPath, isScopeActive: scope => !this.closing && !this.changing && this.options.canStart?.() !== false && this.options.isScopeActive(scope), builtins: [...(this.options.builtins ?? []), ...(this.options.browserTools ? [this.options.browserTools] : []), ...(this.options.desktopTools ? [this.options.desktopTools] : [])] });
    return this.host;
  }
  private track<T>(operation: () => Promise<T>): Promise<T> {
    const pending = operation(); this.pending.add(pending);
    void pending.then(() => this.pending.delete(pending), () => this.pending.delete(pending)); return pending;
  }
  get activeCount(): number { return Math.max(this.pending.size, this.host?.pendingBuiltinCount ?? 0, this.options.desktopTools?.status().activeCount ?? 0) + (this.changing ? 1 : 0) + this.installer.activeCount; }
  private managedSkills() { if (this.closing) throw new Error("Managed skill store is closing"); return this.managedSkillStore ??= new ManagedSkillStore(this.options.home); }
  private managedSkillStatus() {
    if (this.managedSkillStore) return this.managedSkillStore.list();
    if (!this.closing && existsSync(join(this.options.home, "managed-skills", "metadata.sqlite"))) return this.managedSkills().list();
    return { versions: [], attachments: [], actions: [], retainedVersions: 0, forgottenVersions: 0, cleanup: "not-performed; immutable referenced versions retained" };
  }
  status() {
    const config = readToolsConfig(this.configPath);
    return { config, runtime: this.host?.snapshot() ?? { enabled: config.enabled, servers: config.servers.map(server => ({ id: server.id, connected: false, pid: null })), sandbox: "external-server-process" },
      activeCount: this.activeCount, descriptors: structuredClone(this.descriptors), skillRoots: structuredClone(this.skillRoots), selections: [...this.selections.values()].map(row => structuredClone(row)),
      installCatalog: OFFICIAL_MCP_CATALOG, installations: this.installer.list(), serverConfigDigests: Object.fromEntries(config.servers.map(server => [server.id, sha256(JSON.stringify(server))])),
      managedSkills: this.managedSkillStatus(),
      browserTools: this.options.browserTools?.status() ?? null,
      desktopTools: this.options.desktopTools?.status() ?? null,
      capabilities: { stdio: process.platform !== "win32", install: process.platform !== "win32", oauth: false, secrets: false, nativeSandbox: false, mcpSandboxAvailable: sandboxProviderAvailable(), skillWrites: false, managedSkillImports: process.platform !== "win32", pendingToolCalls: Boolean(this.options.resolveToolCall) } };
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
    if (value.id === this.options.browserTools?.serverId || value.id === this.options.desktopTools?.serverId || this.options.builtins?.some(provider => provider.serverId === value.id)) throw new Error("Reserved builtin tool namespace cannot be used by an MCP server");
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
    if (this.closing || this.changing || this.pending.size || this.host?.pendingBuiltinCount || this.options.desktopTools?.status().activeCount || this.installer.activeCount) throw new Error("Wait for owned tool operations before changing configuration");
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
  receipt(idempotencyKey: string): ToolOutcome | undefined { return this.getHost().getOutcome(idempotencyKey); }
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
    for (const provider of this.options.builtins ?? []) provider.invalidate?.(taskId);
  }
  private desktopControl(explicitUserAction: boolean) { if (!explicitUserAction || this.closing || !this.options.desktopTools) throw new Error("Explicit native desktop controller action is unavailable"); return this.options.desktopTools; }
  inspectDesktopPermissions(explicitUserAction: boolean) { return this.track(async () => { await this.desktopControl(explicitUserAction).inspectPermissions(explicitUserAction); return this.status().desktopTools; }); }
  listDesktopWindows(explicitUserAction: boolean) { return this.track(async () => { await this.desktopControl(explicitUserAction).listWindows(explicitUserAction); return this.status().desktopTools; }); }
  setDesktopEnabled(enabled: boolean, explicitUserAction: boolean) { return this.track(async () => { await this.desktopControl(explicitUserAction).setEnabled(enabled, explicitUserAction); return this.status().desktopTools; }); }
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
    const id = `npm-filesystem-${sha256(actionId).slice(0, 12)}`;
    const current = readToolsConfig(this.configPath); if (current.servers.some(server => server.id === id)) throw new Error("Installed recipe configuration already exists; inspect it instead of replacing it");
    const command = realpathSync(process.execPath); const entry = join(receipt.runtime, "node_modules", catalog.package, catalog.entrypoint);
    const bunfig = join(receipt.runtime, "bunfig.toml");
    const recipe: ServerRecipe = { id, enabled: false, transport: "stdio", source: { kind: "user-installed", label: catalog.label, version: catalog.version }, command, commandSha256: pinnedFile(command, 512 * 1024 * 1024).sha256, args: ["--no-install", "--no-env-file", `--config=${bunfig}`, entry, receipt.allowedRoot], pinnedFiles: [pinnedFile(entry, 32 * 1024 * 1024), pinnedFile(bunfig, 64 * 1024), pinnedFile(join(receipt.runtime, "package.json"), 64 * 1024), pinnedFile(join(receipt.runtime, "bun.lock"), 1024 * 1024)], cwd: receipt.runtime, envSecretRefs: {}, managedInstallation: { actionId, package: catalog.package, version: catalog.version, integrity: catalog.integrity, graphSha256: receipt.graphSha256, treeRoot: join(receipt.runtime, "node_modules"), treeSha256: receipt.tree.sha256, treeFiles: receipt.tree.files } };
    if (sandboxProviderAvailable()) recipe.trustedSandbox = this.reviewedSandbox({ codeRoots: [join(receipt.runtime, "node_modules")], readRoots: [receipt.runtime, receipt.allowedRoot], writeRoots: [receipt.allowedRoot] }, [receipt.runtime], [join(receipt.runtime, "node_modules")]);
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
    if (next.length + managed.length > 16 || next.reduce((bytes, row) => bytes + row.bytes, 0) + managed.reduce((bytes, row) => bytes + row.bytes, 0) > 128 * 1024) throw new Error("Selected skill combined content limit exceeded");
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
    if (local.length + managed.length > 16 || [...local, ...managed].reduce((bytes, row) => bytes + row.bytes, 0) > 128 * 1024) throw new Error("Selected skill combined content limit exceeded");
    return [...local, ...managed];
  }
  reviewSkillImport(actionId: string, identity: SkillIdentity, label: string, updateLineageId: string | undefined, explicitUserAction: boolean) {
    if (!explicitUserAction || this.closing) throw new Error("Explicit managed skill source review required");
    const grant = this.skillRoots.find(row => row.id === identity.grantId); if (!grant) throw new Error("Skill source root is not currently granted");
    return this.managedSkills().review(actionId, grant, identity, label, updateLineageId);
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
  attachManagedSkill(scope: ToolScope, versionId: string, explicitUserAction: boolean) {
    if (!explicitUserAction) throw new Error("Explicit managed skill attachment required"); this.scope(scope);
    const local = this.selections.get(JSON.stringify([scope.taskId, scope.generation]))?.skills ?? [];
    const existing = this.managedSkills().selected(scope); const incoming = this.managedSkills().content(versionId); const version = this.managedSkills().version(versionId)!;
    const retained = existing.filter(skill => skill.grantId !== `managed:${version.lineageId}`);
    if (local.length + retained.length + 1 > 16 || local.reduce((bytes, row) => bytes + row.bytes, 0) + retained.reduce((bytes, row) => bytes + row.bytes, 0) + incoming.bytes > 128 * 1024) throw new Error("Selected skill combined content limit exceeded");
    return this.managedSkills().attach(scope, versionId);
  }
  detachManagedSkill(scope: ToolScope, versionId: string, explicitUserAction: boolean) {
    if (!explicitUserAction) throw new Error("Explicit managed skill detachment required"); this.scope(scope); this.managedSkills().detach(scope, versionId);
  }
  revokeManagedSkill(versionId: string, forget: boolean, explicitUserAction: boolean) {
    if (!explicitUserAction || this.closing) throw new Error("Explicit managed skill revoke/forget required"); return this.managedSkills().revoke(versionId, forget);
  }
  resolveEvidence(task: AgentTask, reference: AgentEvidenceReference) { return this.getHost().resolveTerminalEvidence(task, reference); }
  async close(): Promise<void> {
    if (this.closing) return; this.closing = true;
    this.options.browserTools?.invalidate();
    this.options.desktopTools?.invalidate();
    for (const provider of this.options.builtins ?? []) provider.invalidate?.();
    await this.configSettling;
    await this.installer.close();
    // A native input may outlive its soft observation wait; release its actual owner first.
    await this.options.desktopTools?.close();
    await this.host?.close(); await Promise.allSettled([...this.pending]); this.host = undefined;
    this.managedSkillStore?.close(); this.managedSkillStore = undefined;
  }
}
export const createAgentToolsComposition = (options: AgentToolsCompositionOptions) => new AgentToolsComposition(options);
