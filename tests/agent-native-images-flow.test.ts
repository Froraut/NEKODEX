import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentModeRuntime, AgentModeStore, AGENT_NATIVE_PROTOCOL, createOwnedNativeExecutionPort, nativeDigest,
  type AgentNativeOfferEnvelope, type ExecutionRequest } from "../src/agent-mode";
import { createAgentToolsComposition } from "../src/agent-tools/composition";
import { createLauncherNativeBridge } from "../src/agent-mode/launcher-native-bridge";
import { createAgentNativeBridge } from "../launcher/electron/agent-native-bridge.cjs";
import { createAgentNativeDescriptorPublisher } from "../launcher/electron/agent-native-descriptor.cjs";
import { ownedNativeInputHash, ownedNativeImageMetadata } from "../launcher/electron/owned-native-images.cjs";
const require = createRequire(import.meta.url);
const { BrowserControlServer } = require("../launcher/electron/control-server.cjs");
const canonical = (value: any): string => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNg+A8AAQIBAEK+vGgAAAAASUVORK5CYII=", "base64");

test.skipIf(process.platform !== "darwin")("approved ToolJournal image crosses Native private HTTP with exact pixels, durable claim and canonical metadata once", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "nekodex-native-image-flow-"))); mkdirSync(join(home, "runtime"));
  const store = new AgentModeStore(join(home, "state.sqlite"));
  let runtime!: AgentModeRuntime, tools!: ReturnType<typeof createAgentToolsComposition>;
  let publisher: ReturnType<typeof createAgentNativeDescriptorPublisher> | undefined;
  let effects = 0, factories = 0, offers = 0, claims = 0, closed = 0, imageInput = true;
  const envelopes: AgentNativeOfferEnvelope[] = [], requests: ExecutionRequest[] = [], canonicalUsers: any[] = [];
  const model = "native-image-fixture", admissionId = "native-image-fixture-admission";
  const bridge = createAgentNativeBridge({ canStart: () => true,
    validateOffer(envelope, payloadDigest) {
      const dispatch = store.getDispatch(envelope.actionId);
      expect(dispatch.transportClaim?.payloadDigest).toBe(nativeDigest(envelope));
      expect(payloadDigest).toBe(nativeDigest(envelope));
      if (!envelopes.some(row => row.actionId === envelope.actionId)) envelopes.push(structuredClone(envelope));
      return runtime.validateNativeOffer({ scope: envelope.scope, model: envelope.model, admissionId: envelope.admissionId, payloadDigest });
    },
    resolveAdmission: (id, selected) => id === admissionId && selected === model ? { imageInput: true, createWorker(_binding, notify) {
      factories++; let handle: string | null = null, thread: string | null = null; const rows: any[] = [];
      const snapshot = () => ({ availability: { available: true }, storageOwner: handle ? "current" : "unclaimed", workerHandle: handle, receipts: structuredClone(rows) });
      return {
        inspectOwnedWorker: snapshot,
        async createOwnedWorker({ actionId }: any) {
          handle = randomUUID(); thread = randomUUID();
          const receipt = { actionId, kind: "create", workerHandle: handle, threadId: thread, admissionId, state: "completed", ownerHeld: false };
          rows.push(receipt); return { workerHandle: handle, threadId: thread, admissionId, receipt };
        },
        async offerOwnedTurn({ actionId, workerHandle, text, images, outputSchema }: any) {
          offers++; expect(workerHandle).toBe(handle);
          const attachments = ownedNativeImageMetadata(images);
          const row: any = { actionId, kind: "offer", workerHandle, threadId: thread, admissionId, inputHash: ownedNativeInputHash(text, images),
            imageAttachments: attachments, schemaHash: createHash("sha256").update(canonical(outputSchema)).digest("hex"),
            inputAuthorship: "automatic-host", state: "acknowledged", ownerHeld: true, turnId: randomUUID(), observations: [] };
          rows.push(row); row.observations.push({ state: row.state, ownerHeld: true, turnId: row.turnId, timestampMs: Date.now() }); notify(structuredClone(row));
          const answer = JSON.stringify(offers === 1
            ? { protocol: AGENT_NATIVE_PROTOCOL, kind: "tool_request", requestId: "observe-one", toolId: "fixture/observe", argumentsJson: "{}", summary: null }
            : { protocol: AGENT_NATIVE_PROTOCOL, kind: "final", requestId: null, toolId: null, argumentsJson: null, summary: "Fixture image observed; independent outcome review remains required." });
          const user = { messageId: randomUUID(), turnId: row.turnId, role: "user", authorship: "automatic-host", text, imageAttachments: attachments, timestampMs: Date.now() };
          canonicalUsers.push(user);
          Object.assign(row, { state: "completed", ownerHeld: false, canonicalItems: [user,
            { messageId: randomUUID(), turnId: row.turnId, role: "assistant", authorship: "native-assistant", phase: "final_answer", text: answer, timestampMs: Date.now() }] });
          row.observations.push({ state: row.state, ownerHeld: false, turnId: row.turnId, timestampMs: Date.now() }); notify(structuredClone(row)); return structuredClone(row);
        },
        async retireOwnedWorker() { return snapshot(); }, currentOperation: () => null, async destroy() { closed++; },
      } as any;
    } } : undefined });
  const main = await new BrowserControlServer({ logger: { info() {}, warn() {}, error() {} },
    getBrowserHost() { throw new Error("Image fixture cannot use browser transport"); }, getPreferences: () => ({}),
    getAgentNativeBridge: () => bridge, getAgentNativeInstance: () => publisher?.instanceId,
  }).start();
  publisher = createAgentNativeDescriptorPublisher({ coreHome: home, profile: "development", control: main.descriptor() });
  publisher.publish({ models: [{ id: model, provider: "owned-native", admissionId, available: true, accepting: true, imageInput: true }], accepting: true });
  const client = createLauncherNativeBridge({ descriptorPath: publisher.path, expectedProfile: "development" });
  const models = () => client.models().map(row => ({ ...row, imageInput }));
  const port = createOwnedNativeExecutionPort({ models, bridge: client,
    claimTransport(request, hash) { claims++; runtime.claimNativeTransport(request, hash); }, tools: { discover: (scope, options) => tools.toolsPort.discover(scope, options) } });
  runtime = new AgentModeRuntime({ store, ownerId: "native-image-flow-owner", models, executionPort: { execute(request, ack) { requests.push(request); return port.execute(request, ack); } },
    onTaskScopeInvalidated: taskId => tools.invalidateTaskTools(taskId) });
  tools = createAgentToolsComposition({ home, authorize: () => true,
    isScopeActive: scope => { const task = store.getTask(scope.taskId); return task.generation === scope.generation && ["ready", "running", "awaiting_input"].includes(task.status); },
    resolveToolCall: scope => runtime.resolveToolCall(scope), onOutcome: outcome => { runtime.recordToolOutcome(outcome); },
    builtins: [{ serverId: "fixture", async discover() { return [{ id: "fixture/observe", serverId: "fixture", name: "observe", supported: true, inputSchema: { type: "object", properties: {}, additionalProperties: false } }]; },
      async execute() { effects++; return { state: "completed", result: { content: [{ type: "text", text: "Approved inert PNG observation." }, { type: "image", mimeType: "image/png", data: png.toString("base64") }] } }; } }],
  });
  const approve = async (body: unknown) => {
    const response = (await tools.handle(new Request("http://127.0.0.1/admin/agent-tools", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })))!;
    return { status: response.status, body: await response.json() as any };
  };
  try {
    expect(client.models()[0]?.imageInput).toBe(true);
    const taskId = randomUUID();
    runtime.create("create", { id: taskId, familyId: taskId, ownerMode: "agent", mode: "manual", originalRequest: "Inspect only the explicitly approved inert fixture image.",
      requirements: [{ id: "review", text: "Independent outcome review remains necessary." }], stages: [{ id: "observe", instruction: "Request fixture/observe, inspect its receipt and report.", requirementIds: ["review"] }],
      bounds: { maxConcurrent: 1, maxTurns: 3, maxSpend: null }, execution: { provider: "owned-native", model, admissionId } });
    runtime.step(taskId, "first", { explicitUserAction: true }); await runtime.waitForIdle();
    expect(effects).toBe(0); expect(offers).toBe(1); expect(envelopes[0]).not.toHaveProperty("images");
    const call = store.listDispatches(taskId)[0]!.result!.continuation!.pending[0]!;
    const approval = { action: "approveInvoke", scope: { taskId, generation: 1, toolCallId: call.toolCallId }, explicitUserAction: true };
    expect((await approve({ ...approval, explicitUserAction: false })).status).toBe(400); expect(effects).toBe(0);
    expect((await approve(approval)).body.value.state).toBe("completed");
    expect((await approve(approval)).body.value.state).toBe("completed"); expect(effects).toBe(1);
    const canonicalOutcome = JSON.stringify(store.listToolOutcomes(taskId));
    runtime.step(taskId, "second", { explicitUserAction: true }); await runtime.waitForIdle();
    expect(store.getTask(taskId)).toMatchObject({ status: "review_required", turns: 2 });
    expect(factories).toBe(1); expect(offers).toBe(2); expect(claims).toBe(2);
    const envelope = envelopes[1]!, outcome = store.listToolOutcomes(taskId)[0]!;
    expect(envelope.images).toEqual([{ data: png.toString("base64"), mimeType: "image/png", width: 1, height: 1, byteLength: png.length,
      sha256: createHash("sha256").update(png).digest("hex"), source: { toolCallId: call.toolCallId, receipt: outcome.idempotencyKey, attachmentIndex: 0 } }]);
    expect(envelope.text).not.toContain(png.toString("base64"));
    expect(JSON.parse(envelope.text).toolResults[0]).toMatchObject({ receipt: outcome.idempotencyKey, result: { content: [
      { type: "text", text: "Approved inert PNG observation." }, { type: "image", sha256: envelope.images![0]!.sha256, imageDelivery: { state: "included" } }] } });
    expect(canonicalUsers[1].imageAttachments).toEqual(ownedNativeImageMetadata(envelope.images));
    expect(canonicalUsers[1].imageAttachments[0]).not.toHaveProperty("data");
    expect(ownedNativeInputHash(envelope.text, envelope.images)).not.toBe(ownedNativeInputHash(envelope.text));
    expect(store.getDispatch(envelope.actionId).transportClaim?.payloadDigest).toBe(nativeDigest(envelope));
    expect(JSON.stringify(store.listToolOutcomes(taskId))).toBe(canonicalOutcome);
    runtime.step(taskId, "second", { explicitUserAction: true }); await runtime.waitForIdle();
    const lookup = { actionId: envelope.actionId, scope: envelope.scope, payloadDigest: nativeDigest(envelope) };
    expect((await client.readReceipt(lookup, { signal: new AbortController().signal }))?.state).toBe("completed");
    expect((await bridge.offer(envelope)).state).toBe("completed");
    const request = requests[1]!;
    imageInput = false;
    expect((await port.execute(request, () => { throw Error("Unsupported image cannot ACK"); })).outcome).toBe("not_sent"); imageInput = true;
    const corrupt = Buffer.from(png); corrupt[corrupt.length - 1] ^= 1;
    const tampered = { ...request, continuation: { ...request.continuation!, outcomes: [{ ...request.continuation!.outcomes[0]!, result: { content: [{ type: "image", mimeType: "image/png", data: corrupt.toString("base64") }] } }] } };
    expect((await port.execute(tampered, () => { throw Error("Tampered image cannot ACK"); })).outcome).toBe("not_sent");
    expect(effects).toBe(1); expect(factories).toBe(1); expect(offers).toBe(2); expect(claims).toBe(2);
  } finally {
    runtime.beginShutdown(); await runtime.waitForIdle(); runtime.finishShutdown(); await tools.close(); await bridge.destroy(); await main.close();
    store.close(); rmSync(home, { recursive: true, force: true });
  }
  expect(closed).toBe(1);
}, 10_000);
