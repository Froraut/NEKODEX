import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentModeRuntime, AgentModeStore, AGENT_NATIVE_PROTOCOL, createOwnedNativeExecutionPort, nativeDigest } from "../src/agent-mode";
import type { AgentNativeBridge, AgentNativeOfferEnvelope, AgentNativeReceipt } from "../src/agent-mode";
import { createAgentToolsComposition } from "../src/agent-tools/composition";
import { SkillScriptExecutor } from "../src/agent-tools/skill-script-executor";

// Only the model is synthetic: approval reaches the real pinned macOS executor,
// which transforms a fixture input inside an explicitly granted temporary workspace.
test.skipIf(process.platform !== "darwin")("reviewed attached script executes once after journal approval and continues Native with an untrusted receipt", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "nekodex-skill-scripts-flow-")));
  const home = join(root, "private"), source = join(root, "source"), workspace = join(root, "workspace");
  for (const path of [home, source, workspace]) mkdirSync(path, { mode: 0o700 });
  mkdirSync(join(source, "scripts"), { mode: 0o700 });
  const instructions = "---\nname: selected-workspace-transform\ndescription: Transform the explicitly selected inert workspace input with a reviewed JavaScript fixture.\n---\nUse scripts/transform.mjs only after explicit workspace grant and per-call approval. Inspect the written output separately; the execution receipt alone does not verify the application result.\n";
  const code = "import { readFileSync, appendFileSync } from 'node:fs';\nconst input = JSON.parse(readFileSync('input.json', 'utf8'));\nconst output = `TRANSFORM:${input.text.toUpperCase()}\\n`;\nappendFileSync('output.txt', output);\nconsole.log('fixture transformed one selected input');\n";
  const expectedOutput = "TRANSFORM:SELECTED FIXTURE INPUT\n", outputPath = join(workspace, "output.txt");
  writeFileSync(join(source, "SKILL.md"), instructions); writeFileSync(join(source, "scripts/transform.mjs"), code);
  writeFileSync(join(workspace, "input.json"), JSON.stringify({ text: "selected fixture input" }));
  const bunPath = realpathSync(process.execPath), bunSha256 = createHash("sha256").update(readFileSync(bunPath)).digest("hex");
  const executor = new SkillScriptExecutor({ bunPath, bunSha256, home });
  const store = new AgentModeStore(join(home, "agent.sqlite"));
  let runtime!: AgentModeRuntime, tools!: ReturnType<typeof createAgentToolsComposition>, nativeFailure: unknown;
  const offers: AgentNativeOfferEnvelope[] = []; let claims = 0, workspaceGrantId = "";
  const taskId = "selected-script-task", model = "synthetic-native-script", admissionId = "synthetic-script-admission";
  const models = () => [{ id: model, provider: "owned-native" as const, admissionId, available: true }];
  const bridge: AgentNativeBridge = {
    async offer(envelope) {
      try {
        offers.push(structuredClone(envelope));
        const claim = runtime.validateNativeOffer({ scope: envelope.scope, payloadDigest: nativeDigest(envelope), model: envelope.model, admissionId: envelope.admissionId });
        expect(store.getDispatch(envelope.actionId).transportClaim).toMatchObject({ id: claim.claimId, payloadDigest: nativeDigest(envelope) });
        const context = JSON.parse(envelope.text); let output: object;
        expect(envelope.text).not.toContain(code); expect(envelope).not.toHaveProperty("images");
        if (offers.length === 1) {
          expect(existsSync(outputPath)).toBe(false); expect(store.listToolOutcomes(taskId)).toEqual([]);
          expect(context.selectedSkills[0].content).toBe(instructions);
          const skill = context.selectedSkills[0], script = skill.resources.find((row: any) => row.kind === "script");
          expect(script).toMatchObject({ relativePath: "scripts/transform.mjs", mediaType: "text/javascript", bytes: Buffer.byteLength(code),
            digest: createHash("sha256").update(code).digest("hex") });
          expect(script).not.toHaveProperty("content");
          const descriptor = context.declaredTools.find((row: any) => row.id === "skill-script/run");
          expect(descriptor.inputSchema.additionalProperties).toBe(false);
          expect(descriptor.inputSchema.properties.workspaceGrantId.enum).toEqual([workspaceGrantId]);
          output = { protocol: AGENT_NATIVE_PROTOCOL, kind: "tool_request", requestId: "transform-once", toolId: "skill-script/run", summary: null,
            argumentsJson: JSON.stringify({ versionId: skill.versionId, packageDigest: skill.packageDigest, relativePath: script.relativePath,
              resourceDigest: script.digest, workspaceGrantId: descriptor.inputSchema.properties.workspaceGrantId.enum[0], argv: [] }) };
        } else {
          expect(envelope.continuation).toBeDefined(); expect(context.toolResults).toHaveLength(1);
          expect(context.selectedSkills).toEqual([]);
          const outcome = store.listToolOutcomes(taskId)[0]!;
          expect(context.toolResults[0]).toMatchObject({ tool: "skill-script/run", state: "completed", receipt: outcome.idempotencyKey,
            result: { structuredContent: { executionState: "completed", exitCode: 0, stdout: "fixture transformed one selected input\n",
              trust: "untrusted-script-output", instructionAuthority: false, taskResultVerification: false } } });
          output = { protocol: AGENT_NATIVE_PROTOCOL, kind: "final", requestId: null, toolId: null, argumentsJson: null,
            summary: "One approved selected script receipt observed; independent application outcome review remains required." };
        }
        const receipt: AgentNativeReceipt = { version: 1, actionId: envelope.actionId, scope: { ...envelope.scope }, model: envelope.model, admissionId: envelope.admissionId,
          outputSchemaId: envelope.outputSchemaId, payloadDigest: nativeDigest(envelope), revision: 1, state: "completed", ownerHeld: false, writeDisposition: "written",
          workerBindingId: "synthetic-script-worker", workerGeneration: 1, nativeTurnReceiptId: `native-turn-${envelope.actionId}`, acceptanceReceipt: `native-ack-${envelope.actionId}`,
          inputAuthorship: "automatic-host", assistantText: JSON.stringify(output) };
        return receipt;
      } catch (error) { nativeFailure = error; throw error; }
    },
    async readReceipt() { throw new Error("Synthetic model must finish its direct offer"); },
    async waitReceipt() { throw new Error("Synthetic model must not wait"); },
  };
  const native = createOwnedNativeExecutionPort({ models, bridge,
    claimTransport(request, hash) { claims++; runtime.claimNativeTransport(request, hash); },
    tools: { discover: (scope, options) => tools.toolsPort.discover(scope, options) },
    selectedSkills: request => tools.selectedSkillContent({ taskId, generation: request.task.generation, toolCallId: request.dispatch.id }) });
  runtime = new AgentModeRuntime({ store, ownerId: "skill-script-flow-owner", models, executionPort: native,
    onTaskScopeInvalidated: id => tools.invalidateTaskTools(id) });
  tools = createAgentToolsComposition({ home, authorize: () => true, scriptExecutor: executor,
    isScopeActive: scope => { const task = store.getTask(scope.taskId); return task.generation === scope.generation && ["ready", "running", "awaiting_input"].includes(task.status); },
    resolveToolCall: scope => runtime.resolveToolCall(scope), onOutcome: outcome => { runtime.recordToolOutcome(outcome); } });
  const action = async (body: unknown) => {
    const response = (await tools.handle(new Request("http://127.0.0.1/admin/agent-tools", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })))!;
    const packet = await response.json() as any;
    expect({ status: response.status, ok: packet.ok, message: packet.message }).toMatchObject({ status: 200, ok: true });
    return packet.value;
  };
  try {
    expect(executor.capabilities().supported).toBe(true);
    runtime.create("create", { id: taskId, familyId: taskId, ownerMode: "agent", mode: "manual", originalRequest: "Transform only the explicitly selected inert workspace input after exact approval.",
      requirements: [{ id: "review", text: "Review the independent application outcome." }], stages: [{ id: "transform", instruction: "Request one reviewed script, inspect its receipt and report.", requirementIds: ["review"] }],
      bounds: { maxConcurrent: 1, maxTurns: 2, maxSpend: null }, execution: { provider: "owned-native", model, admissionId } });
    const scope = { taskId, generation: 1, toolCallId: "script-attachment" };
    const sourceGrant = await action({ action: "skillRoot", input: { root: source, label: "Inert script source" }, explicitUserAction: true });
    const identity = (await action({ action: "skillsDiscover", grantId: sourceGrant.id })).skills[0];
    const review = await action({ action: "reviewSkillPackageImport", actionId: "import-script", selection: { identity, resources: ["scripts/transform.mjs"] }, label: "Reviewed inert transform", explicitUserAction: true });
    const imported = await action({ action: "commitSkillImport", actionId: "import-script", reviewDigest: review.action.reviewDigest, explicitUserAction: true });
    await action({ action: "attachManagedSkill", scope, versionId: imported.versionId, explicitUserAction: true });
    expect(offers).toEqual([]); expect(store.listToolOutcomes(taskId)).toEqual([]); expect(existsSync(outputPath)).toBe(false);
    expect(JSON.stringify(tools.selectedSkillContent(scope))).not.toContain(code);
    const grant = await action({ action: "grantScriptWorkspace", scope, root: workspace, access: "read-write", acknowledgeRestrictions: true, explicitUserAction: true });
    workspaceGrantId = grant.id;
    expect(grant).toMatchObject({ taskId, generation: 1, root: workspace, access: "read-write" });
    expect(tools.status().config.enabled).toBe(false); expect(existsSync(outputPath)).toBe(false);
    runtime.step(taskId, "first", { explicitUserAction: true }); await runtime.waitForIdle();
    expect(nativeFailure).toBeUndefined(); expect(offers).toHaveLength(1); expect(existsSync(outputPath)).toBe(false);
    const first = store.listDispatches(taskId)[0]!, call = first.result!.continuation!.pending[0]!;
    expect(call.tool).toBe("skill-script/run");
    const approval = { action: "approveInvoke", scope: { taskId, generation: 1, toolCallId: call.toolCallId }, explicitUserAction: true };
    const outcome = await action(approval);
    expect(outcome).toMatchObject({ state: "completed", tool: "skill-script/run", result: { structuredContent: { executionState: "completed", exitCode: 0,
      stdout: "fixture transformed one selected input\n", trust: "untrusted-script-output", instructionAuthority: false, taskResultVerification: false } } });
    // Independent fixture observation establishes these actual bytes only.
    expect(readFileSync(outputPath, "utf8")).toBe(expectedOutput);
    expect(await action(approval)).toEqual(outcome); expect(readFileSync(outputPath, "utf8")).toBe(expectedOutput);
    const canonical = JSON.stringify(store.listToolOutcomes(taskId)); expect(store.listToolOutcomes(taskId)).toHaveLength(1);
    const journal = new Database(join(home, "agent-tool-calls.sqlite"), { readonly: true });
    try { expect(journal.query("SELECT COUNT(*) AS count FROM tool_calls").get()).toEqual({ count: 1 }); } finally { journal.close(); }
    await action({ action: "detachManagedSkill", scope, versionId: imported.versionId, explicitUserAction: true });
    expect(tools.selectedSkillContent(scope)).toEqual([]);
    expect((await action({ action: "discover", scope, explicitUserAction: true })).some((row: any) => row.id === "skill-script/run" && row.supported)).toBe(false);
    expect(await action(approval)).toEqual(outcome); expect(readFileSync(outputPath, "utf8")).toBe(expectedOutput);
    runtime.step(taskId, "second", { explicitUserAction: true }); await runtime.waitForIdle();
    expect(nativeFailure).toBeUndefined(); expect(offers).toHaveLength(2); expect(claims).toBe(2);
    expect(store.getTask(taskId)).toMatchObject({ status: "review_required", turns: 2, unpricedTurns: 2, spent: 0, evidence: [] });
    expect(store.listDispatches(taskId).every(dispatch => dispatch.result?.actualSpend === null)).toBe(true);
    expect(JSON.stringify(store.listToolOutcomes(taskId))).toBe(canonical); expect(readFileSync(outputPath, "utf8")).toBe(expectedOutput);
    runtime.control(taskId, "pause-retires-workspace", { action: "pause" });
    expect(store.getTask(taskId).generation).toBe(2);
    expect((await action({ action: "scriptStatus" })).grants).toEqual([]);
    expect(readFileSync(outputPath, "utf8")).toBe(expectedOutput);
  } finally {
    runtime.beginShutdown(); await runtime.waitForIdle(); runtime.finishShutdown(); await tools.close();
    store.close();
    // The real executor retained sealed, immutable fixture code directories.
    const unlock = (path: string) => { if (lstatSync(path).isDirectory()) { chmodSync(path, 0o700); for (const name of readdirSync(path)) unlock(join(path, name)); } };
    unlock(root); rmSync(root, { recursive: true, force: true });
  }
}, 10_000);
