import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultToolsConfig, sha256 } from "../src/agent-tools/config";
import { ManagedSkillStore } from "../src/agent-tools/managed-skills";
import { StandaloneMcpHost } from "../src/agent-tools/mcp-host";
import { ReadOnlySkillLibrary } from "../src/agent-tools/skills";
import { createSkillScriptToolsProvider, type SkillScriptExecutorPort } from "../src/agent-tools/skill-script-tools";
import type { AttachedSkillResource } from "../src/agent-tools/skill-resource-tools";

test("selected Python import stays inert and requires its own admitted runtime and existing exact tool approval", async () => {
  const temp = realpathSync(mkdtempSync(join(tmpdir(), "nekodex-python-flow-")));
  const home = join(temp, "private"), source = join(temp, "source"), workspace = join(temp, "workspace");
  for (const path of [home, source, workspace]) mkdirSync(path, { mode: 0o700 });
  mkdirSync(join(source, "scripts"));
  const marker = join(temp, "must-not-execute");
  const python = `from pathlib import Path\nPath(${JSON.stringify(marker)}).write_text('NEVER_EXECUTE_AT_IMPORT')\n`;
  const javascript = "console.log('inert helper');\n";
  writeFileSync(join(source, "SKILL.md"), "---\nname: selected-python-fixture\ndescription: Review explicitly selected inert Python source.\n---\nUse only separately approved selected resources.\n");
  writeFileSync(join(source, "scripts/entry.py"), python);
  writeFileSync(join(source, "scripts/helper.mjs"), javascript);
  const root = { id: "python-fixture", root: source, source: "workspace" as const, label: "Python review fixture" };
  const identity = new ReadOnlySkillLibrary([root]).discover(root.id).skills[0]!;
  const scope = { taskId: "python-fixture", generation: 1, toolCallId: "selection" };
  const store = new ManagedSkillStore(home);
  let provider: ReturnType<typeof createSkillScriptToolsProvider> | undefined;
  let host: StandaloneMcpHost | undefined;
  try {
    const reviewed = store.reviewPackage("python-v4", root, { identity, resources: ["scripts/entry.py", "scripts/helper.mjs"] }, "Python fixture");
    expect(reviewed.action.manifest.package).toMatchObject({ version: 4, kind: "selected-local-polyglot-package" });
    const imported = store.commit(reviewed.action.actionId, reviewed.action.reviewDigest, root);
    const attached = store.attach(scope, imported.versionId);
    expect(existsSync(marker)).toBe(false);
    expect(JSON.stringify(attached)).not.toContain("NEVER_EXECUTE_AT_IMPORT");
    const pythonIdentity = attached.resources!.find(row => row.relativePath === "scripts/entry.py")!;
    expect(pythonIdentity).toMatchObject({ kind: "script", mediaType: "text/x-python", runtime: "python", digest: sha256(python) });
    expect(attached.resources!.find(row => row.relativePath.endsWith(".mjs"))).not.toHaveProperty("runtime");
    expect(readFileSync(join(imported.target, "resources/scripts/entry.py"), "utf8")).toBe(python);
    let pythonAvailable = false, executions = 0;
    let lastInput: Parameters<SkillScriptExecutorPort["execute"]>[0] | undefined;
    const executor: SkillScriptExecutorPort = {
      capabilities: () => ({ supported: true, runtimes: { javascript: { supported: true }, python: { supported: pythonAvailable } } }),
      async execute(input) { executions++; lastInput = input; input.assertCurrent(); return { state: "completed", stdout: "inert injected executor", stderr: "", exitCode: 0, truncated: false }; },
      cancel() {},
    };
    const resources = (): AttachedSkillResource[] => store.selected(scope).flatMap(skill => (skill.resources ?? []).map(resource => {
      const { role: _role, content: _content, ...metadata } = resource as typeof resource & { content?: string };
      return { ...metadata, versionId: imported.versionId, packageDigest: attached.packageDigest! } as AttachedSkillResource;
    }));
    provider = createSkillScriptToolsProvider({ executor, privateOwnerHome: home, isScopeActive: () => true, resources,
      readResource: (s, v, p, path, digest) => store.readResource(s, v, p, path, digest) });
    const config = defaultToolsConfig(); config.enabled = false;
    host = new StandaloneMcpHost({ config, journalPath: join(home, "tools.sqlite"), builtins: [provider], isScopeActive: () => true });
    const grant = provider.grant(scope, { root: workspace, access: "read-only" }, true);
    const unavailable = await host.discover(scope);
    expect((unavailable[0]!.inputSchema.properties as any).relativePath.enum).toEqual(["scripts/helper.mjs"]);
    const request = { scope: { ...scope, toolCallId: "python-call" }, tool: "skill-script/run", idempotencyKey: "python-call",
      arguments: { versionId: imported.versionId, packageDigest: attached.packageDigest!, relativePath: pythonIdentity.relativePath,
        resourceDigest: pythonIdentity.digest, workspaceGrantId: grant.id, argv: [] } };
    expect(() => host!.authorize(request)).toThrow("schema");
    expect(executions).toBe(0);
    pythonAvailable = true;
    const available = await host.discover(scope);
    expect((available[0]!.inputSchema.properties as any).relativePath.enum).toContain("scripts/entry.py");
    await expect(host.invoke({ ...request, grantId: "unapproved" })).rejects.toThrow("approval required");
    const grantId = host.authorize(request);
    const outcome = await host.invoke({ ...request, grantId });
    expect(outcome.state).toBe("completed"); expect(executions).toBe(1);
    expect(lastInput!.runtime).toBe("python"); expect(lastInput!.writeRoots).toEqual([]);
    expect(lastInput!.resources.map(row => row.relativePath)).toEqual(["scripts/entry.py", "scripts/helper.mjs"]);
    expect((outcome.result as any).structuredContent).toMatchObject({ trust: "untrusted-script-output", taskResultVerification: false });
    expect(await host.invoke({ ...request, grantId })).toEqual(outcome); expect(executions).toBe(1);
    expect(existsSync(marker)).toBe(false);
  } finally {
    await host?.close(); await provider?.close(); store.close(); rmSync(temp, { recursive: true, force: true });
  }
}, 10_000);
