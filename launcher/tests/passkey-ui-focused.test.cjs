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
  Function("module", "exports", "require", compiled)(loaded, loaded.exports, name => {
    if (overrides[name]) return overrides[name];
    if (name.startsWith("./") && name.endsWith(".json")) {
      return { default: JSON.parse(fs.readFileSync(path.join(__dirname, "../src", name), "utf8")) };
    }
    return require(name);
  });
  return loaded.exports;
}

const { copyFor } = load("i18n.ts");
const { passkeyFailureText } = load("passkey-copy.ts");
const { PasskeyLoginGuide } = load("PasskeyLoginGuide.tsx", {
  "./passkey-copy": { passkeyFailureText },
});

function progress(phase, overrides = {}) {
  return {
    phase,
    startedAt: new Date().toISOString(),
    deadlineAt: new Date(Date.now() + 120_000).toISOString(),
    active: ["starting", "waiting", "importing", "verifying", "cancelling"].includes(phase),
    canImport: phase === "waiting",
    canReveal: phase === "waiting",
    canCancel: ["starting", "waiting", "importing", "verifying"].includes(phase),
    error: null,
    revealError: null,
    ...overrides,
  };
}

test("passkey error codes render localized safe text and never expose unknown details", () => {
  for (const language of ["en", "ru", "zh-CN", "zh-TW", "ja", "ko"]) {
    const copy = copyFor(language);
    assert.equal(passkeyFailureText("passkey-timeout", copy), copy.passkeyTimedOut);
    assert.equal(passkeyFailureText("passkey-reveal-failed", copy), copy.passkeyRevealFailed);
    assert.equal(passkeyFailureText("SECRET /Users/alex/private", copy), copy.passkeyFailed);
    const html = renderToStaticMarkup(React.createElement(PasskeyLoginGuide, {
      progress: progress("failed", { error: "SECRET /Users/alex/private" }),
      copy, onRetry() {}, setError() {},
    }));
    assert.ok(html.includes(copy.passkeyFailed));
    assert.doesNotMatch(html, /SECRET|\/Users\/alex/);
  }
});

test("passkey controls retain phase and transition gates", () => {
  const copy = copyFor("en");
  const waiting = renderToStaticMarkup(React.createElement(PasskeyLoginGuide, {
    progress: progress("waiting"), copy, onRetry() {}, setError() {}, transitionBusy: true,
  }));
  assert.match(waiting, new RegExp(`<button[^>]*disabled=""[^>]*>${copy.passkeyReveal}</button>`));
  assert.match(waiting, new RegExp(`<button[^>]*>${copy.passkeyCancel}</button>`));
  assert.ok(!waiting.includes(`>${copy.retry}</button>`));

  const failed = renderToStaticMarkup(React.createElement(PasskeyLoginGuide, {
    progress: progress("failed", { error: "passkey-verification-failed" }),
    copy, onRetry() {}, setError() {}, transitionBusy: false,
  }));
  assert.ok(failed.includes(`>${copy.retry}</button>`));
  assert.ok(!failed.includes(`>${copy.passkeyCancel}</button>`));
  assert.ok(!failed.includes(`>${copy.passkeyReveal}</button>`));
});

function harness(api, currentProgress) {
  const state = [], refs = []; let stateIndex = 0; let refIndex = 0;
  const module = load("PasskeyLoginGuide.tsx", {
    "./passkey-copy": { passkeyFailureText },
    react: {
      useState(initial) { const index = stateIndex++; if (!(index in state)) state[index] = initial; return [state[index], value => { state[index] = value; }]; },
      useRef(initial) { const index = refIndex++; if (!(index in refs)) refs[index] = { current: initial }; return refs[index]; },
      useEffect() {},
    },
  });
  const errors = [];
  global.window = { codexWebLauncher: api };
  return { errors, render() { stateIndex = 0; refIndex = 0; return module.PasskeyLoginGuide({
    progress: currentProgress, copy: copyFor("en"), onRetry: api.retry, setError: value => errors.push(value),
  }); } };
}

function buttons(node) {
  if (!node || typeof node !== "object") return [];
  if (node.type === "button") return [node];
  return [node.props?.children].flat(Infinity).flatMap(buttons);
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test("passkey action failures use fixed UI copy and keep duplicate actions locked", async () => {
  let rejectReveal;
  const view = harness({
    revealPasskeyLogin: () => new Promise((_resolve, reject) => { rejectReveal = reject; }),
    cancelPasskeyLogin: async () => {}, retry: async () => {},
  }, progress("waiting"));
  const reveal = buttons(view.render()).find(button => button.props.children === copyFor("en").passkeyReveal);
  reveal.props.onClick();
  reveal.props.onClick();
  rejectReveal(new Error("SECRET /Users/alex/private"));
  await flush();
  assert.deepEqual(view.errors, [copyFor("en").passkeyRevealFailed]);
  delete global.window;
});
