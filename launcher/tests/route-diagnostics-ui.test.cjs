const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const source = fs.readFileSync(path.join(__dirname, "../src/RouteDiagnostics.tsx"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
function load(react = React) {
  const loaded = { exports: {} };
  const localRequire = name => name === "react" ? react : name === "./icons" ? { Icon: () => null } : require(name);
  Function("module", "exports", "require", compiled)(loaded, loaded.exports, localRequire);
  return loaded.exports;
}
const ui = load();
const fixture = overrides => ({
  schemaVersion: 1, codexHome: "/fixture/codex", configPath: "/fixture/codex/config.toml",
  profilePath: null,
  configStatus: "loaded", profile: null, provider: "openai", providerSource: "default",
  customProvider: false, modelCatalogOverride: false, installed: true, active: true, routeMatches: true,
  issueCodes: [], catalog: { status: "waiting", successfulRequests: 0, lastSuccessfulAt: null }, ...overrides,
});
const row = (view, label) => view.rows.find(item => item.label === label)?.value;
test("all three languages distinguish saved routing from running-client overrides", () => {
  for (const language of ["en", "zh-CN", "ja"]) {
    const copy = ui.routeDiagnosticsCopy(language);
    for (const value of Object.values(copy)) assert.ok(value.length > 0);
    const view = ui.routeDiagnosticsView(fixture(), language);
    assert.equal(row(view, copy.home), "/fixture/codex");
    assert.equal(row(view, copy.provider), "openai");
    assert.equal(row(view, copy.catalog), copy.waiting);
    assert.equal(view.catalogBody, copy.waitingBody);
    const html = renderToStaticMarkup(React.createElement(ui.RouteDiagnosticsResult, { report: fixture(), language }));
    assert.ok(html.includes(renderToStaticMarkup(React.createElement("p", null, copy.scope))));
  }
  assert.match(ui.routeDiagnosticsCopy("en").scope, /running Codex client may use a different home, profile, or command-line override/);
});
test("a catalog observation does not hide provider, catalog, or route warnings", () => {
  const report = fixture({ provider: "custom", providerSource: "profile", profile: "work", customProvider: true,
    routeMatches: false, modelCatalogOverride: true,
    issueCodes: ["custom-provider", "catalog-override", "route-mismatch"],
    catalog: { status: "observed", successfulRequests: 7, lastSuccessfulAt: "2026-09-11T12:00:00Z" },
  });
  for (const language of ["en", "zh-CN", "ja"]) {
    const copy = ui.routeDiagnosticsCopy(language), view = ui.routeDiagnosticsView(report, language);
    assert.equal(row(view, copy.catalog), `${copy.observed} (7)`);
    assert.ok(row(view, copy.last));
    assert.deepEqual(view.guidance, [copy.custom, copy.override, copy.routeMismatch]);
    assert.equal(view.catalogBody, copy.observedBody);
  }
});
test("unavailable observation does not present a partial count as verified success", () => {
  const copy = ui.routeDiagnosticsCopy("en");
  const view = ui.routeDiagnosticsView(fixture({ catalog: { status: "unavailable", successfulRequests: 7, lastSuccessfulAt: null } }), "en");
  assert.equal(row(view, copy.catalog), copy.unavailable);
  assert.equal(row(view, copy.last), undefined);
});
test("missing configuration and rejected profiles do not claim a configured default", () => {
  const copy = ui.routeDiagnosticsCopy("en");
  for (const configStatus of ["missing", "invalid", "unreadable"]) {
    const view = ui.routeDiagnosticsView(fixture({ configStatus }), "en");
    assert.equal(row(view, copy.provider), copy.unknown);
    assert.equal(row(view, copy.profile), copy.unknown);
  }
  assert.equal(row(ui.routeDiagnosticsView(fixture({ issueCodes: ["profile-unavailable"] }), "en"), copy.profile), copy.unknown);
});
test("sidecar profile paths are distinct from the base file in all languages", () => {
  for (const language of ["en", "zh-CN", "ja"]) {
    const copy = ui.routeDiagnosticsCopy(language);
    const view = ui.routeDiagnosticsView(fixture({ profile: "work", profilePath: "/fixture/codex/work.config.toml" }), language);
    assert.notEqual(copy.file, copy.profileFile);
    assert.equal(row(view, copy.file), "/fixture/codex/config.toml");
    assert.equal(row(view, copy.profileFile), "/fixture/codex/work.config.toml");
    assert.equal(row(ui.routeDiagnosticsView(fixture(), language), copy.profileFile), undefined);
    assert.equal(row(ui.routeDiagnosticsView(fixture({ profilePath: "https://secret.example/profile" }), language), copy.profileFile), copy.unknown);
  }
});
test("pending recovery remains visible and states that diagnostics performed no repair", () => {
  for (const language of ["en", "zh-CN", "ja"]) {
    const copy = ui.routeDiagnosticsCopy(language);
    const view = ui.routeDiagnosticsView(fixture({ issueCodes: ["integration-recovery-pending"],
      catalog: { status: "observed", successfulRequests: 1, lastSuccessfulAt: "2026-09-11T12:00:00Z" },
    }), language);
    assert.deepEqual(view.guidance, [copy.recoveryPending]);
    assert.ok(copy.recoveryPending.length > 0);
  }
  assert.match(ui.routeDiagnosticsCopy("en").recoveryPending, /recovery is pending/);
  assert.match(ui.routeDiagnosticsCopy("en").recoveryPending, /did not repair installation files/);
});
test("rendering allowlists fields and never prints raw URLs, errors, TOML, or unknown issue codes", () => {
  const report = fixture({ provider: "https://secret.example", profile: "SECRET\nINJECTED", codexHome: "https://secret.example",
    configPath: "/fixture\nSECRET", issueCodes: ["__proto__", "toString", "SECRET", "config-invalid", "config-unreadable"],
    rawConfig: "SECRET", error: "SECRET", providerUrl: "https://secret.example" });
  const html = renderToStaticMarkup(React.createElement(ui.RouteDiagnosticsResult, { report, language: "en" }));
  assert.doesNotMatch(html, /SECRET|secret\.example|__proto__|toString/);
  assert.equal(ui.routeDiagnosticsView(report, "en").guidance.length, 1);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML|JSON\.stringify\(report\)/);
});
function harness(readReport, disabled = false) {
  const state = [], refs = []; let stateIndex = 0, refIndex = 0;
  const module = load({
    useState(initial) { const i = stateIndex++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = value; }]; },
    useRef(initial) { const i = refIndex++; if (!(i in refs)) refs[i] = { current: initial }; return refs[i]; },
  });
  return { render() { stateIndex = 0; refIndex = 0; return module.RouteDiagnostics({ language: "en", disabled, readReport }); } };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
test("only explicit action runs diagnostics and duplicate clicks stay bounded", async () => {
  let calls = 0, resolveReport;
  const pending = new Promise(resolve => { resolveReport = resolve; });
  const view = harness(() => { calls++; return pending; });
  const initial = view.render(); assert.equal(calls, 0);
  initial.props.children[0].props.onClick(); initial.props.children[0].props.onClick();
  assert.equal(calls, 1); assert.equal(view.render().props.children[0].props.disabled, true);
  resolveReport(fixture()); await flush();
  const result = view.render();
  assert.equal(result.props.children[0].props.disabled, false);
  assert.equal(result.props.children[2].props.report.catalog.status, "waiting");
});
test("parent busy state blocks a programmatic click", () => {
  let calls = 0; const view = harness(async () => { calls++; return fixture(); }, true);
  const button = view.render().props.children[0]; assert.equal(button.props.disabled, true);
  button.props.onClick(); assert.equal(calls, 0);
});
test("failed refresh clears stale results and hides raw exception text", async () => {
  let fail = false; const view = harness(async () => { if (fail) throw new Error("SECRET raw transport URL"); return fixture(); });
  view.render().props.children[0].props.onClick(); await flush(); assert.ok(view.render().props.children[2]);
  fail = true; view.render().props.children[0].props.onClick(); assert.equal(view.render().props.children[2], null);
  await flush(); const result = view.render();
  assert.equal(result.props.children[1].props.role, "alert");
  assert.equal(result.props.children[1].props.children, ui.routeDiagnosticsCopy("en").failed);
  assert.equal(result.props.children[2], null); assert.equal(result.props.children[0].props.disabled, false);
});
test("Setup mounts pending-catalog diagnostics and Settings mounts the read-only action outside DEV", () => {
  const app = fs.readFileSync(path.join(__dirname, "../src/App.tsx"), "utf8");
  const setup = app.slice(app.indexOf("function SetupSurface("), app.indexOf("function McpSurface("));
  assert.match(setup, /!devProfile && snapshot\.state\.coreSetupComplete && !snapshot\.state\.codexCatalogVerified \? \(/);
  assert.match(setup, /<RouteDiagnostics\s+disabled=\{busy\}/);
  assert.match(setup, /readReport=\{\(\) => api!\.routeDiagnostics\(\)\}/);
  const settings = app.slice(app.indexOf("function SettingsSurface("), app.indexOf("function ContentSurface("));
  assert.match(settings, /!devProfile \? <RouteDiagnostics/);
  assert.match(settings, /disabled=\{busy \|\| operation\?\.status === "running" \|\| browser\?\.navigationLocked === true\}/);
  assert.doesNotMatch(source, /setupCore\(|setPreference\(|uninstallIntegration\(|openExternal\(/);
});
