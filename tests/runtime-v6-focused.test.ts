import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { beginCancelStructuredCompactionTrace, runStructuredCompactionOnce, activeStructuredCompactionCount } from "../src/adapters/chatgpt-web/compaction-handoff";
import { createCompactionContinuationRegistry, MAX_COMPACTION_SOURCE_BYTES } from "../src/adapters/chatgpt-web/compaction-continuation";
import { chatGptTurnUserRevisionHistory, contextualUserMessage, extractChatGptTurnEnvironment, extractChatGptTurnUserRevision, hasRawChatGptEnvironmentContext } from "../src/adapters/chatgpt-web/environment";
import { chatGptConversationKey } from "../src/adapters/chatgpt-web/conversation-key";
import { chatGptTurnExecutionKey } from "../src/adapters/chatgpt-web/turn-execution";
import { defaultConfig } from "../src/config";
import { SUMMARY_PREFIX } from "../src/responses/compaction";
import { parseRequest } from "../src/responses/parser";
import { responseRequest, routeChatGptWebRequest, startServer } from "../src/server";
import type { CodexParsedRequest } from "../src/types";

test("assistant and prose mentions do not claim environment authority, while malformed native fragments remain visible", () => {
  const parsed: CodexParsedRequest = {
    modelId: "gpt-5.6-sol", stream: false, options: {}, context: { messages: [] },
    _rawBody: { input: [
      { type: "message", role: "assistant", content: [{ text: "<environment_context>quoted</environment_context>" }] },
      { type: "message", role: "user", content: [{ text: "Discuss <environment_context> in the docs" }] },
    ] },
  };
  expect(hasRawChatGptEnvironmentContext(parsed)).toBe(false);
  (parsed._rawBody as { input: unknown[] }).input.push({
    type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>" }],
    internal_chat_message_metadata_passthrough: { content_item_kinds: ["environments.environment_context"] },
  });
  expect(hasRawChatGptEnvironmentContext(parsed)).toBe(true);
});

test("a mixed environment and task user message remains the current instruction", () => {
  const mixed = { type: "message", role: "user", id: "mixed-current",
    content: [
      { type: "input_text", text: "<environment_context><cwd>/workspace</cwd></environment_context>" },
      { type: "input_text", text: "Complete the review" },
    ], internal_chat_message_metadata_passthrough: { turn_id: "mixed-turn" } };
  const request: CodexParsedRequest = { modelId: "gpt-5.6-sol", stream: false,
    options: {}, context: { messages: [] },
    _rawBody: { input: [mixed], client_metadata: { "x-codex-turn-metadata": JSON.stringify({
      thread_id: "mixed-thread", turn_id: "mixed-turn",
    }) } },
  };
  expect(contextualUserMessage(mixed)).toBe(false);
  expect(extractChatGptTurnUserRevision(request)).toEqual(mixed.content);
  expect(contextualUserMessage({ ...mixed, content: [
    mixed.content[0],
    { type: "input_text", text: "<recommended_plugins>Catalog</recommended_plugins>" },
    { type: "input_text", text: "# AGENTS.md instructions\n<INSTRUCTIONS>Use the workspace.</INSTRUCTIONS>" },
  ] })).toBe(true);
});

test("native memento compaction returns assistant text and recovers the exact completed instruction", async () => {
  const config = defaultConfig("browser-only");
  const threadId = `thread_${randomUUID()}`;
  const turnId = `turn_${randomUUID()}`;
  const sourceId = `source_${randomUUID()}`;
  const summary = "Preserve the verified task and continue its remaining work.";
  const metadata = { thread_id: threadId, turn_id: turnId, request_kind: "compaction",
    sandbox_mode: "danger-full-access", workspaces: { [process.cwd()]: {} },
    compaction: { implementation: "responses", strategy: "memento" } };
  const source = { type: "message", role: "user", id: "source-instruction",
    content: [{ type: "input_text", text: "Complete the runtime review" }],
    internal_chat_message_metadata_passthrough: { turn_id: sourceId } };
  const body = { model: "chatgpt-web/high", stream: false, input: [source],
    client_metadata: { "x-codex-turn-metadata": JSON.stringify(metadata) } };
  const parsed = parseRequest(body);
  expect(parsed._compactionResponseFormat).toBe("message");
  const response = await responseRequest(new Request("http://127.0.0.1:17841/v1/responses", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }), config, () => ({
    name: "memento-fixture",
    async runTurn(request, _incoming, emit) {
      expect(request._compactionRequest).toBe(true);
      emit({ type: "text_delta", text: summary, phase: "final_answer" });
      emit({ type: "done", stopReason: "stop", endTurn: true });
    },
  }), { rememberState: false });
  expect(response.status).toBe(200);
  const output = (await response.json() as { output: Array<{ type: string; role: string; content: Array<{ text: string }> }> }).output;
  expect(output.some(item => item.type === "compaction")).toBe(false);
  expect(output).toContainEqual(expect.objectContaining({
    type: "message", role: "assistant", content: [expect.objectContaining({ text: summary })],
  }));

  const continuation = parseRequest({ ...body, input: [{ type: "message", role: "user", id: "checkpoint",
    content: [{ type: "input_text", text: `${SUMMARY_PREFIX}\n${summary}` }],
    internal_chat_message_metadata_passthrough: { turn_id: turnId } }] });
  routeChatGptWebRequest(continuation, config);
  expect(extractChatGptTurnUserRevision(continuation)).toEqual(source.content);
  expect(chatGptTurnUserRevisionHistory(continuation).map(item => item.turnId)).toEqual([sourceId]);
  const ambiguousLater = parseRequest({ ...body, input: [
    (continuation._rawBody as { input: unknown[] }).input[0],
    { type: "message", role: "user", content: [{ type: "input_text", text: "New work after checkpoint" }] },
  ] });
  routeChatGptWebRequest(ambiguousLater, config);
  expect(() => extractChatGptTurnUserRevision(ambiguousLater)).toThrow("current-turn user message");
  const contextLater = parseRequest({ ...body, input: [
    (continuation._rawBody as { input: unknown[] }).input[0],
    { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context><current_date>2026-09-24</current_date></environment_context>" }] },
  ] });
  routeChatGptWebRequest(contextLater, config);
  expect(extractChatGptTurnUserRevision(contextLater)).toEqual(source.content);
  const environmentXml = `<environment_context><cwd>${process.cwd()}</cwd><filesystem><workspace_roots><root>${process.cwd()}</root></workspace_roots><permission_profile type="disabled"><file_system type="unrestricted" /></permission_profile></filesystem></environment_context>`;
  const withEnvironment = parseRequest({ ...body, input: [
    { type: "message", role: "user", id: "current-environment",
      content: [{ type: "input_text", text: environmentXml }],
      internal_chat_message_metadata_passthrough: { turn_id: turnId } },
    (continuation._rawBody as { input: unknown[] }).input[0],
  ] });
  routeChatGptWebRequest(withEnvironment, config);
  expect(extractChatGptTurnEnvironment(withEnvironment).cwd).toBe(process.cwd());
  const forged = parseRequest({ ...body, input: [{ type: "message", role: "user", id: "checkpoint",
    content: [{ type: "input_text", text: `${SUMMARY_PREFIX}\n${summary} altered` }],
    internal_chat_message_metadata_passthrough: { turn_id: turnId } }] });
  routeChatGptWebRequest(forged, config);
  expect(() => extractChatGptTurnUserRevision(forged)).toThrow("current-turn user message");
});

test("selected Web family separates browser and replay ownership even at equal backend effort", () => {
  const config = { ...defaultConfig("browser-only"), proAvailable: true };
  const request = (model: string) => parseRequest({ model, stream: false, input: [
    { type: "message", role: "user", id: "instruction", content: [{ type: "input_text", text: "Review" }],
      internal_chat_message_metadata_passthrough: { turn_id: "same-turn" } },
  ], client_metadata: { "x-codex-turn-metadata": JSON.stringify({ thread_id: "same-thread", turn_id: "same-turn" }) } });
  const sol = request("chatgpt-web/gpt-5.6-pro");
  const astra = request("chatgpt-web/gpt-6-pro");
  routeChatGptWebRequest(sol, config);
  routeChatGptWebRequest(astra, config);
  expect(sol._chatgptModelFamily).toBe("5.6");
  expect(astra._chatgptModelFamily).toBe("6");
  expect(sol.modelId).toBe(astra.modelId);
  expect(sol.options.reasoning).toBe(astra.options.reasoning);
  expect(chatGptConversationKey(sol, "same-provider")).not.toBe(chatGptConversationKey(astra, "same-provider"));
  expect(chatGptTurnExecutionKey(sol)).not.toBe(chatGptTurnExecutionKey(astra));
});

test("checkpoint hashes outlive bounded source payloads without fabricating summary-only instructions", () => {
  const registry = createCompactionContinuationRegistry();
  const summary = "Completed bounded checkpoint";
  const requestFor = (turnId: string): CodexParsedRequest => ({
    modelId: "gpt-5.6-sol", stream: false, options: { reasoning: "high" }, context: { messages: [] },
    _compactionRequest: true,
    _rawBody: { input: [{ type: "message", role: "user",
      content: [{ type: "input_text", text: `${SUMMARY_PREFIX}\n${summary}` }],
      internal_chat_message_metadata_passthrough: { turn_id: turnId } }] },
  });
  const identityFor = (turnId: string) => ({ threadId: "budget-thread", turnId });
  const oversized = { turnId: "original", content: "x".repeat(MAX_COMPACTION_SOURCE_BYTES) };
  const largeRequest = requestFor("oversized-turn");
  registry.rememberCompactionContinuation(largeRequest, identityFor("oversized-turn"), [oversized], summary);
  expect(registry.isAcceptedCompactionContinuation(largeRequest, identityFor("oversized-turn"), oversized)).toBe(true);
  expect(registry.recoverCompactionInstruction(largeRequest, identityFor("oversized-turn"))).toBeUndefined();

  const bounded = { turnId: "original", content: "x".repeat(900_000) };
  for (let index = 0; index < 10; index += 1) {
    const turnId = `budget-turn-${index}`;
    registry.rememberCompactionContinuation(requestFor(turnId), identityFor(turnId), [bounded], summary);
  }
  const first = requestFor("budget-turn-0");
  const newest = requestFor("budget-turn-9");
  expect(registry.isAcceptedCompactionContinuation(first, identityFor("budget-turn-0"), bounded)).toBe(true);
  expect(registry.recoverCompactionInstruction(first, identityFor("budget-turn-0"))).toBeUndefined();
  expect(registry.recoverCompactionInstruction(newest, identityFor("budget-turn-9"))?.source.content).toBe(bounded.content);

  const countRegistry = createCompactionContinuationRegistry();
  const tiny = { turnId: "original", content: "small" };
  for (let index = 0; index <= 256; index += 1) {
    const turnId = `count-turn-${index}`;
    countRegistry.rememberCompactionContinuation(requestFor(turnId), identityFor(turnId), [tiny], summary);
  }
  expect(countRegistry.isAcceptedCompactionContinuation(requestFor("count-turn-0"), identityFor("count-turn-0"), tiny)).toBe(false);
  expect(countRegistry.isAcceptedCompactionContinuation(requestFor("count-turn-256"), identityFor("count-turn-256"), tiny)).toBe(true);
  const hashRegistry = createCompactionContinuationRegistry();
  const hashTurn = "hash-turn";
  const sources = [tiny, { turnId: "v1", content: "second" }, { turnId: "unexpected", content: "third" }];
  hashRegistry.rememberCompactionContinuation(requestFor(hashTurn), identityFor(hashTurn), sources, summary);
  expect(hashRegistry.isAcceptedCompactionContinuation(requestFor(hashTurn), identityFor(hashTurn), sources[1]!)).toBe(true);
  expect(hashRegistry.isAcceptedCompactionContinuation(requestFor(hashTurn), identityFor(hashTurn), sources[2]!)).toBe(false);
});

test("explicit turn cancellation acknowledges revoked authority before physical compaction cleanup", async () => {
  const traceId = `trace_${randomUUID().replaceAll("-", "")}`;
  let releasePhysical!: () => void;
  const physical = new Promise<void>(resolve => { releasePhysical = resolve; });
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const run = runStructuredCompactionOnce(traceId, { ownerKey: traceId, traceIds: [traceId] }, (signal, retainUntil) => {
    retainUntil(physical);
    started();
    return new Promise<string>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  });
  void run.catch(() => {});
  await ready;
  const config = { ...defaultConfig("browser-only"), port: 0 };
  const server = startServer(config);
  try {
    const request = fetch(`http://127.0.0.1:${server.port}/admin/cancel-turn`, {
      method: "POST", headers: { authorization: `Bearer ${config.controlToken}`, "content-type": "application/json" },
      body: JSON.stringify({ traceId }),
    });
    const receipt = await Promise.race([request, Bun.sleep(300).then(() => undefined)]);
    expect(receipt?.status).toBe(200);
    expect(await receipt!.json()).toMatchObject({ status: "ok", cancelled_compaction_runs: 1 });
    expect(activeStructuredCompactionCount()).toBeGreaterThan(0);
    releasePhysical();
    await expect(run).rejects.toThrow();
    await beginCancelStructuredCompactionTrace(traceId, new Error("fixture cleanup")).settlement;
    expect(activeStructuredCompactionCount()).toBe(0);
  } finally {
    releasePhysical();
    await beginCancelStructuredCompactionTrace(traceId, new Error("fixture cleanup")).settlement;
    await server.stop(true);
  }
});
