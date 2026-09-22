import type { CodexParsedRequest } from "../../types";
import { CHATGPT_TEXT_BUFFER_BYTES, CHATGPT_TRACE_BUFFER_BYTES, assertByteLimit, retainedRecordBytes } from "./resource-budgets";
import type { ChatGptExternalTurnProgress } from "./turn-progress";

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
