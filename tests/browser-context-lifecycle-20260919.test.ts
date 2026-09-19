import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { Page, Request, Response } from "playwright-core";
import type { CodexParsedRequest } from "../src/types";
import { CHATGPT_WEB_BACKEND_MODEL, CHATGPT_WEB_PRO_REASONING_COMPOSER_CHAR_LIMIT, resolveChatGptWebContextLimits } from "../src/chatgpt-web-models";
import { compileChatGptWebPrompt, formatChatGptWebMultipartStage, formatChatGptWebMultipartCommit, isChatGptWebMultipartPartCount } from "../src/adapters/chatgpt-web/prompt";
import { resolveBiggerContextMultipartParts } from "../src/adapters/chatgpt-web/usage";
import { ChatGptBrowserWorker, ChatGptBrowserObservationTimeoutError, ChatGptSubmissionRejectionObserver, assertChatGptWebMultipartInputWithinLimits } from "../src/adapters/chatgpt-web/browser-worker";
import { canRetryOwnedPageRebind, canRetireDetachedToolDelivery } from "../src/adapters/chatgpt-web/browser-lifecycle-safety";
import { ChatGptTurnSessions, ChatGptTraceFeed, ChatGptTextFeed } from "../src/adapters/chatgpt-web/turn-execution";
import { ChatGptExternalTurnProgress } from "../src/adapters/chatgpt-web/turn-progress";

const caps = { localToolsEnabled: false, solAvailable: true, proAvailable: true };

test("six-part transport preserves records and x3 size boundary and classifies only owned 413", async () => {
  const parsed: CodexParsedRequest = { modelId: CHATGPT_WEB_BACKEND_MODEL, stream: false,
    context: { messages: Array.from({ length: 8 }, (_, i) => ({ role: "user" as const, content: `record ${i}`, timestamp: i + 1 })) },
    options: { reasoning: "high" }, _compactionRequest: true };
  expect(CHATGPT_WEB_PRO_REASONING_COMPOSER_CHAR_LIMIT).toBe(500_000);
  expect(resolveBiggerContextMultipartParts(parsed, caps)).toBe(6);
  const compiled = compileChatGptWebPrompt(parsed, caps, undefined, { experimentalMultipartParts: 6 });
  const multipart = compiled.multipart!;
  expect(multipart.parts).toHaveLength(6);
  expect(isChatGptWebMultipartPartCount(6)).toBe(true);
  expect(isChatGptWebMultipartPartCount(3)).toBe(false);
  expect(multipart.parts.flatMap(part => JSON.parse(part).records).map(record => record.message.content))
    .toEqual(parsed.context.messages.map(message => message.content));
  const id = "ctx_0123456789abcdef0123456789abcdef";
  expect(formatChatGptWebMultipartStage(multipart.parts[0]!, id, 1, 6).acknowledgement).toContain("1/6");
  expect(formatChatGptWebMultipartCommit(multipart, id)).toContain("6/6");
  const { contextWindow } = resolveChatGptWebContextLimits(CHATGPT_WEB_BACKEND_MODEL, "high", caps);
  expect(() => assertChatGptWebMultipartInputWithinLimits(contextWindow * 3, 1, CHATGPT_WEB_BACKEND_MODEL, "high", caps, 1, 6)).toThrow("ceiling");
  expect(() => assertChatGptWebMultipartInputWithinLimits(100, 1, CHATGPT_WEB_BACKEND_MODEL, "high", caps, 500_001, 6)).toThrow("composer boundary");

  const events = new EventEmitter();
  const frame = {};
  const page = Object.assign(events, { mainFrame: () => frame }) as unknown as Page;
  const observer = new ChatGptSubmissionRejectionObserver();
  const request = (owned: boolean) => ({ method: () => "POST", url: () => "https://chatgpt.com/backend-api/f/conversation", frame: () => owned ? frame : {} }) as unknown as Request;
  const response = (req: Request) => ({ request: () => req, status: () => 413,
    headers: () => ({ "content-type": "application/json" }), json: async () => ({ detail: { code: "message_length_exceeds_limit" } }) }) as unknown as Response;
  const old = request(true);
  events.emit("request", old);
  observer.begin(page);
  events.emit("response", response(old));
  const foreign = request(false);
  events.emit("request", foreign);
  events.emit("response", response(foreign));
  expect(await observer.failure()).toBeUndefined();
  const owned = request(true);
  events.emit("request", owned);
  events.emit("response", response(owned));
  expect(await observer.failure()).toMatchObject({ code: "context_length_exceeded", retryable: false });
  observer.dispose();
  expect(events.listenerCount("request")).toBe(0);
  expect(events.listenerCount("response")).toBe(0);
});

test("live accepted turn defers rebind and disconnected delivery preserves active exact ownership", async () => {
  type Baseline = { initialTurnIdentities: string[]; domCache: Record<string, unknown> };
  const worker = ChatGptBrowserWorker.forProvider({ adapter: "chatgpt-web", baseUrl: "browser://context-lifecycle-regression", chatgptWeb: caps }) as unknown as {
    submissionDomState(): Promise<unknown>;
    waitForLiveProbeRetry(): Promise<void>;
    waitForNewAssistantTurn(page: Page, baseline: Baseline, deadline: undefined, signal: undefined,
      progress: ChatGptExternalTurnProgress, grace: number, tracker: undefined,
      recover: () => Promise<never>): Promise<{ identity: string }>;
  };
  const hidden = { filter() { return this; }, last() { return this; }, isVisible: async () => false };
  const page = { isClosed: () => false, locator: () => hidden } as unknown as Page;
  const progress = new ChatGptExternalTurnProgress();
  progress.recordToolBatch(1);
  let probes = 0;
  let waits = 0;
  let rebinds = 0;
  worker.submissionDomState = async () => {
    if (++probes === 1) throw new ChatGptBrowserObservationTimeoutError(5_000);
    return { turnIdentities: ["assistant"], userIdentities: [], responseIdentities: ["assistant"], acknowledgementTurns: [] };
  };
  worker.waitForLiveProbeRetry = async () => { waits += 1; };
  const binding = await worker.waitForNewAssistantTurn(page, { initialTurnIdentities: [], domCache: {} }, undefined, undefined,
    progress, 0, undefined, async () => { rebinds += 1; throw new Error("unexpected rebind"); });
  expect(binding.identity).toBe("assistant");
  expect({ probes, waits, rebinds }).toEqual({ probes: 2, waits: 1, rebinds: 0 });

  const timeout = new Error("viewport timed out", { cause: Object.assign(new Error("timeout"), { name: "TimeoutError" }) });
  const settled = { retry: 0, actionSettled: true, hasConnection: true, aborted: false };
  expect(canRetryOwnedPageRebind(timeout, settled)).toBe(true);
  expect(canRetryOwnedPageRebind(timeout, { ...settled, actionSettled: false })).toBe(false);
  expect(canRetryOwnedPageRebind(timeout, { ...settled, hasConnection: false })).toBe(false);
  expect(canRetryOwnedPageRebind(timeout, { ...settled, retry: 1 })).toBe(false);
  expect(canRetryOwnedPageRebind(new Error("authentication failed"), settled)).toBe(false);
  const orphan = { exactOwner: true, brokerRetired: true, hasObservers: false, activeToolCalls: 0, peerActive: false,
    disconnectedAt: 1, outstandingSince: 1, lastProgressAt: 1, now: 1 + 30 * 60_000 };
  expect(canRetireDetachedToolDelivery(orphan)).toBe(true);
  expect(canRetireDetachedToolDelivery({ ...orphan, activeToolCalls: 1 })).toBe(false);
  expect(canRetireDetachedToolDelivery({ ...orphan, hasObservers: true })).toBe(false);
  expect(canRetireDetachedToolDelivery({ ...orphan, exactOwner: false })).toBe(false);
  expect(canRetireDetachedToolDelivery({ ...orphan, outstandingSince: undefined })).toBe(false);
  expect(canRetireDetachedToolDelivery({ ...orphan, peerActive: true })).toBe(false);
  expect(canRetireDetachedToolDelivery({ ...orphan, brokerRetired: false })).toBe(false);

  const sessions = new ChatGptTurnSessions();
  const ownedProgress = new ChatGptExternalTurnProgress();
  ownedProgress.recordToolBatch(1);
  let finishBrowser!: (answer: string) => void;
  let finishPhysical!: () => void;
  let cancellations = 0;
  const session = sessions.getOrCreate("exact", () => ({ mode: "tools", token: Promise.resolve("synthetic"),
    externalProgress: ownedProgress, trace: new ChatGptTraceFeed(), text: new ChatGptTextFeed(),
    browser: new Promise<string>(resolve => { finishBrowser = resolve; }),
    physicalSettlement: new Promise<void>(resolve => { finishPhysical = resolve; }),
    cancel: () => { cancellations += 1; finishBrowser(""); finishPhysical(); },
  }), "trace", "owner", "turn", "thread");
  session.setOutstanding([{ callId: "call_owned", wireName: "exec_command", freeform: false, arguments: {} }]);
  const future = Date.now() + 31 * 60_000;
  await session.runExclusive(async () => {
    sessions.scheduleDetachedToolRetirement("exact", session);
    expect(sessions.reapDetachedToolTurns(future)).toBe(0); // receipt survives the active observer
  });
  expect(sessions.reapDetachedToolTurns(future)).toBe(0); // long unanswered call remains protected
  await session.runExclusive(async () => {}); // even a same-millisecond reconnect revokes the receipt
  ownedProgress.retire(new Error("exact broker capability retired"));
  expect(sessions.reapDetachedToolTurns(future)).toBe(0);
  sessions.scheduleDetachedToolRetirement("wrong-owner-key", session);
  expect(sessions.reapDetachedToolTurns(future)).toBe(0);
  await session.runExclusive(async () => {
    sessions.scheduleDetachedToolRetirement("exact", session);
    expect(sessions.reapDetachedToolTurns(future)).toBe(0);
  });
  expect(sessions.reapDetachedToolTurns(future)).toBe(1);
  expect(cancellations).toBeGreaterThan(0);
  await session.physicalSettlement;
});
