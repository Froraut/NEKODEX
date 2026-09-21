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

function load(compiled, overrides) {
  const loaded = { exports: {} };
  Function("module", "exports", "require", compiled)(loaded, loaded.exports,
    name => Object.hasOwn(overrides, name) ? overrides[name] : require(name));
  return loaded.exports;
}

const codexCopy = {
  quotaTitle: "Allowance", quotaRefresh: "Refresh", quotaChecking: "Checking", quotaNotChecked: "Not checked",
  quotaUnavailable: "Allowance unavailable", quotaSignedOut: "Signed out", quotaManualUnavailable: "Manual unavailable",
  quotaRateLimited: "Rate limited", quotaReportedOnly: "Reported only", quotaRefreshAll: "Refresh all",
  loginTitle: "Codex login", loginBody: "Login body", loginAction: "Start", loginStarting: "Starting",
};

test("a failed quota load is rendered inline as an alert", () => {
  const { AccountCodexControls } = load(compile("AccountCodexControls.tsx"), {
    react: React,
    "./i18n": { accountCodexCopyFor: () => codexCopy },
  });
  const html = renderToStaticMarkup(React.createElement(AccountCodexControls, {
    account: { id: "a", label: "A" }, copy: codexCopy, language: "en", login: null, loginAction: null,
    loginStarting: false, quota: null, quotaBusy: false, quotaFailed: true,
    onCancelLogin: async () => {}, onCopyCode: async () => true, onOpenLogin: async () => {},
    onRefreshQuota: async () => {}, onStartLogin: async () => {},
  }));
  assert.match(html, /role="alert"[^>]*>Allowance unavailable/);
  assert.doesNotMatch(html, />Not checked</);
});

function accountHarness(snapshotPromise, refreshValue, accountOverrides = {}, selectedId = "a") {
  const state = [], refs = [];
  let stateIndex = 0, refIndex = 0, effects = [];
  const react = {
    ...React,
    useState(initial) {
      const index = stateIndex++;
      if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
      return [state[index], value => { state[index] = typeof value === "function" ? value(state[index]) : value; }];
    },
    useRef(initial) {
      const index = refIndex++;
      if (!(index in refs)) refs[index] = { current: initial };
      return refs[index];
    },
    useEffect(callback) { effects.push(callback); },
  };
  function AccountCodexControls() { return null; }
  const api = {
    accounts: async () => ({ mode: "selected", selectedId, accounts: [{
      id: "a", label: "Account A", accountLabel: "a@example.test", authenticated: true, enabled: true,
      activeTurns: 0, checked: true, connectorReady: true, evidenceEpoch: 1,
      ...accountOverrides,
    }] }),
    accountCodexQuotaSnapshot: () => snapshotPromise,
    refreshAccountCodexQuota: async () => refreshValue,
    codexLoginSnapshot: async () => null,
    onBrowserState: () => () => {}, onOperation: () => () => {},
  };
  global.window = { codexWebLauncher: api, setTimeout(callback) { queueMicrotask(callback); return 1; }, clearTimeout() {} };
  const { AccountSettings } = load(compile("AccountSettings.tsx"), {
    react,
    "./icons": { Icon: () => null },
    "./AccountSafetySettings": { AccountSafetySettings: () => null },
    "./AccountProxySettings": { AccountProxySettings: () => null },
    "./AccountCodexControls": { AccountCodexControls },
    "./i18n": { accountCodexCopyFor: () => codexCopy },
    "./account-codex.css": {},
  });
  const copy = {
    accountsTitle: "Accounts", accountsLoading: "Loading", accountsRefreshFailed: "Failed", retry: "Retry",
    accountsRouting: "Routing", accountsSelected: "Selected", accountsBalanced: "Balanced", loading: "Loading",
    accountsCurrent: "Current", accountsActive: "Active", accountsChecked: "Checked", connectionVerified: "Ready",
    connectionPending: "Needs setup", toolConnection: "Tools", accountsEnabled: "Enabled", replaceCredentials: "Replace",
    accountsSignIn: "Sign in", accountsSignInNeeded: "Sign-in not verified", accountsSignedIn: "Signed in",
    accountsSelect: "Select", accountsCheck: "Check", accountsCheckConnector: "Check tools", accountsAdd: "Add",
    accountsLabel: "Label", accountsManual: "Manual mode", accountsBusyTasks: "Busy {count}",
  };
  return {
    render() { stateIndex = 0; refIndex = 0; effects = []; return AccountSettings({ copy, language: "en", openBrowser() {}, setError() {}, manual: false }); },
    effects: () => effects,
    AccountCodexControls,
  };
}

function findCodexControls(node) {
  if (!node || typeof node !== "object") return null;
  if (Object.hasOwn(node.props ?? {}, "quotaFailed") && Object.hasOwn(node.props ?? {}, "onRefreshQuota")) return node;
  for (const child of [node.props?.children].flat(Infinity)) {
    const found = findCodexControls(child);
    if (found) return found;
  }
  return null;
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test("a rejected hydration marks only that account as failed", async () => {
  let rejectSnapshot;
  const pendingSnapshot = new Promise((_resolve, reject) => { rejectSnapshot = reject; });
  const view = accountHarness(pendingSnapshot, null);
  view.render(); view.effects()[0](); await flush();
  view.render(); view.effects()[2]();
  rejectSnapshot(new Error("quota unavailable"));
  await flush();
  const controls = findCodexControls(view.render());
  assert.equal(controls.props.quotaFailed, true);
  assert.equal(controls.props.quota, null);
  delete global.window;
});

test("a newer successful refresh clears failure and supersedes a late hydration rejection", async () => {
  let rejectSnapshot;
  const pendingSnapshot = new Promise((_resolve, reject) => { rejectSnapshot = reject; });
  const quota = { availability: "available", coverage: "reported_buckets", additionalBuckets: [] };
  const view = accountHarness(pendingSnapshot, quota);
  view.render();
  view.effects()[0]();
  await flush();
  view.render();
  view.effects()[2]();
  let controls = findCodexControls(view.render());
  await controls.props.onRefreshQuota();
  rejectSnapshot(new Error("late hydration failure"));
  await flush();
  controls = findCodexControls(view.render());
  assert.equal(controls.props.quotaFailed, false);
  assert.equal(controls.props.quota, quota);
  delete global.window;
});

test("disabled selection references its visible readiness explanation", async () => {
  const view = accountHarness(Promise.resolve(null), null, { checked: false, connectorReady: false }, "other");
  view.render(); view.effects()[0](); await flush();
  const tree = view.render();
  const buttons = [];
  (function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "button") buttons.push(node);
    for (const child of [node.props?.children].flat(Infinity)) visit(child);
  })(tree);
  const select = buttons.find(button => button.props.children === "Select");
  assert.equal(select.props.disabled, true);
  assert.match(select.props["aria-describedby"], /^account-action-reason-/);
  const described = select.props["aria-describedby"];
  let reason;
  (function visit(node) {
    if (!node || typeof node !== "object" || reason) return;
    if (node.props?.id === described) reason = node;
    for (const child of [node.props?.children].flat(Infinity)) visit(child);
  })(tree);
  assert.equal(reason.props.children, "Needs setup");
  delete global.window;
});
