import { describe, expect, test } from "bun:test";
import {
  rankUsageDiagnosticGroups,
  usageAttentionFacts,
  usageDiagnosticEligibility,
  type UsageDiagnosticGroupLike,
  type WebUsageDiagnosticGroup,
} from "../src/usage-diagnostics";

function web(overrides: Partial<WebUsageDiagnosticGroup> = {}): WebUsageDiagnosticGroup {
  return {
    source: "web",
    accountId: "account-a",
    mode: "automatic",
    effort: "high",
    modelVersion: "5.6",
    messageKind: "task",
    accepted: 20,
    completed: 16,
    failed: 2,
    cancelled: 1,
    knownOutcomeTotal: 19,
    knownOutcomeCompletionRate: 16 / 19,
    durations: { observedSamples: 15, eligibleSamples: 19, medianMs: 1_000, p95Ms: 4_000 },
    failures: [{ code: "timeout", count: 2 }],
    classifiedFailureSamples: 2,
    ...overrides,
  };
}

describe("usage diagnostic eligibility", () => {
  test("keeps factual failures while withholding rates and durations below their thresholds", () => {
    const eligibility = usageDiagnosticEligibility(web({
      accepted: 4,
      completed: 2,
      failed: 2,
      knownOutcomeTotal: 4,
      durations: { observedSamples: 4, eligibleSamples: 4, medianMs: 900, p95Ms: 2_000 },
    }));
    expect(eligibility.failureCount).toBe(2);
    expect(eligibility.failureRate).toBeNull();
    expect(eligibility.medianMs).toBeNull();
    expect(eligibility.p95Ms).toBeNull();
    expect(eligibility.durationCoverage).toBe(1);
  });

  test("requires both sample counts and sixty-percent duration coverage", () => {
    const lowCoverage = usageDiagnosticEligibility(web({
      knownOutcomeTotal: 20,
      failed: 5,
      durations: { observedSamples: 11, eligibleSamples: 20, medianMs: 1_000, p95Ms: 4_000 },
    }));
    expect(lowCoverage.failureRate).toBe(0.25);
    expect(lowCoverage.medianMs).toBeNull();
    expect(lowCoverage.p95Ms).toBeNull();

    const medianOnly = usageDiagnosticEligibility(web({
      durations: { observedSamples: 12, eligibleSamples: 20, medianMs: 1_000, p95Ms: 4_000 },
    }));
    expect(medianOnly.medianMs).toBe(1_000);
    expect(medianOnly.p95Ms).toBeNull();

    const fullyEligible = usageDiagnosticEligibility(web({
      durations: { observedSamples: 20, eligibleSamples: 20, medianMs: 1_000, p95Ms: 4_000 },
    }));
    expect(fullyEligible.medianMs).toBe(1_000);
    expect(fullyEligible.p95Ms).toBe(4_000);
  });

  test("rejects inconsistent duration coverage instead of treating excess observations as complete", () => {
    const eligibility = usageDiagnosticEligibility(web({
      durations: { observedSamples: 20, eligibleSamples: 5, medianMs: 1_000, p95Ms: 4_000 },
    }));
    expect(eligibility.durationCoverage).toBeNull();
    expect(eligibility.medianMs).toBeNull();
    expect(eligibility.p95Ms).toBeNull();
    expect(eligibility.eligible).toMatchObject({ median: false, p95: false });
  });
});

describe("usage diagnostic ranking", () => {
  test("sorts attention and eligible comparisons deterministically without manufacturing zero metrics", () => {
    const groups = [
      web({ accountId: "stable-first", accepted: 40, failed: 0, knownOutcomeTotal: 40,
        durations: { observedSamples: 30, eligibleSamples: 40, medianMs: 500, p95Ms: 2_000 } }),
      web({ accountId: "insufficient", accepted: 100, failed: 0, knownOutcomeTotal: 4,
        durations: { observedSamples: 3, eligibleSamples: 4, medianMs: 100, p95Ms: 200 } }),
      web({ accountId: "failures", accepted: 10, failed: 3, knownOutcomeTotal: 10,
        durations: { observedSamples: 10, eligibleSamples: 10, medianMs: 800, p95Ms: 3_000 } }),
      web({ accountId: "stable-second", accepted: 40, failed: 0, knownOutcomeTotal: 40,
        durations: { observedSamples: 30, eligibleSamples: 40, medianMs: 500, p95Ms: 2_000 } }),
    ];
    const ranked = rankUsageDiagnosticGroups(groups, "web");
    expect(ranked.map(item => item.group.accountId)).toEqual([
      "failures", "stable-first", "stable-second", "insufficient",
    ]);
    expect(ranked.at(-1)?.eligibility).toMatchObject({ failureRate: null, medianMs: null, p95Ms: null });
  });

  test("refuses to compare Web and Native identities and bounds attention facts to two", () => {
    const mixed: UsageDiagnosticGroupLike[] = [web(), {
      source: "native", endpoint: "responses", modelId: "gpt-native", modelIdSource: "reported",
      accepted: 5, completed: 5, failed: 0, cancelled: 0, incomplete: 0,
      knownOutcomeTotal: 5, knownOutcomeCompletionRate: 1,
      durations: { observedSamples: 5, eligibleSamples: 5, medianMs: 500, p95Ms: 800 },
      failures: [], classifiedFailureSamples: 0,
    }];
    expect(() => rankUsageDiagnosticGroups(mixed, "web")).toThrow("different sources");

    const facts = usageAttentionFacts([
      web({ accountId: "one", failed: 3 }),
      web({ accountId: "two", failed: 2 }),
      web({ accountId: "three", failed: 1 }),
    ], "web", 99);
    expect(facts).toHaveLength(2);
    expect(facts.map(fact => [fact.kind, fact.group.accountId, fact.eligibility.failureCount])).toEqual([
      ["failures", "one", 3],
      ["failures", "two", 2],
    ]);
    expect(usageAttentionFacts([web({ failed: 1 })], "web", Number.NaN)).toEqual([]);
    expect(usageAttentionFacts([web({ failed: 1 })], "web", Number.POSITIVE_INFINITY)).toEqual([]);
    expect(usageAttentionFacts([web({ failed: 1 })], "web", 0)).toEqual([]);
  });
});
