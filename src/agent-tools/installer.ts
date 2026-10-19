import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { readPrivateMetadata, writePrivateMetadata } from "./private-metadata";
import { sha256, type ServerRecipe } from "./config";
import { installedTreeDigest } from "./package-tree";

/** Reviewed immutable package selections. Registry publisher metadata is evidence, not signature verification. */
export interface OfficialMcpRecipe {
  id: string; label: string; package: string; version: string; integrity: string;
  bin: string; entrypoint: string; registry: string; source: string; capabilities: string;
  publisher: { organization: string; registryIdentity: string; trustedPublisherId: string; verification: "registry-metadata-only" };
  sourcePin: { kind: "npm-archive-sha512"; url: string; integrity: string; entrySha256: string };
  runtime: { family: "bun"; version: "1.4.0"; upstreamNodeEngine: "not-declared"; verification: "filesystem-live-only" | "not-run" };
  auth: { kind: "none"; oauth: false };
  sandbox: { provider: "macos-seatbelt"; network: "denied"; data: "selected-directory" | "memory-file-in-selected-directory" | "none"; otherPlatforms: "unavailable" };
  launch: "filesystem-root" | "memory-file" | "no-arguments";
  dependencyReview: "exact-transitive-graph-before-install";
}
const officialRecipe = (input: Pick<OfficialMcpRecipe, "id" | "label" | "package" | "integrity" | "bin" | "capabilities" | "launch"> & { directory: string; entrySha256: string; publisherId: string; data: OfficialMcpRecipe["sandbox"]["data"] }): OfficialMcpRecipe => ({
  id: input.id, label: input.label, package: input.package, version: "1.0.0", integrity: input.integrity,
  bin: input.bin, entrypoint: "dist/index.js", registry: "https://registry.npmjs.org",
  source: `https://github.com/modelcontextprotocol/servers/tree/main/src/${input.directory}`,
  capabilities: input.capabilities,
  publisher: { organization: "Model Context Protocol a Series of LF Projects, LLC.", registryIdentity: "GitHub Actions (npm-oidc-no-reply@github.com)", trustedPublisherId: input.publisherId, verification: "registry-metadata-only" },
  sourcePin: { kind: "npm-archive-sha512", url: `https://registry.npmjs.org/${input.package}/-/server-${input.package.split("server-")[1]}-1.0.0.tgz`, integrity: input.integrity, entrySha256: input.entrySha256 },
  runtime: { family: "bun", version: "1.4.0", upstreamNodeEngine: "not-declared", verification: input.id === "official-filesystem" ? "filesystem-live-only" : "not-run" },
  auth: { kind: "none", oauth: false },
  sandbox: { provider: "macos-seatbelt", network: "denied", data: input.data, otherPlatforms: "unavailable" },
  launch: input.launch, dependencyReview: "exact-transitive-graph-before-install",
});
export const OFFICIAL_MCP_CATALOG: readonly OfficialMcpRecipe[] = [
  officialRecipe({ id: "official-filesystem", label: "Official MCP Filesystem", package: "@modelcontextprotocol/server-filesystem", integrity: "sha512-2fN6qhpsiPSBAe0ev1qDPk4sCWdULCZQTuYc4ZY7+BDWQ1XCxLB+7dqStF2ZflgG4G/9vTwQsjxh7pjFqrrpcg==", bin: "mcp-server-filesystem", directory: "filesystem", entrySha256: "68e6aae96c907bf00089dd48b9f2fdd06113e6588d9915f19852cb468f9296d8", publisherId: "5734d7de-e554-4200-8ccc-50933124df3d", data: "selected-directory", launch: "filesystem-root", capabilities: "Read/write filesystem tools in the explicitly selected directory. Tool inventory is discovered after a separate connection. Server path policy alone is not OS isolation." }),
  officialRecipe({ id: "official-sequential-thinking", label: "Official MCP Sequential Thinking", package: "@modelcontextprotocol/server-sequential-thinking", integrity: "sha512-ykTmeS4Eejs+FESDrD73mDBNYCkb+cCZJ1MWuv7/vwucbVgGfEbBL5HVt2nVw0/vNF8jz+o9sO/WmxxfXt0J6w==", bin: "mcp-server-sequential-thinking", directory: "sequentialthinking", entrySha256: "99182c997de7d0d317e65bd07e6890cacde83dad670dca2488cadfde1e58c737", publisherId: "4c7619b6-28cd-43b8-8e56-a49c0c9204d6", data: "none", launch: "no-arguments", capabilities: "Structured thought/branch bookkeeping in the server process; no model or independent reasoning provider. Thought logging is disabled. Runtime and actual tool discovery are not yet verified for this recipe." }),
  officialRecipe({ id: "official-memory", label: "Official MCP Memory", package: "@modelcontextprotocol/server-memory", integrity: "sha512-UDMtMrw2xeI16mcn7O4fesp9Pf3hYh91thuU5KSz0BxKqwnTwEytZKjHfkrqxxmKp0r4QHoiEkMV99UmadmODw==", bin: "mcp-server-memory", directory: "memory", entrySha256: "3152ff0b3df6d345ffd67270053c3287d7e8cb8a24d832d18e8eadc5ffd10a08", publisherId: "237904c1-7b70-431f-8d66-c320993d63a3", data: "memory-file-in-selected-directory", launch: "memory-file", capabilities: "Persistent entities, relations and observations in nekodex-memory.jsonl inside the explicitly selected directory. Data is shared by tasks using this server. Runtime and actual tool discovery are not yet verified for this recipe." }),
];
/** Only these reviewed non-secret settings may enter a server environment. */
export function managedMcpLaunchPlan(catalogId: string, allowedRoot: string): { args: string[]; env: NonNullable<ServerRecipe["env"]>; readData: boolean; writeData: boolean } {
  const recipe = OFFICIAL_MCP_CATALOG.find(row => row.id === catalogId);
  if (!recipe) throw new Error("Unsupported managed MCP recipe");
  if (recipe.launch === "filesystem-root") return { args: [allowedRoot], env: {}, readData: true, writeData: true };
  if (recipe.launch === "memory-file") return { args: [], env: { MEMORY_FILE_PATH: join(allowedRoot, "nekodex-memory.jsonl") }, readData: true, writeData: true };
  return { args: [], env: { DISABLE_THOUGHT_LOGGING: "true" }, readData: false, writeData: false };
}
export interface InstallGraphNode { name: string; version: string; integrity: string }
export interface McpInstallReceipt {
  version: 1; actionId: string; fingerprint: string; catalogId: string; allowedRoot: string;
  state: "preparing" | "prepared" | "installing" | "installed" | "failed" | "cancelled" | "archiving" | "archived" | "outcome_unknown";
  owner: string; stage: string; runtime?: string; archive?: string; childPid?: number;
  lockSha256?: string; graph?: InstallGraphNode[]; graphSha256?: string;
  tree?: { sha256: string; files: number }; entrySha256?: string; reason?: string;
  archiveIntent?: { kind: "uninstall" | "cancel"; source: string; target: string; actionId: string; fingerprint: string };
  promotion?: { source: string; target: string; tree: { sha256: string; files: number }; entrySha256: string };
}
export interface InstallerProcessPort {
  run(input: { cwd: string; operation: "prepare" | "install"; signal: AbortSignal; onPid: (pid: number) => void }): Promise<void>;
}
/** Only Bun's fixed install operation; no package bin, shell, user npm config or lifecycle code. */
export class OwnedBunInstallerProcess implements InstallerProcessPort {
  constructor(readonly bunPath = realpathSync(process.execPath)) {}
  async run(input: { cwd: string; operation: "prepare" | "install"; signal: AbortSignal; onPid: (pid: number) => void }): Promise<void> {
    if (!/^bun(?:\.exe)?$/.test(basename(this.bunPath))) throw new Error("Managed MCP installation requires the owned Bun runtime");
    const privateHome = join(input.cwd, ".installer-home"); mkdirSync(privateHome, { recursive: true, mode: 0o700 });
    const args = ["install", "--ignore-scripts", "--registry=https://registry.npmjs.org", "--no-progress", "--no-summary", `--config=${join(input.cwd, "bunfig.toml")}`, `--cache-dir=${join(input.cwd, ".installer-cache")}`, ...(input.operation === "prepare" ? ["--lockfile-only"] : ["--frozen-lockfile"])];
    input.signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const child: ChildProcess = spawn(this.bunPath, args, { cwd: input.cwd, shell: false, windowsHide: true, env: { HOME: privateHome, PATH: dirname(this.bunPath), NPM_CONFIG_IGNORE_SCRIPTS: "true", BUN_CONFIG_NO_CLEAR_TERMINAL: "1" }, stdio: ["ignore", "ignore", "ignore"] });
      let escalation: ReturnType<typeof setTimeout> | undefined;
      let pidReceiptFailed = false;
      let stopped = false;
      const stop = () => { stopped = true; if (child.exitCode === null) { child.kill("SIGTERM"); escalation = setTimeout(() => { if (child.exitCode === null) child.kill("SIGKILL"); }, 2000); } };
      const timeout = setTimeout(stop, 90_000);
      input.signal.addEventListener("abort", stop, { once: true });
      child.once("spawn", () => { try { input.onPid(child.pid!); } catch { pidReceiptFailed = true; stop(); } if (input.signal.aborted) stop(); });
      child.once("error", () => { clearTimeout(timeout); if (escalation) clearTimeout(escalation); input.signal.removeEventListener("abort", stop); reject(new Error("Owned installer process could not start")); });
      child.once("close", code => { clearTimeout(timeout); if (escalation) clearTimeout(escalation); input.signal.removeEventListener("abort", stop); code === 0 && !input.signal.aborted && !pidReceiptFailed && !stopped ? resolve() : reject(new Error("Owned installer process did not complete successfully")); });
    });
  }
}
export function reviewBunInstallGraph(lockBytes: string, catalogId: string): { graph: InstallGraphNode[]; lockSha256: string; graphSha256: string } {
  const recipe = OFFICIAL_MCP_CATALOG.find(row => row.id === catalogId); if (!recipe || Buffer.byteLength(lockBytes) > 1024 * 1024) throw new Error("Unsupported or oversized install graph");
  const lock = Bun.JSONC.parse(lockBytes) as any;
  if (![1, 2].includes(lock.lockfileVersion) || !lock.packages || Object.keys(lock.packages).length > 256 || Object.keys(lock.workspaces ?? {}).some(key => key !== "") || lock.trustedDependencies?.length) throw new Error("Unsupported install lock format");
  const dependencies = lock.workspaces?.[""]?.dependencies;
  if (!dependencies || Object.keys(dependencies).length !== 1 || dependencies[recipe.package] !== recipe.version) throw new Error("Install graph root does not match the reviewed official recipe");
  const graph: InstallGraphNode[] = [];
  for (const row of Object.values(lock.packages) as any[]) {
    if (!Array.isArray(row) || row.length < 4 || typeof row[0] !== "string" || !/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+@[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?$/.test(row[0]) || row[1] !== "" || typeof row[3] !== "string" || !/^sha512-[a-zA-Z0-9+/]+={0,2}$/.test(row[3])) throw new Error("Install graph requires exact official registry versions and SHA-512 integrity");
    const split = row[0].lastIndexOf("@");
    for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) for (const spec of Object.values(row[2]?.[field] ?? {})) if (typeof spec !== "string" || /(?:https?:|git|file:|link:|workspace:|npm:)/i.test(spec)) throw new Error("Install graph contains an unsupported dependency source");
    graph.push({ name: row[0].slice(0, split), version: row[0].slice(split + 1), integrity: row[3] });
  }
  graph.sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
  if (!graph.some(node => node.name === recipe.package && node.version === recipe.version && node.integrity === recipe.integrity)) throw new Error("Official MCP package pin does not match the reviewed registry integrity");
  return { graph, lockSha256: sha256(lockBytes), graphSha256: sha256(JSON.stringify(graph)) };
}
/** Private package-only transaction owner. Existing server config and user data are never deleted. */
export class ManagedMcpInstaller {
  private owner = crypto.randomUUID();
  private jobs = new Map<string, { promise: Promise<void>; abort: AbortController }>();
  private root: string;
  private stopping = false;
  constructor(home: string, private processPort: InstallerProcessPort = new OwnedBunInstallerProcess()) { this.root = join(home, "agent-mcp-installs"); }
  private path(actionId: string): string {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(actionId)) throw new Error("Invalid install action identity");
    return join(this.root, "receipts", `${sha256(actionId)}.json`);
  }
  get activeCount(): number { return this.jobs.size; }
  receipt(actionId: string): McpInstallReceipt | undefined {
    const receipt = readPrivateMetadata(this.path(actionId)) as McpInstallReceipt | undefined;
    if (receipt?.state === "archiving" && receipt.archiveIntent) {
      const intent = receipt.archiveIntent; const expectedSource = join(this.root, intent.kind === "uninstall" ? "packages" : "staging", sha256(actionId));
      if (intent.source !== expectedSource || dirname(intent.target) !== join(this.root, "archives") || !basename(intent.target).startsWith(`${sha256(actionId)}-`) || intent.actionId !== actionId || intent.fingerprint !== receipt.fingerprint) return { ...receipt, state: "outcome_unknown", reason: "Archive intent identity mismatch" };
      if (!existsSync(intent.source) && existsSync(intent.target) && this.marked(intent.target, receipt)) {
        const terminal = { ...receipt, state: intent.kind === "uninstall" ? "archived" as const : "cancelled" as const, archive: intent.target, childPid: undefined };
        this.save(terminal); return terminal;
      }
      return { ...receipt, state: "outcome_unknown", reason: "Exact archive intent retained; source/target terminal ownership is unestablished" };
    }
    if (receipt && ["installing", "outcome_unknown"].includes(receipt.state) && receipt.promotion) {
      const promotion = receipt.promotion; const target = join(this.root, "packages", sha256(actionId));
      if (promotion.target === target && promotion.source === join(this.root, "staging", sha256(actionId)) && !existsSync(promotion.source) && existsSync(target) && this.marked(target, receipt)) {
        const catalog = OFFICIAL_MCP_CATALOG.find(row => row.id === receipt.catalogId);
        if (catalog) {
          const tree = installedTreeDigest(join(target, "node_modules"));
          const entrySha256 = sha256(readFileSync(join(target, "node_modules", catalog.package, catalog.entrypoint)));
          if (tree.sha256 === promotion.tree.sha256 && tree.files === promotion.tree.files && entrySha256 === promotion.entrySha256 && sha256(readFileSync(join(target, "bun.lock"))) === receipt.lockSha256) {
            const terminal = { ...receipt, state: "installed" as const, runtime: target, tree, entrySha256, childPid: undefined, reason: undefined };
            this.save(terminal); return terminal;
          }
        }
      }
    }
    if (receipt && ["preparing", "installing", "archiving"].includes(receipt.state) && (!this.jobs.has(actionId) || receipt.owner !== this.owner)) return { ...receipt, state: "outcome_unknown", reason: "Previous installer owner terminal outcome is unestablished; no automatic replay" };
    return receipt;
  }
  list() {
    const directory = join(this.root, "receipts"); if (!existsSync(directory)) return { rows: [], truncated: false };
    const paths = readdirSync(directory).filter(name => /^[a-f0-9]{64}\.json$/.test(name));
    const rows = paths.slice(0, 64).map(name => readPrivateMetadata(join(directory, name)) as McpInstallReceipt).map(row => {
      const receipt = this.receipt(row.actionId)!;
      return { actionId: receipt.actionId, catalogId: receipt.catalogId, state: receipt.state, allowedRoot: receipt.allowedRoot, graphSha256: receipt.graphSha256, childPid: receipt.childPid };
    }); return { rows, truncated: paths.length > rows.length };
  }
  private save(receipt: McpInstallReceipt): void { writePrivateMetadata(this.path(receipt.actionId), receipt); }
  private marked(path: string, receipt: McpInstallReceipt): boolean {
    try {
      if (!lstatSync(path).isDirectory() || realpathSync(path) !== path) return false;
      const marker = readPrivateMetadata(join(path, ".nekodex-install-owner.json")) as any;
      return marker?.actionId === receipt.actionId && marker?.fingerprint === receipt.fingerprint;
    } catch { return false; }
  }
  private assertOwned(receipt: McpInstallReceipt): void {
    if (receipt.stage !== join(this.root, "staging", sha256(receipt.actionId))) throw new Error("Install staging ownership mismatch");
    const marker = readPrivateMetadata(join(receipt.stage, ".nekodex-install-owner.json")) as any;
    if (marker?.actionId !== receipt.actionId || marker?.fingerprint !== receipt.fingerprint) throw new Error("Install ownership marker mismatch");
  }
  prepare(actionId: string, catalogId: string, allowedRoot: string): McpInstallReceipt {
    if (this.stopping) throw new Error("Installer is stopping");
    const recipe = OFFICIAL_MCP_CATALOG.find(row => row.id === catalogId); if (!recipe) throw new Error("Unsupported managed MCP recipe");
    const canonicalRoot = realpathSync(allowedRoot); if (!lstatSync(canonicalRoot).isDirectory()) throw new Error("Select an existing explicit allowed directory");
    const fingerprint = sha256(JSON.stringify([catalogId, canonicalRoot, recipe.version, recipe.integrity]));
    const prior = this.receipt(actionId); if (prior) { if (prior.fingerprint !== fingerprint) throw new Error("Install action identity conflict"); return prior; }
    if (this.jobs.size) throw new Error("An owned installer transaction is already active");
    const stage = join(this.root, "staging", sha256(actionId));
    if (existsSync(stage)) throw new Error("Unknown staging exists; reconcile its owner before installing");
    const receipt: McpInstallReceipt = { version: 1, actionId, fingerprint, catalogId, allowedRoot: canonicalRoot, state: "preparing", owner: this.owner, stage };
    this.save(receipt);
    this.launch(receipt, async (signal, updatePid) => {
      mkdirSync(stage, { recursive: true, mode: 0o700 });
      writePrivateMetadata(join(stage, ".nekodex-install-owner.json"), { actionId, fingerprint });
      writeFileSync(join(stage, "package.json"), JSON.stringify({ name: "nekodex-owned-mcp-install", private: true, dependencies: { [recipe.package]: recipe.version } }), { mode: 0o600, flag: "wx" });
      writeFileSync(join(stage, "bunfig.toml"), '[install]\nregistry = "https://registry.npmjs.org"\n', { mode: 0o600, flag: "wx" });
      await this.processPort.run({ cwd: stage, operation: "prepare", signal, onPid: updatePid });
      const graph = reviewBunInstallGraph(readFileSync(join(stage, "bun.lock"), "utf8"), catalogId);
      this.save({ ...receipt, ...graph, childPid: undefined, state: "prepared" });
    });
    return receipt;
  }
  install(actionId: string, reviewedGraphSha256: string): McpInstallReceipt {
    const receipt = this.receipt(actionId); if (!receipt) throw new Error("Install preparation receipt missing");
    if (receipt.state === "installed" || ["preparing", "installing", "archiving", "outcome_unknown", "archived", "cancelled", "failed"].includes(receipt.state)) return receipt;
    if (this.stopping || this.jobs.size || receipt.state !== "prepared" || receipt.graphSha256 !== reviewedGraphSha256) throw new Error("Exact prepared dependency graph approval required");
    this.assertOwned(receipt);
    const graph = reviewBunInstallGraph(readFileSync(join(receipt.stage, "bun.lock"), "utf8"), receipt.catalogId);
    if (graph.lockSha256 !== receipt.lockSha256 || graph.graphSha256 !== receipt.graphSha256) throw new Error("Reviewed install lock changed");
    const admitted = { ...receipt, owner: this.owner, state: "installing" as const }; this.save(admitted);
    this.launch(admitted, async (signal, updatePid) => {
      await this.processPort.run({ cwd: receipt.stage, operation: "install", signal, onPid: updatePid });
      if (sha256(readFileSync(join(receipt.stage, "bun.lock"))) !== receipt.lockSha256) throw new Error("Frozen install lock changed");
      const recipe = OFFICIAL_MCP_CATALOG.find(row => row.id === receipt.catalogId)!;
      const packageRoot = join(receipt.stage, "node_modules", recipe.package);
      const metadata = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
      if (metadata.name !== recipe.package || metadata.version !== recipe.version || metadata.bin?.[recipe.bin] !== recipe.entrypoint) throw new Error("Installed package metadata or entrypoint mismatch");
      const entry = join(packageRoot, recipe.entrypoint); if (!lstatSync(entry).isFile() || realpathSync(entry) !== entry) throw new Error("Installed entrypoint must be a canonical regular file");
      const tree = installedTreeDigest(join(receipt.stage, "node_modules"));
      const runtime = join(this.root, "packages", sha256(actionId)); mkdirSync(dirname(runtime), { recursive: true, mode: 0o700 });
      if (existsSync(runtime)) throw new Error("Existing package runtime must be reconciled, never overwritten");
      const entrySha256 = sha256(readFileSync(entry));
      const promotion = { source: receipt.stage, target: runtime, tree, entrySha256 };
      this.save({ ...admitted, runtime, promotion });
      renameSync(receipt.stage, runtime);
      this.save({ ...receipt, owner: this.owner, state: "installed", runtime, promotion, childPid: undefined, tree, entrySha256 });
    });
    return admitted;
  }
  private launch(receipt: McpInstallReceipt, work: (signal: AbortSignal, onPid: (pid: number) => void) => Promise<void>): void {
    const abort = new AbortController();
    const promise = Promise.resolve().then(() => work(abort.signal, pid => this.save({ ...receipt, childPid: pid }))).catch(error => {
      // A successful rename followed by a lost receipt is not a replayable failure.
      const runtime = join(this.root, "packages", sha256(receipt.actionId));
      const safeReasons = ["Unsupported install lock format", "Install graph requires exact official registry versions and SHA-512 integrity", "Install graph contains an unsupported dependency source", "Official MCP package pin does not match the reviewed registry integrity", "Frozen install lock changed", "Installed package metadata or entrypoint mismatch", "Installed entrypoint must be a canonical regular file", "Owned installer process did not complete successfully"];
      const retained = readPrivateMetadata(this.path(receipt.actionId)) as McpInstallReceipt | undefined;
      this.save({ ...receipt, ...retained, childPid: undefined, state: existsSync(runtime) ? "outcome_unknown" : abort.signal.aborted ? "cancelled" : "failed", reason: error instanceof Error && safeReasons.includes(error.message) ? error.message : "Owned installer ended; inspect its retained staging/runtime before another action" });
    }).finally(() => this.jobs.delete(receipt.actionId));
    this.jobs.set(receipt.actionId, { promise, abort });
  }
  async cancel(actionId: string): Promise<McpInstallReceipt> {
    const job = this.jobs.get(actionId); if (job) { job.abort.abort(); await job.promise; }
    const receipt = this.receipt(actionId); if (!receipt || ["outcome_unknown", "installing", "preparing", "installed"].includes(receipt.state)) throw new Error("Installer owner/outcome must be reconciled before abandoning staging");
    if (existsSync(receipt.stage)) { this.assertOwned(receipt); return this.archive(receipt, "cancel", receipt.stage); }
    return receipt;
  }
  uninstall(actionId: string): McpInstallReceipt {
    const receipt = this.receipt(actionId); if (receipt?.state === "archived") return receipt;
    if (!receipt || receipt.state !== "installed" || !receipt.runtime || this.jobs.size) throw new Error("Exact installed package receipt required for archive");
    const expected = join(this.root, "packages", sha256(actionId)); if (receipt.runtime !== expected) throw new Error("Installed runtime ownership mismatch");
    const marker = readPrivateMetadata(join(expected, ".nekodex-install-owner.json")) as any; if (marker?.fingerprint !== receipt.fingerprint || marker?.actionId !== actionId) throw new Error("Installed runtime marker mismatch");
    return this.archive(receipt, "uninstall", expected);
  }
  private archive(receipt: McpInstallReceipt, kind: "uninstall" | "cancel", source: string): McpInstallReceipt {
    const target = join(this.root, "archives", `${sha256(receipt.actionId)}-${crypto.randomUUID()}`);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    const archiveIntent = { kind, source, target, actionId: receipt.actionId, fingerprint: receipt.fingerprint };
    this.save({ ...receipt, state: "archiving", archiveIntent, archive: target });
    if (existsSync(target) || !this.marked(source, receipt)) throw new Error("Archive source/target ownership mismatch");
    renameSync(source, target);
    const terminal = { ...receipt, state: kind === "uninstall" ? "archived" as const : "cancelled" as const, archiveIntent, archive: target, childPid: undefined };
    this.save(terminal); return terminal;
  }
  async waitForIdle(): Promise<void> { await Promise.allSettled([...this.jobs.values()].map(job => job.promise)); }
  async close(): Promise<void> { this.stopping = true; for (const job of this.jobs.values()) job.abort.abort(); await this.waitForIdle(); }
}
