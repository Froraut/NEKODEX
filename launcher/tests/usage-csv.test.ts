import { describe, expect, test } from "bun:test";
import { usageReportCsv } from "../src/usage-statistics";
import type { UsageSnapshot } from "../src/types";

function report(source: "web" | "native" = "web"): UsageSnapshot {
  return {
    available: true, source, selectedAccountId: source === "web" ? "account-a" : null,
    accounts: [], generatedAt: "2026-09-22T09:42:00Z", timeZone: "Europe/Minsk",
    period: { startDay: "2026-09-16", endDay: "2026-09-22", days: 7 },
    metrics: { total: 2, completed: 1, failed: 1, cancelled: 0, unrecorded: 0,
      knownOutcomeTotal: 2, knownOutcomeCompletionRate: 0.5 },
    durations: { observedSamples: 2, medianMs: 1000, p95Ms: null },
    rows: ["2026-09-20", "2026-09-21"].map(day => ({
      day, accountId: source === "web" ? "account-a" : undefined,
      modelId: "model-a", accepted: 1, completed: 1, failed: 0, aborted: 0,
    })),
    calendar: [{ day: "2026-09-20", total: 1, completed: 1, failed: 0, cancelled: 0, unrecorded: 0 }],
    failures: [{ code: "timeout", count: 1 }],
  };
}

// A consumer parses CSV independently of the exporter, including escaped quotes/newlines.
function parseCsv(csv: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    if (char === '"') {
      if (quoted && csv[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (char === "," || char === "\n")) {
      row.push(cell); cell = "";
      if (char === "\n") { rows.push(row); row = []; }
    } else cell += char;
  }
  const [header, ...records] = rows;
  return records.map(values => Object.fromEntries(header.map((key, index) => [key, values[index]])));
}

describe("usage CSV consumer contract", () => {
  test("daily groups retain dates and every record retains selected scope and snapshot freshness", () => {
    const records = parseCsv(usageReportCsv(report()));
    expect(records.map(row => row.record_type)).toEqual(["summary", "day", "group", "group", "failure"]);
    expect(records.filter(row => row.record_type === "group").map(row => row.day))
      .toEqual(["2026-09-20", "2026-09-21"]);
    for (const row of records) {
      expect(row.selected_account_id).toBe("account-a");
      expect(row.generated_at).toBe("2026-09-22T09:42:00Z");
      expect(row.scope).toBe("selected-account");
    }
    expect(records[0].known_outcome_completion_rate).toBe("0.5");
    const native = parseCsv(usageReportCsv(report("native")));
    expect(native.every(row => row.selected_account_id === "" && row.scope === "native-recorded-only")).toBe(true);
    expect(native[0].unrecorded_count).toBe("");
    expect(native.filter(row => row.record_type !== "failure").every(row => row.incomplete_count === "0")).toBe(true);
    // Web usage has no incomplete outcome, so the column is blank rather than a measured zero.
    expect(records.filter(row => row.record_type !== "failure").every(row => row.incomplete_count === "")).toBe(true);
    const all = report(); all.selectedAccountId = null;
    expect(parseCsv(usageReportCsv(all))[0].scope).toBe("all-accounts");
  });

  test("spreadsheet formula prefixes are exported as text without corrupting CSV structure or counts", () => {
    const snapshot = report("native");
    const identifiers = ['=HYPERLINK("https://example.invalid","label")', '+SUM(1,2)', '-1+2', '@SUM(1,2)', '\t =1+2', '\r\n@SUM(1,2)'];
    snapshot.rows = identifiers.map(modelId => ({ ...snapshot.rows[0], modelId }));
    const groups = parseCsv(usageReportCsv(snapshot)).filter(row => row.record_type === "group");
    expect(groups.map(row => row.model_id)).toEqual(identifiers.map(value => "'" + value));
    expect(groups.every(row => row.total_count === "1" && row.completed_count === "1")).toBe(true);
  });

  test("optional token coverage distinguishes partial zeros, known absence and unavailable coverage", () => {
    const snapshot = report("native");
    snapshot.tokens = { inputTokens: 20, outputTokens: 40,
      cachedInputTokens: 0, reasoningTokens: 0, reportedSamples: 2, unreportedSamples: 0,
      cachedInputReportedSamples: 1, reasoningReportedSamples: 1 };
    const partial = parseCsv(usageReportCsv(snapshot))[0];
    expect(partial.cached_input_tokens).toBe("0");
    expect(partial.reasoning_tokens).toBe("0");
    expect(partial.reported_token_samples).toBe("2");
    expect(partial.cached_input_reported_samples).toBe("1");
    expect(partial.reasoning_reported_samples).toBe("1");

    snapshot.tokens = { inputTokens: null, outputTokens: null,
      cachedInputTokens: null, reasoningTokens: null, reportedSamples: 0, unreportedSamples: 2,
      cachedInputReportedSamples: 0, reasoningReportedSamples: 0 };
    const absent = parseCsv(usageReportCsv(snapshot))[0];
    expect(absent.cached_input_tokens).toBe("");
    expect(absent.reasoning_tokens).toBe("");
    expect(absent.input_tokens).toBe("");
    expect(absent.output_tokens).toBe("");
    expect(absent.unreported_token_samples).toBe("2");
    expect(absent.cached_input_reported_samples).toBe("0");
    expect(absent.reasoning_reported_samples).toBe("0");

    delete snapshot.tokens.cachedInputReportedSamples;
    delete snapshot.tokens.reasoningReportedSamples;
    const unavailable = parseCsv(usageReportCsv(snapshot))[0];
    expect(unavailable.cached_input_reported_samples).toBe("");
    expect(unavailable.reasoning_reported_samples).toBe("");
  });

  test("ordinary Unicode, commas, quotes and line breaks round-trip as text", () => {
    const snapshot = report("native");
    snapshot.rows[0].modelId = 'модель,"quoted"\nsecond line';
    const groups = parseCsv(usageReportCsv(snapshot)).filter(row => row.record_type === "group");
    expect(groups[0].model_id).toBe(snapshot.rows[0].modelId);
    expect(groups[1].model_id).toBe("model-a");
  });
});
