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
const { UpdateProgress } = load("UpdateProgress.tsx", { "./update-copy": { updateCopyFor } });
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


function descendants(node) {
  if (!React.isValidElement(node)) return [];
  return [node, ...React.Children.toArray(node.props.children).flatMap(descendants)];
}

test("lifecycle transitions disable install with an explanation and preserve cancellation", () => {
  let installs = 0, cancels = 0;
  const props = {
    language: "en", currentVersion: "5.9.0", state: { status: "available", version: "6.0.0" },
    error: null, busy: false, blocked: false, checking: false, cooldown: false,
    transitionBusy: true, onCheck() {}, onInstall() { installs++; }, onCancel() { cancels++; },
  };
  const button = (tree, handler) => descendants(tree).find(node => node.type === "button" && node.props.onClick === handler);
  const waiting = Updates(props);
  assert.equal(button(waiting, props.onInstall).props.disabled, true);
  assert.ok(renderToStaticMarkup(waiting).includes(updateCopyFor("en").wait));
  const ready = Updates({ ...props, transitionBusy: false });
  const install = button(ready, props.onInstall);
  assert.equal(install.props.disabled, false);
  install.props.onClick();
  assert.equal(installs, 1);
  assert.ok(!renderToStaticMarkup(ready).includes(updateCopyFor("en").wait));
  for (const status of ["downloading", "verifying"]) {
    const cancel = button(Updates({ ...props, busy: true, state: { ...props.state, status } }), props.onCancel);
    assert.equal(cancel.props.disabled, false);
    cancel.props.onClick();
  }
  assert.equal(cancels, 2);
  assert.equal(button(Updates({ ...props, busy: true, cancelling: true,
    state: { ...props.state, status: "cancelling" } }), props.onCancel).props.disabled, true);
});

const transfer = { status: "downloading", version: "6.0.0", downloadedBytes: 1048576,
  totalBytes: 4194304, bytesPerSecond: 524288, remainingSeconds: 6 };
const progressMarkup = (patch = {}, language = "en") => renderToStaticMarkup(
  React.createElement(UpdateProgress, { state: { ...transfer, ...patch }, label: "Progress", language }));

test("worker handoff supersedes an outstanding cancellation request", () => {
  const props = {
    language: "en", currentVersion: "5.9.0", busy: true, blocked: false,
    checking: false, cooldown: false, error: null, cancelling: true,
    onCheck() {}, onInstall() {}, onCancel() {},
  };
  const copy = updateCopyFor("en");
  const render = status => renderToStaticMarkup(React.createElement(Updates, {
    ...props, state: { status, version: "6.0.0" },
  }));
  const preparing = render("verifying");
  assert.ok(preparing.includes(renderedText(copy.cancelling)));
  assert.ok(preparing.includes(copy.cancellingBody));
  const handedOff = render("installing");
  assert.ok(handedOff.includes(renderedText(copy.installing)));
  assert.ok(handedOff.includes(copy.restart));
  assert.ok(!handedOff.includes(copy.cancellingBody));
  assert.ok(!handedOff.includes(copy.cancelling));
  assert.ok(!handedOff.includes("<button"), "handoff cannot expose cancellation or another updater action");
});

test("download estimate and accessible transfer description use observed telemetry", () => {
  const markup = progressMarkup();
  const eta = "About 6 sec remaining in download";
  assert.ok(markup.includes(`>${eta}</small>`));
  assert.match(markup, /aria-valuenow="25"/);
  assert.ok(markup.includes(`aria-valuetext="1.0 MiB / 4.0 MiB (25.0%); 0.5 MiB/s; ${eta}"`));
  assert.ok(!markup.includes("aria-live"));
  assert.ok(progressMarkup({ remainingSeconds: 61 }).includes("About 2 min remaining in download"));
  assert.ok(progressMarkup({ remainingSeconds: 3601 }).includes("About 2 hr remaining in download"));
  for (const language of ["ru", "zh-CN", "zh-TW", "ja", "ko"]) {
    const localized = progressMarkup({}, language);
    assert.ok(!localized.includes("About "));
    assert.ok(!localized.includes("{duration}"));
    assert.ok(localized.includes(updateCopyFor(language).downloadRemaining.split("{duration}")[0]));
  }
});

test("unknown or unusable telemetry never fabricates a download ETA or percentage", () => {
  for (const patch of [
    { remainingSeconds: null }, { remainingSeconds: 0 }, { remainingSeconds: -1 },
    { remainingSeconds: Infinity }, { remainingSeconds: NaN }, { bytesPerSecond: 0 },
    { bytesPerSecond: NaN }, { downloadedBytes: undefined }, { downloadedBytes: 4194304 },
    { totalBytes: undefined }, { totalBytes: Infinity }, { status: "verifying" },
  ]) assert.ok(!progressMarkup(patch).includes("remaining in download"), JSON.stringify(patch));
  const unknown = progressMarkup({ totalBytes: undefined });
  assert.ok(!unknown.includes("aria-valuenow"));
  assert.ok(!unknown.includes("%"));
  assert.ok(unknown.includes('aria-valuetext="1.0 MiB; 0.5 MiB/s"'));
  assert.ok(!progressMarkup({ status: "verifying" }).includes("aria-valuetext"));
});
