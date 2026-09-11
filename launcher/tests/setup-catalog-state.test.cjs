const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const root = path.join(__dirname, "..");
function compile(source, extra = {}) {
  const loaded = { exports: {} };
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  Function("module", "exports", "require", ...Object.keys(extra), output)(loaded, loaded.exports, require, ...Object.values(extra));
  return loaded.exports;
}
const { copyFor } = compile(fs.readFileSync(path.join(root, "src/i18n.ts"), "utf8"));
const appSource = fs.readFileSync(path.join(root, "src/App.tsx"), "utf8");
const app = ts.createSourceFile("App.tsx", appSource, ts.ScriptTarget.ES2023, true, ts.ScriptKind.TSX);
const names = new Set(["SetupSurface", "SetupRow", "ContentSurface", "SecondaryButton"]);
const declarations = app.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text));
assert.equal(declarations.length, names.size);
// Execute production state/render branches with inert presentation helpers and no IPC.
const { SetupSurface } = compile(declarations.map(node => node.getText(app)).join("\n") + "\nexports.SetupSurface = SetupSurface;", {
  useState: React.useState,
  api: new Proxy({}, { get() { throw new Error("Rendering setup must not call IPC"); } }),
  SectionHeading: ({ label }) => React.createElement("h2", null, label),
  NoticeRow: ({ children }) => React.createElement("aside", null, children),
  RouteDiagnostics: () => React.createElement("div", { "data-routing-check": "true" }, "routing check"),
  Icon: () => null, McpMark: () => null, ZeroRiskModelMenu: () => null,
});
function render(language, state, devProfile = false) {
  return renderToStaticMarkup(React.createElement(SetupSurface, {
    activateBrowser: async () => {}, browser: { authenticated: true }, copy: copyFor(language),
    devProfile, operation: null, setError: () => {}, showMcp: () => {}, updateState: () => {},
    snapshot: { smokePassed: true, state: {
      language, browserInteractionMode: "automatic", coreSetupComplete: false,
      codexCatalogVerified: false, codexRestartRequired: false, ...state,
    } },
  }));
}
const escaped = value => renderToStaticMarkup(React.createElement("span", null, value)).slice(6, -7);
test("installed and unobserved setup renders waiting, secondary reinstall, and adjacent diagnostics in every locale", () => {
  for (const language of ["en", "zh-CN", "ja"]) {
    const copy = copyFor(language);
    const html = render(language, { coreSetupComplete: true, codexRestartRequired: true });
    assert.ok(html.includes(escaped(copy.stepInstallWaiting)));
    assert.ok(html.includes(escaped(copy.stepInstallWaitingBody)));
    assert.ok(html.includes(escaped(copy.reinstall)));
    assert.ok(html.includes('data-routing-check="true"'));
    assert.ok(html.includes(escaped(copy.restartCodex)));
    assert.ok(html.indexOf(escaped(copy.stepInstallWaiting)) < html.indexOf('data-routing-check="true"'));
    assert.match(html, /class="next-surface-row" disabled=""/);
    assert.match(html, /class="button-secondary"/);
    assert.doesNotMatch(html, /is-error|installation failed/i);
  }
});
test("fresh setup does not claim installed and observed catalog completes the genuine gate", () => {
  const copy = copyFor("en");
  const fresh = render("en", {});
  assert.ok(fresh.includes(escaped(copy.stepInstall)));
  assert.ok(fresh.includes(escaped(copy.install)));
  assert.ok(!fresh.includes(escaped(copy.stepInstallWaiting)));
  assert.ok(!fresh.includes('data-routing-check="true"'));
  assert.match(fresh, /class="next-surface-row" disabled=""/);
  const complete = render("en", { coreSetupComplete: true, codexCatalogVerified: true });
  assert.ok(!complete.includes(escaped(copy.stepInstallWaiting)));
  assert.ok(!complete.includes('data-routing-check="true"'));
  assert.match(complete, /class="next-surface-row" type="button"/);
  assert.match(complete, /class="setup-row is-complete"/);
});
test("DEV setup never waits for a production Codex catalog request", () => {
  const copy = copyFor("en");
  const html = render("en", { coreSetupComplete: true }, true);
  assert.ok(html.includes(escaped(copy.devStepInstall)));
  assert.ok(html.includes(escaped(copy.devReinstall)));
  assert.ok(!html.includes(escaped(copy.stepInstallWaiting)));
  assert.ok(!html.includes('data-routing-check="true"'));
});
