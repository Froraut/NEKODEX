import { expect, test } from "bun:test";
import { ChatGptBrowserWorker, chatGptNewTurnIdentity, chatGptStagedBaselineIdentities } from "../src/adapters/chatgpt-web/browser-worker";
import { createChatGptWebAdapter } from "../src/adapters/chatgpt-web/index";
import { ChatGptWebAdapterError } from "../src/adapters/chatgpt-web/adapter-error";
import { CHATGPT_WEB_MODEL_ID } from "../src/adapters/chatgpt-web/model";
import type { AdapterEvent, CodexParsedRequest, CodexProviderConfig } from "../src/types";

test.each([false, true])("retryable transport failure stays fenced on reconnect (submitted=%s)", async submitted => {
  const id = crypto.randomUUID();
  const provider: CodexProviderConfig = {
    adapter: "chatgpt-web", baseUrl: `browser://submission-fault-${id}`,
    chatgptWeb: { localToolsEnabled: false, solAvailable: true, proAvailable: true },
  };
  const worker = ChatGptBrowserWorker.forProvider(provider);
  const original = worker.run;
  let sends = 0;
  worker.run = async turn => {
    sends++;
    await turn.onSendActivated?.();
    if (submitted) await turn.onSubmitted?.();
    throw new ChatGptWebAdapterError("transport disconnected after Enter", {
      status: 503, errorType: "server_error", code: "transport_unavailable", retryable: true,
    });
  };
  const request: CodexParsedRequest = {
    modelId: CHATGPT_WEB_MODEL_ID, stream: true, options: {},
    context: { tools: [], messages: [{ role: "user", content: "Synthetic submission", timestamp: 1 }] },
    _rawBody: {
      prompt_cache_key: id,
      client_metadata: { "x-codex-turn-metadata": JSON.stringify({ thread_id: id, turn_id: id }) },
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "Synthetic submission" }],
        internal_chat_message_metadata_passthrough: { turn_id: id } }],
    },
  };
  try {
    const adapter = createChatGptWebAdapter(provider);
    for (let attempt = 0; attempt < 2; attempt++) {
      const events: AdapterEvent[] = [];
      await adapter.runTurn!(request, { headers: new Headers() }, event => events.push(event));
      expect(events.at(-1)).toMatchObject({ type: "error", retryable: false,
        code: submitted ? "chatgpt_submitted_turn_failed" : "chatgpt_submission_ambiguous" });
    }
    expect(sends).toBe(1);
  } finally { worker.run = original; }
});

test("generation already running in the captured baseline is not new submission evidence", async () => {
  const worker = Object.create(ChatGptBrowserWorker.prototype);
  const state = { turnIdentities: ["history"], userIdentities: [], responseIdentities: ["history"], visibleStopButtonCount: 1 };
  worker.submissionDomState = async () => state;
  const page = { locator: () => ({}) };
  const baseline = await worker.captureSubmissionBaseline(page);
  expect(await worker.currentSubmissionEvidence(page, baseline)).toBeUndefined();
});

// Characterize existing identity authority; no replacement ack protocol is introduced.
test("virtualized history cannot become new evidence and multiple candidates fail closed", () => {
  expect(chatGptNewTurnIdentity(["old-1", "old-2"], ["old-2"])).toBeUndefined();
  expect(chatGptNewTurnIdentity(["old-1", "old-2"], ["old-1", "old-2"])).toBeUndefined();
  expect(chatGptNewTurnIdentity(["old-1", "old-2"], ["new-turn"])).toBe("new-turn");
  expect(() => chatGptNewTurnIdentity(["old-1"], ["new-1", "new-2"])).toThrow("2 new conversation turns");
});

test("staged history rebind requires an exact previously acknowledged transaction token", () => {
  const token = "CODEX_MULTIPART_ACK transaction-a 1";
  expect(chatGptStagedBaselineIdentities([], [token], [
    { identity: "wrong-transaction", text: "CODEX_MULTIPART_ACK transaction-b 1" },
    { identity: "right-transaction", text: token },
  ])).toEqual(["right-transaction"]);
  expect(() => chatGptStagedBaselineIdentities([], [token], [
    { identity: "one", text: token }, { identity: "two", text: token },
  ])).toThrow("duplicate acknowledged context stages");
});

test("activation persistence rejection never reaches Enter", async () => {
  const f = sendFixture();
  await expect(f.run({ onSendActivated: async () => { throw new Error("journal unavailable"); } }))
    .rejects.toThrow("journal unavailable");
  expect(f.events).toEqual([]);
});

test("successful submission publishes evidence only after activation and one Enter", async () => {
  const f = sendFixture();
  expect(await f.run({
    onSendActivated: async () => { await Promise.resolve(); f.events.push("activated"); },
    onSubmitted: () => { f.events.push("submitted"); },
  })).toBe("user_turn");
  expect(f.events).toEqual(["activated", "enter", "evidence", "submitted"]);
});

// Exercise the production send boundary; replace only browser I/O and observation.
function sendFixture() {
  const controller = new AbortController();
  const events: string[] = [];
  const hidden = {
    filter() { return this; }, last() { return this; }, getByText() { return this; },
    isVisible: async () => false, count: async () => 0,
  };
  const page = { isClosed: () => false, locator: () => hidden };
  const sendButton = {
    waitFor: async () => {}, isEnabled: async () => true,
    press: async () => { events.push("enter"); },
  };
  const worker = Object.create(ChatGptBrowserWorker.prototype);
  worker.activeComposer = async () => ({ locator: () => ({ getByTestId: () => sendButton }) });
  worker.waitForSubmissionAcceptedWithRecovery = async () => { events.push("evidence"); return "user_turn"; };
  const run = (lifecycle: { onSendActivated?(): void | Promise<void>; onSubmitted?(): void | Promise<void> }, capture?: () => Promise<void>) =>
    worker.sendAttachedPrompt(page, {}, capture, controller.signal, undefined, lifecycle);
  return { controller, events, worker, run };
}

test("cancellation during send-ready diagnostics does not publish activation", async () => {
  const f = sendFixture();
  await expect(f.run({ onSendActivated: () => { f.events.push("activated"); } }, async () => {
    f.controller.abort();
  })).rejects.toMatchObject({ name: "AbortError" });
  expect(f.events).toEqual([]);
});

test("late acceptance cannot publish submitted after cancellation", async () => {
  const f = sendFixture();
  f.worker.waitForSubmissionAcceptedWithRecovery = async () => {
    f.events.push("late-evidence"); f.controller.abort(); return "user_turn";
  };
  await expect(f.run({
    onSendActivated: () => { f.events.push("activated"); },
    onSubmitted: () => { f.events.push("submitted"); },
  })).rejects.toMatchObject({ name: "AbortError" });
  expect(f.events).toEqual(["activated", "enter", "late-evidence"]);
});

test("pre-Enter MCP progress is excluded even when activation persistence yields", async () => {
  const f = sendFixture();
  let revision = 4;
  let observedBaseline: number | undefined;
  f.worker.waitForSubmissionAcceptedWithRecovery = async (...args: unknown[]) => {
    observedBaseline = args[4] as number; return "user_turn";
  };
  const hidden = { filter() { return this; }, last() { return this; }, getByText() { return this; }, isVisible: async () => false, count: async () => 0 };
  await f.worker.sendAttachedPrompt({ isClosed: () => false, locator: () => hidden }, {}, undefined,
    f.controller.signal, { snapshot: () => ({ lastToolBatchRevision: revision }) }, {
      onSendActivated: async () => { await Promise.resolve(); revision = 5; },
    });
  expect(observedBaseline).toBe(5);
});

test("cancellation during activation persistence prevents Enter", async () => {
  const f = sendFixture();
  await expect(f.run({
    onSendActivated: async () => { f.events.push("activated"); await Promise.resolve(); f.controller.abort(); },
    onSubmitted: () => { f.events.push("submitted"); },
  })).rejects.toMatchObject({ name: "AbortError" });
  expect(f.events).toEqual(["activated"]);
});
