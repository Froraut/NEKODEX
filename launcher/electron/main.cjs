const { registerClientConnections } = require("./ipc/client-connections.cjs");
const { stableChromiumUserAgent } = require("./browser-user-agent.cjs");
const { registerBrowserHandlers } = require("./ipc/browser-handlers.cjs");
const { registerAccountHandlers } = require("./ipc/account-handlers.cjs");
const { collectSupportReport, writeSupportReport } = require("./support-report.cjs");
const { supportReportSources } = require("./support-report-sources.cjs");
const { createChromeProfileChoice } = require("./chrome-profile-choice.cjs");
const { showChromeProfilePicker } = require("./chrome-profile-picker.cjs");
const { createProfileFirstLogin } = require("./profile-first-login.cjs");
const { catalogReceipt } = require("./catalog-receipt.cjs");
const { AccountBrowserPool } = require("./account-pool.cjs");
const { createTaskPlanStore } = require('./task-plans.cjs');
const { createLocalWorkspaceService } = require('./local-workspace.cjs');
const { registerWorkspaceIpc } = require('./ipc/workspace.cjs');
const { registerConversationHistory } = require('./ipc/conversation-history.cjs');
const { createCanonicalNativeHistoryRecorder } = require('./canonical-native-history.cjs');
const { createOwnedConversationDescriptorPublisher } = require('./owned-conversation-descriptor.cjs');
const { createOwnedNativeTranscriptProducer } = require('./owned-conversation-transcript.cjs');
const { registerAgentMode } = require('./ipc/agent-mode.cjs');
const { createLoopFileWatcherIntegration } = require('./loop-file-watcher-integration.cjs');
const { registerAgentLoopProducers } = require('./ipc/agent-loop-producers.cjs');
const { createCodexClientControl } = require('./codex-client-control.cjs');
const { createCodexThreadHandoff } = require('./codex-thread-handoff.cjs');
const { createAgentNativeBridge } = require('./agent-native-bridge.cjs');
const { createAgentNativeDescriptorPublisher } = require('./agent-native-descriptor.cjs');
const { createAgentRemoteDescriptorPublisher } = require('./agent-remote-descriptor.cjs');
const { createAgentVmExportDescriptorPublisher } = require('./agent-vm-descriptor.cjs');
const { createAgentPythonBuildDescriptorPublisher } = require('./agent-python-build-descriptor.cjs');
const { createPythonBuildSelectionService } = require('./python-build-selection.cjs');
const { createAgentOAuthService } = require('./agent-oauth-service.cjs');
const { oauthProtectedVaultAvailable } = require('./agent-oauth-vault.cjs');
const { createAgentOAuthIpc } = require('./ipc/agent-oauth.cjs');
const { createAgentOAuthMcpController } = require('./oauth-mcp-controller.cjs');
const { createAgentOAuthMcpDescriptorPublisher } = require('./agent-oauth-mcp-descriptor.cjs');
const { createWorkspaceVmExportService } = require('./workspace-vm-export.cjs');
const { createNativeAccountAuthority } = require('./native-account-authority.cjs');
const { fileDigest: nativeFileDigest, regular: nativeRegular, VERSION: NATIVE_CLI_VERSION } = require('./owned-native-admission.cjs');
const { registerNativeAccounts } = require('./ipc/native-accounts.cjs');
const { createNativeAccountInventoryService } = require('./native-account-inventory.cjs');
const { reviewedOwnedNativeDevPin } = require('./owned-native-dev-pin.cjs');
const { reviewedOwnedNativeProductionPin } = require('./owned-native-production-pin.cjs');
const { createNativeAccountExecutionService, settleNativeConversationOwners } = require('./native-account-execution.cjs');
const { createPersistentNativeConversations } = require('./persistent-native-conversations.cjs');
const { registerPersistentNativeConversations } = require('./ipc/native-persistent-conversations.cjs');
const { registerCodexClientControlIpc } = require('./ipc/codex-client-control.cjs');
const { resolveCodexExecutable } = require('./codex-login.cjs');
const { createWorkspaceTerminalService } = require('./workspace-terminal.cjs');
const { registerWorkspaceTerminalIpc } = require('./ipc/workspace-terminal.cjs');
const { createRemoteWorkspaceService } = require('./remote-workspace.cjs');
const { registerRemoteWorkspaceIpc } = require('./ipc/remote-workspace.cjs');
const { createWorkspaceGitService } = require('./workspace-git-mutations.cjs');
const { registerWorkspaceGitIpc } = require('./ipc/workspace-git.cjs');
const { createExternalUsageService } = require('./external-usage.cjs');
const { registerExternalUsageIpc } = require('./ipc/external-usage.cjs');
const { registerAgentTools } = require('./ipc/agent-tools.cjs');
const { registerBrowserCompanion } = require('./ipc/browser-companion.cjs');
const { registerLocalControlApi } = require('./ipc/local-control-api.cjs');
const { createAgentWorkspaceEvidenceAuthority } = require('./agent-workspace-evidence.cjs');
const { currentPickerContract, pickerReconciliationPatch } = require("./codex-picker-contract.cjs");
const { syncConversationPreferences, changeConversationPreference } = require("./conversation-preferences.cjs");
const { createCodexAccountTools } = require("./codex-account-tools.cjs");
const { MANUAL_CONNECTOR_NAME, automaticConnectorName, isLegacyConnectorName } = require("./connector-identity.cjs");
const { CAPACITY_ENV, MAX_BROWSER_CAPACITY, readBrowserCapacity, saveBrowserCapacity } = require("./browser-capacity.cjs");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const os = require('node:os');
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  screen,
  session,
  shell,
  Tray,
  webContents,
} = require("electron");
const { nativeFallbackProxyEnvironment, resolveNativeRequestProxy, resolveTunnelProxyEnvironment } = require("./native-proxy.cjs");
const LANGUAGES = require("./languages.json");
const { applicationMenu } = require("./application-menu.cjs");
const { reloadApplicationPage } = require("./application-reload.cjs");
const { nativeCopyFor, rendererRecoveryCopyFor, updateCheckLabelFor } = require("./native-copy.cjs");
const { installHermesProvider } = require("./hermes-integration.cjs");
const { navigationErrorForLog, bindRendererSurfaceInvalidation } = require("./browser-host.cjs");
const { BrowserControlServer } = require("./control-server.cjs");
const { getAutostart, setAutostart } = require("./autostart.cjs");
const {
  createLogger,
  createRendererIpcGuard,
  exportSanitizedLogs,
  installProcessDiagnosticGuards,
  registerLoggedIpc,
  registerLoggedIpcEvent,
} = require("./logging.cjs");
const { RuntimeHost } = require("./runtime.cjs");
const { createContextChangeQueue } = require("./context-change-queue.cjs");
const { ensurePackagedRuntime, externallyReferencedRuntimeVersions, installedRuntimeRoot: resolveInstalledRuntimeRoot,
  pruneRuntimeVersions,
  waitForPackagedRuntimeSource } = require("./runtime-install.cjs");
const { waitForUpdateCommit } = require("./update-commit.cjs");
const { RuntimeSupervisor } = require("./runtime-supervisor.cjs");
const { DEVELOPMENT_PROFILE, resolveLauncherProfile } = require("./profile.cjs");
const { runtimeBundlePaths } = require("./runtime-command.cjs");
const { createUpdateController } = require("./update.cjs");
const { SETUP_CONTRACT, setupIdentity, setupProofCurrent } = require("./upgrade-readiness.cjs");
const { captureUpdateReadiness, proveUpdateReadiness } = require("./update-readiness.cjs");
const { LauncherLifecycleProjection } = require("./lifecycle-projection.cjs");
const { createLifecycleAdmission } = require("./lifecycle-admission.cjs");
const updateReadinessHandoff = captureUpdateReadiness();
const { recoverStartupFailure } = require("./startup-recovery.cjs");
const { CHROME_SETTINGS_ADDRESS, confirmExistingChromeImport } = require("./existing-chrome-consent.cjs");
const { selectChromeConnectionFile } = require("./existing-chrome-file-access.cjs");
const {
  createStateStore,
  resolveAppearance,
  validateAppearance,
  validateSidebarState,
} = require("./state.cjs");
const {
  MIN_WINDOW_BOUNDS,
  readWindowState,
  trackWindowState,
} = require("./window-state.cjs");

// Picker evidence older than this is re-read while the account is idle; checked every half hour.
const MODEL_CAPABILITY_REFRESH_MS = 6 * 60 * 60_000;
const MODEL_CAPABILITY_REFRESH_CHECK_MS = 30 * 60_000;
// The Codex picker catalog can be rewritten by the daemon, the model-list command or setup.
const CODEX_PICKER_CHECK_MS = 30_000;

function codexPickerContract() {
  return IS_DEV_PROFILE ? null : currentPickerContract({ coreHome: CORE_HOME, codexHome: LAUNCHER_PROFILE.codexHome });
}

/** Ask for a Codex restart and a fresh picker confirmation when the catalog Codex loads changed. */
function reconcileCodexPicker(stateStore, logger) {
  const patch = pickerReconciliationPatch(stateStore.read(), codexPickerContract());
  if (!patch) return;
  const state = stateStore.update(patch);
  logger?.info("codex.picker_catalog_changed", {});
  send("launcher:state-changed", state);
}

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const FOREGROUND_RELAUNCH_ENV = "CODEX_WEB_GPT_FOREGROUND_RELAUNCH";
const foregroundRelaunchRequested = process.env[FOREGROUND_RELAUNCH_ENV] === "1";
delete process.env[FOREGROUND_RELAUNCH_ENV];
const launchEnvironment = {
  CODEX_CHATGPT_WEB_HOME: process.env.CODEX_CHATGPT_WEB_HOME,
  CODEX_HOME: process.env.CODEX_HOME,
  [FOREGROUND_RELAUNCH_ENV]: "1",
};
const SOURCE_ROOT = path.resolve(__dirname, "../..");
const LAUNCHER_PROFILE = resolveLauncherProfile({ appData: app.getPath("appData") });
const IS_DEV_PROFILE = LAUNCHER_PROFILE.kind === DEVELOPMENT_PROFILE;
const CORE_HOME = LAUNCHER_PROFILE.coreHome;
function reviewedNativeWorkerPin() {
  return IS_DEV_PROFILE ? reviewedOwnedNativeDevPin(SOURCE_ROOT)
    : reviewedOwnedNativeProductionPin({ resourcesPath: process.resourcesPath, executablePath: process.execPath });
}
const taskPlans = createTaskPlanStore({
  coreHome: CORE_HOME,
  resolveTask: ({ accountId, taskId }) => browserHost?.taskLedgers.get(accountId)?.get(taskId) ?? null,
});
let localWorkspaceService = null;
let nativeClientControl = null;
let nativeThreadHandoff = null;
let agentNativeBridge = null;
let agentNativeDescriptor = null;
let agentRemoteDescriptor = null;
let agentVmExportDescriptor = null;
let agentPythonBuildDescriptor = null;
let pythonBuildSelectionService = null;
let agentOAuthService = null;
let agentOAuthMcpController = null;
let agentOAuthMcpDescriptor = null;
let loopFileWatcher = null;
let loopProducerController = null;
let ownedConversationDescriptor = null;
let ownedConversationTranscript = null;
let workspaceVmExportService = null;
async function vmCoreControl(action, body) {
  if (quitting || shutdownInProgress || exitCommitted || lifecycleAdmission.busy()) throw new Error('VM export admission is closed');
  const config = runtimeSupervisor?.readConfig();
  if (!config || !await runtimeSupervisor.ownedAgentRuntimeReady(config)) throw new Error('VM export runtime owner is unavailable');
  const result = await runtimeSupervisor.control(config, 'agent-vm-export', { body: { action, ...body }, timeoutMs: 15000 });
  if (result?.ok !== true) throw new Error('VM export core authority is unavailable'); return result.value;
}
async function oauthMcpCoreControl(action, body) {
  if (quitting || shutdownInProgress || exitCommitted || lifecycleAdmission.busy()) throw new Error('OAuth MCP admission is closed');
  if (!agentOAuthMcpDescriptor?.instanceId) throw new Error('OAuth MCP launcher bridge is unavailable');
  const config = runtimeSupervisor?.readConfig();
  const pendingVersion = runtimeSupervisor?.launcherProfile === 'production' && config?.releaseVersion
    && config.releaseVersion !== app.getVersion();
  if (pendingVersion) throw new Error('OAuth MCP requires the automatic safe runtime switch to the installed application version');
  const captured = JSON.stringify(config);
  if (!config || !await runtimeSupervisor.ownedAgentRuntimeReady(config)) throw new Error('OAuth MCP runtime owner is unavailable');
  if (quitting || shutdownInProgress || exitCommitted || lifecycleAdmission.busy()
    || JSON.stringify(runtimeSupervisor.readConfig()) !== captured) throw new Error('OAuth MCP runtime owner changed');
  const receipt = await runtimeSupervisor.control(config, 'agent-oauth-mcp', { body: { action, ...body }, returnErrorReceipt: true });
  if (receipt?.ok !== true) throw new Error(receipt?.message || receipt?.error || 'OAuth MCP core authority is unavailable');
  return receipt.value;
}
function invalidateAgentSourceOwners() {
  try { loopFileWatcher?.beforeOwnerTeardown(); }
  finally {
    try { agentOAuthMcpController?.invalidate(); }
    finally {
      // Deny in-memory capture even if another owner's persistence or the
      // descriptor write fails; such a failure must not skip local revocation.
      void ownedConversationTranscript?.revoke().catch(() => {});
      ownedConversationDescriptor?.publish({ scopes: [], accepting: false });
    }
  }
}
let nativeAccountAuthority = null;
let nativeAccountInventory = null;
let nativeAccountExecution = null;
let persistentNativeConversations = null;
function publishOwnedConversationScopes() {
  if (!ownedConversationDescriptor) return;
  const accepting = !quitting && !shutdownInProgress && !exitCommitted && !lifecycleAdmission.busy();
  ownedConversationDescriptor.publish({ scopes: accepting ? persistentNativeConversations?.currentHistoryScopes() ?? [] : [], accepting });
}
async function ownedConversationHistoryCore(action, input) {
  const allowDraining = action === 'owned-conversation-release';
  if (!ownedConversationDescriptor || !allowDraining && (quitting || shutdownInProgress || exitCommitted || lifecycleAdmission.busy())) {
    throw new Error('Owned conversation recording admission is closed');
  }
  const config = runtimeSupervisor.readConfig(), captured = JSON.stringify(config);
  if (!config || !allowDraining && runtimeSupervisor.launcherProfile === 'production' && config.releaseVersion !== app.getVersion()) {
    throw new Error('Owned conversation recording is waiting for the safe runtime switch');
  }
  if (!await runtimeSupervisor.ownedAgentRuntimeReady(config, { allowDraining })
      || JSON.stringify(runtimeSupervisor.readConfig()) !== captured) throw new Error('Owned conversation recording runtime changed');
  const receipt = await runtimeSupervisor.control(config, 'owned-conversation-history', {
    body: { action, instanceId: ownedConversationDescriptor.instanceId, input }, returnErrorReceipt: true,
  });
  if (receipt?.ok !== true) throw new Error('Owned conversation recording was not confirmed');
  return receipt.value;
}
function getOwnedConversationTranscript() {
  return ownedConversationTranscript ??= createOwnedNativeTranscriptProducer({
    history: {
      begin: input => ownedConversationHistoryCore('owned-conversation-begin', input),
      record: input => ownedConversationHistoryCore('owned-conversation-record', input),
      release: lease => ownedConversationHistoryCore('owned-conversation-release', { lease }),
    },
    resolveScope: scope => persistentNativeConversations?.transcriptScope(scope.conversationId) ?? null,
  });
}
async function revokeOwnedConversationRecording(body) {
  const producer = getOwnedConversationTranscript();
  if (body.action === 'set-recording') { await producer.revoke(); return; }
  // The conversation row can exist before its Native thread ACK and scope.
  // Retain an ID-level tombstone even when no capture has been created yet.
  await producer.revokeConversation(body.conversationId);
}
function beginOwnedConversationRecordingConsent(body) {
  const producer = getOwnedConversationTranscript();
  const scope = body.action === 'owned-conversation-consent' ? persistentNativeConversations?.transcriptScope(body.conversationId) ?? null : undefined;
  return scope === null ? null : { scope, authority: producer.recordingAuthority(scope) };
}
function allowOwnedConversationRecording(body, value, attempt) {
  if (!ownedConversationTranscript || !attempt) return;
  if (body.action === 'set-recording' && value?.recordingEnabled === true) {
    ownedConversationTranscript.allowRecording(undefined, attempt.authority); return;
  }
  if (body.action === 'owned-conversation-consent' && value?.enabled === true) {
    const scope = persistentNativeConversations?.transcriptScope(body.conversationId);
    if (scope && value.scope && attempt.scope && Object.keys(scope).length === Object.keys(value.scope).length
        && Object.keys(scope).every(key => scope[key] === value.scope[key] && scope[key] === attempt.scope[key])) {
      ownedConversationTranscript.allowRecording(scope, attempt.authority);
    }
  }
}
function projectOwnedConversationRecordingStatus(body, value) {
  if (!['owned-conversation-status', 'owned-conversation-consent'].includes(body.action) || !value || typeof value !== 'object') return value;
  const local = ownedConversationTranscript?.recordingStatus(body.conversationId);
  return { ...value, localCaptureDenied: local?.locallyDenied ?? true,
    localCaptureReason: !local ? 'main-source-unavailable' : local.locallyDenied ? 'local-capture-held' : null };
}
async function closeNativeConversationOwners(execution = nativeAccountExecution) {
  const conversations = persistentNativeConversations;
  // Stop admission synchronously in both owners, then let account transport
  // closure settle a lost creation ACK instead of awaiting that ACK first.
  await settleNativeConversationOwners(execution, conversations);
  if (persistentNativeConversations === conversations) persistentNativeConversations = null;
}
let lastNativeModelPublication = null;
async function validateRemoteCoreAuthority(action, body, allowDraining = false) {
  if (!allowDraining && (quitting || shutdownInProgress || exitCommitted || lifecycleAdmission.busy())) throw new Error('Remote admission is closed');
  const config = runtimeSupervisor?.readConfig();
  if (!config || !await runtimeSupervisor.ownedAgentRuntimeReady(config, { allowDraining })) throw new Error('Remote runtime owner is unavailable');
  const receipt = await runtimeSupervisor.control(config, 'agent-remote', { body: { action, ...body } });
  if (receipt?.ok !== true) throw new Error('Remote task authority changed');
  return receipt.value;
}
function publishNativeAccountModels() {
  publishOwnedConversationScopes();
  if (!agentNativeDescriptor) return;
  const models = nativeAccountExecution?.models() ?? [];
  const value = { models, accepting: models.length > 0 && !quitting && !shutdownInProgress && !exitCommitted };
  const identity = JSON.stringify(value);
  if (identity === lastNativeModelPublication) return;
  agentNativeDescriptor.publish(value); lastNativeModelPublication = identity;
}
let workspaceTerminalService = null;
let remoteWorkspaceService = null;
let workspaceGitService = null;
let externalUsageService = null;
let workspaceEvidenceService = null;
const ACTIVE_BROWSER_CAPACITY = readBrowserCapacity(CORE_HOME);
process.env[CAPACITY_ENV] = String(ACTIVE_BROWSER_CAPACITY);
function browserCapacitySnapshot() {
  const configured = readBrowserCapacity(CORE_HOME);
  return { configured, active: ACTIVE_BROWSER_CAPACITY, maximum: MAX_BROWSER_CAPACITY,
    restartRequired: configured !== ACTIVE_BROWSER_CAPACITY };
}
const BROWSER_DESCRIPTOR_PATH = path.join(CORE_HOME, "runtime", "launcher-browser.json");
const BROWSER_HELPER_PATH = app.isPackaged
  ? path.join(process.resourcesPath, "runtime", "app", "browser-helper.cjs")
  : path.join(SOURCE_ROOT, ".launcher-runtime", "browser-helper.cjs");
const GITHUB_URL = "https://github.com/Froraut/NEKODEX";
const X_URL = "";
const CONNECTORS_URL = "https://chatgpt.com/plugins";
const DEVELOPER_MODE_URL = "https://chatgpt.com/#settings/Security?section=developer-mode";
const TUNNELS_URL = "https://platform.openai.com/settings/organization/tunnels";
const KEYS_URL = "https://platform.openai.com/settings/organization/api-keys";
const ALLOWED_EXTERNAL_URLS = new Set([GITHUB_URL, X_URL, CONNECTORS_URL, DEVELOPER_MODE_URL, TUNNELS_URL, KEYS_URL].filter(Boolean));
const PACKAGED_RENDERER_URL = pathToFileURL(path.join(__dirname, "..", "dist", "index.html")).href;
const APP_ICON_PATH = path.join(__dirname, "..", "assets", "icon.png");

process.env.CODEX_CHATGPT_WEB_HOME = CORE_HOME;
process.env.CODEX_HOME = LAUNCHER_PROFILE.codexHome;
app.setName(LAUNCHER_PROFILE.displayName);
// Cross-site frames keep this fallback as navigator.userAgent even when their view overrides its
// UA, and Cloudflare's challenge frame compares it with the request header. Present one stable
// Chromium UA app-wide; browser views apply the same value explicitly.
app.userAgentFallback = stableChromiumUserAgent(app.userAgentFallback, process.versions.chrome);
if (process.platform === "win32") {
  app.setAppUserModelId(IS_DEV_PROFILE ? "dev.codexwebgpt.launcher.dev" : "dev.codexwebgpt.launcher");
}
const launcherUserData = LAUNCHER_PROFILE.userData;
fs.mkdirSync(launcherUserData, { recursive: true, mode: 0o700 });
if (process.platform !== "win32") fs.chmodSync(launcherUserData, 0o700);
app.setPath("userData", launcherUserData);
app.setAppLogsPath(path.join(launcherUserData, "logs"));
installProcessDiagnosticGuards({
  filePath: path.join(launcherUserData, "logs", "process-stream-errors.log"),
});

let mainWindow = null;
let mainWindowReadyToShow = false;
let mainWindowShowRequested = false;
let mainWindowActivationRequested = false;
let rendererStartupComplete = false;
let rendererReloadAttempted = false;
let rendererRecoveryInFlight = false;
let rendererRecoveryFollowup = null;
let rendererUnavailable = false;
let rendererRecoveryDialogInFlight = false;
let launcherStateStore = null;
let updateForegroundRequestPending = Boolean(updateReadinessHandoff);
let browserHost = null;
let accountToolsService = null;
let runtimeHost = null;
let browserControl = null;
let runtimeSupervisor = null;
let logger = null;
let tray = null;
let quitting = false;
let shutdownInProgress = false;
let exitCommitted = false;
let cdpPort = 0;
let lastOperation = null;
let catalogVerificationTimer = null;
let catalogVerificationEpoch = 0;
let accountProofGeneration = 0;
let updateController = null;
let updatesPanelRequestRevision = 0;
let contextChangeQueue = null;
let startupPhase = "runtime-files";
const lifecycleProjection = new LauncherLifecycleProjection(value => send("launcher:lifecycle", value));
const additionalLifecycleParticipants = new Map();
let deferredQuit = null;
const lifecycleAdmission = createLifecycleAdmission(transition => {
  lifecycleProjection.update({ transition });
  if (transition === null && deferredQuit) {
    const pending = deferredQuit;
    deferredQuit = null;
    queueMicrotask(() => {
      void requestQuit(pending.options).then(result => {
        for (const resolve of pending.waiters) resolve(result);
      }, error => {
        const message = error instanceof Error ? error.message : String(error);
        publishOperation({ name: "launcher-quit", status: "failed", message });
        for (const resolve of pending.waiters) resolve({ ok: false, message });
      });
    });
  }
});

function registerLifecycleParticipant(name, participant) {
  if (typeof name !== "string" || !name.trim() || additionalLifecycleParticipants.has(name)
    || !participant || typeof participant.currentOperation !== "function"
    || typeof participant.destroy !== "function") {
    throw new Error("Launcher lifecycle participant is invalid or already registered");
  }
  additionalLifecycleParticipants.set(name, participant);
  return () => {
    if (additionalLifecycleParticipants.get(name) === participant) additionalLifecycleParticipants.delete(name);
  };
}

function currentGlobalOperation() {
  const primary = runtimeHost?.currentOperation() || browserHost?.currentOperation();
  if (primary) return primary;
  for (const participant of additionalLifecycleParticipants.values()) {
    const operation = participant.currentOperation();
    if (operation) return operation;
  }
  return null;
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function send(channel, value) {
  if (!rendererUnavailable && mainWindow && !mainWindow.isDestroyed()
    && !mainWindow.webContents.isDestroyed() && !mainWindow.webContents.isCrashed()) {
    mainWindow.webContents.send(channel, value);
  }
}

function publishOperation(operation) {
  lastOperation = lifecycleProjection.recordOperation(operation);
  send("launcher:operation", lastOperation);
}

function retireAccountProof() {
  accountProofGeneration += 1;
  return accountProofGeneration;
}

function captureAccountProofContext(stateStore) {
  const browser = browserHost.snapshot();
  return {
    generation: accountProofGeneration,
    mode: stateStore.read().browserInteractionMode,
    identity: setupIdentity(runtimeHost.runtimeConfigSnapshot().config, browser.accountLabel),
    runtimeIdentity: currentRuntimeIdentity(),
  };
}

function currentRuntimeIdentity() {
  const snapshot = runtimeSupervisor?.snapshot?.();
  if (!snapshot || !Number.isInteger(snapshot.ownerPid) || snapshot.ownerPid < 1) return null;
  return `${snapshot.ownerPid}:${snapshot.daemonPid ?? 0}:${snapshot.tunnelPid ?? 0}`;
}

function accountProofContextIsCurrent(context, stateStore, { requireCoreSetup = false } = {}) {
  const state = stateStore.read();
  const browser = browserHost.snapshot();
  return accountProofGeneration === context.generation
    && state.browserInteractionMode === context.mode
    && (!requireCoreSetup || state.coreSetupComplete === true)
    && currentRuntimeIdentity() === context.runtimeIdentity
    && setupIdentity(runtimeHost.runtimeConfigSnapshot().config, browser.accountLabel) === context.identity;
}

function invalidateAccountProof(stateStore) {
  retireAccountProof();
  const state = stateStore.update({
    mcpSetupComplete: false,
    browserSmokePassed: false,
    browserSmokeVersion: null,
    setupIdentityHash: null,
    setupVerifiedAt: null,
    setupRuntimeIdentity: null,
    pickerVerifiedAt: null,
  });
  send("launcher:state-changed", state);
  return state;
}

function ensureRuntimeProofCurrent(stateStore) {
  const state = stateStore.read();
  const config = runtimeHost.runtimeConfigSnapshot().config;
  const currentIdentity = setupIdentity(config, browserHost?.snapshot().accountLabel ?? null);
  // Account identity may still be loading; absence is not evidence of a changed setup.
  const identityChanged = currentIdentity !== null && state.setupIdentityHash !== currentIdentity;
  const connectorChanged = state.setupConnectorName != null && state.setupConnectorName !== config?.appName;
  if (state.mcpSetupComplete === true && (identityChanged || connectorChanged
    || (currentIdentity !== null && !setupProofCurrent(state, currentIdentity, config?.appName)))) {
    return invalidateAccountProof(stateStore);
  }
  return state;
}

function stopCatalogVerificationMonitor() {
  catalogVerificationEpoch += 1;
  if (catalogVerificationTimer) clearInterval(catalogVerificationTimer);
  catalogVerificationTimer = null;
}

function startCatalogVerificationMonitor({ logger, stateStore }) {
  stopCatalogVerificationMonitor();
  lifecycleProjection.update({ catalog: { status: "pending", request: null, at: null, failure: null } });
  const epoch = catalogVerificationEpoch;
  const supervisor = runtimeSupervisor;
  let inFlight = false;
  let reportedFailure = null;
  const check = async () => {
    if (epoch !== catalogVerificationEpoch || supervisor !== runtimeSupervisor) return;
    const current = stateStore.read();
    if (current.coreSetupComplete !== true || current.codexCatalogVerified === true) {
      stopCatalogVerificationMonitor();
      return;
    }
    if (inFlight || !supervisor) return;
    inFlight = true;
    try {
      const config = supervisor.readConfig();
      const configSnapshot = JSON.stringify(config);
      const health = await supervisor.proxyHealthPayload(config);
      if (epoch !== catalogVerificationEpoch || supervisor !== runtimeSupervisor) return;
      const latest = stateStore.read();
      if (latest.coreSetupComplete !== true || latest.codexCatalogVerified === true
        || typeof latest.pendingBiggerContext === "boolean"
        || JSON.stringify(supervisor.readConfig()) !== configSnapshot) return;
      if (supervisor.catalogHealthIsCurrent(config, health) !== true) return;
      const result = catalogReceipt(health.last_model_catalog_result);
      if (result?.status >= 400) {
        if (lastOperation?.status === "running") return;
        const identity = `${health.pid}:${result.request}:${result.at}`;
        if (identity === reportedFailure) return;
        reportedFailure = identity;
        // Receipt proves Codex reached this runtime; generic restart guidance must not mask failure.
        // A changed picker catalog still needs a restart: Codex reads it only at startup.
        const state = stateStore.update({ codexRestartRequired: codexPickerContract() !== null && latest.codexRestartRequired === true });
        send("launcher:state-changed", state);
        const reason = result.failure.code ? `${result.failure.stage}/${result.failure.code}` : result.failure.stage;
        logger.warn("codex.model_catalog_failed", result);
        lifecycleProjection.update({ catalog: { status: "failed", request: result.request, at: result.at,
          failure: result.failure } });
        publishOperation({
          name: "catalog-verification", status: "failed",
          message: nativeCopyFor(latest.language).catalogFailure
            .replace("{status}", String(result.status)).replace("{reason}", reason),
        });
        return;
      }
      if (!Number.isSafeInteger(health.successful_model_catalog_requests)
        || health.successful_model_catalog_requests < 1) return;
      // A malformed new-style receipt must not authorize success from a stale counter.
      if (health.last_model_catalog_result != null && (!result || result.status >= 300)) return;
      // A served catalog request does not show what the Codex picker loaded from its catalog file;
      // only confirming the picker clears a restart request while that file is in use.
      const state = stateStore.update({
        codexCatalogVerified: true,
        codexRestartRequired: codexPickerContract() !== null && latest.codexRestartRequired === true,
      });
      logger.info("codex.model_catalog_served", {
        requests: health.successful_model_catalog_requests,
        at: health.last_successful_model_catalog_request_at,
      });
      lifecycleProjection.update({ catalog: { status: "ready", request: result?.request ?? null,
        at: health.last_successful_model_catalog_request_at ?? result?.at ?? null, failure: null } });
      send("launcher:state-changed", state);
      if (lastOperation?.name === "catalog-verification" && lastOperation.status === "failed") {
        publishOperation({ name: "catalog-verification", status: "completed", message: "" });
      }
      stopCatalogVerificationMonitor();
    } catch (error) {
      if (epoch === catalogVerificationEpoch) {
        logger.debug("codex.model_catalog_verification_pending", {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      inFlight = false;
    }
  };
  catalogVerificationTimer = setInterval(() => { void check(); }, 2_000);
  catalogVerificationTimer.unref?.();
  void check();
}

async function restoreCodexRouteAfterRuntimeFailure({ logger, stateStore }) {
  // Starting the route operation is synchronous up to its first await. Quit
  // either observes that operation or owns shutdown before we can start it.
  if (shutdownInProgress || quitting || exitCommitted) return { restored: false, skipped: true };
  try {
    lifecycleProjection.update({ routeStatus: "restoring" });
    const route = await runtimeHost.restoreBridgeRoute("runtime-start-fail-safe");
    if (shutdownInProgress || quitting || exitCommitted) return { restored: false, skipped: true };
    if (!route.installed || route.active) {
      lifecycleProjection.update({ routeStatus: route.active ? "managed" : "direct" });
      return { restored: false };
    }
    const state = stateStore.update({
      codexCatalogVerified: false,
      codexRestartRequired: true,
    });
    send("launcher:state-changed", state);
    stopCatalogVerificationMonitor();
    logger.warn("bridge.route_restored_after_runtime_failure", {
      changed: route.changed === true,
    });
    lifecycleProjection.update({ routeStatus: "direct" });
    return { restored: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("bridge.route_restore_after_runtime_failure_failed", { message });
    lifecycleProjection.update({ routeStatus: "failed", detail: message });
    return { restored: false, error: message };
  }
}

function trayImage() {
  if (process.platform !== "darwin") {
    return nativeImage.createFromPath(APP_ICON_PATH).resize({ width: 18, height: 18 });
  }
  const image = nativeImage.createFromPath(path.join(__dirname, "..", "assets", "trayTemplate.png"));
  if (image.isEmpty()) throw new Error("The macOS menu-bar icon is missing or invalid");
  image.setTemplateImage(true);
  return image;
}

function updateApplicationMenu(language) {
  if (process.platform !== "darwin") return;
  Menu.setApplicationMenu(Menu.buildFromTemplate(applicationMenu({
    language,
    name: LAUNCHER_PROFILE.displayName,
    checkLabel: updateCheckLabelFor(language),
    quitLabel: nativeCopyFor(language).quit,
    stopLabel: nativeCopyFor(language).stopAndQuit,
    onStop: () => { void requestQuit({ stopRuntime: true }); },
    onReload: ignoreCache => {
      void reloadApplicationPage({
        focusedContents: webContents.getFocusedWebContents(),
        focusedWindow: BrowserWindow.getFocusedWindow(),
        mainWindow, browserPool: browserHost, ignoreCache,
        reloadShell: window => reloadOwnedRenderer(window),
      }).catch(error => {
        logger?.warn("browser.menu_reload_rejected", { message: error instanceof Error ? error.message : String(error) });
        const parent = BrowserWindow.getFocusedWindow();
        const options = { type: "info", message: language === "ru" ? "Сейчас нельзя обновить эту страницу" : "This page cannot be reloaded now",
          detail: error instanceof Error ? error.message : String(error) };
        void (parent && !parent.isDestroyed() ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options));
      });
    },
    onCheck: () => {
      updatesPanelRequestRevision += 1;
      showMainWindow({ activateApplication: true });
      send("launcher:open-updates");
    },
  })));
}

function updateTrayMenu(language) {
  updateApplicationMenu(language);
  if (!tray) return;
  const copy = nativeCopyFor(language);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: copy.openLauncher, click: () => showMainWindow({ activateApplication: true }) },
    { type: "separator" },
    { label: copy.quit, click: () => { void requestQuit(); } },
    { label: copy.stopAndQuit, click: () => { void requestQuit({ stopRuntime: true }); } },
  ]));
}

function createTray(logger, language) {
  try {
    tray = new Tray(trayImage());
    tray.setToolTip(LAUNCHER_PROFILE.displayName);
    updateTrayMenu(language);
    tray.on("click", () => showMainWindow({ activateApplication: true }));
    return true;
  } catch (error) {
    tray = null;
    logger.warn("launcher.tray_unavailable", { message: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

function showMainWindow({ activateApplication = false } = {}) {
  // A Windows login launch may still be materializing the packaged runtime when the user opens
  // the desktop shortcut. Electron delivers `second-instance` immediately, before `createWindow`
  // has produced anything to show. Preserve that foreground request until the real window reaches
  // `ready-to-show`; otherwise the already-running `--hidden` instance silently consumes it.
  mainWindowShowRequested = true;
  if (activateApplication) mainWindowActivationRequested = true;
  if (rendererUnavailable) {
    void promptRendererRecovery();
    return;
  }
  if (!mainWindowReadyToShow || !mainWindow || mainWindow.isDestroyed()) return;
  mainWindowShowRequested = false;
  const shouldActivateApplication = mainWindowActivationRequested;
  mainWindowActivationRequested = false;
  if (process.platform === "darwin" && shouldActivateApplication) app.focus({ steal: true });
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function openWebUrl(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`Refusing to open a non-web URL: ${parsed.protocol}`);
  }
  await shell.openExternal(parsed.toString());
}

function rendererNavigationAllowed(value) {
  let target;
  try {
    target = new URL(value);
  } catch {
    return false;
  }
  if (isDev) {
    try {
      return target.origin === new URL(process.env.VITE_DEV_SERVER_URL).origin;
    } catch {
      return false;
    }
  }
  target.hash = "";
  target.search = "";
  return target.href === PACKAGED_RENDERER_URL;
}

function windowStateSnapshot(window) {
  return {
    fullScreen: Boolean(window && !window.isDestroyed() && window.isFullScreen()),
    maximized: Boolean(window && !window.isDestroyed() && window.isMaximized()),
  };
}

// Launcher-owned surfaces paint bg-surface of the resolved launcher theme before the
// renderer draws. ChatGPT pages keep following the OS through nativeTheme "system".
const APP_THEME_COLORS = Object.freeze({
  dark: Object.freeze({ background: "#1b1b24", symbol: "#a8a8a8" }),
  light: Object.freeze({ background: "#f8f7fc", symbol: "#4a4860" }),
});
const TITLE_BAR_OVERLAY_HEIGHT = 52;

function resolvedAppTheme(state = launcherStateStore?.read()) {
  return resolveAppearance(state?.appearance, nativeTheme.shouldUseDarkColors);
}

function applyAppTheme(window = mainWindow, theme = resolvedAppTheme()) {
  if (!window || window.isDestroyed()) return;
  const colors = APP_THEME_COLORS[theme];
  window.setBackgroundColor(colors.background);
  if (process.platform === "darwin") return;
  try {
    window.setTitleBarOverlay({ color: colors.background, symbolColor: colors.symbol, height: TITLE_BAR_OVERLAY_HEIGHT });
  } catch {}
}

function createWindow({ logger, stateStore, windowStatePath, startHidden, foregroundOnReady }) {
  const isMac = process.platform === "darwin";
  const state = stateStore.read();
  const themeColors = APP_THEME_COLORS[resolvedAppTheme(state)];
  const windowState = readWindowState(windowStatePath, screen.getAllDisplays());
  const window = new BrowserWindow({
    width: windowState.bounds.width,
    height: windowState.bounds.height,
    ...(Number.isFinite(windowState.bounds.x) && Number.isFinite(windowState.bounds.y)
      ? { x: windowState.bounds.x, y: windowState.bounds.y }
      : {}),
    minWidth: MIN_WINDOW_BOUNDS.width,
    minHeight: MIN_WINDOW_BOUNDS.height,
    title: LAUNCHER_PROFILE.displayName,
    icon: APP_ICON_PATH,
    show: false,
    backgroundColor: themeColors.background,
    titleBarStyle: isMac ? "hiddenInset" : "hidden",
    transparent: false,
    ...(isMac ? {
      // The 14 pt buttons sit on the centre line of the 52 px titlebar (--size-titlebar).
      trafficLightPosition: { x: 16, y: 19 },
      visualEffectState: "active",
    } : {
      titleBarOverlay: {
        color: themeColors.background,
        symbolColor: themeColors.symbol,
        height: TITLE_BAR_OVERLAY_HEIGHT,
      },
    }),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      v8CacheOptions: "bypassHeatCheckAndEagerCompile",
    },
  });
  window.setMenuBarVisibility(false);
  const guardRendererNavigation = (event, url) => {
    if (rendererNavigationAllowed(url)) return;
    event.preventDefault();
    let destination = "invalid URL";
    try { destination = new URL(url).origin; } catch {}
    logger.warn("launcher.renderer_navigation_blocked", { destination });
  };
  window.webContents.on("will-navigate", guardRendererNavigation);
  window.webContents.on("will-redirect", guardRendererNavigation);
  bindRendererSurfaceInvalidation(window, () => mainWindow, () => browserHost);
  window.webContents.on("did-fail-load", (_event, errorCode, _errorDescription, _validatedURL, isMainFrame) => {
    if (isMainFrame !== true || errorCode === -3 || !rendererStartupComplete || quitting || exitCommitted) return;
    void recoverMainRenderer(`main-frame-load-${errorCode}`);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    if (!rendererStartupComplete || quitting || exitCommitted) return;
    logger.error("launcher.renderer_gone", { reason: details?.reason || "gone", exitCode: details?.exitCode });
    void recoverMainRenderer(`renderer-${details?.reason || "gone"}`);
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    void openWebUrl(url).catch((error) => {
      logger.warn("launcher.external_url_rejected", {
        message: error instanceof Error ? error.message : String(error),
      });
    });
    return { action: "deny" };
  });
  window.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    if (stateStore.read().keepRunningOnClose) {
      if (tray) window.hide();
      else window.minimize();
    } else void requestQuit();
  });
  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
      mainWindowReadyToShow = false;
      if (!quitting && !exitCommitted && rendererStartupComplete) {
        rendererUnavailable = true;
        void promptRendererRecovery();
      }
    }
  });
  for (const event of ["enter-full-screen", "leave-full-screen", "maximize", "unmaximize"]) {
    window.on(event, () => send("launcher:window-state-changed", windowStateSnapshot(window)));
  }
  window.once("ready-to-show", () => {
    if (!state.onboardingComplete && !Number.isFinite(windowState.bounds.x)) window.center();
    if (windowState.maximized) window.maximize();
    if (windowState.fullscreen) window.setFullScreen(true);
    if (mainWindow === window) mainWindowReadyToShow = true;
    if (foregroundOnReady) mainWindowActivationRequested = true;
    if (mainWindowShowRequested || foregroundOnReady) showMainWindow();
    else if (!startHidden) window.show();
  });
  trackWindowState(window, windowStatePath, (error) => {
    logger.warn("launcher.window_state_write_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
  });
  logger.info("launcher.window_created", { platform: process.platform, cdpPort });
  return window;
}

// The renderer paints its first frame in the theme the window background already has (?theme=), until it
// remembers the appearance it applied itself (renderer theme-boot.ts). The query is not part of the trusted URL.
async function loadRenderer(window) {
  const theme = resolvedAppTheme();
  if (isDev) {
    const url = new URL(process.env.VITE_DEV_SERVER_URL);
    url.searchParams.set("theme", theme);
    await window.loadURL(url.href);
    return;
  }
  await window.loadFile(path.join(__dirname, "..", "dist", "index.html"), { query: { theme } });
}

function reloadOwnedRenderer(window) {
  const contents = window.webContents;
  if (!rendererNavigationAllowed(contents.getURL())) {
    return Promise.reject(new Error("The failed renderer has no trusted reload destination"));
  }
  return new Promise((resolve, reject) => {
    const finish = error => {
      clearTimeout(timer);
      contents.off("did-finish-load", loaded);
      contents.off("did-fail-load", failed);
      contents.off("destroyed", destroyed);
      if (error) reject(error); else resolve();
    };
    const loaded = () => {
      try {
        const frame = contents.mainFrame;
        if (!frame || frame.isDestroyed() || frame.detached !== false || !rendererNavigationAllowed(frame.url)) {
          throw new Error("Reloaded renderer has not acquired a live trusted frame");
        }
        finish();
      } catch (error) { finish(error); }
    };
    const failed = (_event, code, _description, _url, isMainFrame) => {
      if (isMainFrame && code !== -3) finish(new Error(`Renderer reload failed (${code})`));
    };
    const destroyed = () => finish(new Error("Renderer closed during recovery"));
    const timer = setTimeout(() => finish(new Error("Renderer reload timed out")), 10_000);
    contents.once("did-finish-load", loaded);
    contents.on("did-fail-load", failed);
    contents.once("destroyed", destroyed);
    // Electron documents reload() as the process-replacement path after a crash.
    // Navigating the same file with loadFile() can retain a detached frame wrapper.
    try { contents.reload(); } catch (error) { finish(error); }
  });
}

function rendererRecoveryCopy() {
  return rendererRecoveryCopyFor(launcherStateStore?.read().language);
}

function rendererRestartBlocked() {
  return Boolean(lifecycleAdmission.busy() || currentGlobalOperation() || browserHost?.hasActiveTurns());
}

function rendererWindowReplacementBlocked() {
  // Native account/setup dialogs belong to the existing window. Tool turns belong
  // to their WebContentsViews and can continue while only the shell is replaced.
  return Boolean(lifecycleAdmission.busy() || currentGlobalOperation());
}

async function replaceOwnedRendererWindow() {
  const previous = mainWindow;
  if (!previous || previous.isDestroyed() || rendererWindowReplacementBlocked()) {
    throw new Error("The interface cannot be replaced during an owned window operation");
  }
  const visible = previous.isVisible();
  const replacement = createWindow({ logger, stateStore: launcherStateStore,
    windowStatePath: path.join(app.getPath("userData"), "window-state.json"),
    startHidden: !visible, foregroundOnReady: visible });
  let attached = false;
  try {
    browserHost?.replaceShellWindow(replacement);
    attached = true;
    mainWindow = replacement;
    mainWindowReadyToShow = false;
    // IPC still requires the new window's live frame and exact trusted renderer URL.
    // Allow its startup snapshot; no old frame becomes trusted through this flag.
    rendererUnavailable = false;
    let timeout;
    try {
      await Promise.race([loadRenderer(replacement), new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Replacement interface load timed out")), 10_000);
      })]);
    } finally { clearTimeout(timeout); }
    const frame = replacement.webContents.mainFrame;
    if (!frame || frame.isDestroyed() || frame.detached !== false || !rendererNavigationAllowed(frame.url)) {
      throw new Error("Replacement interface did not acquire a live trusted frame");
    }
    previous.destroy();
  } catch (error) {
    rendererUnavailable = true;
    mainWindow = previous;
    mainWindowReadyToShow = false;
    if (attached) browserHost?.replaceShellWindow(previous);
    replacement.destroy();
    throw error;
  }
}

async function promptRendererRecovery() {
  if (!rendererUnavailable || rendererRecoveryInFlight || rendererRecoveryDialogInFlight
    || quitting || exitCommitted) return;
  rendererRecoveryDialogInFlight = true;
  try {
    if (mainWindowActivationRequested) {
      mainWindowActivationRequested = false;
      if (process.platform === "darwin") app.focus({ steal: true });
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    }
    const copy = rendererRecoveryCopy();
    const blocked = rendererRestartBlocked();
    const options = {
      type: "error",
      title: copy.title,
      message: copy.message,
      detail: blocked ? copy.active : copy.idle,
      buttons: rendererWindowReplacementBlocked() ? [copy.keep]
        : blocked ? [copy.keep, copy.recover] : [copy.keep, copy.recover, copy.restart],
      defaultId: rendererWindowReplacementBlocked() ? 0 : 1,
      cancelId: 0,
      noLink: true,
    };
    const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    const result = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
    if (result.response === 1 && !rendererWindowReplacementBlocked()) {
      rendererReloadAttempted = false;
      await recoverMainRenderer("renderer-user-recovery");
      return;
    }
    if (result.response !== 2) return;
    if (rendererRestartBlocked()) {
      await dialog.showMessageBox({ ...options, buttons: [copy.keep], defaultId: 0, detail: copy.active });
      return;
    }
    const restart = await requestQuit({ restart: true });
    if (!restart.ok) dialog.showErrorBox(copy.retryFailed, restart.message || copy.active);
  } catch (error) {
    logger?.error("launcher.renderer_recovery_dialog_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    rendererRecoveryDialogInFlight = false;
  }
}

async function recoverMainRenderer(reason) {
  if (!rendererStartupComplete || quitting || exitCommitted) return;
  if (rendererRecoveryInFlight) {
    rendererRecoveryFollowup = reason;
    return;
  }
  rendererRecoveryInFlight = true;
  rendererUnavailable = true;
  const wasVisible = Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible());
  let recovered = false;
  try {
    logger?.warn("launcher.renderer_recovery_started", { reason, reloadAttempted: rendererReloadAttempted });
    if (!rendererReloadAttempted && mainWindow && !mainWindow.isDestroyed()) {
      rendererReloadAttempted = true;
      if (reason.startsWith("renderer-")) await replaceOwnedRendererWindow();
      else await reloadOwnedRenderer(mainWindow);
      if (!quitting && !exitCommitted && mainWindow && !mainWindow.isDestroyed()) {
        rendererUnavailable = false;
        recovered = true;
        logger?.info("launcher.renderer_recovery_completed", { reason });
        if (mainWindowShowRequested) showMainWindow();
        else if (wasVisible) mainWindow.show();
      }
    }
  } catch (error) {
    logger?.error("launcher.renderer_recovery_failed", {
      reason,
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    rendererRecoveryInFlight = false;
  }
  if (rendererRecoveryFollowup) {
    const followup = rendererRecoveryFollowup;
    rendererRecoveryFollowup = null;
    rendererUnavailable = true;
    logger?.error("launcher.renderer_recovery_recurred", { reason: followup });
    void promptRendererRecovery();
    return;
  }
  if (!recovered) void promptRendererRecovery();
}

function validateLanguage(value) {
  if (typeof value !== "string" || !Object.hasOwn(LANGUAGES, value)) {
    throw new Error("Language must be en, zh-CN, zh-TW, ja, ko, or ru");
  }
  return value;
}

function validateBrowserInteractionMode(value) {
  if (value !== "automatic" && value !== "manual") {
    throw new Error("Browser interaction mode must be automatic or manual");
  }
  return value;
}

function validateProModelVersion(value) {
  if (value !== null && value !== "5.6" && value !== "5.5" && value !== "6") {
    throw new Error("Pro model version must be follow, 5.6, 5.5, or 6");
  }
  return value;
}

function validateBounds(value) {
  if (!value || typeof value !== "object") throw new Error("Browser bounds are required");
  for (const key of ["x", "y", "width", "height"]) {
    if (!Number.isFinite(value[key])) throw new Error(`Browser bounds ${key} must be finite`);
  }
  return value;
}

function smokePassedForCurrentVersion(state) {
  return state.browserSmokePassed === true && state.browserSmokeVersion === app.getVersion();
}

async function closeBrowserResources() {
  let cleanupError = null;
  try { invalidateAgentSourceOwners(); } catch (error) { cleanupError = error; }
  // Stop official account flows while their bound browser sessions still exist.
  for (const [name, participant] of additionalLifecycleParticipants) {
    try { await participant.destroy(); }
    catch (error) {
      const detail = `${name} cleanup failed: ${error instanceof Error ? error.message : String(error)}`;
      cleanupError = new Error(cleanupError ? `${cleanupError.message}; ${detail}` : detail);
    }
  }
  try {
    browserHost?.destroy();
  } catch (error) {
    cleanupError = cleanupError ? new Error(`${cleanupError.message}; browser cleanup failed`) : error;
  }
  try {
    await browserControl?.close();
  } catch (error) {
    cleanupError = cleanupError
      ? new Error(`${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}; browser control close failed: ${error instanceof Error ? error.message : String(error)}`)
      : error;
  }
  if (cleanupError) throw cleanupError;
}

function registerIpc({ logger, stateStore }) {
  const authorize = createRendererIpcGuard({
    getMainWindow: () => mainWindow,
    isRendererUrlAllowed: rendererNavigationAllowed,
  });
  const handle = (channel, handler) => registerLoggedIpc(
    ipcMain, logger, channel, lifecycleAdmission.guard(channel, handler), authorize,
  );
  // Exact privacy revocation remains sender-authorized while another lifecycle
  // action is pending. The registrar still validates the complete request.
  const privacyHandle = (channel, handler, isPrivacyRequest) => registerLoggedIpc(
    ipcMain, logger, channel, (event, body) => isPrivacyRequest(body)
      ? handler(event, body) : lifecycleAdmission.guard(channel, handler)(event, body), authorize,
  );
  handle('launcher:task-plan-policy', async () => taskPlans.status());
  handle('launcher:task-plan-capture', async (_event, enabled, revision) => taskPlans.setEnabled(enabled, revision));
  handle('launcher:task-plan-read', async (_event, accountId, taskId) => taskPlans.get({ accountId, taskId }));
  handle('launcher:task-plan-delete', async (_event, accountId, taskId) => taskPlans.delete({ accountId, taskId }));
  handle('launcher:task-requirements-read', async (_event, accountId, taskId) => taskPlans.requirements({ accountId, taskId }));
  handle('launcher:task-requirements-save', async (_event, input) => taskPlans.saveRequirements(input));
  handle('launcher:task-requirements-coverage', async (_event, input) => taskPlans.updateCoverage(input));
  handle('launcher:task-requirements-delete', async (_event, accountId, taskId, expectedRevision) => taskPlans.deleteRequirements({ accountId, taskId, expectedRevision }));
  localWorkspaceService ??= createLocalWorkspaceService({
    registryPath: path.join(app.getPath('userData'), 'workspace-private', 'registry.json'),
    agentWorkspaceGrantKeyPath: path.join(CORE_HOME, 'agent-workspace', 'grant-key'),
    resolveManagedWorktree: (sourceRootId, worktreeId) => workspaceGitService.resolveManagedRoot(sourceRootId, worktreeId),
    pickDirectory: async () => {
      const chosen = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
      return chosen.canceled ? null : chosen.filePaths[0] || null;
    },
  });
  workspaceTerminalService ??= createWorkspaceTerminalService();
  workspaceGitService ??= createWorkspaceGitService({
    resolveWorkspace: id => localWorkspaceService.resolveGrant(id),
    getDraftPaths: id => localWorkspaceService.listDrafts(id).map(draft => draft.path),
    storagePath: path.join(app.getPath('userData'), 'workspace-git'),
    canArchiveWorktree: (sourceRootId, worktreeId) => !localWorkspaceService.hasManagedRootGrant(sourceRootId, worktreeId),
  });
  registerLifecycleParticipant('workspace-git', {
    currentOperation: () => workspaceGitService.currentOperation(),
    destroy: () => workspaceGitService.destroy(),
  });
  registerWorkspaceGitIpc({ registerIpcHandler: handle, service: workspaceGitService });
  registerWorkspaceIpc({ registerIpcHandler: handle, service: localWorkspaceService, manageRoot: async directory => {
    const failure = await shell.openPath(directory);
    if (failure) throw new Error(failure);
  }, beforeForget: id => {
    loopFileWatcher?.beforeForget(id);
    if (workspaceVmExportService?.hasRetainedState(id)) throw new Error('Keep this workspace registered until its exact VM export outcome is reconciled');
    if (workspaceGitService.hasRetainedState(id)) throw new Error('Keep this folder registered to access its worktrees, archives and snapshots');
    if (workspaceTerminalService.list(id).some(row => ['running', 'closing'].includes(row.state))) throw new Error('Close this folder’s terminal sessions before forgetting it');
  } });
  registerWorkspaceTerminalIpc({ registerIpcHandler: handle, service: workspaceTerminalService,
    resolveGrant: id => localWorkspaceService.resolveGrant(id) });
  registerLifecycleParticipant('workspace-terminal', {
    currentOperation: () => workspaceTerminalService.currentOperation?.() ?? null,
    destroy: async () => { await workspaceTerminalService.destroy(); },
  });
  const getNativeClient = () => {
    nativeClientControl ??= createCodexClientControl({
      executable: resolveCodexExecutable({ environment: process.env }),
      codexHome: LAUNCHER_PROFILE.codexHome,
      cwd: LAUNCHER_PROFILE.codexHome,
      journalPath: path.join(CORE_HOME, 'native-thread-control', 'forks.json'),
    });
    return nativeClientControl;
  };
  // Separate owned process per explicit handoff; never the metadata connection or a shared daemon.
  const getNativeHandoff = () => {
    nativeThreadHandoff ??= createCodexThreadHandoff({
      executable: resolveCodexExecutable({ environment: process.env }),
      codexHome: LAUNCHER_PROFILE.codexHome,
      cwd: LAUNCHER_PROFILE.codexHome,
      journalPath: path.join(CORE_HOME, 'native-thread-control', 'handoffs.json'),
    });
    return nativeThreadHandoff;
  };
  const canonicalRecorder = createCanonicalNativeHistoryRecorder({
    sourceId: createHash('sha256').update(JSON.stringify({
      kind: 'native-codex', profile: LAUNCHER_PROFILE.codexHome, transport: 'owned-stdio-server',
    })).digest('hex'),
    getClient: getNativeClient,
    requestHistory: async body => {
      const supervisor = runtimeHost.supervisor;
      const config = supervisor.readConfig();
      const allowDraining = body.action === 'canonical-status' || body.action === 'canonical-consent' && body.enabled === false;
      if (!config || !await supervisor.ownedAgentRuntimeReady(config, { allowDraining })) throw new Error('Start the current NEKODEX runtime to record selected native history');
      const receipt = await supervisor.control(config, 'conversation-history', { body });
      if (!receipt || receipt.ok !== true) throw new Error('Selected native history operation failed');
      return receipt.value;
    },
  });
  registerConversationHistory({ handle, runtimeHost, clipboard, dialog, canonicalRecorder,
    getApplicationVersion: () => app.getVersion(), beforeRecordingRevoke: revokeOwnedConversationRecording,
    beforeRecordingConsent: beginOwnedConversationRecordingConsent,
    afterRecordingConsent: allowOwnedConversationRecording, projectRecordingStatus: projectOwnedConversationRecordingStatus });
  remoteWorkspaceService ??= createRemoteWorkspaceService({ storagePath: path.join(CORE_HOME, 'remote-workspaces', 'registry.json'),
    agentInstanceId: agentRemoteDescriptor?.instanceId,
    validateAgentTask: scope => validateRemoteCoreAuthority('validate-task', { scope }),
    validateAgentIntent: request => validateRemoteCoreAuthority('validate-intent', { request }),
  });
  registerRemoteWorkspaceIpc({ registerIpcHandler: handle, service: remoteWorkspaceService });
  registerLifecycleParticipant('remote-workspaces', {
    currentOperation: () => remoteWorkspaceService.currentOperation?.() ?? null,
    destroy: async () => { await remoteWorkspaceService.destroy(); },
  });
  workspaceEvidenceService ??= createAgentWorkspaceEvidenceAuthority({
    keyPath: path.join(CORE_HOME, 'agent-workspace', 'grant-key'),
    resolveWorkspace: id => localWorkspaceService.resolveGrant(id),
  });
  loopFileWatcher ??= createLoopFileWatcherIntegration({
    directory: path.join(CORE_HOME, 'loop-file-sources'), workspaceService: localWorkspaceService, runtimeHost,
    getApplicationVersion: () => app.getVersion(),
    canRequest: () => !quitting && !shutdownInProgress && !exitCommitted && !lifecycleAdmission.busy(),
  });
  loopFileWatcher.register({ privacyHandle, dialog, getWindow: () => mainWindow });
  registerLifecycleParticipant('loop-file-sources', {
    currentOperation: () => loopFileWatcher.currentOperation(), destroy: () => loopFileWatcher.close(),
  });
  registerAgentMode({ handle, runtimeHost, workspaceService: localWorkspaceService, workspaceEvidenceService,
    beforeTaskAuthorityChange: body => loopFileWatcher.beforeTaskAuthorityChange(body),
    getApplicationVersion: () => app.getVersion() });
  loopProducerController = registerAgentLoopProducers({
    handle: (channel, handler) => privacyHandle(channel, handler, body => body?.action === 'revoke'),
    runtimeHost, clipboard, getApplicationVersion: () => app.getVersion(),
  });
  registerLifecycleParticipant('agent-loop-producers', {
    currentOperation: () => loopProducerController?.currentOperation() ?? null,
    destroy: () => loopProducerController?.close(),
  });
  workspaceVmExportService ??= createWorkspaceVmExportService({ home: path.join(app.getPath('userData'), 'workspace-vm-export'), workspaceService: localWorkspaceService,
    protectedRoots: [CORE_HOME, app.getPath('userData'), process.env.CODEX_CHATGPT_WEB_HOME || path.join(os.homedir(), '.codex-chatgpt-web'), path.join(os.homedir(), '.nekodex-execution-vm'),
      process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), ...['.ssh', '.aws', '.config', 'Library/Keychains', 'Library/Application Support/Google/Chrome'].map(name => path.join(os.homedir(), name))],
    validateScope: scope => vmCoreControl('validate-task', { scope }),
    validateIntent: async request => { await vmCoreControl('validate-intent', { request }); },
    readCandidate: async input => {
      const value = await vmCoreControl('candidate', { scope: { taskId: input.scope.taskId, generation: input.scope.generation }, operationId: input.operationId, path: input.path, sha256: input.sha256 });
      if (!value || value.sha256 !== input.sha256 || !Number.isSafeInteger(value.size) || value.size < 0 || value.size > 16 * 1024 * 1024
        || typeof value.dataBase64 !== 'string' || value.dataBase64.length !== 4 * Math.ceil(value.size / 3)) throw new Error('VM export candidate is invalid');
      const bytes = Buffer.from(value.dataBase64, 'base64');
      if (bytes.length !== value.size || bytes.toString('base64') !== value.dataBase64 || require('node:crypto').createHash('sha256').update(bytes).digest('hex') !== input.sha256) throw new Error('VM export candidate identity changed');
      return bytes;
    } });
  registerLifecycleParticipant('workspace-vm-export', { currentOperation: () => workspaceVmExportService.currentOperation(), destroy: () => workspaceVmExportService.destroy() });
  pythonBuildSelectionService ??= createPythonBuildSelectionService({
    assertScope: scope => vmCoreControl('validate-task', { scope: { taskId: scope.taskId, generation: scope.generation } }),
  });
  registerLifecycleParticipant('python-build-selections', {
    currentOperation: () => null,
    destroy: () => pythonBuildSelectionService.close(),
  });
  agentOAuthService ??= createAgentOAuthService({
    coreHome: CORE_HOME,
    getAuthority: () => {
      const current = nativeAccountExecution?.inspect();
      if (!current?.profileId || !current.epoch || current.failed || !current.server?.ready) return null;
      return { accountId: `native:${current.profileId}`, epoch: current.epoch };
    },
    protectedAvailable: () => oauthProtectedVaultAvailable(),
    openExternal: url => shell.openExternal(url),
  });
  const oauthIpc = createAgentOAuthIpc({ service: agentOAuthService, handle, dialog, getWindow: () => mainWindow });
  agentOAuthMcpController ??= createAgentOAuthMcpController({ coreHome: CORE_HOME, oauthService: agentOAuthService,
    validateTask: scope => oauthMcpCoreControl('validate-task', { scope }),
    validateIntent: request => oauthMcpCoreControl('validate-intent', { request }),
  });
  privacyHandle('launcher:oauth-mcp', (_event, body) => agentOAuthMcpController.request(body),
    body => body?.action === 'oauthMcpDisconnect');
  registerLifecycleParticipant('agent-oauth-mcp', {
    currentOperation: () => agentOAuthMcpController.currentOperation(), destroy: () => agentOAuthMcpController.close(),
  });
  registerLifecycleParticipant('agent-oauth', {
    currentOperation: () => agentOAuthService.currentOperation(),
    destroy: () => agentOAuthService.close(),
  });
  registerAgentTools({ handle, runtimeHost, dialog, getWindow: () => mainWindow, remoteService: remoteWorkspaceService,
    workspaceService: localWorkspaceService, vmExportService: workspaceVmExportService, pythonBuildSelectionService, oauthIpc,
    getApplicationVersion: () => app.getVersion() });
  registerBrowserCompanion({ handle, runtimeHost, clipboard });
  registerLocalControlApi({ handle, runtimeHost, clipboard });
  externalUsageService ??= createExternalUsageService({
    statePath: path.join(CORE_HOME, 'external-usage', 'state.json'),
    pickDirectory: async () => {
      const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
      return result.canceled ? null : result.filePaths[0] ?? null;
    },
  });
  registerExternalUsageIpc({ handle, service: externalUsageService });
  registerCodexClientControlIpc({ handle, getClient: getNativeClient, getHandoff: getNativeHandoff });
  registerLifecycleParticipant('native-thread-control', {
    currentOperation: () => nativeThreadHandoff?.currentOperation?.() ?? nativeClientControl?.currentOperation?.() ?? null,
    destroy: async () => { await Promise.all([nativeThreadHandoff?.destroy(), nativeClientControl?.destroy()]); },
  });
  registerLifecycleParticipant('agent-native', {
    currentOperation: () => persistentNativeConversations?.currentOperation()
      || nativeAccountExecution?.currentOperation()
      || (agentNativeBridge?.status().activeCount ? 'Native Agent inference' : null),
    destroy: async () => { await closeNativeConversationOwners(); await agentNativeBridge?.destroy(); },
  });
  const getNativeAccountAuthority = () => {
    if (nativeAccountAuthority) return nativeAccountAuthority;
    try {
      const target = { arm64: 'aarch64-apple-darwin', x64: 'x86_64-apple-darwin' }[process.arch];
      if (process.platform !== 'darwin' || !target) throw new Error('Unsupported Native login platform');
      // Use the already installed official, version-specific standalone package.
      // A current/Desktop resolver could silently select a different protocol version.
      const root = fs.realpathSync(path.join(app.getPath('home'), '.codex', 'packages', 'standalone', 'releases', `${NATIVE_CLI_VERSION}-${target}`));
      const metadata = JSON.parse(nativeRegular(path.join(root, 'codex-package.json'), 16384));
      if (metadata.version !== NATIVE_CLI_VERSION || metadata.target !== target || metadata.variant !== 'codex'
        || metadata.layoutVersion !== 1 || metadata.entrypoint !== 'bin/codex') throw new Error('Native CLI package changed');
      const executable = fs.realpathSync(path.join(root, 'bin', 'codex'));
      nativeAccountAuthority = createNativeAccountAuthority({ authorityHome: path.join(CORE_HOME, 'native-accounts'),
        executable, executableSha256: nativeFileDigest(executable),
        recovery: {
          executionRoot: path.join(CORE_HOME, 'native-account-execution'),
          inventoryRoot: path.join(CORE_HOME, 'native-account-inventories'),
          getWorkerPin: async () => reviewedNativeWorkerPin(),
          getMetadataRuntimePin: async () => {
            // Resolve the already owned runtime without running its CLI or searching PATH.
            const invocation = runtimeHost.supervisor.runtimeCommand(['--version']);
            if (!path.isAbsolute(invocation.executable)) throw new Error('Native recovery requires the pinned owned runtime');
            const bunPath = fs.realpathSync(invocation.executable);
            if (!/^bun(?:\.exe)?$/.test(path.basename(bunPath))) throw new Error('Native recovery runtime is unavailable');
            return { bunPath, bunSha256: nativeFileDigest(bunPath) };
          },
        } });
      return nativeAccountAuthority;
    } catch {
      const unavailable = () => { throw new Error('The admitted official Native CLI is unavailable'); };
      return { inspect: () => ({ available: false, reasonCode: 'admitted_cli_unavailable', profiles: [], receipts: [], activeCount: 0, executionAvailable: false }),
        prepareProfile: unavailable, beginDeviceLogin: unavailable, cancelLogin: unavailable };
    }
  };
  const getNativeAccountInventory = () => {
    const authority = getNativeAccountAuthority();
    nativeAccountInventory ??= createNativeAccountInventoryService({ authority,
      getWrapperPin: reviewedNativeWorkerPin,
      acquireProfileOwner: input => authority.acquireProfileOwner(input),
      storageRoot: path.join(CORE_HOME, 'native-account-inventories') });
    return nativeAccountInventory;
  };
  const getNativeAccountExecution = () => {
    const authority = getNativeAccountAuthority();
    nativeAccountExecution ??= createNativeAccountExecutionService({ authority, inventory: getNativeAccountInventory(),
      getWrapperPin: reviewedNativeWorkerPin,
      storageRoot: path.join(CORE_HOME, 'native-account-execution'), maxConcurrentThreads: 2,
      onChange: publishNativeAccountModels });
    return nativeAccountExecution;
  };
  registerNativeAccounts({ handle, withOwnerRecovery: async operation => {
    let owner, entered = false;
    try {
      const current = currentGlobalOperation();
      if (current || browserHost?.hasActiveTurns()) throw new Error(`Finish ${current || 'active Web tasks'} before Native recovery`);
      // Preserve an existing browser admission owner rather than reopening its pause.
      browserHost?.assertTurnAdmission();
      owner = lifecycleAdmission.acquire('Native recovery and tool connection pause');
      browserHost?.closeTurnAdmission('Native recovery');
      lifecycleAdmission.assertOwner(owner);
      await browserHost?.cancelReadOnlyInspections();
      const competing = currentGlobalOperation();
      if (competing || browserHost?.hasActiveTurns()) throw new Error(`Finish ${competing || 'active Web tasks'} before Native recovery`);
      return await runtimeSupervisor.withNativeRecoveryQuiescence(() => { entered = true; return operation(); });
    } catch (error) {
      // Only failures before the unchanged authority callback are known not started.
      if (!entered) error.actionRecorded = false;
      throw error;
    } finally {
      if (owner) { lifecycleAdmission.release(owner); browserHost?.openTurnAdmission(); }
    }
  }, getAuthority: getNativeAccountAuthority, getInventory: getNativeAccountInventory,
    getExecution: getNativeAccountExecution,
    beforeExecutionClosed: execution => closeNativeConversationOwners(execution),
    onExecutionClosed: execution => { if (nativeAccountExecution === execution) nativeAccountExecution = null; publishNativeAccountModels(); },
    // OAuth registrations are keyed by the Native account; retire them before the profile is erased.
    beforeProfileRemoved: ({ profileId }) => agentOAuthService?.retireAccount(`native:${profileId}`),
    openExternal: url => shell.openExternal(url), clipboard });
  registerPersistentNativeConversations({ handle,
    getContext: () => nativeAccountExecution?.persistentContext() ?? null,
    getService: () => {
      persistentNativeConversations ??= createPersistentNativeConversations({
        getExecution: () => nativeAccountExecution?.persistentContext() ?? null,
        storageRoot: path.join(CORE_HOME, 'native-conversations'),
        transcript: getOwnedConversationTranscript(), onChange: publishOwnedConversationScopes,
      });
      return persistentNativeConversations;
    },
  });
  registerLifecycleParticipant('owned-conversation-transcript', {
    currentOperation: () => ownedConversationTranscript?.currentOperation() ?? null,
    destroy: async () => {
      ownedConversationDescriptor?.publish({ scopes: [], accepting: false });
      await ownedConversationTranscript?.close();
    },
  });
  registerLifecycleParticipant('native-account-inventory', {
    currentOperation: () => nativeAccountInventory?.currentOperation() ?? null,
    destroy: async () => { await nativeAccountInventory?.destroy(); },
  });
  registerLifecycleParticipant('native-account-login', {
    currentOperation: () => nativeAccountAuthority?.currentOperation() ?? null,
    destroy: async () => { await nativeAccountAuthority?.destroy(); },
  });
  const syncConversationState = owner => {
    if (owner) lifecycleAdmission.assertOwner(owner);
    return syncConversationPreferences({
      stateStore,
      config: runtimeHost.runtimeConfigSnapshot().config,
      browserHost,
      busy: (!owner && lifecycleAdmission.busy()) || Boolean(runtimeHost.currentOperation()),
      publish: state => send("launcher:state-changed", state),
    });
  };
  const changeConversationState = (label, change) => {
    if (shutdownInProgress || quitting || exitCommitted) throw new Error("NEKODEX is shutting down");
    return changeConversationPreference({ lifecycleAdmission, browserHost, runtimeHost, label, change,
      sync: syncConversationState, shouldReopen: () => !exitCommitted });
  };
  const assertBrowserIdleFor = subject => {
    const browserOperation = browserHost.currentOperation();
    if (browserHost.activeTraceId || browserOperation) {
      throw new Error(
        browserHost.activeTraceId
          ? `Finish or cancel active ChatGPT turns before changing ${subject}`
          : `Finish ${browserOperation} before changing ${subject}`,
      );
    }
  };
  const mcpSetupProofPatch = () => ({ mcpSetupComplete: true, setupContract: SETUP_CONTRACT, setupVerifiedAt: new Date().toISOString(),
    setupIdentityHash: setupIdentity(runtimeHost.runtimeConfigSnapshot().config, browserHost.snapshot().accountLabel),
    setupRuntimeIdentity: currentRuntimeIdentity(), setupConnectorName: runtimeHost.mcpConnectorName() });
  handle("launcher:snapshot", async () => ({
    profile: LAUNCHER_PROFILE.kind,
    profilePaths: {
      coreHome: CORE_HOME,
      codexHome: LAUNCHER_PROFILE.codexHome,
      userData: launcherUserData,
    },
    state: (() => {
      if (lifecycleAdmission.busy()) return stateStore.read();
      syncConversationState();
      return ensureRuntimeProofCurrent(stateStore);
    })(),
    proModelVersion: runtimeHost.proModelVersion(),
    compactionModel: runtimeHost.compactionModel(),
    browserCapacity: browserCapacitySnapshot(),
    contextCapabilities: (() => {
      const config = runtimeHost.runtimeConfigSnapshot().config;
      return config ? { solAvailable: config.solAvailable === true, proAvailable: config.proAvailable === true,
        ...(typeof config.extraHighAvailable === "boolean" ? { extraHighAvailable: config.extraHighAvailable } : {}) } : null;
    })(),
    browser: browserHost?.snapshot() ?? null,
    connectorName: runtimeHost.browserConnectorName(),
    connectorNames: {
      automatic: runtimeHost.setupConnectorName(),
      manual: MANUAL_CONNECTOR_NAME,
    },
    recommendedConnectorNames: {
      automatic: automaticConnectorName({ development: IS_DEV_PROFILE, asyncToolOperations: true }),
      manual: MANUAL_CONNECTOR_NAME,
    },
    mcpCredentialsConfigured: runtimeHost?.mcpCredentialsConfigured(undefined, browserHost?.registry.snapshot().selectedId) ?? false,
    logs: logger.recent(),
    urls: { github: GITHUB_URL, x: X_URL, connectors: CONNECTORS_URL, developerMode: DEVELOPER_MODE_URL, tunnels: TUNNELS_URL, keys: KEYS_URL },
    platform: process.platform,
    packaged: app.isPackaged,
    version: app.getVersion(),
    smokePassed: smokePassedForCurrentVersion(stateStore.read()),
    operation: lastOperation,
    lifecycle: lifecycleProjection.snapshot(),
    runtimeStatus: runtimeSupervisor?.capabilitySnapshot?.().runtimeStatus ?? lifecycleProjection.snapshot().runtimeStatus,
    runtimeCapabilities: runtimeSupervisor?.capabilitySnapshot?.() ?? null,
    update: updateController?.getState() ?? { status: "disabled" },
  }));

  handle("launcher:set-language", (_event, language) => {
    const state = stateStore.update({ language: validateLanguage(language) });
    updateTrayMenu(state.language);
    return state;
  });
  handle("launcher:open-social", async (_event, target) => {
    const url = target === "github" ? GITHUB_URL : target === "x" ? X_URL : null;
    if (!url) throw new Error("Unknown social target");
    await openWebUrl(url);
    const patch = target === "github" ? { githubOpened: true } : { xOpened: true };
    return stateStore.update(patch);
  });
  handle("launcher:complete-onboarding", (_event, language, rawInteractionMode) => {
    const current = stateStore.read();
    if (current.autoStart) setAutostart(app, true);
    const next = stateStore.update({
      language: validateLanguage(language),
      browserInteractionMode: validateBrowserInteractionMode(rawInteractionMode),
      onboardingComplete: true,
    });
    updateTrayMenu(next.language);
    logger.info("launcher.onboarding_completed", {
      language: next.language,
      browserInteractionMode: next.browserInteractionMode,
    });
    return next;
  });

  handle("launcher:open-external", async (_event, url) => {
    if (!ALLOWED_EXTERNAL_URLS.has(url)) throw new Error("External URL is not allowlisted");
    await openWebUrl(url);
    return true;
  });

  registerBrowserHandlers({
    handle, getBrowserHost: () => browserHost, getRuntimeHost: () => runtimeHost,
    stateStore, validateBounds, send, platform: process.platform,
    invalidateAccountProof: () => invalidateAccountProof(stateStore),
    confirmExistingChromeImport: () => confirmExistingChromeImport(dialog, mainWindow, stateStore.read().language),
    selectChromeConnectionFile: signal => selectChromeConnectionFile({
      dialog, window: mainWindow, homeDir: app.getPath("home"), language: stateStore.read().language, signal,
      // browserHost is the account pool; the import (and its controller) runs on the default host.
      isCurrent: () => browserHost?.getHost("default").existingChromeLoginController?.signal === signal
        && stateStore.read().browserInteractionMode === "automatic" && mainWindow && !mainWindow.isDestroyed(),
    }),
    copyChromeSettingsAddress: () => clipboard.writeText(CHROME_SETTINGS_ADDRESS),
  });
  handle("launcher:browser-smoke", async () => {
    if (stateStore.read().browserInteractionMode === "manual") {
      throw new Error("Browser smoke testing is disabled in Manual mode");
    }
    const proofContext = captureAccountProofContext(stateStore);
    const result = await browserHost.smokeTest();
    if (!accountProofContextIsCurrent(proofContext, stateStore)) {
      throw new Error("Browser smoke evidence became stale before it could be published");
    }
    stateStore.update({ browserSmokePassed: true, browserSmokeVersion: app.getVersion() });
    return result;
  });
  handle("launcher:mcp-verify", async (event) => {
    const operationName = "mcp-verification";
    const proofContext = captureAccountProofContext(stateStore);
    const activeTraceId = browserHost.activeTraceId;
    logger.info("mcp.verification_requested", {
      activeTraceId,
      launcherFocused: mainWindow?.isFocused() === true,
      rendererFocused: event.sender.isFocused(),
    });
    if (activeTraceId) {
      const report = {
        ok: false,
        checks: [{
          id: "connector",
          status: "error",
          message: "Finish the active Codex task before verifying the ChatGPT connector",
          detail: `Active browser turn: ${activeTraceId}`,
        }],
      };
      const state = stateStore.update({ mcpSetupComplete: false });
      send("launcher:state-changed", state);
      publishOperation({ name: operationName, status: "failed", message: report.checks[0].message });
      return report;
    }
    publishOperation({ name: operationName, status: "running", message: "Checking local runtime" });
    const report = IS_DEV_PROFILE ? await runtimeHost.devDoctor() : await runtimeHost.doctor();
    if (!report.ok) {
      const message = report.checks
        .filter((check) => check.status === "error")
        .map((check) => check.message)
        .filter(Boolean)
        .join("; ") || "The local MCP runtime is not healthy";
      const state = stateStore.update({ mcpSetupComplete: false });
      send("launcher:state-changed", state);
      publishOperation({ name: operationName, status: "failed", message });
      // The connector is only checked once the runtime is healthy; the runtime's generic
      // "local checks cannot prove the connector" placeholder would contradict an existing proof.
      return { ...report, checks: report.checks.filter((check) => check.id !== "connector") };
    }
    if (stateStore.read().browserInteractionMode === "manual") {
      if (!accountProofContextIsCurrent(proofContext, stateStore, { requireCoreSetup: true })) {
        throw new Error("MCP verification became stale before it could be published");
      }
      const state = stateStore.update(mcpSetupProofPatch());
      send("launcher:state-changed", state);
      const successMessage = "Local Manual mode runtime is healthy; connector selection remains a manual turn step";
      publishOperation({ name: operationName, status: "completed", message: successMessage });
      return {
        ...report,
        checks: [
          ...report.checks.filter((check) => check.id !== "connector"),
          {
            id: "connector",
            status: "warning",
            message: `Select ChatGPT connector ${JSON.stringify(runtimeHost.mcpConnectorName())} manually for every Manual mode turn`,
          },
        ],
      };
    }
    try {
      publishOperation({ name: operationName, status: "running", message: "Checking ChatGPT connector" });
      await browserHost.verifyConnector(runtimeHost.mcpConnectorName());
      if (!accountProofContextIsCurrent(proofContext, stateStore, { requireCoreSetup: true })) {
        throw new Error("MCP verification became stale before it could be published");
      }
      const state = stateStore.update(mcpSetupProofPatch());
      send("launcher:state-changed", state);
      const successMessage = IS_DEV_PROFILE
        ? "DEV harness and connector verified"
        : "Runtime and connector verified";
      publishOperation({ name: operationName, status: "completed", message: successMessage });
      return {
        ...report,
        checks: report.checks.map((check) => check.id === "connector"
          ? {
              id: "connector",
              status: "ok",
              message: `ChatGPT connector ${JSON.stringify(runtimeHost.mcpConnectorName())} is available`,
            }
          : check),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const state = stateStore.update({ mcpSetupComplete: false });
      send("launcher:state-changed", state);
      publishOperation({ name: operationName, status: "failed", message });
      return {
        ...report,
        ok: false,
        checks: [
          ...report.checks.filter((check) => check.id !== "connector"),
          { id: "connector", status: "error", message },
        ],
      };
    }
  });

  handle("launcher:doctor", () => IS_DEV_PROFILE ? runtimeHost.devDoctor() : runtimeHost.doctor());
  handle("launcher:route-diagnostics", () => runtimeHost.routeDiagnostics());
  handle("launcher:runtime-switch-now", async () => {
    if (IS_DEV_PROFILE) throw new Error("The DEV profile has no managed runtime switch");
    return requestRuntimeSwitchNow();
  });
  handle("launcher:cancel-turns", async () => {
    if (IS_DEV_PROFILE) throw new Error("DEV chat turns are owned by the repository CLI process");
    const translations = require('./task-control-copy.json');
    const copy = translations[stateStore.read().language] ?? translations.en;
    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: 'warning', title: copy.all, message: copy.all, detail: copy.detail,
      buttons: [copy.cancel, copy.confirm], defaultId: 0, cancelId: 0, noLink: true,
    });
    if (confirmation.response !== 1) return { cancelled: true };
    return runtimeHost.cancelActiveTurns();
  });
  handle("launcher:uninstall-integration", async () => {
    if (IS_DEV_PROFILE) throw new Error("DEV profile has no Codex integration to remove");
    const copy = nativeCopyFor(stateStore.read().language);
    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      buttons: [copy.cancel, copy.remove],
      defaultId: 0,
      cancelId: 0,
      title: copy.removeTitle,
      message: copy.removeMessage,
      detail: copy.removeDetail,
      noLink: true,
    });
    if (confirmation.response !== 1) return { cancelled: true };
    try {
      await runtimeHost.uninstallIntegration();
    } finally {
      browserHost.writeDescriptor();
    }
    const state = stateStore.update({
      coreSetupComplete: false,
      codexCatalogVerified: false,
      mcpSetupComplete: false,
      mcpRuntimeInstalled: false,
      mcpGuideStep: 0,
      codexRestartRequired: true,
      browserInteractionMode: "automatic",
      experimentalAsyncToolOperations: false,
      experimentalBiggerContext: false,
      experimentalSkillAttachments: false,
      experimentalFreshConversationPerTurn: false,
      zeroRiskProEnabled: false,
    });
    send("launcher:state-changed", state);
    stopCatalogVerificationMonitor();
    return { cancelled: false, state };
  });
  handle("launcher:setup-core", async () => {
    let setupState = stateStore.read();
    if (setupState.browserInteractionMode === "automatic") {
      const browser = await browserHost.probeAuthentication({ forSetup: true });
      if (!browser.authenticated) {
        throw new Error(
          IS_DEV_PROFILE
            ? "Sign in to the isolated DEV ChatGPT profile before configuring the harness"
            : "Sign in to ChatGPT before installing the Codex integration",
        );
      }
      // Startup migration, account selection, logout, or a mode transition may
      // invalidate the setup gate while the authentication probe is pending.
      // Re-read the committed state before consuming its smoke evidence.
      setupState = stateStore.read();
    }
    if (setupState.browserInteractionMode === "automatic"
      && !setupState.coreSetupComplete
      && !smokePassedForCurrentVersion(setupState)) {
      throw new Error(
        IS_DEV_PROFILE
          ? "Run the browser smoke test before configuring the DEV harness"
          : "Run the browser smoke test before installing the Codex integration",
      );
    }
    const result = IS_DEV_PROFILE ? await runtimeHost.setupDevCore() : await runtimeHost.setupCore();
    stateStore.update({
      coreSetupComplete: true,
      codexCatalogVerified: IS_DEV_PROFILE,
      codexRestartRequired: !IS_DEV_PROFILE,
      experimentalAsyncToolOperations: runtimeHost.runtimeConfigSnapshot().config?.experimentalAsyncToolOperations === true,
      zeroRiskProEnabled: runtimeHost.runtimeConfigSnapshot().config?.zeroRiskProEnabled === true,
      ...(result.mode === "full" ? {
        mcpRuntimeInstalled: true,
        mcpSetupComplete: false,
        mcpGuideStep: 2,
      } : {
        mcpSetupComplete: false,
        mcpRuntimeInstalled: false,
        mcpGuideStep: 0,
      }),
    });
    await browserHost.returnToIdle().catch((error) => {
      logger.warn("browser.idle_cleanup_failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    });
    if (!IS_DEV_PROFILE) startCatalogVerificationMonitor({ logger, stateStore });
    return { ok: true, stdout: result.stdout, restartRequired: !IS_DEV_PROFILE };
  });
  registerClientConnections({ handle, runtimeHost, clipboard, isDevProfile: IS_DEV_PROFILE,
    assertIdle: () => assertBrowserIdleFor("client connections"),
    providerChanged: mode => {
      stopCatalogVerificationMonitor();
      const state = stateStore.update({ codexCatalogVerified: mode === "web-only", codexPickerConfirmed: false, codexRestartRequired: true });
      send("launcher:state-changed", state);
      if (mode === "mixed") startCatalogVerificationMonitor({ logger, stateStore });
    },
  });
  handle("launcher:setup-hermes", async (_event, input) => {
    if (IS_DEV_PROFILE) throw new Error("Add Hermes from the production app profile.");
    if (input?.runtime !== undefined && !["codex_responses", "codex_app_server"].includes(input.runtime)) throw new Error("Invalid Hermes runtime");
    return installHermesProvider({ coreHome: CORE_HOME, config: runtimeHost.runtimeConfigSnapshot().config,
      runtime: input?.runtime || "codex_responses", makeDefault: input?.makeDefault === true });
  });
  handle("launcher:setup-mcp", async (_event, input) => {
    const currentMode = stateStore.read().browserInteractionMode;
    const interactionMode = input?.interactionMode === undefined
      ? currentMode
      : validateBrowserInteractionMode(input.interactionMode);
    const interactionModeChange = interactionMode !== currentMode;
    if (interactionModeChange) invalidateAccountProof(stateStore);
    const setup = IS_DEV_PROFILE
      ? runtimeHost.setupDevMcp.bind(runtimeHost)
      : runtimeHost.setupMcp.bind(runtimeHost);
    const runSetup = afterRuntimeReady => setup({
      tunnelId: typeof input?.tunnelId === "string" ? input.tunnelId.trim() : "",
      runtimeKey: typeof input?.runtimeKey === "string" ? input.runtimeKey : "",
      replace: input?.replace === true,
      interactionMode,
      credentialStorage: input?.credentialStorage,
    }, afterRuntimeReady);
    if (!interactionModeChange && interactionMode === "automatic") await browserHost.reveal();
    const result = interactionModeChange
      ? await browserHost.withInteractionModeChange(interactionMode, runSetup)
      : await runSetup();
    const state = stateStore.update({
      browserInteractionMode: interactionMode,
      experimentalAsyncToolOperations: runtimeHost.runtimeConfigSnapshot().config?.experimentalAsyncToolOperations === true,
      ...(interactionMode === "manual" ? { experimentalBiggerContext: false, experimentalSkillAttachments: false, experimentalFreshConversationPerTurn: false } : {}),
      zeroRiskProEnabled: runtimeHost.runtimeConfigSnapshot().config?.zeroRiskProEnabled === true,
      coreSetupComplete: true,
      codexCatalogVerified: IS_DEV_PROFILE,
      mcpRuntimeInstalled: true,
      mcpSetupComplete: false,
      mcpGuideStep: 2,
      codexRestartRequired: !IS_DEV_PROFILE,
    });
    send("launcher:state-changed", state);
    // Advance the pool observation after the saved mode changes; do not send an unstamped refresh.
    if (interactionModeChange) browserHost.publish();
    if (!IS_DEV_PROFILE) startCatalogVerificationMonitor({ logger, stateStore });
    return { ok: true, stdout: result.stdout };
  });

  handle('launcher:account-tunnel-configure', async (_event, id, input) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Account tunnel settings are invalid');
    if (runtimeHost.runtimeConfigSnapshot().config?.accountTunnelMode !== true && browserHost.hasActiveTurns()) {
      throw new Error('Finish current browser tasks before switching from shared to account-owned tunnels');
    }
    const mode = input.interactionMode === undefined ? stateStore.read().browserInteractionMode
      : validateBrowserInteractionMode(input.interactionMode);
    const result = await browserHost.withAccountTunnelMutation(id, () => runtimeHost.configureAccountTunnel(id,
      { tunnelId: typeof input.tunnelId === 'string' ? input.tunnelId.trim() : '',
        runtimeKey: typeof input.runtimeKey === 'string' ? input.runtimeKey : '',
        reuseSavedCredentials: input.reuseSavedCredentials === true, interactionMode: mode,
        credentialStorage: input.credentialStorage,
        principalFingerprint: browserHost.getHost(id).authPrincipalFingerprint ?? undefined }));
    const state = stateStore.update({ mcpRuntimeInstalled: true, mcpSetupComplete: false, mcpGuideStep: 2 });
    send('launcher:state-changed', state);
    return result;
  });
  handle('launcher:account-tunnel-remove', async (_event, id, requestedMode) => {
    const mode = requestedMode === undefined ? stateStore.read().browserInteractionMode : validateBrowserInteractionMode(requestedMode);
    return browserHost.withAccountTunnelMutation(id, () => runtimeHost.removeAccountTunnel(id, mode));
  });
  handle('launcher:account-tunnel-credential-migrate', async (_event, id, input) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Account tunnel migration settings are invalid');
    const mode = input.interactionMode === undefined ? stateStore.read().browserInteractionMode : validateBrowserInteractionMode(input.interactionMode);
    return browserHost.withAccountTunnelMutation(id, () => runtimeHost.migrateAccountTunnelCredential(id,
      { interactionMode: mode, principalFingerprint: browserHost.getHost(id).authPrincipalFingerprint ?? undefined }));
  });
  handle("launcher:set-mcp-step", (_event, step) => {
    if (!Number.isInteger(step) || step < 0 || step > 2) throw new Error("Invalid MCP guide step");
    return stateStore.update({ mcpGuideStep: step });
  });

  handle("launcher:autostart", (_event, enabled) => {
    if (IS_DEV_PROFILE) throw new Error("The isolated DEV launcher is started explicitly from the repository CLI");
    const desired = enabled === true;
    const autostart = setAutostart(app, desired);
    return {
      state: stateStore.update({ autoStart: desired }),
      ...autostart,
    };
  });
  handle("launcher:bigger-context", async (_event, enabled) => {
    if (typeof enabled !== "boolean") throw new Error("Context mode must be a boolean");
    if (shutdownInProgress || quitting || exitCommitted) throw new Error("NEKODEX is shutting down");
    if (!IS_DEV_PROFILE) {
      const current = runtimeHost.runtimeConfigSnapshot();
      if (!current.configured || current.config?.browserInteractionMode === "manual") {
        throw new Error("Install the automatic model route before changing Bigger Context");
      }
      return contextChangeQueue.request(enabled);
    }
    const result = await runtimeHost.setBiggerContext(enabled === true);
    invalidateAccountProof(stateStore);
    const state = stateStore.update({
      experimentalBiggerContext: result.enabled,
      codexCatalogVerified: true,
      codexRestartRequired: false,
    });
    send("launcher:state-changed", state);
    return state;
  });
  handle("launcher:async-tool-operations", async (_event, enabled) => {
    if (typeof enabled !== "boolean") throw new Error("Asynchronous tool operations must be a boolean");
    if (shutdownInProgress || quitting || exitCommitted) throw new Error("NEKODEX is shutting down");
    browserHost.closeTurnAdmission("the asynchronous tool operation change");
    try {
      if (browserHost.hasActiveTurns() || browserHost.currentOperation() || runtimeHost.currentOperation()) {
        throw new Error("Finish active tasks and setup operations before changing asynchronous tool operations");
      }
      const result = await runtimeHost.setAsyncToolOperations(enabled);
      if (!result.changed) {
        const current = stateStore.read();
        if (current.experimentalAsyncToolOperations === result.enabled) return current;
        const state = stateStore.update({ experimentalAsyncToolOperations: result.enabled });
        send("launcher:state-changed", state);
        return state;
      }
      browserHost.invalidateAllEvidence();
      invalidateAccountProof(stateStore);
      const state = stateStore.update({
        experimentalAsyncToolOperations: result.enabled,
        codexCatalogVerified: IS_DEV_PROFILE,
        codexRestartRequired: !IS_DEV_PROFILE,
      });
      send("launcher:state-changed", state);
      browserHost.publish();
      if (!IS_DEV_PROFILE) startCatalogVerificationMonitor({ logger, stateStore });
      return state;
    } finally {
      if (!exitCommitted) browserHost.openTurnAdmission();
    }
  });
  handle("launcher:skill-attachments", async (_event, enabled) => {
    if (typeof enabled !== "boolean") throw new Error("Skills as files must be a boolean");
    if (browserHost.activeTraceId || browserHost.currentOperation()) {
      throw new Error("Finish or cancel active ChatGPT turns before changing Skills as files");
    }
    const result = await runtimeHost.setSkillAttachments(enabled === true);
    const state = stateStore.update({ experimentalSkillAttachments: result.enabled });
    send("launcher:state-changed", state);
    return state;
  });
  handle("launcher:web-subagents", async (_event, enabled) => {
    if (typeof enabled !== "boolean") throw new Error("Web subagents must be a boolean");
    if (browserHost.activeTraceId || browserHost.currentOperation()) {
      throw new Error("Finish or cancel active ChatGPT turns before changing Web subagents");
    }
    const result = await runtimeHost.setWebSubagents(enabled === true);
    const state = stateStore.update({ allowWebSubagents: result.enabled });
    send("launcher:state-changed", state);
    return state;
  });
  handle("launcher:fresh-conversation", async (_event, enabled) => {
    if (typeof enabled !== "boolean") throw new Error("Fresh conversation per turn must be a boolean");
    return changeConversationState("browser conversation retention change", () => runtimeHost.setFreshConversation(enabled));
  });
  handle("launcher:use-saved-chats", async (_event, enabled) => {
    if (typeof enabled !== "boolean") throw new Error("Saved chat preference must be a boolean");
    return changeConversationState("saved ChatGPT conversation change", () => runtimeHost.setUseSavedChats(enabled));
  });
  handle("launcher:cancel-context-change", async () => contextChangeQueue.cancel());
  handle("launcher:confirm-codex-models", async () => {
    const current = stateStore.read();
    if (!current.coreSetupComplete || !current.codexCatalogVerified || typeof current.pendingBiggerContext === "boolean") {
      throw new Error("Wait for the configured model catalog before confirming the Codex picker");
    }
    const state = stateStore.update({ codexPickerConfirmed: true, codexRestartRequired: false,
      codexPickerContract: codexPickerContract(),
      setupContract: SETUP_CONTRACT, pickerVerifiedAt: new Date().toISOString(),
      setupIdentityHash: setupIdentity(runtimeHost.runtimeConfigSnapshot().config, browserHost.snapshot().accountLabel),
      setupRuntimeIdentity: currentRuntimeIdentity() });
    send("launcher:state-changed", state);
    return state;
  });
  handle("launcher:zero-risk-pro", async (_event, enabled) => {
    assertBrowserIdleFor("Manual model profiles");
    const result = await runtimeHost.setZeroRiskPro(enabled === true);
    invalidateAccountProof(stateStore);
    const state = stateStore.update({
      zeroRiskProEnabled: result.enabled,
      codexCatalogVerified: IS_DEV_PROFILE,
      codexRestartRequired: !IS_DEV_PROFILE,
    });
    send("launcher:state-changed", state);
    if (!IS_DEV_PROFILE) startCatalogVerificationMonitor({ logger, stateStore });
    return state;
  });
  handle("launcher:browser-interaction-mode", async (_event, rawMode) => {
    const mode = validateBrowserInteractionMode(rawMode);
    const current = stateStore.read();
    if (current.browserInteractionMode === mode) {
      return { state: current, credentialsRequired: false, targetMode: mode };
    }
    assertBrowserIdleFor("browser interaction mode");
    if (!runtimeHost.mcpCredentialsConfigured(mode)) {
      return { state: current, credentialsRequired: true, targetMode: mode };
    }
    invalidateAccountProof(stateStore);
    const result = await browserHost.withInteractionModeChange(
      mode,
      afterRuntimeReady => runtimeHost.setBrowserInteractionMode(mode, afterRuntimeReady),
    );
    const state = stateStore.update({
      browserInteractionMode: mode,
      experimentalAsyncToolOperations: runtimeHost.runtimeConfigSnapshot().config?.experimentalAsyncToolOperations === true,
      ...(mode === "manual" ? { experimentalBiggerContext: false, experimentalSkillAttachments: false, experimentalFreshConversationPerTurn: false } : {}),
      ...(result.configured ? {
        codexCatalogVerified: IS_DEV_PROFILE,
        codexRestartRequired: !IS_DEV_PROFILE,
      } : {}),
    });
    send("launcher:state-changed", state);
    browserHost.publish();
    if (!IS_DEV_PROFILE && result.configured) startCatalogVerificationMonitor({ logger, stateStore });
    return { state, credentialsRequired: false, targetMode: mode };
  });
  registerAccountHandlers({
    handle, getBrowserHost: () => browserHost, getAccountToolsService: () => accountToolsService,
    isRuntimeBusy: () => quitting || shutdownInProgress || runtimeHost.currentOperation(),
    invalidateAccountProof: () => invalidateAccountProof(stateStore),
  });
  // Narrow Web repair remains a supervisor-owned transition. It may preserve healthy native work,
  // but renderer authority cannot bypass app-wide operations or active Web/manual turns.
  handle("launcher:repair-web-route", async () => {
    const operation = currentGlobalOperation();
    if (operation) throw new Error(`Finish ${operation} before repairing the Web route`);
    if (browserHost?.hasActiveTurns()) {
      return { status: "unavailable", reason: "Finish active Web or Manual work before repairing the Web route" };
    }
    if (!runtimeSupervisor?.repairWebRoute) {
      return { status: "unavailable", reason: "Web route repair is unavailable in this runtime" };
    }
    const repairOwner = lifecycleAdmission.acquire("Web route repair");
    try {
      lifecycleAdmission.assertOwner(repairOwner);
      const competingOperation = currentGlobalOperation();
      if (competingOperation) throw new Error(`Finish ${competingOperation} before repairing the Web route`);
      return await runtimeSupervisor.repairWebRoute();
    } finally {
      lifecycleAdmission.release(repairOwner);
    }
  });
  handle("launcher:browser-capacity", async (_event, value) => {
    saveBrowserCapacity(CORE_HOME, value);
    return browserCapacitySnapshot();
  });
  handle("launcher:compaction-model", async (_event, value) => {
    if (browserHost.activeTraceId || browserHost.currentOperation()) throw new Error("Finish active tasks before changing the compaction model");
    return runtimeHost.setCompactionModel(value);
  });
  handle("launcher:pro-model-version", async (_event, rawVersion) => {
    const version = validateProModelVersion(rawVersion);
    assertBrowserIdleFor("the Pro model version");
    return runtimeHost.setProModelVersion(version);
  });
  handle("launcher:set-preference", (_event, key, value) => {
    if (key === "passkeyBrowser") {
      if (value !== "chrome" && value !== "firefox") throw new Error("Passkey browser must be Chrome or Firefox");
      // Each login attempt snapshots its browser before launch; this preference affects
      // only the next attempt and must not be blocked by an unrelated session probe.
      return stateStore.update({ passkeyBrowser: value });
    }
    if (key === "manualSubmitTimeoutSec") {
      if (!Number.isInteger(value) || value < 30 || value > 600) throw new Error("Manual submission time must be 30–600 seconds");
      return stateStore.update({ manualSubmitTimeoutSec: value });
    }
    if (key === "appearance") {
      const next = stateStore.update({ appearance: validateAppearance(value) });
      applyAppTheme(mainWindow, resolvedAppTheme(next));
      return next;
    }
    const ordinary = key === "keepRunningOnClose" || key === "showBrowserDuringTurns" || key === "showNetworkIssueNotice";
    if (!ordinary) throw new Error("Unknown preference");
    return stateStore.update({ [key]: value === true });
  });
  handle("launcher:sidebar-state", (_event, value) => stateStore.update(validateSidebarState(value)));
  handle("launcher:usage", (_event, query) => {
    if (typeof query === "number") return browserHost.usageSnapshot(query);
    if (!query || typeof query !== "object" || Array.isArray(query)
      || Object.keys(query).some(key => !["days", "accountId", "source"].includes(key))
      || ![1, 7, 30, 90].includes(query.days)
      || (query.source !== undefined && !["web", "native"].includes(query.source))
      || (query.accountId !== undefined && query.accountId !== null
        && (typeof query.accountId !== "string" || query.accountId.length > 36))
      || (query.source === "native" && query.accountId !== undefined && query.accountId !== null)) {
      throw new Error("Usage query is invalid");
    }
    return browserHost.usageSnapshot({ days: query.days, source: query.source ?? "web", accountId: query.accountId ?? null });
  });
  handle("launcher:logs", (_event, limit) => logger.recent(limit));
  let supportReportExport = null;
  handle("launcher:export-support-report", () => {
    if (supportReportExport) return supportReportExport;
    const run = (async () => {
      const copy = nativeCopyFor(stateStore.read().language);
      const result = await dialog.showSaveDialog(mainWindow, {
        title: copy.exportDiagnostics,
        defaultPath: path.join(app.getPath("documents"), `nekodex-support-${new Date().toISOString().slice(0, 10)}.json`),
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (result.canceled || !result.filePath) return null;
      const report = await collectSupportReport({ sources: supportReportSources({ app, webContents, mainWindow,
        runtimeHost, runtimeSupervisor, browserHost, logger, profile: LAUNCHER_PROFILE.kind }) });
      writeSupportReport({ destinationPath: result.filePath, report,
        sourceLogPaths: [logger.filePath, `${logger.filePath}.1`] });
      logger.info("launcher.support_report_exported", {});
      return result.filePath;
    })().finally(() => { if (supportReportExport === run) supportReportExport = null; });
    supportReportExport = run;
    return run;
  });
  handle("launcher:export-logs", async () => {
    const date = new Date().toISOString().slice(0, 10);
    const copy = nativeCopyFor(stateStore.read().language);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: copy.exportDiagnostics,
      defaultPath: path.join(app.getPath("documents"), `codex-web-gpt-diagnostics-${date}.jsonl`),
      filters: [{ name: "JSON Lines", extensions: ["jsonl"] }],
    });
    if (result.canceled || !result.filePath) return null;
    const recordCount = exportSanitizedLogs({
      filePath: logger.filePath,
      destinationPath: result.filePath,
    });
    logger.info("launcher.logs_exported", { recordCount });
    return result.filePath;
  });
  handle("launcher:update-recheck", async () => {
    if (!updateController) throw new Error("Launcher updates are unavailable");
    return updateController.recheck();
  });
  handle("launcher:update-request-revision", () => updatesPanelRequestRevision);
  handle("launcher:update-cancel", async () => {
    if (!updateController) throw new Error("Launcher updates are unavailable");
    return updateController.cancelPreparation();
  });
  handle("launcher:restart", async () => {
    if (updateReadinessHandoff) {
      const journalPath = path.join(path.dirname(updateReadinessHandoff.filename), "transaction.json");
      try {
        const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
        if (journal.phase !== "committed") throw new Error("The update is still being committed; try restarting in a moment");
      } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    const result = await requestQuit({ restart: true });
    if (!result.ok) throw new Error(result.message || "NEKODEX could not restart");
    return true;
  });
  handle("launcher:update-install", async () => {
    if (!updateController) throw new Error("Launcher updates are unavailable");
    let transitionOwner = null;
    let admissionClosed = false;
    let launch;
    const releaseTransition = () => {
      if (admissionClosed) browserHost.openTurnAdmission();
      admissionClosed = false;
      if (transitionOwner) lifecycleAdmission.release(transitionOwner);
      transitionOwner = null;
    };
    try {
      // Download and verification run while tasks continue. Only the handoff waits for
      // an idle moment: Native traffic keeps running on the background runtime, while
      // browser turns live in this process and must finish first. Nothing is cancelled.
      launch = await updateController.beginInstall({
        beforeHandoff: async (signal, onWaiting) => {
          let reported = false;
          for (;;) {
            if (signal.aborted) throw signal.reason ?? new Error("Update preparation was cancelled");
            if (!lifecycleAdmission.busy() && !currentGlobalOperation() && !browserHost?.hasActiveTurns()) {
              transitionOwner = lifecycleAdmission.acquire("the NEKODEX update");
              browserHost.closeTurnAdmission("the launcher update");
              admissionClosed = true;
              if (!currentGlobalOperation() && !browserHost?.hasActiveTurns()) return;
              releaseTransition();
            }
            if (!reported) {
              reported = true;
              onWaiting();
              logger.info("launcher.update_waiting_for_idle", {});
            }
            await sleep(500);
          }
        },
      });
      const result = await requestQuit({ admissionHeld: true, transitionOwner });
      if (!result.ok) {
        try {
          await updateController.cancelInstall(launch);
        } catch (cleanupError) {
          const primaryError = new Error(result.message);
          primaryError.cause = cleanupError;
          throw primaryError;
        }
        throw new Error(result.message);
      }
      return true;
    } catch (error) {
      if (error?.code === "UPDATE_PREPARATION_CANCELLED") return false;
      throw error;
    } finally {
      if (!exitCommitted) releaseTransition();
    }
  });
  handle("launcher:window-state", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    return windowStateSnapshot(window);
  });
  registerLoggedIpcEvent(ipcMain, logger, "launcher:window-control", (event, action) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || window.isDestroyed()) return;
    if (action === "close") window.close();
    else if (action === "minimize") window.minimize();
    else if (action === "zoom") window.isMaximized() ? window.unmaximize() : window.maximize();
  }, authorize);
}

let runtimeActivation = null;
const RUNTIME_ACTIVATION_LABEL = "the local runtime update";
// Quit, signals and logout wait for these bounded transitions instead of failing.
const DEFERRED_QUIT_TRANSITIONS = new Set(["local runtime startup", RUNTIME_ACTIVATION_LABEL]);
const RUNTIME_ACTIVATION_POLL_MS = 1_000;
// Bounded runtime switch. First look for a natural idle moment, which costs clients nothing. Then
// drain: new requests wait briefly in the daemon while running turns may finish. At the deadline
// the remaining turns are cancelled and the switch completes. It never waits forever for idleness.
const RUNTIME_SWITCH_IDLE_WAIT_MS = 60_000;
const RUNTIME_SWITCH_DRAIN_MS = 120_000;
// Uncancellable launcher work (setup, account operations) defers the drain by this long.
const RUNTIME_SWITCH_RETRY_MS = 30_000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const launcherClosing = () => shutdownInProgress || quitting || exitCommitted;
let runtimeSwitchNowRequested = false;
let runtimeSwitchWake = null;

// The Updates page shows this projection: phase, versions, countdown targets and active turns.
function publishRuntimeSwitch(value) {
  lifecycleProjection.update({ runtimeSwitch: value ? { ...value, updatedAt: new Date().toISOString() } : null });
}

function pauseRuntimeSwitch(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { runtimeSwitchWake = null; resolve(); }, ms);
    runtimeSwitchWake = () => { clearTimeout(timer); runtimeSwitchWake = null; resolve(); };
  });
}

function runtimeSwitchPending() {
  if (IS_DEV_PROFILE) return false;
  const config = runtimeSupervisor?.readConfig();
  return Boolean(config && config.releaseVersion !== app.getVersion());
}

function pruneInstalledRuntimeVersions(previousVersion) {
  if (IS_DEV_PROFILE) return;
  try {
    const pending = runtimeHost?.runtimeGeneration?.inspect?.();
    pruneRuntimeVersions({
      coreHome: CORE_HOME,
      // The version just replaced is the natural rollback target, even when an
      // intermediate release was installed but never activated.
      keepVersions: [app.getVersion(), runtimeSupervisor?.readConfig()?.releaseVersion, previousVersion,
        pending?.journal?.fromVersion, pending?.journal?.toVersion,
        ...externallyReferencedRuntimeVersions({ coreHome: CORE_HOME })],
      logger,
    });
  } catch (error) {
    logger?.warn("runtime.version_prune_failed", { message: error instanceof Error ? error.message : String(error) });
  }
}

function retryableActivationRefusal(error) {
  const message = error instanceof Error ? error.message : String(error);
  return (message.includes("atomic idleness could not be proven") && !message.includes("compensating resume failed")
    && !message.includes("restart"))
    || message.startsWith("Runtime session no longer matches the owned daemon")
    || message.startsWith("Runtime session did not acknowledge");
}

// Activation failed after the previous runtime may have stopped. Mirror startup: keep a
// usable runtime as is; otherwise retire readiness and give Codex its previous route back.
async function recoverFromActivationFailure(message) {
  stopCatalogVerificationMonitor();
  const usable = runtimeSupervisor.capabilitySnapshot().nativeAvailability === "ready";
  if (usable) {
    publishOperation({ name: "runtime-upgrade", status: "failed",
      message: `${message}; the previous verified runtime remains available` });
    startCatalogVerificationMonitor({ logger, stateStore: launcherStateStore });
    return;
  }
  retireAccountProof();
  const state = launcherStateStore.update({ coreSetupComplete: false, codexCatalogVerified: false, mcpSetupComplete: false });
  send("launcher:state-changed", state);
  const route = await restoreCodexRouteAfterRuntimeFailure({ logger, stateStore: launcherStateStore });
  if (route.skipped) return;
  publishOperation({ name: "runtime-upgrade", status: "failed",
    message: route.error ? `${message}; restoring the previous Codex route also failed: ${route.error}`
      : route.restored ? `${message}; the previous Codex route was restored, restart Codex once` : message });
}

async function runtimeIdleForActivation() {
  if (currentGlobalOperation() || browserHost?.hasActiveTurns()) return false;
  const config = runtimeSupervisor?.readConfig();
  if (!config) return false;
  const health = await runtimeSupervisor.proxyHealthPayload(config).catch(() => null);
  // No reachable owned daemon means nothing is being served; the upgrade's own drain decides.
  if (!health) return true;
  return !health.active_http_turns && !health.active_browser_turns && !health.active_compaction_runs;
}

// Start the staged generation, route Codex to it and commit it; on failure restore the
// previous generation exactly as startup does, so a broken candidate never stays active.
async function startStagedRuntimeGeneration(upgrade) {
  let committed = false;
  try {
    const runtime = await runtimeSupervisor.startIfConfigured();
    if (runtime.status !== "ready") throw new Error(runtime.detail || `Candidate runtime returned ${runtime.status}`);
    if (launcherClosing()) throw new Error("NEKODEX is quitting");
    lifecycleProjection.update({ routeStatus: "switching" });
    const route = await runtimeHost.connectBridgeRoute();
    lifecycleProjection.update({ routeStatus: "managed" });
    runtimeHost.commitManagedRuntimeUpgrade(upgrade.generationId);
    committed = true;
    return { runtime, bridgeRouteChanged: route.changed === true };
  } catch (error) {
    if (committed) throw error;
    const message = error instanceof Error ? error.message : String(error);
    try {
      await runtimeHost.rollbackManagedRuntimeUpgrade(upgrade.generationId);
      lifecycleProjection.update({ routeStatus: "switching" });
      await runtimeHost.connectBridgeRoute();
      lifecycleProjection.update({ routeStatus: "managed" });
    } catch (rollbackError) {
      throw new Error(`${message}; restoring the previous runtime also failed: ${
        rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
    }
    throw new Error(`${message}; the previous verified runtime was restored`);
  }
}

async function activatePendingRuntime(reason) {
  if (updateReadinessHandoff) {
    const commit = await waitForUpdateCommit(updateReadinessHandoff, { isCancelled: launcherClosing });
    logger.info("update.commit_observed", commit);
    if (commit.status === "cancelled" || commit.status === "rolled-back") return;
    if (commit.status !== "committed") {
      // Without commit proof the previous app may still be restored; it must find its runtime.
      const state = launcherStateStore.update({ launcherRestartRequired: true });
      send("launcher:state-changed", state);
      publishOperation({ name: "runtime-migration", status: "completed",
        message: "The app update is installed. Restart NEKODEX to activate the new local runtime." });
      return;
    }
  }
  const startedAt = Date.now();
  const fromVersion = runtimeSupervisor.readConfig()?.releaseVersion ?? null;
  const toVersion = app.getVersion();
  const iso = ms => new Date(ms).toISOString();
  let drainAt = startedAt + RUNTIME_SWITCH_IDLE_WAIT_MS;
  let deadlineAt = drainAt + RUNTIME_SWITCH_DRAIN_MS;
  const project = (phase, extra = {}) => publishRuntimeSwitch({ phase, reason, fromVersion, toVersion,
    startedAt: iso(startedAt), drainAt: iso(drainAt), deadlineAt: iso(deadlineAt), activeTurns: null, detail: null, ...extra });
  // "Switch now" moves both targets to the present: drain at once, cancel what still runs.
  const takeSwitchNow = () => {
    if (!runtimeSwitchNowRequested) return false;
    runtimeSwitchNowRequested = false;
    drainAt = Date.now();
    deadlineAt = drainAt;
    return true;
  };
  logger.info("runtime.activation_waiting", { reason, fromVersion, toVersion, drainAt: iso(drainAt), deadlineAt: iso(deadlineAt) });
  project("waiting");
  for (let attempt = 0; ; attempt += 1) {
    if (attempt > 0) await pauseRuntimeSwitch(RUNTIME_ACTIVATION_POLL_MS);
    if (launcherClosing()) return;
    const current = runtimeSupervisor.readConfig();
    if (!current || current.releaseVersion === toVersion) return;
    const forced = takeSwitchNow();
    const drainDue = forced || Date.now() >= drainAt;
    if (!drainDue && !(await runtimeIdleForActivation())) continue;
    if (lifecycleAdmission.busy()) continue;
    const owner = lifecycleAdmission.acquire(RUNTIME_ACTIVATION_LABEL);
    let drain = null;
    let switched = false;
    try {
      const operation = currentGlobalOperation() || runtimeHost.currentOperation();
      if (operation) {
        // Setup and account operations are not cancellable; the switch waits for them visibly.
        if (drainDue) {
          drainAt = Date.now() + RUNTIME_SWITCH_RETRY_MS;
          deadlineAt = drainAt + RUNTIME_SWITCH_DRAIN_MS;
          project("deferred", { detail: `Waiting for ${operation} to finish` });
        }
        continue;
      }
      if (drainDue) {
        logger.info("runtime.switch_drain_started", { reason, forced, deadlineAt: iso(deadlineAt) });
        project("draining");
        drain = await runtimeSupervisor.drainForSwitch({
          deadlineAt: () => { takeSwitchNow(); return deadlineAt; },
          isCancelled: () => launcherClosing() || deferredQuit !== null,
          busy: () => currentGlobalOperation() || runtimeHost.currentOperation()
            || (browserHost?.hasActiveTurns() ? "browser tasks" : null),
          onProgress: ({ activeTurns, cancelledAt }) => project(cancelledAt === null ? "draining" : "cancelling", { activeTurns }),
        });
        // Quit was requested: admission is resumed and the next launch resumes the switch.
        if (drain.status === "cancelled") return;
        if (drain.status === "deferred") {
          logger.warn("runtime.switch_deferred", { reason, detail: drain.detail ?? null });
          drainAt = Date.now() + RUNTIME_SWITCH_RETRY_MS;
          deadlineAt = drainAt + RUNTIME_SWITCH_DRAIN_MS;
          project("deferred", { detail: drain.detail ?? null });
          continue;
        }
      } else if (browserHost?.hasActiveTurns()) continue;
      project("switching", { activeTurns: 0 });
      let upgrade;
      try {
        invalidateAgentSourceOwners();
        upgrade = await runtimeHost.upgradeManagedRuntime();
      } catch (error) {
        // A turn that started after the idle check, or a transient status probe, refuses the
        // drain while the old runtime keeps serving. The bounded deadline still applies.
        if (retryableActivationRefusal(error)) {
          logger.info("runtime.activation_retry", { message: error instanceof Error ? error.message : String(error) });
          project(drainDue ? "draining" : "waiting");
          continue;
        }
        throw error;
      }
      if (upgrade.busy) continue;
      if (!upgrade.updated) {
        if (upgrade.repairRequired) publishOperation({ name: "runtime-repair", status: "failed", message: upgrade.detail });
        return;
      }
      const result = await startStagedRuntimeGeneration(upgrade);
      switched = true;
      pruneInstalledRuntimeVersions(upgrade.fromVersion);
      const state = launcherStateStore.update({
        runtimeMigrationPending: false,
        launcherRestartRequired: false,
        ...(result.bridgeRouteChanged ? { codexCatalogVerified: false, codexRestartRequired: true } : {}),
      });
      send("launcher:state-changed", state);
      if (result.bridgeRouteChanged) startCatalogVerificationMonitor({ logger, stateStore: launcherStateStore });
      logger.info("runtime.release_activated", { reason, fromVersion: upgrade.fromVersion, toVersion: upgrade.toVersion,
        waitedMs: Date.now() - startedAt, generationId: upgrade.generationId,
        ...(drain?.cancelled ? { cancelledTurns: drain.cancelled } : {}) });
      publishOperation({ name: "runtime-upgrade", status: "completed",
        message: `NEKODEX switched to the new local runtime ${upgrade.toVersion}` });
      return;
    } finally {
      // A held switch drain that did not end in a switch must never outlive this attempt.
      if (drain?.status === "idle" && drain.held && !switched) {
        await runtimeSupervisor.releaseSwitchDrain().catch((error) => {
          logger.error("runtime.switch_drain_release_failed", { message: error instanceof Error ? error.message : String(error) });
        });
      }
      lifecycleAdmission.release(owner);
    }
  }
}

function scheduleRuntimeActivation(reason) {
  if (runtimeActivation || IS_DEV_PROFILE) return runtimeActivation;
  let failure = null;
  runtimeActivation = activatePendingRuntime(reason).catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    failure = message;
    logger.error("runtime.activation_failed", { reason, message });
    if (launcherClosing()) return;
    await recoverFromActivationFailure(message).catch((failure) => {
      logger.error("runtime.activation_recovery_failed", { message: failure instanceof Error ? failure.message : String(failure) });
    });
  }).finally(() => {
    runtimeActivation = null;
    runtimeSwitchNowRequested = false;
    if (launcherClosing()) return;
    // A switch that is still pending stays visible with "Switch now"; a finished one disappears.
    const pending = runtimeSwitchPending();
    publishRuntimeSwitch(pending ? { phase: failure ? "failed" : "pending", reason,
      fromVersion: runtimeSupervisor.readConfig()?.releaseVersion ?? null, toVersion: app.getVersion(),
      detail: failure, activeTurns: null, drainAt: null, deadlineAt: null } : null);
  });
  return runtimeActivation;
}

// "Switch now" from the Updates page: drain at once and cancel what still runs, after confirmation.
async function requestRuntimeSwitchNow() {
  if (!runtimeSwitchPending()) return { status: "current" };
  if (launcherClosing()) throw new Error("NEKODEX is quitting");
  const config = runtimeSupervisor.readConfig();
  const health = await runtimeSupervisor.proxyHealthPayload(config).catch(() => null);
  const activeTurns = [health?.active_http_turns, health?.active_browser_turns, health?.active_compaction_runs]
    .reduce((total, value) => total + (Number.isInteger(value) && value > 0 ? value : 0), 0);
  if (activeTurns > 0) {
    const copy = runtimeSwitchCopy(launcherStateStore?.read().language);
    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: "warning", title: copy.title, message: copy.title,
      detail: copy.detail.replace("{count}", String(activeTurns)),
      buttons: [copy.keep, copy.confirm], defaultId: 0, cancelId: 0, noLink: true,
    });
    if (confirmation.response !== 1) return { status: "kept" };
  }
  runtimeSwitchNowRequested = true;
  if (runtimeActivation) runtimeSwitchWake?.();
  else scheduleRuntimeActivation("user");
  return { status: "started", activeTurns };
}

const RUNTIME_SWITCH_COPY = {
  en: { title: "Switch the local runtime now?", detail: "{count} running turn(s) will be cancelled. Codex retries them on the updated runtime.",
    keep: "Keep waiting", confirm: "Switch now" },
  ru: { title: "Переключить локальный runtime сейчас?", detail: "Будет отменено выполняющихся ходов: {count}. Codex повторит их на обновлённом runtime.",
    keep: "Подождать", confirm: "Переключить сейчас" },
  ja: { title: "ローカルランタイムを今すぐ切り替えますか?", detail: "実行中の {count} 件のターンがキャンセルされます。Codex は更新後のランタイムで再試行します。",
    keep: "待機を続ける", confirm: "今すぐ切り替え" },
  ko: { title: "로컬 런타임을 지금 전환할까요?", detail: "실행 중인 턴 {count}개가 취소됩니다. Codex가 업데이트된 런타임에서 다시 시도합니다.",
    keep: "계속 기다리기", confirm: "지금 전환" },
};
const runtimeSwitchCopy = language => RUNTIME_SWITCH_COPY[language] ?? RUNTIME_SWITCH_COPY.en;

async function requestQuit({ admissionHeld = false, restart = false, stopRuntime = false, transitionOwner = null } = {}) {
  if (!transitionOwner && DEFERRED_QUIT_TRANSITIONS.has(lifecycleAdmission.currentLabel())) {
    // Preserve a single native Quit/SIGTERM across the bounded startup owner.
    // A full-stop intent dominates a plain quit or interface restart.
    if (!deferredQuit) deferredQuit = { options: { restart, stopRuntime }, waiters: [] };
    deferredQuit.options.stopRuntime ||= stopRuntime;
    deferredQuit.options.restart = !deferredQuit.options.stopRuntime && (deferredQuit.options.restart || restart);
    return new Promise(resolve => deferredQuit.waiters.push(resolve));
  }
  if (shutdownInProgress || exitCommitted) {
    return { ok: false, message: "Launcher shutdown is already in progress" };
  }
  const borrowedTransition = transitionOwner !== null;
  try {
    if (borrowedTransition) lifecycleAdmission.assertOwner(transitionOwner);
    else transitionOwner = lifecycleAdmission.acquire("NEKODEX shutdown");
  } catch (error) {
    publishOperation({ name: "launcher-quit", status: "failed", message: error.message });
    return { ok: false, message: error.message };
  }
  shutdownInProgress = true;
  let shutdownResult;
  try {
    // An ordinary quit abandons an update still downloading, verifying or waiting for
    // tasks; cancelling it removes the staged package instead of leaking it.
    if (!borrowedTransition) {
      await updateController?.cancelPreparation().catch(error => {
        logger?.warn("launcher.update_preparation_cancel_failed", { message: error instanceof Error ? error.message : String(error) });
      });
    }
    if (!admissionHeld) browserHost?.closeTurnAdmission("launcher shutdown");
    if (browserHost?.hasActiveTurns()) {
      throw new Error("Finish or cancel active tasks before quitting NEKODEX");
    }
    // Background account/connector checks are cancellable reads. Settle their exact
    // navigation/helper owners before the normal mutation and active-work vetoes.
    await browserHost?.cancelReadOnlyInspections();
    const activeOperation = currentGlobalOperation();
    if (activeOperation) {
      throw new Error(`Wait for ${activeOperation} to finish before quitting NEKODEX`);
    }
    if (browserHost?.hasActiveTurns()) {
      throw new Error("Finish or cancel active tasks before quitting NEKODEX");
    }
    await browserHost?.closeWorkspaceWindows();
    // Session persistence is a recoverable preflight. Keep every owner intact if it fails.
    await browserHost?.persistSession();
    const operationAfterPersistence = currentGlobalOperation();
    if (operationAfterPersistence) {
      throw new Error(`Wait for ${operationAfterPersistence} to finish before quitting NEKODEX`);
    }
    if (browserHost?.hasActiveTurns()) {
      throw new Error("Finish or cancel active tasks before quitting NEKODEX");
    }

    // Ordinary Quit preserves the background Native runtime. An explicit restart
    // replaces that runtime and uses the existing idle drain; it must not require
    // a healthy background route just to recover a failed application.
    invalidateAgentSourceOwners();
    shutdownResult = stopRuntime || restart || IS_DEV_PROFILE
      ? await runtimeSupervisor?.shutdown({ cancelActiveTurns: false, force: false })
      : await runtimeSupervisor?.detachForQuit();

    // A resolved result is either stopped or a durable background-runtime handoff.
    // Commit only now; subsequent browser/account cleanup is best effort and cannot return the
    // user to a partially dismantled launcher.
    stopCatalogVerificationMonitor();
    quitting = true;
    exitCommitted = true;
    contextChangeQueue?.stop();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    quitting = false;
    runtimeSupervisor?.allowRestartAfterQuitFailure();
    if (!admissionHeld) browserHost?.openTurnAdmission();
    showMainWindow();
    publishOperation({ name: "launcher-quit", status: "failed", message });
    shutdownInProgress = false;
    if (!borrowedTransition) lifecycleAdmission.release(transitionOwner);
    return { ok: false, message };
  }

  const cleanupFailures = [];
  const recordCleanupFailure = (stage, error) => {
    const message = error instanceof Error ? error.message : String(error);
    cleanupFailures.push(`${stage}: ${message}`);
    logger?.error("launcher.quit_cleanup_failed", { stage, message });
  };
  if (shutdownResult?.status === "forced-partial") {
    const message = `Runtime cleanup was incomplete: ${shutdownResult.failures.join("; ")}.`;
    cleanupFailures.push(message);
    logger?.error("launcher.quit_cleanup_incomplete", {
      message,
      shutdownDetail: shutdownResult.detail,
      failures: shutdownResult.failures,
      ownershipStatePath: runtimeSupervisor.statePath,
    });
  }
  try {
    await closeBrowserResources();
  } catch (error) {
    recordCleanupFailure("browser and account cleanup", error);
  }
  if (restart) {
    process.env[FOREGROUND_RELAUNCH_ENV] = "1";
    try {
      app.relaunch({ args: process.argv.slice(1).filter(arg => arg !== "--hidden") });
    } catch (error) {
      recordCleanupFailure("launcher relaunch", error);
    }
  }
  try {
    app.quit();
  } catch (error) {
    recordCleanupFailure("application quit", error);
    app.exit(1);
  }
  shutdownInProgress = false;
  if (shutdownResult?.status === "forced-partial") {
    return { ok: true, status: "forced-partial", failures: shutdownResult.failures };
  }
  return cleanupFailures.length
    ? { ok: true, status: "cleanup-incomplete", failures: cleanupFailures }
    : { ok: true };
}

async function start() {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }
  app.on("second-instance", () => showMainWindow({ activateApplication: true }));

  await waitForPackagedRuntimeSource({ app, resourcesPath: process.resourcesPath });
  let installedRuntimeRoot = null;
  let runtimeRootResolved = false;
  const runtimeRootProvider = (releaseVersion = app.getVersion()) => {
    if (app.isPackaged && releaseVersion !== app.getVersion()) {
      return resolveInstalledRuntimeRoot({ coreHome: CORE_HOME, version: releaseVersion });
    }
    const packagedRuntimeWasRemoved = app.isPackaged
      && (!installedRuntimeRoot || !fs.existsSync(installedRuntimeRoot));
    if (!runtimeRootResolved || packagedRuntimeWasRemoved) {
      installedRuntimeRoot = ensurePackagedRuntime({
        app,
        coreHome: CORE_HOME,
        resourcesPath: process.resourcesPath,
      });
      runtimeRootResolved = true;
    }
    return installedRuntimeRoot;
  };
  installedRuntimeRoot = runtimeRootProvider();

  cdpPort = await findFreePort();
  if (process.platform === "linux") {
    app.commandLine.appendSwitch("class", IS_DEV_PROFILE ? "codex-web-gpt-dev" : "codex-web-gpt");
  }
  app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
  app.commandLine.appendSwitch("remote-debugging-port", String(cdpPort));

  startupPhase = "electron-ready";
  await app.whenReady();
  if (process.platform === "darwin") {
    app.dock.setIcon(APP_ICON_PATH);
  }

  const stateStore = createStateStore(path.join(app.getPath("userData"), "launcher-state.json"));
  launcherStateStore = stateStore;
  updateApplicationMenu(stateStore.read().language);
  if (IS_DEV_PROFILE && !stateStore.read().onboardingComplete) {
    stateStore.update({
      language: stateStore.read().language || "en",
      onboardingComplete: true,
      autoStart: false,
    });
  }
  const persistedState = stateStore.read();
  if (persistedState.coreSetupComplete === true && persistedState.codexCatalogVerified === undefined) {
    stateStore.update({
      coreSetupComplete: false,
      codexCatalogVerified: false,
      codexRestartRequired: false,
    });
  }
  const autostart = IS_DEV_PROFILE ? { supported: false, enabled: false } : getAutostart(app);
  if (!IS_DEV_PROFILE
    && stateStore.read().onboardingComplete
    && autostart.supported
    && stateStore.read().autoStart !== autostart.enabled) {
    setAutostart(app, stateStore.read().autoStart);
  }
  logger = createLogger({
    filePath: path.join(app.getPath("logs"), "launcher.jsonl"),
    publish: (record) => send("launcher:log", record),
  });
  const launcherSmokeTest = process.argv.includes("--launcher-smoke-test");
  const hiddenLaunchRequested = process.argv.includes("--hidden");
  const startHidden = hiddenLaunchRequested && stateStore.read().onboardingComplete;
  const updateForegroundRequested = updateForegroundRequestPending;
  updateForegroundRequestPending = false;
  // The existing authenticated updater handoff is sufficient provenance for legacy workers.
  // Ordinary visible launches and explicit relaunches also request foreground activation;
  // a real --hidden autostart never does.
  const foregroundOnReady = !launcherSmokeTest && (
    updateForegroundRequested
    || foregroundRelaunchRequested
    || !hiddenLaunchRequested
  );
  nativeTheme.themeSource = "system";
  startupPhase = "window";
  mainWindow = createWindow({
    logger,
    stateStore,
    windowStatePath: path.join(app.getPath("userData"), "window-state.json"),
    startHidden,
    foregroundOnReady,
  });
  nativeTheme.on("updated", () => {
    if (stateStore.read().appearance === "system") applyAppTheme();
  });
  startupPhase = "browser-control";
  browserControl = await new BrowserControlServer({
    logger,
    getBrowserHost: () => browserHost,
    getPreferences: () => stateStore.read(),
    getAgentNativeBridge: () => agentNativeBridge,
    getAgentNativeInstance: () => agentNativeDescriptor?.instanceId,
    getAgentRemoteService: () => remoteWorkspaceService,
    getAgentRemoteInstance: () => agentRemoteDescriptor?.instanceId,
    getVmExportService: () => workspaceVmExportService,
    getVmExportInstance: () => agentVmExportDescriptor?.instanceId,
    getPythonBuildSelectionService: () => pythonBuildSelectionService,
    getPythonBuildSelectionInstance: () => agentPythonBuildDescriptor?.instanceId,
    getAgentOAuthMcpController: () => agentOAuthMcpController,
    getAgentOAuthMcpInstance: () => agentOAuthMcpDescriptor?.instanceId,
    getOwnedConversationHistoryService: () => persistentNativeConversations,
    getOwnedConversationHistoryInstance: () => ownedConversationDescriptor?.instanceId,
    validateRemoteInvalidation: body => {
      if (!body || typeof body !== 'object' || Array.isArray(body)
        || Object.keys(body).some(key => !['taskId', 'familyId', 'beforeGeneration'].includes(key))) throw new Error('Invalid remote invalidation');
      return validateRemoteCoreAuthority('validate-invalidation', body, true);
    },
    validateNativeInvalidation: async body => {
      if (!body || typeof body !== 'object' || Array.isArray(body)
        || Object.keys(body).some(key => !['actionId', 'taskId', 'familyId', 'beforeGeneration'].includes(key))) throw new Error('Invalid Native invalidation');
      const config = runtimeSupervisor.readConfig();
      if (!config || !await runtimeSupervisor.ownedAgentRuntimeReady(config, { allowDraining: true })) throw new Error('Native runtime owner is unavailable');
      const receipt = await runtimeSupervisor.control(config, 'agent-native', { body: { action: 'validate-invalidation',
        taskId: body.taskId, familyId: body.familyId, beforeGeneration: body.beforeGeneration } });
      if (receipt?.ok !== true) throw new Error('Native invalidation scope changed');
      return receipt.value;
    },
    // A dedicated system-proxy session must not inherit any account's fixed/PAC proxy.
    resolveNativeProxy: url => resolveNativeRequestProxy(
      session.fromPartition(`nekodex-native-network-${LAUNCHER_PROFILE.kind}`), url),
  }).start();
  runtimeSupervisor = new RuntimeSupervisor({
    app,
    logger,
    sourceRoot: SOURCE_ROOT,
    installedRuntimeRoot,
    runtimeRootProvider,
    coreHome: CORE_HOME,
    browserDescriptorPath: BROWSER_DESCRIPTOR_PATH,
    launcherProfile: LAUNCHER_PROFILE.kind,
    publishOperation,
    publishCapabilities: capability => { lifecycleProjection.update(capability); browserHost?.publish(); },
    // Prime the daemon-owned route. While the GUI is alive, bounded background refreshes
    // use its authenticated control channel without holding every native request.
    nativeProxyEnvironmentProvider: async () => {
      try {
        const proxy = await resolveNativeRequestProxy(
          session.fromPartition(`nekodex-native-network-${LAUNCHER_PROFILE.kind}`),
          "https://chatgpt.com/backend-api/codex/responses");
        return nativeFallbackProxyEnvironment(proxy);
      } catch (error) {
        logger.warn("runtime.background_network_unavailable", { message: error.message });
        return {};
      }
    },
    tunnelProxyEnvironmentProvider: () => resolveTunnelProxyEnvironment(session.fromPartition(LAUNCHER_PROFILE.browserPartition)),
  });
  runtimeHost = new RuntimeHost({
    app,
    logger,
    sourceRoot: SOURCE_ROOT,
    installedRuntimeRoot,
    runtimeRootProvider,
    browserDescriptorPath: BROWSER_DESCRIPTOR_PATH,
    coreHome: CORE_HOME,
    codexHome: LAUNCHER_PROFILE.codexHome,
    launcherProfile: LAUNCHER_PROFILE.kind,
    publishOperation,
    supervisor: runtimeSupervisor,
    getBrowserInteractionMode: () => stateStore.read().browserInteractionMode,
  });
  agentNativeBridge = createAgentNativeBridge({
    canStart: () => !quitting && !shutdownInProgress && !exitCommitted && !lifecycleAdmission.busy(),
    validateOffer: async (envelope, payloadDigest) => {
      const config = runtimeSupervisor.readConfig();
      if (!config || !await runtimeSupervisor.ownedAgentRuntimeReady(config)) throw new Error('Native runtime owner is unavailable');
      const receipt = await runtimeSupervisor.control(config, 'agent-native', { body: { action: 'validate-offer',
        scope: envelope.scope, model: envelope.model, admissionId: envelope.admissionId, payloadDigest } });
      if (receipt?.ok !== true) throw new Error('Native offer scope changed');
      return receipt.value;
    },
    // Only qualified own-profile metadata can create a model admission. Readiness
    // never starts a profile, child, thread, inventory transaction or login.
    resolveAdmission: (admissionId, model) => nativeAccountExecution?.resolveAdmission(admissionId, model),
  });
  if (process.platform === 'darwin') {
    try {
      agentNativeDescriptor = createAgentNativeDescriptorPublisher({ coreHome: CORE_HOME, profile: LAUNCHER_PROFILE.kind,
        control: browserControl.descriptor() });
      agentNativeDescriptor.publish({ models: [], accepting: false });
    } catch {
      // Optional Native admission cannot prevent unrelated launcher functions from opening.
      agentNativeDescriptor = null;
      logger.warn('agent_native.descriptor_unavailable', { reasonCode: 'private-profile-unavailable' });
    }
  }
  const configuredInteractionMode = runtimeHost.runtimeConfigSnapshot().config?.browserInteractionMode;
  try {
    agentRemoteDescriptor = createAgentRemoteDescriptorPublisher({ coreHome: CORE_HOME, profile: LAUNCHER_PROFILE.kind, control: browserControl.descriptor() });
    agentRemoteDescriptor.publish();
  } catch {
    agentRemoteDescriptor = null;
    logger.warn('agent_remote.descriptor_unavailable', { reasonCode: 'private-profile-unavailable' });
  }
  try {
    agentVmExportDescriptor = createAgentVmExportDescriptorPublisher({ coreHome: CORE_HOME, profile: LAUNCHER_PROFILE.kind, control: browserControl.descriptor() });
    agentVmExportDescriptor.publish();
  } catch {
    agentVmExportDescriptor = null;
    logger.warn('agent_vm_export.descriptor_unavailable', { reasonCode: 'private-profile-unavailable' });
  }
  try {
    agentPythonBuildDescriptor = createAgentPythonBuildDescriptorPublisher({ coreHome: CORE_HOME, profile: LAUNCHER_PROFILE.kind, control: browserControl.descriptor() });
    agentPythonBuildDescriptor.publish();
  } catch {
    agentPythonBuildDescriptor = null;
    logger.warn('agent_python_build.descriptor_unavailable', { reasonCode: 'private-profile-unavailable' });
  }
  try {
    agentOAuthMcpDescriptor = createAgentOAuthMcpDescriptorPublisher({ coreHome: CORE_HOME, profile: LAUNCHER_PROFILE.kind, control: browserControl.descriptor() });
    agentOAuthMcpDescriptor.publish();
  } catch {
    agentOAuthMcpDescriptor = null;
    logger.warn('agent_oauth_mcp.descriptor_unavailable', { reasonCode: 'private-profile-unavailable' });
  }
  try {
    ownedConversationDescriptor = createOwnedConversationDescriptorPublisher({ coreHome: CORE_HOME,
      profile: LAUNCHER_PROFILE.kind, control: browserControl.descriptor() });
    publishOwnedConversationScopes();
  } catch {
    ownedConversationDescriptor = null;
    logger.warn('owned_conversation.descriptor_unavailable', { reasonCode: 'private-profile-unavailable' });
  }
  contextChangeQueue?.stop();
  contextChangeQueue = createContextChangeQueue({
    read: () => stateStore.read(),
    write: patch => { const state = stateStore.update(patch); send("launcher:state-changed", state); },
    ready: async () => {
      if (quitting || shutdownInProgress || lifecycleAdmission.busy() || runtimeHost.currentOperation()) return false;
      const current = runtimeHost.runtimeConfigSnapshot();
      if (!current.configured || current.config?.browserInteractionMode === "manual") {
        throw new Error("Pending context change requires an installed automatic model route");
      }
      const health = await runtimeSupervisor.proxyHealthPayload(current.config).catch(() => null);
      if (quitting || shutdownInProgress || exitCommitted || lifecycleAdmission.busy() || runtimeHost.currentOperation()) return false;
      const latest = runtimeHost.runtimeConfigSnapshot();
      if (!latest.configured || latest.owner !== current.owner || latest.serialized !== current.serialized) return false;
      return health?.status === "ok" && health.accepting_turns === true
        && health.active_http_turns === 0 && health.active_browser_turns === 0
        && health.active_compaction_runs === 0;
    },
    apply: enabled => {
      if (quitting || shutdownInProgress || exitCommitted || lifecycleAdmission.busy()) {
        throw Object.assign(new Error("Context change deferred while NEKODEX is shutting down"), { code: "RUNTIME_BUSY" });
      }
      return runtimeHost.setBiggerContext(enabled);
    },
    onApplied: enabled => {
      invalidateAccountProof(stateStore);
      const state = stateStore.update({ experimentalBiggerContext: enabled, codexCatalogVerified: false,
        codexPickerConfirmed: false, codexRestartRequired: true, contextChangeError: null });
      send("launcher:state-changed", state);
      startCatalogVerificationMonitor({ logger, stateStore });
    },
  });
  if ((configuredInteractionMode === "automatic" || configuredInteractionMode === "manual")
    && stateStore.read().browserInteractionMode !== configuredInteractionMode) {
    stateStore.update({ browserInteractionMode: configuredInteractionMode });
  }
  startupPhase = "browser";
  const profileFirstLogin = createProfileFirstLogin({
    choose: createChromeProfileChoice({
      root: path.join(app.getPath("home"), "Library", "Application Support", "Google", "Chrome"),
      coreHome: CORE_HOME, BrowserWindow, dialog, window: () => mainWindow,
      getWorkArea: () => screen.getDisplayMatching(mainWindow.getBounds()).workArea,
      // Existing-profile metadata and launches are deliberately paired to macOS Stable Chrome.
      // A configured Beta/Canary/Chromium executable remains available through isolated sign-in;
      // its unrelated "Profile N" directory must never be selected from Stable's catalog.
      executable: () => "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      language: () => stateStore.read().language,
      picker: options => showChromeProfilePicker({ ...options, theme: resolvedAppTheme(stateStore.read()) }),
    }), runtime: runtimeHost, session, dialog, window: () => mainWindow, language: () => stateStore.read().language,
    selectConnectionFile: ({ signal, accountId }) => selectChromeConnectionFile({
      dialog, window: mainWindow, homeDir: app.getPath("home"), language: stateStore.read().language, signal,
      isCurrent: () => browserHost?.getHost(accountId).passkeyLoginController?.signal === signal
        && mainWindow && !mainWindow.isDestroyed(),
    }),
  });
  browserHost = new AccountBrowserPool({
    taskPlans,
    skipInitialNavigation: launcherSmokeTest,
    getManualSubmitTimeoutSec: () => stateStore.read().manualSubmitTimeoutSec,
    coreHome: CORE_HOME,
    maxTabs: ACTIVE_BROWSER_CAPACITY,
    window: mainWindow,
    descriptorPath: BROWSER_DESCRIPTOR_PATH,
    cdpPort,
    control: browserControl.descriptor(),
    cancelTurn: IS_DEV_PROFILE ? undefined : (traceId, reason) => runtimeSupervisor.cancelBrowserTurn(traceId, reason),
    getConnectorName: () => runtimeHost.browserConnectorName(),
    getAccountTunnel: (id, mode) => {
      const config = runtimeHost.runtimeConfigSnapshot().config;
      const view = require('./account-tunnels.cjs').accountTunnelView(config, id, mode,
        runtimeSupervisor.getAccountTunnelStatus?.(id, mode), browserHost?.hosts.get(id)?.authPrincipalFingerprint);
      // The desktop account router never gives an account an unassigned legacy tunnel.
      return { ...view, required: true };
    },
    helper: { executable: process.execPath, script: BROWSER_HELPER_PATH },
    logger,
    loginWithPasskey: (onProgress, context) => stateStore.read().passkeyBrowser === "firefox"
      ? runtimeHost.capturePasskeyLogin(onProgress, "firefox") : profileFirstLogin(onProgress, context),
    loginWithChromeProfile: profileFirstLogin,
    loginWithExistingChrome: (onProgress, options) => runtimeHost.captureExistingChromeLogin(onProgress, options),
    partition: LAUNCHER_PROFILE.browserPartition,
    profile: LAUNCHER_PROFILE.kind,
    workspaceDisplays: () => screen.getAllDisplays(),
    publishState: (state) => send("launcher:browser-state", state),
    showWindow: showMainWindow,
    getBrowserInteractionMode: () => stateStore.read().browserInteractionMode,
    getLanguage: () => stateStore.read().language,
    bootstrapAccountConnectors: () => {
      const runtime = runtimeHost.runtimeConfigSnapshot();
      return stateStore.read().browserInteractionMode === "automatic"
        && runtime.configured && runtime.config?.mode === "full"
        && runtime.config?.browserInteractionMode === "automatic";
    },
    // The selected account's picker evidence decides which Web models Codex lists.
    onCapabilityEvidence: async (_accountId, evidence) => {
      const result = await runtimeHost.saveModelCapabilities(evidence);
      reconcileCodexPicker(stateStore, logger);
      return result;
    },
    isBrowserInView: () => Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()
      && !mainWindow.isMinimized() && browserHost?.surfaceActive),
  });
  await browserHost.ready();
  if (!IS_DEV_PROFILE) contextChangeQueue.start();
  const updaterRuntimeRoot = runtimeRootProvider();
  updateController = createUpdateController({
    currentVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    packaged: app.isPackaged && !IS_DEV_PROFILE,
    executablePath: process.execPath,
    runtimeExecutable: updaterRuntimeRoot
      ? runtimeBundlePaths(updaterRuntimeRoot, process.platform).executable
      : null,
    logsDirectory: app.getPath("logs"),
    publish: (state) => send("launcher:update-state", state),
    logger,
  });
  accountToolsService = createCodexAccountTools({
    getPool: () => browserHost,
    getInteractionMode: () => stateStore.read().browserInteractionMode,
    BrowserWindow, clipboard, codexHome: LAUNCHER_PROFILE.codexHome, logger,
    openExternal: url => shell.openExternal(url),
  });
  registerLifecycleParticipant("Codex account sign-in", accountToolsService);
  const startupOwner = lifecycleAdmission.acquire("local runtime startup");
  registerIpc({ logger, stateStore });
  const trayAvailable = createTray(logger, stateStore.read().language);
  if (startHidden && !trayAvailable) mainWindow.once("ready-to-show", () => showMainWindow());
  let startupAuthenticationRefresh = Promise.resolve();
  if (!launcherSmokeTest && stateStore.read().browserInteractionMode === "automatic") {
    startupAuthenticationRefresh = browserHost.refreshAuthentication().catch((error) => {
      logger.warn("browser.session_refresh_failed", {
        ...navigationErrorForLog(error),
      });
    });
  }
  if (!launcherSmokeTest && !IS_DEV_PROFILE) {
    reconcileCodexPicker(stateStore, logger);
    const pickerCheckTimer = setInterval(() => {
      if (shutdownInProgress || quitting || exitCommitted) return;
      try { reconcileCodexPicker(stateStore, logger); }
      catch (error) { logger.warn("codex.picker_catalog_check_failed", { message: error instanceof Error ? error.message : String(error) }); }
    }, CODEX_PICKER_CHECK_MS);
    pickerCheckTimer.unref?.();
  }
  if (!launcherSmokeTest) {
    // Re-read the model picker every few hours so new or retired ChatGPT models reach Codex.
    const capabilityRefreshTimer = setInterval(() => {
      if (lifecycleAdmission.busy() || shutdownInProgress || quitting || exitCommitted) return;
      void browserHost?.refreshSelectedCapabilitiesIfIdle(MODEL_CAPABILITY_REFRESH_MS);
    }, MODEL_CAPABILITY_REFRESH_CHECK_MS);
    capabilityRefreshTimer.unref?.();
  }
  void startupAuthenticationRefresh.then(() => {
    if (!lifecycleAdmission.busy() && !shutdownInProgress && !quitting && !exitCommitted) ensureRuntimeProofCurrent(stateStore);
  });
  const finishRuntimeStartup = () => {
    try {
      if (!shutdownInProgress && !quitting && !exitCommitted) ensureRuntimeProofCurrent(stateStore);
    } catch (error) {
      logger.warn("runtime.startup_proof_reconciliation_failed", { message: error.message });
    } finally {
      lifecycleAdmission.release(startupOwner);
    }
  };
  // Shared by both failed-start paths. Returns whether the previous verified
  // runtime remains usable; if not, setup proof is retired before route recovery.
  const markRuntimeStartFailed = () => {
    stopCatalogVerificationMonitor();
    const capabilities = runtimeSupervisor.capabilitySnapshot();
    const priorRuntimeUsable = capabilities.nativeAvailability === "ready";
    if (!priorRuntimeUsable) {
      retireAccountProof();
      const state = stateStore.update({ coreSetupComplete: false, codexCatalogVerified: false,
        mcpSetupComplete: false });
      send("launcher:state-changed", state);
    }
    return priorRuntimeUsable;
  };
  startupPhase = "renderer";
  await loadRenderer(mainWindow);
  rendererStartupComplete = true;
  startupPhase = "runtime";
  if (!launcherSmokeTest) void updateController.checkOnce();
  if (launcherSmokeTest) {
    const smokeRuntimeRoot = runtimeRootProvider();
    if (app.isPackaged && !smokeRuntimeRoot) {
      throw new Error("Packaged launcher smoke test could not install its durable runtime");
    }
    const versionInvocation = runtimeSupervisor.runtimeCommand(["--version"]);
    const versionResult = spawnSync(versionInvocation.executable, versionInvocation.args, {
      cwd: versionInvocation.cwd,
      encoding: "utf8",
      timeout: 30_000,
      windowsHide: true,
    });
    if (versionResult.error) throw versionResult.error;
    if (versionResult.status !== 0 || versionResult.stdout.trim() !== app.getVersion()) {
      throw new Error(
        `Installed launcher runtime is not executable`
        + ` (status=${versionResult.status ?? "unknown"}, stdout=${JSON.stringify(versionResult.stdout.trim())},`
        + ` stderr=${JSON.stringify(versionResult.stderr.trim())})`,
      );
    }
    const markerPath = process.env.CODEX_WEB_GPT_SMOKE_FILE?.trim();
    if (!markerPath || !path.isAbsolute(markerPath)) {
      throw new Error("Packaged launcher smoke test requires an absolute CODEX_WEB_GPT_SMOKE_FILE");
    }
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    fs.writeFileSync(markerPath, `${JSON.stringify({
      ok: true,
      version: app.getVersion(),
      platform: process.platform,
      packaged: app.isPackaged,
      runtimeVerified: true,
    })}\n`);
    await closeBrowserResources();
    mainWindow.destroy();
    app.quit();
    return;
  }
  if (IS_DEV_PROFILE) {
    retireAccountProof();
    let config = null;
    try {
      config = runtimeSupervisor.readConfig();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("dev_profile.config_invalid", { message });
      publishOperation({ name: "dev-profile", status: "failed", message });
    }
    const legacyConnector = config && [config.appName, config.automaticAppName, config.manualAppName]
      .some(name => typeof name === "string" && isLegacyConnectorName(name));
    const state = stateStore.update({
      coreSetupComplete: Boolean(config) && !legacyConnector,
      codexCatalogVerified: Boolean(config) && !legacyConnector,
      ...(legacyConnector ? { mcpSetupComplete: false, mcpGuideStep: 0,
        browserSmokePassed: false, browserSmokeVersion: null } : {}),
      mcpRuntimeInstalled: config?.mode === "full",
      ...(config?.mode !== "full" ? { mcpSetupComplete: false, mcpGuideStep: 0 } : {}),
      codexRestartRequired: false,
      autoStart: false,
      experimentalAsyncToolOperations: config?.experimentalAsyncToolOperations === true,
      experimentalBiggerContext: config?.experimentalBiggerContext === true,
      experimentalSkillAttachments: config?.experimentalSkillAttachments === true,
      allowWebSubagents: config?.allowWebSubagents !== false,
      experimentalFreshConversationPerTurn: config?.experimentalFreshConversationPerTurn === true,
      zeroRiskProEnabled: config?.zeroRiskProEnabled === true,
    });
    send("launcher:state-changed", state);
    logger.info("dev_profile.ready", {
      configured: Boolean(config),
      mode: config?.mode || null,
      coreHome: CORE_HOME,
      userData: launcherUserData,
    });
    if (config?.mode === "full" && !legacyConnector) {
      void runtimeSupervisor.startIfConfigured().catch((error) => {
        if (shutdownInProgress || quitting || exitCommitted) return;
        const message = error instanceof Error ? error.message : String(error);
        retireAccountProof();
        logger.error("dev_profile.runtime_start_failed", { message });
        const failed = stateStore.update({ mcpSetupComplete: false });
        send("launcher:state-changed", failed);
      }).finally(finishRuntimeStartup);
    } else finishRuntimeStartup();
  } else void (async () => {
    if (shutdownInProgress || quitting || exitCommitted) return { status: "cancelled" };
    retireAccountProof();
    const surviving = runtimeHost.runtimeConfigSnapshot();
    if (surviving.configured && surviving.owner === "launcher") {
      // Keep the surviving generation visible even when pending rollback or upgrade must
      // wait for active work. Recovery may stop it only through the existing idle drain.
      await runtimeSupervisor.adoptBackgroundDaemon(surviving.config);
    }
    const recoveredGeneration = await runtimeHost.recoverManagedRuntimeGeneration();
    if (recoveredGeneration.status !== "none") logger.warn("runtime.startup_generation_recovered", recoveredGeneration);
    const before = runtimeHost.runtimeConfigSnapshot();
    const legacyUpdateBootstrap = Boolean(updateReadinessHandoff
      && before.configured && before.owner === "launcher"
      && before.config?.releaseVersion !== app.getVersion());
    const upgrade = legacyUpdateBootstrap
      ? { updated: false, deferredUntilUpdateCommit: true }
      : await runtimeHost.upgradeManagedRuntime();
    if (shutdownInProgress || quitting || exitCommitted) return { status: "cancelled" };
    if (upgrade.updated) logger.info("runtime.release_generation_staged", {
      fromVersion: upgrade.fromVersion, toVersion: upgrade.toVersion, generationId: upgrade.generationId,
    });
    const configuredRuntime = runtimeHost.runtimeConfigSnapshot();
    if (configuredRuntime.configured) {
      const enabled = configuredRuntime.config?.experimentalBiggerContext === true;
      const experimentalAsyncToolOperations = configuredRuntime.config?.experimentalAsyncToolOperations === true;
      const experimentalSkillAttachments = configuredRuntime.config?.experimentalSkillAttachments === true;
      const allowWebSubagents = configuredRuntime.config?.allowWebSubagents !== false;
      const experimentalFreshConversationPerTurn = configuredRuntime.config?.experimentalFreshConversationPerTurn === true;
      const zeroRiskProEnabled = configuredRuntime.config?.zeroRiskProEnabled === true;
      const saved = stateStore.read();
      if (saved.experimentalAsyncToolOperations !== experimentalAsyncToolOperations
        || saved.allowWebSubagents !== allowWebSubagents
        || saved.experimentalFreshConversationPerTurn !== experimentalFreshConversationPerTurn
        || saved.experimentalSkillAttachments !== experimentalSkillAttachments
        || saved.experimentalBiggerContext !== enabled
        || saved.zeroRiskProEnabled !== zeroRiskProEnabled) {
        const state = stateStore.update({ experimentalAsyncToolOperations, experimentalBiggerContext: enabled,
          experimentalSkillAttachments, experimentalFreshConversationPerTurn, allowWebSubagents, zeroRiskProEnabled });
        send("launcher:state-changed", state);
      }
    }
    if (shutdownInProgress || quitting || exitCommitted) return { status: "cancelled" };
    const allowCommittedVersion = legacyUpdateBootstrap || upgrade.repairRequired === true || upgrade.busy === true;
    const generationId = typeof upgrade.generationId === "string" ? upgrade.generationId : null;
    let generationCommitted = false;
    let fallbackAttempted = false;
    const restorePreviousGeneration = async failure => {
      fallbackAttempted = true;
      const fallback = await runtimeHost.rollbackManagedRuntimeUpgrade(generationId);
      lifecycleProjection.update({ routeStatus: "switching" });
      const route = await runtimeHost.connectBridgeRoute();
      lifecycleProjection.update({ routeStatus: "managed" });
      return { ...fallback.runtime, status: "ready", bridgeRouteChanged: route.changed === true,
        candidateUpgradeError: failure instanceof Error ? failure.message : String(failure),
        upgrade: { ...upgrade, rolledBack: true } };
    };
    try {
      const runtime = await runtimeSupervisor.startIfConfigured({ allowCommittedVersion });
      if (runtime.status === "not-configured") {
        proveUpdateReadiness(updateReadinessHandoff, {
          version: app.getVersion(), readinessSchema: 2, lifecycleStatus: "not-configured",
          nativeAvailability: "unavailable", webAvailability: "unavailable", configVersion: null,
          lifecycleRevision: runtimeSupervisor.capabilitySnapshot().revision,
        }, updateReadinessHandoff ? runtimeSupervisor.runtimeCommand(["--version"]) : null);
        return { ...runtime, upgrade };
      }
      if (runtime.status !== "ready") {
        if (generationId) return await restorePreviousGeneration(new Error(runtime.detail || `Candidate runtime returned ${runtime.status}`));
        return { ...runtime, upgrade };
      }
      if (shutdownInProgress || quitting || exitCommitted) return { status: "cancelled", upgrade };
      lifecycleProjection.update({ routeStatus: "switching" });
      const route = await runtimeHost.connectBridgeRoute();
      lifecycleProjection.update({ routeStatus: "managed" });
      if (generationId) {
        runtimeHost.commitManagedRuntimeUpgrade(generationId);
        generationCommitted = true;
        pruneInstalledRuntimeVersions(upgrade.fromVersion);
        logger.info("runtime.release_upgraded", { fromVersion: upgrade.fromVersion,
          toVersion: upgrade.toVersion, mode: upgrade.mode, generationId });
      }
      const config = runtimeSupervisor.readConfig();
      const capabilities = runtimeSupervisor.capabilitySnapshot(config);
      proveUpdateReadiness(updateReadinessHandoff, {
        version: app.getVersion(), readinessSchema: 2, lifecycleStatus: "local-usable",
        nativeAvailability: capabilities.nativeAvailability, webAvailability: capabilities.webAvailability,
        configVersion: config.releaseVersion, lifecycleRevision: capabilities.revision,
        legacyCommittedRuntime: config.releaseVersion !== app.getVersion(),
      }, updateReadinessHandoff ? runtimeSupervisor.runtimeCommand(["--version"]) : null);
      return { ...runtime, upgrade, bridgeRouteChanged: route.changed === true };
    } catch (error) {
      if (!generationId || generationCommitted || fallbackAttempted) throw error;
      return await restorePreviousGeneration(error);
    }
  })().then(async (runtime) => {
    if (shutdownInProgress || quitting || exitCommitted) return;
    if (runtime.status === "cancelled") return;
    if (runtime.status === "ready") {
      const config = runtimeSupervisor.readConfig();
      const current = stateStore.read();
      const patch = {
        coreSetupComplete: true,
        runtimeMigrationPending: config.releaseVersion !== app.getVersion(),
        launcherRestartRequired: false,
        mcpRuntimeInstalled: config.mode === "full",
        experimentalAsyncToolOperations: config.experimentalAsyncToolOperations === true,
        experimentalBiggerContext: config.experimentalBiggerContext === true,
        experimentalSkillAttachments: config.experimentalSkillAttachments === true,
        experimentalFreshConversationPerTurn: config.experimentalFreshConversationPerTurn === true,
        zeroRiskProEnabled: config.zeroRiskProEnabled === true,
        ...(runtime.bridgeRouteChanged ? {
          codexCatalogVerified: false,
          codexRestartRequired: true,
        } : {}),
        ...(config.mode === "browser-only" ? {
          mcpSetupComplete: false,
          mcpGuideStep: 0,
        } : {}),
      };
      if (Object.entries(patch).some(([key, value]) => current[key] !== value)) {
        const state = stateStore.update(patch);
        send("launcher:state-changed", state);
      }
      startCatalogVerificationMonitor({ logger, stateStore });
      // The surviving runtime keeps serving while the app is replaced. Switch to the new
      // runtime in this session once the update is committed and the runtime is idle.
      if (runtime.upgrade?.deferredUntilUpdateCommit || runtime.upgrade?.busy) {
        scheduleRuntimeActivation(runtime.upgrade.deferredUntilUpdateCommit ? "app-update" : "busy-runtime");
      }
      if (runtime.candidateUpgradeError) {
        publishOperation({ name: "runtime-upgrade", status: "failed",
          message: `${runtime.candidateUpgradeError}; the previous verified runtime was restored` });
      }
      if (runtime.upgrade?.repairRequired) {
        publishOperation({ name: "runtime-repair", status: "failed", message: runtime.upgrade.detail });
      }
      return;
    }
    if (runtime.status === "not-configured") {
      stopCatalogVerificationMonitor();
      retireAccountProof();
      const state = stateStore.update({
        coreSetupComplete: false,
        codexCatalogVerified: false,
        mcpRuntimeInstalled: false,
        mcpSetupComplete: false,
        mcpGuideStep: 0,
      });
      send("launcher:state-changed", state);
      const routeRecovery = await restoreCodexRouteAfterRuntimeFailure({ logger, stateStore });
      if (routeRecovery.skipped || shutdownInProgress || quitting || exitCommitted) return;
      if (routeRecovery.error) {
        publishOperation({
          name: "runtime-start",
          status: "failed",
          message: `Local runtime is not configured; restoring the previous Codex route also failed: ${routeRecovery.error}`,
        });
      }
      return;
    }
    const priorRuntimeUsable = markRuntimeStartFailed();
    const routeRecovery = priorRuntimeUsable
      ? { restored: false, skipped: true }
      : await restoreCodexRouteAfterRuntimeFailure({ logger, stateStore });
    if (priorRuntimeUsable) {
      publishOperation({ name: "runtime-start", status: "failed",
        message: `${runtime.detail || "Candidate runtime transition failed"}; the previous verified runtime remains available` });
      return;
    }
    if (routeRecovery.skipped || shutdownInProgress || quitting || exitCommitted) return;
    if (runtime.status === "external" || runtime.status === "needs-setup") {
      const detail = runtime.detail || (
        runtime.status === "external"
          ? "Another process owns the configured NEKODEX runtime"
          : "The installed runtime configuration must be repaired from Setup"
      );
      publishOperation({
        name: "runtime-start",
        status: "failed",
        message: routeRecovery.error
          ? `${detail}; restoring the previous Codex route also failed: ${routeRecovery.error}`
          : routeRecovery.restored
            ? `${detail}; the previous Codex route was restored, restart Codex once`
            : detail,
      });
    }
  }).catch(async (error) => {
    if (shutdownInProgress || quitting || exitCommitted) return;
    const primary = error instanceof Error ? error.message : String(error);
    const priorRuntimeUsable = markRuntimeStartFailed();
    const routeRecovery = priorRuntimeUsable
      ? { restored: false, skipped: true }
      : await restoreCodexRouteAfterRuntimeFailure({ logger, stateStore });
    if (priorRuntimeUsable) {
      const message = `${primary}; the previous verified runtime remains available`;
      logger.error("runtime.startup_candidate_failed", { message });
      publishOperation({ name: "runtime-start", status: "failed", message });
      return;
    }
    if (routeRecovery.skipped || shutdownInProgress || quitting || exitCommitted) return;
    const message = routeRecovery.error
      ? `${primary}; restoring the previous Codex route also failed: ${routeRecovery.error}`
      : routeRecovery.restored
        ? `${primary}; the previous Codex route was restored, restart Codex once`
        : primary;
    logger.error("runtime.startup_failed", { message });
    publishOperation({ name: "runtime-start", status: "failed", message });
  }).finally(finishRuntimeStartup);

  app.on("activate", () => showMainWindow({ activateApplication: true }));
  app.on("before-quit", (event) => {
    if (exitCommitted) return;
    event.preventDefault();
    void requestQuit();
  });
  // Keep ownership cleanup reachable after an operation refuses Quit. Repeated signals
  // retry once the current attempt settles; they never invoke the platform default exit.
  let signalQuitPending = false;
  let signalQuitRunning = false;
  const requestSignalQuit = () => {
    if (exitCommitted) return;
    signalQuitPending = true;
    if (signalQuitRunning) return;
    signalQuitRunning = true;
    void (async () => {
      try {
        do {
          signalQuitPending = false;
          await requestQuit();
        } while (signalQuitPending && !exitCommitted);
      } finally {
        signalQuitRunning = false;
      }
    })();
  };
  process.on("SIGINT", requestSignalQuit);
  process.on("SIGTERM", requestSignalQuit);
}

void start().catch(error => recoverStartupFailure({
  app,
  dialog,
  error,
  phase: startupPhase,
  launchEnvironment,
  language: (() => {
    try { return createStateStore(path.join(app.getPath("userData"), "launcher-state.json")).read().language || "en"; }
    catch { return "en"; }
  })(),
  interactive: !process.argv.includes("--launcher-smoke-test"),
  recordFailure: details => fs.appendFileSync(path.join(app.getPath("logs"), "launcher-fatal.log"),
    `${JSON.stringify({ at: new Date().toISOString(), ...details })}\n`, { mode: 0o600 }),
  cleanup: async () => {
    quitting = true;
    exitCommitted = true;
    stopCatalogVerificationMonitor();
    // Each release is independent: one failed view must not skip the control socket or
    // leave a hidden window holding the app alive while recovery is displayed.
    try { tray?.destroy(); } catch {}
    try { mainWindow?.destroy(); } catch {}
    await closeBrowserResources();
  },
}));
