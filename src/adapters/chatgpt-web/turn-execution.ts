import { createHash } from "node:crypto";
import type { CodexParsedRequest } from "../../types";
import { ChatGptWebAdapterError, chatGptBrowserTabClosedError, chatGptTurnSupersededError } from "./adapter-error";
import { canRetireDetachedToolDelivery } from "./browser-lifecycle-safety";
import { MAX_CHATGPT_OUTSTANDING_TURNS } from "./concurrency";
import {
  chatGptTurnUserRevisionHistory,
  extractChatGptCompactionSourceRevision,
  extractChatGptTurnIdentity,
  extractChatGptTurnUserRevision,
} from "./environment";
import { CHATGPT_REGISTRY_REPLAY_BYTES, assertByteLimit } from "./resource-budgets";
import type { ChatGptTurnRuntime } from "./turn-feeds";
import { ChatGptTurnSession } from "./turn-session";
export { ChatGptTextFeed, ChatGptTraceFeed, type ChatGptBrowserOutcome, type ChatGptTraceEvent, type ChatGptTurnRuntime } from "./turn-feeds";
export { ChatGptTurnSession } from "./turn-session";

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

function executionKey(parsed: CodexParsedRequest, payload: unknown): string {
  return createHash("sha256").update(JSON.stringify({
    modelId: parsed.modelId,
    reasoning: parsed.options.reasoning,
    ...(parsed._chatgptModelFamily ? { modelFamily: parsed._chatgptModelFamily } : {}),
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
    ...(!parsed._compactionRequest ? { instruction: chatGptInstructionLineage(parsed).current } : {}),
  })).digest("hex");
}

function chatGptStableOwnerIdentity(parsed: CodexParsedRequest): { kind: string; id: string } | undefined {
  const identity = extractChatGptTurnIdentity(parsed);
  return identity.threadId
    ? { kind: "thread", id: identity.threadId }
    : identity.promptCacheKey
      ? { kind: "prompt_cache", id: identity.promptCacheKey }
      : identity.turnId
        ? { kind: "turn", id: identity.turnId }
        : undefined;
}

/** Keep every browser acquisition for one supported logical owner on the same launcher account. */
export function chatGptAccountRoutingKey(parsed: CodexParsedRequest): string {
  const owner = chatGptStableOwnerIdentity(parsed);
  if (!owner) throw new Error("ChatGPT web requires native Codex turn identity metadata for account routing");
  // Preserve the exact key already persisted by the multi-account launcher. Changing existing
  // thread affinity during an upgrade could silently move a retained task to another account.
  if (owner.kind === "thread") {
    return createHash("sha256").update(`account-thread:${owner.id}`).digest("hex");
  }
  return createHash("sha256").update(JSON.stringify({ scope: "account", ...owner })).digest("hex");
}

/** One native Codex thread may own at most one live ChatGPT browser surface. */
export function chatGptThreadOwnershipKey(parsed: CodexParsedRequest): string {
  const owner = chatGptStableOwnerIdentity(parsed);
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

export class ChatGptTurnSessions {
  private readonly entries = new Map<string, ChatGptTurnSession>();
  private readonly detachedToolReapers = new Map<ChatGptTurnSession, { key: string; disconnectedAt: number; activityRevision: number; timer?: ReturnType<typeof setTimeout> }>();
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
    private readonly maxEntries = Math.max(256, MAX_CHATGPT_OUTSTANDING_TURNS),
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
    if (active >= MAX_CHATGPT_OUTSTANDING_TURNS) {
      throw new Error(
        `ChatGPT Web has reached its ${MAX_CHATGPT_OUTSTANDING_TURNS} active and waiting task limit; finish or cancel a task before submitting another`,
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
    void session.browserOutcome.then(outcome => {
      const error = outcome.type === "error" && outcome.error instanceof ChatGptWebAdapterError
        ? outcome.error : undefined;
      console.info(`[chatgpt-web] browser_settled ${JSON.stringify({
        traceId: session.traceId,
        outcome: outcome.type,
        compaction: session.runtime.usageInput?._compactionRequest === true,
        ...(!session.runtime.usageInput?._compactionRequest
          ? { submission: session.runtime.submission?.phase ?? "unknown" } : {}),
        ...(error ? { code: error.code, retryable: error.retryable } : {}),
      })}`);
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

  /** Register even before runExclusive unwinds; the deferred check requires all observers gone. */
  scheduleDetachedToolRetirement(key: string, session: ChatGptTurnSession): void {
    if (this.entries.get(key) !== session || !session.ownerKey
      || !session.nativeThreadId || !session.nativeTurnId || session.runtime.mode !== "tools") return;
    const previous = this.detachedToolReapers.get(session);
    if (previous?.timer) clearTimeout(previous.timer);
    const receipt = { key, disconnectedAt: Date.now(), activityRevision: session.observerActivityRevision(),
      timer: undefined as ReturnType<typeof setTimeout> | undefined };
    const check = (): void => {
      this.reapDetachedToolTurns();
      if (this.detachedToolReapers.get(session) !== receipt) return;
      receipt.timer = setTimeout(check, 60_000);
      receipt.timer.unref?.();
    };
    receipt.timer = setTimeout(check, 30 * 60_000);
    receipt.timer.unref?.();
    this.detachedToolReapers.set(session, receipt);
  }

  /** Residual cleanup of a retired broker, NOT expiry of unanswered tools or approval waits. */
  reapDetachedToolTurns(now = Date.now()): number {
    let retired = 0;
    for (const [session, receipt] of this.detachedToolReapers) {
      const forget = () => {
        if (receipt.timer) clearTimeout(receipt.timer);
        this.detachedToolReapers.delete(session);
      };
      if (this.entries.get(receipt.key) !== session || !session.isActive()
        || session.observerActivityRevision() !== receipt.activityRevision || session.outstandingSince() === undefined) {
        forget();
        continue;
      }
      if (session.hasObservers()) continue;
      const progress = session.runtime.mode === "tools" ? session.runtime.externalProgress : undefined;
      const snapshot = progress?.snapshot();
      let brokerRetired = false;
      // A known valid batch revision only fails this assertion after the exact capability retired.
      // Zero active calls by itself is not enough to establish that ownership transition.
      if (progress && snapshot && snapshot.lastToolBatchRevision > 0 && snapshot.activeToolCalls === 0) {
        try { progress.assertToolBatchActive(snapshot.lastToolBatchRevision); }
        catch { brokerRetired = true; }
      }
      const conversation = session.conversationKey();
      const peerActive = conversation && [...this.entries.values()].some(peer => peer !== session
        && peer.conversationKey() === conversation && (peer.isActive() || !peer.isPhysicallySettled()));
      if (!canRetireDetachedToolDelivery({ exactOwner: this.entries.get(receipt.key) === session,
        brokerRetired, hasObservers: false, activeToolCalls: snapshot?.activeToolCalls,
        peerActive: Boolean(peerActive), disconnectedAt: receipt.disconnectedAt, outstandingSince: session.outstandingSince(),
        lastProgressAt: snapshot?.lastProgressAt, now })) continue;
      forget();
      this.observeRetirement(this.retireSession(receipt.key, session,
        new Error("Disconnected ChatGPT tool delivery belongs to a retired broker capability")));
      retired += 1;
    }
    return retired;
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
    const cancellation = this.beginCancelTrace(traceId, reason);
    await cancellation.settlement;
    return cancellation.cancelled;
  }

  /** Revoke execution now and track physical cleanup separately from the UI receipt. */
  beginCancelTrace(traceId: string, reason: Error): { cancelled: number; settlement: Promise<void> } {
    const sessions = [...this.entries.values()]
      .filter(session => session.traceId === traceId && session.isActive());
    for (const session of sessions) session.cancel(reason);
    return { cancelled: sessions.length, settlement: Promise.all(sessions.map(session => session.physicalSettlement)).then(() => undefined) };
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
    // retireSession delivers cancellation synchronously before returning its cleanup promise.
    // A separate cancel pass would invoke the runtime twice for the same native interruption.
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
    const receipt = this.detachedToolReapers.get(session);
    if (receipt?.timer) clearTimeout(receipt.timer);
    this.detachedToolReapers.delete(session);
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
