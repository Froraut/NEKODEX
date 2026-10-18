import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentModeRuntime, AgentModeStore, AGENT_NATIVE_PROTOCOL, createAgentModeRoutes, createOwnedNativeExecutionPort, nativeDigest } from "../src/agent-mode";
import type { AgentNativeBridge, AgentNativeOfferEnvelope, AgentNativeReceipt } from "../src/agent-mode";
import { createAgentToolsComposition } from "../src/agent-tools/composition";
import { createAgentRemoteControlRoutes } from "../src/agent-tools/remote-control";
import { createAgentRemoteDescriptorPublisher } from "../launcher/electron/agent-remote-descriptor.cjs";
import { createLauncherRemoteBridge } from "../src/remote-workspace/launcher-bridge";
import { createAgentRemoteToolsProvider } from "../src/remote-workspace/agent-tools";
import type { RemoteToolRequest } from "../src/remote-workspace/protocol";
import type { RemoteWorkspaceService } from "../launcher/electron/remote-workspace.cjs";
const { createRemoteWorkspaceService } = createRequire(import.meta.url)("../launcher/electron/remote-workspace.cjs");
const { BrowserControlServer } = createRequire(import.meta.url)("../launcher/electron/control-server.cjs");

test("ROOT remote flow retains one approved main-owned command through lost HTTP observation and pure reconciliation", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "nekodex-agent-remote-flow-")));
  const dataRoot = join(home, "selected-root"); mkdirSync(dataRoot); writeFileSync(join(dataRoot, "selected.txt"), "inert selected content\n");
  const store = new AgentModeStore(join(home, "agent.sqlite"));
  let runtime!: AgentModeRuntime, tools!: ReturnType<typeof createAgentToolsComposition>;
  let service!: RemoteWorkspaceService, instanceId = "", coreEndpoint = "";
  let nativeFailure: unknown;
  let effects = 0, executeOffers = 0, receiptReads = 0, lostResponse = false, nativeClaims = 0;
  const offers: AgentNativeOfferEnvelope[] = [];
  const coreToken = "inert-core-control";
  const authorize = (request: Request) => request.headers.get("authorization") === `Bearer ${coreToken}`;
  const fullScope = () => { const task = store.getTask("remote-task"); return { taskId: task.id, familyId: task.familyId, generation: task.generation, revision: task.revision }; };
  // Main crosses the real core HTTP validator; these callbacks never invent approval.
  const validate = async (body: unknown) => {
    const response = await fetch(`${coreEndpoint}/internal/agent-remote`, { method: "POST", headers: { authorization: `Bearer ${coreToken}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    const packet = await response.json() as any;
    if (!response.ok || !packet.ok) throw new Error("Core rejected exact remote authority");
    return packet.value;
  };
  const main = new BrowserControlServer({ logger: { info() {}, error() {} }, getAgentRemoteService: () => service,
    getAgentRemoteInstance: () => instanceId, validateRemoteInvalidation: (fence: unknown) => validate({ action: "validate-invalidation", ...fence as object }) });
  await main.start();
  const publisher = createAgentRemoteDescriptorPublisher({ coreHome: home, profile: "development", control: main.descriptor() });
  publisher.publish(); instanceId = publisher.instanceId;
  service = createRemoteWorkspaceService({ storagePath: join(home, "remote-registry.json"), agentInstanceId: instanceId,
    transportFactory: () => ({ ready: Promise.resolve(), closed: false, close() { this.closed = true; },
      realpath: async (file: string) => realpathSync(file),
      stat: async (file: string) => { try { const stat = lstatSync(file); return { size: stat.size, mode: stat.mode }; } catch { return null; } },
      read: async (file: string) => { try { return readFileSync(file); } catch { return null; } },
      list: async (file: string) => ({ truncated: false, entries: readdirSync(file).map(name => { const stat = lstatSync(join(file, name)); return { name, mode: stat.mode, size: stat.size }; }) }),
    }),
    commandRunner: async () => { effects++; writeFileSync(join(home, "effect-count"), String(effects)); return { exitCode: 0, stdout: "one inert selected effect", stderr: "", stopped: null, truncated: false }; },
    validateAgentTask: (scope: unknown) => validate({ action: "validate-task", scope }),
    validateAgentIntent: (request: unknown) => validate({ action: "validate-intent", request }),
  });
  const bridge = createLauncherRemoteBridge({ descriptorPath: publisher.path, expectedProfile: "development", requestWaitMs: 2000,
    fetch: (async (input: any, init: any) => {
      const action = new URL(String(input)).pathname.split("/").at(-1);
      if (action === "execute") executeOffers++;
      if (action === "receipt") receiptReads++;
      const response = await fetch(input, init);
      if (action === "execute" && response.ok && !lostResponse) {
        // Reach actual committed terminal state before losing only its HTTP observation.
        const request = JSON.parse(init.body) as RemoteToolRequest;
        expect(service.agentReceipt(request)?.state).toBe("completed"); expect(effects).toBe(1);
        lostResponse = true; await response.body?.cancel(); throw new Error("Synthetic terminal HTTP response lost");
      }
      return response;
    }) as typeof fetch });
  const active = (scope: { taskId: string; generation: number }) => { const task = store.getTask(scope.taskId); return task.generation === scope.generation && ["ready", "running", "awaiting_input"].includes(task.status); };
  const remote = createAgentRemoteToolsProvider({ bridge, isScopeActive: active, resolveTaskScope: () => fullScope() });
  const models = () => [{ id: "synthetic-native", provider: "owned-native" as const, admissionId: "synthetic-admission", available: true }];
  const nativeBridge: AgentNativeBridge = {
    async offer(envelope) {
      try {
        offers.push(structuredClone(envelope));
        expect(runtime.validateNativeOffer({ scope: envelope.scope, payloadDigest: nativeDigest(envelope), model: envelope.model, admissionId: envelope.admissionId }).claimId).toBe(store.getDispatch(envelope.actionId).transportClaim!.id);
        const context = JSON.parse(envelope.text);
        let output: object;
        if (offers.length === 1) {
          const command = context.declaredTools.find((tool: any) => tool.id === "remote/command");
          expect(context.declaredTools).toHaveLength(3); expect(command.inputSchema.properties.binding.const.mainInstanceId).toBe(instanceId);
          expect(effects).toBe(0);
          output = { protocol: AGENT_NATIVE_PROTOCOL, kind: "tool_request", requestId: "one-command", toolId: "remote/command",
            argumentsJson: JSON.stringify({ binding: command.inputSchema.properties.binding.const, command: "inert selected command", timeoutSeconds: 5 }), summary: null };
        } else {
          expect(envelope.continuation).toBeDefined(); expect(context.toolResults).toHaveLength(1);
          expect(context.toolResults[0]).toMatchObject({ tool: "remote/command", state: "completed", result: { structuredContent: { proof: "remote-command-execution-only", exitCode: 0 } } });
          output = { protocol: AGENT_NATIVE_PROTOCOL, kind: "final", requestId: null, toolId: null, argumentsJson: null, summary: "Observed one retained command receipt; independent application outcome still requires review." };
        }
        const receipt: AgentNativeReceipt = { version: 1, actionId: envelope.actionId, scope: { ...envelope.scope }, model: envelope.model, admissionId: envelope.admissionId,
          outputSchemaId: envelope.outputSchemaId, payloadDigest: nativeDigest(envelope), revision: 1, state: "completed", ownerHeld: false, writeDisposition: "written",
          workerBindingId: "synthetic-native-binding", workerGeneration: 1, nativeTurnReceiptId: `native-turn-${envelope.actionId}`, acceptanceReceipt: `native-ack-${envelope.actionId}`,
          inputAuthorship: "automatic-host", assistantText: JSON.stringify(output) };
        return receipt;
      } catch (error) { nativeFailure = error; throw error; }
    },
    async readReceipt() { throw new Error("Native receipt lookup is outside this direct synthetic model turn"); },
    async waitReceipt() { throw new Error("Native wait is outside this direct synthetic model turn"); },
  };
  const native = createOwnedNativeExecutionPort({ models, bridge: nativeBridge,
    claimTransport(request, digest) { nativeClaims++; runtime.claimNativeTransport(request, digest); },
    tools: { discover: (scope, options) => tools.toolsPort.discover(scope, options) } });
  runtime = new AgentModeRuntime({ store, ownerId: "synthetic-core-owner", models, canStart: () => true, executionPort: native,
    toolsAvailable: () => true, reconcileToolReceipt: request => tools.reconcileReceipt(request),
    onTaskScopeInvalidated: taskId => tools.invalidateTaskTools(taskId) });
  tools = createAgentToolsComposition({ home, authorize, remoteTools: remote, isScopeActive: active,
    resolveToolCall: scope => runtime.resolveToolCall(scope), onOutcome: outcome => { runtime.recordToolOutcome(outcome); } });
  const modeHandler = createAgentModeRoutes({ runtime, authorize });
  const remoteHandler = createAgentRemoteControlRoutes({ runtime: () => runtime, tools: () => tools, authorize, canStart: () => true });
  const core = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    if (new URL(request.url).pathname === "/internal/agent-remote") return remoteHandler(request);
    return await modeHandler(request) ?? await tools.handle(request) ?? new Response("missing", { status: 404 });
  } });
  coreEndpoint = `http://127.0.0.1:${core.port}`;
  const post = async (surface: "agent-mode" | "agent-tools", body: unknown) => {
    const response = await fetch(`${coreEndpoint}/admin/${surface}`, { method: "POST", headers: { authorization: `Bearer ${coreToken}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, packet: await response.json() as any };
  };
  try {
    expect(tools.status().config.enabled).toBe(false); expect(effects).toBe(0);
    const created = await post("agent-mode", { action: "create", actionId: "create-remote", input: { id: "remote-task", familyId: "remote-family", ownerMode: "agent", mode: "manual",
      originalRequest: "Request one exact remote command and review the independent application result.", requirements: [{ id: "result", text: "Verify the independent application outcome." }],
      stages: [{ id: "work", instruction: "Use the explicitly attached selected remote host once.", requirementIds: ["result"] }], bounds: { maxConcurrent: 1, maxTurns: 2, maxSpend: null },
      execution: { provider: "owned-native", model: "synthetic-native", admissionId: "synthetic-admission" } } });
    expect(created.status).toBe(201);
    const host = service.addHost({ label: "Inert selected host", hostname: "never-connect.invalid", username: "fixture", port: 22, root: dataRoot });
    await service.connect(host.id);
    expect((await post("agent-tools", { action: "bindRemoteTools", hostId: host.id, scope: fullScope(), explicitUserAction: true })).status).toBe(200);
    expect((await post("agent-mode", { action: "step", taskId: "remote-task", actionId: "first-turn", explicitUserAction: true })).status).toBe(202);
    await runtime.waitForIdle();
    expect(nativeFailure).toBeUndefined(); expect(offers).toHaveLength(1); expect(effects).toBe(0);
    const first = store.listDispatches("remote-task")[0]!;
    const pending = first.result!.continuation!.pending[0]!;
    const scope = { taskId: "remote-task", generation: 1, toolCallId: pending.toolCallId };
    const request = { scope, ...runtime.resolveToolCall(scope)! } as RemoteToolRequest;
    expect(request.tool).toBe("remote/command");
    // A private descriptor/token and a real pending call still cannot forge approval.
    const forged = await fetch(`${main.descriptor().endpoint}/v1/agent-remote/execute`, { method: "POST", headers: { authorization: `Bearer ${main.descriptor().token}`, "x-nekodex-remote-instance": instanceId, "content-type": "application/json" }, body: JSON.stringify(request) });
    expect(forged.status).toBe(409); await forged.arrayBuffer(); expect(effects).toBe(0);
    const approval = { action: "approveInvoke", scope, explicitUserAction: true };
    const unknown = await post("agent-tools", approval);
    expect(unknown.status).toBe(200); expect(unknown.packet.value.state).toBe("outcome_unknown");
    expect(lostResponse).toBe(true); expect(effects).toBe(1); expect(executeOffers).toBe(1);
    expect(store.getTask("remote-task")).toMatchObject({ status: "paused", reason: "tool_outcome_unknown" });
    const original = JSON.stringify(store.listToolOutcomes("remote-task"));
    expect((await post("agent-tools", approval)).packet.value.state).toBe("outcome_unknown");
    expect((await post("agent-tools", { action: "receipt", idempotencyKey: request.idempotencyKey })).packet.value.state).toBe("outcome_unknown");
    expect(effects).toBe(1); expect(executeOffers).toBe(1);
    const taskScope = fullScope();
    const reconciled = await runtime.reconcileTool("remote-task", "reconcile-exact", taskScope, request.idempotencyKey);
    expect(reconciled.outcome.state).toBe("completed"); expect(reconciled.task.status).toBe("ready");
    expect(receiptReads).toBe(1); expect(effects).toBe(1); expect(executeOffers).toBe(1);
    expect(JSON.stringify(store.listToolOutcomes("remote-task"))).toBe(original);
    expect(store.listToolReconciliations("remote-task")).toHaveLength(1);
    await runtime.reconcileTool("remote-task", "reconcile-exact", taskScope, request.idempotencyKey);
    expect(receiptReads).toBe(1);
    expect((await post("agent-mode", { action: "step", taskId: "remote-task", actionId: "second-turn", explicitUserAction: true })).status).toBe(202);
    await runtime.waitForIdle();
    expect(offers).toHaveLength(2); expect(nativeClaims).toBe(2); expect(effects).toBe(1); expect(executeOffers).toBe(1);
    expect(store.getTask("remote-task")).toMatchObject({ status: "review_required", turns: 2 });
    expect(readFileSync(join(home, "effect-count"), "utf8")).toBe("1");
    expect(store.getTask("remote-task").evidence).toEqual([]);
  } finally {
    await runtime.waitForIdle();
    // Exact revocations still reach main while both authenticated listeners are alive.
    await tools.close(); await remote.settle();
    expect(service.agentStatus().bindings).toEqual([]);
    await service.destroy(); await main.close(); core.stop(true); store.close(); rmSync(home, { recursive: true, force: true });
  }
}, 10000);
