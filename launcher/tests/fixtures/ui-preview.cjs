// Credential-free UI fixture. Build the renderer first, then run this file with
// Node or Bun and open the loopback URL it prints. No Electron or ChatGPT calls.
// Scenarios: ?scenario=embedded, passkey, onboarding, startup-error, existing-chrome-failed
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
  const browser = {
    status: "signed-out", message: "Fixture sign-in", url: "https://auth.openai.com/auth_challenge/passkey", title: "Sign in",
    authenticated: false, visible: true, surfaceActive: false, loading: false, canGoBack: true, canGoForward: true,
    zoomFactor: 1, navigationLocked: true, loginInProgress: true, loginKind: scenario === "passkey" ? "passkey" : "embedded",
    activeTabId: "fixture-home", maxTabs: 5,
    tabs: [
      { id: "fixture-home", traceId: null, title: "Sign in", status: "signed-out", loading: false, active: true, closable: false },
      { id: "fixture-help", traceId: null, title: "Fixture tab", status: "idle", loading: false, active: false, closable: false },
    ],
  };
  let operation = scenario === "passkey" ? { name: "passkey-login", status: "running", message: "Waiting in Chrome" } : null;
  if (scenario === "existing-chrome-failed") {
    Object.assign(browser, { navigationLocked: false, loginInProgress: false, loginKind: null, visible: false,
      existingChromeLogin: { phase: "failed", startedAt: new Date().toISOString(), deadlineAt: new Date().toISOString(),
        active: false, canCancel: false, canCopySettings: true, error: "chrome-profile-access-denied" } });
    operation = { name: "existing-chrome-login", status: "failed", message: "Fixture Chrome access was denied" };
  }
  const snapshot = () => ({
    profile: "development", profilePaths: { coreHome: "", codexHome: "", userData: "" },
    state: { ...state }, browser: { ...browser }, connectorName: "Fixture connector",
    connectorNames: { automatic: "Fixture connector", manual: "Fixture manual" }, mcpCredentialsConfigured: false,
    logs: [], urls: { github: "https://github.com/miuuyy/codex-chatgpt-web", x: "https://x.com/", connectors: "", tunnels: "", keys: "" },
    platform: "darwin", packaged: false, version: "fixture", smokePassed: false, operation, update: { status: "disabled" },
  });
  let startupAttempts = 0;
  const calls = [];
  window.fixtureCalls = calls;
  window.codexWebLauncher = {
    snapshot: async () => {
      if (scenario === "startup-error" && startupAttempts++ === 0) throw new Error("Error invoking remote method 'launcher:snapshot': Error: Fixture runtime unavailable");
      return snapshot();
    },
    onStateChanged: listen("state"), onBrowserState: listen("browser"), onOperation: listen("operation"), onLog: listen("log"), onUpdateState: listen("update"),
    setBrowserBounds: async () => true,
    setBrowserSurfaceActive: async (active) => { browser.surfaceActive = active; return { ...browser }; },
    showBrowser: async () => { browser.visible = true; emit("browser", { ...browser }); return { ...browser }; },
    hideBrowser: async () => { browser.visible = false; emit("browser", { ...browser }); return { ...browser }; },
    navigateBrowser: async (action) => { calls.push(["navigate", action]); return { ...browser }; },
    openPasskeyLogin: async () => {
      calls.push(["passkey"]); browser.loginKind = "passkey";
      operation = { name: "passkey-login", status: "running", message: "Waiting in Chrome" };
      emit("browser", { ...browser }); emit("operation", operation); return { ...browser };
    },
    continuePasskeyLogin: async () => { calls.push(["continue"]); return true; },
    openExistingChromeLogin: async () => { calls.push(["existing-chrome-retry"]); return { ...browser }; },
    cancelExistingChromeLogin: async () => { calls.push(["existing-chrome-cancel"]); return { ...browser }; },
    copyExistingChromeSettingsAddress: async () => { calls.push(["existing-chrome-settings-copy"]); return true; },
    selectBrowserTab: async (tabId) => {
      calls.push(["tab", tabId]); browser.tabs = browser.tabs.map((tab) => ({ ...tab, active: tab.id === tabId }));
      emit("browser", { ...browser }); return { ...browser };
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
