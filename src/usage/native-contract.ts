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

export function safeNativeModelId(value: unknown): string | null {
  return typeof value === "string"
    && value.length <= 128
    && /^[A-Za-z0-9][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9][A-Za-z0-9_.-]*)*$/.test(value)
    ? value
    : null;
}

/** Normalized runtime token constraints, independent of provider field spelling. */
export function validNativeReportedUsage(value: unknown): value is NativeReportedUsage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const usage = value as Record<string, unknown>;
  const count = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n <= 1_000_000_000;
  if (!["inputTokens", "outputTokens", "totalTokens"].every(key => Object.hasOwn(usage, key))) return false;
  if (!count(usage.inputTokens) || !count(usage.outputTokens) || !count(usage.totalTokens)) return false;
  return Object.entries(usage).every(([k, v]) => ['inputTokens', 'outputTokens', 'totalTokens', 'cachedInputTokens', 'reasoningOutputTokens'].includes(k) && count(v))
    && usage.totalTokens >= usage.inputTokens + usage.outputTokens
    && (usage.cachedInputTokens === undefined || (count(usage.cachedInputTokens) && usage.cachedInputTokens <= usage.inputTokens))
    && (usage.reasoningOutputTokens === undefined || (count(usage.reasoningOutputTokens) && usage.reasoningOutputTokens <= usage.outputTokens));
}

const fields = ['schemaVersion', 'eventId', 'source', 'endpoint', 'requestedModelId', 'reportedModelId',
  'startedAt', 'durationMs', 'outcome', 'httpStatus', 'failureCategory', 'usageStatus', 'usage'];
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Only aggregate telemetry is retained. Never persist prompts, responses, headers or credentials.
export function validNativeUsageEvent(value: unknown): value is NativeUsageTelemetryEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const e = value as NativeUsageTelemetryEvent;
  if (Object.keys(e).length !== fields.length || fields.some(k => !Object.hasOwn(e, k))
    || e.schemaVersion !== 1 || e.source !== 'native' || !idPattern.test(e.eventId)
    || !['responses', 'responses/compact'].includes(e.endpoint)
    || ![e.requestedModelId, e.reportedModelId].every(m => m === null || (typeof m === 'string' && /^[A-Za-z0-9][A-Za-z0-9_./:-]{0,127}$/.test(m) && !m.includes("://") && m.split("/").every(p => p && p !== "." && p !== "..")))
    || typeof e.startedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(e.startedAt)
    || !Number.isFinite(Date.parse(e.startedAt)) || !Number.isSafeInteger(e.durationMs) || e.durationMs < 0 || e.durationMs > 7 * 86400_000
    || !['completed', 'incomplete', 'failed', 'aborted'].includes(e.outcome)
    || !Number.isInteger(e.httpStatus) || (e.httpStatus !== 0 && (e.httpStatus < 100 || e.httpStatus > 599))
    || !(e.failureCategory === null || ['http-auth', 'http-rate-limit', 'http-client', 'http-server', 'transport', 'stream', 'protocol', 'aborted'].includes(e.failureCategory))
    || !['reported', 'unreported'].includes(e.usageStatus)) return false;
  // Match the receiver's terminal-state contract before persistence and during replay.
  // In particular, discard historical completed/protocol receipts; never invent recovery usage.
  if ((e.httpStatus === 0 && e.failureCategory !== 'transport' && e.failureCategory !== 'aborted')
    || (e.httpStatus !== 0 && e.failureCategory === 'transport')
    || (e.outcome === 'completed' && e.failureCategory !== null)
    || (e.outcome === 'aborted' && e.failureCategory !== 'aborted')
    || (e.outcome === 'failed' && e.failureCategory === null)) return false;
  if (e.usage === null) return e.usageStatus === 'unreported';
  return e.usageStatus === 'reported' && validNativeReportedUsage(e.usage);
}
