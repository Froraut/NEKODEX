import { abortReason, withCompactionAbort } from "./compaction-lifecycle";

interface CachedCompactionRun {
  createdAt: number;
  ownerKey: string;
  traceIds: ReadonlySet<string>;
  nativeThreadId?: string;
  nativeTurnId?: string;
  abort: AbortController;
  active: boolean;
  promise: Promise<string>;
  settlement: Promise<void>;
}

interface StructuredCompactionInterruption {
  createdAt: number;
  reason: Error;
}

export interface StructuredCompactionOwner {
  ownerKey: string;
  /** Every externally addressable browser trace owned by this structured compaction. */
  traceIds: readonly string[];
  /** Exact native Codex owner, when supplied by the current Responses request. */
  nativeThreadId?: string;
  nativeTurnId?: string;
}

/** Isolated compaction ownership and replay state; the default facade remains process-local. */
export function createCompactionRunRegistry(now: () => number = () => Date.now()) {
  const structuredCompactionRuns = new Map<string, CachedCompactionRun>();
  const structuredCompactionOwners = new Map<string, Promise<void>>();
  const structuredCompactionInterruptions = new Map<string, StructuredCompactionInterruption>();
  const STRUCTURED_COMPACTION_RUN_TTL_MS = 30 * 60_000;

  /** Includes detached owners until their physical browser/helper cleanup has settled. */
  function activeStructuredCompactionCount(): number {
    let active = 0;
    for (const run of structuredCompactionRuns.values()) if (run.active) active += 1;
    return active;
  }

  function nativeTurnIdentityKey(threadId: string, turnId: string): string {
    if (!threadId.trim() || !turnId.trim()) {
      throw new Error("Structured compaction requires non-empty native thread and turn ids");
    }
    return JSON.stringify([threadId, turnId]);
  }

  function rememberStructuredCompactionInterruption(threadId: string, turnId: string, reason: Error): void {
    const identity = nativeTurnIdentityKey(threadId, turnId);
    const timestamp = now();
    pruneStructuredCompactionInterruptions(timestamp);
    const existing = structuredCompactionInterruptions.get(identity);
    if (existing) {
      existing.createdAt = timestamp;
      return;
    }
    structuredCompactionInterruptions.set(identity, { createdAt: timestamp, reason });
  }

  function structuredCompactionInterruption(owner: StructuredCompactionOwner): Error | undefined {
    if (owner.nativeThreadId === undefined && owner.nativeTurnId === undefined) return undefined;
    pruneStructuredCompactionInterruptions();
    return structuredCompactionInterruptions.get(
      nativeTurnIdentityKey(owner.nativeThreadId ?? "", owner.nativeTurnId ?? ""),
    )?.reason;
  }

  function pruneStructuredCompactionInterruptions(timestamp = now()): void {
    const cutoff = timestamp - STRUCTURED_COMPACTION_RUN_TTL_MS;
    for (const [identity, interruption] of structuredCompactionInterruptions) {
      if (interruption.createdAt < cutoff) structuredCompactionInterruptions.delete(identity);
    }
  }

  function pruneStructuredCompactionRuns(): void {
    const timestamp = now();
    const cutoff = timestamp - STRUCTURED_COMPACTION_RUN_TTL_MS;
    for (const [candidate, run] of structuredCompactionRuns) {
      if (!run.active && run.createdAt < cutoff) structuredCompactionRuns.delete(candidate);
    }
    pruneStructuredCompactionInterruptions(timestamp);
  }

  function replayRejection(owner: StructuredCompactionOwner, run?: CachedCompactionRun): Error | undefined {
    return structuredCompactionInterruption(owner)
      ?? (run?.abort.signal.aborted ? abortReason(run.abort.signal) : undefined);
  }

  /** Return the canonical result of an exact compact request unless its native turn was interrupted. */
  function existingStructuredCompactionRun(
    key: string,
    owner: StructuredCompactionOwner,
  ): Promise<string> | undefined {
    pruneStructuredCompactionRuns();
    const existing = structuredCompactionRuns.get(key);
    if (!existing) return undefined;
    const rejection = replayRejection(owner, existing);
    if (rejection) return Promise.reject(rejection);
    return existing.promise;
  }

  /** Recheck after an awaited summary resolves, before publishing it to the native turn. */
  function assertStructuredCompactionNotInterrupted(
    key: string,
    owner: StructuredCompactionOwner,
  ): void {
    const rejection = replayRejection(owner, structuredCompactionRuns.get(key));
    if (rejection) throw rejection;
  }

  function runStructuredCompactionOnce(
    key: string,
    owner: StructuredCompactionOwner,
    start: (operatorSignal: AbortSignal, retainOwnershipUntil: (settlement: Promise<void>) => void) => Promise<string>,
  ): Promise<string> {
    pruneStructuredCompactionRuns();
    // Interruption outlives any settled successful run started before it: both retain for 30
    // minutes, measured from registration and cancellation respectively.
    const existing = structuredCompactionRuns.get(key);
    const rejection = replayRejection(owner, existing);
    if (rejection) return Promise.reject(rejection);
    if (existing) return existing.promise;
    const abort = new AbortController();
    const previousOwner = structuredCompactionOwners.get(owner.ownerKey);
    const physicalSettlements: Promise<void>[] = previousOwner ? [previousOwner] : [];
    const promise = Promise.resolve().then(async () => {
      if (previousOwner) await withCompactionAbort(previousOwner, abort.signal);
      if (abort.signal.aborted) throw abortReason(abort.signal);
      return start(abort.signal, settlement => { physicalSettlements.push(settlement); });
    });
    // Return a deadline failure promptly, while its physical browser owner still blocks retries
    // and cancel-all completion. A cancelled queued run must also retain its predecessor's gate.
    const ownerSettlement = promise.then(() => undefined, () => undefined).then(async () => {
      await Promise.allSettled(physicalSettlements);
      run.active = false;
      if (structuredCompactionOwners.get(owner.ownerKey) === ownerSettlement) {
        structuredCompactionOwners.delete(owner.ownerKey);
      }
      // Cleanup releases physical ownership, not the exact request's submission history.
      // Retain rejected promises under the same TTL as successes: an ambiguous post-Send
      // failure must replay its error instead of starting another browser submission.
    });
    const run: CachedCompactionRun = {
      createdAt: now(),
      ownerKey: owner.ownerKey,
      traceIds: new Set(owner.traceIds),
      ...(owner.nativeThreadId ? { nativeThreadId: owner.nativeThreadId } : {}),
      ...(owner.nativeTurnId ? { nativeTurnId: owner.nativeTurnId } : {}),
      abort,
      active: true,
      promise,
      settlement: ownerSettlement,
    };
    structuredCompactionRuns.set(key, run);
    structuredCompactionOwners.set(owner.ownerKey, ownerSettlement);
    return promise;
  }

  function beginCancellation(
    matches: (run: CachedCompactionRun) => boolean,
    reason: Error,
  ): { cancelled: number; settlement: Promise<void> } {
    const runs = [...structuredCompactionRuns.values()].filter(run => run.active && matches(run));
    for (const run of runs) if (!run.abort.signal.aborted) run.abort.abort(reason);
    return {
      cancelled: runs.length,
      settlement: Promise.allSettled(runs.map(run => run.settlement)).then(() => undefined),
    };
  }

  async function cancelStructuredCompactionRuns(
    matches: (run: CachedCompactionRun) => boolean,
    reason: Error,
  ): Promise<number> {
    const { cancelled, settlement } = beginCancellation(matches, reason);
    await settlement;
    return cancelled;
  }

  /** Begin cancelling the structured compaction owned by one exact native Codex turn. */
  function cancelStructuredCompactionNativeTurn(
    threadId: string,
    turnId: string,
    reason: Error,
  ): { cancelled: number; settlement: Promise<void> } {
    // Record before scanning active owners. Registration and cancellation share this synchronous
    // boundary, so either registration wins and is aborted below, or interruption wins and the later
    // registration rejects without invoking its detached work.
    rememberStructuredCompactionInterruption(threadId, turnId, reason);
    return beginCancellation(
      run => run.nativeThreadId === threadId && run.nativeTurnId === turnId,
      reason,
    );
  }

  /** Cancel a user-requested compaction without treating an HTTP observer disconnect as terminal. */
  function cancelStructuredCompactionTrace(traceId: string, reason: Error): Promise<number> {
    return cancelStructuredCompactionRuns(run => run.traceIds.has(traceId), reason);
  }

  function beginCancelStructuredCompactionTrace(traceId: string, reason: Error): { cancelled: number; settlement: Promise<void> } {
    return beginCancellation(run => run.traceIds.has(traceId), reason);
  }

  /** Cancel every active compaction owner and wait for its browser/helper cleanup. */
  function cancelAllStructuredCompactions(reason: Error): Promise<number> {
    return cancelStructuredCompactionRuns(() => true, reason);
  }
  return { activeStructuredCompactionCount, existingStructuredCompactionRun, assertStructuredCompactionNotInterrupted, runStructuredCompactionOnce, cancelStructuredCompactionNativeTurn, beginCancelStructuredCompactionTrace, cancelStructuredCompactionTrace, cancelAllStructuredCompactions };
}

export const { activeStructuredCompactionCount, existingStructuredCompactionRun, assertStructuredCompactionNotInterrupted, runStructuredCompactionOnce, cancelStructuredCompactionNativeTurn, beginCancelStructuredCompactionTrace, cancelStructuredCompactionTrace, cancelAllStructuredCompactions } = createCompactionRunRegistry();
