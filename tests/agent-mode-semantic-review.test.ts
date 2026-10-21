import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentModeRuntime, AgentModeStore, createAgentModeRoutes, createResponsesSemanticReviewPort, extractSemanticReviewObject, normalizeSemanticReview, SEMANTIC_REVIEW_PROTOCOL, SemanticReviewOutputError } from "../src/agent-mode";
import type { AgentToolRequest, SemanticReviewInvalidEvidence, SemanticReviewPacket, SemanticReviewPort, SemanticReviewRequest } from "../src/agent-mode";
import { chatGptHtmlToMarkdown } from "../src/adapters/chatgpt-web/markdown";
import { emitTextDeltas } from "../src/adapters/chatgpt-web/turn-round-delivery";
import { buildResponseJSON } from "../src/responses/json-output";
import type { AdapterEvent } from "../src/types";

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

/** The non-streaming Web reviewer reply exactly as the ChatGPT Web adapter emits it for a turn
 * without local tools: the read-only notice and a reasoning-trace draft on the commentary
 * channel, then the fenced verdict on the final channel, split by a later trace event. */
const LOCAL_TOOLS_NOTICE = "> **Local tools unavailable**\n>\n> `ChatGPT Web 5.6 Sol` cannot access the local Codex computer in this turn. The accumulated context does not contain local tool results yet: it will see instructions and attachments, but not workspace contents.";
function webReviewerResponse(verdict: string): Record<string, unknown> {
  const events: AdapterEvent[] = []; const emit = (event: AdapterEvent) => { events.push(event); };
  const fenced = "```json\n" + JSON.stringify(JSON.parse(verdict), null, 2) + "\n```";
  const cut = fenced.indexOf("Synthetic") + 4; // inside a JSON string literal
  emit({ type: "assistant_boundary" }); emit({ type: "text_delta", text: LOCAL_TOOLS_NOTICE, phase: "commentary" }); emit({ type: "assistant_boundary" });
  emit({ type: "assistant_boundary" }); emit({ type: "text_delta", text: `Drafting {"protocol":"${SEMANTIC_REVIEW_PROTOCOL}","deliverable":{"verdict":"fail"}} before checking receipts.`, phase: "commentary" });
  emit({ type: "assistant_boundary" }); emit({ type: "thinking_delta", thinking: "Comparing the receipts with each requirement." });
  emitTextDeltas([fenced.slice(0, cut)], emit);
  emit({ type: "assistant_boundary" }); emit({ type: "thinking_delta", thinking: "Checking the cited receipt identities." });
  emitTextDeltas([fenced.slice(cut)], emit);
  emit({ type: "done", stopReason: "stop", endTurn: true });
  return buildResponseJSON(events, "chatgpt-web/gpt-5.6-sol-high");
}
function loopbackPort(body: () => Record<string, unknown>) {
  return createResponsesSemanticReviewPort({ endpoint: () => "http://127.0.0.1:7777/v1/responses", fetch: (async () => Response.json(body())) as unknown as typeof fetch });
}
const resultEvidence = (store: AgentModeStore, taskId = "task") => store.listReceipts(taskId).filter(row => row.kind === "semantic_review_result")
  .map(row => row.body as { state: string; receiptId?: string; invalid?: SemanticReviewInvalidEvidence });

/** A synthetic P13-shaped Manual task: observe, one click and a separate AX property check. */
/** The P13 fixture geometry as the native helper reports it: a 560x308-point window captured at
 * 2x, the purple mouse-only view and the counter label as window-relative AX frames. */
const p13Binding = { providerId: "nekodex-macos-desktop-v1", scopeId: "task\u00001", observationId: "observation-p13", platform: "darwin", ...selection, frameId: "window-4242",
  frameEpoch: "c".repeat(64), screenshotId: "d".repeat(64), coordinateSpace: "screenshot-pixels", width: 1120, height: 616 };
const p13Results: Record<string, unknown> = {
  "call-read": { isError: false, structuredContent: { source: "owned-macos-desktop", proof: "selected-window-application-properties", snapshot: { selection, observedAt: "2026-10-21T08:00:00.000Z",
    properties: [{ elementId: "ax-purple", role: "AXImage", identifier: "nekodex.fixture.pixel-counter-area", frame: { x: 24, y: 116, width: 200, height: 96 } },
      { elementId: "ax-counter", role: "AXStaticText", identifier: "nekodex.fixture.counter", value: "Counter: 0", frame: { x: 256, y: 148, width: 270, height: 32 } }], window: { width: 560, height: 308 } },
    geometry: "Element frames are window-relative points with a top-left origin inside the selected window of the given size, the space desktop/click target.windowPoint uses." } },
  "call-observe": { isError: false, content: [{ type: "image", mimeType: "image/jpeg", data: "/9j/SYNTHETICPIXELS" }], structuredContent: { source: "owned-macos-desktop", proof: "selected-window-screenshot",
    observation: { ...p13Binding, kind: "desktop", screenshotResource: "native-desktop:p13", windowSize: { width: 560, height: 308 } }, binding: p13Binding,
    modelImage: { mimeType: "image/jpeg", sha256: "b".repeat(64), sourceScreenshotId: "d".repeat(64), width: 1120, height: 616 }, foregroundHandoff: "explicit-manual-return" } },
  "call-click": { isError: false, structuredContent: { source: "owned-macos-desktop", proof: "native-input-execution-only",
    execution: { operationId: "00000000-0000-5000-8000-000000000000", outcome: "completed", executed: true, reason: "input-dispatched; application-result-unverified" },
    target: { observationId: "observation-p13", screenshotId: "d".repeat(64), coordinateSpace: "screenshot-pixels", x: 248, y: 336, image: { width: 1120, height: 616 }, windowPoint: { x: 124, y: 168 }, space: "window-points-top-left" },
    limitation: "Native input execution is not application acceptance or a completed business outcome." } },
  "call-verify": { isError: false, structuredContent: { source: "owned-macos-desktop", verification: { expectation: { elementId: "ax-counter", property: "value", equals: "Counter: 1" }, actual: "Counter: 1", outcome: "passed" } } },
};
function desktopFixture(reviewReply: (request: SemanticReviewRequest) => string | Promise<string>, port?: SemanticReviewPort, shape: "basic" | "p13" = "basic") {
  const store = storeAt();
  const calls: AgentToolRequest[] = shape === "p13" ? [
    { toolCallId: "call-read", tool: "desktop/readProperties", wireName: "agent_tool_0", arguments: { selection } },
    { toolCallId: "call-observe", tool: "desktop/observe", wireName: "agent_tool_1", arguments: { selection, waitForForeground: true } },
    { toolCallId: "call-click", tool: "desktop/click", wireName: "agent_tool_2", arguments: { binding: p13Binding, x: 248, y: 336, waitForForeground: true } },
    { toolCallId: "call-verify", tool: "desktop/verifyProperty", wireName: "agent_tool_3", arguments: { selection, expectation: { elementId: "ax-counter", property: "value", equals: "Counter: 1" } } },
  ] : [
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
    semanticReviewer: port ?? { async review(request) { reviews.push(request); return { receiptId: `response:review-${reviews.length}`, text: await reviewReply(request) }; } },
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
    const results: Record<string, unknown> = shape === "p13" ? p13Results : {
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

  test("lost or invalid reviewer terminals are durable attempts that are never replayed; lost terminals are bounded", async () => {
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
    // Two settled invalid outputs did not use up attempts; three lost terminals do.
    mode = "throw";
    await expect(f.runtime.semanticReview("task", "lost-2", f.scope(), reviewer, true)).rejects.toThrow("outcome is unknown");
    await expect(f.runtime.semanticReview("task", "lost-3", f.scope(), reviewer, true)).rejects.toThrow("outcome is unknown");
    await expect(f.runtime.semanticReview("task", "sixth", f.scope(), reviewer, true)).rejects.toThrow("attempt bound reached");
    expect(f.reviews).toHaveLength(5);
    expect(resultEvidence(f.store).map(row => row.state)).toEqual(["outcome_unknown", "invalid_output", "invalid_output", "outcome_unknown", "outcome_unknown"]);
    expect(resultEvidence(f.store).map(row => row.invalid?.reason ?? null)).toEqual([null, "no_json_object", "no_json_object", null, null]);
    expect(f.store.getTask("task").semanticReview).toBeUndefined();
  });

  test("the live Web reply shape: commentary notice and a commentary draft object around a streamed fenced verdict; only the final channel is parsed", async () => {
    let key: (id: string) => string = () => ""; const sent: unknown[] = [];
    const verdict = () => reply([
      { requirementId: "r1", verdict: "unknown", sufficiency: "partial", toolReceiptIds: [key("call-click")] },
      { requirementId: "r2", verdict: "pass", sufficiency: "complete", toolReceiptIds: [key("call-verify")] },
    ], "unknown");
    const port = loopbackPort(() => { const body = webReviewerResponse(verdict()); sent.push(body); return body; });
    const f = desktopFixture(() => "", port);
    ({ key } = await f.settle());
    const task = await f.runtime.semanticReview("task", "semantic-web", f.scope(), { provider: "local-responses", model: "synthetic-reviewer" }, true);
    expect(task.semanticReview!.requirements.map(row => [row.requirementId, row.verdict])).toEqual([["r1", "unknown"], ["r2", "pass"]]);
    expect(task.semanticReview!.reviewer.receiptId).toMatch(/^response:resp_/);
    expect(resultEvidence(f.store).map(row => row.state)).toEqual(["recorded"]);
    // The reply really carries both channels. Joining every assistant item with newlines, as the
    // installed build did, leaves only the commentary draft parseable: the live invalid_output.
    const output = (sent[0] as { output: { type: string; phase?: string; content?: { text: string }[] }[] }).output;
    expect(output.map(item => [item.type, item.phase ?? null])).toEqual([["message", "commentary"], ["message", "commentary"], ["reasoning", null], ["message", "final_answer"], ["reasoning", null], ["message", "final_answer"]]);
    const everyAssistantText = output.filter(item => item.type === "message").map(item => item.content!.map(part => part.text).join("")).join("\n");
    expect(() => normalizeSemanticReview(f.store.semanticReviewInput("task").packet, everyAssistantText)).toThrow(SemanticReviewOutputError);
    const direct = await port.review({ attemptId: "direct", taskId: "task", reviewer: { provider: "local-responses", model: "synthetic-reviewer" }, instructions: "Review only.", prompt: "{}", signal: new AbortController().signal });
    expect(direct.text).toBe("```json\n" + JSON.stringify(JSON.parse(verdict()), null, 2) + "\n```");
    expect(direct.text).not.toContain("Local tools unavailable");
    expect(direct.reply!.commentary.text).toContain("Local tools unavailable");
    expect(direct.reply!.items.map(row => row.phase)).toEqual(["commentary", "commentary", null, "final_answer", null, "final_answer"]);
  });

  test("exactly one JSON object is extracted from the final answer: bare, fenced or amid prose; several, unterminated or none are rejected", () => {
    const object = { protocol: SEMANTIC_REVIEW_PROTOCOL, note: "braces } { and \"quotes\" inside a string" };
    const json = JSON.stringify(object);
    expect(extractSemanticReviewObject(json)).toEqual(object);
    expect(extractSemanticReviewObject("```json\n" + JSON.stringify(object, null, 2) + "\n```")).toEqual(object);
    expect(extractSemanticReviewObject(`Review of {r1, r2} below.\n\`\`\`json\n${json}\n\`\`\`\nThat is the verdict.`)).toEqual(object);
    const reason = (text: string) => { try { extractSemanticReviewObject(text); return "accepted"; } catch (error) { expect(error).toBeInstanceOf(SemanticReviewOutputError); return (error as SemanticReviewOutputError).reason; } };
    expect(reason(`${json}\n${json}`)).toBe("multiple_json_objects");
    expect(reason("```json\n" + json + "\n```\nOr, alternatively:\n```json\n{\"protocol\":\"other\"}\n```")).toBe("multiple_json_objects");
    expect(reason(json.slice(0, -1))).toBe("unterminated_json_object");
    expect(reason("The deliverable looks complete.")).toBe("no_json_object");
    expect(reason("[1, 2]")).toBe("no_json_object");
    expect(reason(" \n ")).toBe("final_answer_empty");
  });

  test("DW9 live regression: the Web adapter's Markdown-escaped bare verdict is parsed strictly and normalized without loosening any rule", () => {
    // Exact final_answer of attempt 4dd4560e on 6.1.33-nekodex.5: Turndown escaped every [ and ].
    const escaped = readFileSync(join(import.meta.dir, "fixtures", "semantic-review-dw9-escaped-final-answer.txt"), "utf8");
    expect(escaped).toContain('"requirements":\\[{"requirementId":"r1"');
    expect(() => JSON.parse(escaped)).toThrow();
    const receipts = { read: "tool:c928149683b4ae86134aed1a2882988115c99b9b5419490da059097431e7d205", observe: "tool:665d21f8cc9007f2053014a9638956ea3e4b3674851b232ee02ef1fef83dc3c8",
      click: "tool:3b3676bd2722223416f0868165fb10addb8a830585a5410f4577be68d8883f71", verify: "tool:20f73b84894e0c4cc5cfaa99cb7bdcc0d6b2755a1da78f327d43185f6a277c26" };
    const object = extractSemanticReviewObject(escaped) as { requirements: { requirementId: string; toolReceiptIds: string[]; missing: string[] }[] };
    expect(object.requirements.map(row => row.requirementId)).toEqual(["r1", "r2"]);
    expect(object.requirements[0]!.toolReceiptIds).toEqual(Object.values(receipts));
    expect(object.requirements[1]!.missing).toEqual([]);
    const packet = { task: { requirements: [{ id: "r1", text: "Counter 0, one click in the purple area, counter 1." }, { id: "r2", text: "A separate verifyProperty reads Counter: 1." }] }, observedEvidence: [],
      toolReceipts: [{ receiptId: receipts.read, class: "observation", state: "completed" }, { receiptId: receipts.observe, class: "observation", state: "completed" },
        { receiptId: receipts.click, class: "action-receipt", state: "completed" }, { receiptId: receipts.verify, class: "observation", state: "completed" }], completeInput: true } as unknown as SemanticReviewPacket;
    const result = normalizeSemanticReview(packet, escaped);
    expect(result.requirements.map(row => [row.requirementId, row.verdict, row.sufficiency])).toEqual([["r1", "unknown", "partial"], ["r2", "pass", "complete"]]);
    expect(result.requirements[0]!.missing[0]).toContain("(248,336)");
    expect(result.deliverable.verdict).toBe("unknown");
    expect(result.hostAdjustments).toEqual([]);
  });

  test("the fenced verdict survives ChatGPT HTML-to-Markdown literally; escaped prose is unescaped only outside code and stays strict", () => {
    const object = { protocol: SEMANTIC_REVIEW_PROTOCOL, ids: ["snake_case", "*starred*", "[bracketed]"], note: "a \"quoted\" C:\\path, `tick`, # not a heading" };
    const json = JSON.stringify(object);
    const html = json.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    // Code is not escaped by the Web adapter: the fenced block is the exact reviewer text.
    const fenced = chatGptHtmlToMarkdown(`<pre><code class="language-json">${html}</code></pre>`);
    expect(fenced).toBe("```json\n" + json + "\n```");
    expect(extractSemanticReviewObject(fenced)).toEqual(object);
    // The same object as paragraph text is escaped by Turndown, and recovered exactly.
    const paragraph = chatGptHtmlToMarkdown(`<p>${html}</p>`);
    expect(paragraph).not.toBe(json);
    expect(paragraph).toContain("\\[");
    expect(extractSemanticReviewObject(paragraph)).toEqual(object);
    const reason = (text: string) => { try { extractSemanticReviewObject(text); return "accepted"; } catch (error) { expect(error).toBeInstanceOf(SemanticReviewOutputError); return (error as SemanticReviewOutputError).reason; } };
    // A literal reading wins: a valid bare object keeps its own JSON escapes.
    expect(extractSemanticReviewObject(json)).toEqual(object);
    // Escaped prose cannot hide a second verdict beside a fenced one, or duplicate itself.
    expect(reason(`${paragraph}\n\n${fenced}`)).toBe("multiple_json_objects");
    expect(reason(`${paragraph}\n${paragraph}`)).toBe("multiple_json_objects");
    // Code spans and fences stay literal, so an escape inside them is not removed.
    expect(reason("`{\"protocol\":\\[1\\]}`")).toBe("no_json_object");
    expect(reason("```\n{\"protocol\":\\[1\\]}\n```")).toBe("no_json_object");
    // Only ASCII punctuation escapes are removed; the result is still parsed strictly.
    expect(reason("{\"protocol\":\\[1,\\]}")).toBe("no_json_object");
    expect(reason("{\"protocol\":\"\\q\"}")).toBe("no_json_object");
    expect(reason("{\"protocol\":\\[1\\]")).toBe("unterminated_json_object");
  });

  test("P13 from recorded facts alone: a click target and AX frames let r1 pass without the screenshot; the click receipt alone never does", async () => {
    let key: (id: string) => string = () => ""; let cite: "facts" | "click" = "facts";
    const f = desktopFixture(() => reply([
      { requirementId: "r1", verdict: "pass", sufficiency: "complete", toolReceiptIds: cite === "facts" ? [key("call-read"), key("call-observe"), key("call-click"), key("call-verify")] : [key("call-click")] },
      { requirementId: "r2", verdict: "pass", sufficiency: "complete", toolReceiptIds: [key("call-verify")] },
    ]), undefined, "p13");
    ({ key } = await f.settle());
    const reviewer = { provider: "local-responses" as const, model: "synthetic-reviewer" };
    const task = await f.runtime.semanticReview("task", "semantic-p13", f.scope(), reviewer, true);
    const prompt = JSON.parse(f.reviews[0]!.prompt) as { packet: SemanticReviewPacket };
    const receipt = (id: string) => prompt.packet.toolReceipts.find(row => row.receiptId === key(id))! as { class: string; result: any };
    // Structured geometry reaches the text reviewer; pixels do not.
    expect(receipt("call-click").class).toBe("action-receipt");
    expect(receipt("call-click").result.structuredContent.target).toMatchObject({ observationId: "observation-p13", x: 248, y: 336, windowPoint: { x: 124, y: 168 }, space: "window-points-top-left" });
    expect(receipt("call-observe").result.structuredContent.observation).toMatchObject({ observationId: "observation-p13", width: 1120, height: 616, windowSize: { width: 560, height: 308 } });
    expect(receipt("call-read").result.structuredContent.snapshot.properties[0]).toMatchObject({ identifier: "nekodex.fixture.pixel-counter-area", frame: { x: 24, y: 116, width: 200, height: 96 } });
    expect(f.reviews[0]!.prompt).not.toContain("SYNTHETICPIXELS");
    expect(prompt.packet.omitted.images).toBe(1);
    expect(prompt.packet.completeInput).toBe(true);
    expect(f.reviews[0]!.instructions).toContain("target.windowPoint");
    expect(f.reviews[0]!.instructions).toContain("fenced ```json code block");
    expect(task.semanticReview!.requirements.map(row => [row.requirementId, row.verdict])).toEqual([["r1", "pass"], ["r2", "pass"]]);
    expect(task.semanticReview!.hostAdjustments).toEqual([]);
    expect(task.semanticReview!.deliverable.verdict).toBe("pass");
    // The same pass citing only the click receipt is recorded unknown: an input receipt proves no effect.
    cite = "click";
    const packet = f.store.semanticReviewInput("task").packet;
    const clickOnly = normalizeSemanticReview(packet, reply([
      { requirementId: "r1", verdict: "pass", sufficiency: "complete", toolReceiptIds: [key("call-click")] },
      { requirementId: "r2", verdict: "pass", sufficiency: "complete", toolReceiptIds: [key("call-verify")] },
    ]));
    expect(clickOnly.requirements.map(row => row.verdict)).toEqual(["unknown", "pass"]);
    expect(clickOnly.hostAdjustments.join("\n")).toContain("r1: pass recorded as unknown because it cites no observed fact");
    expect(clickOnly.deliverable.verdict).toBe("unknown");
  });

  test("an invalid output keeps bounded, redacted evidence and uses up no attempt; the same action is never resent", async () => {
    let mode: "prose" | "schema" | "valid" = "prose"; let key: (id: string) => string = () => "";
    const secrets = ["Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789", "token sk-proj-abcdefghijklmnopqrstuvwxyz012345",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5NXgL0n3I9PlFUP0THsR8U", "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----", "password=hunter2hunter2"];
    const prose = `The deliverable looks fine.\n${secrets.join("\n")}\n${"x".repeat(20_000)}\nEnd of review.`;
    const f = desktopFixture(() => mode === "prose" ? prose : mode === "schema"
      ? reply([{ requirementId: "r1", verdict: "pass", sufficiency: "full" as "complete" }, { requirementId: "r2", verdict: "unknown", sufficiency: "none" }])
      : reply([{ requirementId: "r1", verdict: "unknown", sufficiency: "partial" }, { requirementId: "r2", verdict: "pass", sufficiency: "complete", toolReceiptIds: [key("call-verify")] }], "unknown"));
    ({ key } = await f.settle());
    const reviewer = { provider: "local-responses" as const, model: "synthetic-reviewer" };
    await expect(f.runtime.semanticReview("task", "first", f.scope(), reviewer, true)).rejects.toThrow("no valid verdict");
    await expect(f.runtime.semanticReview("task", "first", f.scope(), reviewer, true)).rejects.toThrow("attempt already exists for this action");
    mode = "schema";
    await expect(f.runtime.semanticReview("task", "second", f.scope(), reviewer, true)).rejects.toThrow("no valid verdict");
    await expect(f.runtime.semanticReview("task", "third", f.scope(), reviewer, true)).rejects.toThrow("no valid verdict");
    const [first, second] = resultEvidence(f.store);
    expect(first).toMatchObject({ state: "invalid_output", receiptId: "response:review-1", invalid: { reason: "no_json_object" } });
    const final = first!.invalid!.reply!.final;
    expect([final.bytes, final.truncated]).toEqual([Buffer.byteLength(prose), true]);
    expect(final.text).toStartWith("The deliverable looks fine.");
    expect(final.text).toEndWith("End of review.");
    expect(Buffer.byteLength(final.text)).toBeLessThan(4100);
    for (const secret of ["abcdefghijklmnopqrstuvwxyz0123456789", "sk-proj-", "eyJhbGci", "MIIEvQIBADANBg", "hunter2"]) expect(final.text).not.toContain(secret);
    expect(Buffer.byteLength(JSON.stringify(first!.invalid))).toBeLessThan(16 * 1024);
    expect(second).toMatchObject({ state: "invalid_output", receiptId: "response:review-2", invalid: { reason: "schema_mismatch", issues: [{ path: "requirements.0.sufficiency" }] } });
    // Three settled invalid outputs used to exhaust the bound; a new explicit action still reviews.
    mode = "valid";
    const task = await f.runtime.semanticReview("task", "fourth", f.scope(), reviewer, true);
    expect(task.semanticReview!.requirements.map(row => row.verdict)).toEqual(["unknown", "pass"]);
    expect(f.reviews).toHaveLength(4);
    expect(resultEvidence(f.store).map(row => row.state)).toEqual(["invalid_output", "invalid_output", "invalid_output", "recorded"]);
  });

  test("lost or unfinished attempts are bounded at three per unchanged ledger; settled invalid outputs have a separate backstop", () => {
    const store = storeAt();
    const create = (id: string) => store.createTask({ ownerMode: "agent", id, familyId: id, mode: "manual", originalRequest: "Synthetic bounded review.", requirements: [{ id: "r", text: "Synthetic." }],
      stages: [{ id: "s", instruction: "Synthetic stage.", requirementIds: ["r"] }], bounds: { maxConcurrent: 1, maxTurns: 1, maxSpend: null } });
    const attempt = (taskId: string, n: number) => { const task = store.getTask(taskId);
      store.recordSemanticReviewAttempt(taskId, { attemptId: `${taskId}-${n}`, actionId: `${taskId}-action-${n}`, generation: task.generation, taskRevision: task.revision, evidenceRevision: task.evidenceRevision,
        inputDigest: store.semanticReviewInput(taskId).digest, reviewer: { provider: "local-responses", model: "synthetic-reviewer" } }); };
    create("invalid");
    for (let n = 1; n <= 8; n++) { attempt("invalid", n); store.recordSemanticReviewResult("invalid", { attemptId: `invalid-${n}`, state: "invalid_output", invalid: { reason: "no_json_object" } }); }
    expect(() => attempt("invalid", 9)).toThrow("invalid-output bound reached");
    create("mixed");
    for (let n = 1; n <= 2; n++) { attempt("mixed", n); store.recordSemanticReviewResult("mixed", { attemptId: `mixed-${n}`, state: "invalid_output" }); }
    attempt("mixed", 3); store.recordSemanticReviewResult("mixed", { attemptId: "mixed-3", state: "outcome_unknown" });
    attempt("mixed", 4); attempt("mixed", 5); // an unfinished attempt counts like a lost one
    expect(() => attempt("mixed", 6)).toThrow("attempt bound reached");
    expect(() => store.recordSemanticReviewResult("mixed", { attemptId: "mixed-4", state: "outcome_unknown", invalid: { reason: "no_json_object" } })).toThrow("Invalid semantic review result evidence");
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
    expect(await port.review(request)).toMatchObject({ receiptId: "response:resp_review", text: "{\"verdict\":true}", reply: { items: [{ type: "message", phase: "none", bytes: 16 }], final: { text: "{\"verdict\":true}", truncated: false } } });
    expect(bodies[0]).toMatchObject({ model: "synthetic-reviewer", store: false, stream: false, tools: [], tool_choice: "none", instructions: "Review only." });
    expect(bodies[0].previous_response_id).toBeUndefined();
    expect(headers[0]).toBe("attempt-1");
    output = [{ type: "function_call", call_id: "x", name: "agent_tool_0", arguments: "{}" }];
    const tool = await port.review(request).catch(error => error);
    expect(tool).toBeInstanceOf(SemanticReviewOutputError);
    expect(tool).toMatchObject({ reason: "non_message_output", evidence: { receiptId: "response:resp_review", reply: { items: [{ type: "function_call", phase: null }] } } });
    status = 502;
    const failure = await port.review(request).catch(error => error);
    expect(failure).toBeInstanceOf(Error); expect(failure).not.toBeInstanceOf(SemanticReviewOutputError);
    await expect(createResponsesSemanticReviewPort({ endpoint: () => "https://example.com/v1/responses" }).review(request)).rejects.toThrow("loopback");
  });
});
