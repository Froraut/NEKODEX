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
const openReact = { ...React, useState: () => [true, () => {}], useRef: () => ({ current: null }) };
const { UsageInsights } = load("UsageInsights.tsx", {
  react: openReact,
  "./types": {},
  "./usage-diagnostics": diagnostics,
  "./usage-insights.css": {},
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
