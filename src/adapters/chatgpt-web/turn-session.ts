import type { AdapterEvent } from "../../types";
import { CHATGPT_REPLAY_BYTES, ChatGptResourceLimitError, assertByteLimit, retainedRecordBytes } from "./resource-budgets";
import type { BrokerToolRequest } from "./turn-broker";
import type { ChatGptBrowserOutcome, ChatGptTurnRuntime } from "./turn-feeds";

export class ChatGptTurnSession {
  supersededError?: Error;
  readonly createdAt = Date.now();
  private lastTouchedAt = this.createdAt;
  private observers = 0;
  private activityRevision = 0;
  private outstandingStartedAt?: number;
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
    this.observers += 1;
    const run = this.tail.then(task).finally(() => { this.observers -= 1; });
    this.tail = run.then(() => undefined, () => undefined);
    this.scheduleCapabilityRetirement();
    return run;
  }

  touch(): void {
    this.activityRevision += 1;
    this.lastTouchedAt = Date.now();
  }

  lastUsedAt(): number {
    return this.lastTouchedAt;
  }

  hasObservers(): boolean { return this.observers > 0; }

  observerActivityRevision(): number { return this.activityRevision; }

  outstandingSince(): number | undefined { return this.outstandingStartedAt; }

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
    this.outstandingStartedAt = requests.length ? Date.now() : undefined;
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
    if (this.outstandingById.size === 0) this.outstandingStartedAt = undefined;
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
