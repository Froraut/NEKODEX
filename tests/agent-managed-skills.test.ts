import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentToolsComposition, type AgentToolsComposition } from "../src/agent-tools/composition";
import { ManagedSkillStore } from "../src/agent-tools/managed-skills";
import { ReadOnlySkillLibrary, snapshotLocalSkillSource } from "../src/agent-tools/skills";

const directories: string[] = []; const compositions: AgentToolsComposition[] = []; const stores: ManagedSkillStore[] = [];
afterEach(async () => { for (const composition of compositions.splice(0)) await composition.close(); for (const store of stores.splice(0)) { try { store.close(); } catch {} } for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function temp() { const root = realpathSync(mkdtempSync(join(tmpdir(), "nekodex-managed-skills-"))); directories.push(root); return root; }
test("real local import/update preserves old generation copy, recovers terminal receipt, and retains revoked references", async () => {
  const home = temp(); const source = temp(); const path = join(source, "SKILL.md");
  const v1 = "\ufeffTemporary local instruction version one.\nТекст 🎯\n"; const v2 = "Temporary local instruction version two.\n";
  writeFileSync(path, v1); let generation = 1;
  const make = () => { const composition = createAgentToolsComposition({ home, authorize: request => request.headers.get("authorization") === "fixture", isScopeActive: scope => scope.taskId === "fixture-task" && scope.generation === generation }); compositions.push(composition); return composition; };
  let composition = make(); const scope = { taskId: "fixture-task", generation: 1, toolCallId: "skill-selection" };
  const post = async (body: unknown) => {
    const response = (await composition.handle(new Request("http://127.0.0.1/admin/agent-tools", { method: "POST", headers: { authorization: "fixture", "content-type": "application/json" }, body: JSON.stringify(body) })))!;
    const payload = await response.json() as any; if (!response.ok || !payload.ok) throw new Error(payload.message ?? "Fixture admin action failed"); return payload.value;
  };
  const root = composition.addSkillRoot({ root: source, label: "Explicit temporary source" }, true);
  let selected = composition.discoverSkills(root.id).skills[0]!;
  const review = await post({ action: "reviewSkillImport", actionId: "import-v1", identity: selected, label: "Fixture instructions", explicitUserAction: true });
  expect(review.action.state).toBe("reviewed"); expect(review.content).toBe(v1); expect(composition.selectedSkillContent(scope)).toEqual([]);
  expect(() => composition.commitSkillImport("import-v1", "0".repeat(64), true)).toThrow("approval required");
  const imported = await post({ action: "commitSkillImport", actionId: "import-v1", reviewDigest: review.action.reviewDigest, explicitUserAction: true }); expect(imported.state).toBe("imported");
  const target = join(imported.target, "SKILL.md"); expect(readFileSync(target, "utf8")).toBe(v1); expect(existsSync(imported.stage)).toBe(false);
  const inode = statSync(target).ino; await composition.close();
  // A valid fixture reached published bytes. Restore the exact pre-terminal metadata boundary.
  const db = new Database(join(home, "managed-skills", "metadata.sqlite"));
  db.transaction(() => { db.query("DELETE FROM skill_versions WHERE id=?").run(imported.versionId); db.query("UPDATE skill_actions SET receipt=? WHERE id=?").run(JSON.stringify({ ...imported, state: "committing" }), imported.actionId); })(); db.close();
  composition = make(); expect(composition.managedSkillAction("import-v1")?.action.state).toBe("imported"); expect(statSync(target).ino).toBe(inode);
  expect(composition.status().managedSkills.retainedVersions).toBe(1); expect(composition.selectedSkillContent(scope)).toEqual([]);
  await post({ action: "attachManagedSkill", scope, versionId: imported.versionId, explicitUserAction: true }); expect(composition.selectedSkillContent(scope)[0]?.content).toBe(v1);
  writeFileSync(path, v2); expect(composition.selectedSkillContent(scope)[0]?.content).toBe(v1);
  selected = composition.discoverSkills(root.id).skills[0]!;
  const stale = composition.reviewSkillImport("stale-update", selected, "Fixture instructions v2", imported.lineageId, true);
  writeFileSync(path, "Changed after the explicit source review\n");
  expect(() => composition.commitSkillImport(stale.action.actionId, stale.action.reviewDigest, true)).toThrow(); expect(composition.status().managedSkills.retainedVersions).toBe(1);
  writeFileSync(path, v2); selected = composition.discoverSkills(root.id).skills[0]!;
  const update = composition.reviewSkillImport("fresh-update", selected, "Fixture instructions v2", imported.lineageId, true);
  const updated = composition.commitSkillImport(update.action.actionId, update.action.reviewDigest, true);
  expect(updated.versionId).not.toBe(imported.versionId); expect(updated.lineageId).toBe(imported.lineageId); expect(composition.selectedSkillContent(scope)[0]?.content).toBe(v1);
  composition.attachManagedSkill(scope, updated.versionId, true); expect(composition.selectedSkillContent(scope)[0]?.content).toBe(v2);
  generation = 2; const currentScope = { ...scope, generation };
  expect(() => composition.attachManagedSkill(scope, imported.versionId, true)).toThrow("Current owned"); expect(composition.selectedSkillContent(currentScope)).toEqual([]);
  composition.attachManagedSkill(currentScope, imported.versionId, true);
  composition.removeSkillRoot(root.id, true); expect(composition.selectedSkillContent(currentScope)[0]?.content).toBe(v1);
  composition.revokeManagedSkill(imported.versionId, false, true); expect(() => composition.selectedSkillContent(currentScope)).toThrow("revoked");
  composition.detachManagedSkill(currentScope, imported.versionId, true); composition.attachManagedSkill(currentScope, updated.versionId, true);
  composition.revokeManagedSkill(updated.versionId, true, true); expect(() => composition.selectedSkillContent(currentScope)).toThrow("revoked");
  expect(readFileSync(target, "utf8")).toBe(v1); expect(readFileSync(join(updated.target, "SKILL.md"), "utf8")).toBe(v2);
  expect(composition.status().managedSkills).toMatchObject({ retainedVersions: 2, forgottenVersions: 1 });
  expect(composition.status().managedSkills.attachments.find(row => row.scope.generation === 2)?.versionIds).toEqual([updated.versionId]);
});
test("admitted missing-target import is unknown and never copies on retry; plugin source imports are refused", () => {
  const home = temp(); const source = temp(); writeFileSync(join(source, "SKILL.md"), "Inert local source text.");
  const grant = { id: "local", root: source, source: "user" as const, label: "Local source" }; const library = new ReadOnlySkillLibrary([grant]); const selected = library.discover(grant.id).skills[0]!;
  const store = new ManagedSkillStore(home); stores.push(store); const review = store.review("unknown-copy", grant, selected, "Local source");
  const db = new Database(join(home, "managed-skills", "metadata.sqlite")); db.query("UPDATE skill_actions SET receipt=? WHERE id=?").run(JSON.stringify({ ...review.action, state: "committing" }), review.action.actionId); db.close();
  expect(store.action(review.action.actionId)?.state).toBe("outcome_unknown");
  expect(() => store.commit(review.action.actionId, review.action.reviewDigest, grant)).toThrow("unknown import cannot replay"); expect(existsSync(review.action.target)).toBe(false); expect(existsSync(review.action.stage)).toBe(true);
  expect(() => snapshotLocalSkillSource({ ...grant, source: "official-plugin" }, { ...selected, source: "official-plugin" })).toThrow("local user/workspace");
  const codex = temp(); const actualPlugins = temp(); symlinkSync(actualPlugins, join(codex, "plugins")); const pluginSkill = join(actualPlugins, "official"); mkdirSync(pluginSkill); writeFileSync(join(pluginSkill, "SKILL.md"), "Inert plugin text fixture.");
  const prior = process.env.CODEX_HOME; process.env.CODEX_HOME = codex;
  try {
    const pluginGrant = { ...grant, root: pluginSkill }; const identity = new ReadOnlySkillLibrary([pluginGrant]).discover(grant.id).skills[0]!;
    expect(() => snapshotLocalSkillSource(pluginGrant, identity)).toThrow("plugin distributions");
  } finally { if (prior === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = prior; }
});
test("small action/text budgets reject new intents while preserving exact review retries and retained bytes", () => {
  const source = temp(); const text = "Inert bounded review text."; writeFileSync(join(source, "SKILL.md"), text);
  const grant = { id: "local", root: source, source: "user" as const, label: "Bounded source" }; const selected = new ReadOnlySkillLibrary([grant]).discover(grant.id).skills[0]!;
  const actionHome = temp(); const actions = new ManagedSkillStore(actionHome, { maxActions: 1 }); stores.push(actions);
  const first = actions.review("retained", grant, selected, "Retained source");
  expect(actions.review("retained", grant, selected, "Retained source").action).toEqual(first.action);
  expect(() => actions.review("over-action-limit", grant, selected, "Additional source")).toThrow("capacity reached"); expect(actions.action("over-action-limit")).toBeUndefined();
  expect(readFileSync(join(first.action.stage, "SKILL.md"), "utf8")).toBe(text);
  const bytes = new ManagedSkillStore(temp(), { maxRetainedTextBytes: Buffer.byteLength(text) * 2 }); stores.push(bytes);
  expect(() => bytes.review("forged-size", grant, { ...selected, bytes: 0 }, "Forged source size")).toThrow("identity or digest"); expect(bytes.action("forged-size")).toBeUndefined();
  const copy = bytes.review("full-text-budget", grant, selected, "Retained source");
  expect(bytes.review("full-text-budget", grant, selected, "Retained source").action).toEqual(copy.action);
  expect(() => bytes.review("over-byte-limit", grant, selected, "Additional source")).toThrow("capacity reached"); expect(bytes.action("over-byte-limit")).toBeUndefined();
  expect(bytes.list().capacity.reservedTextBytes).toBe(Buffer.byteLength(text) * 2); expect(readFileSync(join(copy.action.stage, "SKILL.md"), "utf8")).toBe(text);
});
