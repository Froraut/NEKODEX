import { expect, test } from "bun:test";
import type { AdapterEvent, CodexParsedRequest } from "../src/types";
import type { BrowserTurn } from "../src/adapters/chatgpt-web/browser-worker";
import { CHATGPT_WEB_MODEL_ID } from "../src/adapters/chatgpt-web/model";
import { ChatGptTextFeed, ChatGptTraceFeed, ChatGptTurnSession, chatGptTurnSessions } from "../src/adapters/chatgpt-web/turn-execution";
import { createChatGptTurnRoundDelivery } from "../src/adapters/chatgpt-web/turn-round-delivery";
import { createChatGptTurnRuntimeFactory, type ChatGptTurnRuntimeContext } from "../src/adapters/chatgpt-web/turn-runtime";

function sessionFor(answer: string) {
  const text = new ChatGptTextFeed();
  text.push(answer);
  return new ChatGptTurnSession({ mode: "read-only", browser: Promise.resolve(answer),
    physicalSettlement: Promise.resolve(), text, trace: new ChatGptTraceFeed(), cancel() {} });
}
const usage = { inputTokens: 4, outputTokens: 2 };

test("successful delivery validates before buffered answer and completes with the effective usage", () => {
  for (const rememberFinalReplay of [false, true]) {
    const session = sessionFor('{"ok":true}');
    const emitted: AdapterEvent[] = [];
    let validated = false;
    const delivery = createChatGptTurnRoundDelivery({ session, roundKey: "round", bufferStructuredOutput: true,
      validateStructuredOutput(answer) { expect(JSON.parse(answer)).toEqual({ ok: true }); validated = true; },
      emit(event) { expect(validated).toBeTrue(); emitted.push(event); },
      estimateUsage(input) { expect(input).toEqual({ answer: '{"ok":true}', reasoning: ["visible step"] }); return usage; },
    });
    session.appendRoundReasoning("round", ["visible step"]);
    delivery.successfulAnswer('{"ok":true}', rememberFinalReplay);
    expect(emitted).toEqual([{ type: "text_delta", text: '{"ok":true}', phase: "final_answer" },
      { type: "done", stopReason: "stop", endTurn: true, usage }]);
    expect(session.roundEvents("round")).toEqual(emitted);
    expect(session.roundCompleted("round")).toBeTrue();
  }
});

test("successful delivery rejects unequal streams and reached validator failures without publishing buffered output", () => {
  const session = sessionFor("answer");
  const emitted: AdapterEvent[] = [];
  let validations = 0;
  const delivery = createChatGptTurnRoundDelivery({ session, roundKey: "round", bufferStructuredOutput: true,
    emit: event => emitted.push(event), estimateUsage: () => usage,
    validateStructuredOutput() { validations++; throw new Error("schema boundary rejected"); },
  });
  expect(() => delivery.successfulAnswer("different")).toThrow("stream did not reproduce");
  expect(validations).toBe(0);
  expect(() => delivery.successfulAnswer("answer")).toThrow("schema boundary rejected");
  expect(validations).toBe(1);
  expect(emitted).toEqual([]);
  expect(session.roundCompleted("round")).toBeFalse();
});

test("tool delivery journals its whole batch before observer failure and exact replay contains one terminal", () => {
  const session = sessionFor("answer");
  let observed = 0;
  const delivery = createChatGptTurnRoundDelivery({ session, roundKey: "round", bufferStructuredOutput: false,
    emit() { observed++; if (observed === 2) throw new Error("observer boundary disconnected"); },
    estimateUsage: () => usage,
  });
  expect(() => delivery.tools([{ callId: "call", wireName: "tool", freeform: false, arguments: { x: 1 } }], []))
    .toThrow("observer boundary disconnected");
  expect(observed).toBe(2);
  const replay = session.roundEvents("round");
  expect(replay.map(event => event.type)).toEqual(["tool_call_start", "tool_call_delta", "tool_call_end", "done"]);
  expect(replay.at(-1)).toEqual({ type: "done", stopReason: "tool_use", endTurn: false, usage });
  expect(session.roundHasTerminalEvent("round")).toBeTrue();
  session.completeRound("round");
  expect(session.roundCompleted("round")).toBeTrue();
});

for (const localToolsEnabled of [false, true]) test(`automatic lifecycle shares callbacks and retains physical settlement (tools=${localToolsEnabled})`, async () => {
  let captured: BrowserTurn | undefined;
  let finish!: (answer: string) => void;
  let starts = 0;
  let acknowledgements = 0;
  const unexpected = (): never => { throw new Error("unexpected Manual/checkpoint dependency"); };
  const context: ChatGptTurnRuntimeContext = {
    provider: { adapter: "chatgpt-web", baseUrl: "browser://fixture" },
    worker: { run(turn) { captured = turn; starts++; return new Promise(resolve => { finish = resolve; }); } },
    broker: { register: async () => "fixture-token", registerSafe: unexpected,
      waitForRetirement: () => new Promise(() => {}), revoke() {}, confirmSafeTurnSent: unexpected,
      waitForSafeStart: unexpected, waitForSafeCompletion: unexpected,
      beginCompletionFence: () => ({ revision: 1 }), commitCompletionFence: () => true },
    zeroRiskManualControl: { start: unexpected, waitSent: unexpected, waitTerminal: unexpected,
      markStarted: unexpected, end: unexpected, cancel: unexpected },
    lunaCheckpointStore: { apply: unexpected, commit: unexpected },
    conversationNamespace: () => "fixture", manualInteraction: false,
  };
  const parsed: CodexParsedRequest = { modelId: CHATGPT_WEB_MODEL_ID, stream: true,
    _chatgptModelFamily: "6",
    context: { messages: [{ role: "user", content: "Hello", timestamp: 1 }] }, options: { reasoning: "high" },
    _rawBody: { client_metadata: { "x-codex-turn-metadata": JSON.stringify({ thread_id: "fixture", turn_id: "turn" }) } },
  };
  const runtime = createChatGptTurnRuntimeFactory(context)({ parsed, traceId: "trace",
    environment: { cwd: "/tmp", roots: ["/tmp"], writableRoots: [], sandboxPolicy: { type: "readOnly", networkAccess: false }, tools: [] },
    turnCapabilities: { localToolsEnabled, solAvailable: true, proAvailable: false },
    hooks: { onCompactionProgress() { acknowledgements++; } },
  });
  if (!captured) throw new Error("worker boundary was not reached");
  expect(captured.modelFamily).toBe("6");
  await captured.prepare();
  if (runtime.mode === "tools") expect(await runtime.token).toBe("fixture-token");
  expect(runtime.submission?.phase).toBe("prepared");
  await captured.onSendActivated?.();
  expect(runtime.submission?.phase).toBe("send_activated");
  await captured.onSubmitted?.();
  await captured.onMultipartStageAcknowledged?.(0);
  expect(runtime.submission?.phase).toBe("accepted");
  expect(acknowledgements).toBe(2);
  captured.onReasoningSummary?.("step");
  captured.onCommentary?.("continued", true);
  captured.onTextDelta("answer");
  expect(runtime.trace.drain()).toEqual([{ kind: "reasoning", text: "step" }, { kind: "commentary", text: "continued", continuation: true }]);
  expect(runtime.text.value()).toBe("answer");
  let physicallySettled = false;
  void runtime.physicalSettlement.then(() => { physicallySettled = true; });
  const reason = new Error("targeted cancellation");
  runtime.cancel(reason);
  await expect(runtime.browser).rejects.toBe(reason);
  expect(captured.abortSignal?.aborted).toBeTrue();
  expect(physicallySettled).toBeFalse();
  finish("answer");
  await runtime.physicalSettlement;
  expect(physicallySettled).toBeTrue();
  expect(starts).toBe(1);
}, 5_000);

// Exercise the same adapter boundary on either side of observer admission, then exact reconnect.
for (const settledBeforeAdmission of [false, true]) test(`adapter completion and reconnect agree (settled=${settledBeforeAdmission})`, async () => {
  const { ChatGptBrowserWorker } = await import("../src/adapters/chatgpt-web/browser-worker");
  const { createChatGptWebAdapter } = await import("../src/adapters/chatgpt-web/index");
  const provider = { adapter: "chatgpt-web" as const, baseUrl: `browser://delivery-fixture-${settledBeforeAdmission}`,
    chatgptWeb: { localToolsEnabled: false, solAvailable: true } };
  const worker = ChatGptBrowserWorker.forProvider(provider);
  const originalRun = worker.run;
  const originalAdmission = chatGptTurnSessions.getOrCreateAfterOwnerRetirement;
  let admitted = false;
  chatGptTurnSessions.getOrCreateAfterOwnerRetirement = async function (...args) {
    const session = await originalAdmission.apply(this, args);
    if (!admitted) {
      if (settledBeforeAdmission) await session.browserOutcome;
      expect(session.settledOutcome() !== undefined).toBe(settledBeforeAdmission);
      admitted = true;
    }
    return session;
  };
  let starts = 0;
  let finish!: () => void;
  let signalStarted!: () => void;
  const started = new Promise<void>(resolve => { signalStarted = resolve; });
  const answer = "complete answer";
  worker.run = turn => {
    starts++;
    const result = new Promise<string>(resolve => {
      finish = () => { turn.onTextDelta(answer); resolve(answer); };
    });
    if (settledBeforeAdmission) finish();
    signalStarted();
    return result;
  };
  const request: CodexParsedRequest = { modelId: CHATGPT_WEB_MODEL_ID, stream: true, options: { reasoning: "high" },
    context: { messages: [{ role: "user", content: "Hello", timestamp: 1 }] },
    _rawBody: { client_metadata: { "x-codex-turn-metadata": JSON.stringify({ thread_id: `delivery-${settledBeforeAdmission}`, turn_id: "turn" }) },
      input: [{ type: "message", role: "user", internal_chat_message_metadata_passthrough: { turn_id: "turn" }, content: [{ type: "input_text", text: "Hello" }] }] },
  };
  try {
    const adapter = createChatGptWebAdapter(provider);
    if (!adapter.runTurn) throw new Error("adapter turn boundary unavailable");
    const emitted: AdapterEvent[] = [];
    const running = adapter.runTurn(request, { headers: new Headers() }, event => emitted.push(event));
    await Promise.race([started, running.then(() => { throw new Error("adapter ended before worker boundary"); })]);
    if (!settledBeforeAdmission) {
      await Bun.sleep(0);
      finish();
    }
    await running;
    const replay: AdapterEvent[] = [];
    await adapter.runTurn(request, { headers: new Headers() }, event => replay.push(event));
    for (const events of [emitted, replay]) {
      expect(events.filter((event): event is Extract<AdapterEvent, { type: "text_delta" }> => event.type === "text_delta" && event.phase === "final_answer")
        .map(event => event.text).join("")).toBe(answer);
      expect(events.filter(event => event.type === "done")).toHaveLength(1);
    }
    expect(starts).toBe(1);
  } finally {
    worker.run = originalRun;
    chatGptTurnSessions.getOrCreateAfterOwnerRetirement = originalAdmission;
  }
}, 5_000);
