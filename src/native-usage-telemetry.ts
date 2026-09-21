import { dirname, join } from "node:path";
import { NativeUsageOutbox } from "./native-usage-outbox";
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

const DELIVERY_TIMEOUT_MS = 1_000;
let outbox: NativeUsageOutbox | undefined;
let delivering = false;
let retryTimer: ReturnType<typeof setInterval> | undefined;

export function startNativeUsageDelivery(): void {
  if (retryTimer || !descriptorPath()) return;
  try { outbox = new NativeUsageOutbox(join(dirname(descriptorPath()!), "native-usage-outbox")); }
  catch { console.warn("[codex-chatgpt-web] native_usage_outbox_unavailable"); return; }
  retryTimer = setInterval(() => { void drain(); }, 10_000);
  retryTimer.unref();
  void drain();
}

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
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Native usage receiver returned HTTP ${response.status}`);
  }
  const receipt = await response.json() as { recorded?: boolean; duplicate?: boolean };
  if (receipt.recorded !== true && receipt.duplicate !== true) throw new Error("Native usage was not persisted");
}

async function drain(): Promise<void> {
  if (delivering || !outbox) return;
  delivering = true;
  try {
    for (const event of outbox.pending()) {
      try { await deliver(event); outbox.acknowledge(event.eventId); }
      catch { break; } // Keep the exact event id until the receiver confirms durable acceptance.
    }
  } catch { console.warn("[codex-chatgpt-web] native_usage_outbox_unavailable"); }
  finally { delivering = false; }
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
  startNativeUsageDelivery();
  try {
    if (!outbox) throw new Error("No durable receiver");
    outbox.put(complete);
    void drain();
  } catch { console.warn("[codex-chatgpt-web] native_usage_telemetry_dropped reason=storage"); }
}
