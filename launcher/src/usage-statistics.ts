import type { UsageGroup, UsageSnapshot, UsageSource } from "./types";

export type UsageCountRow = Pick<UsageGroup, "accepted" | "completed" | "failed" | "aborted" | "incomplete">;
export interface UsageDisplayGroup { key: string; label: string; row: UsageCountRow; }

export function aggregateUsageGroups(
  rows: UsageGroup[],
  source: UsageSource,
  labelFor: (row: UsageGroup, source: UsageSource) => string,
): UsageDisplayGroup[] {
  const grouped = new Map<string, UsageDisplayGroup>();
  for (const row of rows) {
    const label = labelFor(row, source);
    const key = `${source}:${label}`;
    const saved = grouped.get(key) ?? {
      key,
      label,
      row: { accepted: 0, completed: 0, failed: 0, aborted: 0, incomplete: 0 },
    };
    saved.row.accepted += row.accepted;
    saved.row.completed += row.completed;
    saved.row.failed += row.failed;
    saved.row.aborted += row.aborted;
    saved.row.incomplete = (saved.row.incomplete ?? 0) + (row.incomplete ?? 0);
    grouped.set(key, saved);
  }
  return [...grouped.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export function normalizedUsageSnapshot(report: UsageSnapshot | null): UsageSnapshot | null {
  if (!report || report.metrics.total !== 0 || report.durations.observedSamples === 0) return report;
  return {
    ...report,
    durations: { observedSamples: 0, medianMs: null, p95Ms: null },
  };
}


function csvCell(value: string | number | null) {
  // Spreadsheet applications interpret formula-leading text even in quoted CSV cells.
  const raw = value === null ? "" : String(value);
  const text = typeof value === "string" && /^[\s\u0000-\u001f]*[=+@-]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function usageReportCsv(report: UsageSnapshot): string {
  const scope = report.source === "native" ? "native-recorded-only"
    : report.selectedAccountId !== null ? "selected-account" : "all-accounts";
  const header = ["record_type", "source", "scope", "period_start", "period_end", "time_zone", "day", "account_id", "mode", "effort", "model_version", "model_version_source", "message_kind", "endpoint", "model_id", "model_id_source", "total_count", "completed_count", "failed_count", "cancelled_count", "incomplete_count", "unrecorded_count", "known_outcome_count", "known_outcome_completion_rate", "duration_samples", "median_accept_to_outcome_ms", "p95_accept_to_outcome_ms", "input_tokens", "output_tokens", "cached_input_tokens", "reasoning_tokens", "reported_token_samples", "unreported_token_samples", "failure_code", "failure_count", "selected_account_id", "generated_at"];
  const token = report.tokens;
  type CsvValue = string | number | null | undefined;
  const base = { source: report.source, scope, period_start: report.period.startDay, period_end: report.period.endDay,
    time_zone: report.timeZone, selected_account_id: report.source === "web" ? report.selectedAccountId : null,
    generated_at: report.generatedAt };
  const records: Array<Record<string, CsvValue>> = [{ ...base, record_type: "summary",
    total_count: report.metrics.total, completed_count: report.metrics.completed, failed_count: report.metrics.failed,
    cancelled_count: report.metrics.cancelled, incomplete_count: report.metrics.incomplete ?? 0,
    unrecorded_count: report.source === "web" ? report.metrics.unrecorded : null,
    known_outcome_count: report.metrics.knownOutcomeTotal,
    known_outcome_completion_rate: report.metrics.knownOutcomeCompletionRate,
    duration_samples: report.durations.observedSamples, median_accept_to_outcome_ms: report.durations.medianMs,
    p95_accept_to_outcome_ms: report.durations.p95Ms, input_tokens: token?.inputTokens,
    output_tokens: token?.outputTokens, cached_input_tokens: token?.cachedInputTokens,
    reasoning_tokens: token?.reasoningTokens, reported_token_samples: token?.reportedSamples,
    unreported_token_samples: token?.unreportedSamples }];
  for (const day of report.calendar) records.push({ ...base, record_type: "day", day: day.day, total_count: day.total,
    completed_count: day.completed, failed_count: day.failed, cancelled_count: day.cancelled,
    incomplete_count: day.incomplete ?? 0, unrecorded_count: report.source === "web" ? day.unrecorded : null });
  for (const row of report.rows) records.push({ ...base, record_type: "group", day: row.day, account_id: row.accountId,
    mode: row.mode, effort: row.effort, model_version: row.modelVersion, model_version_source: row.modelVersionSource,
    message_kind: row.messageKind, endpoint: row.endpoint, model_id: row.modelId, model_id_source: row.modelIdSource,
    total_count: row.accepted, completed_count: row.completed, failed_count: row.failed, cancelled_count: row.aborted,
    incomplete_count: row.incomplete ?? 0,
    unrecorded_count: report.source === "web"
      ? Math.max(0, row.accepted - row.completed - row.failed - row.aborted - (row.incomplete ?? 0)) : null });
  for (const failure of report.failures) records.push({ ...base, record_type: "failure",
    failure_code: failure.code, failure_count: failure.count });
  return [header, ...records.map(record => header.map(column => record[column] ?? ""))]
    .map(row => row.map(csvCell).join(",")).join("\n") + "\n";
}
