import languages from "../electron/languages.json";

export type Language = keyof typeof languages;
export type LauncherProfile = "production" | "development";
export type BrowserInteractionMode = "automatic" | "manual";
export type ProModelVersion = "5.6" | "5.5" | "6";
export type Surface = "overview" | "accounts" | "browser" | "setup" | "mcp" | "activity" | "settings" | "updates";

export interface LauncherState {
  version: 1;
  language: Language | null;
  onboardingComplete: boolean;
  githubOpened: boolean;
  xOpened: boolean;
  autoStart: boolean;
  keepRunningOnClose: boolean;
  showBrowserDuringTurns: boolean;
  manualSubmitTimeoutSec: number;
  passkeyBrowser: "chrome" | "firefox";
  browserInteractionMode: BrowserInteractionMode;
  experimentalBiggerContext: boolean;
  experimentalSkillAttachments: boolean;
  allowWebSubagents: boolean;
  experimentalFreshConversationPerTurn: boolean;
  pendingBiggerContext?: boolean | null;
  contextChangeApplying?: boolean;
  contextChangeError?: string | null;
  zeroRiskProEnabled: boolean;
  sidebarOpen: boolean;
  sidebarWidth: number;
  browserSmokePassed?: boolean;
  browserSmokeVersion?: string | null;
  coreSetupComplete?: boolean;
  codexCatalogVerified?: boolean;
  codexPickerConfirmed?: boolean;
  setupContract?: number;
  setupVerifiedAt?: string;
  pickerVerifiedAt?: string;
  setupIdentityHash?: string | null;
  mcpSetupComplete?: boolean;
  mcpRuntimeInstalled?: boolean;
  codexRestartRequired?: boolean;
  mcpGuideStep: number;
  sessionRefreshReminderAt: string | null;
}

export interface BrowserState {
  accountId?: string;
  accountName?: string;
  status: "idle" | "loading" | "signed-out" | "ready" | "testing" | "running" | "error";
  message: string;
  url: string;
  title: string;
  authenticated: boolean;
  accountLabel?: string | null;
  visible: boolean;
  surfaceActive: boolean;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  zoomFactor: number;
  navigationLocked: boolean;
  loginInProgress: boolean;
  loginKind: "embedded" | "passkey" | "existing-chrome" | null;
  passkeyLogin?: PasskeyLoginProgress | null;
  existingChromeLogin?: ExistingChromeLoginProgress | null;
  activeTabId: string;
  maxTabs: number;
  tabs: BrowserTabState[];
}

export interface ExistingChromeLoginProgress {
  phase: "consent" | "preparing" | "file-access" | "discovering" | "waiting-for-chrome" | "reading-session" | "verifying" | "cancelling" | "cancelled" | "timed-out" | "failed" | "completed";
  startedAt: string;
  deadlineAt: string;
  active: boolean;
  canCancel: boolean;
  canCopySettings: boolean;
  canAllowFileAccess?: boolean;
  error: string | null;
}

export interface PasskeyLoginProgress {
  phase: "starting" | "waiting" | "importing" | "verifying" | "cancelling" | "cancelled" | "timed-out" | "failed" | "completed";
  startedAt: string;
  deadlineAt: string;
  active: boolean;
  canImport: boolean;
  canReveal: boolean;
  canCancel: boolean;
  error: string | null;
  revealError: string | null;
}

export interface BrowserTabState {
  id: string;
  traceId: string | null;
  title: string;
  status: "idle" | "loading" | "signed-out" | "ready" | "testing" | "running" | "error" | "aborted";
  loading: boolean;
  active: boolean;
  closable: boolean;
  interactionMode?: BrowserInteractionMode;
  manualState?: "awaiting-user" | "sent" | "running" | "completed" | "timed-out" | "cancelled" | "failed";
  manualDeadlineAt?: string;
  canCopyPrompt?: boolean;
  canConfirmSent?: boolean;
}

export interface LogRecord {
  at: string;
  level: "debug" | "info" | "warning" | "error";
  event: string;
  detail: Record<string, unknown>;
}

export interface DoctorCheck {
  id: string;
  status: "ok" | "warning" | "error";
  message: string;
  detail?: string;
}

export interface DoctorReport {
  ok: boolean;
  mode?: "browser-only" | "full";
  checks: DoctorCheck[];
}

export interface OperationState {
  name: string;
  status: "running" | "completed" | "failed";
  message: string;
}

export type UpdateState =
  | { status: "disabled" | "idle" | "checking" | "up-to-date" }
  | { status: "available" | "downloading" | "verifying" | "installing"; version: string;
      downloadedBytes?: number; totalBytes?: number; bytesPerSecond?: number; remainingSeconds?: number | null }
  | { status: "error"; message: string };

export type CompactionModel = "extra-high" | "5.6-pro" | "5.5-pro";

export interface UsageSnapshot {
  available: boolean; error?: string; startedAt?: string; lifetime?: number;
  rows: Array<{ day: string; effort: string; modelVersion: string; mode: string;
    accepted: number; completed: number; failed: number; aborted: number }>;
}
export interface AccountProxy { mode: "system" | "direct" | "http" | "https" | "socks5" | "pac"; url?: string; }

export interface AccountSafetyPolicy {
  enabled: boolean;
  minIntervalSec: number;
  maxConcurrent: number;
  breakAfterMinutes: number;
  breakMinutes: number;
  maxSessionMinutes: number;
  cooldownMinutes: number;
}
export interface AccountPoolSnapshot {
  selectedId: string;
  mode: "selected" | "balanced";
  accounts: Array<{ id: string; label: string; enabled: boolean; authenticated: boolean;
    proxy: AccountProxy;
    safety: { policy: AccountSafetyPolicy; cooldownUntil: number; stopped: boolean };
    accountLabel: string | null; activeTurns: number; checked: boolean; connectorReady: boolean }>;
}

export interface BrowserCapacitySettings {
  configured: number;
  active: number;
  maximum: number;
  restartRequired: boolean;
}

export interface LauncherSnapshot {
  browserCapacity: BrowserCapacitySettings;
  profile: LauncherProfile;
  profilePaths: {
    coreHome: string;
    codexHome: string;
    userData: string;
  };
  state: LauncherState;
  proModelVersion: ProModelVersion | null;
  compactionModel: CompactionModel | null;
  contextCapabilities?: { solAvailable: boolean; proAvailable: boolean; extraHighAvailable?: boolean } | null;
  browser: BrowserState | null;
  connectorName: string;
  connectorNames: Record<BrowserInteractionMode, string>;
  mcpCredentialsConfigured: boolean;
  logs: LogRecord[];
  urls: {
    github: string;
    x: string;
    connectors: string;
    developerMode?: string;
    tunnels: string;
    keys: string;
  };
  platform: string;
  packaged: boolean;
  version: string;
  smokePassed: boolean;
  operation: OperationState | null;
  update: UpdateState;
}

export interface RouteDiagnosticsReport {
  schemaVersion: 1;
  codexHome: string;
  configPath: string;
  profilePath: string | null;
  configStatus: "missing" | "loaded" | "invalid" | "unreadable";
  profile: string | null;
  provider: string | null;
  providerSource: "default" | "root" | "profile" | "unknown";
  customProvider: boolean;
  modelCatalogOverride: boolean;
  installed: boolean | null;
  active: boolean | null;
  routeMatches: boolean | null;
  issueCodes: string[];
  catalog: { status: "observed" | "waiting" | "unavailable"; successfulRequests: number | null; lastSuccessfulAt: string | null };
}

export interface LauncherApi {
  cancelContextChange(): Promise<LauncherState>;
  confirmCodexModels(): Promise<LauncherState>;
  setupHermes(input?: { runtime: "codex_responses" | "codex_app_server"; makeDefault?: boolean }): Promise<{ provider: string; configPath: string; backupPath: string; baseUrl: string; defaultChanged: boolean }>;
  snapshot(): Promise<LauncherSnapshot>;
  setLanguage(language: Language): Promise<LauncherState>;
  openSocial(target: "github" | "x"): Promise<LauncherState>;
  completeOnboarding(language: Language, browserInteractionMode: BrowserInteractionMode): Promise<LauncherState>;
  openExternal(url: string): Promise<boolean>;
  setBrowserBounds(bounds: { x: number; y: number; width: number; height: number }): Promise<boolean>;
  setBrowserSurfaceActive(active: boolean): Promise<BrowserState>;
  showBrowser(): Promise<BrowserState>;
  hideBrowser(): Promise<BrowserState>;
  navigateBrowser(action: "back" | "forward" | "reload"): Promise<BrowserState>;
  zoomBrowser(action: "in" | "out" | "reset"): Promise<BrowserState>;
  selectBrowserTab(tabId: string): Promise<BrowserState>;
  closeBrowserTab(tabId: string): Promise<BrowserState>;
  copyManualPrompt(tabId: string): Promise<BrowserState>;
  confirmManualSent(tabId: string): Promise<BrowserState>;
  openLogin(): Promise<BrowserState>;
  openPasskeyLogin(): Promise<BrowserState>;
  continuePasskeyLogin(): Promise<boolean>;
  revealPasskeyLogin(): Promise<boolean>;
  cancelPasskeyLogin(): Promise<BrowserState>;
  openExistingChromeLogin(): Promise<BrowserState>;
  cancelExistingChromeLogin(): Promise<BrowserState>;
  allowExistingChromeFileAccess(): Promise<BrowserState>;
  copyExistingChromeSettingsAddress(): Promise<boolean>;
  logoutChatGpt(): Promise<{ browser: BrowserState; state: LauncherState }>;
  dismissSessionReminder(): Promise<LauncherState>;
  smokeTest(): Promise<{ ok: boolean; effort: string; response: string }>;
  verifyMcp(): Promise<DoctorReport>;
  doctor(): Promise<DoctorReport>;
  routeDiagnostics(): Promise<RouteDiagnosticsReport>;
  cancelTurns(): Promise<{ stdout: string }>;
  uninstallIntegration(): Promise<{ cancelled: true } | { cancelled: false; state: LauncherState }>;
  setupCore(): Promise<{ ok: boolean; stdout: string; restartRequired: boolean }>;
  setupMcp(input: {
    tunnelId?: string;
    runtimeKey?: string;
    replace?: boolean;
    interactionMode?: BrowserInteractionMode;
  }): Promise<{ ok: boolean; stdout: string }>;
  setMcpStep(step: number): Promise<LauncherState>;
  setAutostart(enabled: boolean): Promise<{ state: LauncherState; supported: boolean; enabled: boolean }>;
  setBiggerContext(enabled: boolean): Promise<LauncherState>;
  setFreshConversation(enabled: boolean): Promise<LauncherState>;
  setWebSubagents(enabled: boolean): Promise<LauncherState>;
  setSkillAttachments(enabled: boolean): Promise<LauncherState>;
  setZeroRiskPro(enabled: boolean): Promise<LauncherState>;
  accounts(): Promise<AccountPoolSnapshot>;
  addAccount(label: string): Promise<AccountPoolSnapshot>;
  selectAccount(id: string): Promise<AccountPoolSnapshot>;
  setAccountEnabled(id: string, enabled: boolean): Promise<AccountPoolSnapshot>;
  setAccountProxy(id: string, value: AccountProxy): Promise<AccountPoolSnapshot>;
  setAccountSafety(id: string, policy: AccountSafetyPolicy): Promise<AccountPoolSnapshot>;
  resumeAccount(id: string): Promise<AccountPoolSnapshot>;
  setAccountMode(mode: "selected" | "balanced"): Promise<AccountPoolSnapshot>;
  openAccountLogin(id: string): Promise<BrowserState>;
  checkAccount(id: string, connector: boolean): Promise<AccountPoolSnapshot>;
  setBrowserCapacity(value: number): Promise<BrowserCapacitySettings>;
  setCompactionModel(value: CompactionModel | null): Promise<{ compactionModel: CompactionModel | null }>;
  setProModelVersion(version: ProModelVersion | null): Promise<{ proModelVersion: ProModelVersion | null }>;
  setBrowserInteractionMode(mode: BrowserInteractionMode): Promise<{
    state: LauncherState;
    credentialsRequired: boolean;
    targetMode: BrowserInteractionMode;
  }>;
  setPreference(key: "passkeyBrowser", value: "chrome" | "firefox"): Promise<LauncherState>;
  setPreference(key: "manualSubmitTimeoutSec", value: number): Promise<LauncherState>;
  setPreference(
    key: "keepRunningOnClose" | "showBrowserDuringTurns",
    value: boolean,
  ): Promise<LauncherState>;
  setSidebarState(state: { open: boolean; width: number }): Promise<LauncherState>;
  usage(days: 7 | 30 | 90): Promise<UsageSnapshot>;
  logs(limit?: number): Promise<LogRecord[]>;
  exportLogs(): Promise<string | null>;
  installUpdate(): Promise<boolean>;
  recheckUpdate(): Promise<UpdateState>;
  readUpdateRequestRevision?(): Promise<number>;
  onOpenUpdates?(listener: () => void): () => void;
  windowState(): Promise<{ fullScreen: boolean; maximized: boolean }>;
  windowControl(action: "close" | "minimize" | "zoom"): void;
  onWindowStateChanged(listener: (state: { fullScreen: boolean; maximized: boolean }) => void): () => void;
  onStateChanged(listener: (state: LauncherState) => void): () => void;
  onBrowserState(listener: (state: BrowserState) => void): () => void;
  onOperation(listener: (state: OperationState) => void): () => void;
  onLog(listener: (record: LogRecord) => void): () => void;
  onUpdateState(listener: (state: UpdateState) => void): () => void;
}

declare global {
  interface Window {
    codexWebLauncher?: LauncherApi;
  }
}
