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

