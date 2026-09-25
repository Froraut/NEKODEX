const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

function load(file, overrides = {}) {
  const source = fs.readFileSync(path.join(__dirname, "../src", file), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const loaded = { exports: {} };
  Function("module", "exports", "require", compiled)(loaded, loaded.exports,
    name => Object.hasOwn(overrides, name) ? overrides[name] : require(name));
  return loaded.exports;
}

const diagnostics = load("usage-diagnostics.ts", { "./types": {} });
const statistics = load("usage-statistics.ts", { "./types": {} });
const openReact = { ...React, useState: () => [true, () => {}], useRef: () => ({ current: null }) };
const { UsageInsights } = load("UsageInsights.tsx", {
  react: openReact,
  "./types": {},
  "./usage-diagnostics": diagnostics,
  "./usage-statistics": statistics,
  "./usage-insights.css": {},
});

const { UsageInsights: CollapsedInsights } = load("UsageInsights.tsx", {
  "./usage-diagnostics": diagnostics,
  "./usage-statistics": statistics,
  "./usage-insights.css": {},
});

function renderSummary(observedSamples, eligibleSamples = observedSamples, source = "web") {
  const group = {
    source, accountId: "account-a", mode: "automatic", effort: "high",
    modelVersion: "6", modelVersionSource: "observed", messageKind: "task",
    modelId: "gpt-native", endpoint: "responses", modelIdSource: "reported",
    accepted: eligibleSamples, completed: eligibleSamples, failed: 0, cancelled: 0,
    knownOutcomeTotal: eligibleSamples, knownOutcomeCompletionRate: 1,
    durations: { observedSamples, eligibleSamples, medianMs: 1000, p95Ms: 4000 },
    failures: [], classifiedFailureSamples: 0,
  };
  return renderToStaticMarkup(React.createElement(CollapsedInsights, {
    groups: [group], accounts: [{ id: "account-a", label: "Alpha", available: true }], language: "en",
    copy: { title: "Insights", body: "Observed", completionRate: "Completion", median: "Median", p95: "P95",
      knownOutcomes: "{count} known", durationSamples: "{count} durations", coverage: "{count} coverage",
      insufficientEvidence: "Insufficient", unknownIdentity: "Unknown", noComparison: "No comparison",
      notBestModel: "No best model" },
    failureLabels: {}, detailsLabel: "Details", hideDetailsLabel: "Hide",
    completedLabel: "Completed", failedLabel: "Failed", cancelledLabel: "Cancelled", incompleteLabel: "Incomplete",
  }));
}

test("collapsed summary exposes qualified medians and sample coverage without p95", () => {
  for (const source of ["web", "native"]) {
    for (const [observed, eligible] of [[5, 5], [19, 19], [6, 10]]) {
      const html = renderSummary(observed, eligible, source);
      assert.match(html, /Median: 1 s/);
      assert.ok(html.includes(`${observed} durations`));
      assert.ok(html.includes(`${observed}/${eligible} coverage`));
      assert.doesNotMatch(html, /P95|No comparison/);
    }
  }
});

test("collapsed summary retains p95 at twenty samples and truthful empty evidence", () => {
  assert.match(renderSummary(20), /P95: 4 s/);
  assert.match(renderSummary(20), /20\/20 coverage/);
  assert.match(renderSummary(4), /No comparison/);
  const completionOnly = renderSummary(0, 5);
  assert.doesNotMatch(completionOnly, /No comparison|Median:|P95:/);
  assert.match(completionOnly, /Details/);
  assert.doesNotMatch(renderSummary(5, 10), /Median:|P95:/);
});

test("mixed outcomes explain completion without classifying cancellations as failures", () => {
  const group = {
    source: "web", accountId: "account-a", mode: "automatic", effort: "max",
    modelVersion: "6", modelVersionSource: "observed", messageKind: "task",
    accepted: 5, completed: 2, failed: 1, cancelled: 2,
    knownOutcomeTotal: 5, knownOutcomeCompletionRate: 0.4,
    durations: { observedSamples: 0, eligibleSamples: 5, medianMs: null, p95Ms: null },
    failures: [{ code: "timeout", count: 1 }], classifiedFailureSamples: 1,
  };
  const html = renderToStaticMarkup(React.createElement(UsageInsights, {
    groups: [group], accounts: [{ id: "account-a", label: "Alpha", available: true }], language: "en",
    copy: { title: "Insights", body: "Observed", completionRate: "Completion", median: "Median", p95: "P95",
      knownOutcomes: "{count} known", durationSamples: "{count} durations", coverage: "{count} coverage",
      insufficientEvidence: "Insufficient", unknownIdentity: "Unknown", noComparison: "No comparison",
      notBestModel: "No best model" },
    failureLabels: { timeout: "Timeout" }, detailsLabel: "Details", hideDetailsLabel: "Hide",
    completedLabel: "Completed", failedLabel: "Failed", cancelledLabel: "Cancelled", incompleteLabel: "Incomplete",
  }));
  assert.match(html, />40%</);
  assert.match(html, /Completed: 2 · Failed: 1 · Cancelled: 2/);
  assert.equal((html.match(/Timeout: 1/g) ?? []).length >= 1, true);
});

test("unreported identity fields use a short placeholder and one explanatory note", () => {
  const group = {
    source: "web", accountId: "missing", mode: "manual", effort: "unknown",
    modelVersion: "unknown", modelVersionSource: "unknown", messageKind: "task",
    accepted: 20, completed: 20, failed: 0, cancelled: 0,
    knownOutcomeTotal: 20, knownOutcomeCompletionRate: 1,
    durations: { observedSamples: 20, eligibleSamples: 20, medianMs: 59_960, p95Ms: 59_960 },
    failures: [], classifiedFailureSamples: 0,
  };
  const html = renderToStaticMarkup(React.createElement(UsageInsights, {
    groups: [group], accounts: [], language: "en",
    copy: { title: "Insights", body: "Observed", completionRate: "Completion", median: "Median", p95: "P95",
      knownOutcomes: "{count} known", durationSamples: "{count} durations", coverage: "{count} coverage",
      insufficientEvidence: "Insufficient", unknownIdentity: "Identity was not reported", noComparison: "No comparison",
      notBestModel: "No best model" },
    failureLabels: {}, detailsLabel: "Details", hideDetailsLabel: "Hide",
    completedLabel: "Completed", failedLabel: "Failed", cancelledLabel: "Cancelled", incompleteLabel: "Incomplete",
    labels: { unknown: "Unknown", group: "Mode / model", seconds: "{value} sec", minutes: "{value} min" },
  }));
  assert.match(html, /Unknown · manual · Unknown · Unknown · Unknown · task/);
  assert.equal(html.split("Identity was not reported").length - 1, 2, "one note per rendered identity");
  assert.match(html, /<th scope="col">Mode \/ model<\/th>/);
  assert.match(html, /<caption/);
  assert.match(html, /1 min/);
  assert.doesNotMatch(html, /60 sec/);
});

test("usage rates and durations never round a partial result to a boundary", () => {
  assert.equal(statistics.formatUsageRate(1999 / 2000, "en"), "99.9%");
  assert.equal(statistics.formatUsageRate(1 / 2001, "en"), "0.1%");
  assert.equal(statistics.formatUsageRate(1, "en"), "100%");
  assert.equal(statistics.formatUsageRate(0, "en"), "0%");
  assert.equal(statistics.formatUsageDuration(59_960, "en", "{value} s", "{value} min"), "1 min");
  assert.equal(statistics.formatUsageDuration(59_940, "en", "{value} s", "{value} min"), "59.9 s");
  assert.equal(statistics.formatUsageDuration(1_000, "en", "{value} s", "{value} min"), "1 s");
});
