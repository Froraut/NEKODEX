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
    name => Object.hasOwn(overrides, name) ? overrides[name]
      : ['./useAccountPoolSnapshot', './useAccountCodexLogin'].includes(name) ? load(compile(name.slice(2) + '.ts'), overrides)
      : name === './account-availability' ? load(compile('account-availability.ts'), {})
      : name === './AccountReadiness' ? load(compile('AccountReadiness.tsx'), {})
      : name === './AccountToolsOnboarding' ? { AccountToolsOnboarding: () => null } : require(name));
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
  const state = [], refs = [], effectSlots = [];
  let stateIndex = 0, refIndex = 0, effectIndex = 0, effects = [], stateUpdates = 0;
  const react = {
    ...React,
    useState(initial) {
      const index = stateIndex++;
      if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
      return [state[index], value => { state[index] = typeof value === "function" ? value(state[index]) : value; stateUpdates += 1; }];
    },
    useRef(initial) {
      const index = refIndex++;
      if (!(index in refs)) refs[index] = { current: initial };
      return refs[index];
    },
    useEffect(callback, deps) {
      const index = effectIndex++;
      const previous = effectSlots[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        effects.push(() => {
          previous?.cleanup?.();
          const slot = { deps, cleanup: callback() };
          effectSlots[index] = slot;
          return () => { slot.cleanup?.(); slot.cleanup = undefined; };
        });
      }
    },
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
    "./session-issue-copy": { sessionIssueCopy: () => workflow.session.verificationUnavailableBody },
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
  const setError = () => {};
  return {
    render() { stateIndex = 0; refIndex = 0; effectIndex = 0; effects = []; return AccountSettings({ copy, language: "en", openBrowser() {}, setError, manual: false,
      toolsSetup: { runtimeConfigured: true, connectorName: 'Codex Native6', urls: {} },
      focusAccountId: null, onSetupTools() {} }); },
    flushEffects() {
      const cleanups = effects.splice(0).map(effect => effect());
      return () => cleanups.forEach(cleanup => cleanup?.());
    },
    stateUpdates: () => stateUpdates,
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

for (const delayed of [true, false]) {
  test(`quota cooldown ${delayed ? "expired during deferred hydration enables refresh" : "in the future stays blocked until its deadline wakeup"}`, async () => {
    const originalNow = Date.now;
    const originalWindow = global.window;
    const mountedAt = Date.parse("2026-09-22T12:00:00Z");
    let now = mountedAt, snapshotReads = 0, providerRefreshes = 0, resolveSnapshot;
    const snapshot = new Promise(resolve => { resolveSnapshot = resolve; });
    const quota = { accountId: "a", availability: "unavailable", reason: "rate_limited",
      retryAt: new Date(mountedAt + 1_000).toISOString(), freshUntil: null, additionalBuckets: [] };
    Date.now = () => now;
    try {
      const view = accountHarness(snapshot, null, {}, "a", {
        accountCodexQuotaSnapshot(id) { assert.equal(id, "a"); snapshotReads += 1; return snapshot; },
        refreshAccountCodexQuota() { providerRefreshes += 1; throw new Error("unexpected provider refresh"); },
        refreshAccountCodexQuotas() { providerRefreshes += 1; throw new Error("unexpected batch refresh"); },
      });
      view.render(); view.flushEffects(); await flush();
      view.render(); view.flushEffects();
      assert.equal(snapshotReads, 1, "deferred snapshot IPC boundary was reached");
      assert.equal(findCodexControls(view.render()).props.quota, null);
      if (delayed) now += 2_000;
      resolveSnapshot(quota); await flush();
      let tree = view.render();
      assert.equal(findCodexControls(tree).props.quota, quota, "the intended snapshot reached the component");
      const timers = new Map();
      window.setTimeout = (callback, delay) => { const id = timers.size + 1; timers.set(id, { callback, delay }); return id; };
      window.clearTimeout = id => timers.delete(id);
      const cleanup = view.flushEffects();
      if (!delayed) {
        assert.equal(findCodexControls(tree).props.quotaDisabledReason, "Rate limited");
        assert.equal(findButton(tree, "Refresh all").props.disabled, true);
        assert.equal(timers.size, 1);
        const timer = [...timers.values()][0];
        assert.equal(timer.delay, 1_050);
        now += timer.delay;
        const beforeWakeup = view.stateUpdates();
        timer.callback();
        assert.equal(view.stateUpdates(), beforeWakeup + 1, "deadline wakes component state");
        cleanup();
        tree = view.render();
        view.flushEffects();
      }
      assert.equal(findCodexControls(tree).props.quotaDisabledReason, undefined);
      assert.equal(findButton(tree, "Refresh all").props.disabled, false);
      assert.equal(findCodexControls(tree).props.quotaNow, now);
      assert.equal(timers.size, 0, "expired evidence leaves no deadline timer");
      assert.equal(snapshotReads, 1);
      assert.equal(providerRefreshes, 0);
    } finally {
      Date.now = originalNow;
      if (originalWindow === undefined) delete global.window;
      else global.window = originalWindow;
    }
  });
}

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
  view.render(); view.flushEffects(); await flush();
  view.render(); view.flushEffects();
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
  view.flushEffects();
  await flush();
  view.render();
  view.flushEffects();
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
  view.render(); view.flushEffects(); await flush();
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
  view.render(); view.flushEffects(); await flush();
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
  view.render(); view.flushEffects(); await flush(); view.render(); view.flushEffects(); await flush();
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
    "./session-issue-copy": { sessionIssueCopy: () => workflow.session.verificationUnavailableBody },
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
  view.render(); view.flushEffects(); await flush();
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
  view.render(); view.flushEffects(); await flush(); view.render(); view.flushEffects(); await flush();
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


test("account tools check keeps its explicit account even when another account is selected", async () => {
  const checks = [];
  const view = accountHarness(Promise.resolve(null), null, { connectorReady: false }, "b", {
    checkAccount: async (id, connector) => { checks.push({ id, connector }); return view.api.accounts(); },
  });
  view.render(); view.flushEffects(); await flush();
  function findTools(node) {
    if (!node || typeof node !== "object") return null;
    if (typeof node.props?.onVerify === "function" && node.props?.account?.id) return node;
    for (const child of [node.props?.children].flat(Infinity)) {
      const found = findTools(child); if (found) return found;
    }
    return null;
  }
  const card = findTools(view.render());
  assert.equal(card.props.account.id, "a");
  assert.equal(card.props.disabled, false);
  card.props.onVerify(); await flush();
  assert.deepEqual(checks, [{ id: "a", connector: true }]);
  delete global.window;
});

test('wave2 session-limit resume stays account-scoped and preserves active-work gating', async () => {
  const resumed = [];
  const safety = { policy: {}, stopped: false, cooldownUntil: 0, newSessionWindow: null };
  function findSafety(node) {
    if (!node || typeof node !== 'object') return null;
    if (node.props?.safety === safety) return node;
    for (const child of [node.props?.children].flat(Infinity)) {
      const found = findSafety(child); if (found) return found;
    }
    return null;
  }
  try {
    for (const [reason, activeTurns, required, disabled] of [
      ['session-limit', 0, true, false], ['session-limit', 1, true, true],
      ['cooldown', 0, false, false], [null, 0, false, false],
    ]) {
      const view = accountHarness(Promise.resolve(null), null, {
        safety, activeTurns, availability: { eligible: reason === null, reason, retryAt: null },
      }, 'a', { resumeAccount: async id => { resumed.push(id); return view.api.accounts(); } });
      view.render(); view.flushEffects(); await flush();
      const props = findSafety(view.render()).props;
      assert.equal(props.resumeRequired, required);
      assert.equal(props.disabled, disabled);
      if (required && !disabled) { props.resume(); await flush(); }
    }
    assert.deepEqual(resumed, ['a']);
  } finally { delete global.window; }
});
