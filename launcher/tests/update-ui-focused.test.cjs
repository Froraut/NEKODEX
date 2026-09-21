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
  Function("module", "exports", "require", compiled)(loaded, loaded.exports, name => overrides[name] || require(name));
  return loaded.exports;
}

const { updateCopyFor } = load("update-copy.ts");
const { UpdateProgress } = load("UpdateProgress.tsx");
const ProgressStub = () => React.createElement("div", { "data-progress": "true" });
const { Updates } = load("Updates.tsx", {
  "./UpdateProgress": { UpdateProgress: ProgressStub },
  "./icons": { Icon: ({ name }) => React.createElement("i", { "data-icon": name }) },
  "./update-copy": { updateCopyFor },
});
const renderedText = value => renderToStaticMarkup(React.createElement("h2", null, value));

test("download speed distinguishes missing telemetry from an actual zero reading", () => {
  const base = { status: "downloading", version: "6.0.0", downloadedBytes: 1024, totalBytes: 4096 };
  const missing = renderToStaticMarkup(React.createElement(UpdateProgress, { state: base, label: "Progress" }));
  const invalid = renderToStaticMarkup(React.createElement(UpdateProgress, { state: { ...base, bytesPerSecond: Number.NaN }, label: "Progress" }));
  const zero = renderToStaticMarkup(React.createElement(UpdateProgress, { state: { ...base, bytesPerSecond: 0 }, label: "Progress" }));
  assert.match(missing, /class="updates-speed">—<\/small>/);
  assert.match(invalid, /class="updates-speed">—<\/small>/);
  assert.match(zero, /class="updates-speed">0\.0 MiB\/s<\/small>/);
});

function renderUpdates(state, error = null) {
  return renderToStaticMarkup(React.createElement(Updates, {
    language: "en", currentVersion: "5.9.0", state, error,
    busy: ["downloading", "verifying", "installing", "cancelling"].includes(state.status),
    blocked: false, checking: false, cooldown: false,
    onCheck() {}, onInstall() {}, onCancel() {},
  }));
}

test("ancillary errors keep active updater phases while terminal failures stay failed", () => {
  const copy = updateCopyFor("en");
  const installing = renderUpdates({ status: "installing", version: "6.0.0" }, copy.cancelTooLate);
  assert.ok(installing.includes(copy.installing));
  assert.ok(installing.includes(copy.cancelTooLate));
  assert.match(installing, /data-icon="reload"/);
  assert.ok(!installing.includes(renderedText(copy.failed)));

  const terminal = renderUpdates({ status: "error", message: "Package verification failed" });
  assert.ok(terminal.includes(renderedText(copy.failed)));
  assert.match(terminal, /data-icon="alert"/);

  const idleCheckFailure = renderUpdates({ status: "idle" }, "GitHub unavailable");
  assert.ok(idleCheckFailure.includes(renderedText(copy.failed)));
  assert.match(idleCheckFailure, /data-icon="alert"/);
  assert.ok(idleCheckFailure.includes(copy.retryCheck));
});
