// Credential-free UI fixture. Build the renderer first, then run this file with
// Node or Bun and open the loopback URL it prints. No Electron or ChatGPT calls.
// Scenarios: ?scenario=embedded, passkey, passkey-failed, onboarding, startup-error,
// existing-chrome-failed, setup-fresh, manual-tools, accounts-failed, update-active, diagnostics-redirect,
// benefits-auth-unavailable, benefits-portfolio-mixed, benefits-insights, benefits-repair-success,
// benefits-repair-failure
// Add &no-animation-frames=true to keep requestAnimationFrame callbacks permanently paused.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const dist = path.resolve(__dirname, "../../dist");

function installMockLauncher() {
  const parameters = new URLSearchParams(location.search);
  const scenario = parameters.get("scenario") || "embedded";
  if (parameters.get("no-animation-frames") === "true") {
    window.fixtureAnimationRequests = 0;
    window.requestAnimationFrame = () => { window.fixtureAnimationRequests++; return 1; };
    window.cancelAnimationFrame = () => {};
  }
  const language = ["en", "ru", "zh-CN", "ja"].includes(parameters.get("language")) ? parameters.get("language") : "en";
  const benefitsScenario = scenario.startsWith("benefits-");
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
    mcpGuideStep: 0,
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
  let runtimeCapabilities = benefitsScenario ? { runtimeStatus: "ready", nativeAvailability: "ready", webAvailability: "ready",
    tunnelStatus: "ready", tunnelRepair: { eligible: false, active: false, reason: null } } : undefined;
  if (scenario === "benefits-repair-success" || scenario === "benefits-repair-failure") {
    runtimeCapabilities = { runtimeStatus: "degraded", nativeAvailability: "ready", webAvailability: "degraded",
      tunnelStatus: "failed", tunnelRepair: { eligible: true, active: false, reason: "tunnel-unavailable" } };
  }
  const snapshot = () => ({
    profile: scenario === "models-ready" || scenario === "tools-pending" || benefitsScenario ? "production" : "development", profilePaths: { coreHome: "", codexHome: "", userData: "" },
    state: { ...state }, browser: { ...browser }, connectorName: "Fixture connector",
    connectorNames: { automatic: "Fixture connector", manual: "Fixture manual" }, mcpCredentialsConfigured: scenario === "tools-pending",
    logs: [], urls: { github: "https://github.com/Froraut/NEKODEX", x: "", connectors: "https://chatgpt.com/plugins", developerMode: "https://chatgpt.com/#settings/Security?section=developer-mode", tunnels: "", keys: "" },
    browserCapacity: { configured: 16, active: 16, maximum: 1000, restartRequired: false },
    platform: "darwin", packaged: false, version: "fixture", smokePassed: state.browserSmokePassed, operation, update,
    ...(runtimeCapabilities ? { runtimeCapabilities } : {}),
  });
  let startupAttempts = 0;
  const calls = [];
  window.fixtureCalls = calls;
  window.codexWebLauncher = {
    snapshot: async () => {
      if (scenario === "startup-error" && startupAttempts++ === 0) throw new Error("Error invoking remote method 'launcher:snapshot': Error: Fixture runtime unavailable");
      return snapshot();
    },
    recheckUpdate: async () => { calls.push(["update-recheck"]); update = { status: "up-to-date" }; emit("update", update); return update; },
    onStateChanged: listen("state"), onBrowserState: listen("browser"), onOperation: listen("operation"), onLog: listen("log"), onUpdateState: listen("update"),
    setBrowserBounds: async bounds => { window.fixtureBounds = bounds; return true; },
    setBrowserSurfaceActive: async (active) => { browser.surfaceActive = active; return { ...browser }; },
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
    continuePasskeyLogin: async () => { calls.push(["continue"]); return true; },
    revealPasskeyLogin: async () => { calls.push(["passkey-reveal"]); return true; },
    cancelPasskeyLogin: async () => { calls.push(["passkey-cancel"]); return true; },
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
      emit("browser", { ...browser }); return { ...browser };
    },
    accounts: async () => accountSnapshot,
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
    selectAccount: async (id) => { accountSnapshot = { ...accountSnapshot, selectedId: id }; return accountSnapshot; },
    checkAccount: async () => accountSnapshot,
    addAccount: async () => accountSnapshot,
    removeAccount: async () => accountSnapshot,
    setAccountProxy: async () => accountSnapshot,
    setAccountSafety: async () => accountSnapshot,
    resumeAccount: async () => accountSnapshot,
    refreshAccountCodexQuotas: async () => ({ generatedAt: "2026-09-21T10:10:00.000Z", rows: [
      { accountId: "fixture-primary", evidenceEpoch: 1, status: "updated", snapshot: quota, reason: null },
      { accountId: "fixture-secondary", evidenceEpoch: 1, status: "retained", snapshot: retainedQuota, reason: "quota-refresh-unavailable" },
      { accountId: "fixture-tertiary", evidenceEpoch: 3, status: "unavailable", snapshot: null, reason: "authentication-unavailable" },
    ].filter(row => accountSnapshot.accounts.some(account => account.id === row.accountId)) }),
    startCodexLogin: async () => { calls.push(["start-codex-login"]); return null; },
    usage: async (query) => ({ available: true, rows: [], generatedAt: "2026-09-21T10:00:00.000Z", timeZone: "UTC",
      source: query.source, period: { startDay: "2026-09-21", endDay: "2026-09-21", days: query.days },
      selectedAccountId: query.accountId ?? null,
      accounts: accountSnapshot.accounts.map(account => ({ id: account.id, label: account.label, available: true })),
      metrics: scenario === "benefits-insights"
        ? { total: 27, completed: 22, failed: 4, cancelled: 1, unrecorded: 0,
          knownOutcomeTotal: 27, knownOutcomeCompletionRate: 22 / 27 }
        : { total: 0, completed: 0, failed: 0, cancelled: 0, unrecorded: 0,
          knownOutcomeTotal: 0, knownOutcomeCompletionRate: null },
      durations: scenario === "benefits-insights"
        ? { observedSamples: 24, medianMs: 4100, p95Ms: 9200 }
        : { observedSamples: 0, medianMs: null, p95Ms: null }, failures: [], calendar: [],
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
      ] } : {}) }),
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
