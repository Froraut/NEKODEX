const { createChromeProfileChoice } = require("./chrome-profile-choice.cjs");
const { createProfileFirstLogin } = require("./profile-first-login.cjs");
const { catalogReceipt } = require("./catalog-receipt.cjs");
const { AccountBrowserPool } = require("./account-pool.cjs");
const { createCodexAccountTools } = require("./codex-account-tools.cjs");
const { MANUAL_CONNECTOR_NAME, automaticConnectorName, isLegacyConnectorName } = require("./connector-identity.cjs");
const { CAPACITY_ENV, MAX_BROWSER_CAPACITY, readBrowserCapacity, saveBrowserCapacity } = require("./browser-capacity.cjs");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
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
} = require("electron");
const { nativeFallbackProxyEnvironment, resolveNativeRequestProxy, resolveTunnelProxyEnvironment } = require("./native-proxy.cjs");
const LANGUAGES = require("./languages.json");
const { applicationMenu } = require("./application-menu.cjs");
const { installHermesProvider } = require("./hermes-integration.cjs");
const { BrowserHost, navigationErrorForLog } = require("./browser-host.cjs");
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
const { ensurePackagedRuntime, installedRuntimeRoot: resolveInstalledRuntimeRoot, waitForPackagedRuntimeSource } = require("./runtime-install.cjs");
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
  nextSessionRefreshReminderAt,
  validateSidebarState,
} = require("./state.cjs");
const {
  MIN_WINDOW_BOUNDS,
  readWindowState,
  trackWindowState,
} = require("./window-state.cjs");

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
        const state = stateStore.update({ codexRestartRequired: false });
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
      const state = stateStore.update({
        codexCatalogVerified: true,
        codexRestartRequired: false,
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
  const svg = fs.readFileSync(path.join(__dirname, "..", "assets", "tray.svg"), "utf8");
  const image = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
  image.setTemplateImage(true);
  return image;
}

const NATIVE_COPY = Object.freeze({
  ru: Object.freeze({
    openLauncher: "Открыть NEKODEX", quit: "Закрыть интерфейс — native продолжит работу", stopAndQuit: "Остановить соединения и выйти", exportDiagnostics: "Экспортировать диагностику без личных данных",
    cancel: "Отмена", remove: "Удалить", removeTitle: "Удалить NEKODEX",
    removeMessage: "Удалить модели ChatGPT Web из Codex и восстановить прежний маршрут моделей?",
    removeDetail: "Профиль входа ChatGPT в NEKODEX сохранится. Codex потребуется один раз перезапустить.",
    catalogFailure: "Codex подключился к NEKODEX, но загрузка списка моделей завершилась ошибкой (HTTP {status}; {reason}). Проверьте маршрутизацию и события. Если ошибка повторяется, экспортируйте диагностику без личных данных.",
  }),
  en: Object.freeze({
    openLauncher: "Open NEKODEX",
    quit: "Quit interface — keep native running",
    stopAndQuit: "Stop connections and quit",
    exportDiagnostics: "Export privacy-safe diagnostics",
    cancel: "Cancel",
    remove: "Remove",
    removeTitle: "Remove NEKODEX",
    removeMessage: "Remove the ChatGPT Web models from Codex and restore the previous model route?",
    removeDetail: "The launcher's ChatGPT login profile will be preserved. Codex must be restarted once.",
    catalogFailure: "Codex reached NEKODEX, but loading the model catalog failed (HTTP {status}; {reason}). Check the routing details and Activity; export privacy-safe diagnostics if it persists.",
  }),
  "zh-CN": Object.freeze({
    openLauncher: "打开 NEKODEX",
    quit: "退出界面并保持原生模型运行",
    stopAndQuit: "停止连接并退出",
    exportDiagnostics: "导出隐私安全诊断",
    cancel: "取消",
    remove: "移除",
    removeTitle: "移除 NEKODEX",
    removeMessage: "从 Codex 中移除 ChatGPT Web 模型并恢复此前的模型路由？",
    removeDetail: "启动器中的 ChatGPT 登录 profile 会保留。Codex 需要重启一次。",
    catalogFailure: "Codex 已连接到 NEKODEX，但模型列表加载失败（HTTP {status}；{reason}）。请检查路由信息和“活动”；若问题持续，请导出隐私安全诊断。",
  }),
  "zh-TW": Object.freeze({
    openLauncher: "開啟 NEKODEX",
    quit: "關閉介面並保持原生模型執行",
    stopAndQuit: "停止連線並結束",
    exportDiagnostics: "匯出隱私安全診斷",
    cancel: "取消",
    remove: "移除",
    removeTitle: "移除 NEKODEX",
    removeMessage: "從 Codex 中移除 ChatGPT Web 模型並還原先前的模型路由？",
    removeDetail: "啟動器中的 ChatGPT 登入設定檔會保留。Codex 需要重新啟動一次。",
    catalogFailure: "Codex 已連線到 NEKODEX，但模型清單載入失敗（HTTP {status}；{reason}）。請檢查路由資訊與「活動」；若問題持續，請匯出隱私安全診斷。",
  }),
  ja: Object.freeze({
    openLauncher: "NEKODEX を開く",
    quit: "画面を終了してネイティブを維持",
    stopAndQuit: "接続を停止して終了",
    exportDiagnostics: "プライバシー保護済みの診断情報をエクスポート",
    cancel: "キャンセル",
    remove: "削除",
    removeTitle: "NEKODEX を削除",
    removeMessage: "Codex から ChatGPT Web モデルを削除し、以前のモデルルートを復元しますか？",
    removeDetail: "ランチャーの ChatGPT ログインプロファイルは保持されます。Codex を一度再起動する必要があります。",
    catalogFailure: "Codex は NEKODEX に接続しましたが、モデル一覧を読み込めませんでした（HTTP {status}、{reason}）。ルーティング情報とアクティビティを確認し、問題が続く場合はプライバシー保護済みの診断情報をエクスポートしてください。",
  }),
  ko: Object.freeze({
    openLauncher: "NEKODEX 열기",
    quit: "화면 종료 및 네이티브 유지",
    stopAndQuit: "연결 중지 후 종료",
    exportDiagnostics: "개인정보가 보호된 진단 정보 내보내기",
    cancel: "취소",
    remove: "제거",
    removeTitle: "NEKODEX 제거",
    removeMessage: "Codex에서 ChatGPT Web 모델을 제거하고 이전 모델 경로를 복원할까요?",
    removeDetail: "런처의 ChatGPT 로그인 프로필은 유지됩니다. Codex를 한 번 다시 시작해야 합니다.",
    catalogFailure: "Codex가 NEKODEX에 연결했지만 모델 목록을 불러오지 못했습니다(HTTP {status}; {reason}). 경로 정보와 활동을 확인하고 문제가 계속되면 개인정보가 보호된 진단 정보를 내보내세요.",
  }),
});

function nativeCopyFor(language) {
  return NATIVE_COPY[language] || NATIVE_COPY.en;
}

function updateApplicationMenu(language) {
  if (process.platform !== "darwin") return;
  const labels = { ru: "Проверить обновления…", en: "Check for updates…", "zh-CN": "检查更新…", "zh-TW": "檢查更新…", ja: "アップデートを確認…", ko: "업데이트 확인…" };
  Menu.setApplicationMenu(Menu.buildFromTemplate(applicationMenu({
    language,
    name: LAUNCHER_PROFILE.displayName,
    checkLabel: labels[language] || labels.en,
    quitLabel: nativeCopyFor(language).quit,
    stopLabel: nativeCopyFor(language).stopAndQuit,
    onStop: () => { void requestQuit({ stopRuntime: true }); },
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

function createWindow({ logger, stateStore, windowStatePath, startHidden, foregroundOnReady }) {
  const isMac = process.platform === "darwin";
  const state = stateStore.read();
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
    backgroundColor: "#1b1b24",
    titleBarStyle: isMac ? "hiddenInset" : "hidden",
    transparent: false,
    ...(isMac ? {
      trafficLightPosition: { x: 16, y: 17 },
      visualEffectState: "active",
    } : {
      titleBarOverlay: {
        color: "#1b1b24",
        symbolColor: "#a8a8a8",
        height: 52,
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
  window.webContents.on("did-fail-load", (_event, errorCode, _errorDescription, _validatedURL, isMainFrame) => {
    if (isMainFrame !== true || errorCode === -3 || !rendererStartupComplete || quitting || exitCommitted) return;
    void recoverMainRenderer(`main-frame-load-${errorCode}`);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    if (!rendererStartupComplete || quitting || exitCommitted) return;
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

async function loadRenderer(window) {
  if (isDev) {
    await window.loadURL(process.env.VITE_DEV_SERVER_URL);
    return;
  }
  await window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
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

const RENDERER_RECOVERY_COPY = Object.freeze({
  en: Object.freeze({
    title: "NEKODEX interface needs recovery",
    message: "The launcher interface stopped unexpectedly.",
    active: "An operation is still running. Keep NEKODEX open, let it finish, then open NEKODEX again to choose Restart. The local runtime stays available.",
    idle: "The local runtime will be restarted only if you explicitly choose Restart NEKODEX.",
    keep: "Keep running",
    restart: "Restart NEKODEX",
    retryFailed: "NEKODEX could not restart",
  }),
  ru: Object.freeze({
    title: "Интерфейс NEKODEX нужно восстановить",
    message: "Интерфейс приложения неожиданно остановился.",
    active: "Операция ещё выполняется. Оставьте NEKODEX запущенным, дождитесь её завершения и снова откройте NEKODEX, чтобы выбрать перезапуск. Локальная среда остаётся доступной.",
    idle: "Локальная среда будет перезапущена, только если вы явно выберете «Перезапустить NEKODEX».",
    keep: "Оставить запущенным",
    restart: "Перезапустить NEKODEX",
    retryFailed: "Не удалось перезапустить NEKODEX",
  }),
});

function rendererRecoveryCopy() {
  const language = launcherStateStore?.read().language;
  return RENDERER_RECOVERY_COPY[language] || RENDERER_RECOVERY_COPY.en;
}

function rendererRestartBlocked() {
  return Boolean(lifecycleAdmission.busy() || currentGlobalOperation() || browserHost?.hasActiveTurns());
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
      buttons: blocked ? [copy.keep] : [copy.keep, copy.restart],
      defaultId: blocked ? 0 : 1,
      cancelId: 0,
      noLink: true,
    };
    const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    const result = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
    if (result.response !== 1) return;
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
  if (reason.startsWith("renderer-")) {
    // On the pinned Electron build, reloading a crashed WebContents can retain a detached
    // main-frame wrapper. Keep IPC closed and offer a guarded application restart instead.
    rendererUnavailable = true;
    logger?.error("launcher.renderer_restart_required", { reason });
    await promptRendererRecovery();
    return;
  }
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
      await reloadOwnedRenderer(mainWindow);
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
  handle("launcher:snapshot", async () => ({
    profile: LAUNCHER_PROFILE.kind,
    profilePaths: {
      coreHome: CORE_HOME,
      codexHome: LAUNCHER_PROFILE.codexHome,
      userData: launcherUserData,
    },
    state: lifecycleAdmission.busy() ? stateStore.read() : ensureRuntimeProofCurrent(stateStore),
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
    mcpCredentialsConfigured: runtimeHost?.mcpCredentialsConfigured() ?? false,
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

  handle("launcher:browser-bounds", (event, bounds) => {
    browserHost?.setBounds(validateBounds(bounds), event.sender.getZoomFactor());
    return true;
  });
  handle("launcher:browser-surface-active", (_event, active) => browserHost.setSurfaceActive(active === true));
  handle("launcher:browser-show", () => browserHost.reveal(
    stateStore.read().browserInteractionMode === "automatic",
  ));
  handle("launcher:browser-hide", () => { browserHost?.hide(); return browserHost?.snapshot(); });
  handle("launcher:browser-navigate", (_event, action) => browserHost.navigate(action));
  handle("launcher:browser-zoom", (_event, action) => browserHost.zoom(action));
  handle("launcher:browser-tab-select", (_event, tabId) => browserHost.selectTab(tabId));
  handle("launcher:browser-tab-close", (_event, tabId, expectedTraceId) => browserHost.closeTab(tabId, expectedTraceId));
  handle("launcher:manual-prompt-copy", (_event, tabId) => browserHost.copyManualPrompt(tabId));
  handle("launcher:manual-prompt-sent", (_event, tabId) => browserHost.confirmManualSent(tabId));
  handle("launcher:browser-window-open", (_event, asTab = false) => {
    if (typeof asTab !== "boolean") throw new Error("Invalid browser window request");
    return browserHost.openWorkspaceWindow(asTab);
  });
  handle("launcher:browser-login", async () => {
    const browser = await browserHost.openLogin();
    if (browser.authenticated) {
      const state = stateStore.update({ sessionRefreshReminderAt: nextSessionRefreshReminderAt() });
      send("launcher:state-changed", state);
    }
    return browser;
  });
  handle("launcher:browser-passkey-login", async () => {
    const browser = await browserHost.openPasskeyLogin();
    if (browser.authenticated) {
      const state = stateStore.update({ sessionRefreshReminderAt: nextSessionRefreshReminderAt() });
      send("launcher:state-changed", state);
    }
    return browser;
  });
  handle("launcher:browser-passkey-login-continue", () => {
    if (browserHost.snapshot().passkeyLogin?.canImport !== true) throw new Error("No passkey sign-in is waiting for Continue");
    return runtimeHost.continuePasskeyLogin();
  });
  handle("launcher:browser-passkey-login-reveal", () => {
    if (browserHost.snapshot().passkeyLogin?.canReveal !== true) throw new Error("No dedicated Chrome sign-in is waiting");
    return runtimeHost.revealPasskeyLogin();
  });
  handle("launcher:browser-passkey-login-cancel", () => browserHost.cancelPasskeyLogin(() => runtimeHost.cancelPasskeyLogin()));
  handle("launcher:browser-existing-chrome-login", async () => {
    const browser = await browserHost.openExistingChromeLogin(() => confirmExistingChromeImport(dialog, mainWindow, stateStore.read().language));
    if (browser.authenticated) {
      const state = stateStore.update({ sessionRefreshReminderAt: nextSessionRefreshReminderAt() });
      send("launcher:state-changed", state);
    }
    return browser;
  });
  handle("launcher:browser-existing-chrome-login-cancel", () => browserHost.cancelExistingChromeLogin(() => runtimeHost.cancelExistingChromeLogin()));
  handle("launcher:browser-existing-chrome-file-access", async () => {
    const browser = await browserHost.allowExistingChromeFileAccess(signal => selectChromeConnectionFile({
      dialog, window: mainWindow, homeDir: app.getPath("home"), language: stateStore.read().language, signal,
      isCurrent: () => browserHost.existingChromeLoginController?.signal === signal
        && stateStore.read().browserInteractionMode === "automatic" && mainWindow && !mainWindow.isDestroyed(),
    }));
    if (browser.authenticated) {
      const state = stateStore.update({ sessionRefreshReminderAt: nextSessionRefreshReminderAt() });
      send("launcher:state-changed", state);
    }
    return browser;
  });
  handle("launcher:browser-existing-chrome-settings-copy", () => {
    clipboard.writeText(CHROME_SETTINGS_ADDRESS);
    return true;
  });
  handle("launcher:browser-logout", async () => {
    invalidateAccountProof(stateStore);
    const browser = await browserHost.logout();
    const state = stateStore.update({ sessionRefreshReminderAt: nextSessionRefreshReminderAt() });
    send("launcher:state-changed", state);
    return { browser, state };
  });
  handle("launcher:session-reminder-dismiss", () => {
    const state = stateStore.update({ sessionRefreshReminderAt: nextSessionRefreshReminderAt() });
    send("launcher:state-changed", state);
    return state;
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
      return report;
    }
    if (stateStore.read().browserInteractionMode === "manual") {
      if (!accountProofContextIsCurrent(proofContext, stateStore, { requireCoreSetup: true })) {
        throw new Error("MCP verification became stale before it could be published");
      }
      const state = stateStore.update({ mcpSetupComplete: true, setupContract: SETUP_CONTRACT, setupVerifiedAt: new Date().toISOString(),
        setupIdentityHash: setupIdentity(runtimeHost.runtimeConfigSnapshot().config, browserHost.snapshot().accountLabel),
        setupRuntimeIdentity: currentRuntimeIdentity(), setupConnectorName: runtimeHost.mcpConnectorName() });
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
      const state = stateStore.update({ mcpSetupComplete: true, setupContract: SETUP_CONTRACT, setupVerifiedAt: new Date().toISOString(),
        setupIdentityHash: setupIdentity(runtimeHost.runtimeConfigSnapshot().config, browserHost.snapshot().accountLabel),
        setupRuntimeIdentity: currentRuntimeIdentity(), setupConnectorName: runtimeHost.mcpConnectorName() });
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
      codexCatalogVerified: IS_DEV_PROFILE ? true : false,
      codexRestartRequired: IS_DEV_PROFILE ? false : true,
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
      codexRestartRequired: IS_DEV_PROFILE ? false : true,
    });
    send("launcher:state-changed", state);
    if (interactionModeChange) send("launcher:browser-state", browserHost.snapshot());
    if (!IS_DEV_PROFILE) startCatalogVerificationMonitor({ logger, stateStore });
    return { ok: true, stdout: result.stdout };
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
      codexCatalogVerified: IS_DEV_PROFILE ? true : false,
      codexRestartRequired: IS_DEV_PROFILE ? false : true,
    });
    send("launcher:state-changed", state);
    if (!IS_DEV_PROFILE) startCatalogVerificationMonitor({ logger, stateStore });
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
      send("launcher:browser-state", browserHost.snapshot());
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
    if (browserHost.activeTraceId || browserHost.currentOperation()) {
      throw new Error("Finish or cancel active ChatGPT turns before changing Fresh conversation per turn");
    }
    const result = await runtimeHost.setFreshConversation(enabled === true);
    const state = stateStore.update({ experimentalFreshConversationPerTurn: result.enabled });
    send("launcher:state-changed", state);
    return state;
  });
  handle("launcher:cancel-context-change", async () => contextChangeQueue.cancel());
  handle("launcher:confirm-codex-models", async () => {
    const current = stateStore.read();
    if (!current.coreSetupComplete || !current.codexCatalogVerified || typeof current.pendingBiggerContext === "boolean") {
      throw new Error("Wait for the configured model catalog before confirming the Codex picker");
    }
    const state = stateStore.update({ codexPickerConfirmed: true, codexRestartRequired: false,
      setupContract: SETUP_CONTRACT, pickerVerifiedAt: new Date().toISOString(),
      setupIdentityHash: setupIdentity(runtimeHost.runtimeConfigSnapshot().config, browserHost.snapshot().accountLabel),
      setupRuntimeIdentity: currentRuntimeIdentity() });
    send("launcher:state-changed", state);
    return state;
  });
  handle("launcher:zero-risk-pro", async (_event, enabled) => {
    const browserOperation = browserHost.currentOperation();
    if (browserHost.activeTraceId || browserOperation) {
      throw new Error(
        browserHost.activeTraceId
          ? "Finish or cancel active ChatGPT turns before changing Manual model profiles"
          : `Finish ${browserOperation} before changing Manual model profiles`,
      );
    }
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
    const browserOperation = browserHost.currentOperation();
    if (browserHost.activeTraceId || browserOperation) {
      throw new Error(
        browserHost.activeTraceId
          ? "Finish or cancel active ChatGPT turns before changing browser interaction mode"
          : `Finish ${browserOperation} before changing browser interaction mode`,
      );
    }
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
    send("launcher:browser-state", browserHost.snapshot());
    if (!IS_DEV_PROFILE && result.configured) startCatalogVerificationMonitor({ logger, stateStore });
    return { state, credentialsRequired: false, targetMode: mode };
  });
  handle("launcher:accounts", () => browserHost.accountSnapshot());
  // A retry performs fresh account-owned browser observation. Keep it behind lifecycle admission:
  // it is not a passive read and must not race replacement, update, or shutdown transitions.
  handle("launcher:account-authentication-refresh", (_event, id) => (
    browserHost.refreshAccountAuthentication(id)
  ));
  handle("launcher:account-codex-quota-snapshot", (_event, id) => accountToolsService.quotaSnapshot(id));
  handle("launcher:account-codex-quota-refresh", (_event, id) => accountToolsService.refreshQuota(id));
  // Portfolio refresh owns its concurrency and per-account leases in the backend. The renderer can
  // request one batch, but cannot supply workers or bypass lifecycle admission.
  handle("launcher:account-codex-quotas-refresh", () => accountToolsService.refreshQuotaPortfolio());
  handle("launcher:codex-login-snapshot", () => accountToolsService.snapshot());
  handle("launcher:codex-login-start", (_event, id) => {
    if (quitting || shutdownInProgress || runtimeHost.currentOperation()) throw new Error("Finish the current runtime operation before Codex sign-in");
    return accountToolsService.start(id);
  });
  handle("launcher:codex-login-status", (_event, flowId, id) => accountToolsService.status(flowId, id));
  handle("launcher:codex-login-open", (_event, flowId, id) => accountToolsService.open(flowId, id));
  handle("launcher:codex-login-cancel", (_event, flowId, id) => accountToolsService.cancel(flowId, id));
  handle("launcher:codex-login-copy-code", (_event, flowId, id) => accountToolsService.copyCode(flowId, id));
  handle("launcher:account-add", (_event, label) => browserHost.addAccount(label));
  handle("launcher:account-select", async (_event, id) => {
    invalidateAccountProof(stateStore);
    return browserHost.selectAccount(id);
  });
  handle("launcher:account-enabled", (_event, id, enabled) => {
    return browserHost.setAccountEnabled(id, enabled);
  });
  handle("launcher:account-proxy", (_event, id, value) => {
    accountToolsService.assertAccountMutable(id);
    return browserHost.setAccountProxy(id, value);
  });
  handle("launcher:account-safety", (_event, id, policy) => browserHost.setAccountSafety(id, policy));
  handle("launcher:account-resume", (_event, id) => browserHost.resumeAccount(id));
  handle("launcher:account-mode", (_event, mode) => browserHost.setAccountMode(mode));
  handle("launcher:account-login", (_event, id) => {
    accountToolsService.assertAccountMutable(id);
    return browserHost.openAccountLogin(id);
  });
  handle("launcher:account-check", async (_event, id, connector) => {
    const selectedAccountId = browserHost.snapshot().accountId;
    try {
      return await browserHost.checkAccount(id, connector === true);
    } catch (error) {
      // A failed check for the account currently shown by the launcher makes
      // the global proof unusable. A check for an account that is no longer
      // selected must not erase proof established for the newer selection.
      if (selectedAccountId === id && browserHost.snapshot().accountId === id) {
        invalidateAccountProof(stateStore);
      }
      throw error;
    }
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
    const browserOperation = browserHost.currentOperation();
    if (browserHost.activeTraceId || browserOperation) {
      throw new Error(
        browserHost.activeTraceId
          ? "Finish or cancel active ChatGPT turns before changing the Pro model version"
          : `Finish ${browserOperation} before changing the Pro model version`,
      );
    }
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
    const ordinary = key === "keepRunningOnClose" || key === "showBrowserDuringTurns";
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
    const transitionOwner = lifecycleAdmission.acquire("the NEKODEX update");
    const updateBlocked = () => currentGlobalOperation()
      || browserHost?.hasActiveTurns();
    let launch;
    try {
      browserHost.closeTurnAdmission("the launcher update");
      if (updateBlocked()) throw new Error("Finish active tasks and setup operations before updating NEKODEX");
      launch = await updateController.beginInstall();
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
      if (!exitCommitted) browserHost.openTurnAdmission();
      if (error?.code === "UPDATE_PREPARATION_CANCELLED") return false;
      throw error;
    } finally {
      if (!exitCommitted) lifecycleAdmission.release(transitionOwner);
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

async function requestQuit({ admissionHeld = false, restart = false, stopRuntime = false, transitionOwner = null } = {}) {
  if (!transitionOwner && lifecycleAdmission.currentLabel() === "local runtime startup") {
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

    // Closing the interface releases only its Web dependency. Explicit stop/setup still
    // use the global idle drain. A failed detach is pre-commit and preserves the GUI.
    shutdownResult = stopRuntime || IS_DEV_PROFILE
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
  if (stateStore.read().sessionRefreshReminderAt === null) {
    stateStore.update({ sessionRefreshReminderAt: nextSessionRefreshReminderAt() });
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
  startupPhase = "browser-control";
  browserControl = await new BrowserControlServer({
    logger,
    getBrowserHost: () => browserHost,
    getPreferences: () => stateStore.read(),
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
    publishCapabilities: capability => lifecycleProjection.update(capability),
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
  const configuredInteractionMode = runtimeHost.runtimeConfigSnapshot().config?.browserInteractionMode;
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
      coreHome: CORE_HOME, dialog, window: () => mainWindow,
      executable: () => runtimeHost.passkeyChromeExecutable("chrome"), language: () => stateStore.read().language,
    }), runtime: runtimeHost, session, dialog, window: () => mainWindow, language: () => stateStore.read().language,
  });
  browserHost = new AccountBrowserPool({
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
    helper: { executable: process.execPath, script: BROWSER_HELPER_PATH },
    logger,
    loginWithPasskey: (onProgress, context) => stateStore.read().passkeyBrowser === "firefox"
      ? runtimeHost.capturePasskeyLogin(onProgress, "firefox") : profileFirstLogin(onProgress, context),
    loginWithExistingChrome: (onProgress, options) => runtimeHost.captureExistingChromeLogin(onProgress, options),
    partition: LAUNCHER_PROFILE.browserPartition,
    profile: LAUNCHER_PROFILE.kind,
    publishState: (state) => send("launcher:browser-state", state),
    showWindow: showMainWindow,
    getBrowserInteractionMode: () => stateStore.read().browserInteractionMode,
    bootstrapPrimaryConnector: () => {
      const runtime = runtimeHost.runtimeConfigSnapshot();
      return stateStore.read().browserInteractionMode === "automatic"
        && runtime.configured && runtime.config?.mode === "full"
        && runtime.config?.browserInteractionMode === "automatic";
    },
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
      ? { updated: false, deferredUntilCommittedRestart: true }
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
    const allowCommittedVersion = legacyUpdateBootstrap || upgrade.repairRequired === true;
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
        launcherRestartRequired: runtime.upgrade?.deferredUntilCommittedRestart === true,
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
      if (runtime.upgrade?.deferredUntilCommittedRestart) {
        publishOperation({ name: "runtime-migration", status: "completed",
          message: "The app update is installed. Restart NEKODEX to activate the new local runtime." });
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
    stopCatalogVerificationMonitor();
    const capabilities = runtimeSupervisor.capabilitySnapshot();
    const priorRuntimeUsable = capabilities.nativeAvailability === "ready";
    if (!priorRuntimeUsable) {
      retireAccountProof();
      const state = stateStore.update({ coreSetupComplete: false, codexCatalogVerified: false,
        mcpSetupComplete: false });
      send("launcher:state-changed", state);
    }
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
    stopCatalogVerificationMonitor();
    const capabilities = runtimeSupervisor.capabilitySnapshot();
    const priorRuntimeUsable = capabilities.nativeAvailability === "ready";
    if (!priorRuntimeUsable) {
      retireAccountProof();
      const state = stateStore.update({ coreSetupComplete: false, codexCatalogVerified: false,
        mcpSetupComplete: false });
      send("launcher:state-changed", state);
    }
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
