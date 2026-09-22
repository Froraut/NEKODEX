const { BrowserArtifactTransfers } = require("./browser-artifact-transfers.cjs");
const { BrowserManualTurns, manualPromptDigest, MANUAL_SUBMIT_TIMEOUT_MS, MANUAL_COMPACTION_SUBMIT_TIMEOUT_MS } = require("./browser-manual-turns.cjs");
const { BrowserTurnLifecycle, TURN_HEARTBEAT_SWEEP_MS } = require("./browser-turn-lifecycle.cjs");
const { BrowserWorkspaceWindows } = require("./browser-workspace-windows.cjs");
const { authenticationIssue } = require("./authentication-issue.cjs");
const { validateAccountId } = require("./account-registry.cjs");
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { setTimeout: delay } = require("node:timers/promises");
const { clipboard, dialog, BrowserWindow, WebContentsView, powerMonitor, powerSaveBlocker, session: electronSession, shell } = require("electron");
const { writePrivateFileAtomic } = require("./atomic-file.cjs");
const { BrowserTaskLedger } = require('./browser-task-ledger.cjs');
const { createTaskArtifactDownloadGuard } = require('./task-artifact-download.cjs');
const { awaitInspection, inspectionAbortError } = require("./inspection-control.cjs");
const {
  hasUnsettledBrowserHelpers,
  runBrowserHelperOperation,
  verifyConnectorWithBrowserHelper,
} = require("./browser-helper-verifier.cjs");
const { validateConnectorName } = require("./connector-identity.cjs");
const { validatePasskeyLoginState } = require("./passkey-login-state.cjs");
const { isVerifiedCaptureTransfer, sessionIdentity, verifiedCaptureTransfer, verifyCapturedAccount } = require("./chrome-session-identity.cjs");
const { captureOwnedSession, disposeOwnedSessionSnapshot, restoreOwnedSession } = require("./owned-session-rollback.cjs");
const { initialPasskeyProgress, publicPasskeyProgress } = require("./passkey-login-progress.cjs");
const {
  publicExistingChromeProgress,
  openExistingChromeLogin,
  cancelExistingChromeLogin,
  waitForPreviousAuthentication,
} = require("./existing-chrome-login.cjs");
const { createRemotePermissionPolicy, httpsOrigin } = require("./remote-permissions.cjs");
const { createExternalLinkBroker } = require("./external-links.cjs");
const { shouldBlockSleepForTurns } = require("./turn-suspension.cjs");
const {
  browserViewVisible,
  constrainBrowserBounds,
  navigateBrowser,
  readBrowserNavigationState,
  scaleBrowserBounds,
  shellZoomActionForInput,
} = require("./browser-state.cjs");

const TEMPORARY_CHAT_URL = "https://chatgpt.com/?temporary-chat=true";
const CHATGPT_ORIGIN = "https://chatgpt.com";
const IDLE_BROWSER_URL = "data:text/html;charset=utf-8,%3C!doctype%20html%3E%3Chtml%3E%3Chead%3E%3Cmeta%20charset%3D%22utf-8%22%3E%3Ctitle%3ENEKODEX%3C%2Ftitle%3E%3C%2Fhead%3E%3Cbody%3E%3C%2Fbody%3E%3C%2Fhtml%3E#codex-web-gpt-browser-host";
const PRIMARY_VIEW_BOOTSTRAP_TIMEOUT_MS = 10_000;
const MAX_BROWSER_VIEW_DIMENSION = 16_384;
const { DEFAULT_BROWSER_CAPACITY, validateBrowserCapacity } = require("./browser-capacity.cjs");
const INTERACTION_MODE_CHANGE_OPERATION = "browser interaction mode change";
const HIDDEN_TURN_VIEWPORT = Object.freeze({ width: 800, height: 600 });
const BROWSER_NAVIGATION_TIMEOUT_MS = 60_000;
const CHATGPT_AUTH_SESSION_TIMEOUT_MS = 5_000;
const AUTH_HANDOFF_TIMEOUT_MS = 15_000;
const WINDOW_VISIBILITY_EVENTS = ["show", "hide", "minimize", "restore"];
const CHATGPT_BACKEND_REQUEST_FILTER = { urls: [
  `${CHATGPT_ORIGIN}/backend-api/*`,
  `${CHATGPT_ORIGIN}/api/auth/*`,
  "https://auth.openai.com/*", "https://auth0.openai.com/*", "https://login.openai.com/*",
  "https://accounts.openai.com/*", "https://accounts.google.com/*",
  "https://login.microsoftonline.com/*", "https://appleid.apple.com/*", "https://idmsa.apple.com/*",
] };
const WORKSPACE_SESSION_MUTATION_PATH = /^\/(?:api\/auth\/(?:callback|signin|signout)|backend-api\/(?:accounts\/logout|auth\/))/i;
const ZOOM_FACTORS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
const SHELL_ZOOM_LEVEL_STEP = 0.5;
const SHELL_ZOOM_LEVEL_LIMIT = 5;
const AUTH_PROVIDER_HOSTS = new Set([
  "auth.openai.com",
  "auth0.openai.com",
  "login.openai.com",
  "accounts.openai.com",
  "accounts.google.com",
  "login.microsoftonline.com",
  "appleid.apple.com",
  "idmsa.apple.com",
]);
const CLOUDFLARE_CHALLENGE_RECOVERY_DELAY_MS = 500;
const CLOUDFLARE_CHALLENGE_RECOVERY_SETTLE_MS = 1_000;
const COMPOSER_SELECTOR = [
  '[data-testid="prompt-textarea"]',
  "#prompt-textarea",
  '[contenteditable="true"][data-lexical-editor="true"]',
  '[contenteditable="true"][role="textbox"]',
  "textarea",
].join(", ");
const CHATGPT_VIEWPORT_CSS = `
  html,
  body {
    width: 100% !important;
    max-width: 100% !important;
    overflow-x: hidden !important;
    overscroll-behavior-x: none !important;
  }

  #__next {
    width: 100% !important;
    max-width: 100% !important;
    min-width: 0 !important;
    overflow-x: hidden !important;
  }
`;

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function authViewOptions(options, partition) {
  // Electron can omit webContents for a background-tab/window-open request. Passing an
  // explicitly undefined webContents throws before the login surface can be attached.
  // Reuse the supplied guest when available; otherwise create a sandboxed guest in our
  // own partition, without inheriting a preload or privileged window preferences.
  if (options?.webContents) return { webContents: options.webContents };
  return {
    webPreferences: {
      partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
      ...(options?.webPreferences?.javascript === false ? { javascript: false } : {}),
      ...(Number.isInteger(options?.webPreferences?.openerSandboxFlags)
        ? { openerSandboxFlags: options.webPreferences.openerSandboxFlags } : {}),
    },
  };
}

function javaScriptLiteral(value) {
  return JSON.stringify(value).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

function combinedError(primary, label, secondary) {
  const first = primary instanceof Error ? primary.message : String(primary);
  const second = secondary instanceof Error ? secondary.message : String(secondary);
  return new Error(`${first}; ${label}: ${second}`);
}

function visibleElementScript(selector) {
  return `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find((element) => {
    const style = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    return element.isConnected
      && bounds.width > 0
      && bounds.height > 0
      && style.display !== "none"
      && style.visibility !== "hidden"
      && style.opacity !== "0";
  })`;
}

function normalizeBounds(bounds) {
  const read = (value) => Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  return {
    x: Math.min(MAX_BROWSER_VIEW_DIMENSION, read(bounds?.x)),
    y: Math.min(MAX_BROWSER_VIEW_DIMENSION, read(bounds?.y)),
    width: Math.min(MAX_BROWSER_VIEW_DIMENSION, Math.max(1, read(bounds?.width))),
    height: Math.min(MAX_BROWSER_VIEW_DIMENSION, Math.max(1, read(bounds?.height))),
  };
}

function allowedAuthUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) return false;
  if (parsed.hostname === "chatgpt.com") {
    return parsed.pathname === "/auth"
      || parsed.pathname.startsWith("/auth/")
      || parsed.pathname === "/login";
  }
  return AUTH_PROVIDER_HOSTS.has(parsed.hostname);
}

function allowedWorkspaceUrl(value) {
  try {
    const url = new URL(value);
    return (url.origin === CHATGPT_ORIGIN && !url.username && !url.password)
      || allowedAuthUrl(value);
  } catch { return false; }
}

function isWorkspaceSessionMutationRequest(details) {
  if (!details || ["GET", "HEAD", "OPTIONS"].includes(String(details.method).toUpperCase())) return false;
  try {
    const url = new URL(details.url);
    return url.origin === CHATGPT_ORIGIN
      ? WORKSPACE_SESSION_MUTATION_PATH.test(url.pathname)
      : AUTH_PROVIDER_HOSTS.has(url.hostname);
  } catch { return false; }
}

async function readBoundedJson(response, maximum = 256 * 1024) {
  if (!response?.body) throw new Error("ChatGPT session response was empty");
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximum) throw new Error("ChatGPT session response was too large");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new Error("ChatGPT session response was too large");
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("ChatGPT session response was not JSON"); }
}

function guardBrowserNavigation(contents, external) {
  const guard = (event, url) => {
    if (allowedWorkspaceUrl(url)) return;
    event.preventDefault();
    // The external broker independently requires a fresh user gesture.
    void external(url);
  };
  contents.on('will-navigate', guard);
  contents.on('will-redirect', (event, url, _inPlace, mainFrame) => { if (mainFrame) guard(event, url); });
}

function navigationOriginForLog(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.origin
      : parsed.protocol;
  } catch {
    return "invalid-url";
  }
}

function navigationErrorForLog(error) {
  if (!error || typeof error !== "object") return { errorType: typeof error };
  const detail = {
    errorType: typeof error.name === "string" && error.name ? error.name : "Error",
  };
  if (typeof error.code === "string" || typeof error.code === "number") {
    detail.errorCode = error.code;
  }
  return detail;
}

function isAbortedNavigationError(error) {
  if (error && typeof error === "object"
    && (error.code === -3 || error.code === "ERR_ABORTED")) {
    return true;
  }
  return error instanceof Error && /\bERR_ABORTED\b/.test(error.message);
}

function isTemporaryChatUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.origin === CHATGPT_ORIGIN
    && parsed.pathname === "/"
    && parsed.searchParams.get("temporary-chat") === "true";
}

function isChatGptBackendUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.origin === CHATGPT_ORIGIN && parsed.pathname.startsWith("/backend-api/");
}

function responseHeaderIncludes(responseHeaders, name, expectedValue) {
  const expected = expectedValue.toLowerCase();
  return Object.entries(responseHeaders || {}).some(([headerName, rawValues]) => {
    if (headerName.toLowerCase() !== name.toLowerCase()) return false;
    const values = Array.isArray(rawValues) ? rawValues : [rawValues];
    return values.some(value => String(value)
      .split(",")
      .some(candidate => candidate.trim().toLowerCase() === expected));
  });
}

function isChatGptCloudflareChallengeResponse(details) {
  return details?.statusCode === 403
    && isChatGptBackendUrl(details.url)
    && responseHeaderIncludes(details.responseHeaders, "cf-mitigated", "challenge");
}

function browserInteractionModeFor(host) {
  const savedMode = host.getBrowserInteractionMode?.();
  // Setup commits the runtime before the launcher publishes its state. Keep the new descriptor
  // mode across that gap, then release the override once the persisted state catches up.
  if (host.interactionModeOverride && host.manualOperation !== INTERACTION_MODE_CHANGE_OPERATION
    && savedMode === host.interactionModeOverride) {
    host.interactionModeOverride = null;
  }
  const mode = host.interactionModeOverride ?? savedMode ?? "automatic";
  if (mode !== "automatic" && mode !== "manual") {
    throw new Error("Launcher browser interaction mode is invalid");
  }
  return mode;
}

function requireAutomaticBrowserInspection(host, operation) {
  if (browserInteractionModeFor(host) === "manual") {
    const error = new Error(`${operation} is disabled in Manual mode`);
    error.code = "manual_browser_inspection_disabled";
    throw error;
  }
}

function artifactTransfersFor(host) {
  return host.artifactTransfers ??= new BrowserArtifactTransfers({
    tabs: host.turnTabs, leases: host.artifactLeases, downloads: host.artifactDownloads,
    coreHome: host.coreHome, logger: host.logger,
  });
}

function manualTurnsFor(host) {
  return host.manualTurns ??= new BrowserManualTurns({
    tabs: host.turnTabs,
    terminals: host.manualTerminalSignals,
    completions: host.manualCompletionSignals,
    logger: host.logger,
    context: {
      get manualOperation() { return host.manualOperation; },
      get clipboard() { return host.clipboard; },
      get cancelTurn() { return typeof host.cancelTurn === "function" ? traceId => host.cancelTurn(traceId) : null; },
      submitTimeoutSec: () => host.getManualSubmitTimeoutSec(),
    },
    lifecycle: {
      assertLiveConversationOwner: (...args) => host.assertLiveConversationOwner(...args),
      removeTurnTab: (...args) => host.removeTurnTab(...args),
      createManualTurnTab: (...args) => host.createManualTurnTab(...args),
    },
    presentation: {
      activate: tab => { host.selectedTabId = tab.id; host.showWindow(); host.show(); },
      snapshot: () => host.snapshot(),
      publish: () => host.publishState?.(host.snapshot()),
      writeDescriptor: () => host.writeDescriptor(),
    },
  });
}

function turnLifecycleFor(host) {
  if (host.turnLifecycle) return host.turnLifecycle;
  host.turnLifecycle = new BrowserTurnLifecycle({
    tabs: host.turnTabs,
    closedOwners: host.closedTurnOwners,
    cancelledOwners: host.userCancelledTurnOwners,
    lastSweepAt: host.lastTurnSweepAt,
    logger: host.logger,
    context: {
      get ledger() { return host.taskLedger; },
      get accountId() { return host.accountId; },
      get maxTabs() { return host.maxTabs; },
      get authIdentityEpoch() { return host.authIdentityEpoch; },
      get authPrincipalFingerprint() { return host.authPrincipalFingerprint; },
      get manualOperation() { return host.manualOperation; },
      get activeTraceId() { return host.activeTraceId; },
      get cancelTurn() { return host.cancelTurn ? (...args) => host.cancelTurn(...args) : null; },
      cancelledError: traceId => new BrowserTurnCancelledError(traceId),
    },
    views: {
      idleUrl: IDLE_BROWSER_URL,
      create: () => host.createAutomaticTurnView(),
      attach: tab => host.attachAutomaticTurnView(tab),
      initialize: async tab => {
        await loadCommittedBrowserSurface(tab.view.webContents, IDLE_BROWSER_URL);
        await host.markTurnTabSurface(tab);
      },
      isTrusted: tab => host.hasTrustedTurnDocument(tab),
      dispose: tab => host.disposeTurnView(tab),
    },
    presentation: {
      get selectedTabId() { return host.selectedTabId; },
      set selectedTabId(value) { host.selectedTabId = value; },
      afterRemoval: tab => host.presentAfterTurnRemoval(tab),
      syncPowerSaveBlocker: () => host.syncPowerSaveBlocker(),
      syncViewVisibility: () => host.syncViewVisibility(),
      snapshot: () => host.snapshot(),
      publishState: state => host.publishState?.(state),
      writeDescriptor: () => host.writeDescriptor(),
      show: () => host.show(),
      hide: () => host.hide(),
    },
    manual: {
      dispose: (tab, shutdown) => host.disposeManualTurn(tab, shutdown),
      signalTerminal: (tab, status) => host.signalManualTerminal(tab, status),
      cancel: (tab, reason) => host.cancelManualTab(tab, reason),
    },
    artifacts: { release: (...args) => host.releaseArtifactDownloads(...args) },
    events: {
      owned: receipt => host.onTurnTabOwned?.(receipt),
      removed: receipt => host.onTurnTabRemoved?.(receipt),
    },
  });
  return host.turnLifecycle;
}

class BrowserTurnCancelledError extends Error {
  constructor(traceId) {
    super(`Browser turn ${traceId} was cancelled by the user`);
    this.name = "BrowserTurnCancelledError";
    this.code = "turn_cancelled";
  }
}

function loadCommittedBrowserSurface(
  contents,
  url,
  timeoutMs = PRIMARY_VIEW_BOOTSTRAP_TIMEOUT_MS,
) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Browser idle document timeout must be positive");
  }
  if (!contents || contents.isDestroyed()) {
    return Promise.reject(new Error("Browser closed before idle document bootstrap"));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timeout);
      contents.off("did-stop-loading", onReady);
      contents.off("did-finish-load", onReady);
      contents.off("did-fail-load", onFailed);
      contents.off("render-process-gone", onRendererGone);
      contents.off("destroyed", onDestroyed);
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onReady = () => {
      if (contents.isDestroyed()) {
        finish(new Error("Browser closed during idle document bootstrap"));
        return;
      }
      if (contents.getURL() === url) finish();
    };
    const onFailed = (_event, errorCode, errorDescription, failedUrl, mainFrame) => {
      if (!mainFrame) return;
      finish(new Error(
        `Browser idle document failed: ${errorDescription} (${errorCode}) at ${failedUrl}`,
      ));
    };
    const onRendererGone = (_event, details) => {
      finish(new Error(`Browser renderer stopped during idle document bootstrap: ${details.reason}`));
    };
    const onDestroyed = () => finish(new Error("Browser closed during idle document bootstrap"));
    const timeout = setTimeout(() => {
      finish(new Error(`Browser idle document did not commit within ${timeoutMs}ms`));
      if (!contents.isDestroyed()) contents.stop();
    }, timeoutMs);
    timeout.unref?.();
    contents.on("did-stop-loading", onReady);
    contents.on("did-finish-load", onReady);
    contents.on("did-fail-load", onFailed);
    contents.on("render-process-gone", onRendererGone);
    contents.on("destroyed", onDestroyed);
    try {
      Promise.resolve(contents.loadURL(url)).then(onReady, error => {
        finish(error instanceof Error ? error : new Error(String(error)));
      });
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

class BrowserHost {
  constructor({
    window,
    descriptorPath,
    cdpPort,
    control,
    cancelTurn,
    getConnectorName,
    helper,
    logger,
    loginWithPasskey,
    loginWithChromeProfile,
    loginWithExistingChrome,
    partition = "persist:codex-web-gpt-chatgpt",
    profile = "production",
    publishState,
    showWindow = () => {},
    clipboardApi = clipboard,
    dialogApi = dialog,
    getBrowserInteractionMode = () => "automatic",
    getManualSubmitTimeoutSec = () => 120,
    configureAccountSession = async () => {},
    skipInitialNavigation = false,
    maxTabs = DEFAULT_BROWSER_CAPACITY,
    accountId = "default",
    isAccountVisible = () => true,
    onAuthIdentityChanged = () => {},
    workspaceSessionMutation = null,
    workspaceManifestPath = null,
    workspaceChanged = () => {},
    workspaceDisplays = () => [],
    taskLedger = null,
    onTurnTabRemoved = () => {},
    onTurnTabOwned = () => {},
    coreHome = path.dirname(path.dirname(descriptorPath)),
  }) {
    if (typeof getConnectorName !== "function") {
      throw new Error("Browser host connector-name resolver is unavailable");
    }
    if (typeof loginWithPasskey !== "function") {
      throw new Error("Browser host passkey login operation is unavailable");
    }
    this.configuredMaxTabs = validateBrowserCapacity(maxTabs);
    this.window = window;
    this.descriptorPath = descriptorPath;
    this.coreHome = path.resolve(coreHome);
    if (path.dirname(path.resolve(descriptorPath)) !== path.join(this.coreHome, 'runtime')) {
      throw new Error('Browser host descriptor does not belong to its configured core home');
    }
    this.cdpPort = cdpPort;
    this.control = control;
    this.cancelTurn = cancelTurn;
    this.getConnectorName = getConnectorName;
    this.helper = helper;
    this.logger = logger;
    this.loginWithPasskey = loginWithPasskey;
    this.loginWithChromeProfile = loginWithChromeProfile;
    this.loginWithExistingChrome = loginWithExistingChrome;
    if (profile !== "production" && profile !== "development") {
      throw new Error("Browser host profile is invalid");
    }
    this.accountId = validateAccountId(accountId);
    this.onTurnTabRemoved = onTurnTabRemoved;
    this.onTurnTabOwned = onTurnTabOwned;
    this.isAccountVisible = isAccountVisible;
    this.onAuthIdentityChanged = onAuthIdentityChanged;
    this.workspaceSessionMutation = workspaceSessionMutation;
    this.workspaceManifestPath = workspaceManifestPath;
    this.workspaceChanged = workspaceChanged;
    this.workspaceDisplays = workspaceDisplays;
    const basePartition = profile === "development"
      ? "persist:codex-web-gpt-dev-chatgpt"
      : "persist:codex-web-gpt-chatgpt";
    const expectedPartition = accountId === "default" ? basePartition : `${basePartition}-account-${accountId}`;
    if (partition !== expectedPartition) throw new Error("Browser host partition does not match its profile");
    this.partition = partition;
    this.taskLedger = taskLedger ?? new BrowserTaskLedger(path.join(path.dirname(descriptorPath), `tasks-${this.accountId}.json`));
    this.profile = profile;
    this.publishState = publishState;
    this.showWindow = showWindow;
    this.clipboard = clipboardApi;
    this.dialog = dialogApi;
    this.getBrowserInteractionMode = getBrowserInteractionMode;
    this.getManualSubmitTimeoutSec = getManualSubmitTimeoutSec;
    this.configureAccountSession = configureAccountSession;
    this.skipInitialNavigation = skipInitialNavigation === true;
    this.runBrowserHelperOperation = runBrowserHelperOperation;
    this.verifyConnectorWithBrowserHelper = verifyConnectorWithBrowserHelper;
    this.surfaceId = randomBytes(24).toString("base64url");
    this.visible = false;
    this.surfaceActive = true;
    this.turnTabs = new Map();
    this.closedTurnOwners = new Map();
    this.userCancelledTurnOwners = new Map();
    this.manualTerminalSignals = new Map();
    this.manualCompletionSignals = new Map();
    this.interactionModeOverride = null;
    this.selectedTabId = "home";
    this.manualOperation = null;
    this.loginOperation = null;
    this.authGeneration = 0;
    this.authProbeRevision = 0;
    this.authProbeTail = Promise.resolve();
    this.authenticationRetryOperation = null;
    this.authPrincipalFingerprint = null;
    this.authSessionFingerprint = null;
    this.authIdentityEpoch = 0;
    this.embeddedLoginController = null;
    this.passkeyLoginOperation = null;
    this.sessionRefreshOperation = null;
    this.cloudflareChallengeRecovery = null;
    this.cloudflareChallengeRecoveryArmed = true;
    this.cloudflareChallengeRecoveryDelayMs = CLOUDFLARE_CHALLENGE_RECOVERY_DELAY_MS;
    this.cloudflareChallengeRecoverySettleMs = CLOUDFLARE_CHALLENGE_RECOVERY_SETTLE_MS;
    this.viewportCssKey = null;
    this.primaryRendererReady = false;
    this.primaryDeviceEmulationViewport = null;
    this.primaryDeviceEmulationDirty = true;
    this.shellZoomShortcutBindings = new Map();
    this.authView = null;
    this.authNavigationError = null;
    this.homeNavigationTimeout = null;
    this.lastTurnSweepAt = Date.now();
    turnLifecycleFor(this);
    this.powerSaveBlockerId = null;
    this.turnLeaseSweep = setInterval(() => this.reapExpiredTurnTabs(), TURN_HEARTBEAT_SWEEP_MS);
    this.turnLeaseSweep.unref?.();
    this.resumeListener = () => this.refreshTurnLeases("system_resume");
    if (powerMonitor && typeof powerMonitor.on === "function") {
      powerMonitor.on("resume", this.resumeListener);
    } else {
      this.resumeListener = null;
    }
    this.boundsReady = false;
    this.bounds = { x: 0, y: 0, width: 1, height: 1 };
    this.state = {
      status: "idle",
      message: "No active task",
      url: "about:blank",
      title: "ChatGPT",
      authenticated: false,
      authenticationStatus: "unknown",
      authenticationCheckedAt: null,
      lastVerifiedAt: null,
      visible: false,
      surfaceActive: true,
      loading: false,
      canGoBack: false,
      canGoForward: false,
      zoomFactor: 1,
    };
    this.view = new WebContentsView({
      webPreferences: {
        partition: this.partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: true,
        backgroundThrottling: true,
        webSecurity: true,
      },
    });
    this.artifactDownloads = createTaskArtifactDownloadGuard(this.view.webContents.session, {
      onEvent: (event, detail) => this.logger[event === 'cancelled' ? 'warn' : 'info']?.(
        `browser.artifact_download_${event}`,
        detail,
      ),
    });
    this.artifactLeases = new Map();
    this.workspaceContents = new Map();
    this.workspaceMetadata = new Map();
    this.workspaceMutationRequests = new Map();
    const remoteContentsVisible = contents => this.workspaceContents.has(contents)
      ? (() => { const window = this.workspaceContents.get(contents); return !window.isDestroyed() && window.isVisible() && window.isFocused(); })()
      : this.window.isVisible() && !this.window.isMinimized()
      && this.isAccountVisible() && browserViewVisible(this.visible, this.surfaceActive, this.boundsReady)
      && this.activeView().webContents === contents;
    this.permissionPolicy = createRemotePermissionPolicy({
      session: this.view.webContents.session,
      isAllowedPage: (url, kind) => httpsOrigin(url) === CHATGPT_ORIGIN
        || (kind === "auth" && httpsOrigin(url) !== null && allowedAuthUrl(url)),
      isVisible: remoteContentsVisible,
      requestConsent: async ({ permission, origin, signal }) => {
        const reading = permission === "clipboard-read";
        const { response } = await dialogApi.showMessageBox(this.window, {
          type: "question",
          title: "ChatGPT browser permission",
          message: reading ? "Allow this page to read your clipboard once?" : "Allow this page to copy to your clipboard once?",
          detail: `${origin}\n${reading
            ? "Only allow this if you requested Paste. Clipboard contents may include private information."
            : "Only allow this if you requested Copy. This replaces the current clipboard contents."}`,
          buttons: ["Deny", "Allow once"],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
          signal,
        });
        return response === 1;
      },
    });
    this.externalLinkBroker = createExternalLinkBroker({
      shell,
      logger: this.logger,
      isVisible: remoteContentsVisible,
    });
    window.contentView.addChildView(this.view);
    this.windowVisibilityListener = () => this.syncViewVisibility();
    for (const event of WINDOW_VISIBILITY_EVENTS) {
      this.window.on(event, this.windowVisibilityListener);
    }
    this.view.webContents.setZoomFactor(this.state.zoomFactor);
    this.bindShellZoomShortcuts(this.window.webContents);
    this.bindShellZoomShortcuts(this.view.webContents);
    this.bindChatGptBackendRecovery();
    this.bindWorkspaceSessionRequestGuard();
    this.bindWebContents();
    this.initializationReady = this.initializePrimaryView().catch((error) => {
      this.logger.error("browser.initialization_failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      this.setState({ status: "error", message: "Embedded browser failed to initialize" });
      throw error;
    });
  }

  async ready() {
    await this.initializationReady;
  }

  async initializePrimaryView() {
    await this.configureAccountSession(this.view.webContents.session, this.accountId);
    if (this.destroyed || this.view.webContents.isDestroyed()) throw new Error("Browser initialization was cancelled");
    this.view.setBounds(this.hiddenTurnBounds());
    this.view.setVisible(true);
    try {
      // Package smoke verifies local startup, not network/account availability. Still finish
      // session configuration, pool initialization and descriptor publication below.
      if (!this.skipInitialNavigation) {
        await loadCommittedBrowserSurface(this.view.webContents, IDLE_BROWSER_URL);
        if (browserInteractionModeFor(this) === "automatic") await this.markOwnedSurface();
      }
    } finally {
      this.syncViewVisibility();
    }
    if (this.destroyed || this.view.webContents.isDestroyed()) throw new Error("Browser initialization was cancelled");
    this.writeDescriptor();
    this.logger.info("browser.initialized", { url: this.view.webContents.getURL() });
  }

  currentOperation() {
    return this.manualOperation || this.readOnlyInspection?.name || (this.loginOperation ? "ChatGPT login" : null)
      || (hasUnsettledBrowserHelpers?.(this.descriptorPath) ? "browser helper cleanup" : null);
  }

  withReadOnlyInspection(name, action, { preserveSelection = false } = {}) {
    if (this.activeTraceId || this.currentOperation()) {
      return Promise.reject(new Error("Finish the account's active task or operation before checking it"));
    }
    const controller = new AbortController();
    const contents = this.view?.webContents;
    const inspection = { name, controller, done: null };
    this.readOnlyInspection = inspection;
    const onAbort = () => {
      // Retire pending authentication reads before releasing the inspection lease.
      this.authGeneration = (this.authGeneration ?? 0) + 1;
      this.authProbeRevision += 1;
      if (this.view?.webContents === contents && !contents?.isDestroyed() && !this.activeTraceId) {
        try { contents.stop(); } catch {}
      }
    };
    controller.signal.addEventListener("abort", onAbort, { once: true });
    const deadline = setTimeout(() => controller.abort(new Error("Browser check timed out")), 90_000);
    deadline.unref?.();
    const run = preserveSelection
      ? (async () => {
          await awaitInspection(this.ready(), controller.signal);
          controller.signal.throwIfAborted();
          return await action(controller.signal);
        })()
      : this.withManualOperation(name, () => action(controller.signal), controller.signal);
    inspection.done = run
      .finally(() => {
        clearTimeout(deadline);
        controller.signal.removeEventListener("abort", onAbort);
        if (this.readOnlyInspection === inspection) {
          this.readOnlyInspection = null;
          this.publishState?.(this.snapshot());
        }
      });
    return inspection.done;
  }

  async cancelReadOnlyInspection() {
    const inspection = this.readOnlyInspection;
    if (!inspection) return;
    if (this.activeTraceId) throw new Error("An active task must finish before cancelling its browser check");
    inspection.controller.abort(Object.assign(new Error("Browser check cancelled for restart"), { name: "AbortError" }));
    // Helper cancellation owns and joins its exact child before this lease is released.
    await awaitInspection(inspection.done.catch(error => {
      if (error?.helperCleanupIncomplete) throw error;
    }), AbortSignal.timeout(12_000));
    if (this.readOnlyInspection === inspection) throw new Error("Browser check cancellation did not settle");
  }

  assertTurnTabsCanResetForInteractionModeChange() {
    if ([...this.turnTabs.values()].some(tab => tab.status === "running")) {
      throw new Error("Finish or cancel active ChatGPT turns before changing browser interaction mode");
    }
  }

  async withInteractionModeChange(mode, action) {
    if (mode !== "automatic" && mode !== "manual") {
      throw new Error("Browser interaction mode must be automatic or manual");
    }
    if (this.manualOperation) {
      throw new Error(`ChatGPT browser is already busy with ${this.manualOperation}`);
    }
    this.assertTurnTabsCanResetForInteractionModeChange();
    this.interactionModeOverride = mode;
    this.manualOperation = INTERACTION_MODE_CHANGE_OPERATION;
    let committed = false;
    try {
      let browserCommitted = false;
      // Setup inspects the launcher descriptor before afterRuntimeReady runs. Publish the target
      // mapping under the temporary mode before starting setup, without changing account/profile.
      if (mode === "automatic") await this.markOwnedSurface();
      this.writeDescriptor();
      const commitBrowserChange = async () => {
        if (browserCommitted) throw new Error("Browser interaction mode change was committed more than once");
        // Runtime setup invokes this callback inside its rollback boundary. The browser mapping
        // was already published so its own capability inspection could use the target surface.
        browserCommitted = true;
      };
      const result = await action(commitBrowserChange);
      if (!browserCommitted) {
        throw new Error("Runtime setup returned before committing the browser interaction mode");
      }
      committed = true;
      return result;
    } finally {
      this.manualOperation = null;
      if (!committed) this.interactionModeOverride = null;
      // Failure restores the prior mode after runtime rollback. Success retains the new mode until
      // the launcher state is published, so no helper observes a transient old target mapping.
      this.writeDescriptor();
    }
  }

  get maxTabs() { return this.configuredMaxTabs ?? DEFAULT_BROWSER_CAPACITY; }

  browserInteractionMode() {
    return browserInteractionModeFor(this);
  }

  requireAutomaticBrowserInspection(operation) {
    requireAutomaticBrowserInspection(this, operation);
  }

  get activeTraceId() {
    return [...this.turnTabs.values()].find((tab) => tab.status === "running")?.traceId || null;
  }

  tabSnapshot(tab) {
    const snapshot = {
      id: tab.id,
      traceId: tab.traceId,
      title: tab.label,
      status: tab.status,
      loading: tab.loading === true,
      active: this.selectedTabId === tab.id,
      closable: true,
      task: tab.taskRecordId ? this.taskLedger?.get(tab.taskRecordId) : undefined,
    };
    if (tab.interactionMode === "manual") {
      Object.assign(snapshot, {
        interactionMode: "manual",
        manualState: tab.manualState,
        ...(tab.manualDeadlineAt ? { manualDeadlineAt: new Date(tab.manualDeadlineAt).toISOString() } : {}),
        canCopyPrompt: typeof tab.prompt === "string" && tab.prompt.length > 0,
        canConfirmSent: tab.manualState === "awaiting-user",
      });
    }
    return snapshot;
  }

  selectedTurnTab() {
    return this.turnTabs.get(this.selectedTabId) || null;
  }

  taskSnapshot() {
    return turnLifecycleFor(this).taskSnapshot();
  }

  taskProgress(traceId, helperPid, surfaceId, phase, sequence) {
    return turnLifecycleFor(this).taskProgress(traceId, helperPid, surfaceId, phase, sequence);
  }

  createAutomaticTurnView() {
    return new WebContentsView({
      webPreferences: {
        partition: this.partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: true,
        backgroundThrottling: false,
        webSecurity: true,
      },
    });
  }

  attachAutomaticTurnView(tab) {
    const view = tab.view;
    this.window.contentView.addChildView(view);
    this.presentTurnView(tab, false);
    view.webContents.setZoomFactor(this.state.zoomFactor);
    this.bindShellZoomShortcuts(view.webContents);
    this.bindTurnContents(tab);
  }

  disposeTurnView(tab) {
    try { this.window.contentView.removeChildView(tab.view); } catch {}
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
  }

  disposeManualTurn(tab, shutdown = false) {
    return manualTurnsFor(this).disposeManualTurn(tab, shutdown);
  }

  presentAfterTurnRemoval(tab) {
    if (this.selectedTabId === tab.id) {
      this.selectedTabId = [...this.turnTabs.keys()].at(-1) || "home";
      const homeContents = this.view?.webContents;
      if (this.selectedTabId === "home"
        && !this.activeTraceId
        && homeContents
        && typeof homeContents.getURL === "function"
        && homeContents.getURL() === IDLE_BROWSER_URL) {
        // Never reveal the unhydrated about:blank host after a turn tab disappears. It renders as a
        // gray, apparently frozen ChatGPT tab even though there is no browser turn left to show.
        this.hide?.();
      }
    }
  }

  async createTurnTab(traceId, helperPid, conversationKey, connectorIdentity, taskProgressVersion, taskModel) {
    return turnLifecycleFor(this).createTurnTab(traceId, helperPid, conversationKey, connectorIdentity, taskProgressVersion, taskModel);
  }

  createManualTurnTab(traceId, helperPid, conversationKey, prompt, manualSubmitTimeoutMs) {
    if (this.turnTabs.size >= this.maxTabs
      && !BrowserHost.prototype.evictOldestReclaimableTurnTab.call(this)) {
      throw new Error(
        `ChatGPT Web already has ${this.maxTabs} browser tabs; close one before starting another turn to avoid excessive parallel traffic on the ChatGPT account`,
      );
    }
    const id = randomBytes(12).toString("base64url");
    const ordinal = Array.from({ length: this.maxTabs }, (_unused, index) => index + 1)
      .find(candidate => ![...this.turnTabs.values()].some(tab => tab.ordinal === candidate));
    if (!ordinal) throw new Error("ChatGPT Web browser tab allocation is inconsistent");
    const view = new WebContentsView({
      webPreferences: {
        partition: this.partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: true,
        backgroundThrottling: false,
        webSecurity: true,
      },
    });
    const tab = {
      id,
      surfaceId: null,
      traceId,
      conversationKey,
      connectorIdentity: null,
      connectorBound: false,
      helperPid,
      view,
      status: "running",
      ordinal,
      label: `ChatGPT ${ordinal}`,
      pageTitle: "ChatGPT",
      url: TEMPORARY_CHAT_URL,
      loading: true,
      message: "Paste the copied prompt, add any images yourself because Manual mode cannot transfer them, choose a model and effort, then press Sent",
      interactionMode: "manual",
      manualState: "awaiting-user",
      manualSubmitTimeoutMs,
      manualDeadlineAt: Date.now() + manualSubmitTimeoutMs,
      manualDeadlineTimer: null,
      manualWaiters: new Set(),
      manualTerminalWaiters: new Set(),
      manualTerminalResolutionSuppressed: false,
      manualCancellation: null,
      prompt,
      promptDigest: manualPromptDigest(prompt),
      manualConversationReused: false,
      sentAt: null,
      bootstrapReady: false,
      rendererReady: false,
      lastHeartbeatAt: Date.now(),
    };
    turnLifecycleFor(this).register(tab);
    this.window.contentView.addChildView(view);
    this.presentTurnView(tab, true);
    view.webContents.setZoomFactor(this.state.zoomFactor);
    this.bindShellZoomShortcuts(view.webContents);
    this.bindManualTurnContents(tab);
    void this.initializeManualTurnTab(tab);
    return tab;
  }

  async initializeManualTurnTab(tab) {
    const contents = tab.view.webContents;
    try {
      await loadCommittedBrowserSurface(contents, IDLE_BROWSER_URL);
    } catch (error) {
      if (this.turnTabs.get(tab.id) !== tab || contents.isDestroyed()) return;
      this.logger.error("browser.manual_tab_initialization_failed", {
        tabId: tab.id,
        traceId: tab.traceId,
        ...navigationErrorForLog(error),
      });
      this.signalManualTerminal(tab, "failed");
      this.removeTurnTab(tab, true);
      return;
    }
    if (this.turnTabs.get(tab.id) !== tab || contents.isDestroyed()) return;
    try {
      await contents.loadURL(TEMPORARY_CHAT_URL);
    } catch (error) {
      if (this.turnTabs.get(tab.id) !== tab || contents.isDestroyed()) return;
      if (isAbortedNavigationError(error)) {
        this.logger.info("browser.manual_tab_navigation_superseded", {
          tabId: tab.id,
          traceId: tab.traceId,
          ...navigationErrorForLog(error),
        });
        return;
      }
      this.logger.error("browser.manual_tab_navigation_failed", {
        tabId: tab.id,
        traceId: tab.traceId,
        ...navigationErrorForLog(error),
      });
      this.signalManualTerminal(tab, "failed");
      this.removeTurnTab(tab, true);
    }
  }

  evictOldestRetainedTurnTab() {
    return turnLifecycleFor(this).evictOldestRetainedTurnTab();
  }

  evictOldestReclaimableTurnTab() {
    return turnLifecycleFor(this).evictOldestReclaimableTurnTab();
  }

  zoomShell(action) {
    const contents = this.window.webContents;
    if (!contents || contents.isDestroyed()) throw new Error("Launcher shell is unavailable for zoom");
    const current = contents.getZoomLevel();
    if (!Number.isFinite(current)) throw new Error("Launcher shell zoom state is invalid");
    const next = action === "reset"
      ? 0
      : action === "in"
        ? Math.min(SHELL_ZOOM_LEVEL_LIMIT, current + SHELL_ZOOM_LEVEL_STEP)
        : Math.max(-SHELL_ZOOM_LEVEL_LIMIT, current - SHELL_ZOOM_LEVEL_STEP);
    contents.setZoomLevel(next);
  }

  bindShellZoomShortcuts(contents) {
    if (!contents || contents.isDestroyed() || this.shellZoomShortcutBindings.has(contents)) return;
    const handler = (event, input) => {
      const action = shellZoomActionForInput(input);
      if (!action) return;
      event.preventDefault();
      try {
        this.zoomShell(action);
      } catch (error) {
        this.logger.error("launcher.shell_zoom_shortcut_failed", {
          action,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    };
    this.shellZoomShortcutBindings.set(contents, handler);
    contents.on("before-input-event", handler);
    contents.once("destroyed", () => this.shellZoomShortcutBindings.delete(contents));
  }

  hasTrustedTurnDocument(tab) {
    // A trusted origin alone cannot establish ownership after cookies/account change.
    // Keep the old document inspectable, but never resume it under a later session.
    if (tab.authIdentityEpoch !== this.authIdentityEpoch
      || tab.authPrincipalFingerprint !== this.authPrincipalFingerprint) return false;
    const contents = tab.view?.webContents;
    if (!contents || contents.isDestroyed() || contents.isLoadingMainFrame()) return false;
    const url = contents.getURL();
    return httpsOrigin(url) === CHATGPT_ORIGIN && !allowedAuthUrl(url);
  }

  bindTurnContents(tab) {
    const contents = tab.view.webContents;
    this.permissionPolicy?.register(contents);
    this.externalLinkBroker?.register(contents);
    contents.setWindowOpenHandler(({ url }) => {
      if (allowedAuthUrl(url)) {
        this.logger.warn("browser.turn_authentication_blocked", { tabId: tab.id, traceId: tab.traceId });
        return { action: "deny" };
      }
      void this.externalLinkBroker?.open(contents, url, "turn").catch(() => {});
      return { action: "deny" };
    });
    const allowedTurnUrl = url => (httpsOrigin(url) === CHATGPT_ORIGIN && !allowedAuthUrl(url))
      || (tab.initializingSurface && url === IDLE_BROWSER_URL);
    const invalidateForeignNavigation = url => {
      if (allowedTurnUrl(url)) return false;
      tab.conversationKey = undefined;
      tab.connectorBound = false;
      tab.bootstrapReady = false;
      tab.rendererReady = false;
      tab.status = "error";
      tab.url = url;
      tab.message = "The ChatGPT page changed. Start a new turn to resend the full context.";
      contents.stop();
      this.syncPowerSaveBlocker();
      this.publishState?.(this.snapshot());
      return true;
    };
    const blockForeignNavigation = (event, url) => {
      if (allowedTurnUrl(url)) return;
      event.preventDefault();
      tab.message = allowedAuthUrl(url)
        ? "ChatGPT requires a fresh sign-in; finish this turn, then sign in from Setup"
        : "External pages cannot replace this ChatGPT task tab";
      this.logger.warn("browser.turn_navigation_blocked", { tabId: tab.id, traceId: tab.traceId });
      this.publishState?.(this.snapshot());
    };
    contents.on("will-navigate", blockForeignNavigation);
    contents.on("will-redirect", (event, url, _inPlace, mainFrame) => {
      if (event.isMainFrame ?? mainFrame) blockForeignNavigation(event, event.url ?? url);
    });
    contents.on("did-start-navigation", (_event, url, inPlace, mainFrame) => {
      // A provisional navigation can still be cancelled. Its destination is not the current
      // document, so preserve the conversation and renderer until a new document commits.
      if (!mainFrame || !allowedTurnUrl(url)) return;
      tab.url = url;
      tab.loading = true;
      this.publishState?.(this.snapshot());
    });
    contents.on("did-navigate", (_event, url) => {
      // Electron emits did-navigate for a committed main-frame document only. Even a brief
      // foreign document must permanently lose the old conversation before it can return.
      tab.url = url;
      tab.rendererReady = false;
      tab.deviceEmulationDirty = true;
      invalidateForeignNavigation(url);
    });
    contents.on("did-start-loading", () => {
      tab.loading = true;
      this.publishState?.(this.snapshot());
    });
    contents.on("did-stop-loading", () => {
      tab.loading = false;
      tab.url = contents.getURL();
      this.publishState?.(this.snapshot());
    });
    contents.on("did-finish-load", () => {
      tab.url = contents.getURL();
      tab.loading = false;
      if (invalidateForeignNavigation(tab.url)) return;
      tab.rendererReady = true;
      tab.bootstrapReady = httpsOrigin(tab.url) === CHATGPT_ORIGIN;
      this.syncViewVisibility();
      if (browserInteractionModeFor(this) !== "automatic") {
        this.publishState?.(this.snapshot());
        return;
      }
      if (tab.initializingSurface) {
        this.publishState?.(this.snapshot());
        return;
      }
      void this.markTurnTabSurface(tab).then(
        () => this.publishState?.(this.snapshot()),
        (error) => {
          tab.status = "error";
          tab.message = `Browser ownership failed: ${error instanceof Error ? error.message : String(error)}`;
          this.syncPowerSaveBlocker();
          this.publishState?.(this.snapshot());
        },
      );
    });
    contents.on("page-title-updated", (_event, title) => {
      if (browserInteractionModeFor(this) !== "automatic") return;
      if (typeof title === "string" && title.trim()) tab.pageTitle = title.trim();
      this.publishState?.(this.snapshot());
    });
    contents.on("did-navigate-in-page", (_event, url, mainFrame) => {
      if (mainFrame && invalidateForeignNavigation(url)) return;
      if (mainFrame) tab.url = url;
      this.publishState?.(this.snapshot());
    });
    contents.on("did-fail-load", (_event, errorCode, errorDescription, url, mainFrame) => {
      if (!mainFrame || errorCode === -3) return;
      tab.url = url;
      tab.message = errorDescription;
      this.logger.error("browser.tab_navigation_failed", {
        tabId: tab.id,
        traceId: tab.traceId,
        errorCode,
        errorDescription,
        url,
      });
      this.removeTurnTab(tab, true);
    });
    contents.on("render-process-gone", (_event, details) => {
      tab.message = `Browser renderer stopped: ${details.reason}`;
      this.logger.error("browser.tab_renderer_gone", {
        tabId: tab.id,
        traceId: tab.traceId,
        reason: details.reason,
        exitCode: details.exitCode,
      });
      this.removeTurnTab(tab, true);
    });
    contents.on("unresponsive", () => {
      this.logger.warn("browser.tab_unresponsive", { tabId: tab.id, traceId: tab.traceId });
    });
    contents.on("responsive", () => {
      this.logger.info("browser.tab_responsive", { tabId: tab.id, traceId: tab.traceId });
    });
  }

  async markTurnTabSurface(tab) {
    requireAutomaticBrowserInspection(this, "ChatGPT turn surface ownership marking");
    const contents = tab?.view?.webContents;
    if (!contents || contents.isDestroyed()) {
      throw new Error("ChatGPT turn browser closed before ownership was established");
    }
    void contents.insertCSS(CHATGPT_VIEWPORT_CSS).catch(() => {});
    const encoded = JSON.stringify(tab.surfaceId);
    await contents.executeJavaScript(`(() => {
      if (location.origin !== ${JSON.stringify(CHATGPT_ORIGIN)}
        && !(${JSON.stringify(tab.initializingSurface === true)} && location.href === ${JSON.stringify(IDLE_BROWSER_URL)})) {
        throw new Error("Cannot mark a foreign document as a ChatGPT turn surface");
      }
      Object.defineProperty(globalThis, "__CODEX_WEB_GPT_SURFACE_ID__", {
        value: ${encoded}, configurable: true, enumerable: false, writable: false,
      });
      document.documentElement.dataset.codexWebGptSurface = ${encoded};
    })()`, true);
  }

  bindManualTurnContents(tab) {
    const contents = tab.view.webContents;
    this.permissionPolicy?.register(contents);
    this.externalLinkBroker?.register(contents);
    const invalidateConversation = (url, inPlace) => {
      // History state updates and anchor scrolling keep the same document/context.
      if (inPlace && url.split("#", 1)[0] === tab.url?.split("#", 1)[0]) return;
      // Initial login/navigation still carries full context. A later document change
      // cannot prove that an incremental continuation belongs to the same conversation.
      if (!tab.conversationKey
        || (!tab.manualConversationReused && tab.manualState === "awaiting-user")) return;
      tab.conversationKey = undefined;
      if (tab.manualConversationReused && tab.status === "running") {
        tab.status = "error";
        tab.message = "ChatGPT page changed during a resumed Manual mode turn. Start a new Codex turn to resend the full context.";
        this.signalManualTerminal(tab, "failed");
      }
      this.logger.info("browser.manual_conversation_invalidated", {
        tabId: tab.id,
        traceId: tab.traceId,
      });
    };
    contents.setWindowOpenHandler(({ url }) => {
      void this.externalLinkBroker?.open(contents, url, "manual").catch(() => {});
      return { action: "deny" };
    });
    contents.on("did-start-navigation", (_event, url, inPlace, mainFrame) => {
      if (!mainFrame) return;
      invalidateConversation(url, inPlace);
      tab.url = url;
      tab.loading = true;
      this.publishState?.(this.snapshot());
    });
    contents.on("did-start-loading", () => {
      tab.loading = true;
      this.publishState?.(this.snapshot());
    });
    contents.on("did-stop-loading", () => {
      tab.loading = false;
      tab.url = contents.getURL();
      this.publishState?.(this.snapshot());
    });
    contents.on("did-finish-load", () => {
      tab.url = contents.getURL();
      tab.loading = false;
      tab.rendererReady = true;
      tab.bootstrapReady = tab.url.startsWith(CHATGPT_ORIGIN);
      this.syncViewVisibility();
      this.publishState?.(this.snapshot());
    });
    contents.on("did-navigate-in-page", (_event, url, mainFrame) => {
      if (mainFrame) {
        invalidateConversation(url, true);
        tab.url = url;
      }
      this.publishState?.(this.snapshot());
    });
    contents.on("did-fail-load", (_event, errorCode, errorDescription, url, mainFrame) => {
      if (!mainFrame || errorCode === -3) return;
      tab.url = url;
      tab.message = errorDescription;
      this.logger.error("browser.manual_tab_navigation_failed", {
        tabId: tab.id,
        traceId: tab.traceId,
        errorCode,
        origin: navigationOriginForLog(url),
      });
      this.signalManualTerminal(tab, "failed");
      this.removeTurnTab(tab, true);
    });
    contents.on("render-process-gone", (_event, details) => {
      tab.message = `Browser renderer stopped: ${details.reason}`;
      this.logger.error("browser.manual_tab_renderer_gone", {
        tabId: tab.id,
        traceId: tab.traceId,
        reason: details.reason,
        exitCode: details.exitCode,
      });
      this.signalManualTerminal(tab, "failed");
      this.removeTurnTab(tab, true);
    });
  }

  bindWebContents() {
    const contents = this.view.webContents;
    this.permissionPolicy?.register(contents, "auth");
    this.externalLinkBroker?.register(contents);
    guardBrowserNavigation(contents, url => this.externalLinkBroker?.open(contents, url, 'home').catch(() => {}));
    contents.setWindowOpenHandler(({ url, referrer, postBody }) => {
      if (allowedAuthUrl(url)) {
        return {
          action: "allow",
          createWindow: (options) => this.createAuthView(options, url, { referrer, postBody }),
        };
      }
      void this.externalLinkBroker?.open(contents, url, "home").catch(() => {});
      return { action: "deny" };
    });
    contents.on("did-start-navigation", (_event, url, inPlace, mainFrame) => {
      if (!mainFrame) return;
      if (inPlace) {
        this.setState({ url });
        return;
      }
      this.primaryRendererReady = false;
      this.primaryDeviceEmulationDirty = true;
      this.armHomeNavigationTimeout(contents, url);
      if (this.manualOperation === "ChatGPT login") {
        this.logger.info("browser.auth_navigation_started", {
          surface: "primary",
          origin: navigationOriginForLog(url),
        });
      }
      this.setState(this.activeTraceId || this.manualOperation
        ? { url, loading: true }
        : { status: "loading", message: "Opening ChatGPT", url, loading: true });
    });
    contents.on("did-finish-load", () => {
      this.primaryRendererReady = true;
      this.syncViewVisibility();
      this.clearHomeNavigationTimeout();
      if (this.manualOperation === "ChatGPT login") {
        this.logger.info("browser.auth_navigation_completed", {
          surface: "primary",
          origin: navigationOriginForLog(contents.getURL()),
        });
      }
      const url = contents.getURL();
      if (browserInteractionModeFor(this) === "manual") {
        this.setState({ status: "idle", message: "No active task", url, loading: false });
        return;
      }
      this.setState({ url, loading: false });
      void this.applyViewportCss();
      void this.markOwnedSurface()
        .then(() => this.probeAuthentication())
        .catch((error) => {
          this.logger.error("browser.surface_mark_failed", {
            message: error instanceof Error ? error.message : String(error),
          });
          this.setState({ status: "error", message: "Embedded browser ownership could not be established" });
        });
    });
    contents.on("did-start-loading", () => this.setState({ loading: true }));
    contents.on("did-stop-loading", () => {
      this.clearHomeNavigationTimeout();
      if (browserInteractionModeFor(this) === "manual"
        && this.state.status === "loading"
        && !this.activeTraceId
        && !this.manualOperation) {
        this.setState({
          status: "idle",
          message: "No active task",
          url: contents.getURL(),
          loading: false,
        });
        return;
      }
      this.setState({ loading: false });
    });
    contents.on("page-title-updated", (_event, title) => {
      if (browserInteractionModeFor(this) === "manual") return;
      this.setState({ title: typeof title === "string" && title.trim() ? title.trim() : "ChatGPT" });
    });
    contents.on("did-navigate-in-page", (_event, url, mainFrame) => {
      if (mainFrame) this.setState({ url });
    });
    contents.on("did-fail-load", (_event, errorCode, errorDescription, url, mainFrame) => {
      if (!mainFrame || errorCode === -3) return;
      this.clearHomeNavigationTimeout();
      this.logger.error(
        this.manualOperation === "ChatGPT login"
          ? "browser.auth_navigation_failed"
          : "browser.navigation_failed",
        {
          ...(this.manualOperation === "ChatGPT login" ? { surface: "primary" } : {}),
          errorCode,
          errorDescription,
          origin: navigationOriginForLog(url),
        },
      );
      this.setState({ status: "error", message: errorDescription, url, loading: false });
    });
    contents.on("render-process-gone", (_event, details) => {
      this.primaryRendererReady = false;
      this.primaryDeviceEmulationDirty = true;
      this.clearHomeNavigationTimeout();
      this.logger.error("browser.renderer_gone", { reason: details.reason, exitCode: details.exitCode });
      this.setState({ status: "error", message: `Browser renderer stopped: ${details.reason}`, loading: false });
    });
  }

  armHomeNavigationTimeout(contents, url) {
    this.clearHomeNavigationTimeout();
    this.homeNavigationTimeout = setTimeout(() => {
      this.homeNavigationTimeout = null;
      if (contents.isDestroyed() || !contents.isLoadingMainFrame()) return;
      contents.stop();
      const message = "ChatGPT did not finish loading within 60 seconds. Check your connection and retry.";
      this.logger.error("browser.navigation_timeout", { origin: navigationOriginForLog(url) });
      this.setState({ status: "error", message, url, loading: false });
    }, BROWSER_NAVIGATION_TIMEOUT_MS);
    this.homeNavigationTimeout.unref?.();
  }

  clearHomeNavigationTimeout() {
    if (!this.homeNavigationTimeout) return;
    clearTimeout(this.homeNavigationTimeout);
    this.homeNavigationTimeout = null;
  }

  async hardRefreshHome(timeoutMs = BROWSER_NAVIGATION_TIMEOUT_MS, signal) {
    signal?.throwIfAborted();
    const contents = this.view?.webContents;
    if (!contents || contents.isDestroyed()) {
      throw new Error("The managed ChatGPT page is not available for connector verification");
    }
    this.setState({
      status: "loading",
      message: "Refreshing the ChatGPT connector catalog",
      loading: true,
    });
    await new Promise((resolve, reject) => {
      let settled = false;
      let mainNavigationStarted = false;
      const cleanup = () => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
        contents.off("did-start-navigation", onStarted);
        contents.off("did-stop-loading", onStopped);
        contents.off("did-finish-load", onFinished);
        contents.off("did-fail-load", onFailed);
        contents.off("render-process-gone", onRendererGone);
        contents.off("destroyed", onDestroyed);
      };
      const finish = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else resolve();
      };
      const onStarted = (details) => {
        if (details.isMainFrame && !details.isSameDocument) mainNavigationStarted = true;
      };
      const onStopped = () => { if (mainNavigationStarted) finish(); };
      const onFinished = () => { if (mainNavigationStarted) finish(); };
      const onFailed = (_event, errorCode, errorDescription, url, mainFrame) => {
        if (!mainFrame || errorCode === -3) return;
        finish(new Error(`ChatGPT hard refresh failed: ${errorDescription} (${url})`));
      };
      const onRendererGone = (_event, details) => {
        finish(new Error(`ChatGPT renderer stopped during hard refresh: ${details.reason}`));
      };
      const onDestroyed = () => finish(new Error("ChatGPT closed during hard refresh"));
      const onAbort = () => finish(inspectionAbortError(signal));
      const timeout = setTimeout(() => {
        finish(new Error("ChatGPT hard refresh did not finish within 60 seconds"));
        if (!contents.isDestroyed()) contents.stop();
      }, timeoutMs);
      timeout.unref?.();
      contents.on("did-start-navigation", onStarted);
      contents.on("did-stop-loading", onStopped);
      contents.on("did-finish-load", onFinished);
      contents.on("did-fail-load", onFailed);
      contents.on("render-process-gone", onRendererGone);
      contents.on("destroyed", onDestroyed);
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        contents.reloadIgnoringCache();
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async refreshChatGptHomeDocument(signal) {
    signal?.throwIfAborted();
    // A navigation from the idle host already creates a fresh ChatGPT document. Reload only an
    // existing Temporary Chat document so the helper observes one authoritative SPA bootstrap.
    if (isTemporaryChatUrl(this.view.webContents.getURL())) {
      await this.hardRefreshHome(BROWSER_NAVIGATION_TIMEOUT_MS, signal);
    } else {
      await awaitInspection(this.view.webContents.loadURL(TEMPORARY_CHAT_URL), signal);
    }
    await this.waitForAuthenticated(60_000, signal);
  }

  workspaceRequestOwner(details) {
    if (!Number.isInteger(details?.webContentsId)) return null;
    for (const [contents, metadata] of this.workspaceMetadata) {
      if (!contents.isDestroyed() && contents.id === details.webContentsId) return { contents, metadata };
    }
    return null;
  }

  bindWorkspaceSessionRequestGuard() {
    if (!this.workspaceSessionMutation) return;
    const browserSession = this.view.webContents.session;
    browserSession.webRequest.onBeforeRequest(CHATGPT_BACKEND_REQUEST_FILTER, (details, callback) => {
      const owner = this.workspaceRequestOwner(details);
      if (!owner || !isWorkspaceSessionMutationRequest(details)) { callback({}); return; }
      if (this.workspaceSessionMutation.owns()) { callback({}); return; }
      try {
        const lease = this.workspaceSessionMutation.begin({
          sourceId: owner.metadata.workspaceId,
          reason: "workspace-request",
          url: details.url,
        });
        this.workspaceMutationRequests.set(details.id, { lease, contents: owner.contents });
        callback({});
      } catch (error) {
        this.logger.warn("browser.workspace_session_mutation_blocked", {
          accountId: this.accountId,
          message: error instanceof Error ? error.message : String(error),
        });
        this.workspaceChanged?.();
        callback({ cancel: true });
      }
    });
    browserSession.webRequest.onErrorOccurred(CHATGPT_BACKEND_REQUEST_FILTER, details => {
      const pending = this.workspaceMutationRequests.get(details.id);
      if (!pending) return;
      this.workspaceMutationRequests.delete(details.id);
      pending.lease.fail(new Error(`Session-changing request failed: ${details.error || "network error"}`));
    });
  }

  handleWorkspaceSessionMutationCompleted(details) {
    const pending = this.workspaceMutationRequests.get(details?.id);
    if (!pending) return false;
    this.workspaceMutationRequests.delete(details.id);
    void pending.lease.finish({
      contents: pending.contents,
      requestId: details.id,
      statusCode: details.statusCode,
      url: details.url,
    }).catch(error => {
      this.logger.warn("browser.workspace_session_verification_failed", {
        accountId: this.accountId,
        message: error instanceof Error ? error.message : String(error),
      });
      this.workspaceChanged?.();
    });
    return true;
  }

  bindChatGptBackendRecovery() {
    this.view.webContents.session.webRequest.onCompleted(
      CHATGPT_BACKEND_REQUEST_FILTER,
      details => {
        this.handleWorkspaceSessionMutationCompleted(details);
        return browserInteractionModeFor(this) === "automatic"
          ? this.handleChatGptBackendResponse(details)
          : undefined;
      },
    );
  }

  handleChatGptBackendResponse(details) {
    const contents = this.view?.webContents;
    if (!contents || contents.isDestroyed() || details?.webContentsId !== contents.id) return false;
    if (!isChatGptBackendUrl(details.url)) return false;

    if (details.statusCode >= 200 && details.statusCode < 400) {
      this.cloudflareChallengeRecoveryArmed = true;
      return false;
    }
    if (!isChatGptCloudflareChallengeResponse(details)) return false;
    if (this.cloudflareChallengeRecovery) {
      this.cloudflareChallengeRecoveryArmed = false;
      return true;
    }
    if (this.activeTraceId || this.manualOperation) {
      this.logger.warn("browser.cloudflare_challenge_not_reloaded", {
        reason: this.activeTraceId ? "turn-active" : "manual-operation-active",
        url: details.url,
      });
      return true;
    }
    if (!this.cloudflareChallengeRecoveryArmed) {
      this.logger.warn("browser.cloudflare_challenge_persisted", { url: details.url });
      return true;
    }
    this.cloudflareChallengeRecoveryArmed = false;
    this.logger.warn("browser.cloudflare_challenge_detected", { url: details.url });
    const recovery = this.reloadHomeAfterCloudflareChallenge();
    const tracked = recovery
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error("browser.cloudflare_challenge_recovery_failed", { message });
        this.setState({ status: "error", message, loading: false });
      })
      .finally(() => {
        if (this.cloudflareChallengeRecovery === tracked) this.cloudflareChallengeRecovery = null;
      });
    this.cloudflareChallengeRecovery = tracked;
    return true;
  }

  async reloadHomeAfterCloudflareChallenge() {
    const contents = this.view.webContents;
    this.setState({
      status: "loading",
      message: "Refreshing ChatGPT security check",
      loading: true,
    });
    await sleep(this.cloudflareChallengeRecoveryDelayMs);
    if (contents.isDestroyed()) throw new Error("ChatGPT browser closed during security-check recovery");
    const url = contents.getURL();
    if (!url.startsWith(CHATGPT_ORIGIN)) {
      throw new Error("ChatGPT security-check recovery lost its owned browser page");
    }

    // Only responses from this new document may prove that the challenge cleared.
    this.cloudflareChallengeRecoveryArmed = false;
    await contents.loadURL(url);
    await sleep(this.cloudflareChallengeRecoverySettleMs);
    if (!this.cloudflareChallengeRecoveryArmed) {
      throw new Error("ChatGPT security check is still blocking backend requests. Reload ChatGPT and retry.");
    }
    await this.probeAuthentication();
    this.logger.info("browser.cloudflare_challenge_recovered", { url });
  }

  turnTabSnapshots() {
    return [...this.turnTabs.values()].map(tab => this.tabSnapshot(tab));
  }

  snapshot() {
    const contents = this.activeView()?.webContents;
    const selected = this.selectedTurnTab();
    const manualInteraction = browserInteractionModeFor(this) === "manual";
    const homeTab = {
      id: "home",
      traceId: null,
      title: manualInteraction ? "ChatGPT" : this.state.title || "ChatGPT",
      status: this.state.status,
      loading: this.state.loading === true,
      active: this.selectedTabId === "home",
      closable: false,
    };
    const state = selected
      ? {
          ...this.state,
          status: selected.status,
          message: selected.message,
          url: selected.url,
          title: selected.interactionMode === "manual" ? selected.label : selected.pageTitle,
          loading: selected.loading,
        }
      : manualInteraction
        ? { ...this.state, title: "ChatGPT" }
        : this.state;
    return {
      ...readBrowserNavigationState(contents, {
        ...state,
        visible: this.visible,
        surfaceActive: this.surfaceActive,
      }, {
        readPageTitle: !manualInteraction,
      }),
      activeTabId: this.selectedTabId,
      tabs: this.turnTabs.size > 0
        ? [
            ...(this.selectedTabId === "home" ? [homeTab] : []),
            ...this.turnTabSnapshots(),
          ]
        : [homeTab],
      maxTabs: this.maxTabs,
      navigationLocked: Boolean(this.activeTraceId || this.manualOperation || this.loginOperation),
      loginInProgress: Boolean(this.loginOperation),
      loginKind: this.existingChromeLoginOperation ? "existing-chrome" : this.passkeyLoginOperation ? "passkey" : this.embeddedLoginController ? "embedded" : null,
      passkeyLogin: publicPasskeyProgress(this.passkeyProgress),
      existingChromeLogin: publicExistingChromeProgress(this.existingChromeProgress),
    };
  }

  setState(patch) {
    if (patch.authenticationStatus) {
      patch = { ...patch, authenticationIssue: patch.authenticationStatus === "unavailable"
        ? authenticationIssue(patch.message) : null };
    }
    this.state = {
      ...this.state,
      ...patch,
      ...(patch.authenticationStatus === "signed-out" ? { lastVerifiedAt: null } : {}),
      ...(patch.authenticated === false
        && patch.authenticationStatus !== "unavailable"
        && patch.authenticationStatus !== "unknown" ? { accountLabel: null } : {}),
      visible: this.visible,
      surfaceActive: this.surfaceActive,
    };
    this.publishState?.(this.snapshot());
  }

  retireAuthenticatedIdentity() {
    if (this.authPrincipalFingerprint === null && this.authSessionFingerprint === null) return;
    this.authPrincipalFingerprint = null;
    this.authSessionFingerprint = null;
    this.authIdentityEpoch += 1;
    this.onAuthIdentityChanged(this.accountId, this.authIdentityEpoch);
  }

  heartbeatTurn(traceId, helperPid, refreshViewport = false, expectedSurfaceId) {
    return turnLifecycleFor(this).heartbeatTurn(traceId, helperPid, refreshViewport, expectedSurfaceId);
  }

  refreshTurnLeases(reason, now = Date.now()) {
    return turnLifecycleFor(this).refreshTurnLeases(reason, now);
  }

  syncPowerSaveBlocker() {
    // Under plain Node (the launcher test harness) require("electron") exposes no APIs; the
    // blocker is an Electron-only concern and its absence must not break lease bookkeeping.
    if (!powerSaveBlocker || typeof powerSaveBlocker.start !== "function") return;
    const wanted = shouldBlockSleepForTurns([...this.turnTabs.values()]);
    const active = this.powerSaveBlockerId !== null && powerSaveBlocker.isStarted(this.powerSaveBlockerId);
    if (wanted && !active) {
      this.powerSaveBlockerId = powerSaveBlocker.start("prevent-app-suspension");
      this.logger.info("browser.sleep_blocked_for_turns", { blockerId: this.powerSaveBlockerId });
    } else if (!wanted && active) {
      powerSaveBlocker.stop(this.powerSaveBlockerId);
      this.logger.info("browser.sleep_block_released", { blockerId: this.powerSaveBlockerId });
      this.powerSaveBlockerId = null;
    }
  }

  reapExpiredTurnTabs(now = Date.now()) {
    return turnLifecycleFor(this).reapExpiredTurnTabs(now);
  }

  setBounds(bounds, rendererZoomFactor = 1) {
    const [width, height] = this.window.getContentSize();
    this.bounds = constrainBrowserBounds(
      normalizeBounds(scaleBrowserBounds(bounds, rendererZoomFactor)),
      { width, height },
    );
    this.boundsReady = true;
    this.authView?.setBounds(this.bounds);
    this.syncViewVisibility();
    if (browserInteractionModeFor(this) === "automatic") {
      void this.view.webContents.executeJavaScript("window.dispatchEvent(new Event('resize'))", true).catch(() => {});
      if (this.authView && !this.authView.webContents.isDestroyed()) {
        void this.authView.webContents.executeJavaScript("window.dispatchEvent(new Event('resize'))", true).catch(() => {});
      }
    }
  }

  activeView() {
    return this.authView || this.selectedTurnTab()?.view || this.view;
  }

  hiddenTurnBounds() {
    const [contentWidth, contentHeight] = this.window.getContentSize();
    const width = Math.max(HIDDEN_TURN_VIEWPORT.width, Math.round(contentWidth || 0));
    const height = Math.max(HIDDEN_TURN_VIEWPORT.height, Math.round(contentHeight || 0));
    return {
      // Electron collapses a hidden WebContentsView's renderer viewport to 0x0. Keep running
      // turn views visible to Chromium and move them wholly outside the launcher content area so
      // Playwright retains a real viewport without exposing the task to the user.
      x: Math.max(width, Math.round(contentWidth || 0)) + 1,
      y: Math.max(height, Math.round(contentHeight || 0)) + 1,
      width,
      height,
    };
  }

  enableHiddenTurnViewport(contents, { width, height }) {
    contents.enableDeviceEmulation({
      screenPosition: "desktop",
      screenSize: { width, height },
      viewPosition: { x: 0, y: 0 },
      deviceScaleFactor: 0,
      viewSize: { width, height },
      scale: 1,
    });
  }

  presentTurnView(tab, visible) {
    if (tab.interactionMode === "manual") {
      tab.view.setBounds(visible ? this.bounds : this.hiddenTurnBounds());
      tab.view.setVisible(visible || tab.status === "running");
      return;
    }
    if (visible) {
      // Establish native on-screen bounds before removing the background viewport contract.
      tab.view.setBounds(this.bounds);
      if (tab.rendererReady && tab.deviceEmulationViewport) {
        tab.view.webContents.disableDeviceEmulation();
        tab.deviceEmulationViewport = null;
      }
      if (tab.rendererReady) tab.deviceEmulationDirty = false;
    } else {
      // A WebContentsView born outside a hidden BrowserWindow has a 0x0 renderer even when its
      // native bounds and View visibility are non-zero. Device emulation gives background turns
      // an explicit renderer viewport before moving the view outside the launcher surface.
      const bounds = this.hiddenTurnBounds();
      if (tab.rendererReady
        && (tab.deviceEmulationDirty
          || tab.deviceEmulationViewport?.width !== bounds.width
          || tab.deviceEmulationViewport?.height !== bounds.height)) {
        this.enableHiddenTurnViewport(tab.view.webContents, bounds);
        tab.deviceEmulationViewport = { width: bounds.width, height: bounds.height };
        tab.deviceEmulationDirty = false;
      }
      tab.view.setBounds(bounds);
    }
    tab.view.setVisible(visible || tab.status === "running");
  }

  presentPrimaryView(visible) {
    // The descriptor advertises this exact WebContents for the lifetime of the launcher. Hiding
    // the native View can make Windows drop it from the remote-debugging target set, leaving a
    // live descriptor whose ownership id cannot be leased. Keep the View attached and drawable
    // offscreen; only its placement, never its ownership lifetime, follows the launcher UI.
    const bounds = visible ? this.bounds : this.hiddenTurnBounds();
    const emulate = !visible && browserInteractionModeFor(this) === "automatic";
    if (this.primaryRendererReady) {
      if (emulate) {
        if (this.primaryDeviceEmulationDirty
          || this.primaryDeviceEmulationViewport?.width !== bounds.width
          || this.primaryDeviceEmulationViewport?.height !== bounds.height) {
          this.enableHiddenTurnViewport(this.view.webContents, bounds);
          this.primaryDeviceEmulationViewport = { width: bounds.width, height: bounds.height };
          this.primaryDeviceEmulationDirty = false;
        }
      } else if (this.primaryDeviceEmulationViewport) {
        this.view.setBounds(bounds);
        this.view.webContents.disableDeviceEmulation();
        this.primaryDeviceEmulationViewport = null;
        this.primaryDeviceEmulationDirty = false;
      }
    }
    this.view.setBounds(bounds);
    this.view.setVisible(true);
  }

  activateHomeSurface() {
    this.selectedTabId = "home";
    this.syncViewVisibility();
    if (this.visible && this.surfaceActive) this.activeView().webContents.focus();
    this.publishState?.(this.snapshot());
    this.writeDescriptor();
  }

  syncViewVisibility() {
    const windowVisible = this.window.isVisible() && !this.window.isMinimized();
    const visible = windowVisible && (this.isAccountVisible?.() ?? true)
      && browserViewVisible(this.visible, this.surfaceActive, this.boundsReady);
    const selected = this.selectedTurnTab();
    this.presentPrimaryView(visible && !this.authView && !selected);
    for (const tab of this.turnTabs.values()) {
      const tabVisible = visible && !this.authView && selected?.id === tab.id;
      this.presentTurnView(tab, tabVisible);
    }
    this.authView?.setVisible(visible);
    this.permissionPolicy?.refreshVisibility();
  }

  selectTab(tabId) {
    if (tabId !== "home" && !this.turnTabs.has(tabId)) throw new Error("Browser tab does not exist");
    if (this.authView) this.closeAuthView(this.authView, true);
    this.selectedTabId = tabId;
    this.syncViewVisibility();
    if (this.visible && this.surfaceActive) this.activeView().webContents.focus();
    this.publishState?.(this.snapshot());
    this.writeDescriptor();
    return this.snapshot();
  }

  removeTurnTab(tab, abortRunning) {
    return turnLifecycleFor(this).removeTurnTab(tab, abortRunning);
  }

  artifactOwner(traceId, helperPid, surfaceId) {
    return artifactTransfersFor(this).artifactOwner(traceId, helperPid, surfaceId);
  }

  registerArtifactDownload(traceId, helperPid, surfaceId, assistantTurnId, expectedFilename, maxBytes, deadlineMs) {
    return artifactTransfersFor(this).registerArtifactDownload(traceId, helperPid, surfaceId, assistantTurnId, expectedFilename, maxBytes, deadlineMs);
  }

  artifactLease(traceId, helperPid, surfaceId, leaseId) {
    return artifactTransfersFor(this).artifactLease(traceId, helperPid, surfaceId, leaseId);
  }

  async waitArtifactDownload(traceId, helperPid, surfaceId, leaseId) {
    return artifactTransfersFor(this).waitArtifactDownload(traceId, helperPid, surfaceId, leaseId);
  }

  cleanupArtifactPartial(lease) {
    return artifactTransfersFor(this).cleanupArtifactPartial(lease);
  }

  cancelArtifactDownload(traceId, helperPid, surfaceId, leaseId, reason) {
    return artifactTransfersFor(this).cancelArtifactDownload(traceId, helperPid, surfaceId, leaseId, reason);
  }

  releaseArtifactDownloads(traceId, helperPid, reason) {
    return artifactTransfersFor(this).releaseArtifactDownloads(traceId, helperPid, reason);
  }

  rememberUserCancelledTurn(traceId, helperPid) {
    return turnLifecycleFor(this).rememberUserCancelledTurn(traceId, helperPid);
  }

  async closeTab(tabId, expectedTraceId) {
    return turnLifecycleFor(this).closeTab(tabId, expectedTraceId);
  }

  createAuthView(options = {}, requestedUrl = "", { referrer, postBody } = {}) {
    this.closeAuthView(this.authView, true);
    const authView = new WebContentsView(authViewOptions(options, this.partition));
    this.authView = authView;
    this.authNavigationError = null;
    this.window.contentView.addChildView(authView);
    authView.setBounds(this.bounds);
    authView.setVisible(false);
    authView.webContents.setZoomFactor(this.state.zoomFactor);
    this.bindShellZoomShortcuts(authView.webContents);
    const contents = authView.webContents;
    this.permissionPolicy?.register(contents, "auth");
    this.externalLinkBroker?.register(contents);
    guardBrowserNavigation(contents, url => this.externalLinkBroker?.open(contents, url, 'home').catch(() => {}));
    const clearNavigationTimeout = () => {
      if (!authView.navigationTimeout) return;
      clearTimeout(authView.navigationTimeout);
      authView.navigationTimeout = null;
    };
    const armNavigationTimeout = (url) => {
      clearNavigationTimeout();
      authView.navigationTimeout = setTimeout(() => {
        authView.navigationTimeout = null;
        if (this.authView !== authView || contents.isDestroyed()) return;
        contents.stop();
        const message = "The ChatGPT sign-in page did not finish loading within 60 seconds. Check your connection and try again.";
        this.authNavigationError = new Error(message);
        this.logger.error("browser.auth_navigation_timeout", {
          surface: "popup",
          origin: navigationOriginForLog(url),
        });
        this.closeAuthView(authView, true, false);
        this.setState({ status: "error", message, url, loading: false });
      }, BROWSER_NAVIGATION_TIMEOUT_MS);
      authView.navigationTimeout.unref?.();
    };
    armNavigationTimeout(requestedUrl);
    this.setState({
      status: "loading",
      message: "Opening ChatGPT sign-in",
      url: requestedUrl || contents.getURL(),
      loading: true,
    });
    contents.on("did-start-navigation", (_event, url, _inPlace, mainFrame) => {
      if (!mainFrame) return;
      armNavigationTimeout(url);
      this.logger.info("browser.auth_navigation_started", {
        surface: "popup",
        origin: navigationOriginForLog(url),
      });
    });
    contents.on("did-start-loading", () => this.setState({ loading: true }));
    contents.on("did-stop-loading", () => {
      clearNavigationTimeout();
      this.setState({ loading: false });
    });
    contents.on("did-finish-load", () => {
      clearNavigationTimeout();
      this.logger.info("browser.auth_navigation_completed", {
        surface: "popup",
        origin: navigationOriginForLog(contents.getURL()),
      });
      this.setState({ url: contents.getURL(), loading: false });
      if (browserInteractionModeFor(this) === "automatic") void this.probeAuthentication();
    });
    contents.on("page-title-updated", (_event, title) => {
      if (browserInteractionModeFor(this) === "manual") return;
      this.setState({ title: typeof title === "string" && title.trim() ? title.trim() : "ChatGPT" });
    });
    contents.on("close", () => this.closeAuthView(authView, true));
    contents.on("destroyed", () => this.closeAuthView(authView, false));
    contents.on("did-fail-load", (_event, errorCode, errorDescription, url, mainFrame) => {
      if (!mainFrame || errorCode === -3) return;
      clearNavigationTimeout();
      const message = `ChatGPT sign-in page failed to load: ${errorDescription}`;
      this.authNavigationError = new Error(message);
      this.logger.error("browser.auth_navigation_failed", {
        surface: "popup",
        errorCode,
        errorDescription,
        origin: navigationOriginForLog(url),
      });
      this.closeAuthView(authView, true, false);
      this.setState({ status: "error", message, url, loading: false });
    });
    contents.on("render-process-gone", (_event, details) => {
      clearNavigationTimeout();
      const message = `ChatGPT sign-in renderer stopped: ${details.reason}`;
      this.authNavigationError = new Error(message);
      this.logger.error("browser.auth_renderer_gone", { reason: details.reason, exitCode: details.exitCode });
      this.closeAuthView(authView, false);
      this.setState({ status: "error", message, loading: false });
    });
    contents.setWindowOpenHandler(({ url }) => {
      if (allowedAuthUrl(url)) {
        armNavigationTimeout(url);
        void contents.loadURL(url).catch((error) => {
          if (error && typeof error === "object" && error.code === "ERR_ABORTED") return;
          if (this.authView !== authView || contents.isDestroyed()) return;
          clearNavigationTimeout();
          const message = `ChatGPT sign-in page failed to open: ${error instanceof Error ? error.message : String(error)}`;
          this.authNavigationError = new Error(message);
          this.logger.error("browser.auth_window_open_failed", {
            surface: "popup",
            origin: navigationOriginForLog(url),
            ...navigationErrorForLog(error),
          });
          this.closeAuthView(authView, true, false);
          this.setState({ status: "error", message, url, loading: false });
        });
      } else {
        void this.externalLinkBroker?.open(contents, url, "auth").catch(() => {});
      }
      return { action: "deny" };
    });
    if (!options.webContents && requestedUrl) {
      // Custom createWindow callbacks must initiate navigation themselves when Electron did
      // not supply a guest. Supplied guests are already navigating and must not be loaded twice.
      const loadOptions = {
        ...(referrer ? { httpReferrer: referrer } : {}),
        ...(postBody ? {
          postData: postBody.data,
          extraHeaders: `content-type: ${postBody.contentType}${postBody.boundary ? `; boundary=${postBody.boundary}` : ""}`,
        } : {}),
      };
      void contents.loadURL(requestedUrl, loadOptions).catch(error => {
        if (error?.code === "ERR_ABORTED" || this.authView !== authView || contents.isDestroyed()) return;
        const message = "The sign-in window could not load. Retry sign-in or choose Use passkey.";
        this.authNavigationError = new Error(message);
        this.logger.error("browser.auth_window_open_failed", {
          surface: "popup",
          origin: navigationOriginForLog(requestedUrl),
          ...navigationErrorForLog(error),
        });
        this.closeAuthView(authView, true, false);
        this.setState({ status: "error", message, loading: false });
      });
    }
    this.syncViewVisibility();
    this.logger.info("browser.auth_surface_opened");
    return contents;
  }

  closeAuthView(authView, closeContents, refreshMain = true) {
    if (!authView || this.authView !== authView) return;
    if (authView.navigationTimeout) {
      clearTimeout(authView.navigationTimeout);
      authView.navigationTimeout = null;
    }
    this.authView = null;
    try { this.window.contentView.removeChildView(authView); } catch {}
    if (closeContents && !authView.webContents.isDestroyed()) authView.webContents.close();
    this.syncViewVisibility();
    this.logger.info("browser.auth_surface_closed");
    if (refreshMain && this.manualOperation === "ChatGPT login" && !this.view.webContents.isDestroyed()) {
      void this.view.webContents.loadURL(TEMPORARY_CHAT_URL).catch((error) => {
        this.logger.error("browser.auth_refresh_failed", {
          origin: navigationOriginForLog(TEMPORARY_CHAT_URL),
          ...navigationErrorForLog(error),
        });
      });
    }
  }

  async applyViewportCss() {
    requireAutomaticBrowserInspection(this, "ChatGPT viewport CSS injection");
    const contents = this.view?.webContents;
    if (!contents || contents.isDestroyed()) return;
    if (this.viewportCssKey) {
      await contents.removeInsertedCSS(this.viewportCssKey).catch(() => {});
      this.viewportCssKey = null;
    }
    this.viewportCssKey = await contents.insertCSS(CHATGPT_VIEWPORT_CSS).catch(() => null);
  }

  async markOwnedSurface() {
    requireAutomaticBrowserInspection(this, "ChatGPT DOM surface ownership marking");
    const surfaceId = JSON.stringify(this.surfaceId);
    await this.view.webContents.executeJavaScript(`(() => {
      Object.defineProperty(globalThis, "__CODEX_WEB_GPT_SURFACE_ID__", {
        value: ${surfaceId},
        configurable: true,
        enumerable: false,
        writable: false,
      });
      document.documentElement.dataset.codexWebGptSurface = ${surfaceId};
    })()`, true);
  }

  show() {
    this.visible = true;
    this.syncViewVisibility();
    this.setState({ visible: true });
    if (this.surfaceActive && this.boundsReady) this.activeView().webContents.focus();
  }

  async reveal(inspectSession = true) {
    if (inspectSession) requireAutomaticBrowserInspection(this, "ChatGPT session inspection");
    this.show();
    if (!this.selectedTurnTab() && this.view.webContents.getURL() === IDLE_BROWSER_URL) {
      await this.view.webContents.loadURL(TEMPORARY_CHAT_URL);
      if (inspectSession) await this.probeAuthentication();
    }
    return this.snapshot();
  }

  hide() {
    this.visible = false;
    this.syncViewVisibility();
    this.setState({ visible: false });
  }

  setSurfaceActive(active) {
    this.surfaceActive = active === true;
    this.syncViewVisibility();
    this.setState({ surfaceActive: this.surfaceActive });
    return this.snapshot();
  }

  async waitForSurfaceReady(timeoutMs = 15_000, pollMs = 50) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.surfaceActive && this.boundsReady) return;
      await sleep(pollMs);
    }
    throw new Error(
      "Embedded browser surface did not receive measured bounds before the operation",
    );
  }

  navigate(action) {
    if (this.activeTraceId) {
      throw new Error("Browser navigation is locked while ChatGPT is running a Codex turn");
    }
    if (this.manualOperation || this.loginOperation) {
      throw new Error(`Browser navigation is locked during ${this.manualOperation || "ChatGPT login"}`);
    }
    const contents = this.activeView().webContents;
    navigateBrowser(contents, action);
    return this.snapshot();
  }

  zoom(action) {
    if (action !== "in" && action !== "out" && action !== "reset") {
      throw new Error(`Unknown browser zoom action: ${action}`);
    }
    const current = this.state.zoomFactor;
    const currentIndex = ZOOM_FACTORS.indexOf(current);
    if (currentIndex < 0) throw new Error(`Browser zoom state is invalid: ${current}`);
    const next = action === "reset"
      ? 1
      : action === "in"
        ? ZOOM_FACTORS[Math.min(currentIndex + 1, ZOOM_FACTORS.length - 1)]
        : ZOOM_FACTORS[Math.max(currentIndex - 1, 0)];
    const contents = [this.view, ...[...this.turnTabs.values()].map((tab) => tab.view)]
      .map((view) => view?.webContents)
      .filter((candidate) => candidate && !candidate.isDestroyed());
    if (contents.length === 0) throw new Error("ChatGPT browser is unavailable for zoom");
    for (const candidate of contents) candidate.setZoomFactor(next);
    this.setState({ zoomFactor: next });
    return this.snapshot();
  }

  rememberManualTerminal(traceId, helperPid, status) {
    return manualTurnsFor(this).rememberManualTerminal(traceId, helperPid, status);
  }

  rememberManualCompletion(traceId, helperPid) {
    return manualTurnsFor(this).rememberManualCompletion(traceId, helperPid);
  }

  signalManualTerminal(tab, status) {
    return manualTurnsFor(this).signalManualTerminal(tab, status);
  }

  armManualTurnDeadline(tab) {
    return manualTurnsFor(this).armManualTurnDeadline(tab);
  }

  writeManualPrompt(prompt) {
    return manualTurnsFor(this).writeManualPrompt(prompt);
  }

  beginManualTurn(traceId, helperPid, prompt, conversationKey, resumePrompt, compaction = false) {
    return manualTurnsFor(this).beginManualTurn(traceId, helperPid, prompt, conversationKey, resumePrompt, compaction);
  }

  async waitManualSent(traceId, helperPid, observerTimeoutMs = 35_000) {
    return manualTurnsFor(this).waitManualSent(traceId, helperPid, observerTimeoutMs);
  }

  async waitManualTerminal(traceId, helperPid, observerTimeoutMs = 35_000) {
    return manualTurnsFor(this).waitManualTerminal(traceId, helperPid, observerTimeoutMs);
  }

  copyManualPrompt(tabId) {
    return manualTurnsFor(this).copyManualPrompt(tabId);
  }

  confirmManualSent(tabId) {
    return manualTurnsFor(this).confirmManualSent(tabId);
  }

  markManualTurnStarted(traceId, helperPid) {
    return manualTurnsFor(this).markManualTurnStarted(traceId, helperPid);
  }

  endManualTurn(traceId, helperPid, status, retain = false) {
    return manualTurnsFor(this).endManualTurn(traceId, helperPid, status, retain);
  }

  cancelManualTurn(traceId, helperPid) {
    return manualTurnsFor(this).cancelManualTurn(traceId, helperPid);
  }

  startManualCancellation(tab, source) {
    return manualTurnsFor(this).startManualCancellation(tab, source);
  }

  async cancelManualTab(tab, source) {
    return manualTurnsFor(this).cancelManualTab(tab, source);
  }

  exactRetainedTurnTab(conversationKey, connectorIdentity) {
    return turnLifecycleFor(this).exactRetainedTurnTab(conversationKey, connectorIdentity);
  }

  precheckRetainedTurn(traceId, conversationKey, connectorIdentity) {
    return turnLifecycleFor(this).precheckRetainedTurn(traceId, conversationKey, connectorIdentity);
  }

  assertLiveConversationOwner(traceId, conversationKey) {
    return turnLifecycleFor(this).assertLiveConversationOwner(traceId, conversationKey);
  }

  async beginTurn(
    traceId,
    reveal,
    helperPid,
    conversationKey,
    connectorIdentity,
    requireRetainedConversation = false,
    taskProgressVersion,
    taskModel = null,
  ) {
    return turnLifecycleFor(this).beginTurn(traceId, reveal, helperPid, conversationKey, connectorIdentity, requireRetainedConversation, taskProgressVersion, taskModel);
  }

  async endTurn(
    traceId,
    helperPid,
    status,
    hideAfterTurn,
    message,
    retain = false,
    connectorBound = false,
  ) {
    return turnLifecycleFor(this).endTurn(traceId, helperPid, status, hideAfterTurn, message, retain, connectorBound);
  }

  async returnToIdle() {
    this.hide();
    this.view.webContents.setBackgroundThrottling(true);
    if (this.view.webContents.getURL() !== IDLE_BROWSER_URL) {
      await this.view.webContents.loadURL(IDLE_BROWSER_URL);
    }
    this.setState({
      status: this.state.authenticated ? "ready" : "signed-out",
      message: this.state.authenticated ? "No active task" : "Sign in to ChatGPT",
    });
  }

  openLogin() {
    requireAutomaticBrowserInspection(this, "Automated ChatGPT sign-in verification");
    if (this.state.authenticated) {
      this.activateHomeSurface();
      this.show();
      return Promise.resolve(this.snapshot());
    }
    if (this.loginOperation) {
      this.activateHomeSurface();
      this.show();
      return this.loginOperation;
    }
    this.passkeyProgress = null;
    this.existingChromeProgress = null;
    this.authGeneration = (this.authGeneration ?? 0) + 1;
    const controller = new AbortController();
    this.embeddedLoginController = controller;
    const operation = (async () => {
      const sessionRefresh = this.sessionRefreshOperation;
      if (sessionRefresh) {
        try {
          await awaitInspection(sessionRefresh, controller.signal);
        } catch {
          // An explicit login is the recovery path after a failed saved-session refresh.
        }
      }
      if (controller.signal.aborted) return this.snapshot();
      return await this.withManualOperation("ChatGPT login", async () => {
        try {
          controller.signal.throwIfAborted();
          this.authNavigationError = null;
          this.show();
          this.logger.info("browser.login_opened");
          const current = this.view.webContents.getURL();
          if (!current.startsWith(CHATGPT_ORIGIN)) {
            await awaitInspection(this.view.webContents.loadURL(TEMPORARY_CHAT_URL), controller.signal);
          }
          controller.signal.throwIfAborted();
          await awaitInspection(this.probeAuthentication({ signal: controller.signal }), controller.signal);
          controller.signal.throwIfAborted();
          const authenticated = await this.waitForAuthenticated(180_000, controller.signal);
          controller.signal.throwIfAborted();
          await this.runSessionInspection(false, controller.signal);
          controller.signal.throwIfAborted();
          return authenticated;
        } catch (error) {
          // A user-requested switch is a handoff, not a failed login. Awaiting this operation
          // below keeps its probes/inspection from racing the imported passkey session.
          if (controller.signal.aborted) return this.snapshot();
          throw error;
        }
      });
    })();
    const tracked = operation.finally(() => {
      if (this.loginOperation === tracked) this.loginOperation = null;
      if (this.embeddedLoginController === controller) this.embeddedLoginController = null;
      this.publishState?.(this.snapshot());
    });
    this.loginOperation = tracked;
    this.publishState?.(this.snapshot());
    return tracked;
  }

  openExistingChromeLogin(confirmImport) {
    requireAutomaticBrowserInspection(this, "Importing the existing Chrome sign-in");
    return openExistingChromeLogin(this, async () => {
      const consented = await confirmImport();
      if (consented === true) requireAutomaticBrowserInspection(this, "Importing the existing Chrome sign-in");
      return consented;
    });
  }

  cancelExistingChromeLogin(cancelCapture) {
    return cancelExistingChromeLogin(this, cancelCapture);
  }

  allowExistingChromeFileAccess(selectConnectionFile) {
    requireAutomaticBrowserInspection(this, "Access to the Chrome connection file");
    if (process.platform !== "darwin" || this.existingChromeLoginOperation
      || this.existingChromeProgress?.phase !== "failed"
      || this.existingChromeProgress?.error !== "chrome-profile-access-denied"
      || typeof selectConnectionFile !== "function") {
      throw new Error("Chrome connection file access is available only after an operating-system access denial");
    }
    // The failed attempt already obtained local import consent. This explicit recovery action
    // asks macOS for the single file; Chrome still separately approves the actual connection.
    return openExistingChromeLogin(this, async () => true, { selectConnectionFile: async signal => {
      requireAutomaticBrowserInspection(this, "Access to the Chrome connection file");
      const contents = await selectConnectionFile(signal);
      requireAutomaticBrowserInspection(this, "Access to the Chrome connection file");
      return contents;
    } });
  }

  workspaceManager(accountName = "ChatGPT") {
    if (this.workspaceBrowser) {
      this.workspaceBrowser.label = accountName;
      return this.workspaceBrowser;
    }
    this.workspaceBrowser = new BrowserWorkspaceWindows({
      BrowserWindow, session: this.view.webContents.session, accountId: this.accountId,
      label: accountName, allowedUrl: allowedWorkspaceUrl,
      manifestPath: this.workspaceManifestPath,
      displays: this.workspaceDisplays,
      getVerifiedPrincipal: () => this.authPrincipalFingerprint,
      register: (contents, window, metadata) => {
        this.workspaceContents.set(contents, window);
        this.workspaceMetadata.set(contents, metadata);
        this.permissionPolicy.register(contents, 'auth'); this.externalLinkBroker.register(contents);
      },
      unregister: contents => {
        for (const [requestId, pending] of this.workspaceMutationRequests) {
          if (pending.contents !== contents) continue;
          this.workspaceMutationRequests.delete(requestId);
          pending.lease.fail(new Error("Browser workspace closed during account session change"));
        }
        this.workspaceContents.delete(contents);
        this.workspaceMetadata.delete(contents);
        this.permissionPolicy.unregister(contents); this.externalLinkBroker.unregister(contents);
      },
      external: (contents, url) => this.externalLinkBroker.open(contents, url, 'home').catch(() => {}),
      ...(this.workspaceSessionMutation
        ? { beginSessionMutation: request => this.workspaceSessionMutation.begin(request) } : {}),
      onMutationBlocked: error => {
        this.logger.warn("browser.workspace_session_mutation_blocked", {
          accountId: this.accountId,
          message: error instanceof Error ? error.message : String(error),
        });
        this.workspaceChanged?.();
      },
      onPersistenceError: error => this.logger.warn("browser.workspace_manifest_write_failed", {
        accountId: this.accountId,
        message: error instanceof Error ? error.message : String(error),
      }),
      onChanged: () => this.workspaceChanged?.(),
    });
    return this.workspaceBrowser;
  }

  async openWorkspaceWindow(asTab = false, accountName = "ChatGPT") {
    await this.ready();
    const manager = this.workspaceManager(accountName);
    manager.open({ asTab });
    return { count: manager.windows.size };
  }
  closeWorkspaceWindows() { return this.workspaceBrowser?.closeAll(); }

  async observeWorkspaceSessionMutation({ signal, context } = {}) {
    const deadline = Date.now() + 180_000;
    let previous = null;
    let stable = 0;
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      const contents = context?.contents;
      if (contents?.isDestroyed?.()) throw new Error("Browser workspace closed during session verification");
      const currentUrl = contents?.getURL?.() ?? CHATGPT_ORIGIN;
      let currentOrigin = null;
      try { currentOrigin = new URL(currentUrl).origin; } catch {}
      if (currentOrigin && currentOrigin !== CHATGPT_ORIGIN) {
        await delay(400, undefined, { signal });
        continue;
      }
      try {
        const requestSignal = signal
          ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
          : AbortSignal.timeout(10_000);
        const response = await this.view.webContents.session.fetch(`${CHATGPT_ORIGIN}/api/auth/session`, {
          credentials: "include", redirect: "error", cache: "no-store", signal: requestSignal,
          headers: { accept: "application/json" },
        });
        if (!response.ok || !response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
          throw new Error(`ChatGPT session verification failed with HTTP ${response.status}`);
        }
        const json = await readBoundedJson(response);
        const identity = sessionIdentity(json);
        const evidence = identity
          ? { status: "authenticated", ...identity }
          : { status: "signed-out", principalFingerprint: null, label: null };
        const signature = `${evidence.status}:${evidence.principalFingerprint ?? "none"}`;
        stable = signature === previous ? stable + 1 : 1;
        previous = signature;
        if (stable >= 2) return evidence;
      } catch (error) {
        if (signal?.aborted) throw error;
        previous = null;
        stable = 0;
      }
      await delay(400, undefined, { signal });
    }
    throw new Error("ChatGPT identity did not settle after the browser workspace change");
  }

  applyWorkspaceSessionMutationEvidence(evidence) {
    this.authGeneration = (this.authGeneration ?? 0) + 1;
    this.authProbeRevision += 1;
    if (evidence?.status !== "authenticated") {
      const identityEpoch = this.authIdentityEpoch;
      this.retireAuthenticatedIdentity();
      if (this.authIdentityEpoch === identityEpoch) {
        this.authIdentityEpoch += 1;
        this.onAuthIdentityChanged(this.accountId, this.authIdentityEpoch);
      }
      this.setState({ authenticated: false, authenticationStatus: "signed-out",
        authenticationCheckedAt: new Date().toISOString(), lastVerifiedAt: null,
        accountLabel: null, status: "signed-out", message: "Sign in to ChatGPT" });
      this.workspaceBrowser?.refreshIdentityBindings();
      return this.snapshot();
    }
    if (typeof evidence.principalFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(evidence.principalFingerprint)) {
      throw new Error("Browser workspace returned invalid ChatGPT identity evidence");
    }
    this.authPrincipalFingerprint = evidence.principalFingerprint;
    this.authSessionFingerprint = null;
    this.authIdentityEpoch += 1;
    this.onAuthIdentityChanged(this.accountId, this.authIdentityEpoch);
    const verifiedAt = new Date().toISOString();
    this.setState({ authenticated: true, authenticationStatus: "verified",
      authenticationCheckedAt: verifiedAt, lastVerifiedAt: verifiedAt,
      accountLabel: evidence.label ?? null, status: "ready", message: "ChatGPT is ready" });
    this.workspaceBrowser?.refreshIdentityBindings();
    return this.snapshot();
  }

  openPasskeyLogin(kind = "configured") {
    requireAutomaticBrowserInspection(this, "Automated ChatGPT passkey import");
    if (kind !== "configured" && kind !== "chrome-profile") throw new Error("Invalid browser sign-in kind");
    const captureLogin = kind === "chrome-profile" ? this.loginWithChromeProfile : this.loginWithPasskey;
    if (typeof captureLogin !== "function") throw new Error("Selected browser sign-in operation is unavailable");
    if (this.passkeyLoginOperation) return this.passkeyLoginOperation;
    if (this.state.authenticated) {
      this.activateHomeSurface();
      this.show();
      return Promise.resolve(this.snapshot());
    }
    const embeddedLogin = this.embeddedLoginController ? this.loginOperation : null;
    const embeddedController = this.embeddedLoginController;
    if (this.loginOperation && !embeddedLogin) return this.loginOperation;
    this.passkeyProgress = initialPasskeyProgress();
    this.existingChromeProgress = null;
    const controller = new AbortController();
    this.passkeyLoginController = controller;
    this.authGeneration = (this.authGeneration ?? 0) + 1;
    const operation = (async () => {
      const handoffTimeoutMs = Number.isFinite(this.authHandoffTimeoutMs)
        ? Math.max(1, this.authHandoffTimeoutMs) : AUTH_HANDOFF_TIMEOUT_MS;
      const handoffDeadline = Date.now() + handoffTimeoutMs;
      if (embeddedLogin) {
        embeddedController.abort();
        for (const view of [this.view, this.authView]) {
          if (view && !view.webContents.isDestroyed()) view.webContents.stop();
        }
        // No Chrome session is started until the previous operation releases browser ownership.
        await waitForPreviousAuthentication(embeddedLogin, controller.signal, handoffDeadline - Date.now());
        controller.signal.throwIfAborted();
        this.closeAuthView(this.authView, true, false);
      }
      const sessionRefresh = this.sessionRefreshOperation;
      if (sessionRefresh) {
        try {
          await waitForPreviousAuthentication(sessionRefresh, controller.signal, handoffDeadline - Date.now());
        } catch (error) {
          if (controller.signal.aborted || error?.code === "existing_chrome_handoff_timeout") throw error;
          // Explicit sign-in is the recovery path after a failed saved-session refresh.
        }
      }
      return await this.withManualOperation("ChatGPT passkey login", async () => {
        controller.signal.throwIfAborted();
        this.authNavigationError = null;
        this.setState({
          authenticated: false,
          authenticationStatus: "unknown",
          status: "loading",
          message: "Waiting for passkey sign-in in the selected browser",
          loading: true,
        });
        this.logger.info("browser.passkey_login_started");
        const transfer = await captureLogin(patch => {
          if (!controller.signal.aborted) this.updatePasskeyProgress(patch);
        }, { accountId: this.accountId, accountLabel: this.state.accountLabel, signal: controller.signal,
          configureVerificationSession: (verificationSession, accountId) =>
            this.configureAccountSession(verificationSession, accountId) });
        this.updatePasskeyProgress({ phase: controller.signal.aborted ? "cancelling" : "verifying" });
        const result = await this.installPasskeyLogin(transfer, controller.signal);
        this.updatePasskeyProgress({ phase: "completed", error: null });
        return result;
      });
    })();
    const tracked = operation.catch(error => {
      const message = error instanceof Error ? error.message : String(error);
      const previousSessionRestored = error?.previousSessionRestored === true;
      const cancelled = (controller.signal.aborted || error?.code === "profile-login-cancelled") && !/(cleanup|clearing|removing|did not exit|termination|refused)/i.test(message);
      const phase = cancelled ? "cancelled" : /timed out/i.test(message) ? "timed-out" : "failed";
      const errorCode = phase === "cancelled" ? null
        : ["chrome-account-mismatch", "chrome-account-unverified", "chrome-account-unidentified",
          "chrome-profile-claim-missing"].includes(error?.code) ? error.code
        : error?.code === "existing_chrome_handoff_timeout" ? "passkey-handoff-timeout"
          : phase === "timed-out" ? "passkey-timeout"
            : /(cleanup|clearing|removing|did not exit|termination|refused)/i.test(message) ? "passkey-cleanup-failed"
              : /invalid (storage-state|cookie|origin|ChatGPT local storage)|contains no ChatGPT\/OpenAI cookies|too (large|many)/i.test(message) ? "passkey-validation-failed"
                : this.passkeyProgress?.phase === "verifying" ? "passkey-verification-failed"
                  : this.passkeyProgress?.phase === "starting" || this.passkeyProgress?.phase === "waiting" || this.passkeyProgress?.phase === "importing"
                    ? "passkey-capture-failed" : "passkey-import-failed";
      this.updatePasskeyProgress({ phase, error: errorCode });
      const authenticationStatus = this.state.authenticationStatus === "signed-out"
        ? "signed-out" : cancelled ? "unknown" : "unavailable";
      if (previousSessionRestored) this.setState({ loading: false });
      else this.setState({ loading: false,
        status: authenticationStatus === "signed-out" ? "signed-out" : authenticationStatus === "unavailable" ? "error" : "idle",
        authenticated: false,
        authenticationStatus,
        ...(authenticationStatus === "unavailable" ? { authenticationCheckedAt: new Date().toISOString() } : {}),
        message: phase === "cancelled" ? "Passkey sign-in cancelled" : errorCode });
      if (phase === "cancelled") return this.snapshot();
      const safeError = new Error(errorCode);
      if (typeof errorCode === "string") safeError.code = errorCode;
      throw safeError;
    }).finally(() => {
      if (this.loginOperation === tracked) this.loginOperation = embeddedController
        && this.embeddedLoginController === embeddedController ? embeddedLogin : null;
      if (this.passkeyLoginOperation === tracked) this.passkeyLoginOperation = null;
      if (this.passkeyLoginController === controller) this.passkeyLoginController = null;
      this.publishState?.(this.snapshot());
    });
    this.loginOperation = tracked;
    this.passkeyLoginOperation = tracked;
    this.publishState?.(this.snapshot());
    return tracked;
  }

  updatePasskeyProgress(patch) {
    this.passkeyProgress = { ...this.passkeyProgress, ...patch };
    this.publishState?.(this.snapshot());
  }

  async cancelPasskeyLogin(cancelCapture) {
    const controller = this.passkeyLoginController;
    if (!controller || !this.passkeyLoginOperation) throw new Error("No passkey sign-in is active");
    const capturePhase = ["starting", "waiting", "importing"].includes(this.passkeyProgress?.phase);
    controller.abort(new Error("Passkey sign-in cancelled"));
    this.updatePasskeyProgress({ phase: "cancelling" });
    if (capturePhase) {
      try { await cancelCapture(); } catch (error) {
        // Cancellation can race a finished capture. The signal also guards the import transaction.
        this.logger.warn?.("browser.passkey_cancel_capture", { message: error instanceof Error ? error.message : String(error) });
      }
    }
    await this.passkeyLoginOperation;
    return this.snapshot();
  }

  async clearOwnedSessionForPasskey() {
    if (!(this.turnTabs instanceof Map)) throw new Error("Owned ChatGPT tab registry is unavailable");
    this.authGeneration = (this.authGeneration ?? 0) + 1;
    if (this.authView) this.closeAuthView(this.authView, true, false);
    const tabs = [...this.turnTabs.values()];
    const contents = [this.view, ...tabs.map(tab => tab.view)]
      .map(view => view?.webContents)
      .filter(candidate => candidate && !candidate.isDestroyed());
    if (contents.length === 0) throw new Error("Owned ChatGPT browser session is unavailable");
    const browserSession = contents[0].session;
    if (contents.some(candidate => candidate.session !== browserSession)) {
      throw new Error("Owned ChatGPT views do not share one browser session");
    }
    await Promise.all(contents.map(candidate => candidate.loadURL(IDLE_BROWSER_URL)));
    await browserSession.clearStorageData();
    browserSession.flushStorageData();
    await browserSession.cookies.flushStore();
    this.retireAuthenticatedIdentity();
    for (const tab of tabs) this.removeTurnTab(tab, false);
  }

  async resetFailedPasskeyLogin() {
    await this.clearOwnedSessionForPasskey();
    const contents = this.view.webContents;
    await contents.loadURL(TEMPORARY_CHAT_URL);
    const browser = await this.probeAuthentication();
    if (browser.authenticated) throw new Error("Partial passkey session remained authenticated after cleanup");
    this.setState({ authenticated: false, authenticationStatus: "signed-out",
      authenticationCheckedAt: new Date().toISOString(), loading: false,
      status: "signed-out", message: "Sign in to ChatGPT" });
  }

  async verifyCapturedLoginTransfer(transfer, signal) {
    const knownPrincipalFingerprint = this.authPrincipalFingerprint;
    let verified = transfer;
    if (!isVerifiedCaptureTransfer(verified)) {
      const identity = await verifyCapturedAccount(electronSession, transfer, {
        signal,
        accountId: this.accountId,
        configureSession: (verificationSession, accountId) =>
          this.configureAccountSession(verificationSession, accountId),
      });
      verified = verifiedCaptureTransfer(transfer, identity);
    }
    signal?.throwIfAborted();
    const identity = verified.verifiedIdentity;
    const capturedPrincipalFingerprint = identity.principalFingerprint;
    const intent = verified.identityIntent;
    const intentCoversKnownReplacement = Boolean(knownPrincipalFingerprint
      && capturedPrincipalFingerprint !== knownPrincipalFingerprint
      && intent?.knownPrincipalFingerprint === knownPrincipalFingerprint
      && intent.actualIdentityConfirmed === true);
    const intentCoversUnloadedBinding = Boolean(!knownPrincipalFingerprint && intent
      && (intent.knownPrincipalFingerprint === capturedPrincipalFingerprint
        || intent.actualIdentityConfirmed === true));
    if (capturedPrincipalFingerprint === knownPrincipalFingerprint
      || intentCoversKnownReplacement || intentCoversUnloadedBinding) return verified;
    if (!identity.label) {
      const error = new Error("Captured ChatGPT identity has no user-visible label");
      error.code = "chrome-account-unidentified";
      throw error;
    }
    const replacing = Boolean(knownPrincipalFingerprint);
    const response = await this.dialog.showMessageBox(this.window, {
      type: replacing ? "warning" : "question",
      title: "Confirm ChatGPT account",
      message: replacing
        ? `Replace the current ChatGPT account${this.state.accountLabel ? ` “${this.state.accountLabel}”` : ""} with “${identity.label}”?`
        : `Connect ChatGPT account “${identity.label}”?`,
      detail: "This is the actual account verified by ChatGPT. Continue only if it is the account intended for this NEKODEX profile.",
      buttons: ["Cancel", replacing ? "Replace" : "Connect"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    signal?.throwIfAborted();
    if (response.response !== 1) {
      const error = new Error("ChatGPT account replacement cancelled");
      error.code = "profile-login-cancelled";
      throw error;
    }
    return verified;
  }

  async captureLoginRollbackSnapshot() {
    const contents = this.view?.webContents;
    if (!contents || contents.isDestroyed()) throw new Error("Owned ChatGPT browser session is unavailable");
    return {
      storage: await captureOwnedSession(contents),
      evidence: {
        principalFingerprint: this.authPrincipalFingerprint,
        sessionFingerprint: this.authSessionFingerprint,
        identityEpoch: this.authIdentityEpoch,
      },
      state: { ...this.state },
    };
  }

  async restoreLoginRollbackSnapshot(snapshot) {
    if (!snapshot?.storage || !snapshot.evidence || !snapshot.state) {
      throw new Error("Previous ChatGPT session rollback snapshot is unavailable");
    }
    await this.clearOwnedSessionForPasskey();
    const contents = this.view?.webContents;
    if (!contents || contents.isDestroyed()) throw new Error("Owned ChatGPT browser session is unavailable");
    await restoreOwnedSession(contents, snapshot.storage, TEMPORARY_CHAT_URL);
    const expectedPrincipal = snapshot.evidence.principalFingerprint;
    let result;
    try { result = await this.probeAuthentication(); }
    catch { result = { authenticated: false, authenticationStatus: "unavailable" }; }
    if (result?.authenticated) {
      if (expectedPrincipal && this.authPrincipalFingerprint !== expectedPrincipal) {
        throw new Error("Restored ChatGPT session has a different principal");
      }
      return this.snapshot();
    }
    if (result?.authenticationStatus === "signed-out") {
      if (expectedPrincipal) throw new Error("Previous ChatGPT session was rejected after rollback");
      return this.snapshot();
    }
    // Retain only historical identity evidence. Restored credentials remain unavailable until
    // ChatGPT proves them again; an unavailable probe never becomes a verified result.
    if (expectedPrincipal) {
      this.authPrincipalFingerprint = expectedPrincipal;
      this.authSessionFingerprint = snapshot.evidence.sessionFingerprint;
      this.authIdentityEpoch = Math.max(this.authIdentityEpoch ?? 0, snapshot.evidence.identityEpoch ?? 0) + 1;
      this.onAuthIdentityChanged(this.accountId, this.authIdentityEpoch);
    }
    this.setState({
      ...snapshot.state,
      authenticated: false,
      authenticationStatus: "unavailable",
      authenticationCheckedAt: new Date().toISOString(),
      status: "error",
      loading: false,
      message: "Previous ChatGPT session restored; verification is currently unavailable",
    });
    return this.snapshot();
  }

  async installPasskeyLogin(transfer, signal) {
    requireAutomaticBrowserInspection(this, "Automated ChatGPT session import");
    if (!transfer || typeof transfer !== "object" || typeof transfer.cleanup !== "function") {
      throw new Error("Passkey sign-in returned an invalid transfer handle");
    }
    let verifiedTransfer = transfer;
    let error = null;
    let result = null;
    let sessionMutated = false;
    let transferCommitted = false;
    let previousSessionRollback = null;
    let state;
    try {
      signal?.throwIfAborted();
      verifiedTransfer = await this.verifyCapturedLoginTransfer(transfer, signal);
      state = validatePasskeyLoginState(verifiedTransfer.storageState);
      const contents = this.view?.webContents;
      if (!contents || contents.isDestroyed()) throw new Error("Owned ChatGPT browser session is unavailable");
      previousSessionRollback = await this.captureLoginRollbackSnapshot();
      signal?.throwIfAborted();
      sessionMutated = true;
      await this.clearOwnedSessionForPasskey();
      for (const cookie of state.cookies) {
        signal?.throwIfAborted();
        await contents.session.cookies.set(cookie);
      }
      contents.session.flushStorageData();
      await contents.session.cookies.flushStore();
      await contents.loadURL(TEMPORARY_CHAT_URL);
      if (state.localStorage.length > 0) {
        const entries = javaScriptLiteral(state.localStorage);
        await contents.executeJavaScript(`(() => {
          if (location.origin !== ${JSON.stringify(CHATGPT_ORIGIN)}) {
            throw new Error("Passkey storage import reached an unexpected origin");
          }
          for (const entry of ${entries}) localStorage.setItem(entry.name, entry.value);
        })()`, true);
        await contents.loadURL(TEMPORARY_CHAT_URL);
      }
      signal?.throwIfAborted();
      result = await this.waitForAuthenticated(60_000, signal);
      await this.runSessionInspection(false);
      signal?.throwIfAborted();
      if (!result?.authenticated || !this.authPrincipalFingerprint) {
        throw new Error("Passkey sign-in completed without an authenticated Launcher identity");
      }
      if (this.authPrincipalFingerprint !== verifiedTransfer.verifiedIdentity.principalFingerprint) {
        const mismatch = new Error("Installed ChatGPT identity does not match the verified capture");
        mismatch.code = "chrome-account-mismatch";
        throw mismatch;
      }
      this.activateHomeSurface();
      this.show();
      this.logger.info("browser.passkey_login_imported");
    } catch (caught) {
      error = caught;
    }

    try {
      await verifiedTransfer.cleanup();
    } catch (cleanupError) {
      error = error
        ? combinedError(error, "removing temporary passkey state failed", cleanupError)
        : new Error(`Removing temporary passkey state failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
    }
    if (!error) {
      try {
        signal?.throwIfAborted();
        await verifiedTransfer.commit({ authenticated: result?.authenticated === true,
          principalFingerprint: this.authPrincipalFingerprint });
        transferCommitted = true;
      } catch (commitError) {
        error = commitError;
      }
    }
    if (error && !transferCommitted) {
      try { if (typeof verifiedTransfer.rollback === "function") await verifiedTransfer.rollback(); }
      catch (rollbackError) {
        error = combinedError(error, "rolling back the verified Chrome profile binding failed", rollbackError);
      }
    }
    if (error && sessionMutated) {
      try {
        await this.restoreLoginRollbackSnapshot(previousSessionRollback);
        if (error && typeof error === "object") error.previousSessionRestored = true;
      } catch (rollbackError) {
        error = combinedError(error, "restoring the previous ChatGPT session failed", rollbackError);
      }
    }
    if (previousSessionRollback?.storage) disposeOwnedSessionSnapshot(previousSessionRollback.storage);
    if (error) throw error;
    return this.snapshot();
  }

  async logout() {
    requireAutomaticBrowserInspection(this, "Automated ChatGPT logout verification");
    return await this.withManualOperation("ChatGPT logout", async () => {
      this.existingChromeProgress = null;
      this.authGeneration = (this.authGeneration ?? 0) + 1;
      if (this.authView) this.closeAuthView(this.authView, true, false);
      const contents = this.view.webContents;
      await contents.session.clearStorageData();
      this.retireAuthenticatedIdentity();
      this.setState({
        authenticated: false,
        authenticationStatus: "signed-out",
        authenticationCheckedAt: new Date().toISOString(),
        loading: true,
        message: "Signing out of ChatGPT",
        status: "loading",
      });
      await contents.loadURL(TEMPORARY_CHAT_URL);
      const browser = await this.probeAuthentication();
      if (browser.authenticated) {
        throw new Error("ChatGPT session remained authenticated after local session data was cleared");
      }
      this.activateHomeSurface();
      this.show();
      this.logger.info("browser.logout_completed");
      return this.snapshot();
    });
  }

  refreshAuthentication() {
    requireAutomaticBrowserInspection(this, "ChatGPT authentication refresh");
    if (this.sessionRefreshOperation) return this.sessionRefreshOperation;
    const operation = this.withReadOnlyInspection("session refresh", async signal => {
      this.authGeneration = (this.authGeneration ?? 0) + 1;
      this.setState({ status: "loading", message: "Checking saved ChatGPT session" });
      if (!isTemporaryChatUrl(this.view.webContents.getURL())) {
        await awaitInspection(this.view.webContents.loadURL(TEMPORARY_CHAT_URL), signal);
      }
      const state = await awaitInspection(this.probeAuthentication({ signal }), signal);
      signal.throwIfAborted();
      if (state.authenticated) {
        this.setState({ status: "ready", message: "ChatGPT is ready" });
      }
      return this.snapshot();
    });
    let tracked;
    tracked = operation.finally(() => {
      if (this.sessionRefreshOperation === tracked) this.sessionRefreshOperation = null;
    });
    this.sessionRefreshOperation = tracked;
    return tracked;
  }

  retryAuthenticationCheck() {
    requireAutomaticBrowserInspection(this, "ChatGPT authentication retry");
    if (this.authenticationRetryOperation) return this.authenticationRetryOperation;
    if (!this.view || this.view.webContents.isDestroyed()) {
      return Promise.reject(new Error("ChatGPT session verification is unavailable: embedded browser is not ready"));
    }
    const operation = this.withReadOnlyInspection("session verification retry", async signal => {
      const generation = this.authGeneration ?? 0;
      const state = await awaitInspection(this.probeAuthentication({ signal, observationOnly: true }), signal);
      signal.throwIfAborted();
      if ((this.authGeneration ?? 0) !== generation) {
        throw new Error("ChatGPT session verification is unavailable: browser session changed");
      }
      return state;
    }, { preserveSelection: true });
    let tracked;
    tracked = operation.finally(() => {
      if (this.authenticationRetryOperation === tracked) this.authenticationRetryOperation = null;
    });
    this.authenticationRetryOperation = tracked;
    return tracked;
  }

  probeAuthentication(options = {}) {
    const operation = this.authProbeTail.then(
      () => this.runAuthenticationProbe(options),
      () => this.runAuthenticationProbe(options),
    );
    this.authProbeTail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async runAuthenticationProbe({ forSetup = false, observationOnly = false, signal } = {}) {
    signal?.throwIfAborted();
    requireAutomaticBrowserInspection(this, "ChatGPT authentication probe");
    if (!this.view || this.view.webContents.isDestroyed()) {
      if (forSetup) throw new Error("ChatGPT session verification is unavailable: embedded browser is not ready");
      return this.snapshot();
    }
    const generation = this.authGeneration ?? 0;
    const probeRevision = ++this.authProbeRevision;
    const primaryView = this.view;
    const primaryContents = primaryView.webContents;
    let authView = this.authView;
    // Page-load event probes run independently of the tracked login operation.
    // A response from an old session or a replaced popup must not alter the new one.
    const isCurrent = () => !signal?.aborted && (this.authGeneration ?? 0) === generation
      && this.authProbeRevision === probeRevision
      && this.view === primaryView
      && !primaryContents.isDestroyed()
      && this.authView === authView
      && (!authView || !authView.webContents.isDestroyed());
    const loadPrimary = async () => {
      try {
        await awaitInspection(primaryContents.loadURL(TEMPORARY_CHAT_URL), signal);
      } catch (error) {
        if (!isCurrent()) return false;
        throw error;
      }
      return isCurrent();
    };
    let url = primaryContents.getURL();
    if (url === IDLE_BROWSER_URL) {
      if (forSetup) throw new Error("ChatGPT session verification is unavailable: Temporary Chat has not loaded");
      if (observationOnly) {
        this.setState({
          status: "error",
          message: "ChatGPT session verification unavailable: Temporary Chat has not loaded",
          authenticated: false,
          authenticationStatus: "unavailable",
          authenticationCheckedAt: new Date().toISOString(),
          url,
        });
        return this.snapshot();
      }
      this.setState({
        status: this.state.authenticated ? "ready" : "signed-out",
        message: this.state.authenticated ? "No active task" : "Sign in to ChatGPT",
        url,
      });
      return this.snapshot();
    }
    if (!url.startsWith(CHATGPT_ORIGIN)) {
      if (forSetup) throw new Error("ChatGPT session verification is unavailable: Temporary Chat has not loaded");
      this.retireAuthenticatedIdentity();
      this.setState({ status: "signed-out", message: "Sign in to ChatGPT", authenticated: false,
        authenticationStatus: "signed-out", authenticationCheckedAt: new Date().toISOString(), url });
      return this.snapshot();
    }
    const probe = (contents) => awaitInspection(contents.executeJavaScript(`(async () => {
      const expectedUrl = new URL(${JSON.stringify(TEMPORARY_CHAT_URL)});
      const readSurface = () => {
        const composer = ${visibleElementScript(COMPOSER_SELECTOR)};
        const actualUrl = new URL(location.href);
        return {
          url: actualUrl.href,
          composer: Boolean(composer),
          temporary: actualUrl.origin === expectedUrl.origin
            && actualUrl.pathname === expectedUrl.pathname
            && actualUrl.searchParams.get("temporary-chat") === "true",
          readyState: document.readyState,
        };
      };
      const initialSurface = readSurface();
      let sessionAuthenticated = false;
      let sessionVerification = "unavailable";
      let verificationFailure = "session response unavailable";
      let accountLabel = null;
      let principalFingerprint = null;
      let sessionFingerprint = null;
      if (new URL(initialSurface.url).origin === expectedUrl.origin) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), ${CHATGPT_AUTH_SESSION_TIMEOUT_MS});
        try {
          const response = await fetch("/api/auth/session", {
            credentials: "include",
            cache: "no-store",
            headers: { accept: "application/json" },
            signal: controller.signal,
          });
          const responseUrl = new URL(response.url);
          const trustedEndpoint = responseUrl.origin === expectedUrl.origin
            && responseUrl.pathname === "/api/auth/session";
          if (!trustedEndpoint) {
            verificationFailure = "session endpoint redirected";
          } else if (!response.ok) {
            // A service/protective response, including 401/403 HTML, is not an auth verdict.
            verificationFailure = "session HTTP " + response.status;
          } else if (!response.headers.get("content-type")?.includes("application/json")) {
            verificationFailure = "session response was not JSON";
          } else {
            const payload = await response.json();
            if (payload && typeof payload === "object" && !Array.isArray(payload)) {
              const user = payload.user && typeof payload.user === "object" && !Array.isArray(payload.user)
                ? payload.user
                : null;
              const sessionHasUser = user !== null && Object.keys(user).length > 0;
              const principal = typeof user?.id === "string" && user.id.trim()
                ? "id:" + user.id.trim()
                : typeof user?.email === "string" && user.email.trim()
                  ? "email:" + user.email.trim().toLowerCase()
                  : null;
              const sessionHasNoError = payload.error === undefined || payload.error === null || payload.error === "";
              const hasExpiry = payload.expires !== undefined && payload.expires !== null;
              const expiry = hasExpiry && typeof payload.expires === "string" ? Date.parse(payload.expires) : NaN;
              const expiryKnown = !hasExpiry || Number.isFinite(expiry);
              const sessionExpired = hasExpiry && expiryKnown && expiry <= Date.now();
              if (!sessionHasNoError) {
                verificationFailure = "session payload reported an error";
              } else if (!expiryKnown) {
                verificationFailure = "session expiry was invalid";
              } else if (!sessionHasUser || sessionExpired) {
                sessionVerification = "rejected";
              } else if (!principal) {
                verificationFailure = "session principal identity was unavailable";
              } else {
                const digestValue = async value => [...new Uint8Array(
                  await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
                )]
                  .map(value => value.toString(16).padStart(2, "0")).join("");
                const stableSessionId = [payload.sessionId, payload.session_id, payload.sid]
                  .find(value => typeof value === "string" && value.trim());
                principalFingerprint = await digestValue(principal);
                sessionFingerprint = stableSessionId
                  ? await digestValue(principal + "|session:" + stableSessionId.trim())
                  : principalFingerprint;
                sessionAuthenticated = true;
                sessionVerification = "authenticated";
                const label = typeof user.email === "string" ? user.email : typeof user.name === "string" ? user.name : null;
                accountLabel = label ? label.replace(/[\\u0000-\\u001f\\u007f]/g, "").slice(0, 160) : null;
              }
            } else {
              verificationFailure = "session payload was invalid";
            }
          }
        } catch (error) {
          verificationFailure = error?.name === "AbortError" ? "session request timed out" : "session request failed";
        }
        finally { clearTimeout(timeout); }
      }
      return { ...readSurface(), sessionAuthenticated, sessionVerification, verificationFailure,
        accountLabel, principalFingerprint, sessionFingerprint };
    })()`, true), signal
      ? AbortSignal.any([signal, AbortSignal.timeout(CHATGPT_AUTH_SESSION_TIMEOUT_MS + 3_000)])
      : AbortSignal.timeout(CHATGPT_AUTH_SESSION_TIMEOUT_MS + 3_000)).catch(() => ({
      url: "",
      composer: false,
      temporary: false,
      sessionAuthenticated: false,
      sessionVerification: "unavailable",
      verificationFailure: "browser inspection failed",
      principalFingerprint: null,
      sessionFingerprint: null,
      readyState: "unknown",
    }));
    let result = await probe(primaryContents);
    if (!isCurrent()) {
      if (forSetup) throw new Error("ChatGPT session verification is unavailable: browser session changed");
      return this.snapshot();
    }
    let authResult;
    if (!observationOnly && !(result.composer && result.temporary && result.sessionAuthenticated)
      && authView) {
      authResult = await probe(authView.webContents);
      if (!isCurrent()) {
        if (forSetup) throw new Error("ChatGPT session verification is unavailable: browser session changed");
        return this.snapshot();
      }
      if (authResult.sessionAuthenticated) {
        this.closeAuthView(authView, true, false);
        authView = this.authView;
        if (!isCurrent() || !(await loadPrimary())) {
          if (forSetup) throw new Error("ChatGPT session verification is unavailable: browser session changed");
          return this.snapshot();
        }
        url = primaryContents.getURL();
        result = await probe(primaryContents);
        if (!isCurrent()) {
          if (forSetup) throw new Error("ChatGPT session verification is unavailable: browser session changed");
          return this.snapshot();
        }
      }
    }
    if (this.manualOperation === "ChatGPT login"
      && result.sessionAuthenticated
      && !result.temporary) {
      if (!(await loadPrimary())) {
        if (forSetup) throw new Error("ChatGPT session verification is unavailable: browser session changed");
        return this.snapshot();
      }
      url = primaryContents.getURL();
      result = await probe(primaryContents);
      if (!isCurrent()) {
        if (forSetup) throw new Error("ChatGPT session verification is unavailable: browser session changed");
        return this.snapshot();
      }
    }
    if (result.composer && result.temporary && result.sessionAuthenticated) {
      if (authView) {
        this.closeAuthView(authView, true, false);
      }
      const wasAuthenticated = this.state.authenticated;
      const availability = this.activeTraceId
        ? { status: "running", message: "ChatGPT is working" }
        : this.manualOperation
          ? {}
          : { status: "ready", message: "ChatGPT is ready" };
      if (typeof result.principalFingerprint !== "string"
        || !/^[a-f0-9]{64}$/.test(result.principalFingerprint)
        || typeof result.sessionFingerprint !== "string"
        || !/^[a-f0-9]{64}$/.test(result.sessionFingerprint)) {
        if (forSetup) throw new Error("ChatGPT session verification is unavailable: principal identity was unavailable");
        return this.snapshot();
      }
      const previousPrincipal = this.authPrincipalFingerprint;
      const previousSession = this.authSessionFingerprint;
      if (previousPrincipal === null) {
        this.authPrincipalFingerprint = result.principalFingerprint;
        this.authSessionFingerprint = result.sessionFingerprint;
        this.authIdentityEpoch += 1;
      } else if (previousPrincipal !== result.principalFingerprint
        || previousSession !== result.sessionFingerprint) {
        this.authPrincipalFingerprint = result.principalFingerprint;
        this.authSessionFingerprint = result.sessionFingerprint;
        this.authIdentityEpoch += 1;
        this.onAuthIdentityChanged(this.accountId, this.authIdentityEpoch);
      }
      const verifiedAt = new Date().toISOString();
      this.setState({ ...availability, authenticated: true, authenticationStatus: "verified",
        authenticationCheckedAt: verifiedAt, lastVerifiedAt: verifiedAt,
        accountLabel: result.accountLabel ?? null, url: result.url });
      if (!wasAuthenticated) this.logger.info("browser.authenticated", { url: result.url });
    } else {
      const loaded = result.readyState === "complete";
      const rejected = result.sessionVerification === "rejected"
        && (!authResult || authResult.sessionVerification === "rejected");
      const failure = result.sessionVerification === "unavailable" ? result.verificationFailure
        : authResult?.sessionVerification === "unavailable" ? authResult.verificationFailure
          : "Temporary Chat surface unavailable";
      if (rejected && loaded) this.retireAuthenticatedIdentity();
      const checkedAt = new Date().toISOString();
      this.setState({
        status: rejected && loaded ? "signed-out" : loaded ? "error" : "loading",
        message: rejected && loaded ? "Sign in to ChatGPT"
          : loaded ? `ChatGPT session verification unavailable: ${failure}` : "Waiting for ChatGPT",
        authenticated: false,
        authenticationStatus: rejected && loaded ? "signed-out" : "unavailable",
        authenticationCheckedAt: checkedAt,
        url: result.url || url,
      });
      if (forSetup && !rejected) {
        throw new Error(`ChatGPT session verification is unavailable: ${failure}`);
      }
    }
    return this.snapshot();
  }

  async waitForAuthenticated(timeoutMs = 180_000, signal) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      if (this.authNavigationError) {
        const error = this.authNavigationError;
        this.authNavigationError = null;
        throw error;
      }
      const state = await awaitInspection(this.probeAuthentication({ signal }), signal);
      signal?.throwIfAborted();
      if (state.authenticated) return state;
      await delay(750, undefined, { signal });
    }
    throw new Error("ChatGPT login was not completed before the timeout");
  }

  async smokeTest() {
    requireAutomaticBrowserInspection(this, "ChatGPT browser smoke test");
    return await this.withManualOperation("browser smoke test", () => this.runSmokeTest());
  }

  connectorName() {
    if (typeof this.getConnectorName !== "function") {
      throw new Error("Browser host connector-name resolver is unavailable");
    }
    return validateConnectorName(this.getConnectorName());
  }

  async runSmokeTest() {
    requireAutomaticBrowserInspection(this, "ChatGPT browser smoke test");
    const connectorName = this.connectorName();
    this.show();
    await this.waitForSurfaceReady();
    this.setState({ status: "testing", message: "Running browser smoke test" });
    this.logger.info("smoke.started");
    const result = await this.runBrowserHelperOperation({
      helper: this.helper,
      descriptorPath: this.descriptorPath,
      appName: connectorName,
      operation: "smoke",
      logger: this.logger,
    });
    const evidence = result?.value;
    if (!evidence
      || typeof evidence.effort !== "string"
      || !evidence.effort
      || evidence.response !== "CODEX WEB GPT READY") {
      throw new Error("Browser helper returned invalid smoke-test evidence");
    }
    this.logger.info("smoke.completed", { effort: evidence.effort, responseChars: evidence.response.length });
    this.setState({ status: "ready", message: "Smoke test passed" });
    return { ok: true, ...evidence };
  }

  async verifyConnector(appName) {
    requireAutomaticBrowserInspection(this, "ChatGPT connector verification");
    return await this.withReadOnlyInspection("connector verification", signal => this.runConnectorVerification(appName, signal));
  }

  async runConnectorVerification(appName, signal) {
    requireAutomaticBrowserInspection(this, "ChatGPT connector verification");
    const connectorName = validateConnectorName(appName);
    this.setState({ status: "testing", message: "Checking ChatGPT connector" });
    await this.refreshChatGptHomeDocument(signal);
    try {
      const result = await this.verifyConnectorWithBrowserHelper({
        helper: this.helper,
        descriptorPath: this.descriptorPath,
        appName: connectorName,
        logger: this.logger,
        signal,
      });
      signal?.throwIfAborted();
      this.logger.info("connector.verified", { appName: connectorName });
      this.setState({ status: "ready", message: "ChatGPT connector is available" });
      return result;
    } catch (error) {
      this.logger.error("connector.verification_failed", {
        appName: connectorName,
        ...(error && typeof error.operationId === "string" ? { traceId: error.operationId } : {}),
        errorName: error instanceof Error ? error.name : "Error",
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async inspectSession(detectCapabilities = false) {
    requireAutomaticBrowserInspection(this, "ChatGPT session and capability inspection");
    if (this.manualOperation === INTERACTION_MODE_CHANGE_OPERATION) {
      return await this.runSessionInspection(detectCapabilities);
    }
    return await this.withReadOnlyInspection("session inspection", signal => this.runSessionInspection(detectCapabilities, signal));
  }

  async runSessionInspection(detectCapabilities = false, signal) {
    requireAutomaticBrowserInspection(this, "ChatGPT session and capability inspection");
    const connectorName = this.connectorName();
    const initialUrl = this.view.webContents.getURL();
    const startedIdle = initialUrl === IDLE_BROWSER_URL;
    if (detectCapabilities) await this.refreshChatGptHomeDocument(signal);
    signal?.throwIfAborted();
    const result = await this.runBrowserHelperOperation({
      helper: this.helper,
      descriptorPath: this.descriptorPath,
      appName: connectorName,
      operation: "inspect",
      payload: { detectCapabilities },
      logger: this.logger,
      signal,
    });
    signal?.throwIfAborted();
    const inspected = result?.value;
    if (!inspected || inspected.authenticated !== true || inspected.temporary !== true || typeof inspected.url !== "string") {
      throw new Error("Browser helper returned invalid ChatGPT session evidence");
    }
    if (detectCapabilities
      && (typeof inspected.solAvailable !== "boolean" || typeof inspected.proAvailable !== "boolean"
        || (inspected.extraHighAvailable !== undefined && typeof inspected.extraHighAvailable !== "boolean"))) {
      throw new Error("Browser helper returned incomplete ChatGPT capability evidence");
    }
    if (detectCapabilities && ((inspected.proAvailable || inspected.extraHighAvailable) && !inspected.solAvailable
      || inspected.proAvailable && inspected.extraHighAvailable === false)) {
      throw new Error("Browser helper returned contradictory ChatGPT capability evidence");
    }
    if (startedIdle) await awaitInspection(this.returnToIdle(), signal);
    else this.setState({ status: "ready", message: "ChatGPT is ready", loading: false });
    return inspected;
  }

  async withManualOperation(name, action, signal) {
    await awaitInspection(this.ready(), signal);
    signal?.throwIfAborted();
    if (this.activeTraceId) {
      throw new Error(`ChatGPT browser is running Codex turn ${this.activeTraceId}`);
    }
    if (this.manualOperation) {
      throw new Error(`ChatGPT browser is already busy with ${this.manualOperation}`);
    }
    if (this.readOnlyInspection && this.readOnlyInspection.controller.signal !== signal) {
      throw new Error("ChatGPT browser is already checking the account");
    }
    this.activateHomeSurface();
    this.manualOperation = name;
    const contents = this.view?.webContents;
    try {
      this.publishState?.(this.snapshot());
      if (contents && !contents.isDestroyed()) contents.setBackgroundThrottling(false);
      return await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setState(signal?.aborted
        ? { status: this.state.authenticated ? "ready" : "idle", message, loading: false }
        : { status: "error", message });
      throw error;
    } finally {
      // Native renderer bookkeeping must not retain the operation lease if it throws.
      this.manualOperation = null;
      try { if (contents && !contents.isDestroyed()) contents.setBackgroundThrottling(true); }
      finally { this.publishState?.(this.snapshot()); }
    }
  }

  writeDescriptor() {
    const surfaceTargets = {};
    if (browserInteractionModeFor(this) === "automatic") {
      const surfaces = [[this.surfaceId, this.view?.webContents],
        ...[...this.turnTabs.values()].filter(tab => tab.interactionMode === "automatic")
          .map(tab => [tab.surfaceId, tab.view.webContents])];
      for (const [surfaceId, contents] of surfaces) {
        if (!contents || contents.isDestroyed()) continue;
        if (Object.hasOwn(surfaceTargets, surfaceId)) throw new Error("Browser surface ownership is duplicated");
        surfaceTargets[surfaceId] = contents.getOrCreateDevToolsTargetId();
      }
    }
    const descriptor = {
      version: 3,
      kind: "codex-web-gpt-launcher",
      profile: this.profile,
      pid: process.pid,
      endpoint: `http://127.0.0.1:${this.cdpPort}`,
      control: this.control,
      helper: this.helper,
      partition: this.partition,
      accountId: this.accountId,
      idleUrl: IDLE_BROWSER_URL,
      surfaceId: this.surfaceId,
      surfaceTargets,
      features: ["task-artifact-download-v1"],
      createdAt: new Date().toISOString(),
    };
    writePrivateFileAtomic(this.descriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`);
  }

  async persistSession() {
    const contents = this.view?.webContents;
    if (!contents || contents.isDestroyed()) return;
    const browserSession = contents.session;
    browserSession.flushStorageData();
    await browserSession.cookies.flushStore();
  }

  destroy() {
    this.destroyed = true;
    if (this.artifactDownloads) artifactTransfersFor(this).dispose();
    this.readOnlyInspection?.controller.abort(new Error("Browser host closed"));
    this.passkeyLoginController?.abort(new Error("Passkey sign-in cancelled during launcher shutdown"));
    this.existingChromeLoginController?.abort(new Error("Existing Chrome sign-in cancelled during launcher shutdown"));
    this.workspaceBrowser?.destroy();
    this.permissionPolicy?.destroy();
    this.externalLinkBroker?.destroy();
    this.authGeneration = (this.authGeneration ?? 0) + 1;
    try {
      const current = JSON.parse(fs.readFileSync(this.descriptorPath, "utf8"));
      if (current.pid === process.pid) fs.rmSync(this.descriptorPath, { force: true });
    } catch {}
    for (const [contents, handler] of this.shellZoomShortcutBindings) {
      if (!contents.isDestroyed()) contents.off("before-input-event", handler);
    }
    this.shellZoomShortcutBindings.clear();
    for (const event of WINDOW_VISIBILITY_EVENTS) {
      this.window.off(event, this.windowVisibilityListener);
    }
    this.closeAuthView(this.authView, true);
    this.clearHomeNavigationTimeout();
    if (this.turnLeaseSweep) clearInterval(this.turnLeaseSweep);
    if (this.resumeListener && powerMonitor && typeof powerMonitor.removeListener === "function") {
      powerMonitor.removeListener("resume", this.resumeListener);
      this.resumeListener = null;
    }
    if (this.powerSaveBlockerId !== null && powerSaveBlocker && typeof powerSaveBlocker.stop === "function") {
      powerSaveBlocker.stop(this.powerSaveBlockerId);
      this.powerSaveBlockerId = null;
    }
    turnLifecycleFor(this).disposeForShutdown();
    if (this.view && !this.view.webContents.isDestroyed()) this.view.webContents.close();
  }
}

module.exports = {
  allowedAuthUrl,
  allowedWorkspaceUrl,
  guardBrowserNavigation,
  authViewOptions,
  BrowserHost,
  BrowserTurnCancelledError,
  CHATGPT_VIEWPORT_CSS,
  IDLE_BROWSER_URL,
  isChatGptCloudflareChallengeResponse,
  isWorkspaceSessionMutationRequest,
  isTemporaryChatUrl,
  loadCommittedBrowserSurface,
  MANUAL_SUBMIT_TIMEOUT_MS,
  MANUAL_COMPACTION_SUBMIT_TIMEOUT_MS,
  navigationErrorForLog,
  navigationOriginForLog,
  TEMPORARY_CHAT_URL,
};
