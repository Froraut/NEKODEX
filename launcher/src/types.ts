import languages from "../electron/languages.json";

export type Language = keyof typeof languages;
export type LauncherProfile = "production" | "development";
export type BrowserInteractionMode = "automatic" | "manual";
export type AuthenticationStatus = "unknown" | "verified" | "signed-out" | "unavailable";
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
  experimentalAsyncToolOperations: boolean;
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
  setupConnectorName?: string | null;
  pickerVerifiedAt?: string;
  setupIdentityHash?: string | null;
  mcpSetupComplete?: boolean;
  mcpRuntimeInstalled?: boolean;
  /** Legacy name: client configuration refresh is pending, not proof that a restart is necessary. */
  codexRestartRequired?: boolean;
  runtimeMigrationPending?: boolean;
  launcherRestartRequired?: boolean;
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
  authenticationStatus?: AuthenticationStatus;
  authenticationCheckedAt?: string | null;
  lastVerifiedAt?: string | null;
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
  | { status: "available" | "downloading" | "verifying" | "installing" | "cancelling"; version: string;
      downloadedBytes?: number; totalBytes?: number; bytesPerSecond?: number; remainingSeconds?: number | null }
  | { status: "error"; message: string };

export type CompactionModel = "extra-high" | "5.6-pro" | "5.5-pro";

export type CancelUpdatePreparationResult =
  | { status: "cancelled"; version: string }
  | { status: "too-late"; reason: "worker-handoff"; version?: string }
  | { status: "not-active" }
  | { status: "failed"; version: string; message: string };

export interface UsageGroup {
  accountId?: string;
  effort?: string; modelVersion?: string; mode?: string;
  modelId?: string;
  modelIdSource?: "reported" | "requested" | "unknown";
  endpoint?: "responses" | "responses/compact";
  modelVersionSource?: "observed" | "pinned" | "unknown";
  messageKind?: "task" | "context_stage" | "compaction" | "unknown";
  accepted: number; completed: number; failed: number; aborted: number; incomplete?: number;
}

export type UsageRangeDays = 1 | 7 | 30 | 90;
export type UsageSource = "web" | "native";
export interface UsageQuery { days: UsageRangeDays; source: UsageSource; accountId?: string | null; }
export interface UsageAccountOption { id: string; label: string; available: boolean; }
export interface UsageMetrics {
  total: number; completed: number; failed: number; cancelled: number; incomplete?: number; unrecorded: number;
  knownOutcomeTotal: number; knownOutcomeCompletionRate: number | null;
  messageCount?: number;
  observedRunCount?: number;
  messageKinds?: Record<string, number>;
  runCountCoverage?: { observedMessages: number; totalMessages: number; complete: boolean };
}
export interface UsageDurations {
  observedSamples: number; medianMs: number | null; p95Ms: number | null;
}
export type UsageFailureCode = "rate_limit" | "safety_stop" | "timeout" | "browser_failure" | "other" | "unknown"
  | "http-auth" | "http-rate-limit" | "http-client" | "http-server" | "transport" | "stream" | "protocol" | "aborted";
export interface UsageFailure { code: UsageFailureCode; count: number; }
export interface UsageDiagnosticDurations {
  observedSamples: number;
  eligibleSamples: number;
  medianMs: number | null;
  p95Ms: number | null;
}
interface UsageDiagnosticGroupBase {
  accepted: number;
  completed: number;
  failed: number;
  cancelled: number;
  knownOutcomeTotal: number;
  knownOutcomeCompletionRate: number | null;
  durations: UsageDiagnosticDurations;
  failures: UsageFailure[];
  classifiedFailureSamples: number;
}
export interface WebUsageDiagnosticGroup extends UsageDiagnosticGroupBase {
  source: "web";
  accountId: string;
  effort: string;
  modelVersion: string;
  modelVersionSource: "observed" | "pinned" | "unknown";
  mode: string;
  messageKind: "task" | "context_stage" | "compaction" | "unknown";
}
export interface NativeUsageDiagnosticGroup extends UsageDiagnosticGroupBase {
  source: "native";
  endpoint: "responses" | "responses/compact";
  modelId: string;
  modelIdSource: "reported" | "requested" | "unknown";
  incomplete?: number;
}
export type UsageDiagnosticGroup = WebUsageDiagnosticGroup | NativeUsageDiagnosticGroup;
export interface UsageCalendarDay {
  day: string; total: number; completed: number; failed: number; cancelled: number; incomplete?: number; unrecorded: number;
}
export interface UsageTokenReport {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens?: number | null;
  reasoningTokens?: number | null;
  reportedSamples: number;
  unreportedSamples: number;
  cachedInputReportedSamples?: number;
  reasoningReportedSamples?: number;
}
export interface UsageSnapshot {
  available: boolean; error?: string; startedAt?: string; lifetime?: number;
  lifetimeGroups?: UsageGroup[]; lifetimeUnclassified?: number;
  recovered?: boolean; backupAvailable?: boolean;
  rows: Array<UsageGroup & { day: string }>;
  generatedAt: string; timeZone: string;
  source: UsageSource;
  period: { startDay: string; endDay: string; days: UsageRangeDays };
  selectedAccountId: string | null;
  accounts: UsageAccountOption[];
  metrics: UsageMetrics;
  durations: UsageDurations;
  failures: UsageFailure[];
  diagnosticGroups?: UsageDiagnosticGroup[];
  calendar: UsageCalendarDay[];
  tokens?: UsageTokenReport;
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
  newSessionWindow: { limit: number; minutes: number } | null;
}
export interface AccountNewSessionWindowStatus {
  used: number;
  remaining: number;
  limit: number;
  windowMinutes: number;
  resetsAt: number | null;
}
export interface AccountQuotaWindow {
  usedPercent: number | null;
  remainingPercent: number | null;
  windowDurationMins: number | null;
  resetsAt: number | null;
}
export interface AccountQuotaBucket {
  id: string; name: string | null; normalModelSlug: string | null;
  allowed: boolean | null; limitReached: boolean | null;
  primary: AccountQuotaWindow; secondary: AccountQuotaWindow;
}
export interface AccountQuotaSnapshot {
  availability: "available" | "unavailable";
  coverage: "reported_buckets" | "none";
  accountId: string; fetchedAt?: string; checkedAt?: string;
  reason?: string; retryAt?: string | null; planType: string | null;
  accountBucket: AccountQuotaBucket;
  additionalBuckets: AccountQuotaBucket[];
  additionalBucketsTruncated: boolean;
  freshness?: "fresh" | "stale";
  freshUntil?: string | null;
  refreshError?: string | null;
}
export interface AccountQuotaPortfolioRow {
  accountId: string;
  evidenceEpoch: number;
  status: "updated" | "retained" | "unavailable" | "skipped";
  snapshot: AccountQuotaSnapshot | null;
  reason: string | null;
}
export interface AccountQuotaPortfolioResult {
  generatedAt: string;
  rows: AccountQuotaPortfolioRow[];
}
export interface CodexLoginProgress {
  flowId: string; accountId: string;
  phase: "starting" | "waiting" | "cancelling" | "confirming" | "needs-confirmation" | "completed" | "cancelled" | "failed";
  active: boolean; settling: boolean; startedAt: string; deadlineAt: string; completedAt: string | null;
  ownershipCurrent: boolean; canOpen: boolean; canCancel: boolean;
  verificationUrl: string | null; userCode: string | null;
  error: { code: string; message: string } | null;
  scope: "shared-codex-auth-store";
  authOutcome: string; cancelStatus: "canceled" | "notFound" | null;
  actualAccount: { type: "chatgpt"; email: string | null; planType: string } | null;
  requiresOpenaiAuth: boolean | null; requiresIdentityConfirmation: boolean;
  desktopAccountChange: "not_performed";
  selectionLock: { flowId: string; accountId: string } | null;
}

export interface AccountPoolSnapshot {
  selectedId: string;
  mode: "selected" | "balanced";
  accounts: Array<{ id: string; label: string; enabled: boolean; authenticated: boolean;
    authenticationStatus?: AuthenticationStatus; authenticationCheckedAt?: string | null; lastVerifiedAt?: string | null;
    proxy: AccountProxy;
    safety: { policy: AccountSafetyPolicy; cooldownUntil: number; stopped: boolean;
      newSessionWindow: AccountNewSessionWindowStatus | null };
    accountLabel: string | null; activeTurns: number; checked: boolean; connectorReady: boolean; evidenceEpoch?: number }>;
}

export interface BrowserCapacitySettings {
  configured: number;
  active: number;
  maximum: number;
  restartRequired: boolean;
}

export interface RuntimeCapabilities {
  revision: number;
  runtimeStatus: string;
  nativeAvailability: "unknown" | "ready" | "degraded" | "unavailable";
  webAvailability: "unknown" | "ready" | "degraded" | "unavailable";
  tunnelStatus: string;
  brokerReady?: boolean | null;
  tunnelReady?: boolean | null;
  releaseVersion: string | null;
  daemonPid: number | null;
  tunnelPid: number | null;
  detail: string | null;
  tunnelRepair?: { eligible: boolean; reason: string; active: boolean };
}

export interface LauncherLifecycle extends RuntimeCapabilities {
  routeStatus: string;
  transition?: string | null;
  operation?: OperationState;
  catalog?: { status: string; request: number | null; at: string | null; failure: unknown };
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
  recommendedConnectorNames?: Partial<Record<BrowserInteractionMode, string>>;
  runtimeStatus?: string;
  runtimeCapabilities?: RuntimeCapabilities | null;
  lifecycle?: LauncherLifecycle | null;
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
  catalog: {
    status: "observed" | "waiting" | "unavailable";
    successfulRequests: number | null;
    lastSuccessfulAt: string | null;
    lastResult?: {
      request: number;
      at: string;
      status: number;
      failure?: { stage: "config" | "request" | "transport" | "upstream" | "catalog"; code?: string };
    } | null;
  };
}

export interface LauncherApi {
  restartLauncher(): Promise<boolean>;
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
  closeBrowserTab(tabId: string, expectedTraceId?: string | null): Promise<BrowserState>;
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
  setAsyncToolOperations(enabled: boolean): Promise<LauncherState>;
  setZeroRiskPro(enabled: boolean): Promise<LauncherState>;
  accounts(): Promise<AccountPoolSnapshot>;
  refreshAccountAuthentication(id: string): Promise<AccountPoolSnapshot>;
  accountCodexQuotaSnapshot(id: string): Promise<AccountQuotaSnapshot | null>;
  refreshAccountCodexQuota(id: string): Promise<AccountQuotaSnapshot>;
  refreshAccountCodexQuotas(): Promise<AccountQuotaPortfolioResult>;
  codexLoginSnapshot(): Promise<CodexLoginProgress | null>;
  startCodexLogin(id: string): Promise<CodexLoginProgress>;
  codexLoginStatus(flowId: string, id: string): Promise<CodexLoginProgress>;
  openCodexLogin(flowId: string, id: string): Promise<boolean>;
  cancelCodexLogin(flowId: string, id: string): Promise<CodexLoginProgress>;
  copyCodexLoginCode(flowId: string, id: string): Promise<boolean>;
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
  usage(query: number | UsageQuery): Promise<UsageSnapshot>;
  repairWebRoute(): Promise<{ status: "recovered" | "unavailable"; reason: string | null }>;
  logs(limit?: number): Promise<LogRecord[]>;
  exportLogs(): Promise<string | null>;
  installUpdate(): Promise<boolean>;
  cancelUpdatePreparation(): Promise<CancelUpdatePreparationResult>;
  recheckUpdate(): Promise<UpdateState>;
  readUpdateRequestRevision?(): Promise<number>;
  onOpenUpdates?(listener: () => void): () => void;
  windowState(): Promise<{ fullScreen: boolean; maximized: boolean }>;
  windowControl(action: "close" | "minimize" | "zoom"): void;
  onWindowStateChanged(listener: (state: { fullScreen: boolean; maximized: boolean }) => void): () => void;
  onStateChanged(listener: (state: LauncherState) => void): () => void;
  onBrowserState(listener: (state: BrowserState) => void): () => void;
  onOperation(listener: (state: OperationState) => void): () => void;
  onLifecycle(listener: (state: LauncherLifecycle) => void): () => void;
  onLog(listener: (record: LogRecord) => void): () => void;
  onUpdateState(listener: (state: UpdateState) => void): () => void;
}

declare global {
  interface Window {
    codexWebLauncher?: LauncherApi;
  }
}
