import type { UsageFailure, UsageSource } from "./types";

interface UsageDiagnosticBase {
  source: UsageSource;
  accepted: number;
  completed: number;
  failed: number;
  cancelled: number;
  incomplete?: number;
  knownOutcomeTotal: number;
  knownOutcomeCompletionRate: number | null;
  durations: {
    observedSamples: number;
    eligibleSamples: number;
    medianMs: number | null;
    p95Ms: number | null;
  };
  failures: UsageFailure[];
  classifiedFailureSamples: number;
}

export interface WebUsageDiagnosticGroup extends UsageDiagnosticBase {
  source: "web";
  accountId?: string;
  mode?: string;
  effort?: string;
  modelVersion?: string;
  modelVersionSource?: "observed" | "pinned" | "unknown";
  messageKind?: "task" | "context_stage" | "compaction" | "unknown";
}

export interface NativeUsageDiagnosticGroup extends UsageDiagnosticBase {
  source: "native";
  endpoint?: "responses" | "responses/compact";
  modelId?: string;
  modelIdSource?: "reported" | "requested" | "unknown";
}

export type UsageDiagnosticGroupLike = WebUsageDiagnosticGroup | NativeUsageDiagnosticGroup;

export interface UsageDiagnosticEligibility {
  knownOutcomes: number;
  observedSamples: number;
  eligibleSamples: number;
  durationCoverage: number | null;
  failureCount: number;
  failureRate: number | null;
  medianMs: number | null;
  p95Ms: number | null;
  eligible: {
    failureRate: boolean;
    median: boolean;
    p95: boolean;
  };
}

export interface RankedUsageDiagnosticGroup<T extends UsageDiagnosticGroupLike = UsageDiagnosticGroupLike> {
  group: T;
  eligibility: UsageDiagnosticEligibility;
}

export interface UsageAttentionFact<T extends UsageDiagnosticGroupLike = UsageDiagnosticGroupLike>
  extends RankedUsageDiagnosticGroup<T> {
  kind: "failures" | "duration" | "median";
}

const finiteCount = (value: number): number => Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
const finiteDuration = (value: number | null): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

export function usageDiagnosticEligibility(group: UsageDiagnosticGroupLike): UsageDiagnosticEligibility {
  const knownOutcomes = finiteCount(group.knownOutcomeTotal);
  const failureCount = finiteCount(group.failed);
  const observedSamples = finiteCount(group.durations.observedSamples);
  const eligibleSamples = finiteCount(group.durations.eligibleSamples);
  const consistentDurationSamples = eligibleSamples > 0 && observedSamples <= eligibleSamples;
  const durationCoverage = consistentDurationSamples
    ? observedSamples / eligibleSamples
    : null;
  const sufficientCoverage = durationCoverage !== null && durationCoverage >= 0.6;
  const failureRateEligible = knownOutcomes >= 5;
  const medianEligible = observedSamples >= 5 && sufficientCoverage;
  const p95Eligible = observedSamples >= 20 && sufficientCoverage;
  return {
    knownOutcomes,
    observedSamples,
    eligibleSamples,
    durationCoverage,
    failureCount,
    failureRate: failureRateEligible ? Math.min(1, failureCount / knownOutcomes) : null,
    medianMs: medianEligible ? finiteDuration(group.durations.medianMs) : null,
    p95Ms: p95Eligible ? finiteDuration(group.durations.p95Ms) : null,
    eligible: {
      failureRate: failureRateEligible,
      median: medianEligible && finiteDuration(group.durations.medianMs) !== null,
      p95: p95Eligible && finiteDuration(group.durations.p95Ms) !== null,
    },
  };
}

function compareNullableDescending(left: number | null, right: number | null): number {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return right - left;
}

/** Rank comparable groups from one source; callers must never compare Web and Native identities. */
export function rankUsageDiagnosticGroups<T extends UsageDiagnosticGroupLike>(
  groups: readonly T[],
  source: T["source"],
): Array<RankedUsageDiagnosticGroup<T>> {
  if (groups.some(group => group.source !== source)) {
    throw new Error("Usage diagnostic groups from different sources cannot be ranked together");
  }
  return groups.map((group, index) => ({ group, eligibility: usageDiagnosticEligibility(group), index }))
    .sort((left, right) => {
      const leftAttention = left.eligibility.failureCount > 0 ? 1 : 0;
      const rightAttention = right.eligibility.failureCount > 0 ? 1 : 0;
      return rightAttention - leftAttention
        || right.eligibility.failureCount - left.eligibility.failureCount
        || compareNullableDescending(left.eligibility.failureRate, right.eligibility.failureRate)
        || compareNullableDescending(left.eligibility.p95Ms, right.eligibility.p95Ms)
        || finiteCount(right.group.accepted) - finiteCount(left.group.accepted)
        || left.index - right.index;
    })
    .map(({ group, eligibility }) => ({ group, eligibility }));
}

/** Return at most two descriptive facts; interpretation and localized prose belong to the UI. */
export function usageAttentionFacts<T extends UsageDiagnosticGroupLike>(
  groups: readonly T[],
  source: T["source"],
  limit = 2,
): Array<UsageAttentionFact<T>> {
  const boundedLimit = Number.isFinite(limit)
    ? Math.max(0, Math.min(2, Math.floor(limit)))
    : 0;
  if (boundedLimit === 0) return [];
  const facts: Array<UsageAttentionFact<T>> = [];
  for (const item of rankUsageDiagnosticGroups(groups, source)) {
    if (item.eligibility.failureCount > 0) facts.push({ ...item, kind: "failures" });
    else if (item.eligibility.eligible.p95) facts.push({ ...item, kind: "duration" });
    else if (item.eligibility.eligible.median) facts.push({ ...item, kind: "median" });
    if (facts.length === boundedLimit) break;
  }
  return facts;
}
