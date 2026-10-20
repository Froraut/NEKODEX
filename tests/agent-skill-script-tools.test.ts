import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultToolsConfig, sha256 } from "../src/agent-tools/config";
import { invocationFingerprint } from "../src/agent-tools/journal";
import { StandaloneMcpHost } from "../src/agent-tools/mcp-host";
import { createSkillScriptToolsProvider, type SkillScriptExecutionReceipt, type SkillScriptExecutorPort } from "../src/agent-tools/skill-script-tools";
import type { AttachedSkillResource } from "../src/agent-tools/skill-resource-tools";
import type { SkillResource } from "../src/agent-tools/skill-resources";

test("script workspace authority and exact immutable closure use the existing approval journal with no replay", async () => {
  const temp = realpathSync(mkdtempSync(join(tmpdir(), "nekodex-script-provider-")));
  const home = join(temp, "private"); const root = join(temp, "workspace"); mkdirSync(home, { mode: 0o700 }); mkdirSync(root);
  const versionId = "a".repeat(64), packageDigest = "b".repeat(64);
  const source = "console.log('inert selected entry');\n";
  const script: SkillResource = { kind: "script", relativePath: "scripts/entry.mjs", mediaType: "text/javascript", content: source, digest: sha256(source), bytes: Buffer.byteLength(source), role: "selected-skill-source-material" };
  const dependency: SkillResource = { relativePath: "references/input.txt", mediaType: "text/plain", content: "inert input", digest: sha256("inert input"), bytes: 11, role: "selected-skill-source-material" };
  const metadata = (value: SkillResource): AttachedSkillResource => { const { role: _role, ...rest } = value; const { content: _content, data: _data, ...pin } = rest as any; return { ...pin, versionId, packageDigest }; };
  let attached = [metadata(script), metadata(dependency)]; let reads = 0; let executions = 0; let generation = 1;
  let duringRead: () => void | Promise<void> = () => {}; let cancelled: string[] = []; let release: (() => void) | undefined;
  let hold = false; let closeCalls = 0; let failClose = true; let failCancel = false;
  let signalEntered!: () => void; let entered = new Promise<void>(resolve => { signalEntered = resolve; });
  const receipt: SkillScriptExecutionReceipt = { state: "completed", stdout: "untrusted result", stderr: "", exitCode: 0, truncated: false };
  let lastInput: Parameters<SkillScriptExecutorPort["execute"]>[0] | undefined;
  const executor: SkillScriptExecutorPort = { capabilities: () => ({ supported: true, network: "deny-all-new-sockets", processExec: "deny" }),
    async execute(input) { executions++; lastInput = input; input.assertCurrent(); if (hold) await new Promise<void>(resolve => { release = resolve; signalEntered(); }); return receipt; },
    cancel(id) { cancelled.push(id); if (failCancel) { failCancel = false; throw new Error("inert cancel failure"); } release?.(); }, reconcile: () => receipt, close: () => { closeCalls++; if (failClose) { failClose = false; throw new Error("inert close failure"); } } };
  const options = { privateOwnerHome: home, executor, isScopeActive: (scope: { generation: number }) => scope.generation === generation,
    resources: () => attached, async readResource(_scope: unknown, v: string, p: string, path: string, digest: string) {
      reads++; expect(v).toBe(versionId); expect(p).toBe(packageDigest);
      const row = [script, dependency].find(row => row.relativePath === path && row.digest === digest); expect(row).toBeDefined();
      await duringRead(); return structuredClone(row!);
    } };
  const provider = createSkillScriptToolsProvider(options); const config = defaultToolsConfig(); config.enabled = false;
  const host = new StandaloneMcpHost({ config, journalPath: join(home, "journal.sqlite"), builtins: [provider], isScopeActive: () => true });
  let call = 0; const scope = { taskId: "script-fixture", generation: 1, toolCallId: "admin" };
  const grant = provider.grant(scope, { root, access: "read-only" }, true);
  const request = (extra: Record<string, unknown> = {}) => ({ scope: { ...scope, toolCallId: `call-${++call}` }, tool: "skill-script/run", idempotencyKey: `script-${call}`,
    arguments: { versionId, packageDigest, relativePath: script.relativePath, resourceDigest: script.digest, workspaceGrantId: grant.id, argv: ["literal argument"], ...extra } });
  const invoke = async (extra: Record<string, unknown> = {}) => { const req = request(extra); return host.invoke({ ...req, grantId: host.authorize(req) }); };
  try {
    expect(() => provider.grant(scope, { root: home, access: "read-only" }, true)).toThrow("overlaps");
    expect(() => provider.grant(scope, { root: temp, access: "read-write" }, true)).toThrow("overlaps");
    expect(() => provider.grant(scope, { root, access: "read-only" }, false)).toThrow("Explicit");
    const req = request(); const discovered = await host.discover(req.scope);
    expect(discovered.map(row => row.id)).toEqual(["skill-script/run"]);
    expect((discovered[0]!.inputSchema.properties as any).workspaceGrantId.enum).toEqual([grant.id]);
    expect(JSON.stringify(discovered)).not.toContain(source); expect(JSON.stringify(discovered)).not.toContain(root); expect(reads).toBe(0);
    await expect(host.invoke({ ...req, grantId: "unapproved" })).rejects.toThrow("approval required");
    expect(executions).toBe(0); expect(reads).toBe(0);
    expect(() => host.authorize({ ...req, arguments: { ...req.arguments, cwd: root } })).toThrow("schema");
    expect(() => host.authorize({ ...req, arguments: { ...req.arguments, argv: Array(17).fill("a") } })).toThrow("schema");
    const approval = host.authorize(req); const outcome = await host.invoke({ ...req, grantId: approval });
    expect(outcome.state).toBe("completed"); expect(reads).toBe(2); expect(executions).toBe(1);
    expect(lastInput!.operationId).toBe(invocationFingerprint(req));
    expect(lastInput!.resources.map(row => row.relativePath)).toEqual([dependency.relativePath, script.relativePath]);
    expect(Buffer.from(lastInput!.resources[1]!.bytes).toString()).toBe(source); expect(lastInput!.writeRoots).toEqual([]);
    expect(lastInput!.cwd).toBe(root);
    expect((outcome.result as any).structuredContent).toMatchObject({ stdout: "untrusted result", trust: "untrusted-script-output", instructionAuthority: false, taskResultVerification: false });
    expect(JSON.stringify(outcome.result)).not.toContain(source);
    expect(await host.invoke({ ...req, grantId: approval })).toEqual(outcome); expect(await host.reconcileExisting(req)).toEqual(outcome);
    expect(executions).toBe(1); expect(reads).toBe(2);
    expect(() => host.terminalReference(req.idempotencyKey, "requirement")).toThrow("Unsupported MCP terminal evidence");
    expect((await invoke({ resourceDigest: "c".repeat(64) })).state).toBe("failed"); expect(executions).toBe(1);
    duringRead = () => { attached = [metadata(script)]; };
    expect((await invoke()).state).toBe("failed"); expect(executions).toBe(1);
    attached = [metadata(script), metadata(dependency)]; duringRead = () => { generation = 2; };
    expect((await invoke()).state).toBe("failed"); expect(executions).toBe(1); generation = 1; duringRead = () => {};
    // Root path replacement invalidates the captured inode rather than silently granting it again.
    renameSync(root, `${root}-old`); mkdirSync(root);
    expect((await invoke()).state).toBe("failed"); expect(executions).toBe(1);
    rmSync(root, { recursive: true }); renameSync(`${root}-old`, root);
    // Detachment first removes future attachment authority, then cancels only this exact version/scope.
    hold = true; const packageReq = request(); const packageWork = host.invoke({ ...packageReq, grantId: host.authorize(packageReq) });
    await entered; const previousCancels = cancelled.length;
    await provider.revokePackage("c".repeat(64), scope);
    await provider.revokePackage(versionId, { ...scope, taskId: "unrelated-task" });
    expect(cancelled.length).toBe(previousCancels);
    attached = []; failCancel = true;
    await expect(provider.revokePackage(versionId, scope)).rejects.toThrow("inert cancel failure");
    expect(provider.status(scope).activeOperations).toHaveLength(1);
    expect(provider.status(scope).grants.map(row => row.id)).toEqual([grant.id]);
    await provider.revokePackage(versionId, scope); await packageWork;
    expect(cancelled.slice(previousCancels)).toEqual([invocationFingerprint(packageReq), invocationFingerprint(packageReq)]);
    expect(provider.status(scope).activeOperations).toEqual([]);
    expect((await invoke()).state).toBe("failed"); expect(executions).toBe(2);
    attached = [metadata(script), metadata(dependency)]; release = undefined;
    entered = new Promise<void>(resolve => { signalEntered = resolve; });
    // Workspace cancellation separately addresses the exact operation; neither route claims rollback.
    hold = true; const pendingReq = request(); const pending = host.invoke({ ...pendingReq, grantId: host.authorize(pendingReq) });
    await entered;
    expect(provider.status(scope).activeOperations).toHaveLength(1);
    await provider.revoke(scope, grant.id, true); await pending;
    expect(cancelled).toContain(invocationFingerprint(pendingReq)); expect(provider.status(scope).grants).toEqual([]);
    expect(await provider.discover(scope)).toEqual([]);
    expect((await invoke()).state).toBe("failed"); expect(executions).toBe(3);
    const replacement = createSkillScriptToolsProvider(options); expect(replacement.status(scope).grants).toEqual([]);
    // The host may recover an exact durable receipt after restart without restoring a grant.
    expect((await replacement.reconcile!(pendingReq))!.state).toBe("completed");
    expect(replacement.status(scope).grants).toEqual([]); expect(executions).toBe(3);
    const a = provider.close(), b = provider.close(); expect(a).toBe(b); await expect(a).rejects.toThrow("inert close failure");
    expect(provider.status(scope).closed).toBe(true); await provider.close(); expect(closeCalls).toBe(2);
    expect(await provider.discover(scope)).toEqual([]);
  } finally { await provider.close(); await host.close(); rmSync(temp, { recursive: true, force: true }); }
}, 10_000);
