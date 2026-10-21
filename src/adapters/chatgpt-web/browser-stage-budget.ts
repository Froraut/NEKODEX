import { ChatGptPersistentBrowserStateError } from "./browser-personalization";

/**
 * Detects that this process was suspended (system sleep) by watching for gaps in a steady tick.
 * On Apple Silicon the monotonic clock keeps advancing through sleep, so elapsed time alone cannot
 * distinguish "the stage really took 15 minutes" from "the machine slept for 14 of them" — and a
 * stage budget charged for slept time cancels turns that never got their budget awake.
 */
export class ChatGptSuspensionClock {
  private readonly tickIntervalMs = 1_000;
  private readonly gapThresholdMs = 5_000;
  private suspendedTotalMs = 0;
  private lastTickAt = Date.now();
  private timer: ReturnType<typeof setInterval> | undefined;

  start(): void {
    if (this.timer) return;
    this.lastTickAt = Date.now();
    this.timer = setInterval(() => this.tick(Date.now()), this.tickIntervalMs);
    this.timer.unref?.();
  }

  private tick(now: number): void {
    const gap = now - this.lastTickAt;
    this.lastTickAt = now;
    if (gap >= this.gapThresholdMs) this.suspendedTotalMs += gap - this.tickIntervalMs;
  }

  suspendedMs(): number {
    // A deadline timer can fire right after wake-up, before the next tick records the gap.
    if (this.timer) this.tick(Date.now());
    return this.suspendedTotalMs;
  }
}

export const chatGptSuspensionClock = new ChatGptSuspensionClock();

/**
 * How much of a stage budget remains once slept time is refunded. Zero means the stage really
 * consumed its budget while awake and the timeout stands.
 */
export function remainingStageBudgetMs(
  timeoutMs: number,
  elapsedMs: number,
  suspendedMs: number,
): number {
  const awakeMs = elapsedMs - suspendedMs;
  if (awakeMs >= timeoutMs) return 0;
  return Math.max(250, timeoutMs - awakeMs);
}

export interface SuspensionAwareDeadline {
  /** Starts, or restarts after progress, a full awake budget. */
  arm(): void;
  clear(): void;
}

/**
 * A resettable deadline that refunds system sleep like runBrowserStage does. Used where a plain
 * setTimeout would expire a long handoff merely because the laptop slept (upstream #863).
 */
export function suspensionAwareDeadline(
  timeoutMs: number,
  onExpire: () => void,
  clock: Pick<ChatGptSuspensionClock, "start" | "suspendedMs"> = chatGptSuspensionClock,
  now: () => number = () => performance.now(),
): SuspensionAwareDeadline {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  const clear = (): void => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  return {
    arm(): void {
      if (expired) return;
      clear();
      clock.start();
      const startedAt = now();
      const suspendedAtStart = clock.suspendedMs();
      const fireOrRearm = (): void => {
        const remaining = remainingStageBudgetMs(timeoutMs, now() - startedAt, clock.suspendedMs() - suspendedAtStart);
        if (remaining > 0) {
          timer = setTimeout(fireOrRearm, remaining);
          timer.unref?.();
          return;
        }
        timer = undefined;
        expired = true;
        onExpire();
      };
      timer = setTimeout(fireOrRearm, timeoutMs);
      timer.unref?.();
    },
    clear,
  };
}

export async function runBrowserStage<T>(
  traceId: string,
  stage: string,
  timeoutMs: number,
  action: (abortSignal: AbortSignal) => Promise<T>,
  awaitAbortedActionSettlement = false,
): Promise<T> {
  chatGptSuspensionClock.start();
  const startedAt = performance.now();
  const suspendedAtStart = chatGptSuspensionClock.suspendedMs();
  console.info(`[chatgpt-web] browser turn ${traceId} stage=${stage} started`);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stageTimedOut = false;
  let actionPromise: Promise<T> | undefined;
  try {
    const timeout = new Promise<never>((_, rejectTimeout) => {
      const fireOrRearm = () => {
        // A stage that spans a system sleep has not consumed its budget: the browser was as
        // frozen as this process, so slept time is refunded before the timer is re-armed.
        const suspendedMs = chatGptSuspensionClock.suspendedMs() - suspendedAtStart;
        const remaining = remainingStageBudgetMs(timeoutMs, performance.now() - startedAt, suspendedMs);
        if (remaining > 0) {
          timer = setTimeout(fireOrRearm, remaining);
          return;
        }
        stageTimedOut = true;
        controller.abort();
        rejectTimeout(new Error(`ChatGPT browser stage timed out: ${stage}`));
      };
      timer = setTimeout(fireOrRearm, timeoutMs);
    });
    actionPromise = action(controller.signal);
    const value = await Promise.race([actionPromise, timeout]);
    console.info(`[chatgpt-web] browser turn ${traceId} stage=${stage} completed durationMs=${Math.round(performance.now() - startedAt)}`);
    return value;
  } catch (error) {
    let surfacedError = error;
    if (stageTimedOut && awaitAbortedActionSettlement && actionPromise) {
      try {
        await actionPromise;
      } catch (settlementError) {
        if (settlementError instanceof ChatGptPersistentBrowserStateError) {
          surfacedError = settlementError;
        }
      }
    }
    console.error(`[chatgpt-web] browser turn ${traceId} stage=${stage} failed durationMs=${Math.round(performance.now() - startedAt)}: ${surfacedError instanceof Error ? surfacedError.message : String(surfacedError)}`);
    throw surfacedError;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
