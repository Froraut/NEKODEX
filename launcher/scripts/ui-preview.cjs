// Credential-free UI fixture. Build the renderer first, then run this file with
// Node or Bun and open the loopback URL it prints. No Electron or ChatGPT calls.
// Scenarios: ?scenario=embedded, passkey, passkey-failed, onboarding, startup-error,
// existing-chrome-failed, setup-fresh, manual-tools, accounts-failed, update-active, update-available,
// diagnostics-redirect, benefits-auth-unavailable, benefits-portfolio-mixed, benefits-insights,
// benefits-repair-success, benefits-repair-failure, browser-ui-signed-out, browser-ui-ready, browser-ui-error,
// browser-ui-home-loading, browser-ui-manual (a Manual mode turn waiting for the user to send its prompt),
// picker-refresh (the Web model list changed: restart Codex, then confirm its picker again).
// passkey-retry-pending (Retry waits for a host operation; Cancel must still settle that operation).
// startup-loading (the first snapshot waits; Try again recovers), startup-slow (a delayed successful launch).
// Account forms: accounts-ui-ready, accounts-ui-error (first add/save attempt fails).
// benefits-portfolio-mixed also has launcher log events (Overview "Recent events", Activity), recorded
// tasks with their browser tabs and a waiting queue (Task center); benefits-insights has the same events and
// a usage store (Web messages, native responses, lifetime totals) that usage() projects for every period.
// Add &language=en|ru|zh-CN|zh-TW|ja|ko to choose the launcher language (default en).
// Add &no-animation-frames=true to keep requestAnimationFrame callbacks permanently paused.
// Add &appearance=system|dark|light to choose the saved launcher appearance (default dark).
// Add &context-capabilities=true to report Sol/Pro context capabilities (Settings context budget table).
// Every method in electron/preload.cjs (and nothing else) has a mock that resolves or refuses like its IPC handler,
// including the DEV-profile refusals and the active-turn guards, and emits state changes as the main process
// would; onLifecycle exists only in benefits-astra and browser-ui-ready. The first routing check on a page
// reports a catalog redirect failure; later checks pass.
// Page hooks: window.fixtureCalls, fixtureSetBrowser/Accounts/Update/State/Operation, fixtureEmitLog(record),
// fixtureOpenUpdates() (native "Check for Updates…" menu), fixtureFocusAddress() (⌘L inside the ChatGPT page), fixtureCompleteCodexLogin() (finish the device code
// sign-in); set window.fixtureCancelExport / fixtureCancelUninstall / fixtureCancelTurns to simulate a cancelled
// save or confirmation dialog. A setup or context change leaves the model catalog waiting for Codex to reload
// it, as in the app: fixtureSetState({ codexCatalogVerified: true }) stands in for that reload.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const dist = path.resolve(process.env.UI_PREVIEW_DIST || path.join(__dirname, "../dist"));

function installMockLauncher() {
  const parameters = new URLSearchParams(location.search);
  const scenario = parameters.get("scenario") || "embedded";
  if (parameters.get("no-animation-frames") === "true") {
    window.fixtureAnimationRequests = 0;
    window.requestAnimationFrame = () => { window.fixtureAnimationRequests++; return 1; };
    window.cancelAnimationFrame = () => {};
  }
  // Every language in electron/languages.json.
  const languages = ["en", "ru", "zh-CN", "zh-TW", "ja", "ko"];
  const language = languages.includes(parameters.get("language")) ? parameters.get("language") : "en";
  const appearances = ["system", "dark", "light"];
  const appearance = appearances.includes(parameters.get("appearance")) ? parameters.get("appearance") : "dark";
  if (scenario.startsWith("startup-")) {
    // The production shell remembers these before its next launch too.
    localStorage.setItem("nekodex.language", language);
    localStorage.setItem("nekodex.appearance", appearance);
  }
  const browserUiScenario = scenario.startsWith("browser-ui-");
  const accountsUiScenario = scenario.startsWith("accounts-ui-");
  const benefitsScenario = scenario.startsWith("benefits-") || browserUiScenario || accountsUiScenario;
  const astraScenario = scenario === "benefits-astra" || scenario === "browser-ui-ready";
  const listeners = {};
  const emit = (name, value) => (listeners[name] || []).forEach((listener) => listener(value));
  const listen = (name) => (listener) => {
    (listeners[name] ||= []).push(listener);
    return () => { listeners[name] = listeners[name].filter((candidate) => candidate !== listener); };
  };
  // Every field of DEFAULT_STATE in electron/state.cjs, so switches are controlled as in the app.
  const state = {
    version: 1, language, onboardingComplete: scenario !== "onboarding", githubOpened: false, xOpened: false,
    autoStart: false, keepRunningOnClose: true, showBrowserDuringTurns: true, showNetworkIssueNotice: true,
    manualSubmitTimeoutSec: 120, passkeyBrowser: "chrome", browserInteractionMode: "automatic",
    experimentalAsyncToolOperations: false, experimentalBiggerContext: false, experimentalSkillAttachments: false,
    allowWebSubagents: false, experimentalFreshConversationPerTurn: false, useSavedChats: false,
    pendingBiggerContext: null, contextChangeApplying: false, contextChangeError: null,
    zeroRiskProEnabled: false, sidebarOpen: true, sidebarWidth: 252,
    browserSmokePassed: false, browserSmokeVersion: null, coreSetupComplete: false, codexCatalogVerified: false,
    mcpGuideStep: 0, appearance,
  };
  if (scenario === "manual-tools" || scenario === "browser-ui-manual") state.browserInteractionMode = "manual";
  const browser = {
    status: "signed-out", message: "Fixture sign-in", url: "https://auth.openai.com/auth_challenge/passkey", title: "Sign in",
    authenticated: false, visible: true, surfaceActive: false, loading: false, canGoBack: true, canGoForward: true,
    zoomFactor: 1, navigationLocked: true, loginInProgress: true, loginKind: scenario === "passkey" ? "passkey" : "embedded",
    activeTabId: "fixture-home", maxTabs: 5,
    tabs: [
      { id: "fixture-home", traceId: null, title: "Sign in", status: "signed-out", loading: false, active: true, closable: false },
      { id: "fixture-help", traceId: null, title: "Fixture tab", status: "idle", loading: false, active: false, closable: true },
    ],
  };
  if (scenario === "setup-fresh" || scenario === "diagnostics-redirect") {
    Object.assign(browser, { navigationLocked: false, loginInProgress: false, loginKind: null, visible: false });
  }
  if (scenario === "passkey-failed" || scenario === "passkey-retry-pending") {
    Object.assign(browser, { navigationLocked: false, loginInProgress: false, loginKind: null, visible: false,
      passkeyLogin: { phase: "failed", startedAt: new Date().toISOString(), deadlineAt: new Date().toISOString(),
        active: false, canImport: false, canReveal: false, canCancel: false,
        error: "passkey-verification-failed", revealError: null } });
  }
  if (scenario === "models-ready" || scenario === "tools-pending" || scenario === "picker-refresh" || benefitsScenario) {
    Object.assign(state, { coreSetupComplete: true, codexCatalogVerified: true, codexPickerConfirmed: true, browserSmokePassed: true,
      browserSmokeVersion: "fixture", mcpRuntimeInstalled: scenario === "tools-pending" || benefitsScenario,
      mcpSetupComplete: benefitsScenario });
    Object.assign(browser, { authenticated: true, accountLabel: "fixture@example.test", status: "ready",
      authenticationStatus: "verified", authenticationCheckedAt: "2026-09-21T10:00:00.000Z",
      lastVerifiedAt: "2026-09-21T10:00:00.000Z",
      navigationLocked: false, loginInProgress: false, loginKind: null, visible: false });
  }
  if (scenario === "picker-refresh") {
    // The model list changed after the picker was confirmed: Codex still shows its startup list.
    Object.assign(state, { codexPickerConfirmed: false, codexRestartRequired: true, codexPickerContract: "e".repeat(64) });
  }
  if (scenario === "benefits-auth-unavailable") {
    Object.assign(browser, { authenticated: false, authenticationStatus: "unavailable",
      authenticationCheckedAt: "2026-09-21T10:08:00.000Z", lastVerifiedAt: "2026-09-21T09:55:00.000Z",
      accountLabel: "retained@example.test", status: "error", message: "Fixture authentication check unavailable" });
  }
  if (scenario === "benefits-repair-success" || scenario === "benefits-repair-failure") {
    // Native readiness is a runtime capability, not a BrowserTab. Keep only an idle retained
    // browser tab: an active Web/manual turn would correctly make tunnel repair ineligible.
    browser.activeTabId = "fixture-retained-tab";
    browser.tabs = [{ id: "fixture-retained-tab", traceId: null, title: "Retained workspace tab",
      status: "idle", loading: false, active: true, closable: true, interactionMode: "automatic" }];
  }
  let operation = scenario === "passkey" ? { name: "passkey-login", status: "running", message: "Waiting in Chrome" } : null;
  let pendingPasskeyFinish = null;
  if (scenario === "existing-chrome-failed") {
    Object.assign(browser, { navigationLocked: false, loginInProgress: false, loginKind: null, visible: false,
      existingChromeLogin: { phase: "failed", startedAt: new Date().toISOString(), deadlineAt: new Date().toISOString(),
        active: false, canCancel: false, canCopySettings: true, canAllowFileAccess: true, error: "chrome-profile-access-denied" } });
    operation = { name: "existing-chrome-login", status: "failed", message: "Fixture Chrome access was denied" };
  }
  if (scenario === "passkey-secondary" || scenario === "passkey-secondary-error") {
    state.launcherRestartRequired = true;
    browser.accountId = "12345678-1234-4123-8123-123456789abc";
    browser.accountName = "Secondary";
    browser.tabs[0].title = "Verifying it's you… - OpenAI account authentication";
  }
  let update = scenario === "update-recheck" ? { status: "error", message: "Fixture offline" }
    : scenario === "update-active" ? { status: "verifying", version: "9.9.9" }
      : scenario === "update-available" ? { status: "available", version: "9.9.9" }
      : scenario === "update-missing-speed" ? { status: "downloading", version: "9.9.9", downloadedBytes: 4096, totalBytes: 8192 }
        : { status: "disabled" };
  const defaultPolicy = { enabled: false, minIntervalSec: 10, maxConcurrent: 1, breakAfterMinutes: 30,
    breakMinutes: 5, maxSessionMinutes: 240, cooldownMinutes: 3, newSessionWindow: null };
  // Plus plan: Sol and Extra High answer, Pro is not offered.
  const checkedCapabilities = { solAvailable: true, extraHighAvailable: true, proAvailable: false };
  let accountSnapshot = { selectedId: "fixture-primary", mode: "selected", accounts: [
    // checked is "a model check recorded capabilities" (electron/account-pool.cjs), so a checked account has them.
    { id: "fixture-primary", label: "Primary", enabled: true, authenticated: true, accountLabel: "primary@example.test",
      authenticationStatus: "verified", authenticationCheckedAt: "2026-09-21T10:00:00.000Z", lastVerifiedAt: "2026-09-21T10:00:00.000Z",
      activeTurns: 0, checked: true, capabilities: { ...checkedCapabilities }, connectorReady: true, evidenceEpoch: 1, proxy: { mode: "system" },
      safety: { policy: defaultPolicy, cooldownUntil: 0, stopped: false, newSessionWindow: null } },
    { id: "fixture-secondary", label: "Secondary", enabled: true, authenticated: true, accountLabel: "secondary@example.test",
      authenticationStatus: "verified", authenticationCheckedAt: "2026-09-21T09:50:00.000Z", lastVerifiedAt: "2026-09-21T09:50:00.000Z",
      activeTurns: 0, checked: false, connectorReady: false, evidenceEpoch: 1, proxy: { mode: "system" },
      safety: { policy: defaultPolicy, cooldownUntil: 0, stopped: false, newSessionWindow: null } },
    { id: "fixture-tertiary", label: "Tertiary", enabled: true, authenticated: false, accountLabel: "retained@example.test",
      authenticationStatus: "unavailable", authenticationCheckedAt: "2026-09-21T10:08:00.000Z", lastVerifiedAt: "2026-09-21T09:40:00.000Z",
      activeTurns: 0, checked: false, connectorReady: false, evidenceEpoch: 3, proxy: { mode: "system" },
      safety: { policy: defaultPolicy, cooldownUntil: 0, stopped: false, newSessionWindow: null } },
  ] };
  if (scenario === "benefits-auth-diagnostics") {
    Object.assign(browser, { authenticated: false, authenticationStatus: "unavailable", authenticationIssue: "access", accountId: "fixture-primary", url: "https://chatgpt.com/?temporary-chat=true", status: "error" });
    Object.assign(accountSnapshot.accounts[0], { authenticated: false, authenticationStatus: "unavailable", authenticationIssue: "access" });
  }
  if (!benefitsScenario) accountSnapshot = { ...accountSnapshot, accounts: accountSnapshot.accounts.slice(0, 2) };
  const quotaNow = Date.now();
  const quota = { availability: "available", coverage: "reported_buckets", accountId: "fixture-primary",
    // The service reports no name for the account-wide bucket; the renderer shows its localized label.
    planType: "plus", accountBucket: { id: "account", name: null, normalModelSlug: null,
      allowed: true, limitReached: false,
      primary: { usedPercent: 10, remainingPercent: 90, windowDurationMins: 300, resetsAt: null },
      secondary: { usedPercent: null, remainingPercent: null, windowDurationMins: null, resetsAt: null } },
    additionalBuckets: [], additionalBucketsTruncated: false, fetchedAt: new Date(quotaNow).toISOString(),
    checkedAt: new Date(quotaNow).toISOString(), freshness: "fresh", freshUntil: new Date(quotaNow + 5 * 60_000).toISOString(), refreshError: null };
  const retainedQuota = { ...quota, accountId: "fixture-secondary", freshness: "stale",
    fetchedAt: new Date(quotaNow - 4 * 60 * 60_000).toISOString(), checkedAt: new Date(quotaNow).toISOString(),
    freshUntil: new Date(quotaNow - 3 * 60 * 60_000).toISOString(),
    refreshError: "quota-refresh-unavailable", accountBucket: { ...quota.accountBucket,
      primary: { ...quota.accountBucket.primary, usedPercent: 45, remainingPercent: 55 } } };
  let quotaFailed = scenario === "accounts-failed";
  let diagnosticChecks = 0;
  // Launcher log stream: snapshot.logs seeds the renderer, logs() reads it, onLog carries later records.
  // Real event ids and detail keys from the main process; a mix of levels so the event lists show every icon.
  const at = (time) => `2026-09-21T${time}.000Z`;
  const fixtureLogs = scenario === "benefits-portfolio-mixed" || scenario === "benefits-insights" ? [
    { at: at("09:28:40"), level: "info", event: "launcher.window_created", detail: { platform: "darwin" } },
    { at: at("09:28:44"), level: "info", event: "runtime.operation_completed", detail: { name: "start" } },
    { at: at("09:29:02"), level: "info", event: "codex.model_catalog_served", detail: { requests: 1, at: at("09:29:02") } },
    { at: at("09:29:30"), level: "info", event: "connector.verified", detail: { appName: "Fixture connector" } },
    { at: at("09:30:00"), level: "info", event: "browser.turn_started", detail: { traceId: "trace-5d10e7" } },
    { at: at("09:34:41"), level: "error", event: "browser.manual_tab_navigation_failed",
      detail: { tabId: "tab-task-failed", traceId: "trace-5d10e7", message: "Fixture navigation timed out" } },
    { at: at("09:34:42"), level: "info", event: "browser.turn_ended", detail: { traceId: "trace-5d10e7", status: "failed" } },
    { at: at("09:48:02"), level: "info", event: "browser.turn_started", detail: { traceId: "trace-7f3a2c" } },
    { at: at("09:48:09"), level: "info", event: "browser.turn_ended", detail: { traceId: "trace-7f3a2c", status: "completed" } },
    { at: at("09:52:31"), level: "warning", event: "browser.session_refresh_failed", detail: { message: "Fixture session check timed out" } },
    { at: at("09:55:10"), level: "info", event: "browser.turn_started", detail: { traceId: "trace-91be04" } },
    { at: at("10:00:05"), level: "warning", event: "runtime.tunnel_status_report_failed", detail: { message: "Fixture tunnel status 502" } },
    { at: at("10:03:20"), level: "debug", event: "runtime.stdout", detail: { line: "responses proxy listening on 127.0.0.1:8765" } },
    { at: at("10:05:58"), level: "error", event: "launcher.ipc_failed", detail: { channel: "launcher:usage", message: "Fixture usage store is busy" } },
  ] : [];
  const emitLog = (record) => {
    fixtureLogs.push(record);
    if (fixtureLogs.length > 300) fixtureLogs.shift();
    emit("log", record);
  };
  // Browser tabs of the tasks that can be opened: a running turn's tab, or the tab kept after it ended. Like
  // electron/account-browser-snapshot.cjs, every account's turn tabs are listed with their owner and label.
  const taskTabTitles = { "task-running": "Review launcher logs | ChatGPT", "task-failed": "Draft release notes | ChatGPT",
    "task-uncertain": "Summarize the pull request | ChatGPT", "task-active": "Update the changelog | ChatGPT" };
  const taskTabs = (tasks) => tasks.filter(task => task.canOpen).map(task => ({ id: task.tabId, traceId: task.traceId,
    accountId: task.accountId, title: `${task.accountName} · ${taskTabTitles[task.id] ?? "ChatGPT"}`,
    status: task.terminal ? "error" : "running", loading: false, active: false, closable: true, interactionMode: "automatic" }));
  // browser-turn-lifecycle.cjs taskSnapshot(): the actions follow the task's live tab.
  const withTaskControls = (tasks, tabs) => tasks.map(task => {
    const tab = tabs.find(candidate => candidate.id === task.tabId);
    return { ...task, canOpen: Boolean(tab), canCancel: tab?.status === "running",
      canDismiss: task.terminal && tab?.status !== "running" };
  });
  if (scenario === "benefits-portfolio-mixed") {
    // Task center: recorded tasks (running, completed, needs attention) and a queue with one row per action kind.
    const time = (value) => Date.parse(at(value));
    browser.tasks = [
      { id: "task-running", traceId: "trace-91be04", accountId: "fixture-primary", accountName: "Primary", model: "High",
        phase: "responding", submission: "accepted", terminal: false, canOpen: true, canCancel: true, canDismiss: false, retrySafe: false,
        createdAt: time("09:55:10"), updatedAt: time("10:03:20") },
      { id: "task-completed", traceId: "trace-7f3a2c", accountId: "fixture-secondary", accountName: "Secondary", model: "Medium",
        phase: "completed", submission: "accepted", terminal: true, canOpen: false, canCancel: false, canDismiss: true, retrySafe: false,
        createdAt: time("09:48:02"), updatedAt: time("09:48:09") },
      { id: "task-failed", traceId: "trace-5d10e7", accountId: "fixture-primary", accountName: "Primary", model: "Pro",
        phase: "failed-after-send", submission: "accepted", terminal: true, canOpen: true, canCancel: false, canDismiss: true, retrySafe: false,
        createdAt: time("09:30:00"), updatedAt: time("09:34:42") },
    ].map((task, index) => ({ ...task, tabId: `tab-${task.id}`, sequence: index + 1 }));
    // A task that can be opened keeps its browser tab: the running turn and the retained failed one.
    browser.tabs = [...browser.tabs, ...taskTabs(browser.tasks)];
    browser.queue = { paused: false, pausedAccounts: [], storageIssue: null,
      accounts: accountSnapshot.accounts.map(account => ({ id: account.id, label: account.label })),
      entries: [
        { id: "queued-review", traceId: "trace-queued-review", accountId: "fixture-primary", status: "waiting", reason: null,
          createdAt: time("10:04:00"), position: 1, retryAt: null, ownerConnected: true,
          canCancel: true, canPrioritize: true, canResume: false, canDismiss: false },
        { id: "queued-docs", traceId: "trace-queued-docs", accountId: "fixture-secondary", status: "paused", reason: null,
          createdAt: time("10:05:00"), position: 2, retryAt: null, ownerConnected: true,
          canCancel: true, canPrioritize: false, canResume: true, canDismiss: false },
        { id: "queued-interrupted", traceId: "trace-queued-interrupted", accountId: "fixture-tertiary", status: "interrupted", reason: null,
          createdAt: time("09:20:00"), position: 0, retryAt: null, ownerConnected: false,
          canCancel: false, canPrioritize: false, canResume: false, canDismiss: true },
      ] };
  }
  // Admission order for queueAction ("Move to front" raises a row's priority, as the main process does).
  const queuePriority = new Map();
  const openQueueStatus = ["waiting", "paused", "admitting"];
  const withQueuePositions = (entries) => {
    const ordered = entries.filter(entry => openQueueStatus.includes(entry.status))
      .sort((a, b) => (queuePriority.get(b.id) ?? 0) - (queuePriority.get(a.id) ?? 0) || a.createdAt - b.createdAt);
    return entries.map(entry => ({ ...entry, position: ordered.indexOf(entry) + 1 }));
  };
  // Usage store. benefits-insights records 27 Web messages (two accounts) and 3 native responses over the last
  // seven days, plus older lifetime totals. usage() projects the store like electron/usage-report.cjs, so the
  // calendar, totals, durations, failures, diagnostic groups and detail rows agree for every period, source
  // and account. Over seven days: 27 messages, 24 timed (median 4.1 s, p95 9.2 s), failures 2 timeout,
  // 1 browser failure, 1 transport. Other scenarios have an empty store.
  const usageEnd = "2026-09-21";
  const usageDay = (offset) => new Date(Date.parse(`${usageEnd}T00:00:00Z`) - offset * 86_400_000).toISOString().slice(0, 10);
  const insights = scenario === "benefits-insights";
  const webIdentity = (accountId) => ({ accountId, mode: "automatic", effort: accountId === "fixture-primary" ? "high" : "medium",
    modelVersion: "5.6-sol", modelVersionSource: "observed", messageKind: "task" });
  // [day offset, account, outcome, accepted→outcome ms (null: not timed), failure code]
  const webMessages = (insights ? [
    [6, "fixture-primary", "completed", 3900], [6, "fixture-primary", "completed", 4300], [6, "fixture-primary", "completed", null],
    [5, "fixture-primary", "completed", 2800], [5, "fixture-primary", "completed", 4100], [5, "fixture-primary", "completed", 5200],
    [5, "fixture-primary", "completed", 7400], [5, "fixture-secondary", "failed", 6400, "transport"],
    [3, "fixture-primary", "completed", 3300], [3, "fixture-primary", "completed", 4600], [3, "fixture-primary", "completed", 3600],
    [3, "fixture-primary", "completed", 6100], [3, "fixture-primary", "completed", 2400], [3, "fixture-primary", "failed", 9200, "timeout"],
    [2, "fixture-primary", "completed", 4000], [2, "fixture-secondary", "completed", 3000],
    [1, "fixture-primary", "completed", 3100], [1, "fixture-primary", "completed", 4100], [1, "fixture-primary", "completed", 5600],
    [1, "fixture-primary", "completed", 8300], [1, "fixture-primary", "completed", 3500], [1, "fixture-primary", "failed", 11800, "timeout"],
    [1, "fixture-primary", "cancelled", null],
    [0, "fixture-primary", "completed", 3800], [0, "fixture-primary", "completed", 6800],
    [0, "fixture-primary", "failed", 2600, "browser_failure"], [0, "fixture-secondary", "completed", null],
  ] : []).map(([offset, accountId, outcome, durationMs, failureCode = null]) => ({ day: usageDay(offset),
    ...webIdentity(accountId), outcome, durationMs, failureCode }));
  // [day offset, outcome, ms (null: no receipt), failure code, reported tokens]
  const nativeMessages = (insights ? [
    [5, "completed", 1800, null, { input: 9120, output: 1200, cached: 6000, reasoning: 320 }],
    [1, "completed", 2400, null, { input: 8840, output: 1110, cached: 6000, reasoning: 288 }],
    [1, "failed", null, "transport", null],
  ] : []).map(([offset, outcome, durationMs, failureCode, tokens]) => ({ day: usageDay(offset), endpoint: "responses",
    modelId: "gpt-5.6-sol", modelIdSource: "requested", outcome, durationMs, failureCode, tokens }));
  const webLifetimeGroups = insights ? [
    { ...webIdentity("fixture-primary"), accepted: 142, completed: 131, failed: 8, aborted: 3 },
    { ...webIdentity("fixture-secondary"), accepted: 17, completed: 15, failed: 2, aborted: 0 },
  ] : [];
  const nativeLifetimeGroups = insights ? [{ endpoint: "responses", modelId: "gpt-5.6-sol", modelIdSource: "requested",
    accepted: 12, completed: 10, incomplete: 1, failed: 1, aborted: 0 }] : [];
  const usageStartedAt = insights ? "2026-08-02T09:12:00.000Z" : "2026-09-14T08:00:00.000Z";
  const durationSummary = (values) => {
    if (!values.length) return { observedSamples: 0, medianMs: null, p95Ms: null };
    const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
    return { observedSamples: sorted.length, medianMs: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
      p95Ms: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] };
  };
  const tally = (messages) => ({ accepted: messages.length, completed: messages.filter(m => m.outcome === "completed").length,
    incomplete: messages.filter(m => m.outcome === "incomplete").length, failed: messages.filter(m => m.outcome === "failed").length,
    aborted: messages.filter(m => m.outcome === "cancelled").length });
  const knownOf = (counts) => counts.completed + counts.incomplete + counts.failed + counts.aborted;
  const failureList = (messages) => {
    const counts = new Map();
    for (const m of messages) if (m.outcome === "failed") counts.set(m.failureCode ?? "unknown", (counts.get(m.failureCode ?? "unknown") ?? 0) + 1);
    return [...counts].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  };
  const groupBy = (messages, keyOf) => [...messages.reduce((groups, m) => groups.set(keyOf(m), [...(groups.get(keyOf(m)) ?? []), m]),
    new Map())].sort(([a], [b]) => a.localeCompare(b)).map(([, list]) => list);
  const usageFor = ({ days, source, accountId }) => {
    const period = { startDay: usageDay(days - 1), endDay: usageEnd, days };
    const calendarDays = Array.from({ length: days }, (_, index) => usageDay(days - 1 - index));
    const native = source === "native";
    const included = native ? nativeMessages.filter(m => m.day >= period.startDay)
      : webMessages.filter(m => m.day >= period.startDay && (accountId === null || m.accountId === accountId));
    const identity = native ? (m => ({ endpoint: m.endpoint, modelId: m.modelId, modelIdSource: m.modelIdSource }))
      : (m => webIdentity(m.accountId));
    const identityKey = m => Object.values(identity(m)).join(":");
    // Web timings need a recorded outcome; native timings come from response receipts.
    const timed = list => list.filter(m => (native || m.outcome) && m.durationMs !== null).map(m => m.durationMs);
    const counts = tally(included), known = knownOf(counts);
    const metrics = { total: counts.accepted, messageCount: counts.accepted, completed: counts.completed, failed: counts.failed,
      cancelled: counts.aborted, unrecorded: counts.accepted - known, knownOutcomeTotal: known,
      knownOutcomeCompletionRate: known ? counts.completed / known : null,
      ...(native ? { incomplete: counts.incomplete, responseCount: counts.accepted }
        : { runCountCoverage: { observedMessages: counts.accepted, totalMessages: counts.accepted, complete: true } }) };
    const calendar = calendarDays.map(day => {
      const dayCounts = tally(included.filter(m => m.day === day));
      return { day, total: dayCounts.accepted, completed: dayCounts.completed, failed: dayCounts.failed, cancelled: dayCounts.aborted,
        ...(native ? { incomplete: dayCounts.incomplete } : {}), unrecorded: dayCounts.accepted - knownOf(dayCounts) };
    });
    const diagnosticGroups = groupBy(included, identityKey).map(list => {
      const groupCounts = tally(list), groupKnown = knownOf(groupCounts), failures = failureList(list);
      return { source: source, ...identity(list[0]), accepted: groupCounts.accepted, completed: groupCounts.completed,
        failed: groupCounts.failed, cancelled: groupCounts.aborted, ...(native ? { incomplete: groupCounts.incomplete } : {}),
        knownOutcomeTotal: groupKnown, knownOutcomeCompletionRate: groupKnown ? groupCounts.completed / groupKnown : null,
        durations: { ...durationSummary(timed(list)), eligibleSamples: groupKnown }, failures,
        classifiedFailureSamples: failures.reduce((sum, failure) => sum + (failure.code === "unknown" ? 0 : failure.count), 0) };
    });
    const rows = groupBy(included, m => `${m.day}:${identityKey(m)}`)
      .map(list => ({ day: list[0].day, ...identity(list[0]), ...tally(list) }));
    const lifetimeGroups = native ? nativeLifetimeGroups
      : webLifetimeGroups.filter(group => accountId === null || group.accountId === accountId);
    const lifetimeUnclassified = !native && insights && accountId === null ? 4 : 0;
    const reported = included.filter(m => m.tokens);
    const tokenSum = key => reported.length ? reported.reduce((sum, m) => sum + m.tokens[key], 0) : null;
    return { available: true, startedAt: usageStartedAt, recovered: false, backupAvailable: true,
      lifetime: lifetimeGroups.reduce((sum, group) => sum + group.accepted, lifetimeUnclassified),
      lifetimeGroups: structuredClone(lifetimeGroups), lifetimeUnclassified, rows,
      generatedAt: "2026-09-21T10:00:00.000Z", timeZone: "UTC", source, period,
      selectedAccountId: native ? null : accountId,
      accounts: native ? [] : accountSnapshot.accounts.map(account => ({ id: account.id, label: account.label, available: true })),
      metrics, durations: durationSummary(timed(included)), failures: failureList(included), diagnosticGroups, calendar,
      ...(native ? { tokens: { inputTokens: tokenSum("input"), outputTokens: tokenSum("output"),
        cachedInputTokens: tokenSum("cached"), reasoningTokens: tokenSum("reasoning"), reportedSamples: reported.length,
        unreportedSamples: included.length - reported.length, cachedInputReportedSamples: reported.length,
        reasoningReportedSamples: reported.length } } : {}) };
  };
  let runtimeCapabilities = benefitsScenario ? { runtimeStatus: "ready", nativeAvailability: "ready", webAvailability: "ready",
    tunnelStatus: "ready", tunnelRepair: { eligible: false, active: false, reason: null } } : undefined;
  if (scenario === "benefits-repair-success" || scenario === "benefits-repair-failure") {
    runtimeCapabilities = { runtimeStatus: "degraded", nativeAvailability: "ready", webAvailability: "degraded",
      tunnelStatus: "failed", tunnelRepair: { eligible: true, active: false, reason: "tunnel-unavailable" } };
  }
  const contextCapabilities = parameters.get("context-capabilities") === "true"
    ? { solAvailable: true, proAvailable: true, extraHighAvailable: true } : null;
  // The main process's external links (electron/main.cjs); openExternal accepts exactly these.
  const externalUrls = { github: "https://github.com/Froraut/NEKODEX", x: "", connectors: "https://chatgpt.com/plugins",
    developerMode: "https://chatgpt.com/#settings/Security?section=developer-mode",
    tunnels: "https://platform.openai.com/settings/organization/tunnels", keys: "https://platform.openai.com/settings/organization/api-keys" };
  const allowedExternalUrls = new Set(Object.values(externalUrls).filter(Boolean));
  // Runtime configuration owned by the main process; the setting mocks below change it.
  const connectorNames = { automatic: "Fixture connector", manual: "Fixture manual" };
  let mcpCredentialsConfigured = scenario === "tools-pending";
  let browserCapacity = { configured: 16, active: 16, maximum: 1000, restartRequired: false };
  let proModelVersion = null;
  let compactionModel = null;
  // The DEV profile verifies its catalog while installing (IS_DEV_PROFILE in electron/main.cjs).
  const devProfile = !(scenario === "models-ready" || scenario === "tools-pending" || scenario === "picker-refresh" || benefitsScenario);
  const snapshot = () => ({
    profile: devProfile ? "development" : "production", profilePaths: { coreHome: "", codexHome: "", userData: "" },
    state: { ...state }, browser: { ...browser }, connectorName: "Fixture connector",
    connectorNames: { ...connectorNames }, mcpCredentialsConfigured, proModelVersion, compactionModel,
    logs: fixtureLogs.slice(), urls: { ...externalUrls },
    browserCapacity: { ...browserCapacity },
    platform: "darwin", packaged: false, version: "fixture", smokePassed: state.browserSmokePassed, operation, update,
    ...(runtimeCapabilities ? { runtimeCapabilities } : {}),
    ...(contextCapabilities ? { contextCapabilities } : {}),
  });
  let startupAttempts = 0;
  const calls = [];
  window.fixtureCalls = calls;
  if (astraScenario) {
    browser.accountId = "fixture-primary";
    browser.tasks = [
      { id: "task-complete", traceId: "trace-complete", accountId: "fixture-primary", accountName: "Primary", model: "High", phase: "completed", submission: "accepted", terminal: true, canOpen: false, canCancel: false, canDismiss: true, retrySafe: false },
      { id: "task-uncertain", traceId: "trace-review-uncertain", accountId: "fixture-primary", accountName: "Primary", model: "Pro", phase: "send-uncertain", submission: "uncertain", terminal: true, canOpen: true, canCancel: false, canDismiss: true, retrySafe: false },
      { id: "task-active", traceId: "trace-active", accountId: "fixture-secondary", accountName: "Secondary", model: "Medium", phase: "responding", submission: "accepted", terminal: false, canOpen: true, canCancel: true, canDismiss: false, retrySafe: false },
    ].map((task, index) => ({ ...task, tabId: `tab-${task.id}`, createdAt: Date.now() - 60000, updatedAt: Date.now(), sequence: index + 1 }));
    // browser-ui-ready keeps only its home tab (its screenshots), so its tasks have no live tab to open or cancel.
    if (scenario === "benefits-astra") browser.tabs = [...browser.tabs, ...taskTabs(browser.tasks)];
    else browser.tasks = withTaskControls(browser.tasks, browser.tabs);
    browser.queue = { paused: true, pausedAccounts: ["fixture-primary"], storageIssue: null,
      accounts: [{ id: "fixture-primary", label: "Primary" }, { id: "fixture-secondary", label: "Secondary" }],
      entries: [{ id: 'queued-history', traceId: 'trace-waiting-for-history', accountId: 'fixture-primary', status: 'waiting', reason: 'task-history-unavailable', createdAt: Date.now(), position: 1, retryAt: null, ownerConnected: true, canCancel: false, canPrioritize: false, canResume: false, canDismiss: false }] };
    browser.workspaces = { platform: "darwin", nativeTabs: true, maximum: 8, total: 1, accounts: [
      { accountId: "fixture-primary", label: "Primary", nativeTabs: true, restoreAttempted: true,
        restoreResult: { opened: 0, skippedTemporary: 0, skippedCapacity: 1, skippedIdentity: 0 }, manifestStatus: "ready",
        items: [
          { id: "workspace-live", groupId: "group-1", state: "open", kind: "window", title: "Current conversation", location: "https://chatgpt.com/c/live", restorable: true, needsOriginalAccount: false, temporary: false, active: true },
          { id: "workspace-saved", groupId: "group-1", state: "saved", kind: "tab", title: "Saved conversation", location: "https://chatgpt.com/c/saved", restorable: true, needsOriginalAccount: false, temporary: false, active: false },
        ] },
      // Every account has a directory row (the account picker lists them), even with no windows.
      ...accountSnapshot.accounts.filter(account => account.id !== "fixture-primary").map(account => ({ accountId: account.id,
        label: account.label, nativeTabs: true, restoreAttempted: true, restoreResult: null, manifestStatus: "ready", items: [] })),
    ] };
  }
  if (browserUiScenario) {
    const signedOut = scenario !== "browser-ui-ready" && scenario !== "browser-ui-manual";
    Object.assign(browser, { accountId: "fixture-primary", accountName: "Primary", visible: false,
      navigationLocked: false, loginInProgress: false, loginKind: null, passkeyLogin: null,
      authenticated: !signedOut, authenticationStatus: signedOut ? "signed-out" : "verified",
      status: signedOut ? "signed-out" : "ready", url: "https://chatgpt.com/auth/login",
      activeTabId: "home", maxTabs: 16,
      tabs: [{ id: "home", traceId: null, title: "Get started | ChatGPT", status: signedOut ? "signed-out" : "ready",
        loading: false, active: true, closable: false }],
      workspaces: { platform: "darwin", nativeTabs: true, maximum: 16, total: 0,
        accounts: accountSnapshot.accounts.map(account => ({ accountId: account.id, label: account.label,
          nativeTabs: true, restoreAttempted: true, restoreResult: null, manifestStatus: "ready", items: [] })) },
    });
    accountSnapshot.accounts = accountSnapshot.accounts.map(account => ({ ...account,
      authenticated: !signedOut, authenticationStatus: signedOut ? "signed-out" : "verified" }));
  }
  if (scenario === "browser-ui-manual") {
    // A Manual mode turn whose prompt the user still has to copy into ChatGPT and send.
    browser.tabs = [{ ...browser.tabs[0], active: false }, { id: "manual-turn", traceId: "trace-manual-turn",
      title: "Manual task | ChatGPT", status: "running", loading: false, active: true, closable: true,
      interactionMode: "manual", manualState: "awaiting-user", canCopyPrompt: true, canConfirmSent: true,
      manualDeadlineAt: new Date(Date.now() + state.manualSubmitTimeoutSec * 1000).toISOString() }];
    browser.activeTabId = "manual-turn";
  }
  const networkIssue = parameters.get("network-issue");
  if (networkIssue === "egress-unstable" || networkIssue === "challenge-route") {
    Object.assign(browser, { networkIssue, networkIssueCheckedAt: new Date().toISOString() });
  }
  if (scenario === "browser-ui-home-loading") {
    browser.status = "loading"; browser.loading = true; browser.tabs[0].status = "loading"; browser.tabs[0].loading = true;
  }
  if (accountsUiScenario) Object.assign(browser, { accountId: "fixture-primary", accountName: "Primary", accountLabel: "primary@example.test" });
  // The account pool names its selected account in every browser state (electron/account-browser-snapshot.cjs), so
  // Retry verification has an account to refresh. Single-account scenarios keep the unnamed default account.
  if (benefitsScenario && !browser.accountId) {
    const selected = accountSnapshot.accounts.find(account => account.id === accountSnapshot.selectedId);
    Object.assign(browser, { accountId: selected.id, accountName: selected.label });
  }
  let accountSequence = 0;
  const accountFailures = new Set();
  const accountMutation = async (kind) => {
    if (!accountsUiScenario) return;
    await new Promise(resolve => setTimeout(resolve, 250));
    if (scenario === "accounts-ui-error" && !accountFailures.has(kind)) {
      accountFailures.add(kind);
      throw new Error(`Fixture ${kind} failed. Your draft is preserved; try again.`);
    }
  };
  let workspaceSequence = 0;
  let workspaceFailed = false;
  const clientConnections = { api: { enabled: false, configured: false, keyFingerprint: null, baseUrl: 'http://127.0.0.1:8765/v1' },
    claude: { installed: false, ready: false, model: null, issue: null },
    provider: { installed: true, active: true, mode: 'mixed', issue: null } };
  // Shared effects of the IPC handlers in electron/main.cjs and electron/ipc/*.cjs.
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const nowIso = () => new Date().toISOString();
  const publishState = () => { emit("state", { ...state }); return { ...state }; };
  const publishBrowser = () => { emit("browser", { ...browser }); return { ...browser }; };
  const publishOperation = (next) => { operation = next; emit("operation", next); };
  const publishUpdate = (next) => { update = next; emit("update", next); };
  // stateStore.update and its invariants (electron/state.cjs); handlers publish the result themselves.
  const updateState = (patch) => {
    const modeChanged = "browserInteractionMode" in patch && patch.browserInteractionMode !== state.browserInteractionMode;
    Object.assign(state, patch, modeChanged ? { mcpSetupComplete: false, browserSmokePassed: false, browserSmokeVersion: null,
      setupVerifiedAt: null, pickerVerifiedAt: null } : {});
    if (state.coreSetupComplete === false) {
      Object.assign(state, { codexCatalogVerified: false, codexPickerConfirmed: false, codexPickerContract: null,
        mcpSetupComplete: false, experimentalAsyncToolOperations: false });
    } else if (patch.codexCatalogVerified === false) state.codexPickerConfirmed = false;
    // Like state.cjs, the restart request changes only explicitly; confirming the picker clears it.
    if (state.browserInteractionMode === "manual" || state.coreSetupComplete === false) {
      Object.assign(state, { pendingBiggerContext: null, contextChangeError: null, contextChangeApplying: false });
    }
    return { ...state };
  };
  const invalidateAccountProof = () => updateState({ mcpSetupComplete: false, browserSmokePassed: false,
    browserSmokeVersion: null, setupVerifiedAt: null, pickerVerifiedAt: null });
  // A running tab is an active turn (browserHost.activeTraceId); runtime and browser changes wait for it.
  const activeTurn = () => browser.tabs.find(tab => tab.status === "running") ?? null;
  const assertBrowserIdleFor = (subject) => {
    if (activeTurn()) throw new Error(`Finish or cancel active ChatGPT turns before changing ${subject}`);
    if (operation?.status === "running") throw new Error(`Finish ${operation.name} before changing ${subject}`);
  };
  const assertNoActiveWork = (message) => { if (activeTurn() || operation?.status === "running") throw new Error(message); };
  const requireAutomatic = (subject) => {
    if (state.browserInteractionMode === "manual") throw new Error(`${subject} is disabled in Manual mode`);
  };
  // runtimeHost.runSetup: a named operation runs, then commits; callers update state right after it completes.
  const runSetup = async (name, message, successMessage) => {
    publishOperation({ name, status: "running", message });
    await delay(350);
    publishOperation({ name, status: "completed", message: successMessage });
  };
  const selectedAccountPatch = (patch) => {
    accountSnapshot = { ...accountSnapshot, accounts: accountSnapshot.accounts.map(account => account.id === accountSnapshot.selectedId
      ? { ...account, ...patch } : account) };
  };
  // Bigger Context is queued and applied between turns (electron/context-change-queue.cjs).
  let contextTimer = null;
  const scheduleContextChange = () => {
    if (contextTimer !== null || typeof state.pendingBiggerContext !== "boolean" || state.contextChangeError) return;
    contextTimer = setTimeout(async () => {
      contextTimer = null;
      const desired = state.pendingBiggerContext;
      if (typeof desired !== "boolean") return;
      if (activeTurn() || operation?.status === "running") { scheduleContextChange(); return; }
      if (state.experimentalBiggerContext === desired) {
        updateState({ pendingBiggerContext: null, contextChangeError: null }); publishState(); return;
      }
      updateState({ contextChangeApplying: true }); publishState();
      await delay(600);
      invalidateAccountProof();
      updateState({ experimentalBiggerContext: desired, codexCatalogVerified: false, codexPickerConfirmed: false,
        codexRestartRequired: true, contextChangeError: null, contextChangeApplying: false,
        ...(state.pendingBiggerContext === desired ? { pendingBiggerContext: null } : {}) });
      publishState();
      scheduleContextChange();
    }, 2000);
  };
  // Codex device-code sign-in (electron/codex-login.cjs); fixtureCompleteCodexLogin() finishes it.
  let codexLogin = null;
  let codexLoginSequence = 0;
  const codexLoginView = () => codexLogin ? structuredClone(codexLogin) : null;
  const requireCodexLogin = (flowId, accountId) => {
    if (!codexLogin || codexLogin.flowId !== flowId || codexLogin.accountId !== accountId) {
      throw new Error("This Codex sign-in is no longer current");
    }
    return codexLogin;
  };
  const settleCodexLogin = (patch) => Object.assign(codexLogin, { active: false, settling: false, canOpen: false, canCancel: false,
    verificationUrl: null, userCode: null, completedAt: nowIso(), selectionLock: null }, patch);
  // Updates: installUpdate walks download → verify → install; the app would then quit into the new version.
  let updateInstall = null;
  let updateRequestRevision = 0;
  const zoomFactors = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
  const updateTab = (tabId, patch) => {
    browser.tabs = browser.tabs.map(tab => tab.id === tabId ? { ...tab, ...patch } : tab);
  };
  window.codexWebLauncher = {
    setPreference: async (key, value) => {
      calls.push(["set-preference", key, value]);
      if (key === "appearance" && !appearances.includes(value)) throw new Error("Appearance must be System, Dark or Light");
      state[key] = value;
      if (key === "appearance") emit("state", { ...state });
      return { ...state };
    },
    getClientConnections: async () => structuredClone(clientConnections),
    changeClientConnection: async action => {
      calls.push(['client-connection', action]);
      await new Promise(resolve => setTimeout(resolve, 150));
      if (action === 'api-enable') Object.assign(clientConnections.api, { enabled: true, configured: true });
      if (action === 'api-disable') clientConnections.api.enabled = false;
      if (action === 'api-rotate' || action === 'api-disable') {
        if (clientConnections.claude.installed) Object.assign(clientConnections.claude, { ready: false, issue: 'Reconnect Claude after replacing or disabling the key' });
      }
      if (action === 'claude-connect') {
        Object.assign(clientConnections.api, { enabled: true, configured: true });
        Object.assign(clientConnections.claude, { installed: true, ready: true, model: 'chatgpt-web/gpt-6-astra', issue: null });
      }
      if (action === 'claude-disconnect') Object.assign(clientConnections.claude, { installed: false, ready: false, model: null, issue: null });
      if (action.startsWith('provider-')) clientConnections.provider.mode = action.slice('provider-'.length);
      return structuredClone(clientConnections);
    },
    copyClientApiKey: async () => { calls.push(['api-key-copy']); return { copied: true }; },
    snapshot: async () => {
      if (scenario === "startup-loading" && startupAttempts++ === 0) return await new Promise(() => {});
      if (scenario === "startup-slow" && startupAttempts++ === 0) await delay(2_000);
      if (scenario === "startup-error" && startupAttempts++ === 0) throw new Error("Error invoking remote method 'launcher:snapshot': Error: Fixture runtime unavailable");
      return snapshot();
    },
    recheckUpdate: async () => {
      calls.push(["update-recheck"]);
      // An update that is already available (or being prepared) stays; otherwise this build is current.
      if (update.status !== "available" && !updateInstall) publishUpdate({ status: "up-to-date" });
      return update;
    },
    onStateChanged: listen("state"), onBrowserState: listen("browser"), onOperation: listen("operation"), onLog: listen("log"), onUpdateState: listen("update"),
    onBrowserFocusAddress: listen("focus-address"),
    setBrowserBounds: async bounds => { window.fixtureBounds = bounds; return true; },
    setBrowserSurfaceActive: async (active) => { browser.surfaceActive = active; return { ...browser }; },
    openBrowserWorkspace: async (accountId, { asTab, address }) => {
      calls.push(["workspace-open", accountId, asTab, ...(address ? [address] : [])]);
      if (address !== undefined && !/^https:\/\/chatgpt\.com\//.test(address)) throw new Error("Only ChatGPT pages open in an account window");
      if (scenario === "browser-ui-error" && !workspaceFailed) { workspaceFailed = true; throw new Error("Fixture window could not open. Try again."); }
      const account = browser.workspaces.accounts.find(account => account.accountId === accountId);
      const id = `workspace-${++workspaceSequence}`;
      account.items.push({ id, groupId: "fixture-group", state: "open", kind: asTab ? "tab" : "window",
        title: `${account.label} · ${asTab ? "Window tab" : "Separate window"} ${workspaceSequence}`,
        location: address ?? "https://chatgpt.com/?temporary-chat=true", temporary: !address, active: true, restorable: false });
      browser.workspaces.total++;
      emit("browser", { ...browser }); return { ...browser };
    },
    closeBrowserWorkspace: async (accountId, id) => {
      const account = browser.workspaces.accounts.find(account => account.accountId === accountId);
      account.items = account.items.filter(item => item.id !== id); browser.workspaces.total--;
      emit("browser", { ...browser }); return { ...browser };
    },
    focusBrowserWorkspace: async (accountId, id) => { calls.push(["workspace-focus", accountId, id]); return { ...browser }; },
    openBrowserWindow: async asTab => { calls.push(["browser-window", asTab]); return {count:1}; },
    showBrowser: async () => { browser.visible = true; emit("browser", { ...browser }); return { ...browser }; },
    hideBrowser: async () => { browser.visible = false; emit("browser", { ...browser }); return { ...browser }; },
    // A reduced resolveBrowserAddress (electron/browser-navigation-policy.cjs): ChatGPT hosts load here, others "open externally".
    openBrowserAddress: async (address) => {
      calls.push(["address", address]);
      const text = String(address).trim();
      if (!text || /\s/.test(text) || /^[a-z-]+:(?!\/\/)/i.test(text)) throw new Error("Enter a ChatGPT page or a web address");
      const candidate = /^[/?#]/.test(text) ? `https://chatgpt.com${text.startsWith("/") ? "" : "/"}${text}`
        : /^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : /^[^/?#]*[.:]/.test(text) ? `https://${text}` : `https://chatgpt.com/${text}`;
      const url = new URL(candidate);
      if (!["chatgpt.com", "www.chatgpt.com", "chat.openai.com"].includes(url.hostname)) {
        if (/^(localhost|127\.|10\.|192\.168\.)/.test(url.hostname)) throw new Error("Local external links are blocked");
        calls.push(["external", url.toString()]);
        return { ...browser };
      }
      if (activeTurn()) throw new Error("Browser navigation is locked while ChatGPT is running a Codex turn");
      if (browser.loginInProgress) throw new Error("Browser navigation is locked during ChatGPT login");
      for (const tab of browser.tabs) tab.active = tab.id === "home";
      browser.url = `https://chatgpt.com${url.pathname}${url.search}${url.hash}`;
      emit("browser", { ...browser }); return { ...browser };
    },
    navigateBrowser: async (action) => {
      calls.push(["navigate", action]);
      if (!["back", "forward", "reload"].includes(action)) throw new Error(`Unknown browser navigation action: ${action}`);
      if (activeTurn()) throw new Error("Browser navigation is locked while ChatGPT is running a Codex turn");
      if (browser.loginInProgress) throw new Error("Browser navigation is locked during ChatGPT login");
      return { ...browser };
    },
    setupHermes: async (input) => {
      calls.push(["hermes", input]);
      if (devProfile) throw new Error("Add Hermes from the production app profile.");
      if (input?.runtime !== undefined && !["codex_responses", "codex_app_server"].includes(input.runtime)) throw new Error("Invalid Hermes runtime");
      await delay(200);
      return { provider: "nekodex", configPath: "/fixture/.hermes/config.yaml", backupPath: "/fixture/.hermes/config.yaml.bak",
        baseUrl: "http://127.0.0.1:8765/v1", defaultChanged: input?.makeDefault === true };
    },
    openPasskeyLogin: async () => {
      calls.push(["passkey"]);
      if (scenario === "passkey-secondary-error") throw new Error("passkey-capture-failed");
      browser.loginKind = "passkey";
      browser.passkeyLogin = { phase: "waiting", active: true, canImport: true, canReveal: true, canCancel: true,
        startedAt: new Date().toISOString(), deadlineAt: new Date(Date.now() + 180000).toISOString(), error: null };
      if (scenario === "passkey-retry-pending") {
        Object.assign(browser, { loginInProgress: true, navigationLocked: true });
        Object.assign(browser.passkeyLogin, { phase: "importing", chromePhase: "waiting-for-chrome",
          chromeProfileLabel: "Selected profile · selected@example.test", canImport: false, canReveal: false });
        operation = { name: "passkey-login", status: "running", message: "Waiting in Chrome" };
        emit("browser", { ...browser }); emit("operation", operation);
        return await new Promise(resolve => { pendingPasskeyFinish = resolve; });
      }
      operation = { name: "passkey-login", status: "running", message: "Waiting in Chrome" };
      emit("browser", { ...browser }); emit("operation", operation); return { ...browser };
    },
    continuePasskeyLogin: async () => {
      calls.push(["continue"]);
      if (browserUiScenario) {
        Object.assign(browser, { authenticated: true, authenticationStatus: "verified", loginKind: null,
          passkeyLogin: { ...browser.passkeyLogin, phase: "completed", active: false, canImport: false, canCancel: false, canReveal: false } });
        operation = { name: "passkey-login", status: "completed", message: "Fixture sign-in flow settled" };
        emit("browser", { ...browser }); emit("operation", operation);
      }
      return { ...browser };
    },
    revealPasskeyLogin: async () => { calls.push(["passkey-reveal"]); return true; },
    cancelPasskeyLogin: async () => {
      calls.push(["passkey-cancel"]);
      if (browserUiScenario || scenario === "passkey-retry-pending") {
        Object.assign(browser, { loginKind: null, passkeyLogin: { ...browser.passkeyLogin, phase: "cancelled",
          active: false, canImport: false, canCancel: false, canReveal: false } });
        operation = { name: "passkey-login", status: "completed", message: "Fixture sign-in flow settled" };
        browser.loginInProgress = false; browser.navigationLocked = false;
        emit("browser", { ...browser }); emit("operation", operation);
        pendingPasskeyFinish?.({ ...browser }); pendingPasskeyFinish = null;
      }
      return { ...browser };
    },
    openExistingChromeLogin: async () => { calls.push(["existing-chrome-retry"]); return { ...browser }; },
    cancelExistingChromeLogin: async () => { calls.push(["existing-chrome-cancel"]); return { ...browser }; },
    allowExistingChromeFileAccess: async () => { calls.push(["existing-chrome-file-access"]); return { ...browser }; },
    copyExistingChromeSettingsAddress: async () => { calls.push(["existing-chrome-settings-copy"]); return true; },
    selectBrowserTab: async (tabId) => {
      calls.push(["tab", tabId]);
      const target = browser.tabs.find(tab => tab.id === tabId);
      if (!target) throw new Error("Browser tab does not exist");
      // Opening another account's turn tab selects that account (electron/account-pool.cjs selectTab).
      const owner = target.accountId && accountSnapshot.accounts.find(account => account.id === target.accountId);
      if (owner && owner.id !== accountSnapshot.selectedId) {
        accountSnapshot = { ...accountSnapshot, selectedId: owner.id };
        Object.assign(browser, { accountId: owner.id, accountName: owner.label, accountLabel: owner.accountLabel ?? null,
          authenticated: owner.authenticated, authenticationStatus: owner.authenticationStatus });
      }
      browser.tabs = browser.tabs.map((tab) => ({ ...tab, active: tab.id === tabId }));
      browser.activeTabId = tabId;
      emit("browser", { ...browser }); return { ...browser };
    },
    closeBrowserTab: async (tabId) => {
      calls.push(["close-tab", tabId]);
      const closing = browser.tabs.find(tab => tab.id === tabId);
      browser.tabs = browser.tabs.filter(tab => tab.id !== tabId);
      if (closing?.active && browser.tabs.length) browser.tabs = browser.tabs.map((tab, index) => ({ ...tab, active: index === 0 }));
      browser.activeTabId = browser.tabs.find(tab => tab.active)?.id ?? null;
      // Closing a running task's tab cancels that task (Task center "Cancel task").
      if (browser.tasks?.some(task => task.tabId === tabId && !task.terminal)) {
        browser.tasks = browser.tasks.map(task => task.tabId === tabId && !task.terminal ? { ...task, phase: "cancelled",
          terminal: true, canOpen: false, canCancel: false, canDismiss: true, updatedAt: Date.now() } : task);
      }
      emit("browser", { ...browser }); return { ...browser };
    },
    accounts: async () => accountSnapshot,
    browserWorkspaceSnapshot: async () => browser.workspaces ?? { platform: "darwin", nativeTabs: true, maximum: 8, total: 0, accounts: [] },
    restoreBrowserWorkspaces: async (accountId) => {
      calls.push(["restore-workspaces", accountId]);
      const account = browser.workspaces.accounts.find(row => row.accountId === accountId);
      const saved = account.items.filter(item => item.state === "saved");
      saved.forEach(item => { item.state = "open"; });
      browser.workspaces.total += saved.length;
      account.restoreResult = { opened: saved.length, skippedTemporary: 0, skippedCapacity: 0, skippedIdentity: 0 };
      emit("browser", { ...browser }); return { ...browser };
    },
    dismissTask: async (accountId, id) => {
      calls.push(["dismiss-task", accountId, id]);
      browser.tasks = browser.tasks.filter(task => task.accountId !== accountId || task.id !== id);
      emit("browser", { ...browser }); return { ...browser };
    },
    pauseQueue: async (accountId, paused) => {
      calls.push(["pause-queue", accountId, paused]);
      if (accountId === null) browser.queue.paused = paused;
      else browser.queue.pausedAccounts = paused ? [...new Set([...browser.queue.pausedAccounts, accountId])] : browser.queue.pausedAccounts.filter(id => id !== accountId);
      emit("browser", { ...browser }); return { ...browser };
    },
    queueAction: async (id, action) => {
      calls.push(["queue-action", id, action]);
      const row = browser.queue?.entries.find(entry => entry.id === id);
      if (!row) throw new Error("Queued task no longer exists");
      let entries = browser.queue.entries;
      const update = (patch) => { entries = entries.map(entry => entry === row ? { ...entry, ...patch } : entry); };
      if (action === "cancel" && openQueueStatus.includes(row.status)) {
        update({ status: "cancelled", reason: null, canCancel: false, canPrioritize: false, canResume: false, canDismiss: true });
      } else if (action === "resume" && row.status === "paused") {
        update({ status: "waiting", reason: "checking", canPrioritize: true, canResume: false });
      } else if (action === "prioritize" && row.status === "waiting") {
        queuePriority.set(id, Math.max(0, ...queuePriority.values()) + 1);
      } else if (action === "dismiss" && ["cancelled", "failed", "interrupted"].includes(row.status)) {
        entries = entries.filter(entry => entry !== row);
      } else throw new Error("This action is unavailable for the queued task");
      browser.queue = { ...browser.queue, entries: withQueuePositions(entries) };
      emit("browser", { ...browser }); return { ...browser };
    },
    uninstallIntegration: async () => {
      calls.push(["uninstall-integration"]);
      if (devProfile) throw new Error("DEV profile has no Codex integration to remove");
      if (window.fixtureCancelUninstall) return { cancelled: true };
      await delay(200);
      updateState({ coreSetupComplete: false, codexCatalogVerified: false, mcpSetupComplete: false, mcpRuntimeInstalled: false,
        mcpGuideStep: 0, codexRestartRequired: true, browserInteractionMode: "automatic", experimentalAsyncToolOperations: false,
        experimentalBiggerContext: false, experimentalSkillAttachments: false, experimentalFreshConversationPerTurn: false,
        zeroRiskProEnabled: false });
      return { cancelled: false, state: publishState() };
    },
    refreshAccountAuthentication: async (id) => {
      calls.push(["account-auth-refresh", id]);
      accountSnapshot = { ...accountSnapshot, accounts: accountSnapshot.accounts.map(account => account.id === id
        ? { ...account, authenticated: true, authenticationStatus: "verified", authenticationCheckedAt: "2026-09-21T10:10:00.000Z",
          lastVerifiedAt: "2026-09-21T10:10:00.000Z" } : account) };
      if (id === accountSnapshot.selectedId) Object.assign(browser, { authenticated: true, authenticationStatus: "verified",
        authenticationCheckedAt: "2026-09-21T10:10:00.000Z", lastVerifiedAt: "2026-09-21T10:10:00.000Z", status: "ready" });
      return accountSnapshot;
    },
    accountCodexQuotaSnapshot: async (id) => {
      calls.push(["quota-snapshot", id]);
      if (quotaFailed && id === "fixture-primary") throw new Error("Fixture quota unavailable");
      return id === "fixture-primary" ? quota : id === "fixture-secondary" && benefitsScenario ? retainedQuota : null;
    },
    refreshAccountCodexQuota: async (id) => {
      calls.push(["quota-refresh", id]); quotaFailed = false; return { ...quota, accountId: id };
    },
    codexLoginSnapshot: async () => codexLoginView(),
    setAccountMode: async (mode) => {
      calls.push(["account-mode", mode]);
      if (mode !== "selected" && mode !== "balanced") throw new Error("Account routing mode must be selected or balanced");
      accountSnapshot = { ...accountSnapshot, mode }; return accountSnapshot;
    },
    setAccountEnabled: async (id, enabled) => {
      calls.push(["account-enabled", id, enabled]);
      if (typeof enabled !== "boolean") throw new Error("Account enabled state must be a boolean");
      accountSnapshot = { ...accountSnapshot, accounts: accountSnapshot.accounts.map(account => account.id === id ? { ...account, enabled } : account) };
      emit("browser", { ...browser }); return accountSnapshot;
    },
    selectAccount: async (id) => {
      calls.push(["account-select", id]); accountSnapshot = { ...accountSnapshot, selectedId: id };
      const account = accountSnapshot.accounts.find(account => account.id === id);
      Object.assign(browser, { accountId: id, accountName: account.label, authenticated: account.authenticated,
        authenticationStatus: account.authenticationStatus });
      emit("browser", { ...browser }); return accountSnapshot;
    },
    // A model check records the account's capabilities; with connector it also proves the tools connector.
    checkAccount: async (id, connector) => {
      calls.push(["account-check", id, connector]);
      const account = accountSnapshot.accounts.find(candidate => candidate.id === id);
      if (!account) throw new Error("ChatGPT account does not exist");
      if (!account.authenticated) throw new Error("Sign in to this ChatGPT account before checking it");
      await delay(300);
      accountSnapshot = { ...accountSnapshot, accounts: accountSnapshot.accounts.map(candidate => candidate.id === id
        ? { ...candidate, checked: true, capabilities: candidate.capabilities ?? { ...checkedCapabilities },
          ...(connector === true ? { connectorReady: true } : {}) } : candidate) };
      emit("browser", { ...browser }); return accountSnapshot;
    },
    addAccount: async (label) => {
      await accountMutation("add-account");
      const id = `fixture-added-${++accountSequence}`;
      const account = { id, label, enabled: true, authenticated: false, authenticationStatus: "signed-out",
        activeTurns: 0, checked: false, connectorReady: false, evidenceEpoch: 1,
        proxy: { mode: "system" }, safety: { policy: { ...defaultPolicy }, cooldownUntil: 0, stopped: false, newSessionWindow: null } };
      accountSnapshot = { ...accountSnapshot, selectedId: id, accounts: [...accountSnapshot.accounts, account] };
      Object.assign(browser, { accountId: id, accountName: label, accountLabel: null, authenticated: false, authenticationStatus: "signed-out", status: "signed-out" });
      emit("browser", { ...browser });
      return accountSnapshot;
    },
    setAccountProxy: async (id, proxy) => {
      await accountMutation("save-proxy");
      accountSnapshot = { ...accountSnapshot, accounts: accountSnapshot.accounts.map(account => account.id === id ? { ...account, proxy } : account) };
      return accountSnapshot;
    },
    setAccountSafety: async (id, policy) => {
      await accountMutation("save-pacing");
      accountSnapshot = { ...accountSnapshot, accounts: accountSnapshot.accounts.map(account => account.id === id
        ? { ...account, safety: { ...account.safety, policy } } : account) };
      return accountSnapshot;
    },
    // Resuming clears a safety stop and its cooldown; the pacing policy stays.
    resumeAccount: async (id) => {
      calls.push(["account-resume", id]);
      if (!accountSnapshot.accounts.some(account => account.id === id)) throw new Error("ChatGPT account does not exist");
      accountSnapshot = { ...accountSnapshot, accounts: accountSnapshot.accounts.map(account => account.id === id
        ? { ...account, safety: { ...account.safety, stopped: false, cooldownUntil: 0 } } : account) };
      emit("browser", { ...browser }); return accountSnapshot;
    },
    refreshAccountCodexQuotas: async () => ({ generatedAt: "2026-09-21T10:10:00.000Z", rows: [
      { accountId: "fixture-primary", evidenceEpoch: 1, status: "updated", snapshot: quota, reason: null },
      { accountId: "fixture-secondary", evidenceEpoch: 1, status: "retained", snapshot: retainedQuota, reason: "quota-refresh-unavailable" },
      { accountId: "fixture-tertiary", evidenceEpoch: 3, status: "unavailable", snapshot: null, reason: "authentication-unavailable" },
    ].filter(row => accountSnapshot.accounts.some(account => account.id === row.accountId)) }),
    startCodexLogin: async (id) => {
      calls.push(["start-codex-login", id]);
      if (codexLogin?.active) throw new Error("Another Codex sign-in is already in progress");
      if (!accountSnapshot.accounts.some(account => account.id === id)) throw new Error("ChatGPT account does not exist");
      await delay(250);
      const startedAt = Date.now(), flowId = `fixture-codex-login-${++codexLoginSequence}`;
      codexLogin = { flowId, accountId: id, phase: "waiting", active: true, settling: false,
        startedAt: new Date(startedAt).toISOString(), deadlineAt: new Date(startedAt + 15 * 60_000).toISOString(), completedAt: null,
        ownershipCurrent: true, canOpen: true, canCancel: true,
        verificationUrl: "https://auth.openai.com/codex/device", userCode: "FXTR-2026", error: null, cleanupError: null,
        scope: "shared-codex-auth-store", authOutcome: "pending", cancelStatus: null, actualAccount: null,
        requiresOpenaiAuth: null, requiresIdentityConfirmation: false, desktopAccountChange: "not_performed",
        selectionLock: { flowId, accountId: id } };
      return codexLoginView();
    },
    codexLoginStatus: async (flowId, id) => { requireCodexLogin(flowId, id); return codexLoginView(); },
    openCodexLogin: async (flowId, id) => {
      calls.push(["open-codex-login", flowId, id]);
      if (!requireCodexLogin(flowId, id).canOpen) throw new Error("The Codex sign-in page is no longer available");
      return true;
    },
    copyCodexLoginCode: async (flowId, id) => {
      calls.push(["copy-codex-login-code", flowId, id]);
      if (!requireCodexLogin(flowId, id).userCode) throw new Error("The Codex sign-in code is no longer available");
      return true;
    },
    cancelCodexLogin: async (flowId, id) => {
      calls.push(["cancel-codex-login", flowId, id]);
      const current = requireCodexLogin(flowId, id);
      if (!current.active) return codexLoginView();
      await delay(200);
      settleCodexLogin({ phase: "cancelled", authOutcome: "cancelled", cancelStatus: "canceled" });
      return codexLoginView();
    },
    openAccountLogin: async (id) => {
      calls.push(["account-login", id]);
      const account = accountSnapshot.accounts.find(candidate => candidate.id === id);
      if (!account) throw new Error("ChatGPT account does not exist");
      accountSnapshot = { ...accountSnapshot, selectedId: id };
      Object.assign(browser, { accountId: id, accountName: account.label, authenticated: account.authenticated,
        authenticationStatus: account.authenticationStatus });
      if (state.browserInteractionMode === "manual" || account.authenticated) browser.visible = true;
      else Object.assign(browser, { visible: true, loginInProgress: true, loginKind: "embedded", navigationLocked: true,
        passkeyLogin: null, existingChromeLogin: null, status: "signed-out", url: "https://auth.openai.com/log-in", title: "Sign in" });
      return publishBrowser();
    },
    usage: async (request) => {
      const query = typeof request === "number" ? { days: request, source: "web" } : request;
      if (![1, 7, 30, 90].includes(query?.days) || !["web", "native", undefined].includes(query.source)) throw new Error("Usage query is invalid");
      return usageFor({ days: query.days, source: query.source ?? "web", accountId: query.accountId ?? null });
    },
    repairWebRoute: async () => {
      calls.push(["repair-web-route"]);
      runtimeCapabilities = { ...runtimeCapabilities, tunnelRepair: { eligible: false, active: true, reason: null } };
      if (scenario === "benefits-repair-failure") {
        runtimeCapabilities = { runtimeStatus: "degraded", nativeAvailability: "ready", webAvailability: "degraded",
          tunnelStatus: "failed", tunnelRepair: { eligible: true, active: false, reason: "tunnel-restart-failed" } };
        return { status: "unavailable", reason: "tunnel-restart-failed" };
      }
      runtimeCapabilities = { runtimeStatus: "ready", nativeAvailability: "ready", webAvailability: "ready",
        tunnelStatus: "ready", tunnelRepair: { eligible: false, active: false, reason: null } };
      return { status: "recovered", reason: null };
    },
    logs: async (limit = 300) => fixtureLogs.slice(-Math.max(0, limit)),
    exportLogs: async () => {
      calls.push(["export-logs"]);
      await new Promise(resolve => setTimeout(resolve, 150));
      if (window.fixtureCancelExport) return null; // the save dialog was cancelled
      emitLog({ at: new Date().toISOString(), level: "info", event: "launcher.logs_exported", detail: { recordCount: fixtureLogs.length } });
      return "/fixture/Documents/codex-web-gpt-diagnostics-2026-09-21.jsonl";
    },
    doctor: async () => {
      calls.push(["doctor"]);
      await new Promise(resolve => setTimeout(resolve, 150));
      return { ok: true, mode: "full", checks: [
        { id: "proxy", status: "ok", message: "Responses proxy answered on 127.0.0.1:8765" },
        { id: "runtime", status: "warning", message: "Tunnel runtime answered slowly", detail: "Fixture health check took 2.4 s" },
        { id: "connector", status: "ok", message: "ChatGPT connector verified" },
      ] };
    },
    routeDiagnostics: async () => {
      diagnosticChecks++;
      const failed = diagnosticChecks === 1;
      return { schemaVersion: 1, codexHome: "/fixture/codex", configPath: "/fixture/config.toml", profilePath: null,
        configStatus: "loaded", profile: null, provider: "nekodex", providerSource: "root", customProvider: false,
        modelCatalogOverride: false, installed: true, active: true, routeMatches: true, issueCodes: [],
        catalog: { status: "observed", successfulRequests: 1, lastSuccessfulAt: "2026-09-21T10:00:00.000Z",
          lastResult: { request: failed ? 2 : 3, at: failed ? "2026-09-21T10:05:00.000Z" : "2026-09-21T10:06:00.000Z",
            status: failed ? 302 : 200, ...(failed ? { failure: { stage: "upstream", code: "redirect" } } : {}) } } };
    },
    cancelUpdatePreparation: async () => {
      calls.push(["cancel-update"]);
      if (updateInstall) {
        // Preparation started by installUpdate can stop until the installer takes over.
        const version = update.version;
        if (update.status === "installing") return { status: "too-late", reason: "worker-handoff", version };
        if (!updateInstall.cancelled) {
          updateInstall.cancelled = true;
          publishUpdate({ status: "cancelling", version });
          await delay(250);
          publishUpdate({ status: "available", version });
        }
        return { status: "cancelled", version };
      }
      // Scenario states (update-active, update-missing-speed): the worker has already taken over.
      update = { status: "installing", version: "9.9.9" }; emit("update", update);
      return { status: "too-late", reason: "worker-handoff", version: "9.9.9" };
    },
    setLanguage: async (next) => {
      calls.push(["language", next]);
      if (!languages.includes(next)) throw new Error("Unsupported launcher language");
      state.language = next; emit("state", { ...state }); return { ...state };
    },
    openSocial: async (target) => { calls.push(["social", target]); state[target === "github" ? "githubOpened" : "xOpened"] = true; return { ...state }; },
    completeOnboarding: async (nextLanguage, browserInteractionMode) => {
      calls.push(["onboarding"]); Object.assign(state, { language: nextLanguage, browserInteractionMode, onboardingComplete: true });
      emit("state", { ...state }); return { ...state };
    },
    // The rest of electron/preload.cjs, each resolving like its handler in electron/main.cjs or electron/ipc/.
    openExternal: async (url) => {
      calls.push(["open-external", url]);
      if (!allowedExternalUrls.has(url)) throw new Error("External URL is not allowlisted");
      return true;
    },
    zoomBrowser: async (action) => {
      calls.push(["zoom", action]);
      if (!["in", "out", "reset"].includes(action)) throw new Error(`Unknown browser zoom action: ${action}`);
      const index = zoomFactors.indexOf(browser.zoomFactor);
      browser.zoomFactor = action === "reset" ? 1
        : zoomFactors[Math.max(0, Math.min(zoomFactors.length - 1, index + (action === "in" ? 1 : -1)))];
      return publishBrowser();
    },
    copyManualPrompt: async (tabId) => {
      calls.push(["manual-prompt-copy", tabId]);
      const tab = browser.tabs.find(candidate => candidate.id === tabId);
      if (!tab || tab.interactionMode !== "manual" || !tab.canCopyPrompt) throw new Error("Manual prompt is no longer available");
      // Copying restarts the send deadline while the turn still waits for the user.
      if (tab.manualState === "awaiting-user") {
        updateTab(tabId, { manualDeadlineAt: new Date(Date.now() + state.manualSubmitTimeoutSec * 1000).toISOString() });
      }
      return publishBrowser();
    },
    confirmManualSent: async (tabId) => {
      calls.push(["manual-prompt-sent", tabId]);
      const tab = browser.tabs.find(candidate => candidate.id === tabId);
      if (!tab || tab.interactionMode !== "manual") throw new Error("Manual mode tab does not exist");
      if (tab.manualState !== "awaiting-user") {
        if (["sent", "running", "completed"].includes(tab.manualState)) return { ...browser };
        throw new Error("Manual mode turn can no longer be marked as sent");
      }
      // The prompt stays copyable until the connector binds; ChatGPT may still refuse Send.
      updateTab(tabId, { manualState: "sent", manualDeadlineAt: null, canConfirmSent: false });
      return publishBrowser();
    },
    openLogin: async () => {
      calls.push(["login"]);
      requireAutomatic("Automated ChatGPT sign-in verification");
      if (browser.authenticated) browser.visible = true;
      else Object.assign(browser, { visible: true, loginInProgress: true, loginKind: "embedded", navigationLocked: true,
        passkeyLogin: null, existingChromeLogin: null, status: "signed-out", url: "https://auth.openai.com/log-in", title: "Sign in" });
      return publishBrowser();
    },
    logoutChatGpt: async () => {
      calls.push(["logout"]);
      requireAutomatic("Automated ChatGPT logout verification");
      if (activeTurn()) throw new Error(`ChatGPT browser is running Codex turn ${activeTurn().traceId}`);
      invalidateAccountProof();
      Object.assign(browser, { status: "loading", loading: true, message: "Signing out of ChatGPT" });
      publishBrowser();
      await delay(300);
      Object.assign(browser, { authenticated: false, authenticationStatus: "signed-out", authenticationCheckedAt: nowIso(),
        accountLabel: null, status: "signed-out", loading: false, message: "Signed out", visible: true });
      selectedAccountPatch({ authenticated: false, authenticationStatus: "signed-out", accountLabel: null,
        authenticationCheckedAt: browser.authenticationCheckedAt });
      publishState();
      return { browser: publishBrowser(), state: { ...state } };
    },
    smokeTest: async () => {
      calls.push(["smoke"]);
      if (state.browserInteractionMode === "manual") throw new Error("Browser smoke testing is disabled in Manual mode");
      if (activeTurn()) throw new Error(`ChatGPT browser is running Codex turn ${activeTurn().traceId}`);
      if (!browser.authenticated) throw new Error("Sign in to ChatGPT before running the browser smoke test");
      Object.assign(browser, { visible: true, status: "testing", message: "Running browser smoke test" });
      publishBrowser();
      emitLog({ at: nowIso(), level: "info", event: "smoke.started", detail: {} });
      await delay(700);
      emitLog({ at: nowIso(), level: "info", event: "smoke.completed", detail: { effort: "medium", responseChars: 19 } });
      Object.assign(browser, { status: "ready", message: "Smoke test passed" });
      publishBrowser();
      updateState({ browserSmokePassed: true, browserSmokeVersion: "fixture" });
      publishState();
      return { ok: true, effort: "medium", response: "CODEX WEB GPT READY" };
    },
    verifyMcp: async () => {
      calls.push(["verify-mcp"]);
      const name = "mcp-verification";
      const runtimeChecks = [
        { id: "proxy", status: "ok", message: "Responses proxy answered on 127.0.0.1:8765" },
        { id: "runtime", status: "ok", message: "Local MCP runtime answered" },
      ];
      const fail = (checks, message) => {
        updateState({ mcpSetupComplete: false }); publishState();
        publishOperation({ name, status: "failed", message });
        return { ok: false, mode: "full", checks };
      };
      const turn = activeTurn();
      if (turn) {
        return fail([{ id: "connector", status: "error", message: "Finish the active Codex task before verifying the ChatGPT connector",
          detail: `Active browser turn: ${turn.traceId}` }], "Finish the active Codex task before verifying the ChatGPT connector");
      }
      publishOperation({ name, status: "running", message: "Checking local runtime" });
      await delay(300);
      if (!state.mcpRuntimeInstalled || !mcpCredentialsConfigured) {
        return fail([runtimeChecks[0], { id: "runtime", status: "error", message: "The local MCP runtime is not installed",
          detail: "Save the tunnel credentials in step 2, then verify again" }], "The local MCP runtime is not installed");
      }
      const mode = state.browserInteractionMode;
      const proof = { mcpSetupComplete: true, setupVerifiedAt: nowIso(), setupConnectorName: connectorNames[mode] };
      if (mode === "manual") {
        updateState(proof); publishState();
        publishOperation({ name, status: "completed", message: "Local Manual mode runtime is healthy; connector selection remains a manual turn step" });
        return { ok: true, mode: "full", checks: [...runtimeChecks, { id: "connector", status: "warning",
          message: `Select ChatGPT connector ${JSON.stringify(connectorNames.manual)} manually for every Manual mode turn` }] };
      }
      publishOperation({ name, status: "running", message: "Checking ChatGPT connector" });
      await delay(400);
      selectedAccountPatch({ connectorReady: true });
      updateState(proof); publishState();
      publishOperation({ name, status: "completed", message: "Runtime and connector verified" });
      return { ok: true, mode: "full", checks: [...runtimeChecks, { id: "connector", status: "ok",
        message: `ChatGPT connector ${JSON.stringify(connectorNames.automatic)} is available` }] };
    },
    cancelTurns: async () => {
      calls.push(["cancel-turns"]);
      if (devProfile) throw new Error("DEV chat turns are owned by the repository CLI process");
      if (window.fixtureCancelTurns) return { cancelled: true }; // the confirmation dialog was dismissed
      const running = browser.tabs.filter(tab => tab.status === "running");
      browser.tabs = browser.tabs.map(tab => tab.status === "running" ? { ...tab, status: "aborted" } : tab);
      if (browser.tasks) browser.tasks = browser.tasks.map(task => running.some(tab => tab.id === task.tabId) && !task.terminal
        ? { ...task, phase: "cancelled", terminal: true, canOpen: false, canCancel: false, canDismiss: true, updatedAt: Date.now() } : task);
      publishBrowser();
      return { cancelled: false, cancelledHttpTurns: 0, cancelledBrowserTurns: running.length, cancelledCompactionRuns: 0 };
    },
    setupCore: async () => {
      calls.push(["setup-core"]);
      const automatic = state.browserInteractionMode === "automatic";
      if (automatic && !browser.authenticated) throw new Error("Sign in to ChatGPT before installing the Codex integration");
      if (automatic && !state.coreSetupComplete && !state.browserSmokePassed) {
        throw new Error("Run the browser smoke test before installing the Codex integration");
      }
      if (operation?.status === "running") throw new Error(`Another launcher operation is active: ${operation.name}`);
      await runSetup("core-setup", "Installing ChatGPT Web models into Codex", "Codex integration installed");
      // Codex has to reload its model catalog before the picker can be confirmed (the DEV harness verifies it itself).
      updateState({ coreSetupComplete: true, codexCatalogVerified: devProfile, codexRestartRequired: !devProfile, mcpSetupComplete: false,
        ...(mcpCredentialsConfigured ? { mcpRuntimeInstalled: true, mcpGuideStep: 2 } : { mcpRuntimeInstalled: false, mcpGuideStep: 0 }) });
      publishState();
      return { ok: true, stdout: "Codex integration installed", restartRequired: true };
    },
    setupMcp: async (input = {}) => {
      calls.push(["setup-mcp", { ...input, ...(input.runtimeKey ? { runtimeKey: "[redacted]" } : {}) }]);
      const mode = input.interactionMode ?? state.browserInteractionMode;
      if (!["automatic", "manual"].includes(mode)) throw new Error("Browser interaction mode must be automatic or manual");
      if (operation?.status === "running") throw new Error(`Another launcher operation is active: ${operation.name}`);
      const reuseSavedCredentials = input.replace !== true && mcpCredentialsConfigured;
      if (!reuseSavedCredentials && !/^tunnel_[a-f0-9]{32}$/.test(input.tunnelId?.trim() ?? "")) {
        throw new Error("Tunnel ID must be tunnel_ followed by 32 lowercase hexadecimal characters");
      }
      if (!reuseSavedCredentials && (typeof input.runtimeKey !== "string" || input.runtimeKey.trim().length < 20)) {
        throw new Error("A Tunnels Read + Use runtime key is required");
      }
      if (mode !== state.browserInteractionMode) invalidateAccountProof();
      await runSetup("mcp-setup", reuseSavedCredentials ? "Reconnecting the native Codex harness with saved tunnel credentials"
        : "Connecting the native Codex harness", "Local MCP tools are ready");
      mcpCredentialsConfigured = true;
      updateState({ browserInteractionMode: mode, coreSetupComplete: true, codexCatalogVerified: devProfile, mcpRuntimeInstalled: true,
        mcpSetupComplete: false, mcpGuideStep: 2, codexRestartRequired: !devProfile,
        ...(mode === "manual" ? { experimentalBiggerContext: false, experimentalSkillAttachments: false, experimentalFreshConversationPerTurn: false } : {}) });
      publishState();
      return { ok: true, stdout: "Local MCP tools are ready" };
    },
    setMcpStep: async (step) => {
      calls.push(["mcp-step", step]);
      if (!Number.isInteger(step) || step < 0 || step > 2) throw new Error("Invalid MCP guide step");
      return updateState({ mcpGuideStep: step });
    },
    setAutostart: async (enabled) => {
      calls.push(["autostart", enabled]);
      if (devProfile) throw new Error("The isolated DEV launcher is started explicitly from the repository CLI");
      const desired = enabled === true;
      return { state: updateState({ autoStart: desired }), supported: true, enabled: desired };
    },
    setBiggerContext: async (enabled) => {
      calls.push(["bigger-context", enabled]);
      if (typeof enabled !== "boolean") throw new Error("Context mode must be a boolean");
      if (devProfile) { // The DEV harness applies it at once.
        if (!state.coreSetupComplete) throw new Error("Initialize the runtime before changing Bigger Context");
        await runSetup("bigger-context", "Updating Bigger Context", "Bigger Context updated");
        invalidateAccountProof();
        updateState({ experimentalBiggerContext: enabled, codexCatalogVerified: true, codexRestartRequired: false });
        return publishState();
      }
      if (!state.coreSetupComplete || state.browserInteractionMode === "manual") {
        throw new Error("Install the automatic model route before changing Bigger Context");
      }
      // Queued until the runtime is idle; a choice equal to the saved mode clears the queue.
      if (!state.contextChangeApplying && state.experimentalBiggerContext === enabled) {
        clearTimeout(contextTimer); contextTimer = null;
        updateState({ pendingBiggerContext: null, contextChangeError: null });
      } else {
        updateState({ pendingBiggerContext: enabled, contextChangeError: null });
        scheduleContextChange();
      }
      return publishState();
    },
    cancelContextChange: async () => {
      calls.push(["cancel-context-change"]);
      if (state.contextChangeApplying) throw new Error("Wait for the context change to finish");
      clearTimeout(contextTimer); contextTimer = null;
      updateState({ pendingBiggerContext: null, contextChangeError: null });
      return publishState();
    },
    setAsyncToolOperations: async (enabled) => {
      calls.push(["async-tool-operations", enabled]);
      if (typeof enabled !== "boolean") throw new Error("Asynchronous tool operations must be a boolean");
      assertNoActiveWork("Finish active tasks and setup operations before changing asynchronous tool operations");
      if (state.experimentalAsyncToolOperations === enabled) return { ...state };
      await runSetup("async-tool-operations", "Updating asynchronous tool operations", "Asynchronous tool operations updated");
      invalidateAccountProof();
      updateState({ experimentalAsyncToolOperations: enabled, codexCatalogVerified: devProfile, codexRestartRequired: !devProfile });
      return publishState();
    },
    setSkillAttachments: async (enabled) => {
      calls.push(["skill-attachments", enabled]);
      if (typeof enabled !== "boolean") throw new Error("Skills as files must be a boolean");
      assertBrowserIdleFor("Skills as files");
      await runSetup("skill-attachments", "Updating Skills as files", "Skills as files updated");
      updateState({ experimentalSkillAttachments: enabled });
      return publishState();
    },
    setWebSubagents: async (enabled) => {
      calls.push(["web-subagents", enabled]);
      if (typeof enabled !== "boolean") throw new Error("Web subagents must be a boolean");
      assertBrowserIdleFor("Web subagents");
      await runSetup("allow-web-subagents", "Updating Web subagents", "Web subagents updated");
      updateState({ allowWebSubagents: enabled });
      return publishState();
    },
    setFreshConversation: async (enabled) => {
      calls.push(["fresh-conversation", enabled]);
      if (typeof enabled !== "boolean") throw new Error("Fresh conversation per turn must be a boolean");
      assertNoActiveWork("Finish active tasks and setup operations before changing browser conversations");
      await runSetup("fresh-conversation", "Updating browser conversation retention", "Browser conversation retention updated");
      updateState({ experimentalFreshConversationPerTurn: enabled });
      return publishState();
    },
    setUseSavedChats: async (enabled) => {
      calls.push(["use-saved-chats", enabled]);
      if (typeof enabled !== "boolean") throw new Error("Saved chat preference must be a boolean");
      assertNoActiveWork("Finish active tasks and setup operations before changing browser conversations");
      await runSetup("use-saved-chats", "Updating saved ChatGPT conversations", "Saved ChatGPT conversations updated");
      updateState({ useSavedChats: enabled });
      return publishState();
    },
    confirmCodexModels: async () => {
      calls.push(["confirm-codex-models"]);
      if (!state.coreSetupComplete || !state.codexCatalogVerified || typeof state.pendingBiggerContext === "boolean") {
        throw new Error("Wait for the configured model catalog before confirming the Codex picker");
      }
      updateState({ codexPickerConfirmed: true, codexRestartRequired: false, codexPickerContract: "f".repeat(64),
        pickerVerifiedAt: nowIso() });
      return publishState();
    },
    setZeroRiskPro: async (enabled) => {
      calls.push(["zero-risk-pro", enabled]);
      assertBrowserIdleFor("Manual model profiles");
      await runSetup("zero-risk-pro", "Updating Manual model profiles", "Manual model profiles updated");
      invalidateAccountProof();
      updateState({ zeroRiskProEnabled: enabled === true, codexCatalogVerified: devProfile, codexRestartRequired: !devProfile });
      return publishState();
    },
    setBrowserCapacity: async (value) => {
      calls.push(["browser-capacity", value]);
      if (!Number.isSafeInteger(value) || value < 1 || value > browserCapacity.maximum) {
        throw new Error(`Browser capacity must be an integer from 1 to ${browserCapacity.maximum}`);
      }
      // Saved now, applied by the next launcher start.
      browserCapacity = { ...browserCapacity, configured: value, restartRequired: value !== browserCapacity.active };
      return { ...browserCapacity };
    },
    setCompactionModel: async (value) => {
      calls.push(["compaction-model", value]);
      if (activeTurn() || operation?.status === "running") throw new Error("Finish active tasks before changing the compaction model");
      if (value !== null && !["extra-high", "5.6-pro", "5.5-pro"].includes(value)) {
        throw new Error("Compaction model must be follow, extra-high, 5.6-pro, or 5.5-pro");
      }
      if (!state.coreSetupComplete) throw new Error("Install the Codex integration before changing the compaction model");
      await delay(200);
      compactionModel = value;
      return { compactionModel };
    },
    setProModelVersion: async (version) => {
      calls.push(["pro-model-version", version]);
      if (version !== null && !["5.6", "5.5", "6"].includes(version)) throw new Error("Pro model version must be follow, 5.6, 5.5, or 6");
      assertBrowserIdleFor("the Pro model version");
      if (!state.coreSetupComplete) throw new Error("Install the Codex integration before changing the Pro model version");
      await delay(200);
      proModelVersion = version;
      return { proModelVersion };
    },
    setBrowserInteractionMode: async (mode) => {
      calls.push(["interaction-mode", mode]);
      if (mode !== "automatic" && mode !== "manual") throw new Error("Browser interaction mode must be automatic or manual");
      if (state.browserInteractionMode === mode) return { state: { ...state }, credentialsRequired: false, targetMode: mode };
      assertBrowserIdleFor("browser interaction mode");
      // Switching needs the tunnel credentials of the target mode; without them the renderer opens tool setup.
      if (!mcpCredentialsConfigured) return { state: { ...state }, credentialsRequired: true, targetMode: mode };
      invalidateAccountProof();
      await runSetup("browser-interaction-mode", "Switching the browser interaction mode", "Browser interaction mode updated");
      updateState({ browserInteractionMode: mode,
        ...(mode === "manual" ? { experimentalBiggerContext: false, experimentalSkillAttachments: false, experimentalFreshConversationPerTurn: false } : {}),
        ...(state.coreSetupComplete ? { codexCatalogVerified: devProfile, codexRestartRequired: !devProfile } : {}) });
      publishState();
      publishBrowser();
      return { state: { ...state }, credentialsRequired: false, targetMode: mode };
    },
    setSidebarState: async (value) => {
      calls.push(["sidebar-state", value]);
      if (typeof value?.open !== "boolean" || !Number.isInteger(value?.width) || value.width < 240 || value.width > 420) {
        throw new Error("Sidebar state is invalid");
      }
      return updateState({ sidebarOpen: value.open, sidebarWidth: value.width });
    },
    installUpdate: async () => {
      calls.push(["update-install"]);
      if (updateInstall) return updateInstall.done;
      if (activeTurn() || operation?.status === "running") throw new Error("Finish active tasks and setup operations before updating NEKODEX");
      if (update.status !== "available") throw new Error("No verified NEKODEX update is available to install");
      const version = update.version, totalBytes = 48 * 1024 * 1024, bytesPerSecond = 24 * 1024 * 1024;
      const install = { cancelled: false };
      install.done = (async () => {
        try {
          for (let step = 0; step <= 4; step++) {
            publishUpdate({ status: "downloading", version, downloadedBytes: totalBytes * step / 4, totalBytes, bytesPerSecond,
              remainingSeconds: (totalBytes - totalBytes * step / 4) / bytesPerSecond });
            await delay(350);
            if (install.cancelled) return false;
          }
          publishUpdate({ status: "verifying", version });
          await delay(500);
          if (install.cancelled) return false;
          publishUpdate({ status: "installing", version });
          await delay(300);
          return true; // NEKODEX quits here and the installer starts the new version.
        } finally { if (updateInstall === install) updateInstall = null; }
      })();
      updateInstall = install;
      return install.done;
    },
    restartLauncher: async () => { calls.push(["restart"]); return true; },
    readUpdateRequestRevision: async () => updateRequestRevision,
    onOpenUpdates: listen("open-updates"),
    windowState: async () => ({ fullScreen: false, maximized: false }),
    windowControl: (action) => { calls.push(["window-control", action]); },
    onWindowStateChanged: listen("window-state"),
  };
  window.fixtureSetBrowser = patch => { Object.assign(browser, patch); emit("browser", { ...browser }); };
  window.fixtureSetAccounts = value => { accountSnapshot = value; emit("browser", { ...browser }); };
  window.fixtureSetUpdate = value => { update = value; emit("update", update); };
  window.fixtureSetState = patch => { Object.assign(state, patch); emit("state", { ...state }); };
  window.fixtureSetOperation = value => { operation = value; emit("operation", value); };
  window.fixtureEmitLog = record => emitLog({ at: new Date().toISOString(), level: "info", detail: {}, ...record });
  window.fixtureOpenUpdates = () => { updateRequestRevision++; emit("open-updates"); };
  window.fixtureFocusAddress = () => emit("focus-address");
  window.fixtureCompleteCodexLogin = () => {
    if (!codexLogin?.active) return null;
    const account = accountSnapshot.accounts.find(candidate => candidate.id === codexLogin.accountId);
    settleCodexLogin({ phase: "completed", authOutcome: "committed", requiresOpenaiAuth: false, requiresIdentityConfirmation: true,
      actualAccount: { type: "chatgpt", email: account?.accountLabel ?? null, planType: "plus" } });
    return codexLoginView();
  };
  if (astraScenario) {
    window.codexWebLauncher.onLifecycle = listen("lifecycle");
    window.fixtureSetLifecycle = value => emit("lifecycle", value);
  }
}

function createFixtureServer() { return http.createServer((request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname === "/fixture-setup.js") {
    response.setHeader("Content-Type", "text/javascript");
    response.end(`(${installMockLauncher.toString()})()`);
    return;
  }
  if (pathname === "/") {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(fs.readFileSync(path.join(dist, "index.html"), "utf8")
      .replace("</head>", '<script src="/fixture-setup.js"></script></head>'));
    return;
  }
  const file = path.resolve(dist, `.${pathname}`);
  if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404); response.end(); return;
  }
  response.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "application/octet-stream");
  fs.createReadStream(file).pipe(response);
}); }
if (require.main === module) {
  const server = createFixtureServer();
  server.listen(0, "127.0.0.1", () => process.stdout.write(`Launcher UI fixture: http://127.0.0.1:${server.address().port}/\n`));
}
module.exports = { createFixtureServer };
