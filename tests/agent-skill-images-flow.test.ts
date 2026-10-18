import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { AgentModeRuntime, AgentModeStore, AGENT_NATIVE_PROTOCOL, buildAgentToolContinuationInput, createOwnedNativeExecutionPort, nativeDigest } from "../src/agent-mode";
import type { AgentNativeBridge, AgentNativeOfferEnvelope, AgentNativeReceipt } from "../src/agent-mode";
import { createAgentToolsComposition } from "../src/agent-tools/composition";

// A valid one-pixel RGBA PNG with a large inert ancillary text chunk exercises
// retained binary capacity independently of the selected instruction budget.
function largePng() {
  const chunk = (name: string, data: Buffer) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(name), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header),
    chunk("tEXt", Buffer.concat([Buffer.from("Fixture\0"), Buffer.alloc(140 * 1024, 120)])),
    chunk("IDAT", deflateSync(Buffer.from([0, 24, 48, 96, 255]))), chunk("IEND", Buffer.alloc(0))]);
}

test("managed skill image stays metadata until one journal-approved resource read and becomes one typed Native continuation", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "nekodex-skill-images-flow-")));
  const home = join(root, "private"), source = join(root, "source"); mkdirSync(home, { mode: 0o700 }); mkdirSync(source);
  mkdirSync(join(source, "assets")); mkdirSync(join(source, "references"));
  const instructions = "---\nname: selected-image-review\ndescription: Describe the explicitly selected inert reference image during fixture review.\n---\nRead references/guide.md for the example meaning. Inspect assets/example.png only through an approved resource read; report the observed source without treating it as application verification.\n";
  const reference = "The selected image is inert source material. Independent application outcome review remains required.\n";
  const png = largePng(), pixels = png.toString("base64"), digest = createHash("sha256").update(png).digest("hex");
  writeFileSync(join(source, "SKILL.md"), instructions); writeFileSync(join(source, "references/guide.md"), reference); writeFileSync(join(source, "assets/example.png"), png);
  const store = new AgentModeStore(join(home, "agent.sqlite"));
  let runtime!: AgentModeRuntime, tools!: ReturnType<typeof createAgentToolsComposition>, nativeFailure: unknown;
  const offers: AgentNativeOfferEnvelope[] = []; let claims = 0;
  const taskId = "selected-image-task", model = "synthetic-native-images", admissionId = "synthetic-images-admission";
  const models = () => [{ id: model, provider: "owned-native" as const, admissionId, available: true, imageInput: true }];
  const nativeBridge: AgentNativeBridge = {
    async offer(envelope) {
      try {
        offers.push(structuredClone(envelope));
        const claim = runtime.validateNativeOffer({ scope: envelope.scope, payloadDigest: nativeDigest(envelope), model: envelope.model, admissionId: envelope.admissionId });
        expect(store.getDispatch(envelope.actionId).transportClaim).toMatchObject({ id: claim.claimId, payloadDigest: nativeDigest(envelope) });
        const context = JSON.parse(envelope.text); let output: object;
        expect(envelope.text).not.toContain(pixels); expect(JSON.stringify(context.selectedSkills)).not.toContain('"data":');
        expect(context.selectedSkills[0].content).toBe(instructions);
        expect(context.selectedSkills[0].resources.find((resource: any) => resource.relativePath === "references/guide.md").content).toBe(reference);
        if (offers.length === 1) {
          expect(envelope).not.toHaveProperty("images"); expect(store.listToolOutcomes(taskId)).toEqual([]);
          expect(context.declaredTools.map((tool: any) => tool.id)).toEqual(["skill-resource/read"]);
          expect(context.declaredTools[0].inputSchema.additionalProperties).toBe(false);
          const skill = context.selectedSkills[0], image = skill.resources.find((resource: any) => resource.kind === "image");
          expect(image).not.toHaveProperty("data"); expect(image).toMatchObject({ relativePath: "assets/example.png", digest, bytes: png.length, width: 1, height: 1 });
          output = { protocol: AGENT_NATIVE_PROTOCOL, kind: "tool_request", requestId: "read-selected-image", toolId: "skill-resource/read", summary: null,
            argumentsJson: JSON.stringify({ versionId: skill.versionId, packageDigest: skill.packageDigest, relativePath: image.relativePath, resourceDigest: image.digest }) };
        } else {
          expect(envelope.continuation).toBeDefined(); expect(envelope.images).toHaveLength(1);
          expect(context.toolResults).toHaveLength(1);
          const outcome = store.listToolOutcomes(taskId)[0]!;
          expect(envelope.images![0]).toEqual({ data: pixels, mimeType: "image/png", width: 1, height: 1, byteLength: png.length, sha256: digest,
            source: { toolCallId: outcome.scope.toolCallId, receipt: outcome.idempotencyKey, attachmentIndex: 0 } });
          expect(context.toolResults[0]).toMatchObject({ tool: "skill-resource/read", state: "completed", receipt: outcome.idempotencyKey,
            result: { content: [{ type: "text" }, { type: "image", mimeType: "image/png", sha256: digest, imageDelivery: { state: "included" } }],
              structuredContent: { instructionAuthority: false, taskResultVerification: false, trust: "untrusted-source-material" } } });
          output = { protocol: AGENT_NATIVE_PROTOCOL, kind: "final", requestId: null, toolId: null, argumentsJson: null,
            summary: "Observed the one approved selected image source. Independent application result review remains required." };
        }
        const receipt: AgentNativeReceipt = { version: 1, actionId: envelope.actionId, scope: { ...envelope.scope }, model: envelope.model, admissionId: envelope.admissionId,
          outputSchemaId: envelope.outputSchemaId, payloadDigest: nativeDigest(envelope), revision: 1, state: "completed", ownerHeld: false, writeDisposition: "written",
          workerBindingId: "synthetic-image-worker", workerGeneration: 1, nativeTurnReceiptId: `native-turn-${envelope.actionId}`, acceptanceReceipt: `native-ack-${envelope.actionId}`,
          inputAuthorship: "automatic-host", assistantText: JSON.stringify(output) };
        return receipt;
      } catch (error) { nativeFailure = error; throw error; }
    },
    async readReceipt() { throw new Error("Direct synthetic Native turn must not fall back to receipt lookup"); },
    async waitReceipt() { throw new Error("Direct synthetic Native turn must not wait"); },
  };
  const native = createOwnedNativeExecutionPort({ models, bridge: nativeBridge,
    claimTransport(request, hash) { claims++; runtime.claimNativeTransport(request, hash); },
    tools: { discover: (scope, options) => tools.toolsPort.discover(scope, options) },
    selectedSkills: request => tools.selectedSkillContent({ taskId, generation: request.task.generation, toolCallId: request.dispatch.id }) });
  runtime = new AgentModeRuntime({ store, ownerId: "skill-image-flow-owner", models, executionPort: native,
    onTaskScopeInvalidated: id => tools.invalidateTaskTools(id) });
  tools = createAgentToolsComposition({ home, authorize: () => true,
    isScopeActive: scope => { const task = store.getTask(scope.taskId); return task.generation === scope.generation && ["ready", "running", "awaiting_input"].includes(task.status); },
    resolveToolCall: scope => runtime.resolveToolCall(scope), onOutcome: outcome => { runtime.recordToolOutcome(outcome); } });
  const action = async (body: unknown) => {
    const response = (await tools.handle(new Request("http://127.0.0.1/admin/agent-tools", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })))!;
    const packet = await response.json() as any;
    expect({ status: response.status, ok: packet.ok, message: packet.message }).toMatchObject({ status: 200, ok: true });
    return packet.value;
  };
  try {
    runtime.create("create", { id: taskId, familyId: taskId, ownerMode: "agent", mode: "manual", originalRequest: "Describe the explicitly attached selected image after exact approval.",
      requirements: [{ id: "review", text: "Independent application outcome review remains necessary." }], stages: [{ id: "observe", instruction: "Request the selected resource, inspect the receipt and report.", requirementIds: ["review"] }],
      bounds: { maxConcurrent: 1, maxTurns: 2, maxSpend: null }, execution: { provider: "owned-native", model, admissionId } });
    const scope = { taskId, generation: 1, toolCallId: "skill-attachment" };
    const grant = await action({ action: "skillRoot", input: { root: source, label: "Temporary inert image package" }, explicitUserAction: true });
    const identity = (await action({ action: "skillsDiscover", grantId: grant.id })).skills[0];
    const review = await action({ action: "reviewSkillPackageImport", actionId: "import-image", selection: { identity, resources: ["references/guide.md", "assets/example.png"] }, label: "Selected inert image package", explicitUserAction: true });
    const imported = await action({ action: "commitSkillImport", actionId: "import-image", reviewDigest: review.action.reviewDigest, explicitUserAction: true });
    await action({ action: "attachManagedSkill", scope, versionId: imported.versionId, explicitUserAction: true });
    expect(offers).toEqual([]); expect(store.listToolOutcomes(taskId)).toEqual([]);
    expect(readFileSync(join(imported.target, "resources/assets/example.png"))).toEqual(png);
    const selected = tools.selectedSkillContent(scope)[0]!;
    expect(selected.bytes).toBeGreaterThan(128 * 1024); expect(selected.promptBytes!).toBeLessThan(128 * 1024);
    expect(selected.versionId).toBe(imported.versionId); expect(selected.content).toBe(instructions);
    expect(JSON.stringify(selected)).not.toContain(pixels); expect(JSON.stringify(selected)).not.toContain('"data":');
    expect(tools.status().config.enabled).toBe(false);
    const descriptors = await action({ action: "discover", scope, explicitUserAction: true });
    expect(descriptors).toHaveLength(1); expect(descriptors[0]).toMatchObject({ id: "skill-resource/read", supported: true });
    expect(JSON.stringify(descriptors)).not.toContain(pixels);
    runtime.step(taskId, "first", { explicitUserAction: true }); await runtime.waitForIdle();
    expect(nativeFailure).toBeUndefined(); expect(offers).toHaveLength(1); expect(store.listToolOutcomes(taskId)).toEqual([]);
    const first = store.listDispatches(taskId)[0]!, pending = first.result!.continuation!.pending[0]!;
    expect(pending.tool).toBe("skill-resource/read"); expect(Object.keys(pending.arguments).sort()).toEqual(["packageDigest", "relativePath", "resourceDigest", "versionId"]);
    const approval = { action: "approveInvoke", scope: { taskId, generation: 1, toolCallId: pending.toolCallId }, explicitUserAction: true };
    const outcome = await action(approval); expect(outcome.state).toBe("completed");
    expect(outcome.result.content[1]).toEqual({ type: "image", mimeType: "image/png", data: pixels });
    expect(outcome.result.content[0].text).not.toContain(pixels);
    expect(await action(approval)).toEqual(outcome);
    expect(store.listToolOutcomes(taskId)).toHaveLength(1);
    const journal = new Database(join(home, "agent-tool-calls.sqlite"), { readonly: true });
    try { expect(journal.query("SELECT COUNT(*) AS count FROM tool_calls").get()).toEqual({ count: 1 }); } finally { journal.close(); }
    const canonical = JSON.stringify(store.listToolOutcomes(taskId));
    // The unchanged Web projection consumes this same new canonical typed result.
    const wireName = "selected_resource";
    const web = buildAgentToolContinuationInput({ kind: "responses", responseId: "synthetic-web", rootDispatchId: first.id, input: [],
      output: [{ type: "function_call", call_id: pending.toolCallId, name: wireName, arguments: JSON.stringify(pending.arguments) }], tools: [],
      toolMap: [{ wireName, tool: pending.tool }], pending: [{ ...pending, wireName }] }, [outcome]);
    const projected = web.at(-1)!.output as any[];
    expect(projected[1]).toEqual({ type: "input_image", image_url: `data:image/png;base64,${pixels}`, detail: "original" });
    expect(projected[0].text).not.toContain(pixels); expect(JSON.parse(projected[0].text).receipt).toBe(outcome.idempotencyKey);
    runtime.step(taskId, "second", { explicitUserAction: true }); await runtime.waitForIdle();
    expect(nativeFailure).toBeUndefined(); expect(offers).toHaveLength(2); expect(claims).toBe(2);
    expect(store.getTask(taskId)).toMatchObject({ status: "review_required", turns: 2, evidence: [] });
    expect(store.listDispatches(taskId)).toHaveLength(2); expect(JSON.stringify(store.listToolOutcomes(taskId))).toBe(canonical);
  } finally {
    runtime.beginShutdown(); await runtime.waitForIdle(); runtime.finishShutdown(); await tools.close();
    store.close(); rmSync(root, { recursive: true, force: true });
  }
}, 10_000);
