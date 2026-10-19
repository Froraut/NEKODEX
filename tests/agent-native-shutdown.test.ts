import { expect, spyOn, test } from "bun:test";
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AgentModeStore } from "../src/agent-mode";
import { defaultConfig } from "../src/config";
import { startServer } from "../src/server";
import { createAgentNativeBridge } from "../launcher/electron/agent-native-bridge.cjs";
import { createAgentNativeDescriptorPublisher } from "../launcher/electron/agent-native-descriptor.cjs";
import { createAgentRemoteDescriptorPublisher } from "../launcher/electron/agent-remote-descriptor.cjs";
const { BrowserControlServer } = createRequire(import.meta.url)("../launcher/electron/control-server.cjs");
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const canonical = (value: any): string => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };

test.serial.skipIf(process.platform !== "darwin")("actual Native shutdown retries failed cleanup while signals retain one owner until physical closure", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "neko-native-stop-")));
  const keys = ["CODEX_CHATGPT_WEB_HOME", "CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR", "CODEX_CHATGPT_WEB_BACKGROUND_RUNTIME"] as const;
  const previous = new Map(keys.map(key => [key, process.env[key]]));
  const previousExitCode = process.exitCode;
  const signalCounts = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
  const shutdownFailed = deferred();
  const errorLog = spyOn(console, "error").mockImplementation((message: unknown) => {
    if (String(message).includes("server shutdown failed: Owned Native cleanup failed")) shutdownFailed.resolve();
  });
  process.env.CODEX_CHATGPT_WEB_HOME = home;
  delete process.env.CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR;
  delete process.env.CODEX_CHATGPT_WEB_BACKGROUND_RUNTIME;
  let server: ReturnType<typeof startServer> | undefined;
  let publisher: ReturnType<typeof createAgentNativeDescriptorPublisher> | undefined;
  let remotePublisher: ReturnType<typeof createAgentRemoteDescriptorPublisher> | undefined;
  let reader: AgentModeStore | undefined;
  let endpoint = "", failCleanup = true, factories = 0, offers = 0, retirements = 0, closes = 0, closeAttempts = 0;
  const acknowledged = deferred(), closing = deferred(), allowClose = deferred(), finishOffer = deferred();
  const invalidationScopes: any[] = [];
  const config = { ...defaultConfig("full"), port: 0, browserHost: "launcher" as const, brokerSocketPath: join(home, "b.sock") };
  const post = async (path: string, body: unknown) => {
    const response = await fetch(`${endpoint}${path}`, { method: "POST", headers: { authorization: `Bearer ${config.controlToken}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() as any };
  };
  const coreControl = async (body: unknown) => {
    const result = await post("/admin/agent-native", body);
    expect(result.status).toBe(200); expect(result.body.ok).toBe(true); return result.body.value;
  };
  const model = "native-shutdown-fixture", admissionId = "explicit-native-shutdown-fixture";
  const bridge = createAgentNativeBridge({ canStart: () => true,
    validateOffer: (envelope, payloadDigest) => coreControl({ action: "validate-offer", scope: envelope.scope, model: envelope.model, admissionId: envelope.admissionId, payloadDigest }),
    resolveAdmission: (id, selectedModel) => id === admissionId && selectedModel === model ? { createWorker(_binding, notify) {
      factories++; let handle: string | null = null, thread: string | null = null; const rows: any[] = [];
      const snapshot = () => ({ availability: { available: true }, storageOwner: handle ? "current" : "unclaimed", workerHandle: handle, receipts: structuredClone(rows) });
      return {
        inspectOwnedWorker: snapshot,
        async createOwnedWorker({ actionId }: any) {
          handle = randomUUID(); thread = randomUUID();
          const receipt = { actionId, kind: "create", workerHandle: handle, threadId: thread, admissionId, state: "completed", ownerHeld: false };
          rows.push(receipt); return { workerHandle: handle, threadId: thread, admissionId, receipt };
        },
        async offerOwnedTurn({ actionId, text, outputSchema }: any) {
          offers++;
          const row: any = { actionId, kind: "offer", workerHandle: handle, threadId: thread, admissionId, inputHash: digest(text), schemaHash: digest(canonical(outputSchema)),
            inputAuthorship: "automatic-host", state: "acknowledged", ownerHeld: true, turnId: randomUUID(), observations: [] };
          rows.push(row); row.observations.push({ state: row.state, ownerHeld: true, turnId: row.turnId, timestampMs: Date.now() });
          notify(structuredClone(row)); acknowledged.resolve();
          await finishOffer.promise; return structuredClone(row);
        },
        async retireOwnedWorker() { retirements++; return snapshot(); },
        currentOperation: () => null,
        async destroy() {
          closeAttempts++; closing.resolve(); await allowClose.promise; closes++;
          for (const row of rows) if (row.kind === "offer") { Object.assign(row, { state: "unknown", ownerHeld: false }); notify(structuredClone(row)); }
          finishOffer.resolve();
        },
      } as any;
    } } : undefined });
  const main = await new BrowserControlServer({ logger: { info() {}, warn() {}, error() {} },
    getBrowserHost() { throw new Error("Shutdown fixture must not use a browser"); }, getPreferences: () => ({}),
    getAgentNativeBridge: () => bridge, getAgentNativeInstance: () => publisher?.instanceId,
    // No Remote owners exist in this fixture; its shared tool invalidation still uses
    // the real private bridge and actual core generation-fence validation.
    getAgentRemoteService: () => ({ invalidateAgentTask: () => ({ invalidated: true }) }),
    getAgentRemoteInstance: () => remotePublisher?.instanceId,
    async validateRemoteInvalidation(body: any) {
      const result = await post("/admin/agent-remote", { action: "validate-invalidation", ...body });
      expect(result.status).toBe(200); return result.body.value;
    },
    async validateNativeInvalidation(body: any) {
      invalidationScopes.push({ taskId: body.taskId, familyId: body.familyId, beforeGeneration: body.beforeGeneration });
      const scope = await coreControl({ action: "validate-invalidation", taskId: body.taskId, familyId: body.familyId, beforeGeneration: body.beforeGeneration });
      if (failCleanup) throw new Error("Injected cleanup transport failure after authority validation");
      return scope;
    },
  }).start();
  try {
    remotePublisher = createAgentRemoteDescriptorPublisher({ coreHome: home, profile: "development", control: main.descriptor() }); remotePublisher.publish();
    publisher = createAgentNativeDescriptorPublisher({ coreHome: home, profile: "development", control: main.descriptor() });
    publisher.publish({ models: [{ id: model, provider: "owned-native", admissionId, available: true, accepting: true }], accepting: true });
    server = startServer(config, { nativeLauncherProfile: "development", fetchUpstream: async () => { throw new Error("No real model/provider network in shutdown fixture"); } });
    endpoint = `http://127.0.0.1:${server.port}`;
    const taskId = randomUUID();
    expect((await post("/admin/agent-mode", { action: "create", actionId: "create", input: { id: taskId, familyId: taskId, ownerMode: "agent", mode: "manual", originalRequest: "Hold one synthetic Native leaf for exact shutdown cleanup.",
      requirements: [{ id: "hold", text: "Retain unknown ownership until physical closure." }], stages: [{ id: "hold", instruction: "Use the synthetic held leaf only.", requirementIds: ["hold"] }],
      bounds: { maxConcurrent: 1, maxTurns: 1, maxSpend: null }, execution: { provider: "owned-native", model, admissionId } } })).status).toBe(201);
    expect((await post("/admin/agent-mode", { action: "step", taskId, actionId: "step", explicitUserAction: true })).status).toBe(202);
    await acknowledged.promise;
    reader = new AgentModeStore(join(home, "agent-mode", "state.sqlite"));
    // Pause ends local observation without claiming the held Native effect was cancelled.
    expect((await post("/admin/agent-mode", { action: "control", taskId, actionId: "pause-before-shutdown", control: { action: "pause" } })).status).toBe(200);
    expect((await post("/admin/drain", {})).status).toBe(200);
    expect((await post("/admin/shutdown", {})).status).toBe(200);
    await shutdownFailed.promise;
    expect(await (await fetch(`${endpoint}/healthz`)).json()).toMatchObject({ draining: true, shutdown_stage: "failed", shutdown_error_code: "shutdown_cleanup_failed", active_agent_turns: 0 });
    expect([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")]).toEqual(signalCounts.map(count => count + 1));
    const held = bridge.status();
    expect(held.activeCount).toBe(1); expect(held.receipts[0]).toMatchObject({ ownerHeld: true });
    expect(factories).toBe(1); expect(offers).toBe(1); expect(retirements).toBe(0); expect(closes).toBe(0);
    const retained = await post("/admin/agent-mode", { action: "get", taskId });
    expect(retained.status).toBe(200); expect(retained.body.value.dispatches[0].state).toBe("unknown");
    const generation = retained.body.value.task.generation;
    expect(reader.getTask(taskId).generation).toBe(generation);
    expect((await post("/admin/agent-mode", { action: "control", taskId, actionId: "no-mutation-during-stop", control: { action: "resume" } })).status).toBe(409);
    expect((await post("/admin/local-control-api-action", { taskId, actionId: "no-alternate-mutation", familyId: taskId,
      generation, revision: retained.body.value.task.revision, operation: "resume", explicitUserAction: true })).status).toBe(409);
    failCleanup = false;
    let stopped = false;
    // An explicit signal retries only cleanup after the callback owner is recovered.
    process.emit("SIGTERM");
    await closing.promise;
    process.emit("SIGINT"); process.emit("SIGTERM");
    expect([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")]).toEqual(signalCounts.map(count => count + 1));
    const forced = server.stop(true).then(() => { stopped = true; });
    expect(stopped).toBe(false); expect(closes).toBe(0); expect(closeAttempts).toBe(1);
    expect(await (await fetch(`${endpoint}/healthz`)).json()).toMatchObject({ native_accepting_turns: false });
    expect((await post("/admin/agent-mode", { action: "status" })).body.value.accepting).toBe(false);
    expect((await post("/admin/agent-mode", { action: "step", taskId, actionId: "no-new-offer", explicitUserAction: true })).status).toBe(409);
    expect(await coreControl({ action: "validate-invalidation", taskId, familyId: taskId, beforeGeneration: generation })).toEqual({ taskId, familyId: taskId, beforeGeneration: generation });
    expect((await post("/admin/agent-mode", { action: "get", taskId })).status).toBe(200);
    expect(invalidationScopes).toEqual(Array(3).fill({ taskId, familyId: taskId, beforeGeneration: generation }));
    allowClose.resolve(); await forced; await server.stop(true);
    expect([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")]).toEqual(signalCounts);
    await expect(fetch(`${endpoint}/healthz`, { signal: AbortSignal.timeout(1_000) })).rejects.toThrow();
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(closes).toBe(1); expect(closeAttempts).toBe(1); expect(retirements).toBe(1); expect(offers).toBe(1); expect(factories).toBe(1);
    expect(bridge.status().activeCount).toBe(0); expect(bridge.status().receipts[0]).toMatchObject({ state: "unknown", ownerHeld: false });
    expect(reader.getTask(taskId).generation).toBe(generation); expect(reader.listDispatches(taskId)[0].state).toBe("unknown");
  } finally {
    failCleanup = false; allowClose.resolve(); finishOffer.resolve();
    await server?.stop(true); await bridge.destroy(); await main.close(); reader?.close();
    for (const key of keys) { const value = previous.get(key); if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    errorLog.mockRestore(); process.exitCode = previousExitCode ?? 0;
    rmSync(home, { recursive: true, force: true });
  }
}, 10_000);
