import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AgentModeRuntime, AgentModeStore, createAgentModeRoutes } from "../src/agent-mode";
import { createAgentToolsComposition, type StandaloneBuiltinToolsProvider, type ToolOutcome } from "../src/agent-tools";

test("retained late tool receipts reconcile without replay, while correction invalidates the old scope exactly once", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "nekodex-tool-reconcile-")));
  const path = join(home, "agent.sqlite"); const store = new AgentModeStore(path);
  let reopened: AgentModeStore | undefined;
  let effects = 0; let modelRequests = 0; let receiptReads = 0; let invalidations = 0;
  const retained = new Map<string, Pick<ToolOutcome, "state" | "result" | "reason">>();
  let lateReadReached!: () => void; let releaseLateRead!: () => void;
  const lateReached = new Promise<void>(resolve => { lateReadReached = resolve; });
  const lateGate = new Promise<void>(resolve => { releaseLateRead = resolve; });
  const builtin: StandaloneBuiltinToolsProvider = {
    serverId: "browser",
    async discover() { return [{ id: "browser/input", serverId: "browser", name: "input", supported: true, inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false } }]; },
    async execute() {
      effects++; writeFileSync(join(home, "effect-count"), String(effects));
      return { state: "outcome_unknown", reason: "Fixture effect was dispatched; retained terminal receipt is not available yet." };
    },
    async reconcile(request) {
      receiptReads++;
      if (request.scope.toolCallId === "call-second") { lateReadReached(); await lateGate; }
      return retained.get(request.idempotencyKey);
    },
    invalidate(taskId) { if (taskId !== undefined) { expect(taskId).toBe("task"); invalidations++; } },
  };
  const models = () => [{ id: "synthetic-model" }];
  let tools!: ReturnType<typeof createAgentToolsComposition>;
  const runtime = new AgentModeRuntime({ store, models, ownerId: "fixture-owner", executionPort: { async execute(request, acknowledge) {
    modelRequests++; acknowledge(`model-accepted-${modelRequests}`);
    if (modelRequests === 2) {
      expect(request.continuation?.outcomes[0]?.state).toBe("completed");
      expect(request.continuation?.outcomes[0]?.result).toEqual({ retainedReceipt: "first-terminal", effectCount: 1 });
    }
    const callId = modelRequests === 1 ? "call-first" : "call-second";
    return { receiptId: `model-terminal-${modelRequests}`, outcome: "awaiting_input", actualSpend: null, summary: "Fixture model requested one explicitly approved builtin input.", continuation: {
      responseId: `model-response-${modelRequests}`, rootDispatchId: request.continuation?.source.rootDispatchId ?? request.dispatch.id,
      input: [{ type: "message", role: "user", content: "Synthetic operation only." }],
      output: [{ type: "function_call", call_id: callId, name: "browser_input", arguments: JSON.stringify({ text: callId }) }],
      tools: [{ type: "function", name: "browser_input", parameters: { type: "object" } }], toolMap: [{ wireName: "browser_input", tool: "browser/input" }],
      pending: [{ toolCallId: callId, tool: "browser/input", wireName: "browser_input", arguments: { text: callId } }],
    } };
  } }, lookupToolOutcome: key => tools.receipt(key), reconcileToolReceipt: request => tools.reconcileReceipt(request), onTaskScopeInvalidated: taskId => tools.invalidateTaskTools(taskId) });
  const authorize = (request: Request) => request.headers.get("authorization") === "Bearer fixture-control";
  tools = createAgentToolsComposition({ home, authorize, builtins: [builtin], isScopeActive: scope => {
    const task = store.getTask(scope.taskId); return task.generation === scope.generation && ["ready", "running", "awaiting_input"].includes(task.status);
  }, resolveToolCall: scope => runtime.resolveToolCall(scope), onOutcome: outcome => { runtime.recordToolOutcome(outcome); } });
  const agentHandler = createAgentModeRoutes({ runtime, authorize });
  const post = async (surface: "agent-mode" | "agent-tools", body: unknown) => {
    const request = new Request(`http://127.0.0.1/admin/${surface}`, { method: "POST", headers: { authorization: "Bearer fixture-control", "content-type": "application/json" }, body: JSON.stringify(body) });
    const response = (surface === "agent-mode" ? await agentHandler(request) : await tools.handle(request))!;
    return { status: response.status, body: await response.json() as any };
  };
  const scope = () => { const task = store.getTask("task"); return { familyId: task.familyId, generation: task.generation, revision: task.revision }; };
  try {
    await post("agent-mode", { action: "create", actionId: "create", input: { ownerMode: "agent", id: "task", familyId: "family", mode: "manual", originalRequest: "Perform isolated synthetic inputs only after exact approval.", requirements: [{ id: "result", text: "Report the exact retained results." }], stages: [{ id: "work", instruction: "Request and report the isolated builtin operation.", requirementIds: ["result"] }], bounds: { maxConcurrent: 1, maxTurns: 4, maxSpend: null }, execution: { provider: "local-responses", model: "synthetic-model" } } });
    await post("agent-mode", { action: "step", taskId: "task", actionId: "step-first", scope: scope(), explicitUserAction: true }); await runtime.waitForIdle();
    const approveFirst = { action: "approveInvoke", scope: { taskId: "task", generation: 1, toolCallId: "call-first" }, explicitUserAction: true };
    expect((await post("agent-tools", approveFirst)).body.value.state).toBe("outcome_unknown");
    const firstRequest = store.toolReceiptRequest("task", store.listToolOutcomes("task")[0]!.idempotencyKey);
    expect(store.getTask("task")).toMatchObject({ status: "paused", reason: "tool_outcome_unknown" });
    expect(readFileSync(join(home, "effect-count"), "utf8")).toBe("1");
    const firstAction = { action: "reconcile-tool", taskId: "task", actionId: "check-before-terminal", scope: scope(), idempotencyKey: firstRequest.idempotencyKey };
    expect((await post("agent-mode", firstAction)).body.value.unchanged).toBe(true);
    expect(store.listToolReconciliations("task")).toHaveLength(0); expect(store.getTask("task").status).toBe("paused");
    retained.set(firstRequest.idempotencyKey, { state: "completed", result: { retainedReceipt: "first-terminal", effectCount: 1 } });
    await post("agent-mode", { action: "get", taskId: "task" });
    expect(receiptReads).toBe(1); expect(store.getTask("task").status).toBe("paused"); // Metadata reads never reconcile an existing unknown.
    expect((await post("agent-mode", { ...firstAction, actionId: "caller-cannot-certify", outcome: { state: "completed" } })).status).toBe(400);
    await expect(tools.reconcileReceipt({ ...firstRequest, arguments: { text: "changed arguments" } })).rejects.toThrow("identity conflict");
    expect(receiptReads).toBe(1);
    const reconciled = await post("agent-mode", { ...firstAction, actionId: "adopt-first-terminal" });
    expect(reconciled.status).toBe(200); expect(reconciled.body.value.reconciliation.late).toBe(false);
    expect(store.getTask("task").status).toBe("ready"); expect(store.listToolOutcomes("task")[0]?.state).toBe("outcome_unknown");
    expect(store.effectiveToolOutcomes("task")[0]?.state).toBe("completed"); expect(effects).toBe(1);
    expect((await post("agent-tools", approveFirst)).body.value.state).toBe("completed"); expect(effects).toBe(1); // Original invocation retry returns the adopted receipt, without rewriting unknown history.
    await post("agent-mode", { ...firstAction, actionId: "adopt-first-terminal" }); expect(receiptReads).toBe(2); expect(effects).toBe(1);
    await post("agent-mode", { action: "step", taskId: "task", actionId: "step-second", scope: scope(), explicitUserAction: true }); await runtime.waitForIdle();
    expect(modelRequests).toBe(2);
    expect((await post("agent-tools", { action: "approveInvoke", scope: { taskId: "task", generation: 1, toolCallId: "call-second" }, explicitUserAction: true })).body.value.state).toBe("outcome_unknown");
    const second = store.listToolOutcomes("task")[1]!;
    retained.set(second.idempotencyKey, { state: "completed", result: { retainedReceipt: "late-second-terminal", effectCount: 2 } });
    const lateAction = { action: "reconcile-tool", taskId: "task", actionId: "late-terminal", scope: scope(), idempotencyKey: second.idempotencyKey };
    const late = post("agent-mode", lateAction); await lateReached;
    const correction = { action: "control", taskId: "task", actionId: "correction", scope: scope(), control: { action: "correct", text: "Use the replacement instruction; do not revive the prior inputs.", requirements: [{ id: "replacement", text: "Preserve the replacement instruction." }], stages: [{ id: "replacement", instruction: "Wait for a new explicit action before working on the replacement.", requirementIds: ["replacement"] }] } };
    expect((await post("agent-mode", correction)).status).toBe(200);
    expect((await post("agent-mode", correction)).status).toBe(200); expect(invalidations).toBe(1);
    const replacement = store.getTask("task"); releaseLateRead();
    const lateResult = await late;
    expect(lateResult.status).toBe(200); expect(lateResult.body.value.reconciliation).toMatchObject({ late: true, originalScope: { generation: 1 }, observedTaskGeneration: 2 });
    expect(store.getTask("task")).toEqual(replacement); expect(store.listWorkers("task")[0]?.state).toBe("sleeping");
    expect(effects).toBe(2); expect(modelRequests).toBe(2); expect(readFileSync(join(home, "effect-count"), "utf8")).toBe("2");
    const detail = await post("agent-mode", { action: "get", taskId: "task" });
    expect(detail.body.value.toolOutcomes.map((row: ToolOutcome) => row.state)).toEqual(["outcome_unknown", "outcome_unknown"]);
    expect(detail.body.value.effectiveToolOutcomes.map((row: ToolOutcome) => row.state)).toEqual(["completed", "completed"]);
    expect(detail.body.value.toolReconciliations).toHaveLength(2);
    reopened = new AgentModeStore(path);
    expect(reopened.listToolOutcomes("task")).toEqual(store.listToolOutcomes("task"));
    expect(reopened.listToolReconciliations("task")[1]?.late).toBe(true);
    expect(reopened.effectiveToolOutcomes("task")[1]?.state).toBe("completed");
    await post("agent-mode", lateAction); expect(receiptReads).toBe(3); expect(effects).toBe(2);
  } finally {
    releaseLateRead(); await runtime.waitForIdle();
    try { await tools.close(); } finally { reopened?.close(); store.close(); rmSync(home, { recursive: true, force: true }); }
  }
}, 5_000);
