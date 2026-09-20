import { randomUUID } from "node:crypto";
import { readLauncherBrowserHostDescriptor } from "./launcher-browser-host";

export type NativeUsageOutcome = "completed" | "incomplete" | "failed" | "aborted";
export type NativeUsageFailureCategory = "http-auth" | "http-rate-limit" | "http-client"
  | "http-server" | "transport" | "stream" | "protocol" | "aborted";

export interface NativeReportedUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens?: number;
  reasoningOutputTokens?: number;
}

export interface NativeUsageTelemetryEvent {
  schemaVersion: 1;
  eventId: string;
  source: "native";
  endpoint: "responses" | "responses/compact";
  requestedModelId: string | null;
  reportedModelId: string | null;
  startedAt: string;
  durationMs: number;
  outcome: NativeUsageOutcome;
  /** Upstream HTTP status, or 0 when transport/abort ended before any response. */
  httpStatus: number;
  failureCategory: NativeUsageFailureCategory | null;
  usageStatus: "reported" | "unreported";
  usage: NativeReportedUsage | null;
}

const MAX_NATIVE_USAGE_QUEUE = 16;
const DELIVERY_TIMEOUT_MS = 1_000;
const RETRY_DELAYS_MS = [250, 1_000, 4_000] as const;
interface NativeUsageQueueEntry { event: NativeUsageTelemetryEvent; attempt: number; }
const queue: NativeUsageQueueEntry[] = [];
let delivering = false;
let scheduledRetries = 0;

function descriptorPath(): string | undefined {
  const path = process.env.CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR?.trim();
  return path || undefined;
}

async function deliver(event: NativeUsageTelemetryEvent): Promise<void> {
  const path = descriptorPath();
  if (!path) throw new Error("Native usage receiver descriptor is unavailable");
  const descriptor = readLauncherBrowserHostDescriptor(path);
  const response = await fetch(`${descriptor.control.endpoint}/v1/usage/native`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${descriptor.control.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    redirect: "error",
    proxy: "",
  });
  if (!response.ok) throw new Error(`Native usage receiver returned HTTP ${response.status}`);
  void response.body?.cancel().catch(() => {});
}

function reportDrop(reason: "capacity" | "delivery"): void {
  console.warn(`[codex-chatgpt-web] native_usage_telemetry_dropped reason=${reason}`);
}

function enqueueEntry(entry: NativeUsageQueueEntry): void {
  if (queue.length + scheduledRetries >= MAX_NATIVE_USAGE_QUEUE) {
    if (queue.length > 0) queue.shift();
    else {
      reportDrop("capacity");
      return;
    }
    reportDrop("capacity");
  }
  queue.push(entry);
  queueMicrotask(() => { void drain(); });
}

function retry(entry: NativeUsageQueueEntry): boolean {
  const delay = RETRY_DELAYS_MS[entry.attempt];
  if (delay === undefined || queue.length + scheduledRetries >= MAX_NATIVE_USAGE_QUEUE) return false;
  scheduledRetries += 1;
  const timer = setTimeout(() => {
    scheduledRetries -= 1;
    enqueueEntry({ event: entry.event, attempt: entry.attempt + 1 });
  }, delay);
  (timer as unknown as { unref?: () => void }).unref?.();
  return true;
}

async function drain(): Promise<void> {
  if (delivering) return;
  delivering = true;
  try {
    while (queue.length > 0) {
      const entry = queue.shift()!;
      try {
        await deliver(entry.event);
      } catch {
        // Statistics remain a bounded best-effort side channel. Retries retain the event id so
        // an ambiguous receiver acknowledgement remains safe under UsageStore deduplication.
        if (!retry(entry)) reportDrop("delivery");
      }
    }
  } finally {
    delivering = false;
    if (queue.length > 0) queueMicrotask(() => { void drain(); });
  }
}

export function enqueueNativeUsageTelemetry(
  event: Omit<NativeUsageTelemetryEvent, "schemaVersion" | "eventId" | "source">,
): void {
  const complete: NativeUsageTelemetryEvent = {
    schemaVersion: 1,
    eventId: randomUUID(),
    source: "native",
    ...event,
  };
  enqueueEntry({ event: complete, attempt: 0 });
}
