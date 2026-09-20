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
const queue: NativeUsageTelemetryEvent[] = [];
let delivering = false;

function descriptorPath(): string | undefined {
  const path = process.env.CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR?.trim();
  return path || undefined;
}

async function deliver(event: NativeUsageTelemetryEvent): Promise<void> {
  const path = descriptorPath();
  if (!path) return;
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

async function drain(): Promise<void> {
  if (delivering) return;
  delivering = true;
  try {
    while (queue.length > 0) {
      const event = queue.shift()!;
      try {
        await deliver(event);
      } catch {
        // Statistics are a best-effort side channel. Drop this bounded event and continue; a
        // missing launcher or receiver must never delay, fail, or reroute the native response.
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
  if (queue.length >= MAX_NATIVE_USAGE_QUEUE) queue.shift();
  queue.push(complete);
  queueMicrotask(() => { void drain(); });
}
