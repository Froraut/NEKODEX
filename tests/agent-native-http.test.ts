import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentModeRuntime, AgentModeStore, createOwnedNativeExecutionPort, AGENT_NATIVE_PROTOCOL, AGENT_NATIVE_OUTPUT_SCHEMA_ID, AGENT_NATIVE_OUTPUT_SCHEMA_HASH,
  nativeDigest, type AgentNativeOfferEnvelope } from "../src/agent-mode";
import { createAgentNativeControlRoutes } from "../src/agent-mode/native-control";
import { createLauncherNativeBridge } from "../src/agent-mode/launcher-native-bridge";
import { createAgentNativeBridge } from "../launcher/electron/agent-native-bridge.cjs";
import { createAgentNativeDescriptorPublisher } from "../launcher/electron/agent-native-descriptor.cjs";
const require = createRequire(import.meta.url);
const { BrowserControlServer } = require("../launcher/electron/control-server.cjs");
const canonical = (value: any): string => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

test.skipIf(process.platform !== "darwin")("Native private HTTP crosses the actual durable claim and never uses browser readiness or replays an offer", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "nekodex-native-http-"))); mkdirSync(join(home, "runtime"));
  const store = new AgentModeStore(join(home, "state.sqlite"));
  let runtime!: AgentModeRuntime; let publisher: ReturnType<typeof createAgentNativeDescriptorPublisher> | undefined;
  let browserReads = 0, factories = 0, offers = 0, retirements = 0, closed = 0, validations = 0;
  let captured: AgentNativeOfferEnvelope | undefined;
  let releaseCreation!: () => void;
  const creationAllowed = new Promise<void>(resolve => { releaseCreation = resolve; });
  const token = "fixture-control-token-" + randomUUID();
  const controlRoutes = createAgentNativeControlRoutes({ runtime: () => runtime, authorize: request => request.headers.get("authorization") === `Bearer ${token}` });
  const core = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: controlRoutes });
  const coreControl = async (body: unknown) => {
    const response = await fetch(`http://127.0.0.1:${core.port}/admin/agent-native`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json() as any;
    if (!response.ok || !result.ok) throw new Error("Fixture core rejected authority");
    return result.value;
  };
  const model = "native-http-fixture", admissionId = "explicit-native-http-fixture";
  const bridge = createAgentNativeBridge({ canStart: () => true,
    validateOffer: async (envelope, payloadDigest) => {
      validations++; captured = envelope;
      return coreControl({ action: "validate-offer", scope: envelope.scope, model: envelope.model, admissionId: envelope.admissionId, payloadDigest });
    },
    resolveAdmission: (id, selectedModel) => id === admissionId && selectedModel === model ? { createWorker(_binding, notify) {
      factories++; let handle: string | null = null, thread: string | null = null; const rows: any[] = [];
      const snapshot = () => ({ availability: { available: true }, storageOwner: handle ? "current" : "unclaimed", workerHandle: handle, receipts: structuredClone(rows) });
      return {
        inspectOwnedWorker: snapshot,
        async createOwnedWorker({ actionId }: any) {
          await creationAllowed;
          handle = randomUUID(); thread = randomUUID();
          const receipt = { actionId, kind: "create", workerHandle: handle, threadId: thread, admissionId, state: "completed", ownerHeld: false };
          rows.push(receipt); return { workerHandle: handle, threadId: thread, admissionId, receipt };
        },
        async offerOwnedTurn({ actionId, workerHandle, text, outputSchema }: any) {
          offers++; expect(workerHandle).toBe(handle);
          const row: any = { actionId, kind: "offer", workerHandle, threadId: thread, admissionId, inputHash: digest(text), schemaHash: digest(canonical(outputSchema)),
            inputAuthorship: "automatic-host", state: "acknowledged", ownerHeld: true, turnId: randomUUID(), observations: [] };
          rows.push(row); row.observations.push({ state: row.state, ownerHeld: row.ownerHeld, turnId: row.turnId, timestampMs: Date.now() }); notify(structuredClone(row));
          const answer = JSON.stringify({ protocol: AGENT_NATIVE_PROTOCOL, kind: "final", requestId: null, toolId: null, argumentsJson: null, summary: "Synthetic Native HTTP boundary completed." });
          Object.assign(row, { state: "completed", ownerHeld: false, canonicalItems: [
            { messageId: randomUUID(), turnId: row.turnId, role: "user", authorship: "automatic-host", text, timestampMs: Date.now() },
            { messageId: randomUUID(), turnId: row.turnId, role: "assistant", authorship: "native-assistant", phase: "final_answer", text: answer, timestampMs: Date.now() },
          ] });
          row.observations.push({ state: row.state, ownerHeld: row.ownerHeld, turnId: row.turnId, timestampMs: Date.now() });
          notify(structuredClone(row)); return structuredClone(row);
        },
        async retireOwnedWorker() { retirements++; return snapshot(); },
        currentOperation: () => null,
        async destroy() { closed++; },
      } as any;
    } } : undefined });
  const main = await new BrowserControlServer({ logger: { info() {}, warn() {}, error() {} },
    getBrowserHost() { browserReads++; throw new Error("Native must not use the browser"); }, getPreferences: () => ({}),
    getAgentNativeBridge: () => bridge, getAgentNativeInstance: () => publisher?.instanceId,
    validateNativeInvalidation: (body: any) => coreControl({ action: "validate-invalidation", taskId: body.taskId, familyId: body.familyId, beforeGeneration: body.beforeGeneration }),
  }).start();
  publisher = createAgentNativeDescriptorPublisher({ coreHome: home, profile: "development", control: main.descriptor() });
  publisher.publish({ models: [{ id: model, provider: "owned-native", admissionId, available: true, accepting: true }], accepting: true });
  const client = createLauncherNativeBridge({ descriptorPath: publisher.path, expectedProfile: "development", fetch: (async (url, init) => {
    const response = await fetch(url, init);
    if (String(url).endsWith("/v1/agent-native/offer")) {
      // The actual HTTP response must arrive while the exact child creation is still held.
      expect(offers).toBe(0); releaseCreation();
    }
    return response;
  }) as typeof fetch });
  const port = createOwnedNativeExecutionPort({ models: () => client.models(), bridge: client, claimTransport: (request, hash) => runtime.claimNativeTransport(request, hash) });
  runtime = new AgentModeRuntime({ store, ownerId: "native-http-owner", models: () => client.models(), executionPort: port });
  const rawPost = async (path: string, body: unknown, instanceId = publisher!.instanceId) => {
    const response = await fetch(`${main.descriptor().endpoint}/v1/agent-native/${path}`, { method: "POST", headers: { authorization: `Bearer ${main.descriptor().token}`, "x-nekodex-native-instance": instanceId, "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() as any };
  };
  try {
    const taskId = randomUUID();
    runtime.create("create", { id: taskId, familyId: taskId, ownerMode: "agent", mode: "manual", originalRequest: "Test synthetic Native HTTP ownership, no real model.",
      requirements: [{ id: "report", text: "Report the fixture result." }], stages: [{ id: "report", instruction: "Report only fixture evidence.", requirementIds: ["report"] }],
      bounds: { maxConcurrent: 1, maxTurns: 1, maxSpend: null }, execution: { provider: "owned-native", model, admissionId } });
    const foreign = randomUUID();
    const forged: AgentNativeOfferEnvelope = { version: 1, protocol: AGENT_NATIVE_PROTOCOL, actionId: foreign,
      scope: { taskId, familyId: taskId, generation: 1, revision: 1, dispatchId: foreign, ownerId: runtime.runner.ownerId, agentWorkerId: randomUUID() },
      model, admissionId, outputSchemaId: AGENT_NATIVE_OUTPUT_SCHEMA_ID, outputSchemaHash: AGENT_NATIVE_OUTPUT_SCHEMA_HASH, authorship: "automatic-host", text: "No durable dispatch claim exists.", continuation: null };
    expect((await rawPost("offer", forged, randomUUID())).status).toBe(403);
    expect((await rawPost("offer", forged)).body.value.state).toBe("not_sent"); expect(factories).toBe(0); expect(offers).toBe(0);
    runtime.step(taskId, "step", { explicitUserAction: true }); await runtime.waitForIdle();
    expect(store.getTask(taskId)).toMatchObject({ status: "review_required", turns: 1, unpricedTurns: 1 });
    const dispatch = store.listDispatches(taskId)[0]!;
    expect(dispatch.state).toBe("settled"); expect(dispatch.acceptanceReceipt).toStartWith("native-accept:");
    expect(dispatch.transportClaim?.payloadDigest).toBe(nativeDigest(captured));
    expect((await rawPost("offer", captured)).body.value.state).toBe("completed");
    expect(offers).toBe(1); expect(factories).toBe(1); expect(validations).toBeGreaterThanOrEqual(3); expect(browserReads).toBe(0);
    expect((await rawPost("invalidate", { taskId, familyId: taskId, beforeGeneration: 999 })).status).toBe(409);
    expect(retirements).toBe(0);
    runtime.control(taskId, "pause", { action: "pause" }); await client.invalidateTask(store.getTask(taskId));
    expect(retirements).toBe(1); expect(closed).toBe(1); expect(offers).toBe(1);
  } finally {
    releaseCreation();
    runtime.beginShutdown(); await runtime.waitForIdle(); runtime.finishShutdown(); await bridge.destroy(); await main.close(); await core.stop(true);
    store.close(); rmSync(home, { recursive: true, force: true });
  }
}, 10_000);
