import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ManagedMcpInstaller, OFFICIAL_MCP_CATALOG, OwnedBunInstallerProcess, reviewBunInstallGraph, type InstallerProcessPort } from "../src/agent-tools/installer";
import { createAgentToolsComposition } from "../src/agent-tools/composition";
import { verifyRecipeFiles } from "../src/agent-tools/config";
import { sha256 } from "../src/agent-tools/config";
import { writePrivateMetadata } from "../src/agent-tools/private-metadata";

const directories: string[] = []; const owners: ManagedMcpInstaller[] = [];
afterEach(async () => { for (const owner of owners.splice(0)) await owner.close(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function temp() { const root = realpathSync(mkdtempSync(join(tmpdir(), "nekodex-install-"))); directories.push(root); return root; }
const recipe = OFFICIAL_MCP_CATALOG[0];
function lock() { return JSON.stringify({ lockfileVersion: 1, configVersion: 1, workspaces: { "": { name: "nekodex-owned-mcp-install", dependencies: { [recipe.package]: recipe.version } } }, packages: { [recipe.package]: [`${recipe.package}@${recipe.version}`, "", {}, recipe.integrity] } }); }
function fakePort(calls: string[]): InstallerProcessPort { return { async run(input) {
  calls.push(input.operation); input.onPid(12345);
  if (input.operation === "prepare") writeFileSync(join(input.cwd, "bun.lock"), lock());
  else { const root = join(input.cwd, "node_modules", recipe.package); mkdirSync(join(root, "dist"), { recursive: true }); writeFileSync(join(root, "package.json"), JSON.stringify({ name: recipe.package, version: recipe.version, bin: { [recipe.bin]: recipe.entrypoint } })); writeFileSync(join(root, recipe.entrypoint), 'process.exit(0);\n'); }
} }; }
test("prepared exact official graph installs once, stays disabled through config review, detects tree drift, and archives without deleting data", async () => {
  const home = temp(); const allowed = temp(); const calls: string[] = []; const owner = new ManagedMcpInstaller(home, fakePort(calls)); owners.push(owner);
  const admitted = owner.prepare("stable-install", recipe.id, allowed); expect(admitted.state).toBe("preparing");
  await owner.waitForIdle(); const prepared = owner.receipt("stable-install")!; expect(prepared.state).toBe("prepared"); expect(prepared.graph?.[0]?.integrity).toBe(recipe.integrity);
  expect(() => owner.install("stable-install", "0".repeat(64))).toThrow("approval required");
  expect(owner.install("stable-install", prepared.graphSha256!).state).toBe("installing"); expect(owner.install("stable-install", prepared.graphSha256!).state).toBe("installing");
  await owner.waitForIdle(); const installed = owner.receipt("stable-install")!; expect(installed.state).toBe("installed"); expect(calls).toEqual(["prepare", "install"]);
  // The effect reached promotion. Restore its durable pre-terminal receipt to simulate lost final save.
  const receiptPath = join(home, "agent-mcp-installs", "receipts", `${sha256("stable-install")}.json`);
  writePrivateMetadata(receiptPath, { ...installed, state: "installing", owner: "lost-promotion-owner", tree: undefined, entrySha256: undefined });
  expect(owner.receipt("stable-install")?.state).toBe("installed"); expect(calls).toEqual(["prepare", "install"]);
  expect(existsSync(join(home, "agent-tools.json"))).toBe(false);
  const composition = createAgentToolsComposition({ home, authorize: () => true, isScopeActive: () => true });
  try {
    const review = composition.reviewInstalled("stable-install", true); expect(review.recipe.enabled).toBe(false); expect(review.recipe.managedInstallation?.treeSha256).toBe(installed.tree?.sha256);
    await expect(composition.saveServer(review.reviewId, true, true)).rejects.toThrow("saved disabled");
    await composition.saveServer(review.reviewId, false, true); expect(composition.status().config.servers[0]?.enabled).toBe(false);
    const entry = review.recipe.pinnedFiles[0]!.path; writeFileSync(entry, "Modified installed code"); expect(() => verifyRecipeFiles(review.recipe)).toThrow("dependency tree changed");
    writeFileSync(join(allowed, "keep-user-data.txt"), "Preserve explicit user data");
    const archived = await composition.uninstallManaged("stable-install", true); expect(archived.state).toBe("archived"); expect(existsSync(installed.runtime!)).toBe(false); expect(existsSync(archived.archive!)).toBe(true);
    writePrivateMetadata(receiptPath, { ...archived, state: "archiving", owner: "lost-archive-owner" });
    expect(owner.receipt("stable-install")).toMatchObject({ state: "archived", archive: archived.archive });
    expect(owner.uninstall("stable-install").archive).toBe(archived.archive);
    expect(readFileSync(join(allowed, "keep-user-data.txt"), "utf8")).toBe("Preserve explicit user data"); expect(composition.status().config.servers).toHaveLength(1); expect(composition.status().config.servers[0]!.enabled).toBe(false);
  } finally { await composition.close(); }
});
test("cancel archive intent reconciles an observed rename without moving staging again", async () => {
  const home = temp(); const allowed = temp(); const owner = new ManagedMcpInstaller(home, fakePort([])); owners.push(owner);
  owner.prepare("cancel-archive", recipe.id, allowed); await owner.waitForIdle();
  const cancelled = await owner.cancel("cancel-archive"); expect(cancelled.state).toBe("cancelled"); expect(existsSync(cancelled.archive!)).toBe(true);
  const path = join(home, "agent-mcp-installs", "receipts", `${sha256("cancel-archive")}.json`);
  writePrivateMetadata(path, { ...cancelled, state: "archiving", owner: "lost-cancel-owner" });
  expect(owner.receipt("cancel-archive")).toMatchObject({ state: "cancelled", archive: cancelled.archive });
  expect((await owner.cancel("cancel-archive")).archive).toBe(cancelled.archive);
});
test("lost owner pending receipt remains unknown without replay; cancellation waits for owned terminal outcome", async () => {
  const home = temp(); const allowed = temp(); let started!: () => void; const boundary = new Promise<void>(resolve => { started = resolve; }); let calls = 0;
  const port: InstallerProcessPort = { async run(input) { calls++; input.onPid(34567); started(); await new Promise<void>((_resolve, reject) => input.signal.addEventListener("abort", () => reject(new Error("fixture cancelled after owner boundary")), { once: true })); } };
  const owner = new ManagedMcpInstaller(home, port); owners.push(owner); owner.prepare("interrupted", recipe.id, allowed); await boundary;
  const reopened = new ManagedMcpInstaller(home, port); owners.push(reopened);
  expect(reopened.receipt("interrupted")?.state).toBe("outcome_unknown"); expect(reopened.prepare("interrupted", recipe.id, allowed).state).toBe("outcome_unknown");
  expect(reopened.install("interrupted", "0".repeat(64)).state).toBe("outcome_unknown"); expect(calls).toBe(1);
  await expect(reopened.cancel("interrupted")).rejects.toThrow("owner/outcome");
  const cancelled = await owner.cancel("interrupted"); expect(cancelled.state).toBe("cancelled"); expect(cancelled.archive).toBeDefined(); expect(owner.activeCount).toBe(0);
});
test("lock review refuses unsupported sources or changed official integrity", () => {
  const current = JSON.parse(lock()); current.lockfileVersion = 2;
  expect(reviewBunInstallGraph(JSON.stringify(current), recipe.id).graph[0]?.integrity).toBe(recipe.integrity);
  const graph = JSON.parse(lock()); graph.packages[recipe.package][1] = "https://arbitrary.invalid/archive.tgz";
  expect(() => reviewBunInstallGraph(JSON.stringify(graph), recipe.id)).toThrow("official registry");
  graph.packages[recipe.package][1] = ""; graph.packages[recipe.package][3] = `sha512-${Buffer.alloc(64).toString("base64")}`;
  expect(() => reviewBunInstallGraph(JSON.stringify(graph), recipe.id)).toThrow("registry integrity");
});
test("actual owned Bun prepare/frozen install ignores root lifecycle scripts in an inert zero-dependency fixture", async () => {
  const cwd = temp(); const marker = join(cwd, "must-not-execute");
  writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "nekodex-inert-installer-fixture", private: true, scripts: { postinstall: `echo BAD > ${marker}` } }));
  writeFileSync(join(cwd, "bunfig.toml"), '[install]\nregistry = "https://registry.npmjs.org"\n');
  const runner = new OwnedBunInstallerProcess(); const pids: number[] = []; const signal = new AbortController().signal;
  await runner.run({ cwd, operation: "prepare", signal, onPid: pid => pids.push(pid) });
  await runner.run({ cwd, operation: "install", signal, onPid: pid => pids.push(pid) });
  expect(pids).toHaveLength(2); expect(existsSync(marker)).toBe(false);
  for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
});
