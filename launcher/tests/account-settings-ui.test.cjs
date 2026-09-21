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
const workflow = {
  session: {
    verificationUnavailable: "Verification unavailable", verificationUnavailableBody: "Could not verify the session; this does not mean signed out.",
    lastVerifiedAt: "Last verified {time}", verifiedCurrent: "Verified", verificationStale: "Stale", signedOut: "Signed out",
    retryVerification: "Retry verification", checkingVerification: "Checking verification",
  },
  portfolio: {
    refreshAll: "Refresh all", refreshing: "Refreshing", summary: "Current {updated}; Earlier {retained}; Unavailable {unavailable}; Skipped {skipped}",
    updatedCount: "Current {count}", retainedCount: "Earlier {count}", unavailableCount: "Unavailable {count}", skippedCount: "Skipped {count}",
    quotaCurrent: "Current", quotaLastKnown: "Earlier", quotaUnavailable: "Unavailable", checkedAt: "Checked {time}", retainedAt: "Retained {time}",
  },
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

function accountHarness(snapshotPromise, refreshValue, accountOverrides = {}, selectedId = "a", apiOverrides = {}) {
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
    refreshAccountCodexQuotas: async () => ({ generatedAt: new Date().toISOString(), rows: [] }),
    refreshAccountAuthentication: async () => api.accounts(),
    codexLoginSnapshot: async () => null,
    onBrowserState(callback) { api.browserStateChanged = callback; return () => {}; }, onOperation: () => () => {},
    ...apiOverrides,
  };
  global.window = { codexWebLauncher: api, setTimeout(callback) { queueMicrotask(callback); return 1; }, clearTimeout() {} };
  const { AccountSettings } = load(compile("AccountSettings.tsx"), {
    react,
    "./icons": { Icon: () => null },
    "./AccountSafetySettings": { AccountSafetySettings: () => null },
    "./AccountProxySettings": { AccountProxySettings: () => null },
    "./AccountCodexControls": { AccountCodexControls },
    "./QuotaPortfolioSummary": { QuotaPortfolioSummary: () => null },
    "./i18n": { accountCodexCopyFor: () => codexCopy },
    "./workflow-copy": { workflowCopy: () => workflow },
    "./account-codex.css": {},
    "./quota-portfolio.css": {},
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
    api,
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

function findButton(node, label) {
  if (!node || typeof node !== "object") return null;
  if (node.type === "button" && [node.props.children].flat(Infinity).includes(label)) return node;
  for (const child of [node.props?.children].flat(Infinity)) {
    const found = findButton(child, label);
    if (found) return found;
  }
  return null;
}

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

test("unavailable authentication preserves identity, fails closed, and offers scoped retry", async () => {
  let retries = 0, accountReads = 0;
  const unavailable = { id: "a", label: "Account A", accountLabel: "a@example.test", authenticated: false,
    authenticationStatus: "unavailable", lastVerifiedAt: "2026-09-21T10:00:00Z",
    enabled: true, activeTurns: 0, checked: true, connectorReady: true, evidenceEpoch: 1 };
  const verified = { id: "a", label: "Account A", accountLabel: "a@example.test", authenticated: true,
    authenticationStatus: "verified", enabled: true, activeTurns: 0, checked: true, connectorReady: true, evidenceEpoch: 2 };
  const view = accountHarness(Promise.resolve(null), null, {}, "other", {
    accounts: async () => ({ mode: "selected", selectedId: "other", accounts: [accountReads++ === 0 ? unavailable : verified] }),
    refreshAccountAuthentication: async () => {
    retries += 1;
    return { mode: "selected", selectedId: "other", accounts: [verified] };
  } });
  view.render(); view.effects()[0](); await flush();
  let tree = view.render();
  assert.match(renderToStaticMarkup(tree), /a@example\.test/);
  assert.equal(findButton(tree, "Select").props.disabled, true);
  const retry = findButton(tree, "Retry verification");
  assert.ok(retry); await retry.props.onClick(); await flush();
  tree = view.render();
  assert.equal(retries, 1);
  assert.equal(findButton(tree, "Retry verification"), null);
  delete global.window;
});

test("batch quota refresh retains old values until current-epoch partial result settles", async () => {
  let resolvePortfolio;
  const oldQuota = { availability: "available", coverage: "reported_buckets", accountId: "a",
    accountBucket: { id: "account", name: null, normalModelSlug: null, allowed: true, limitReached: false,
      primary: { usedPercent: 1, remainingPercent: 99, windowDurationMins: 300, resetsAt: null },
      secondary: { usedPercent: null, remainingPercent: null, windowDurationMins: null, resetsAt: null } },
    additionalBuckets: [], additionalBucketsTruncated: false };
  const retained = { ...oldQuota, freshness: "stale", refreshError: "unavailable" };
  const portfolio = new Promise(resolve => { resolvePortfolio = resolve; });
  const view = accountHarness(Promise.resolve(oldQuota), null, {}, "a", {
    refreshAccountCodexQuotas: () => portfolio,
  });
  view.render(); view.effects()[0](); await flush(); view.render(); view.effects()[2](); await flush();
  let tree = view.render();
  const refreshAll = findButton(tree, "Refresh all");
  refreshAll.props.onClick();
  tree = view.render();
  let controls = findCodexControls(tree);
  assert.equal(controls.props.quota, oldQuota);
  assert.equal(controls.props.quotaBusy, true);
  resolvePortfolio({ generatedAt: "2026-09-21T11:00:00Z", rows: [{ accountId: "a", evidenceEpoch: 1,
    status: "retained", snapshot: retained, reason: "unavailable" }] });
  await flush();
  controls = findCodexControls(view.render());
  assert.equal(controls.props.quota, retained);
  assert.equal(controls.props.quotaFailed, true);
  assert.equal(controls.props.quotaBusy, false);
  delete global.window;
});

test("freshness clock selects the earliest quota expiry or retry without a provider read", () => {
  const { nextQuotaClockAt } = load(compile("AccountSettings.tsx"), {
    react: React, "./icons": { Icon: () => null },
    "./AccountSafetySettings": { AccountSafetySettings: () => null },
    "./AccountProxySettings": { AccountProxySettings: () => null },
    "./AccountCodexControls": { AccountCodexControls: () => null },
    "./QuotaPortfolioSummary": { QuotaPortfolioSummary: () => null },
    "./i18n": { accountCodexCopyFor: () => codexCopy }, "./workflow-copy": { workflowCopy: () => workflow },
    "./account-codex.css": {}, "./quota-portfolio.css": {},
  });
  const now = Date.parse("2026-09-21T10:00:00Z");
  assert.equal(nextQuotaClockAt([
    { freshUntil: "2026-09-21T10:05:00Z", retryAt: "2026-09-21T10:10:00Z" },
    { freshUntil: "2026-09-21T10:03:00Z" },
  ], now), Date.parse("2026-09-21T10:03:00Z"));
  assert.equal(nextQuotaClockAt([{ freshUntil: "2026-09-21T09:59:00Z" }], now), null);
});

test("unavailable authentication retry is blocked by active ownership with a visible reason and no sign-in action", async () => {
  let retries = 0;
  const view = accountHarness(Promise.resolve(null), null, {
    authenticated: false, authenticationStatus: "unavailable", activeTurns: 1,
  }, "other", { refreshAccountAuthentication: async () => { retries += 1; return view.api.accounts(); } });
  view.render(); view.effects()[0](); await flush();
  const tree = view.render();
  assert.equal(findButton(tree, "Sign in"), null);
  const retry = findButton(tree, "Retry verification");
  assert.equal(retry.props.disabled, true);
  assert.match(retry.props["aria-describedby"], /^account-auth-retry-reason-/);
  retry.props.onClick(); await flush();
  assert.equal(retries, 0);
  delete global.window;
});

test("stale batch cleanup releases its busy owner after account evidence changes", async () => {
  let resolvePortfolio, accountReads = 0;
  const account = epoch => ({ id: "a", label: "Account A", accountLabel: "a@example.test", authenticated: true,
    enabled: true, activeTurns: 0, checked: true, connectorReady: true, evidenceEpoch: epoch });
  const oldQuota = { availability: "available", coverage: "reported_buckets", accountId: "a",
    accountBucket: { id: "account", name: null, normalModelSlug: null, allowed: true, limitReached: false,
      primary: { usedPercent: 1, remainingPercent: 99, windowDurationMins: 300, resetsAt: null },
      secondary: { usedPercent: null, remainingPercent: null, windowDurationMins: null, resetsAt: null } },
    additionalBuckets: [], additionalBucketsTruncated: false };
  const portfolio = new Promise(resolve => { resolvePortfolio = resolve; });
  const view = accountHarness(Promise.resolve(oldQuota), null, {}, "a", {
    accounts: async () => ({ mode: "selected", selectedId: "a", accounts: [account(accountReads++ === 0 ? 1 : 2)] }),
    refreshAccountCodexQuotas: () => portfolio,
  });
  view.render(); view.effects()[0](); await flush(); view.render(); view.effects()[2](); await flush();
  findButton(view.render(), "Refresh all").props.onClick();
  view.api.browserStateChanged({}); await flush(); view.render();
  resolvePortfolio({ generatedAt: "2026-09-21T11:00:00Z", rows: [{ accountId: "a", evidenceEpoch: 1,
    status: "updated", snapshot: { ...oldQuota, evidenceEpoch: 1 }, reason: null }] });
  await flush();
  const controls = findCodexControls(view.render());
  assert.equal(controls.props.quotaBusy, false);
  assert.notEqual(controls.props.quota?.evidenceEpoch, 1);
  delete global.window;
});
