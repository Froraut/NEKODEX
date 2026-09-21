// Credential-free UI fixture. Build the renderer first, then run this file with
// Node or Bun and open the loopback URL it prints. No Electron or ChatGPT calls.
// Scenarios: ?scenario=embedded, passkey, passkey-failed, onboarding, startup-error,
// existing-chrome-failed, setup-fresh, manual-tools, accounts-failed, update-active, diagnostics-redirect
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
  const language = ["en", "zh-CN", "ja"].includes(parameters.get("language")) ? parameters.get("language") : "en";
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
    mcpGuideStep: 0, sessionRefreshReminderAt: null,
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
  if (scenario === "models-ready" || scenario === "tools-pending") {
    Object.assign(state, { coreSetupComplete: true, codexCatalogVerified: true, codexPickerConfirmed: true, browserSmokePassed: true,
      browserSmokeVersion: "fixture", mcpRuntimeInstalled: scenario === "tools-pending", mcpSetupComplete: false });
    Object.assign(browser, { authenticated: true, accountLabel: "fixture@example.test", status: "ready",
      navigationLocked: false, loginInProgress: false, loginKind: null, visible: false });
  }
  let operation = scenario === "passkey" ? { name: "passkey-login", status: "running", message: "Waiting in Chrome" } : null;
  if (scenario === "existing-chrome-failed") {
    Object.assign(browser, { navigationLocked: false, loginInProgress: false, loginKind: null, visible: false,
      existingChromeLogin: { phase: "failed", startedAt: new Date().toISOString(), deadlineAt: new Date().toISOString(),
        active: false, canCancel: false, canCopySettings: true, canAllowFileAccess: true, error: "chrome-profile-access-denied" } });
    operation = { name: "existing-chrome-login", status: "failed", message: "Fixture Chrome access was denied" };
  }
  let update = scenario === "update-recheck" ? { status: "error", message: "Fixture offline" }
    : scenario === "update-active" ? { status: "verifying", version: "9.9.9" }
      : scenario === "update-missing-speed" ? { status: "downloading", version: "9.9.9", downloadedBytes: 4096, totalBytes: 8192 }
        : { status: "disabled" };
  const defaultPolicy = { enabled: false, minIntervalSec: 10, maxConcurrent: 1, breakAfterMinutes: 30,
    breakMinutes: 5, maxSessionMinutes: 240, cooldownMinutes: 3, newSessionWindow: null };
  let accountSnapshot = { selectedId: "fixture-primary", mode: "selected", accounts: [
    { id: "fixture-primary", label: "Primary", enabled: true, authenticated: true, accountLabel: "primary@example.test",
      activeTurns: 0, checked: true, connectorReady: true, evidenceEpoch: 1, proxy: { mode: "system" },
      safety: { policy: defaultPolicy, cooldownUntil: 0, stopped: false, newSessionWindow: null } },
    { id: "fixture-secondary", label: "Secondary", enabled: true, authenticated: true, accountLabel: "secondary@example.test",
      activeTurns: 0, checked: false, connectorReady: false, evidenceEpoch: 1, proxy: { mode: "system" },
      safety: { policy: defaultPolicy, cooldownUntil: 0, stopped: false, newSessionWindow: null } },
  ] };
  const quota = { availability: "available", coverage: "reported_buckets", accountId: "fixture-primary",
    planType: "plus", accountBucket: { id: "account", name: "Account", normalModelSlug: null,
      allowed: true, limitReached: false,
      primary: { usedPercent: 10, remainingPercent: 90, windowDurationMins: 300, resetsAt: null },
      secondary: { usedPercent: null, remainingPercent: null, windowDurationMins: null, resetsAt: null } },
    additionalBuckets: [], additionalBucketsTruncated: false };
  let quotaFailed = scenario === "accounts-failed";
  let diagnosticChecks = 0;
  const snapshot = () => ({
    profile: scenario === "models-ready" || scenario === "tools-pending" ? "production" : "development", profilePaths: { coreHome: "", codexHome: "", userData: "" },
    state: { ...state }, browser: { ...browser }, connectorName: "Fixture connector",
    connectorNames: { automatic: "Fixture connector", manual: "Fixture manual" }, mcpCredentialsConfigured: scenario === "tools-pending",
    logs: [], urls: { github: "https://github.com/Froraut/NEKODEX", x: "", connectors: "https://chatgpt.com/plugins", developerMode: "https://chatgpt.com/#settings/Security?section=developer-mode", tunnels: "", keys: "" },
    browserCapacity: { configured: 16, active: 16, maximum: 1000, restartRequired: false },
    platform: "darwin", packaged: false, version: "fixture", smokePassed: state.browserSmokePassed, operation, update,
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
    setBrowserBounds: async () => true,
    setBrowserSurfaceActive: async (active) => { browser.surfaceActive = active; return { ...browser }; },
    showBrowser: async () => { browser.visible = true; emit("browser", { ...browser }); return { ...browser }; },
    hideBrowser: async () => { browser.visible = false; emit("browser", { ...browser }); return { ...browser }; },
    navigateBrowser: async (action) => { calls.push(["navigate", action]); return { ...browser }; },
    setupHermes: async () => { calls.push(["hermes"]); return { provider: "codex-web", defaultChanged: false }; },
    openPasskeyLogin: async () => {
      calls.push(["passkey"]); browser.loginKind = "passkey";
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
    accountCodexQuotaSnapshot: async (id) => {
      calls.push(["quota-snapshot", id]);
      if (quotaFailed && id === "fixture-primary") throw new Error("Fixture quota unavailable");
      return id === "fixture-primary" ? quota : null;
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
    refreshAccountCodexQuotas: async () => ({ accounts: accountSnapshot.accounts.map(account => ({ accountId: account.id, quota: account.id === "fixture-primary" ? quota : null })) }),
    startCodexLogin: async () => { calls.push(["start-codex-login"]); return null; },
    usage: async (query) => ({ available: true, rows: [], generatedAt: "2026-09-21T10:00:00.000Z", timeZone: "UTC",
      source: query.source, period: { startDay: "2026-09-21", endDay: "2026-09-21", days: query.days },
      selectedAccountId: query.accountId ?? null,
      accounts: accountSnapshot.accounts.map(account => ({ id: account.id, label: account.label, available: true })),
      metrics: { total: 0, completed: 0, failed: 0, cancelled: 0, unrecorded: 0,
        knownOutcomeTotal: 0, knownOutcomeCompletionRate: null },
      durations: { observedSamples: 0, medianMs: null, p95Ms: null }, failures: [], calendar: [] }),
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
