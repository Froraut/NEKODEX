import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultToolsConfig, readToolsConfig, writeToolsConfig, sha256, StandaloneMcpHost, ReadOnlySkillLibrary, requireNativeExecutionAuthority, unavailableNativeSandbox, mcpTerminalRequirement, createAgentToolsComposition, type ToolsConfig, type ToolOutcome } from "../src/agent-tools";
import type { AgentTask } from "../src/agent-mode/types";
import { reviewTrustedSandboxConfig, sandboxProviderAvailable } from "../src/agent-tools/sandbox";

const hosts: StandaloneMcpHost[] = []; const roots: string[] = [];
afterEach(async () => { await Promise.all(hosts.splice(0).map(host => host.close())); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function temp(): string { const root = realpathSync(mkdtempSync(join(tmpdir(), "nekodex-tools-"))); roots.push(root); return root; }
const scope = { taskId: "offline-task", generation: 1, toolCallId: "fixture-call" };
function fixture(timeout = 2000) {
  const root = temp(); const command = realpathSync(process.execPath); const script = realpathSync(join(import.meta.dir, "fixtures/agent-tools-server.ts"));
  const config: ToolsConfig = { version: 1, enabled: true, servers: [{ id: "fixture", enabled: true, transport: "stdio", source: { kind: "user-installed", label: "Offline fixture", version: "1.0.0" }, command, commandSha256: sha256(readFileSync(command)), args: [script, join(root, "counter")], pinnedFiles: [{ path: script, sha256: sha256(readFileSync(script)) }], cwd: root, envSecretRefs: {} }] };
  const journalPath = join(root, "tools.sqlite");
  const host = new StandaloneMcpHost({ config, journalPath, requestTimeoutMs: timeout, isScopeActive: candidate => candidate.taskId === scope.taskId && candidate.generation === 1 }); hosts.push(host);
  return { host, config, root, journalPath };
}
test("default is disabled; private config stores references and pin mismatches never start a child", async () => {
  const { root, config } = fixture();
  expect(readToolsConfig(join(root, "absent.json"))).toEqual(defaultToolsConfig());
  config.servers[0]!.envSecretRefs = { API_TOKEN: "keychain:fixture-token" };
  const path = join(root, "tools.json"); writeToolsConfig(path, config);
  expect(readToolsConfig(path)).toEqual(config);
  if (process.platform !== "win32") expect(statSync(path).mode & 0o077).toBe(0);
  config.servers[0]!.commandSha256 = "0".repeat(64);
  const bad = new StandaloneMcpHost({ config, journalPath: join(root, "bad.sqlite"), isScopeActive: () => true }); hosts.push(bad);
  await expect(bad.discover(scope)).rejects.toThrow("Pinned server file changed");
  expect(bad.snapshot().servers[0]!.pid).toBeNull();
});
test("actual SDK server discovery, exact approval, schema refusal and durable idempotency", async () => {
  const { host, root, config, journalPath } = fixture();
  const tools = await host.discover(scope);
  expect(tools.find(tool => tool.id === "fixture/record")?.supported).toBe(true);
  expect(tools.find(tool => tool.id === "fixture/unsupported")?.supported).toBe(false);
  expect(host.snapshot().servers[0]?.pid).toBeGreaterThan(0);
  const input = { scope, tool: "fixture/record", arguments: { text: "isolated effect" } };
  const grantId = host.authorize(input);
  await expect(host.invoke({ ...input, arguments: { text: "different effect" }, grantId, idempotencyKey: "changed" })).rejects.toThrow("approval required");
  const outcome = await host.invoke({ ...input, grantId, idempotencyKey: "once" });
  expect(outcome.state).toBe("completed"); expect((outcome.result as any).structuredContent.count).toBe(1);
  const reference = host.terminalReference("once", "terminal");
  const task = { id: scope.taskId, generation: scope.generation, revision: 1, requirements: [{ id: "terminal", text: mcpTerminalRequirement(reference.subject) }] } as AgentTask;
  expect(host.resolveTerminalEvidence(task, reference)).toMatchObject({ outcome: "passed", observer: "nekodex-standalone-mcp-receipt", taskRevision: 1 });
  expect(() => host.resolveTerminalEvidence({ ...task, requirements: [{ id: "terminal", text: "Deliver the requested business artifact." }] }, reference)).toThrow("explicitly request");
  expect(host.resolveTerminalEvidence({ ...task, generation: 2, revision: 2 }, reference)).toMatchObject({ outcome: "passed", taskRevision: 2 });
  expect(() => host.resolveTerminalEvidence({ ...task, id: "other-task" }, reference)).toThrow("scope mismatch");
  expect(() => host.resolveTerminalEvidence(task, { ...reference, subjectRevision: "forged" })).toThrow("identity mismatch");
  expect(await host.invoke({ ...input, grantId, idempotencyKey: "once" })).toEqual(outcome);
  expect(await host.invoke({ ...input, grantId: host.authorize(input), idempotencyKey: "second-key-same-call" })).toEqual(outcome);
  expect(readFileSync(join(root, "counter"), "utf8")).toBe("1");
  await expect(host.invoke({ ...input, arguments: { text: "identity drift" }, grantId, idempotencyKey: "once" })).rejects.toThrow("identity conflict");
  const invalid = { ...input, arguments: { text: 5 } };
  expect(() => host.authorize(invalid)).toThrow("schema");
  await host.close();
  const reopened = new StandaloneMcpHost({ config, journalPath, isScopeActive: () => true }); hosts.push(reopened);
  expect(await reopened.invoke({ ...input, grantId: "no-live-grant", idempotencyKey: "once" })).toEqual(outcome);
  expect(reopened.snapshot().servers[0]?.pid).toBeNull();
});
test("cancel after actual effect retains unknown across reopen and never replays", async () => {
  const { host, root, config, journalPath } = fixture(); await host.discover(scope);
  const input = { scope, tool: "fixture/record", arguments: { text: "accepted before cancellation", wait: true } };
  const controller = new AbortController();
  const pending = host.invoke({ ...input, grantId: host.authorize(input), idempotencyKey: "cancelled-after-effect" }, { signal: controller.signal });
  // Bounded fixture event wait proves the mutation boundary was reached before fault injection.
  const deadline = Date.now() + 2000;
  while (!existsSync(join(root, "counter")) && Date.now() < deadline) await Bun.sleep(10);
  expect(readFileSync(join(root, "counter"), "utf8")).toBe("1"); controller.abort();
  expect((await pending).state).toBe("outcome_unknown"); await host.close();
  const reopened = new StandaloneMcpHost({ config, journalPath, isScopeActive: () => true }); hosts.push(reopened);
  expect((await reopened.invoke({ ...input, grantId: "consumed", idempotencyKey: "cancelled-after-effect" })).state).toBe("outcome_unknown");
  expect(() => reopened.terminalReference("cancelled-after-effect", "terminal")).toThrow("unknown");
  expect(reopened.snapshot().servers[0]?.pid).toBeNull(); expect(readFileSync(join(root, "counter"), "utf8")).toBe("1");
});
test("skills require a source/root/digest selection and block traversal or symlink escape; native route fails closed", () => {
  const root = temp(); mkdirSync(join(root, "selected")); writeFileSync(join(root, "selected", "SKILL.md"), "---\nname: selected\n---\nSynthetic selected content.");
  const outside = temp(); writeFileSync(join(outside, "SKILL.md"), "Outside unapproved root"); symlinkSync(join(outside, "SKILL.md"), join(root, "escape-SKILL.md"));
  const library = new ReadOnlySkillLibrary([{ id: "workspace", root, source: "workspace", label: "Explicit fixture root" }]);
  const discovery = library.discover("workspace"); expect(discovery.skills).toHaveLength(1);
  const identity = discovery.skills[0]!; expect(library.select(identity).content).toContain("Synthetic selected content");
  expect(() => library.select({ ...identity, relativePath: "escape-SKILL.md" })).toThrow("escapes");
  expect(() => library.select({ ...identity, relativePath: "../SKILL.md" })).toThrow("Invalid");
  writeFileSync(join(root, "selected", "SKILL.md"), "Modified content"); expect(() => library.select(identity)).toThrow("digest changed");
  expect(() => requireNativeExecutionAuthority({ scope, workspace: { scope, canonicalRoot: root, trusted: true, approvals: "per-operation" }, capability: unavailableNativeSandbox(), approvedOperation: true })).toThrow("sandbox unavailable");
});
test("authenticated admin reviews pins, enables explicitly, invokes only an owned pending call, and selects a granted skill", async () => {
  const { root, config } = fixture(); const recipe = config.servers[0]!; const observed: ToolOutcome[] = [];
  const composition = createAgentToolsComposition({ home: root, authorize: request => request.headers.get("authorization") === "Bearer fixture", isScopeActive: candidate => candidate.taskId === scope.taskId && candidate.generation === scope.generation,
    resolveToolCall: candidate => candidate.toolCallId === scope.toolCallId ? { tool: "fixture/record", arguments: { text: "HTTP approved effect" }, idempotencyKey: "http-once" } : undefined,
    onOutcome: outcome => { observed.push(outcome); } });
  async function post(body: unknown) {
    const response = (await composition.handle(new Request("http://127.0.0.1/admin/agent-tools", { method: "POST", headers: { authorization: "Bearer fixture", "content-type": "application/json" }, body: JSON.stringify(body) })))!;
    const payload = await response.json() as any; return { response, ...payload };
  }
  try {
    expect((await composition.handle(new Request("http://127.0.0.1/admin/agent-tools", { method: "POST" })))!.status).toBe(401);
    expect((await post({ action: "status" })).value.config.enabled).toBe(false);
    const review = await post({ action: "reviewServer", explicitUserAction: true, input: { id: recipe.id, label: recipe.source.label, version: recipe.source.version, command: recipe.command, args: recipe.args, cwd: recipe.cwd, pinnedFiles: recipe.pinnedFiles.map(file => file.path) } });
    expect(review.response.status).toBe(200); expect(review.value.recipe.commandSha256).toBe(recipe.commandSha256);
    const saved = await post({ action: "saveServer", reviewId: review.value.reviewId, enabled: true, explicitUserAction: true });
    expect(saved.value.config.enabled).toBe(false); expect(saved.value.runtime.servers[0].pid).toBeNull();
    await post({ action: "setEnabled", enabled: true, explicitUserAction: true });
    expect((await post({ action: "discover", scope, explicitUserAction: true })).value).toHaveLength(2);
    expect((await post({ action: "approveInvoke", scope: { ...scope, toolCallId: "invented" }, explicitUserAction: true })).response.status).toBe(409);
    const invoked = await post({ action: "approveInvoke", scope, explicitUserAction: true }); expect(invoked.value.state).toBe("completed");
    expect((await post({ action: "approveInvoke", scope, explicitUserAction: true })).value).toEqual(invoked.value);
    expect(readFileSync(join(root, "counter"), "utf8")).toBe("1"); expect(observed[0]?.scope).toEqual(scope);
    const skillRoot = temp(); mkdirSync(join(skillRoot, "selected")); writeFileSync(join(skillRoot, "selected", "SKILL.md"), "Explicit selected instruction.");
    const granted = await post({ action: "skillRoot", input: { root: skillRoot, label: "Selected offline root" }, explicitUserAction: true });
    const discovery = await post({ action: "skillsDiscover", grantId: granted.value.id });
    expect((await post({ action: "skillsSelect", scope, identity: discovery.value.skills[0], explicitUserAction: true })).value.content).toBe("Explicit selected instruction.");
    expect(composition.selectedSkillContent(scope)[0]?.content).toBe("Explicit selected instruction.");
    const reopened = createAgentToolsComposition({ home: root, authorize: () => true, isScopeActive: () => true });
    expect(reopened.selectedSkillContent(scope)[0]?.content).toBe("Explicit selected instruction."); await reopened.close();
    await post({ action: "removeSkillRoot", grantId: granted.value.id, explicitUserAction: true }); expect(composition.selectedSkillContent(scope)).toHaveLength(0);
    await post({ action: "removeServer", serverId: "fixture", explicitUserAction: true }); expect(composition.status().config.servers).toHaveLength(0);
    expect(composition.activeCount).toBe(0);
  } finally { await composition.close(); }
});
test.skipIf(!sandboxProviderAvailable())("actual host initializes and invokes SDK child under reviewed macOS sandbox", async () => {
  const { root, config } = fixture(); const controlHome = temp();
  config.servers[0]!.trustedSandbox = reviewTrustedSandboxConfig({ codeRoots: [realpathSync(join(import.meta.dir, "fixtures")), realpathSync(join(import.meta.dir, "..", "node_modules"))], readRoots: [root], writeRoots: [root] });
  const host = new StandaloneMcpHost({ config, journalPath: join(controlHome, "sandbox-tools.sqlite"), isScopeActive: () => true, requestTimeoutMs: 2000 }); hosts.push(host);
  await host.discover(scope); expect(host.snapshot().servers[0]?.sandbox).toBe("macos-seatbelt");
  const call = { scope, tool: "fixture/record", arguments: { text: "Sandbox SDK effect" } };
  expect((await host.invoke({ ...call, grantId: host.authorize(call), idempotencyKey: "sandboxed" })).state).toBe("completed");
  expect(readFileSync(join(root, "counter"), "utf8")).toBe("1");
  const pid = host.snapshot().servers[0]!.pid!; await host.close(); expect(() => process.kill(pid, 0)).toThrow();
});
test.skipIf(!sandboxProviderAvailable())("review and launch deny authority descendants and code-root authority reads", async () => {
  const { root, config } = fixture(); const controlHome = temp(); const receipts = join(controlHome, "receipts"); mkdirSync(receipts);
  const composition = createAgentToolsComposition({ home: controlHome, authorize: () => true, isScopeActive: () => true });
  try {
    const server = config.servers[0]!;
    expect(() => composition.reviewServer({ id: server.id, label: "Fixture", version: "1", command: server.command, args: server.args, cwd: receipts, pinnedFiles: server.pinnedFiles.map(file => file.path), sandbox: true }, true)).toThrow("authority metadata");
    server.trustedSandbox = reviewTrustedSandboxConfig({ codeRoots: [realpathSync(join(import.meta.dir, "fixtures")), realpathSync(join(import.meta.dir, "..", "node_modules"))], readRoots: [receipts], writeRoots: [receipts] });
    const host = new StandaloneMcpHost({ config, journalPath: join(controlHome, "guarded.sqlite"), isScopeActive: () => true }); hosts.push(host);
    await expect(host.discover(scope)).rejects.toThrow("authority metadata"); expect(host.snapshot().servers[0]?.pid).toBeNull();
    server.trustedSandbox = reviewTrustedSandboxConfig({ codeRoots: [controlHome], readRoots: [root], writeRoots: [root] });
    const codeHost = new StandaloneMcpHost({ config, journalPath: join(controlHome, "code-guarded.sqlite"), isScopeActive: () => true }); hosts.push(codeHost);
    await expect(codeHost.discover(scope)).rejects.toThrow("authority metadata"); expect(codeHost.snapshot().servers[0]?.pid).toBeNull();
  } finally { await composition.close(); }
});
