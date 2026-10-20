import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentModeRuntime, AgentModeStore, createAgentModeRoutes } from "../src/agent-mode";
import type { AgentToolRequest } from "../src/agent-mode";

test("compact pending approval metadata survives bounded image history and never reoffers recorded or stale calls", async () => {
  const home = mkdtempSync(join(tmpdir(), "nekodex-agent-pending-calls-"));
  const store = new AgentModeStore(join(home, "state.sqlite"));
  let executions = 0;
  const calls: AgentToolRequest[] = ["done", "unknown", "click"].map((name, index) => ({ toolCallId: `call-${name}`, tool: `desktop/${name}`, wireName: `agent_tool_${index}`, arguments: { binding: { observationId: "exact-fresh-frame", screenshotId: "frame-sha" }, ...(name === "click" ? { x: 91, y: 32 } : {}) } }));
  const runtime = new AgentModeRuntime({ store, models: () => [{ id: "synthetic-model" }], ownerId: "synthetic-pending-owner", executionPort: { async execute(request, acknowledge) {
    executions++; acknowledge("synthetic-accepted");
    return { receiptId: "synthetic-terminal", outcome: "awaiting_input", actualSpend: null, summary: "Synthetic approval calls with retained large canonical image history.", continuation: {
      responseId: "synthetic-response", rootDispatchId: request.dispatch.id,
      // Opaque retained canonical history: this fixture does not decode, execute or send an image.
      input: [{ type: "function_call_output", call_id: "earlier-observe", output: [{ type: "input_image", image_url: `data:image/jpeg;base64,${"A".repeat(100_000)}` }, { type: "input_image", image_url: `data:image/jpeg;base64,${"B".repeat(100_000)}` }] }],
      output: calls.map(call => ({ type: "function_call", call_id: call.toolCallId, name: call.wireName, arguments: JSON.stringify(call.arguments) })),
      tools: [], toolMap: calls.map(call => ({ wireName: call.wireName, tool: call.tool })), pending: calls,
    } };
  } } });
  const handler = createAgentModeRoutes({ runtime, authorize: request => request.headers.get("authorization") === "Bearer synthetic-control" });
  const detail = async () => {
    const response = (await handler(new Request("http://127.0.0.1/admin/agent-mode", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer synthetic-control" }, body: JSON.stringify({ action: "get", taskId: "task" }) })))!;
    expect(response.status).toBe(200); return (await response.json() as any).value;
  };
  try {
    runtime.create("create", { id: "task", ownerMode: "agent", mode: "manual", originalRequest: "Inspect only synthetic retained metadata; no real tool or account.", requirements: [{ id: "result", text: "Report synthetic metadata." }], stages: [{ id: "work", instruction: "Request and report synthetic calls after exact approval.", requirementIds: ["result"] }], bounds: { maxConcurrent: 1, maxTurns: 2, maxSpend: null }, execution: { provider: "local-responses", model: "synthetic-model" } });
    runtime.step("task", "step", { explicitUserAction: true }); await runtime.waitForIdle();
    const original = store.listDispatches("task")[0]!;
    expect(Buffer.byteLength(JSON.stringify(original))).toBeGreaterThan(128 * 1024);
    const first = await detail();
    expect(first.dispatches).toEqual([]);
    expect(first.coverage.dispatches).toEqual({ total: 1, truncated: true });
    expect(first.pendingToolCalls).toEqual(calls);
    expect(first.coverage.pendingToolCalls).toEqual({ total: 3, truncated: false });
    expect(Buffer.byteLength(JSON.stringify(first.pendingToolCalls))).toBeLessThan(128 * 1024);
    for (const [index, state] of [[0, "completed"], [1, "outcome_unknown"]] as const) {
      const call = calls[index]!;
      runtime.recordToolOutcome({ idempotencyKey: store.toolCallReceiptKey(original.id, call.toolCallId), scope: { taskId: "task", generation: 1, toolCallId: call.toolCallId }, tool: call.tool, state, ...(state === "completed" ? { result: { retainedPayload: "X".repeat(150_000) } } : { reason: "Exact effect outcome remains unknown; never replay." }) });
    }
    const filtered = await detail();
    expect(filtered.pendingToolCalls).toEqual([calls[2]]);
    expect(filtered.coverage.pendingToolCalls).toEqual({ total: 1, truncated: false });
    expect(filtered.toolOutcomes.some((row: any) => row.state === "completed")).toBe(false); // Large bounded outcome omission cannot make its call approvable again.
    expect(store.getDispatch(original.id)).toEqual(original); // Canonical image bytes remain immutable.
    expect(executions).toBe(1);
    runtime.control("task", "pause", { action: "pause" });
    const stale = await detail();
    expect(stale.task.generation).toBe(2);
    expect(stale.pendingToolCalls).toEqual([]);
    expect(store.listToolOutcomes("task")).toHaveLength(2);
    expect(store.getDispatch(original.id)).toEqual(original);
    expect(executions).toBe(1);
  } finally { await runtime.waitForIdle(); store.close(); rmSync(home, { recursive: true, force: true }); }
});
