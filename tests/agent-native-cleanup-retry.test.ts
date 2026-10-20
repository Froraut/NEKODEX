import { expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { createAgentNativeBridge } from "../launcher/electron/agent-native-bridge.cjs";
import { AGENT_NATIVE_PROTOCOL, AGENT_NATIVE_OUTPUT_SCHEMA_ID, AGENT_NATIVE_OUTPUT_SCHEMA_HASH } from "../launcher/electron/agent-native-protocol.cjs";
import type { AgentNativeOfferEnvelope } from "../src/agent-mode/native-protocol";
const digest = (value: unknown) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
const canonical = (value: any): string => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object"
  ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };

test("Native cleanup retries the same retired owner and journal action after failure without replay or duplicate close", async () => {
  let factories = 0, creates = 0, offers = 0, retirementEffects = 0, destroyAttempts = 0, physicalCloses = 0;
  const retirementActions: string[] = [], closeEntered = deferred(), allowClose = deferred();
  const bridge = createAgentNativeBridge({ canStart: () => true, validateOffer: async () => true,
    resolveAdmission: () => ({ createWorker(_binding, notify) {
      factories++; let handle: string | null = null, thread: string | null = null, operation: any;
      const rows: any[] = [];
      const snapshot = () => ({ availability: { available: true }, storageOwner: handle ? "current" : "unclaimed", workerHandle: handle, receipts: structuredClone(rows) });
      return {
        inspectOwnedWorker: snapshot,
        async createOwnedWorker({ actionId }: any) {
          creates++; handle = randomUUID(); thread = randomUUID();
          const receipt = { actionId, kind: "create", workerHandle: handle, threadId: thread, admissionId: "cleanup-admission", state: "completed", ownerHeld: false };
          rows.push(receipt); return { workerHandle: handle, threadId: thread, admissionId: "cleanup-admission", receipt };
        },
        async offerOwnedTurn({ actionId, text, outputSchema }: any) {
          offers++;
          operation = { actionId, kind: "offer", workerHandle: handle, threadId: thread, admissionId: "cleanup-admission", inputHash: digest(text), schemaHash: digest(canonical(outputSchema)),
            inputAuthorship: "automatic-host", state: "unknown", ownerHeld: true, turnId: randomUUID(), observations: [] };
          operation.observations.push({ state: "acknowledged", ownerHeld: true, turnId: operation.turnId, timestampMs: Date.now() });
          rows.push(operation); notify(structuredClone(operation)); return structuredClone(operation);
        },
        async retireOwnedWorker({ workerHandle, actionId }: any) {
          expect(workerHandle).toBe(handle); retirementActions.push(actionId);
          if (retirementEffects === 0) {
            retirementEffects++; Object.assign(operation, { state: "unknown", ownerHeld: false, retirementActionId: actionId });
            operation.observations.push({ state: "unknown", ownerHeld: false, turnId: operation.turnId, timestampMs: Date.now() });
            notify(structuredClone(operation));
            // The journal mutation committed; its response failed. Retry must use its exact action.
            throw new Error("Injected retirement receipt failure");
          }
          expect(actionId).toBe(operation.retirementActionId); return snapshot();
        },
        currentOperation: () => physicalCloses ? null : "exact held owner",
        async destroy() {
          destroyAttempts++;
          if (destroyAttempts === 1) throw new Error("Injected physical close failure while owner remains held");
          closeEntered.resolve(); await allowClose.promise; physicalCloses++;
        },
      } as any;
    } }),
  });
  const actionId = randomUUID();
  const envelope: AgentNativeOfferEnvelope = { version: 1, protocol: AGENT_NATIVE_PROTOCOL, actionId,
    scope: { taskId: "cleanup-task", familyId: "cleanup-family", generation: 1, revision: 1, dispatchId: actionId, ownerId: "cleanup-core-owner", agentWorkerId: "cleanup-agent-worker" },
    model: "cleanup-model", admissionId: "cleanup-admission", outputSchemaId: AGENT_NATIVE_OUTPUT_SCHEMA_ID, outputSchemaHash: AGENT_NATIVE_OUTPUT_SCHEMA_HASH,
    authorship: "automatic-host", text: "Synthetic held Native owner; no real model or tools.", continuation: null };
  const lookup = { actionId, scope: envelope.scope, payloadDigest: digest(JSON.stringify(envelope)) };
  try {
    expect(await bridge.offer(envelope)).toMatchObject({ state: "unknown", ownerHeld: true, writeDisposition: "written" });
    const failed = await Promise.allSettled([bridge.invalidateTask("cleanup-task", { familyId: "cleanup-family", beforeGeneration: 2 }), bridge.destroy()]);
    expect(failed.map(row => row.status)).toEqual(["rejected", "rejected"]);
    expect(destroyAttempts).toBe(1); expect(physicalCloses).toBe(0); expect(retirementActions).toHaveLength(1);
    expect(bridge.status().bindings[0]).toMatchObject({ retired: true, closed: false });
    expect(bridge.status().activeCount).toBe(1); expect(await bridge.readReceipt(lookup)).toMatchObject({ state: "unknown", ownerHeld: true });
    const retry = bridge.destroy();
    await closeEntered.promise;
    const concurrent = bridge.invalidateTask("cleanup-task", { familyId: "cleanup-family", beforeGeneration: 2 });
    expect(destroyAttempts).toBe(2); expect(physicalCloses).toBe(0); expect(retirementActions).toHaveLength(2);
    expect(retirementActions[1]).toBe(retirementActions[0]); expect(retirementEffects).toBe(1);
    expect(bridge.status().activeCount).toBe(1); expect(await bridge.readReceipt(lookup)).toMatchObject({ state: "unknown", ownerHeld: true });
    expect(await bridge.offer(envelope)).toMatchObject({ ownerHeld: true });
    expect(factories).toBe(1); expect(creates).toBe(1); expect(offers).toBe(1);
    allowClose.resolve(); await Promise.all([retry, concurrent]);
    await bridge.destroy(); await bridge.invalidateTask("cleanup-task", { familyId: "cleanup-family", beforeGeneration: 2 });
    expect(destroyAttempts).toBe(2); expect(physicalCloses).toBe(1); expect(retirementActions).toHaveLength(2);
    expect(retirementEffects).toBe(1); expect(factories).toBe(1); expect(creates).toBe(1); expect(offers).toBe(1);
    expect(bridge.status().activeCount).toBe(0); expect(bridge.status().bindings[0]).toMatchObject({ retired: true, closed: true });
    expect(await bridge.readReceipt(lookup)).toMatchObject({ state: "unknown", ownerHeld: false, writeDisposition: "written" });
  } finally { allowClose.resolve(); await bridge.destroy(); }
}, 5_000);
