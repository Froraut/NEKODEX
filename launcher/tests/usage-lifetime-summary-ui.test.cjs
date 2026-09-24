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
    esModuleInterop: true,
  } }).outputText;
  const loaded = { exports: {} };
  Function("module", "exports", "require", compiled)(loaded, loaded.exports, name =>
    Object.hasOwn(overrides, name) ? overrides[name]
      : require(name.startsWith(".") ? path.join(__dirname, "../src", name) : name));
  return loaded.exports;
}

const statistics = load("usage-statistics.ts");
const copy = load("i18n.ts").copyFor("en");

function renderHistory(lifetime, lifetimeUnclassified) {
  const report = {
    available: true, source: "web", accounts: [], accountId: null,
    generatedAt: "2026-09-22T12:00:00Z", startedAt: "2026-08-01T12:00:00Z",
    period: { days: 7, startDay: "2026-09-16", endDay: "2026-09-22" },
    metrics: { total: 0, completed: 0, failed: 0, cancelled: 0, unrecorded: 0,
      knownOutcomeTotal: 0, knownOutcomeCompletionRate: null },
    durations: { observedSamples: 0, medianMs: null, p95Ms: null },
    calendar: [], rows: [], lifetimeGroups: [], failures: [], diagnosticGroups: [],
    lifetime, lifetimeUnclassified,
  };
  // Seed a previously fetched snapshot; rendering must not invoke the live bridge.
  const cachedReact = { ...React, useRef: initial => React.useRef(initial instanceof Map
    ? new Map([["web:7:all", report]]) : initial) };
  const { UsageDashboard } = load("UsageDashboard.tsx", {
    react: cachedReact,
    "./usage-statistics": statistics,
    "./UsageInsights": { UsageInsights: () => null },
    "./workflow-copy": { workflowCopy: () => ({}) },
    "./usage-lifetime.css": {},
  });
  return renderToStaticMarkup(React.createElement(UsageDashboard, { copy, language: "en" }));
}

test("expired unclassified-only history keeps lifetime counts and recording date without inventing model rows", () => {
  const html = renderHistory(5, 5);
  assert.ok(html.includes(copy.usageEmpty));
  assert.ok(html.includes(`${copy.usageLifetime}: 5`));
  assert.ok(html.includes(`${copy.usageLifetimeUnclassified}: 5`));
  assert.ok(html.includes(`${copy.usageSince}: ${new Date("2026-08-01T12:00:00Z").toLocaleDateString("en")}`));
  assert.match(html, /<details/);
  assert.doesNotMatch(html, /<table|<tbody|<tr/);
});

test("truly empty history has no lifetime disclosure or fabricated model table", () => {
  const html = renderHistory(0, 0);
  assert.ok(html.includes(copy.usageEmpty));
  assert.doesNotMatch(html, /<details|<table/);
  assert.ok(!html.includes(`${copy.usageLifetime}:`));
});
