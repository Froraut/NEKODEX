import { chatGptExternalProgressIsLive, type ChatGptExternalTurnProgressSnapshot } from "./turn-progress";

export const CHATGPT_RESPONSE_DOM_GRACE_MS = 60_000;
/**
 * How long a staged Bigger Context part may take to produce its assistant turn. A staged part is two
 * orders of magnitude larger than an ordinary prompt and ChatGPT reads all of it before answering.
 * No MCP activity exists while that inert part is being ingested, so the response grace matches
 * the bounded staged-send budget.
 */
export const CHATGPT_MULTIPART_RESPONSE_DOM_GRACE_MS = 180_000;
export const CHATGPT_EMPTY_RESPONSE_GRACE_MS = 10_000;
export const CHATGPT_COMPLETION_ACTION_GRACE_MS = 60_000;
export const CHATGPT_COMPLETION_SETTLE_MS = 2_000;
export function chatGptTurnIsComplete(state: {
  responsePresent: boolean;
  running: boolean;
  currentText: string;
  currentHtml?: string;
  completionActionVisible: boolean;
}): boolean {
  return state.responsePresent
    && !state.running
    && state.currentText.length > 0
    && state.completionActionVisible;
}

export class ChatGptCompletionTracker {
  private candidate?: { signature: string; since: number };
  private lastToolBatchRevision = 0;
  private postToolAnswerBaselineText?: string;
  private missingPostToolAnswerSince?: number;

  constructor(
    private readonly stableMs = CHATGPT_COMPLETION_SETTLE_MS,
    private readonly missingPostToolAnswerMs = CHATGPT_COMPLETION_ACTION_GRACE_MS,
  ) {}

  needsToolBatchObservation(revision: number): boolean {
    if (!Number.isSafeInteger(revision) || revision < this.lastToolBatchRevision) {
      throw new Error("ChatGPT completion received an invalid tool-batch revision");
    }
    return revision > this.lastToolBatchRevision;
  }

  observeToolBatch(revision: number, currentText: string): boolean {
    if (!this.needsToolBatchObservation(revision)) return false;
    // The caller acknowledges the batch only after this projection is captured. The outer Codex
    // harness therefore cannot execute the tool until this exact pre-tool answer boundary exists.
    this.postToolAnswerBaselineText = currentText;
    this.lastToolBatchRevision = revision;
    this.missingPostToolAnswerSince = undefined;
    this.candidate = undefined;
    return true;
  }

  update(
    state: Parameters<typeof chatGptTurnIsComplete>[0] & {
      externalToolCallsInFlight?: boolean;
    },
    now = Date.now(),
  ): boolean {
    const signature = `${state.currentText}\0${state.currentHtml ?? state.currentText}`;
    // An outstanding tool call proves the model has more to say, whatever the rendered message
    // currently looks like. Completing here would return a truncated answer and retire the turn
    // while its own tool calls were still in flight.
    if (state.externalToolCallsInFlight) {
      this.candidate = undefined;
      this.missingPostToolAnswerSince = undefined;
      return false;
    }
    if (this.postToolAnswerBaselineText === state.currentText) {
      this.candidate = undefined;
      if (!chatGptTurnIsComplete(state)) {
        this.missingPostToolAnswerSince = undefined;
        return false;
      }
      this.missingPostToolAnswerSince ??= now;
      if (now - this.missingPostToolAnswerSince >= this.missingPostToolAnswerMs) {
        throw new Error("ChatGPT completed without producing a final answer after its last Codex tool call");
      }
      return false;
    }
    this.missingPostToolAnswerSince = undefined;
    if (!chatGptTurnIsComplete(state)) {
      this.candidate = undefined;
      return false;
    }
    if (this.candidate?.signature !== signature) {
      this.candidate = { signature, since: now };
      return false;
    }
    return now - this.candidate.since >= this.stableMs;
  }
}

export class ChatGptTurnDomHealthTracker {
  private sawResponse = false;
  private missingResponseSince?: number;
  private emptyCompletionSince?: number;
  private missingCompletionAction?: { text: string; since: number };

  constructor(
    private readonly missingResponseMs = CHATGPT_RESPONSE_DOM_GRACE_MS,
    private readonly emptyCompletionMs = CHATGPT_EMPTY_RESPONSE_GRACE_MS,
    private readonly missingCompletionActionMs = CHATGPT_COMPLETION_ACTION_GRACE_MS,
  ) {}

  /** Clear only missing-response history; use suspendForLiveProgress for live work. */
  clearMissingResponse(): void {
    this.missingResponseSince = undefined;
  }

  /** Suspend every terminal grace window while external work is proven live. */
  suspendForLiveProgress(): void {
    this.missingResponseSince = undefined;
    this.emptyCompletionSince = undefined;
    this.missingCompletionAction = undefined;
  }

  update(state: {
    responsePresent: boolean;
    running: boolean;
    currentText: string;
    completionActionVisible: boolean;
    externalProgressLive?: boolean;
  }, now = Date.now()): string | undefined {
    if (state.responsePresent) this.sawResponse = true;
    if (state.externalProgressLive) {
      // Every conclusion below asserts that ChatGPT stopped producing this turn. A tool call that
      // is still completing disproves all of them, whatever the renderer is currently exposing, so
      // no window may accrue while the model is provably working.
      this.suspendForLiveProgress();
      return undefined;
    }
    if (state.responsePresent) {
      this.missingResponseSince = undefined;
    } else {
      this.missingResponseSince ??= now;
      if (now - this.missingResponseSince >= this.missingResponseMs) {
        return this.sawResponse
          ? "ChatGPT response DOM disappeared while the browser turn was active"
          : "ChatGPT did not create a response DOM after the message was sent";
      }
    }

    const emptyCompletion = state.responsePresent
      && !state.running
      && state.currentText.length === 0
      && state.completionActionVisible;
    if (!emptyCompletion) {
      this.emptyCompletionSince = undefined;
    } else {
      this.emptyCompletionSince ??= now;
      if (now - this.emptyCompletionSince >= this.emptyCompletionMs) {
        return "ChatGPT browser turn completed without a final answer";
      }
    }

    const missingCompletionAction = state.responsePresent
      && !state.running
      && state.currentText.length > 0
      && !state.completionActionVisible;
    if (!missingCompletionAction) {
      this.missingCompletionAction = undefined;
    } else if (this.missingCompletionAction?.text !== state.currentText) {
      this.missingCompletionAction = { text: state.currentText, since: now };
    } else if (now - this.missingCompletionAction.since >= this.missingCompletionActionMs) {
      return "ChatGPT stopped generating but did not expose its completed-turn action; the ChatGPT DOM may have changed";
    }
    return undefined;
  }
}

/**
 * How stale recorded MCP progress may be and still suppress DOM health checks.
 *
 * An outstanding tool call reports liveness regardless of age, so a call that never returns would
 * otherwise hold a turn open forever — turns carry no deadline unless a caller supplies one. This
 * bounds the silence since the last recorded activity rather than the turn's total duration, so a
 * long turn that keeps calling tools is never penalised for taking a long time.
 */
export const CHATGPT_EXTERNAL_PROGRESS_STALL_CEILING_MS = 10 * 60_000;

/** Tolerated clock difference between the recording daemon and the observing helper process. */
export const CHATGPT_EXTERNAL_PROGRESS_CLOCK_SKEW_MS = 5_000;

/** Proven MCP activity, additionally required to be recent enough to still be evidence. */
export function chatGptExternalProgressSuppressesDomHealth(
  snapshot: ChatGptExternalTurnProgressSnapshot | undefined,
  now: number,
): boolean {
  if (!chatGptExternalProgressIsLive(snapshot, now, CHATGPT_RESPONSE_DOM_GRACE_MS)) return false;
  const lastProgressAt = snapshot?.lastProgressAt;
  if (lastProgressAt === undefined) return false;
  const age = now - lastProgressAt;
  // A timestamp from the future would keep `age` below the ceiling forever. Recorded activity can
  // only precede the observation, so anything meaningfully ahead of now is not evidence at all.
  return age >= -CHATGPT_EXTERNAL_PROGRESS_CLOCK_SKEW_MS
    && age < CHATGPT_EXTERNAL_PROGRESS_STALL_CEILING_MS;
}
