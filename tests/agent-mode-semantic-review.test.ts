import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentModeRuntime, AgentModeStore, createAgentModeRoutes, createResponsesSemanticReviewPort, normalizeSemanticReview, SEMANTIC_REVIEW_PROTOCOL, SemanticReviewOutputError } from "../src/agent-mode";
import type { AgentToolRequest, SemanticReviewPacket, SemanticReviewRequest } from "../src/agent-mode";

const homes: string[] = [];
const stores: AgentModeStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) { try { store.close(); } catch {} }
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});
function storeAt(): AgentModeStore {
  const home = mkdtempSync(join(tmpdir(), "nekodex-semantic-review-")); homes.push(home);
  const store = new AgentModeStore(join(home, "state.sqlite")); stores.push(store); return store;
}
type Verdict = { requirementId: string; verdict: "pass" | "fail" | "unknown"; sufficiency: "complete" | "partial" | "none"; evidenceIds?: string[]; toolReceiptIds?: string[] };
function reply(rows: Verdict[], deliverable: "pass" | "fail" | "unknown" = "pass"): string {
  return JSON.stringify({ protocol: SEMANTIC_REVIEW_PROTOCOL, requirements: rows.map(row => ({ evidenceIds: [], toolReceiptIds: [], rationale: `Synthetic judgment for ${row.requirementId}.`, missing: [], ...row })),
    deliverable: { verdict: deliverable, rationale: "Synthetic whole-deliverable judgment." } });
}
const selection = { windowId: "4242", processId: "77:1792570820369482", windowEpoch: "a".repeat(64) };

/** A synthetic P13-shaped Manual task: observe, one click and a separate AX property check. */
function desktopFixture(reviewReply: (request: SemanticReviewRequest) => string | Promise<string>) {
  const store = storeAt();
  const calls: AgentToolRequest[] = [
    { toolCallId: "call-observe", tool: "desktop/observe", wireName: "agent_tool_0", arguments: { selection } },
    { toolCallId: "call-click", tool: "desktop/click", wireName: "agent_tool_1", arguments: { binding: { observationId: "frame-1" }, x: 120, y: 80, waitForForeground: true } },
    { toolCallId: "call-verify", tool: "desktop/verifyProperty", wireName: "agent_tool_2", arguments: { selection, expectation: { elementId: "ax-counter", property: "value", equals: "Counter: 1" } } },
  ];
  let executions = 0; const reviews: SemanticReviewRequest[] = [];
  const runtime = new AgentModeRuntime({ store, models: () => [{ id: "synthetic-worker" }, { id: "synthetic-reviewer" }], ownerId: "synthetic-owner",
    executionPort: { async execute(request, acknowledge) {
      executions++; acknowledge(`synthetic-accepted-${executions}`);
      if (!request.continuation) return { receiptId: "synthetic-tools", outcome: "awaiting_input", actualSpend: null, summary: "Requested exact desktop calls.", continuation: {
        responseId: "synthetic-response", rootDispatchId: request.dispatch.id, input: [], output: [], tools: [], toolMap: calls.map(call => ({ wireName: call.wireName, tool: call.tool })), pending: calls } };
      return { receiptId: "synthetic-final", outcome: "completed", actualSpend: null, summary: "Counter before was 0. The click completed. verifyProperty reported Counter: 1." };
    } },
    semanticReviewer: { async review(request) { reviews.push(request); return { receiptId: `response:review-${reviews.length}`, text: await reviewReply(request) }; } },
  });
  const scope = () => { const task = store.getTask("task"); return { familyId: task.familyId, generation: task.generation, revision: task.revision }; };
  const settle = async () => {
    runtime.create("create", { id: "task", familyId: "task-family", ownerMode: "agent", mode: "manual", originalRequest: "Click the synthetic counter once and verify it reads Counter: 1.",
      requirements: [{ id: "r1", text: "One approved click changes the counter from 0 to 1." }, { id: "r2", text: "A separate property check confirms the counter reads Counter: 1." }],
      stages: [{ id: "work", instruction: "Observe, click once, then verify the counter property.", requirementIds: ["r1", "r2"] }],
      bounds: { maxConcurrent: 1, maxTurns: 4, maxSpend: null }, execution: { provider: "local-responses", model: "synthetic-worker" } });
    runtime.step("task", "step-1", { explicitUserAction: true }); await runtime.waitForIdle();
    const source = store.listDispatches("task")[0]!;
    const meta = { selection, observedAt: "2026-10-21T08:00:00.000Z", modelImage: { mimeType: "image/jpeg", sha256: "b".repeat(64) } };
    const results: Record<string, unknown> = {
      "call-observe": { isError: false, content: [{ type: "image", mimeType: "image/jpeg", data: "/9j/SYNTHETICPIXELS" }, { type: "text", text: JSON.stringify(meta) }], structuredContent: meta },
      "call-click": { isError: false, structuredContent: { outcome: "completed", limitation: "An input receipt is not an application outcome." } },
      "call-verify": { isError: false, structuredContent: { source: "owned-macos-desktop", verification: { expectation: { elementId: "ax-counter", property: "value", equals: "Counter: 1" }, actual: "Counter: 1", outcome: "passed" } } },
    };
    for (const call of calls) runtime.recordToolOutcome({ idempotencyKey: store.toolCallReceiptKey(source.id, call.toolCallId), scope: { taskId: "task", generation: 1, toolCallId: call.toolCallId }, tool: call.tool, state: "completed", result: results[call.toolCallId] });
    runtime.resumeContinuation("task", "resume", scope(), source.id);
    runtime.step("task", "step-2", { explicitUserAction: true }); await runtime.waitForIdle();
    expect(store.getTask("task").status).toBe("review_required");
    return { key: (toolCallId: string) => store.toolCallReceiptKey(source.id, toolCallId) };
  };
  return { store, runtime, reviews, settle, scope, executions: () => executions };
}

describe("DW9 independent semantic Goal review", () => {
  test("consumes real desktop AX and click receipts, never passes an action receipt alone, and is not repeated on an unchanged ledger", async () => {
    let key: (id: string) => string = () => "";
    const f = desktopFixture(() => reply([
      { requirementId: "r1", verdict: "pass", sufficiency: "complete", toolReceiptIds: [key("call-click")] },
      { requirementId: "r2", verdict: "pass", sufficiency: "complete", toolReceiptIds: [key("call-verify")] },
    ]));
    ({ key } = await f.settle());
    f.runtime.review("task", "local-review");
    expect(() => f.runtime.verify("task", "verify-early", f.store.getTask("task").review!.id)).toThrow("Requirement outcome is not verified");
    const reviewer = { provider: "local-responses" as const, model: "synthetic-reviewer" };
    const task = await f.runtime.semanticReview("task", "semantic-1", f.scope(), reviewer, true);
    // Separate tool-less context: the reviewer got ledger facts, not worker tools, pixels or history.
    expect(f.reviews).toHaveLength(1);
    const prompt = JSON.parse(f.reviews[0]!.prompt) as { packet: SemanticReviewPacket };
    expect(f.reviews[0]!.instructions).toContain("you have no tools");
    expect(prompt.packet.toolReceipts.map(row => [row.tool, row.class])).toEqual([["desktop/observe", "observation"], ["desktop/click", "action-receipt"], ["desktop/verifyProperty", "observation"]]);
    expect(f.reviews[0]!.prompt).toContain("Counter: 1");
    expect(f.reviews[0]!.prompt).not.toContain("SYNTHETICPIXELS");
    expect(prompt.packet.omitted.images).toBe(1);
    expect(prompt.packet.completeInput).toBe(true);
    expect(prompt.packet.workerClaims.map(row => row.summary)).toContain("Counter before was 0. The click completed. verifyProperty reported Counter: 1.");
    const semantic = task.semanticReview!;
    expect(semantic.reviewer).toMatchObject({ model: "synthetic-reviewer", context: "fresh-tool-less", independence: "separate-model", receiptId: "response:review-1" });
    expect(semantic.requirements.map(row => [row.requirementId, row.verdict])).toEqual([["r1", "unknown"], ["r2", "pass"]]);
    expect(semantic.hostAdjustments.join("\n")).toContain("r1: pass recorded as unknown because it cites no observed fact");
    expect(semantic.deliverable.verdict).toBe("unknown");
    // A single passing AX property is not verification of the whole deliverable.
    expect(() => f.runtime.verify("task", "verify-semantic", f.store.getTask("task").review!.id)).toThrow("Current independent semantic review required");
    expect(f.store.getTask("task").status).toBe("review_required");
    // Duplicate action and a new action over the same unchanged ledger reuse the receipt.
    expect((await f.runtime.semanticReview("task", "semantic-1", f.scope(), reviewer, true)).semanticReview?.id).toBe(semantic.id);
    expect((await f.runtime.semanticReview("task", "semantic-2", f.scope(), reviewer, true)).semanticReview?.id).toBe(semantic.id);
    expect(f.reviews).toHaveLength(1);
    const kinds = f.store.listReceipts("task").map(row => row.kind);
    expect(kinds.filter(kind => kind === "semantic_review_attempt")).toHaveLength(1);
    expect(kinds.filter(kind => kind === "semantic_review_result")).toHaveLength(1);
    expect(kinds.filter(kind => kind === "semantic_review")).toHaveLength(2);
    expect(f.executions()).toBe(2);
  });

  test("a later observed fact invalidates the semantic review; only a fresh independent pass over every requirement verifies", async () => {
    let key: (id: string) => string = () => ""; let round = 0;
    const f = desktopFixture(() => {
      round++;
      return reply([
        { requirementId: "r1", verdict: "pass", sufficiency: "complete", evidenceIds: round > 1 ? ["r1-before-after"] : [], toolReceiptIds: [key("call-click"), key("call-verify")] },
        { requirementId: "r2", verdict: "pass", sufficiency: "complete", toolReceiptIds: [key("call-verify")] },
      ]);
    });
    ({ key } = await f.settle());
    const reviewer = { provider: "local-responses" as const, model: "synthetic-reviewer" };
    const first = await f.runtime.semanticReview("task", "semantic-a", f.scope(), reviewer, true);
    expect(first.semanticReview!.deliverable.verdict).toBe("pass");
    // New host evidence changes the ledger: old local and semantic reviews retire together.
    const changed = f.runtime.recordObservedEvidence("task", "observe", { id: "r1-before-after", requirementId: "r1", taskRevision: 1, sourceEventId: "synthetic-ax-event", subject: "synthetic-window", subjectRevision: "sha256:after", property: "counter 0 then 1", outcome: "passed", observer: "synthetic-ax-observer" });
    expect(changed.semanticReview).toBeUndefined();
    f.runtime.review("task", "local-review");
    expect(() => f.runtime.verify("task", "verify-stale", f.store.getTask("task").review!.id)).toThrow("Requirement outcome is not verified");
    const fresh = await f.runtime.semanticReview("task", "semantic-b", f.scope(), reviewer, true);
    expect(fresh.semanticReview!.inputDigest).not.toBe(first.semanticReview!.inputDigest);
    expect(fresh.semanticReview!.requirements[0]!.evidenceIds).toEqual(["r1-before-after"]);
    expect(f.runtime.verify("task", "verify-final", f.store.getTask("task").review!.id).status).toBe("verified_complete");
    expect(f.reviews).toHaveLength(2);
  });

  test("lost or invalid reviewer terminals are durable unknown attempts that are never replayed and are bounded", async () => {
    let mode: "throw" | "invalid" | "slow" = "throw"; let release: () => void = () => {};
    let claimFirst = "", claimSecond = "";
    const f = desktopFixture(async request => {
      if (mode === "throw") throw new Error("socket closed after send");
      if (mode === "slow") {
        f.runtime.claimSemanticReviewTransport(request.attemptId, "synthetic-reviewer", "c".repeat(64)); claimFirst = "claimed";
        try { f.runtime.claimSemanticReviewTransport(request.attemptId, "synthetic-reviewer", "c".repeat(64)); } catch (error) { claimSecond = (error as Error).message; }
        await new Promise<void>(resolve => { release = resolve; });
      }
      return "not json";
    });
    await f.settle();
    const reviewer = { provider: "local-responses" as const, model: "synthetic-reviewer" };
    await expect(f.runtime.semanticReview("task", "lost", f.scope(), reviewer, true)).rejects.toThrow("outcome is unknown");
    await expect(f.runtime.semanticReview("task", "lost", f.scope(), reviewer, true)).rejects.toThrow("attempt already exists for this action");
    mode = "invalid";
    await expect(f.runtime.semanticReview("task", "invalid", f.scope(), reviewer, true)).rejects.toThrow("no valid verdict");
    mode = "slow";
    const slow = f.runtime.semanticReview("task", "slow", f.scope(), reviewer, true);
    await Bun.sleep(0);
    await expect(f.runtime.semanticReview("task", "parallel", f.scope(), reviewer, true)).rejects.toThrow("already in progress");
    release(); await expect(slow).rejects.toThrow("no valid verdict");
    expect([claimFirst, claimSecond]).toEqual(["claimed", "Semantic review transport already claimed"]);
    const attempt = f.store.listReceipts("task").find(row => row.kind === "semantic_review_attempt" && (row.body as { actionId: string }).actionId === "slow")!;
    expect(() => f.runtime.claimSemanticReviewTransport((attempt.body as { attemptId: string }).attemptId, "synthetic-reviewer", "c".repeat(64))).toThrow("Stale semantic review transport");
    await expect(f.runtime.semanticReview("task", "fourth", f.scope(), reviewer, true)).rejects.toThrow("attempt bound reached");
    expect(f.reviews).toHaveLength(3);
    expect(f.store.listReceipts("task").filter(row => row.kind === "semantic_review_result").map(row => (row.body as { state: string }).state)).toEqual(["outcome_unknown", "invalid_output", "invalid_output"]);
    expect(f.store.getTask("task").semanticReview).toBeUndefined();
  });

  test("reviewer selection is explicit, Web-only and limited to settled finite tasks; HTTP requires the exact schema", async () => {
    const f = desktopFixture(() => reply([{ requirementId: "r1", verdict: "unknown", sufficiency: "none" }, { requirementId: "r2", verdict: "unknown", sufficiency: "none" }], "unknown"));
    f.runtime.create("create-pending", { id: "pending", familyId: "pending", ownerMode: "agent", mode: "manual", originalRequest: "Unsettled synthetic task.", requirements: [{ id: "r", text: "Synthetic." }],
      stages: [{ id: "s", instruction: "Synthetic stage.", requirementIds: ["r"] }], bounds: { maxConcurrent: 1, maxTurns: 1, maxSpend: null }, execution: { provider: "local-responses", model: "synthetic-worker" } });
    await expect(f.runtime.semanticReview("pending", "early", { familyId: "pending", generation: 1, revision: 1 }, { provider: "local-responses", model: "synthetic-reviewer" }, true)).rejects.toThrow("settled finite task");
    await f.settle();
    await expect(f.runtime.semanticReview("task", "implicit", f.scope(), { provider: "local-responses", model: "synthetic-reviewer" }, false)).rejects.toThrow("explicit user action");
    await expect(f.runtime.semanticReview("task", "absent-model", f.scope(), { provider: "local-responses", model: "missing" }, true)).rejects.toThrow("reviewer model is unavailable");
    const routes = createAgentModeRoutes({ runtime: f.runtime, authorize: () => true });
    const call = async (body: Record<string, unknown>) => {
      const response = (await routes(new Request("http://127.0.0.1/admin/agent-mode", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })))!;
      return { status: response.status, body: await response.json() as any };
    };
    expect((await call({ action: "semantic-review", taskId: "task", actionId: "http-0", scope: f.scope(), reviewer: { provider: "owned-native", model: "synthetic-reviewer" }, explicitUserAction: true })).status).toBe(400);
    expect((await call({ action: "semantic-review", taskId: "task", actionId: "http-1", scope: f.scope(), reviewer: { provider: "local-responses", model: "synthetic-reviewer" } })).status).toBe(400);
    const accepted = await call({ action: "semantic-review", taskId: "task", actionId: "http-2", scope: f.scope(), reviewer: { provider: "local-responses", model: "synthetic-reviewer" }, explicitUserAction: true });
    expect(accepted.status).toBe(200);
    expect(accepted.body.value.task.semanticReview.deliverable.verdict).toBe("unknown");
    const status = await call({ action: "status" });
    expect(status.body.value.capabilities.semanticReview).toEqual({ available: true, providers: ["local-responses"] });
  });

  test("any host truncation of an evidence field or tool reason marks the review input incomplete", () => {
    const store = storeAt();
    const task = store.createTask({ ownerMode: "agent", id: "long", familyId: "long", mode: "manual", originalRequest: "Synthetic long evidence.", requirements: [{ id: "r", text: "Synthetic." }],
      stages: [{ id: "s", instruction: "Synthetic stage.", requirementIds: ["r"] }], bounds: { maxConcurrent: 1, maxTurns: 1, maxSpend: null } });
    expect(store.semanticReviewInput(task.id).packet.completeInput).toBe(true);
    store.recordEvidence(task.id, { id: "long-fact", requirementId: "r", taskRevision: 1, sourceEventId: "synthetic-event", subject: "s".repeat(5000), subjectRevision: "sha256:x", property: "synthetic", outcome: "passed", observer: "synthetic-observer" });
    const input = store.semanticReviewInput(task.id);
    expect([input.packet.completeInput, input.packet.omitted.truncatedValues]).toEqual([false, 1]);
    expect(input.packet.observedEvidence[0]!.subject).toEndWith("[value truncated by host]");
  });

  test("host normalization enforces requirement identity, whole-requirement sufficiency and observed basis", () => {
    const packet = { task: { requirements: [{ id: "a", text: "A" }, { id: "b", text: "B" }, { id: "c", text: "C" }] },
      observedEvidence: [{ id: "fact-a", requirementId: "a", outcome: "passed" }, { id: "fact-b", requirementId: "b", outcome: "failed" }],
      toolReceipts: [{ receiptId: "tool-click", class: "action-receipt", state: "completed" }, { receiptId: "tool-read", class: "observation", state: "completed" }], completeInput: true } as unknown as SemanticReviewPacket;
    expect(() => normalizeSemanticReview(packet, reply([{ requirementId: "z", verdict: "pass", sufficiency: "complete" }]))).toThrow(SemanticReviewOutputError);
    expect(() => normalizeSemanticReview(packet, reply([{ requirementId: "a", verdict: "pass", sufficiency: "complete" }, { requirementId: "a", verdict: "pass", sufficiency: "complete" }]))).toThrow(SemanticReviewOutputError);
    expect(() => normalizeSemanticReview(packet, "The deliverable looks complete.")).toThrow(SemanticReviewOutputError);
    const result = normalizeSemanticReview(packet, "```json\n" + reply([
      { requirementId: "a", verdict: "pass", sufficiency: "complete", evidenceIds: ["fact-a", "fact-b"], toolReceiptIds: ["tool-read", "invented"] },
      { requirementId: "b", verdict: "pass", sufficiency: "complete", toolReceiptIds: ["tool-read"] },
    ]) + "\n```");
    expect(result.requirements.map(row => [row.requirementId, row.verdict])).toEqual([["a", "pass"], ["b", "unknown"], ["c", "unknown"]]);
    expect(result.requirements[0]).toMatchObject({ evidenceIds: ["fact-a"], toolReceiptIds: ["tool-read"] });
    expect(result.hostAdjustments.join("\n")).toContain("b: pass recorded as unknown because active observed evidence for it is failed or unknown");
    expect(result.hostAdjustments.join("\n")).toContain("c: reviewer returned no verdict");
    expect(result.deliverable.verdict).toBe("unknown");
    const partial = normalizeSemanticReview(packet, reply([{ requirementId: "a", verdict: "pass", sufficiency: "partial", evidenceIds: ["fact-a"] }, { requirementId: "b", verdict: "fail", sufficiency: "complete", evidenceIds: ["fact-b"] }, { requirementId: "c", verdict: "pass", sufficiency: "complete", toolReceiptIds: ["tool-click"] }]));
    expect(partial.requirements.map(row => row.verdict)).toEqual(["unknown", "fail", "unknown"]);
    const incomplete = normalizeSemanticReview({ ...packet, task: { requirements: [{ id: "a", text: "A" }] }, completeInput: false } as SemanticReviewPacket, reply([{ requirementId: "a", verdict: "pass", sufficiency: "complete", evidenceIds: ["fact-a"] }]));
    expect([incomplete.requirements[0]!.verdict, incomplete.deliverable.verdict]).toEqual(["pass", "unknown"]);
  });

  test("Responses reviewer is a fresh tool-less loopback turn and rejects tool output", async () => {
    const bodies: any[] = []; const headers: string[] = [];
    let output: unknown[] = [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "{\"verdict\":true}" }] }];
    let status = 200;
    const port = createResponsesSemanticReviewPort({ endpoint: () => "http://127.0.0.1:7777/v1/responses", requestHeaders: request => ({ "x-nekodex-agent-review": request.attemptId }),
      fetch: (async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body))); headers.push(new Headers(init.headers).get("x-nekodex-agent-review") ?? "");
        return status === 200 ? Response.json({ id: "resp_review", status: "completed", output }) : new Response("upstream", { status });
      }) as unknown as typeof fetch });
    const request = { attemptId: "attempt-1", taskId: "task", reviewer: { provider: "local-responses" as const, model: "synthetic-reviewer" }, instructions: "Review only.", prompt: "{}", signal: new AbortController().signal };
    expect(await port.review(request)).toEqual({ receiptId: "response:resp_review", text: "{\"verdict\":true}" });
    expect(bodies[0]).toMatchObject({ model: "synthetic-reviewer", store: false, stream: false, tools: [], tool_choice: "none", instructions: "Review only." });
    expect(bodies[0].previous_response_id).toBeUndefined();
    expect(headers[0]).toBe("attempt-1");
    output = [{ type: "function_call", call_id: "x", name: "agent_tool_0", arguments: "{}" }];
    await expect(port.review(request)).rejects.toThrow(SemanticReviewOutputError);
    status = 502;
    const failure = await port.review(request).catch(error => error);
    expect(failure).toBeInstanceOf(Error); expect(failure).not.toBeInstanceOf(SemanticReviewOutputError);
    await expect(createResponsesSemanticReviewPort({ endpoint: () => "https://example.com/v1/responses" }).review(request)).rejects.toThrow("loopback");
  });
});
