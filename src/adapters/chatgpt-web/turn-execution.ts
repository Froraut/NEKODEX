import { createHash } from "node:crypto";
import type { AdapterEvent, CodexParsedRequest } from "../../types";
import type { BrokerToolRequest } from "./turn-broker";
import { chatGptBrowserTabClosedError, chatGptTurnSupersededError } from "./adapter-error";
import {
  chatGptTurnUserRevisionHistory,
  extractChatGptCompactionSourceRevision,
  extractChatGptTurnIdentity,
  extractChatGptTurnUserRevision,
} from "./environment";
import { MAX_CHATGPT_BROWSER_TABS } from "./concurrency";
import type { ChatGptExternalTurnProgress } from "./turn-progress";
import {
  CHATGPT_REPLAY_BYTES, CHATGPT_REGISTRY_REPLAY_BYTES, CHATGPT_TEXT_BUFFER_BYTES,
  CHATGPT_TRACE_BUFFER_BYTES, ChatGptResourceLimitError, assertByteLimit, retainedRecordBytes,
} from "./resource-budgets";

function awaitWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    // Keep the underlying retirement promise observed even when the caller arrived after abort;
    // another owner may still depend on its eventual settlement and rejection must not become an
    // unhandled process-level error.
    void promise.catch(() => {});
    return Promise.reject(new DOMException("ChatGPT web turn aborted", "AbortError"));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("ChatGPT web turn aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      value => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      error => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export type ChatGptBrowserOutcome =
  | { type: "final"; answer: string }
  | { type: "error"; error: Error };

export interface ChatGptTraceEvent {
  kind: "reasoning" | "commentary";
  text: string;
  continuation?: boolean;
}

interface TraceWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export class ChatGptTraceFeed {
  private queuedBytes = 0;
  private readonly queued: ChatGptTraceEvent[] = [];
  private readonly waiters = new Set<TraceWaiter>();

  constructor(private readonly maxBytes = CHATGPT_TRACE_BUFFER_BYTES) {
    assertByteLimit(0, maxBytes, "ChatGPT trace feed");
  }

  push(event: ChatGptTraceEvent): void {
    const normalized = event.continuation ? event.text : event.text.trim();
    if (!normalized) return;
    const normalizedEvent = { ...event, text: normalized };
    const bytes = retainedRecordBytes(normalizedEvent);
    assertByteLimit(this.queuedBytes + bytes, this.maxBytes, "ChatGPT trace feed");
    this.queuedBytes += bytes;
    this.queued.push(normalizedEvent);
    const waiter = this.waiters.values().next().value as TraceWaiter | undefined;
    if (!waiter) return;
    this.waiters.delete(waiter);
    if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener("abort", waiter.onAbort);
    waiter.resolve();
  }

  drain(): ChatGptTraceEvent[] {
    this.queuedBytes = 0;
    return this.queued.splice(0);
  }

  wait(signal?: AbortSignal): Promise<void> {
    if (this.queued.length > 0) return Promise.resolve();
    if (signal?.aborted) return Promise.reject(new DOMException("trace wait aborted", "AbortError"));
    return new Promise<void>((resolveWait, rejectWait) => {
      const waiter: TraceWaiter = { resolve: resolveWait, reject: rejectWait, ...(signal ? { signal } : {}) };
      if (signal) {
        waiter.onAbort = () => {
          this.waiters.delete(waiter);
          rejectWait(new DOMException("trace wait aborted", "AbortError"));
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      this.waiters.add(waiter);
    });
  }
}

interface TextWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

/** Append-only browser Markdown feed. Waiters are notifications; `drain` owns consumption. */
export class ChatGptTextFeed {
  private readonly queued: string[] = [];
  private readonly waiters = new Set<TextWaiter>();
  private text = "";
  private textBytes = 0;
  private queuedBytes = 0;

  constructor(private readonly maxBytes = CHATGPT_TEXT_BUFFER_BYTES) {
    assertByteLimit(0, maxBytes, "ChatGPT answer feed");
  }

  push(delta: string): void {
    if (!delta) return;
    const bytes = Buffer.byteLength(delta, "utf8");
    assertByteLimit(this.textBytes + bytes, this.maxBytes, "ChatGPT answer feed");
    assertByteLimit(this.queuedBytes + bytes + 64, this.maxBytes, "ChatGPT text progress queue");
    this.textBytes += bytes;
    this.queuedBytes += bytes + 64;
    this.text += delta;
    this.queued.push(delta);
    const waiter = this.waiters.values().next().value as TextWaiter | undefined;
    if (!waiter) return;
    this.waiters.delete(waiter);
    if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener("abort", waiter.onAbort);
    waiter.resolve();
  }

  drain(): string[] {
    this.queuedBytes = 0;
    return this.queued.splice(0);
  }

  value(): string {
    return this.text;
  }

  wait(signal?: AbortSignal): Promise<void> {
    if (this.queued.length > 0) return Promise.resolve();
    if (signal?.aborted) return Promise.reject(new DOMException("text wait aborted", "AbortError"));
    return new Promise<void>((resolveWait, rejectWait) => {
      const waiter: TextWaiter = { resolve: resolveWait, reject: rejectWait, ...(signal ? { signal } : {}) };
      if (signal) {
        waiter.onAbort = () => {
          this.waiters.delete(waiter);
          rejectWait(new DOMException("text wait aborted", "AbortError"));
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      this.waiters.add(waiter);
    });
  }
}

interface ChatGptTurnRuntimeBase {
  browser: Promise<string>;
  /** Physical helper/Playwright settlement, including the launcher end/release acknowledgement. */
  physicalSettlement: Promise<void>;
  trace: ChatGptTraceFeed;
  text: ChatGptTextFeed;
  usageInput?: CodexParsedRequest;
  conversationKey?: string;
  releaseRetainedConversation?: () => Promise<void>;
  /** Idempotently retire the turn-bound MCP capability after browser and observer settlement. */
  retireCapability?: () => void | Promise<void>;
  submission?: { phase: "prepared" | "send_activated" | "accepted" };
  /** Present only when the visible ChatGPT tab is driven manually through the Codex Zero Risk MCP contract. */
  manualControl?: { surfaceNonce: string };
  cancel: (reason?: Error) => void;
}

export type ChatGptTurnRuntime =
  | (ChatGptTurnRuntimeBase & {
    mode: "tools";
    token: Promise<string>;
    externalProgress: ChatGptExternalTurnProgress;
  })
  | (ChatGptTurnRuntimeBase & { mode: "read-only" });

function executionKey(parsed: CodexParsedRequest, payload: unknown): string {
  return createHash("sha256").update(JSON.stringify({
    modelId: parsed.modelId,
    reasoning: parsed.options.reasoning,
    payload,
  })).digest("hex");
}

function compactionInputRevision(parsed: CodexParsedRequest): unknown[] {
  const body = parsed._rawBody;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("ChatGPT web compaction requires the complete native Codex request body");
  }
  const input = (body as { input?: unknown }).input;
  if (!Array.isArray(input)) {
    throw new Error("ChatGPT web compaction requires the complete native Codex input history");
  }
  return input;
}

export function chatGptTurnExecutionKey(parsed: CodexParsedRequest): string {
  const identity = extractChatGptTurnIdentity(parsed);
  if (!identity.turnId) throw new Error("ChatGPT web requires native Codex turn_id metadata for browser-session replay");
  return executionKey(parsed, {
    threadId: identity.threadId,
    turnId: identity.turnId,
    purpose: parsed._compactionRequest ? "compaction" : "response",
    revision: parsed._compactionRequest
      ? compactionInputRevision(parsed)
      : extractChatGptTurnUserRevision(parsed),
    ...(!parsed._compactionRequest ? { instructionId: chatGptTurnUserRevisionHistory(parsed).at(-1)?.itemId } : {}),
  });
}

export interface ChatGptInstructionLineage {
  current: string;
  predecessors: ReadonlySet<string>;
}

export function chatGptInstructionLineage(parsed: CodexParsedRequest): ChatGptInstructionLineage {
  const revisions = chatGptTurnUserRevisionHistory(parsed).map(revision => createHash("sha256")
    .update(JSON.stringify([revision.itemId ?? null, revision.content])).digest("hex"));
  const current = revisions.pop();
  if (!current) throw new Error("ChatGPT web requires a canonical user instruction");
  return { current, predecessors: new Set(revisions) };
}

/** Exact canonical Responses request identity inside one long-lived browser execution. */
export function chatGptTurnRoundKey(parsed: CodexParsedRequest): string {
  const identity = extractChatGptTurnIdentity(parsed);
  if (!identity.turnId) throw new Error("ChatGPT web requires native Codex turn_id metadata for round replay");
  const body = parsed._rawBody;
  if (!body || typeof body !== "object" || Array.isArray(body)
    || !Array.isArray((body as { input?: unknown }).input)) {
    throw new Error("ChatGPT web requires the complete native Codex input for round replay");
  }
  return executionKey(parsed, {
    threadId: identity.threadId,
    turnId: identity.turnId,
    purpose: parsed._compactionRequest ? "compaction" : "response",
    input: (body as { input: unknown[] }).input,
  });
}

/** Stable identity for limiting automatic retries of one native Codex turn. */
export function chatGptTurnRetryKey(parsed: CodexParsedRequest): string {
  const identity = extractChatGptTurnIdentity(parsed);
  if (!identity.turnId) throw new Error("ChatGPT web requires native Codex turn_id metadata for browser-turn retry budgeting");
  return createHash("sha256").update(JSON.stringify({
    threadId: identity.threadId,
    turnId: identity.turnId,
    purpose: parsed._compactionRequest ? "compaction" : "response",
  })).digest("hex");
}

/** One native Codex thread may own at most one live ChatGPT browser surface. */
export function chatGptThreadOwnershipKey(parsed: CodexParsedRequest): string {
  const identity = extractChatGptTurnIdentity(parsed);
  const owner = identity.threadId
    ? { kind: "thread", id: identity.threadId }
    : identity.promptCacheKey
      ? { kind: "prompt_cache", id: identity.promptCacheKey }
      : identity.turnId
        ? { kind: "turn", id: identity.turnId }
        : undefined;
  if (!owner) throw new Error("ChatGPT web requires native Codex turn identity metadata for browser ownership");
  return createHash("sha256").update(JSON.stringify(owner)).digest("hex");
}

/** Locate the browser response that a native mid-turn compaction replaces. */
export function chatGptCompactionSourceExecutionKey(parsed: CodexParsedRequest): string {
  const identity = extractChatGptTurnIdentity(parsed);
  if (!identity.turnId) throw new Error("ChatGPT web requires native Codex turn_id metadata for browser-session replay");
  const source = extractChatGptCompactionSourceRevision(parsed);
  return executionKey(parsed, {
    threadId: identity.threadId,
    turnId: source.turnId ?? identity.turnId,
    purpose: "response",
    revision: source.content,
    instructionId: source.itemId,
  });
}

export class ChatGptTurnSession {
  supersededError?: Error;
  readonly createdAt = Date.now();
  private lastTouchedAt = this.createdAt;
  readonly browserOutcome: Promise<ChatGptBrowserOutcome>;
  readonly physicalSettlement: Promise<void>;
  private readonly outstandingById = new Map<string, BrokerToolRequest>();
  private readonly deliveredResultIds = new Set<string>();
  private outstandingReasoning: string[] = [];
  private finalReasoning: string[] = [];
  private outstandingPrelude: AdapterEvent[] = [];
  private finalPrelude: AdapterEvent[] = [];
  private settledBrowserOutcome?: ChatGptBrowserOutcome;
  private settledPhysical = false;
  private attachedConversationKey: string | undefined;
  private tail: Promise<void> = Promise.resolve();
  private capabilityRetirementScheduled = false;
  private replayBytes = 0;
  private replayFailure?: ChatGptResourceLimitError;
  private readonly replayFields = new Map<string, number>();
  private readonly rounds = new Map<string, {
    events: AdapterEvent[];
    reasoning: string[];
    completed: boolean;
    failure?: Error;
    bytes: number;
  }>();

  constructor(
    readonly runtime: ChatGptTurnRuntime,
    readonly traceId?: string,
    readonly ownerKey?: string,
    readonly nativeTurnId?: string,
    readonly nativeThreadId?: string,
    readonly instruction?: string,
    private readonly replayBudget: {
      maxBytes?: number;
      checkRegistry?: (additionalBytes: number) => void;
    } = {},
  ) {
    assertByteLimit(0, replayBudget.maxBytes ?? CHATGPT_REPLAY_BYTES, "ChatGPT replay journal");
    this.attachedConversationKey = runtime.conversationKey;
    this.physicalSettlement = runtime.physicalSettlement.then(
      () => { this.settledPhysical = true; },
      error => {
        this.settledPhysical = true;
        throw error;
      },
    );
    this.browserOutcome = runtime.browser
      .then(answer => ({ type: "final", answer }) as ChatGptBrowserOutcome)
      .catch(error => ({ type: "error", error: error instanceof Error ? error : new Error(String(error)) }) as ChatGptBrowserOutcome)
      .then(outcome => {
      this.settledBrowserOutcome = outcome;
      return outcome;
    });
  }

  runExclusive<T>(task: () => Promise<T>): Promise<T> {
    this.touch();
    const run = this.tail.then(task);
    this.tail = run.then(() => undefined, () => undefined);
    this.scheduleCapabilityRetirement();
    return run;
  }

  touch(): void {
    this.lastTouchedAt = Date.now();
  }

  lastUsedAt(): number {
    return this.lastTouchedAt;
  }

  outstanding(): BrokerToolRequest[] {
    return [...this.outstandingById.values()];
  }

  settledOutcome(): ChatGptBrowserOutcome | undefined {
    return this.settledBrowserOutcome;
  }

  conversationKey(): string | undefined {
    return this.attachedConversationKey;
  }

  detachConversation(conversationKey: string): boolean {
    if (this.attachedConversationKey !== conversationKey) return false;
    this.attachedConversationKey = undefined;
    return true;
  }

  isActive(): boolean {
    return this.settledBrowserOutcome === undefined;
  }

  /** The client-visible browser result can settle before launcher/helper cleanup does. */
  isPhysicallySettled(): boolean {
    return this.settledPhysical;
  }

  setOutstanding(requests: BrokerToolRequest[], reasoning: string[] = [], prelude: AdapterEvent[] = []): void {
    if (this.outstandingById.size > 0) throw new Error("cannot emit a new ChatGPT tool batch while the previous batch is unresolved");
    const seen = new Set<string>();
    for (const request of requests) {
      if (seen.has(request.callId) || this.deliveredResultIds.has(request.callId)) {
        throw new Error(`duplicate ChatGPT bridge tool call id: ${request.callId}`);
      }
      seen.add(request.callId);
    }
    this.replaceReplayField("outstanding", retainedRecordBytes(requests) + retainedRecordBytes(reasoning) + retainedRecordBytes(prelude));
    for (const request of requests) this.outstandingById.set(request.callId, request);
    this.outstandingReasoning = [...reasoning];
    this.outstandingPrelude = [...prelude];
  }

  hasOutstanding(callId: string): boolean {
    return this.outstandingById.has(callId);
  }

  markResultDelivered(callId: string): void {
    if (!this.outstandingById.has(callId)) throw new Error(`ChatGPT bridge tool result does not match an outstanding call: ${callId}`);
    const releasedBytes = this.outstandingById.size === 1 ? (this.replayFields.get("outstanding") ?? 0) : 0;
    this.reserveReplayBytes(retainedRecordBytes(callId) - releasedBytes);
    this.outstandingById.delete(callId);
    this.deliveredResultIds.add(callId);
    if (this.outstandingById.size === 0) {
      this.replayFields.set("outstanding", 0);
      this.outstandingReasoning = [];
      this.outstandingPrelude = [];
    }
  }

  reasoningForOutstandingReplay(): string[] {
    return [...this.outstandingReasoning];
  }

  eventsForOutstandingReplay(): AdapterEvent[] {
    return [...this.outstandingPrelude];
  }

  setFinalReasoning(reasoning: string[]): void {
    this.replaceReplayField("finalReasoning", retainedRecordBytes(reasoning));
    this.finalReasoning = [...reasoning];
  }

  reasoningForFinalReplay(): string[] {
    return [...this.finalReasoning];
  }

  setFinalEvents(events: AdapterEvent[]): void {
    this.replaceReplayField("finalEvents", events.reduce((bytes, event) => bytes + retainedRecordBytes(event), 0));
    this.finalPrelude = [...events];
  }

  eventsForFinalReplay(): AdapterEvent[] {
    return [...this.finalPrelude];
  }

  roundEvents(key: string): AdapterEvent[] {
    return [...this.round(key).events];
  }

  roundReasoning(key: string): string[] {
    return [...this.round(key).reasoning];
  }

  appendRoundEvent(key: string, event: AdapterEvent): void {
    this.appendRoundEvents(key, [event]);
  }

  appendRoundEvents(key: string, events: readonly AdapterEvent[]): void {
    if (events.length === 0) return;
    const round = this.round(key);
    if (round.completed) throw new Error("cannot append to a completed ChatGPT native round");
    const bytes = events.reduce((sum, event) => sum + retainedRecordBytes(event), 0);
    this.reserveReplayBytes(bytes);
    round.bytes += bytes;
    for (const event of events) round.events.push(event);
  }

  appendRoundReasoning(key: string, values: readonly string[]): void {
    if (values.length === 0) return;
    const round = this.round(key);
    if (round.completed) throw new Error("cannot append reasoning to a completed ChatGPT native round");
    const bytes = values.reduce((sum, value) => sum + retainedRecordBytes(value), 0);
    this.reserveReplayBytes(bytes);
    round.bytes += bytes;
    for (const value of values) round.reasoning.push(value);
  }

  completeRound(key: string): void {
    this.round(key).completed = true;
  }

  failRound(key: string, error: Error): void {
    if (this.replayFailure) return;
    const round = this.round(key);
    round.failure = error;
    round.completed = true;
  }

  roundCompleted(key: string): boolean {
    return this.rounds.get(key)?.completed === true;
  }

  roundFailure(key: string): Error | undefined {
    return this.rounds.get(key)?.failure;
  }

  roundHasTerminalEvent(key: string): boolean {
    return this.rounds.get(key)?.events.some(event => event.type === "done" || event.type === "error") === true;
  }

  cancel(reason?: Error): void {
    this.runtime.cancel(reason);
  }

  private scheduleCapabilityRetirement(): void {
    if (this.capabilityRetirementScheduled || !this.runtime.retireCapability) return;
    this.capabilityRetirementScheduled = true;
    // Register only after the first observer entered `runExclusive`. This ensures an immediately
    // completed mocked/real browser cannot revoke its token ahead of the browser-outcome branch.
    // At physical settlement, read the current tail so every tool-result/reconnect observer that
    // was already admitted finishes before the capability is retired.
    void this.physicalSettlement
      .then(() => this.tail)
      .then(() => this.runtime.retireCapability!())
      .catch(error => {
        console.error(
          `[chatgpt-web] failed to retire settled turn capability: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }

  retainedReplayBytes(): number {
    return this.replayBytes;
  }

  private replaceReplayField(key: string, bytes: number): void {
    this.reserveReplayBytes(bytes - (this.replayFields.get(key) ?? 0));
    this.replayFields.set(key, bytes);
  }

  private reserveReplayBytes(additionalBytes: number): void {
    if (this.replayFailure) throw this.replayFailure;
    try {
      assertByteLimit(this.replayBytes + additionalBytes, this.replayBudget.maxBytes ?? CHATGPT_REPLAY_BYTES, "ChatGPT replay journal");
      if (additionalBytes > 0) this.replayBudget.checkRegistry?.(additionalBytes);
    } catch (error) {
      if (error instanceof ChatGptResourceLimitError) {
        this.replayFailure = error;
        this.runtime.cancel(error);
      }
      throw error;
    }
    this.replayBytes += additionalBytes;
  }

  private round(key: string) {
    if (this.replayFailure) throw this.replayFailure;
    let round = this.rounds.get(key);
    if (round) return round;
    // Retain the existing count bound and evict only completed rounds. Byte exhaustion fails
    // the turn instead of dropping accepted output that an exact reconnect still needs.
    while (this.rounds.size >= 512) {
      const oldestCompleted = [...this.rounds].find(([, candidate]) => candidate.completed);
      if (!oldestCompleted) throw new Error("ChatGPT native round journal is full (512 unfinished rounds)");
      this.rounds.delete(oldestCompleted[0]);
      this.replayBytes -= oldestCompleted[1].bytes;
    }
    const bytes = retainedRecordBytes(key);
    this.reserveReplayBytes(bytes);
    round = { events: [], reasoning: [], completed: false, bytes };
    this.rounds.set(key, round);
    return round;
  }
}

export class ChatGptTurnSessions {
  private readonly entries = new Map<string, ChatGptTurnSession>();
  private readonly conversationHeads = new Map<string, ChatGptTurnSession>();
  private readonly retirements = new Map<string, Promise<void>>();
  private readonly ownerRetirements = new Map<string, Promise<void>>();
  private readonly conversationRetirements = new Map<string, Promise<void>>();
  private readonly retainedReleases = new Map<string, {
    matches: [string, ChatGptTurnSession][];
    preserved?: { session: ChatGptTurnSession; executionKey: string };
    release?: () => Promise<void>;
  }>();

  constructor(
    private readonly ttlMs = 30 * 60_000,
    private readonly maxEntries = 256,
    private readonly maxReplayBytes = CHATGPT_REGISTRY_REPLAY_BYTES,
  ) {
    assertByteLimit(0, maxReplayBytes, "ChatGPT session replay registry");
  }

  getOrCreate(
    key: string,
    start: () => ChatGptTurnRuntime,
    traceId?: string,
    ownerKey?: string,
    nativeTurnId?: string,
    nativeThreadId?: string,
    instruction?: string,
  ): ChatGptTurnSession {
    this.prune();
    if ([...this.retainedReleases.values()].some(obligation => (
      obligation.preserved?.executionKey === key || obligation.matches.some(([ownedKey, session]) => (
        ownedKey === key || (ownerKey !== undefined && session.ownerKey === ownerKey)
      ))
    ))) {
      throw new Error("ChatGPT retained conversation release must be acknowledged before replacing its owner");
    }
    const existing = this.entries.get(key);
    if (existing) {
      if (existing.supersededError) throw existing.supersededError;
      existing.touch();
      return existing;
    }
    const active = [...this.entries.values()].filter(session => session.isActive()).length;
    if (active >= MAX_CHATGPT_BROWSER_TABS) {
      throw new Error(
        `ChatGPT Web supports at most ${MAX_CHATGPT_BROWSER_TABS} simultaneous browser turns; close or finish a browser tab before starting another`,
      );
    }
    if (this.entries.size >= this.maxEntries) throw new Error(`ChatGPT web session registry is full (${this.maxEntries} entries)`);
    const session = new ChatGptTurnSession(start(), traceId, ownerKey, nativeTurnId, nativeThreadId, instruction, {
      checkRegistry: additionalBytes => {
        let retained = additionalBytes;
        for (const entry of this.entries.values()) retained += entry.retainedReplayBytes();
        assertByteLimit(retained, this.maxReplayBytes, "ChatGPT session replay registry");
      },
    });
    this.entries.set(key, session);
    const conversationKey = session.conversationKey();
    if (conversationKey) this.conversationHeads.set(conversationKey, session);
    return session;
  }

  async getOrCreateAfterOwnerRetirement(
    key: string,
    ownerKey: string,
    start: () => ChatGptTurnRuntime,
    traceId?: string,
    signal?: AbortSignal,
    nativeTurnId?: string,
    nativeThreadId?: string,
    instruction?: ChatGptInstructionLineage,
    retainedConversationKey?: string,
  ): Promise<ChatGptTurnSession> {
    for (;;) {
      if (signal?.aborted) throw new DOMException("ChatGPT web turn aborted", "AbortError");
      const outstanding = [...this.retainedReleases].find(([conversationKey, obligation]) => (
        conversationKey === retainedConversationKey || obligation.preserved?.executionKey === key
        || obligation.matches.some(([ownedKey, session]) => (
          ownedKey === key || session.ownerKey === ownerKey
        ))
      ));
      if (outstanding) {
        await awaitWithAbort(this.closeConversationAndWait(outstanding[0], outstanding[1].preserved), signal);
        continue;
      }
      const existing = this.entries.get(key);
      if (existing) {
        if (existing.supersededError) throw existing.supersededError;
        existing.touch();
        return existing;
      }
      const pending = this.retirements.get(key) ?? this.ownerRetirements.get(ownerKey);
      if (pending) {
        await awaitWithAbort(pending, signal);
        continue;
      }
      const activeOwner = [...this.entries].find(([ownedKey, session]) => (
        ownedKey !== key && session.ownerKey === ownerKey
        && (session.isActive() || !session.isPhysicallySettled())
      ));
      if (activeOwner) {
        const [ownedKey, ownedSession] = activeOwner;
        if (ownedSession.isActive() && instruction && ownedSession.instruction
          && instruction.current !== ownedSession.instruction) {
          if (!instruction.predecessors.has(ownedSession.instruction)) throw chatGptTurnSupersededError();
          // Native steering can return the old tool result and a new instruction in one request.
          // Waiting for the old browser here deadlocks before that result can be consumed. Retire
          // its capability and rebuild from the complete canonical history, including that result.
          // Keep the old entry terminal so a delayed replay cannot restart superseded work.
          const reason = chatGptTurnSupersededError();
          ownedSession.supersededError = reason;
          this.forgetConversationHead(ownedSession);
          await awaitWithAbort(this.beginRetirement(ownedKey, ownedSession, reason), signal);
          continue;
        }
        // A completed response may still be releasing its browser surface. Sequential work
        // waits for that cleanup; preemption requires a proven newer canonical instruction.
        await awaitWithAbort(Promise.all([ownedSession.physicalSettlement, ownedSession.browserOutcome]), signal);
        continue;
      }
      if (signal?.aborted) throw new DOMException("ChatGPT web turn aborted", "AbortError");
      const conversationRetirement = retainedConversationKey
        ? this.releaseOtherOwnerConversations(ownerKey, retainedConversationKey)
        : undefined;
      if (conversationRetirement) {
        await awaitWithAbort(conversationRetirement, signal);
        continue;
      }
      return this.getOrCreate(key, start, traceId, ownerKey, nativeTurnId, nativeThreadId, instruction?.current);
    }
  }

  /** A model switch closes stale browser history, while exact logical responses stay replayable. */
  private releaseOtherOwnerConversations(ownerKey: string, nextConversationKey: string): Promise<void> | undefined {
    const previous = [...this.entries.values()].filter(session => (
      session.ownerKey === ownerKey && session.conversationKey() !== undefined
      && session.conversationKey() !== nextConversationKey
    ));
    if (previous.length === 0) return undefined;
    const releases = new Map<string, () => Promise<void>>();
    for (const session of previous) {
      if (session.isActive() || !session.isPhysicallySettled()) {
        throw new Error("Cannot switch a retained ChatGPT model before its prior turn settles");
      }
      const conversationKey = session.conversationKey()!;
      const release = session.runtime.releaseRetainedConversation;
      if (!release) throw new Error("ChatGPT retained conversation has no Launcher release callback");
      releases.set(conversationKey, release);
    }
    const retirement = Promise.resolve().then(async () => {
      for (const release of releases.values()) await release();
      // Detach only after release succeeds, so a failed close is retried before
      // a future A -> B -> A selection can reuse an obsolete browser history.
      for (const session of previous) {
        const conversationKey = session.conversationKey();
        if (conversationKey) {
          this.conversationHeads.delete(conversationKey);
          session.detachConversation(conversationKey);
        }
      }
    });
    this.ownerRetirements.set(ownerKey, retirement);
    for (const conversationKey of releases.keys()) this.conversationRetirements.set(conversationKey, retirement);
    return retirement.finally(() => {
      if (this.ownerRetirements.get(ownerKey) === retirement) this.ownerRetirements.delete(ownerKey);
      for (const conversationKey of releases.keys()) {
        if (this.conversationRetirements.get(conversationKey) === retirement) this.conversationRetirements.delete(conversationKey);
      }
    });
  }

  find(key: string): ChatGptTurnSession | undefined {
    const session = this.entries.get(key);
    session?.touch();
    return session;
  }

  findConversationHead(conversationKey: string): ChatGptTurnSession | undefined {
    const session = this.conversationHeads.get(conversationKey);
    session?.touch();
    return session;
  }

  /** Wait for acknowledgement, retrying any retained release obligation from an earlier failure. */
  async waitForConversationRetirement(conversationKey: string, signal?: AbortSignal): Promise<void> {
    const obligation = this.retainedReleases.get(conversationKey);
    if (obligation) {
      await awaitWithAbort(this.closeConversationAndWait(conversationKey, obligation.preserved), signal);
      return;
    }
    const pending = this.conversationRetirements.get(conversationKey);
    if (pending) await awaitWithAbort(pending, signal);
  }

  async retireConversationAndWait(conversationKey: string): Promise<number> {
    return this.closeConversationAndWait(conversationKey);
  }

  /**
   * Close the physical retained-chat epoch without discarding a terminal response that won the
   * compaction race before any compaction instruction reached that response. The detached logical
   * session remains addressable by its exact Responses execution key, so the post-compaction
   * native round can consume the already-committed answer instead of opening another browser turn.
   */
  async retireConversationPreservingFinalResponse(
    conversationKey: string,
    preserved: ChatGptTurnSession,
    preservedExecutionKey: string,
  ): Promise<number> {
    if (!preservedExecutionKey) throw new Error("Preserved ChatGPT response execution key is required");
    const outcome = preserved.settledOutcome();
    if (!outcome || outcome.type !== "final") {
      throw new Error("Only a settled final ChatGPT response can survive retained-conversation retirement");
    }
    return this.closeConversationAndWait(conversationKey, {
      session: preserved,
      executionKey: preservedExecutionKey,
    });
  }

  private async closeConversationAndWait(
    conversationKey: string,
    preserved?: { session: ChatGptTurnSession; executionKey: string },
  ): Promise<number> {
    const inFlight = this.conversationRetirements.get(conversationKey);
    if (inFlight) {
      const pendingObligation = this.retainedReleases.get(conversationKey);
      if (preserved && pendingObligation) {
        if (pendingObligation.preserved && (pendingObligation.preserved.session !== preserved.session
          || pendingObligation.preserved.executionKey !== preserved.executionKey)) {
          throw new Error("ChatGPT retained-conversation preservation changed during release retry");
        }
        if (!pendingObligation.matches.some(([, session]) => session === preserved.session)) {
          throw new Error("The final ChatGPT response does not own the retained conversation being retired");
        }
        const target = this.entries.get(preserved.executionKey);
        if (target && target !== preserved.session) {
          throw new Error("The compacted ChatGPT response execution key is already owned by another session");
        }
        pendingObligation.preserved = preserved;
      }
      await inFlight;
      const obligation = this.retainedReleases.get(conversationKey);
      if (obligation) return this.closeConversationAndWait(conversationKey, obligation.preserved);
      return 0;
    }
    let obligation = this.retainedReleases.get(conversationKey);
    if (obligation) {
      if (preserved && (obligation.preserved?.session !== preserved.session
        || obligation.preserved.executionKey !== preserved.executionKey)) {
        throw new Error("ChatGPT retained-conversation preservation changed during release retry");
      }
    } else {
      const matches = [...this.entries].filter(([, session]) => session.conversationKey() === conversationKey);
      if (matches.length === 0) return 0;
      if (preserved && !matches.some(([, session]) => session === preserved.session)) {
        throw new Error("The final ChatGPT response does not own the retained conversation being retired");
      }
      const target = preserved ? this.entries.get(preserved.executionKey) : undefined;
      if (target && target !== preserved?.session) {
        throw new Error("The compacted ChatGPT response execution key is already owned by another session");
      }
      const release = matches.findLast(([, session]) => (
        session.runtime.releaseRetainedConversation !== undefined
      ))?.[1].runtime.releaseRetainedConversation;
      obligation = {
        matches,
        ...(preserved ? { preserved } : {}),
        ...(release ? { release } : {}),
      };
      // Keep entries and conversation keys attached until Launcher acknowledges release. A failed
      // close remains discoverable by compaction cleanup and by the next owner turn.
      this.retainedReleases.set(conversationKey, obligation);
      for (const [, session] of matches) if (session.isActive()) session.cancel();
    }
    const releaseObligation = obligation;
    const retirement = Promise.allSettled(releaseObligation.matches.map(([, session]) => session.physicalSettlement))
      .then(async () => {
        // A failed turn-level settlement must not prevent the separate Launcher release attempt.
        // Without its callback, turn settlement cannot acknowledge retained-conversation release.
        if (!releaseObligation.release) throw new Error("ChatGPT retained conversation has no Launcher release callback");
        await releaseObligation.release();
        if (releaseObligation.matches.some(([, session]) => session.conversationKey() !== conversationKey)) {
          throw new Error("ChatGPT retained-conversation ownership changed during retirement");
        }
        const preservedTarget = releaseObligation.preserved
          ? this.entries.get(releaseObligation.preserved.executionKey) : undefined;
        if (preservedTarget && preservedTarget !== releaseObligation.preserved?.session) {
          throw new Error("The compacted ChatGPT response execution key was replaced during retirement");
        }
        for (const [key, session] of releaseObligation.matches) {
          session.detachConversation(conversationKey);
          if (this.entries.get(key) === session) this.entries.delete(key);
        }
        const head = this.conversationHeads.get(conversationKey);
        if (head && releaseObligation.matches.some(([, session]) => session === head)) {
          this.conversationHeads.delete(conversationKey);
        }
        if (releaseObligation.preserved) {
          this.entries.set(releaseObligation.preserved.executionKey, releaseObligation.preserved.session);
        }
        this.retainedReleases.delete(conversationKey);
      });
    this.conversationRetirements.set(conversationKey, retirement);
    try {
      await retirement;
    } finally {
      if (this.conversationRetirements.get(conversationKey) === retirement) {
        this.conversationRetirements.delete(conversationKey);
      }
    }
    return releaseObligation.matches.length;
  }

  async waitForRetirement(key: string): Promise<void> {
    await this.retirements.get(key);
  }

  async retireAndWait(key: string, signal?: AbortSignal): Promise<boolean> {
    const pending = this.retirements.get(key);
    if (pending) {
      await awaitWithAbort(pending, signal);
      return true;
    }
    const session = this.entries.get(key);
    if (!session) return false;

    await awaitWithAbort(this.retireSession(key, session), signal);
    return true;
  }

  retire(key: string, session: ChatGptTurnSession): boolean {
    if (this.entries.get(key) !== session) return false;
    this.observeRetirement(this.retireSession(key, session));
    return true;
  }

  /** Cancel only active responses whose exact native turn ids Codex marked as interrupted. */
  retireAbortedOwnerTurns(
    ownerKey: string,
    abortedTurnIds: ReadonlySet<string>,
    keepKey: string,
  ): number {
    const matches = [...this.entries].filter(([key, session]) => (
      key !== keepKey
      && session.ownerKey === ownerKey
      && session.nativeTurnId !== undefined
      && abortedTurnIds.has(session.nativeTurnId)
      && session.isActive()
    ));
    for (const [key, session] of matches) {
      this.observeRetirement(this.retireSession(key, session));
    }
    return matches.length;
  }

  clear(): number {
    const cancelled = this.entries.size;
    const conversations = new Set<string>();
    for (const [key, session] of [...this.entries]) {
      const conversationKey = session.conversationKey();
      if (conversationKey) {
        session.cancel();
        conversations.add(conversationKey);
      } else this.observeRetirement(this.retireSession(key, session));
    }
    // The entries and head remain attached until the release acknowledgement. A failure leaves
    // the exact obligation available to the next owner turn for retry.
    for (const conversationKey of conversations) {
      this.observeRetirement(this.closeConversationAndWait(conversationKey).then(() => undefined));
    }
    return cancelled;
  }

  async cancelTrace(traceId: string, reason = chatGptBrowserTabClosedError()): Promise<number> {
    const sessions = [...this.entries.values()]
      .filter(session => session.traceId === traceId && session.isActive());
    for (const session of sessions) session.cancel(reason);
    await Promise.all(sessions.map(session => session.physicalSettlement));
    return sessions.length;
  }

  /**
   * Begin retiring only the browser execution owned by the exact native Codex turn.
   *
   * Codex runs Interrupt hooks synchronously with a short deadline. The abort is delivered before
   * this method returns; attached ownership stays discoverable until Launcher acknowledges release.
   * Physical cleanup remains represented by `settlement` without blocking the hook acknowledgement.
   */
  cancelNativeTurn(
    threadId: string,
    turnId: string,
    reason: Error,
  ): { cancelled: number; settlement: Promise<void> } {
    const matches = [...this.entries].filter(([, session]) => (
      session.nativeThreadId === threadId
      && session.nativeTurnId === turnId
    ));
    for (const [, session] of matches) session.cancel(reason);
    const settlement = Promise.all(
      matches.map(([key, session]) => this.retireSession(key, session, reason)),
    ).then(() => undefined);
    return { cancelled: matches.length, settlement };
  }

  cancelledError(traceId: string): Error | undefined {
    for (const session of this.entries.values()) {
      if (session.traceId !== traceId) continue;
      if (session.supersededError) return session.supersededError;
      const outcome = session.settledOutcome();
      if (outcome?.type !== "error") continue;
      if ("code" in outcome.error && outcome.error.code === "client_cancelled") return outcome.error;
    }
    return undefined;
  }

  activeCount(): number {
    this.prune();
    let active = 0;
    for (const session of this.entries.values()) if (session.isActive()) active += 1;
    return active;
  }

  private prune(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [key, session] of this.entries) {
      // A browser result can be terminal while its helper still owns the physical surface.
      // Keep that entry addressable so the next owner turn waits for actual cleanup.
      if (session.isActive() || !session.isPhysicallySettled() || session.lastUsedAt() >= cutoff
        || [...this.retainedReleases.values()].some(obligation => obligation.matches.some(([, owned]) => owned === session))) continue;
      const conversationKey = session.conversationKey();
      // A stale round must not evict a newer exact replay in the same retained conversation.
      if (conversationKey && [...this.entries.values()].some(peer => (
        peer !== session && peer.conversationKey() === conversationKey
        && (peer.isActive() || !peer.isPhysicallySettled() || peer.lastUsedAt() >= cutoff)
      ))) continue;
      this.observeRetirement(this.retireSession(key, session));
    }
  }

  /** Every removal of an attached session first establishes an acknowledged, retryable release. */
  private retireSession(key: string, session: ChatGptTurnSession, reason?: Error): Promise<void> {
    const conversationKey = session.conversationKey();
    if (conversationKey) {
      session.cancel(reason);
      return this.closeConversationAndWait(conversationKey).then(() => undefined);
    }
    if (this.entries.get(key) === session) {
      this.entries.delete(key);
      this.forgetConversationHead(session);
    }
    return this.beginRetirement(key, session, reason);
  }

  private observeRetirement(retirement: Promise<void>): void {
    void retirement.catch(error => {
      console.error(`[chatgpt-web] turn retirement failed; attached release remains retryable: ${
        error instanceof Error ? error.message : String(error)
      }`);
    });
  }

  private forgetConversationHead(session: ChatGptTurnSession): void {
    const conversationKey = session.conversationKey();
    if (conversationKey && this.conversationHeads.get(conversationKey) === session) {
      this.conversationHeads.delete(conversationKey);
    }
  }

  private beginRetirement(key: string, session: ChatGptTurnSession, reason?: Error): Promise<void> {
    const existing = this.retirements.get(key);
    if (existing) return existing;
    const conversationKey = session.conversationKey();
    session.cancel(reason);
    const retirement = session.physicalSettlement;
    this.retirements.set(key, retirement);
    void retirement.then(() => {
      if (this.retirements.get(key) === retirement) this.retirements.delete(key);
    });
    if (session.ownerKey) {
      const previous = this.ownerRetirements.get(session.ownerKey);
      const ownerRetirement = previous
        ? Promise.all([previous, retirement]).then(() => undefined)
        : retirement;
      this.ownerRetirements.set(session.ownerKey, ownerRetirement);
      void ownerRetirement.then(() => {
        if (this.ownerRetirements.get(session.ownerKey!) === ownerRetirement) {
          this.ownerRetirements.delete(session.ownerKey!);
        }
      });
    }
    if (conversationKey) {
      const previous = this.conversationRetirements.get(conversationKey);
      const conversationRetirement = previous
        ? Promise.all([previous, retirement]).then(() => undefined)
        : retirement;
      this.conversationRetirements.set(conversationKey, conversationRetirement);
      const forgetConversationRetirement = () => {
        if (this.conversationRetirements.get(conversationKey) === conversationRetirement) {
          this.conversationRetirements.delete(conversationKey);
        }
      };
      void conversationRetirement.then(
        forgetConversationRetirement,
        forgetConversationRetirement,
      );
    }
    return retirement;
  }
}

export const chatGptTurnSessions = new ChatGptTurnSessions();
