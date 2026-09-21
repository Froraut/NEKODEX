const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

function compile(file) {
  return ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src", file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
}
function load(file, overrides = {}) {
  const loaded = { exports: {} };
  Function("module", "exports", "require", compile(file))(loaded, loaded.exports,
    name => Object.hasOwn(overrides, name) ? overrides[name] : require(name));
  return loaded.exports;
}

const portfolioCopy = {
  refreshing: "Refreshing allowances",
  summary: "{updated} updated, {retained} retained, {unavailable} unavailable, {skipped} skipped",
  updatedCount: "Updated {count}", retainedCount: "Retained {count}",
  unavailableCount: "Unavailable {count}", skippedCount: "Skipped {count}",
};

test("portfolio summary reports operational counts without aggregating quota percentages", () => {
  const { QuotaPortfolioSummary, quotaPortfolioCounts } = load("QuotaPortfolioSummary.tsx");
  const rows = [
    { status: "updated", snapshot: { accountBucket: { primary: { remainingPercent: 90 } } } },
    { status: "updated", snapshot: { accountBucket: { primary: { remainingPercent: 10 } } } },
    { status: "retained", snapshot: {} }, { status: "unavailable", snapshot: null },
    { status: "skipped", snapshot: null },
  ];
  assert.deepEqual(quotaPortfolioCounts(rows), { updated: 2, retained: 1, unavailable: 1, skipped: 1 });
  const html = renderToStaticMarkup(React.createElement(QuotaPortfolioSummary, { copy: portfolioCopy, rows }));
  assert.match(html, /2 updated, 1 retained, 1 unavailable, 1 skipped/);
  assert.doesNotMatch(html, /90|10|100%|average|best/i);
  assert.equal((html.match(/aria-live="polite"/g) ?? []).length, 1);
});

test("retained quota keeps reported buckets and labels their age and failed refresh", () => {
  const codexCopy = {
    quotaTitle: "Allowance", quotaRefresh: "Refresh", quotaChecking: "Checking", quotaNotChecked: "Not checked",
    quotaUnavailable: "Allowance unavailable", quotaGeneral: "General", quotaAdditional: "{count} additional",
    quotaPrimary: "Primary", quotaSecondary: "Secondary", quotaRemaining: "{value}% remaining",
    quotaUnknown: "Unknown", quotaResets: "Resets {time}", quotaUpdated: "Updated {time}",
    quotaCoverageTruncated: "Truncated", quotaWindowDays: "{count} days", quotaWindowHours: "{count} hours",
    quotaWindowMinutes: "{count} minutes", loginTitle: "Login", loginBody: "Login body", loginAction: "Start",
    loginStarting: "Starting",
  };
  const { AccountCodexControls } = load("AccountCodexControls.tsx", {
    "./i18n": { accountCodexCopyFor: () => codexCopy }, react: React,
  });
  const quota = {
    availability: "available", coverage: "reported_buckets", freshness: "stale",
    freshUntil: "2026-09-21T11:00:00.000Z", refreshError: "transport",
    fetchedAt: "2026-09-21T10:55:00.000Z", checkedAt: "2026-09-21T12:00:00.000Z",
    accountBucket: { id: "general", name: null, normalModelSlug: null,
      primary: { remainingPercent: 42, windowDurationMins: null, resetsAt: null },
      secondary: { remainingPercent: null, windowDurationMins: null, resetsAt: null } },
    additionalBuckets: [], additionalBucketsTruncated: false,
  };
  const html = renderToStaticMarkup(React.createElement(AccountCodexControls, {
    account: { id: "a", label: "A" }, copy: codexCopy, language: "en", login: null, loginAction: null,
    loginStarting: false, quota, quotaBusy: false, quotaFailed: true, quotaNow: Date.parse("2026-09-21T12:00:00.000Z"),
    quotaFreshnessCopy: { quotaCurrent: "Current", quotaLastKnown: "Last known", quotaUnavailable: "Refresh failed",
      checkedAt: "Checked {time}", retainedAt: "Retained from {time}" },
    onCancelLogin: async () => {}, onCopyCode: async () => true, onOpenLogin: async () => {},
    onRefreshQuota: async () => {}, onStartLogin: async () => {},
  }));
  assert.match(html, /Last known/);
  assert.match(html, /Refresh failed/);
  assert.match(html, /42% remaining/);
  assert.doesNotMatch(html, /role="alert"[^>]*>Allowance unavailable/);
});
