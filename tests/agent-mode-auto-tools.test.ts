import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentModeRuntime, AgentModeStore } from "../src/agent-mode";
import type { AgentExecutionPort, AgentToolOutcome } from "../src/agent-mode/types";

async function fixture(mode: "goal" | "manual" | "loop", automatic: boolean) {
  const home = mkdtempSync(join(tmpdir(), "neko-auto-tool-"));
  const store = new AgentModeStore(join(home, "state.sqlite"));
  let offers = 0;
  const models = () => [{ id: "fixture" }];
  const executionPort: AgentExecutionPort = { async execute(request, acknowledge) {
    offers++; acknowledge(`accepted-${offers}`);
    if (request.continuation) {
      expect(request.continuation.outcomes).toHaveLength(1);
      expect(request.continuation.outcomes[0]?.state).toBe("completed");
      return { receiptId: `done-${offers}`, outcome: "completed", summary: "Observed approved fixture result", actualSpend: null };
    }
    return { receiptId: "proposal", outcome: "awaiting_input", summary: "Needs exact tool approval", actualSpend: null,
      continuation: { responseId: "response", rootDispatchId: request.dispatch.id, input: [], output: [], tools: [], toolMap: [],
        pending: [{ toolCallId: "call", tool: "fixture/write", wireName: "fixture_write", arguments: { text: "exact" } }] } };
  } };
  const options = { store, models, executionPort, ownerId: "same-owner" };
  const runtime = new AgentModeRuntime(options);
  runtime.create("create", { id: "task", familyId: "family", ownerMode: "agent", mode, recurringAuthorized: mode === "loop",
    originalRequest: "Only the exact approved fixture operation", requirements: [{ id: "r", text: "Observe the result" }],
    stages: [{ id: "s", instruction: "Request then report the approved result", requirementIds: ["r"] }],
    execution: { provider: "local-responses", model: "fixture" }, bounds: { maxConcurrent: 1, maxTurns: 3, maxSpend: null } });
  runtime.step("task", "start", { explicitUserAction: true, automatic }); await runtime.waitForIdle();
  const first = store.listDispatches("task")[0]!;
  const outcome: AgentToolOutcome = { scope: { taskId: "task", generation: first.generation, toolCallId: "call" }, tool: "fixture/write",
    idempotencyKey: store.toolCallReceiptKey(first.id, "call"), state: "completed", result: { text: "exact" } };
  return { runtime, store, options, outcome, offers: () => offers, async close() { await runtime.waitForIdle(); store.close(); rmSync(home, { recursive: true, force: true }); } };
}

for (const mode of ["goal", "loop"] as const) test(`${mode} explicit Run continues once after exact live tool approval`, async () => {
  const f = await fixture(mode, true);
  try {
    expect(f.offers()).toBe(1); expect(f.store.getTask("task").status).toBe("awaiting_input");
    f.runtime.recordToolOutcome(f.outcome); f.runtime.recordToolOutcome(f.outcome);
    await f.runtime.waitForIdle();
    expect(f.offers()).toBe(2); expect(f.store.listToolOutcomes("task")).toHaveLength(1);
    expect(f.store.listDispatches("task")[1]?.continuationOf).toBe(f.store.listDispatches("task")[0]?.id);
  } finally { await f.close(); }
});

for (const mode of ["manual", "goal"] as const) test(`${mode} explicit Step does not acquire automatic continuation authority`, async () => {
  const f = await fixture(mode, false);
  try { f.runtime.recordToolOutcome(f.outcome); await f.runtime.waitForIdle(); expect(f.offers()).toBe(1); expect(f.store.getTask("task").status).toBe("ready"); }
  finally { await f.close(); }
});

for (const boundary of ["pause", "stop", "correct", "shutdown", "reopen", "passive-read"] as const) test(`automatic tool continuation does not cross ${boundary}`, async () => {
  const f = await fixture("goal", true);
  try {
    let receiver = f.runtime;
    if (boundary === "shutdown") f.runtime.beginShutdown();
    else if (boundary === "reopen") {
      receiver = new AgentModeRuntime(f.options);
      expect(receiver.step("task", "start", { explicitUserAction: true, automatic: true }).duplicate).toBe(true);
    }
    else if (boundary === "passive-read") {
      f.store.recordToolOutcome(f.outcome);
      f.runtime.status(); f.runtime.reconcileToolReceipts("task");
      expect(f.offers()).toBe(1); return;
    }
    else f.runtime.control("task", `control-${boundary}`, boundary === "correct"
      ? { action: "correct", text: "Changed requirement", requirements: [{ id: "r2", text: "Changed result" }], stages: [{ id: "s2", instruction: "Wait for new Run", requirementIds: ["r2"] }] }
      : { action: boundary });
    receiver.recordToolOutcome(f.outcome); await receiver.waitForIdle();
    expect(f.offers()).toBe(1); expect(f.store.listDispatches("task")).toHaveLength(1);
  } finally { await f.close(); }
});
