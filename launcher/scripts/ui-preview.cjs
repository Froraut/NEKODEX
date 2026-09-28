// Credential-free UI fixture. Build the renderer first, then run this file with
// Node or Bun and open the loopback URL it prints. No Electron or ChatGPT calls.
// Scenarios: ?scenario=embedded, passkey, passkey-failed, onboarding, startup-error,
// existing-chrome-failed, setup-fresh, manual-tools, accounts-failed, update-active, diagnostics-redirect,
// benefits-auth-unavailable, benefits-portfolio-mixed, benefits-insights, benefits-repair-success,
// benefits-repair-failure, browser-ui-signed-out, browser-ui-ready, browser-ui-error, browser-ui-home-loading
// Account forms: accounts-ui-ready, accounts-ui-error (first add/save attempt fails).
// benefits-portfolio-mixed also has launcher log events (Overview "Recent events", Activity), recorded
// tasks and a waiting queue (Task center); benefits-insights has the same events and a 7-day usage calendar.
// Add &no-animation-frames=true to keep requestAnimationFrame callbacks permanently paused.
// Add &appearance=system|dark|light to choose the saved launcher appearance (default dark).
// Add &context-capabilities=true to report Sol/Pro context capabilities (Settings context budget table).
// Page hooks: window.fixtureCalls, fixtureSetBrowser/Accounts/Update/State/Operation, fixtureEmitLog(record);
// set window.fixtureCancelExport / fixtureCancelUninstall to simulate a cancelled save or confirmation dialog.
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
  const language = ["en", "ru", "zh-CN", "ja"].includes(parameters.get("language")) ? parameters.get("language") : "en";
  const appearances = ["system", "dark", "light"];
  const appearance = appearances.includes(parameters.get("appearance")) ? parameters.get("appearance") : "dark";
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
  const state = {
    version: 1, language, onboardingComplete: scenario !== "onboarding", githubOpened: false, xOpened: false,
    autoStart: false, keepRunningOnClose: true, showBrowserDuringTurns: true, browserInteractionMode: "automatic",
    experimentalBiggerContext: false, zeroRiskProEnabled: false, sidebarOpen: true, sidebarWidth: 252,
    browserSmokePassed: false, browserSmokeVersion: null, coreSetupComplete: false, codexCatalogVerified: false,
    mcpGuideStep: 0, appearance,
  };
  if (scenario === "manual-tools") state.browserInteractionMode = "manual";
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
  if (scenario === "passkey-failed") {
    Object.assign(browser, { navigationLocked: false, loginInProgress: false, loginKind: "passkey", visible: false,
      passkeyLogin: { phase: "failed", startedAt: new Date().toISOString(), deadlineAt: new Date().toISOString(),
        active: false, canImport: false, canReveal: false, canCancel: false,
        error: "passkey-verification-failed", revealError: null } });
  }
  if (scenario === "models-ready" || scenario === "tools-pending" || benefitsScenario) {
    Object.assign(state, { coreSetupComplete: true, codexCatalogVerified: true, codexPickerConfirmed: true, browserSmokePassed: true,
      browserSmokeVersion: "fixture", mcpRuntimeInstalled: scenario === "tools-pending" || benefitsScenario,
      mcpSetupComplete: benefitsScenario });
    Object.assign(browser, { authenticated: true, accountLabel: "fixture@example.test", status: "ready",
      authenticationStatus: "verified", authenticationCheckedAt: "2026-09-21T10:00:00.000Z",
      lastVerifiedAt: "2026-09-21T10:00:00.000Z",
      navigationLocked: false, loginInProgress: false, loginKind: null, visible: false });
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
      : scenario === "update-missing-speed" ? { status: "downloading", version: "9.9.9", downloadedBytes: 4096, totalBytes: 8192 }
        : { status: "disabled" };
  const defaultPolicy = { enabled: false, minIntervalSec: 10, maxConcurrent: 1, breakAfterMinutes: 30,
    breakMinutes: 5, maxSessionMinutes: 240, cooldownMinutes: 3, newSessionWindow: null };
  let accountSnapshot = { selectedId: "fixture-primary", mode: "selected", accounts: [
    { id: "fixture-primary", label: "Primary", enabled: true, authenticated: true, accountLabel: "primary@example.test",
      authenticationStatus: "verified", authenticationCheckedAt: "2026-09-21T10:00:00.000Z", lastVerifiedAt: "2026-09-21T10:00:00.000Z",
      activeTurns: 0, checked: true, connectorReady: true, evidenceEpoch: 1, proxy: { mode: "system" },
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
    planType: "plus", accountBucket: { id: "account", name: "Account", normalModelSlug: null,
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
  // Usage: the period ends on the fixture day and spans query.days; benefits-insights spreads its 27 tasks
  // over the last seven days, so the calendar, the period and the totals agree for every range.
  const usageEnd = "2026-09-21";
  const usageDay = (offset) => new Date(Date.parse(`${usageEnd}T00:00:00Z`) - offset * 86_400_000).toISOString().slice(0, 10);
  const insightCalendar = [
    [6, 3, 3, 0, 0], [5, 5, 4, 1, 0], [3, 6, 5, 1, 0], [2, 2, 2, 0, 0], [1, 7, 5, 1, 1], [0, 4, 3, 1, 0],
  ].map(([offset, total, completed, failed, cancelled]) => ({ day: usageDay(offset), total, completed, failed, cancelled, unrecorded: 0 }));
  const usageFor = (days) => {
    const period = { startDay: usageDay(days - 1), endDay: usageEnd, days };
    const calendar = scenario === "benefits-insights" ? insightCalendar.filter(day => day.day >= period.startDay) : [];
    const sum = (key) => calendar.reduce((total, day) => total + day[key], 0);
    const known = sum("completed") + sum("failed") + sum("cancelled");
    // Failure codes cover exactly the failed count (timeouts first, as in the diagnostic groups).
    let unassigned = sum("failed");
    const failures = [["timeout", 2], ["browser_failure", 1], ["transport", 1]].map(([code, count]) => {
      const share = Math.min(count, unassigned); unassigned -= share; return { code, count: share };
    }).filter(failure => failure.count > 0);
    return { period, calendar, failures, metrics: { total: sum("total"), completed: sum("completed"), failed: sum("failed"),
      cancelled: sum("cancelled"), unrecorded: sum("unrecorded"), knownOutcomeTotal: known,
      knownOutcomeCompletionRate: known ? sum("completed") / known : null } };
  };
  let runtimeCapabilities = benefitsScenario ? { runtimeStatus: "ready", nativeAvailability: "ready", webAvailability: "ready",
    tunnelStatus: "ready", tunnelRepair: { eligible: false, active: false, reason: null } } : undefined;
  if (scenario === "benefits-repair-success" || scenario === "benefits-repair-failure") {
    runtimeCapabilities = { runtimeStatus: "degraded", nativeAvailability: "ready", webAvailability: "degraded",
      tunnelStatus: "failed", tunnelRepair: { eligible: true, active: false, reason: "tunnel-unavailable" } };
  }
  const contextCapabilities = parameters.get("context-capabilities") === "true"
    ? { solAvailable: true, proAvailable: true, extraHighAvailable: true } : null;
  const snapshot = () => ({
    profile: scenario === "models-ready" || scenario === "tools-pending" || benefitsScenario ? "production" : "development", profilePaths: { coreHome: "", codexHome: "", userData: "" },
    state: { ...state }, browser: { ...browser }, connectorName: "Fixture connector",
    connectorNames: { automatic: "Fixture connector", manual: "Fixture manual" }, mcpCredentialsConfigured: scenario === "tools-pending",
    logs: fixtureLogs.slice(), urls: { github: "https://github.com/Froraut/NEKODEX", x: "", connectors: "https://chatgpt.com/plugins", developerMode: "https://chatgpt.com/#settings/Security?section=developer-mode", tunnels: "", keys: "" },
    browserCapacity: { configured: 16, active: 16, maximum: 1000, restartRequired: false },
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
    ] };
  }
  if (browserUiScenario) {
    const signedOut = scenario !== "browser-ui-ready";
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
  const networkIssue = parameters.get("network-issue");
  if (networkIssue === "egress-unstable" || networkIssue === "challenge-route") {
    Object.assign(browser, { networkIssue, networkIssueCheckedAt: new Date().toISOString() });
  }
  if (scenario === "browser-ui-home-loading") {
    browser.status = "loading"; browser.loading = true; browser.tabs[0].status = "loading"; browser.tabs[0].loading = true;
  }
  if (accountsUiScenario) Object.assign(browser, { accountId: "fixture-primary", accountName: "Primary", accountLabel: "primary@example.test" });
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
      if (scenario === "startup-error" && startupAttempts++ === 0) throw new Error("Error invoking remote method 'launcher:snapshot': Error: Fixture runtime unavailable");
      return snapshot();
    },
    recheckUpdate: async () => { calls.push(["update-recheck"]); update = { status: "up-to-date" }; emit("update", update); return update; },
    onStateChanged: listen("state"), onBrowserState: listen("browser"), onOperation: listen("operation"), onLog: listen("log"), onUpdateState: listen("update"),
    setBrowserBounds: async bounds => { window.fixtureBounds = bounds; return true; },
    setBrowserSurfaceActive: async (active) => { browser.surfaceActive = active; return { ...browser }; },
    openBrowserWorkspace: async (accountId, { asTab }) => {
      calls.push(["workspace-open", accountId, asTab]);
      if (scenario === "browser-ui-error" && !workspaceFailed) { workspaceFailed = true; throw new Error("Fixture window could not open. Try again."); }
      const account = browser.workspaces.accounts.find(account => account.accountId === accountId);
      const id = `workspace-${++workspaceSequence}`;
      account.items.push({ id, groupId: "fixture-group", state: "open", kind: asTab ? "tab" : "window",
        title: `${account.label} · ${asTab ? "Window tab" : "Separate window"} ${workspaceSequence}`,
        location: "https://chatgpt.com/?temporary-chat=true", temporary: true, active: true, restorable: false });
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
    navigateBrowser: async (action) => { calls.push(["navigate", action]); return { ...browser }; },
    setupHermes: async () => { calls.push(["hermes"]); return { provider: "codex-web", defaultChanged: false }; },
    openPasskeyLogin: async () => {
      calls.push(["passkey"]);
      if (scenario === "passkey-secondary-error") throw new Error("passkey-capture-failed");
      browser.loginKind = "passkey";
      browser.passkeyLogin = { phase: "waiting", active: true, canImport: true, canReveal: true, canCancel: true,
        startedAt: new Date().toISOString(), deadlineAt: new Date(Date.now() + 180000).toISOString(), error: null };
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
      if (browserUiScenario) {
        Object.assign(browser, { loginKind: null, passkeyLogin: { ...browser.passkeyLogin, phase: "cancelled",
          active: false, canImport: false, canCancel: false, canReveal: false } });
        operation = { name: "passkey-login", status: "completed", message: "Fixture sign-in flow settled" };
        emit("browser", { ...browser }); emit("operation", operation);
      }
      return { ...browser };
    },
    openExistingChromeLogin: async () => { calls.push(["existing-chrome-retry"]); return { ...browser }; },
    cancelExistingChromeLogin: async () => { calls.push(["existing-chrome-cancel"]); return { ...browser }; },
    allowExistingChromeFileAccess: async () => { calls.push(["existing-chrome-file-access"]); return { ...browser }; },
    copyExistingChromeSettingsAddress: async () => { calls.push(["existing-chrome-settings-copy"]); return true; },
    selectBrowserTab: async (tabId) => {
      calls.push(["tab", tabId]); browser.tabs = browser.tabs.map((tab) => ({ ...tab, active: tab.id === tabId }));
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
      if (window.fixtureCancelUninstall) return { cancelled: true };
      state.coreSetupComplete = false; state.codexCatalogVerified = false; state.codexPickerConfirmed = false;
      emit("state", { ...state }); return { cancelled: false, state: { ...state } };
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
    codexLoginSnapshot: async () => null,
    onCodexLogin: listen("codex-login"),
    setAccountMode: async (mode) => { accountSnapshot = { ...accountSnapshot, mode }; return accountSnapshot; },
    setAccountEnabled: async () => accountSnapshot,
    selectAccount: async (id) => {
      calls.push(["account-select", id]); accountSnapshot = { ...accountSnapshot, selectedId: id };
      const account = accountSnapshot.accounts.find(account => account.id === id);
      Object.assign(browser, { accountId: id, accountName: account.label, authenticated: account.authenticated,
        authenticationStatus: account.authenticationStatus });
      emit("browser", { ...browser }); return accountSnapshot;
    },
    checkAccount: async () => accountSnapshot,
    addAccount: async (label) => {
      if (!accountsUiScenario) return accountSnapshot;
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
    removeAccount: async () => accountSnapshot,
    setAccountProxy: async (id, proxy) => {
      if (!accountsUiScenario) return accountSnapshot;
      await accountMutation("save-proxy");
      accountSnapshot = { ...accountSnapshot, accounts: accountSnapshot.accounts.map(account => account.id === id ? { ...account, proxy } : account) };
      return accountSnapshot;
    },
    setAccountSafety: async (id, policy) => {
      if (!accountsUiScenario) return accountSnapshot;
      await accountMutation("save-pacing");
      accountSnapshot = { ...accountSnapshot, accounts: accountSnapshot.accounts.map(account => account.id === id
        ? { ...account, safety: { ...account.safety, policy } } : account) };
      return accountSnapshot;
    },
    resumeAccount: async () => accountSnapshot,
    refreshAccountCodexQuotas: async () => ({ generatedAt: "2026-09-21T10:10:00.000Z", rows: [
      { accountId: "fixture-primary", evidenceEpoch: 1, status: "updated", snapshot: quota, reason: null },
      { accountId: "fixture-secondary", evidenceEpoch: 1, status: "retained", snapshot: retainedQuota, reason: "quota-refresh-unavailable" },
      { accountId: "fixture-tertiary", evidenceEpoch: 3, status: "unavailable", snapshot: null, reason: "authentication-unavailable" },
    ].filter(row => accountSnapshot.accounts.some(account => account.id === row.accountId)) }),
    startCodexLogin: async () => { calls.push(["start-codex-login"]); return null; },
    usage: async (request) => {
      const query = typeof request === "number" ? { days: request, source: "web" } : request;
      return { available: true, rows: [], generatedAt: "2026-09-21T10:00:00.000Z", timeZone: "UTC",
      source: query.source, ...usageFor(query.days),
      selectedAccountId: query.accountId ?? null,
      accounts: accountSnapshot.accounts.map(account => ({ id: account.id, label: account.label, available: true })),
      durations: scenario === "benefits-insights"
        ? { observedSamples: 24, medianMs: 4100, p95Ms: 9200 }
        : { observedSamples: 0, medianMs: null, p95Ms: null },
      ...(scenario === "benefits-insights" ? { diagnosticGroups: [
        { source: "web", accountId: "fixture-primary", mode: "automatic", effort: "high", modelVersion: "5.6-sol",
          modelVersionSource: "observed", messageKind: "task",
          accepted: 24, completed: 20, failed: 3, cancelled: 1, incomplete: 0, knownOutcomeTotal: 24,
          knownOutcomeCompletionRate: 20 / 24, durations: { observedSamples: 22, eligibleSamples: 24, medianMs: 4100, p95Ms: 9200 },
          failures: [{ code: "timeout", count: 2 }, { code: "browser_failure", count: 1 }], classifiedFailureSamples: 3 },
        { source: "web", accountId: "fixture-secondary", mode: "automatic", effort: "medium", modelVersion: "5.6-sol",
          modelVersionSource: "observed", messageKind: "task",
          accepted: 3, completed: 2, failed: 1, cancelled: 0, incomplete: 0, knownOutcomeTotal: 3,
          knownOutcomeCompletionRate: null, durations: { observedSamples: 2, eligibleSamples: 3, medianMs: null, p95Ms: null },
          failures: [{ code: "transport", count: 1 }], classifiedFailureSamples: 1 },
        { source: "native", endpoint: "responses", modelId: "gpt-5.6-sol", modelIdSource: "requested",
          accepted: 3, completed: 2, failed: 1, cancelled: 0, incomplete: 0, knownOutcomeTotal: 3,
          knownOutcomeCompletionRate: null, durations: { observedSamples: 2, eligibleSamples: 3, medianMs: null, p95Ms: null },
          failures: [{ code: "transport", count: 1 }], classifiedFailureSamples: 1 },
      ] } : {}) };
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
      calls.push(["cancel-update"]); update = { status: "installing", version: "9.9.9" }; emit("update", update);
      return { status: "too-late" };
    },
    setLanguage: async (next) => { state.language = next; emit("state", { ...state }); return { ...state }; },
    openSocial: async (target) => { calls.push(["social", target]); state[target === "github" ? "githubOpened" : "xOpened"] = true; return { ...state }; },
    completeOnboarding: async (nextLanguage, browserInteractionMode) => {
      calls.push(["onboarding"]); Object.assign(state, { language: nextLanguage, browserInteractionMode, onboardingComplete: true });
      emit("state", { ...state }); return { ...state };
    },
  };
  window.fixtureSetBrowser = patch => { Object.assign(browser, patch); emit("browser", { ...browser }); };
  window.fixtureSetAccounts = value => { accountSnapshot = value; emit("browser", { ...browser }); };
  window.fixtureSetUpdate = value => { update = value; emit("update", update); };
  window.fixtureSetState = patch => { Object.assign(state, patch); emit("state", { ...state }); };
  window.fixtureSetOperation = value => { operation = value; emit("operation", value); };
  window.fixtureEmitLog = record => emitLog({ at: new Date().toISOString(), level: "info", detail: {}, ...record });
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
