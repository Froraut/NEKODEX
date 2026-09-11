const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
function load(file, overrides = {}) {
  const source = fs.readFileSync(path.join(__dirname, "../src", file), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const loaded = { exports: {} };
  Function("module", "exports", "require", compiled)(loaded, loaded.exports, name => overrides[name] || require(name));
  return loaded.exports;
}
const { copyFor } = load("i18n.ts");
const { ExistingChromeLoginGuide } = load("ExistingChromeLoginGuide.tsx");
const progress = (phase, overrides = {}) => ({
  phase, startedAt: new Date().toISOString(), deadlineAt: new Date(Date.now() + 120000).toISOString(),
  active: ["consent", "discovering", "waiting-for-chrome", "reading-session", "verifying", "cancelling"].includes(phase),
  canCopySettings: ["discovering", "waiting-for-chrome", "failed", "timed-out", "cancelled"].includes(phase),
  canCancel: ["discovering", "waiting-for-chrome", "reading-session", "verifying"].includes(phase), error: null, ...overrides,
});
test("existing Chrome phases render scoped instructions in every language without importing on render", () => {
  for (const language of ["en", "zh-CN", "ja"]) {
    const copy = copyFor(language);
    for (const phase of ["consent", "discovering", "waiting-for-chrome", "reading-session", "verifying", "cancelling", "cancelled", "failed", "timed-out", "completed"]) {
      const html = renderToStaticMarkup(React.createElement(ExistingChromeLoginGuide, { progress: progress(phase, { error: phase === "failed" ? "SECRET raw CDP output" : null }), copy, onRetry: () => { throw new Error("Unexpected import"); }, setError: () => {} }));
      assert.doesNotMatch(html, /SECRET|href=|https:\/\/sensitive/);
      assert.ok(html.includes('role="status"'));
      if (phase === "waiting-for-chrome") assert.ok(html.includes("chrome://inspect/#remote-debugging"));
      if (phase === "completed") assert.ok(html.includes(copy.existingChromeDone));
    }
  }
  assert.doesNotMatch(copyFor("en").existingChromeSteps, /close Chrome|fresh|new profile/i);
});

function harness(api, currentProgress) {
  const state = [], refs = []; let stateIndex = 0, refIndex = 0;
  const module = load("ExistingChromeLoginGuide.tsx", { react: {
    useState(initial) { const index = stateIndex++; if (!(index in state)) state[index] = initial; return [state[index], value => { state[index] = value; }]; },
    useRef(initial) { const index = refIndex++; if (!(index in refs)) refs[index] = { current: initial }; return refs[index]; },
    useEffect() {},
  } });
  const errors = [];
  global.window = { codexWebLauncher: api };
  return { errors, render() { stateIndex = 0; refIndex = 0; return module.ExistingChromeLoginGuide({ progress: currentProgress, copy: copyFor("en"), onRetry: api.retry, setError: value => errors.push(value) }); } };
}
function buttons(node) {
  if (!node || typeof node !== "object") return [];
  if (node.type === "button") return [node];
  return [node.props?.children].flat(Infinity).flatMap(buttons);
}
const flush = () => new Promise(resolve => setImmediate(resolve));
test("copying settings only calls the fixed copy IPC and duplicate cancellation stays locked", async () => {
  const calls = []; let cancelDone;
  const view = harness({ copyExistingChromeSettingsAddress: async () => calls.push("copy"), cancelExistingChromeLogin: () => { calls.push("cancel"); return new Promise(resolve => { cancelDone = resolve; }); }, retry: async () => calls.push("retry") }, progress("waiting-for-chrome"));
  assert.deepEqual(calls, []);
  let controls = buttons(view.render());
  controls[0].props.onClick(); await flush();
  assert.deepEqual(calls, ["copy"]);
  controls = buttons(view.render());
  assert.equal(controls[0].props.children, copyFor("en").existingChromeCopied);
  controls[1].props.onClick(); controls[1].props.onClick();
  assert.deepEqual(calls, ["copy", "cancel"]);
  assert.equal(buttons(view.render())[1].props.disabled, true);
  cancelDone(); await flush();
  assert.equal(buttons(view.render())[1].props.disabled, false);
  delete global.window;
});
test("failed API controls show fixed text and terminal retries never use the fresh-profile API", async () => {
  let retry = 0;
  const view = harness({ copyExistingChromeSettingsAddress: async () => { throw new Error("SECRET"); }, retry: async () => { retry++; } }, progress("failed"));
  const controls = buttons(view.render());
  controls[0].props.onClick(); await flush();
  assert.deepEqual(view.errors, [copyFor("en").existingChromeFailure]);
  controls[1].props.onClick(); await flush();
  assert.equal(retry, 1);
  delete global.window;
});
