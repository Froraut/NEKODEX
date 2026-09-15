import { setupNextStep } from "./setup-progress";
import { BrandMark } from "./BrandMark";
import { Overview } from "./Overview";
import { AccountSettings } from "./AccountSettings";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { copyFor, localizeRuntimeMessage, localizeLauncherError, type Copy } from "./i18n";
import { Icon, type IconName } from "./icons";
import { browserControls } from "./browser-controls";
import { RouteDiagnostics } from "./RouteDiagnostics";
import { PasskeyLoginGuide } from "./PasskeyLoginGuide";
import { ExistingChromeLoginGuide } from "./ExistingChromeLoginGuide";
import { availableChatGptWebModelRoutes, resolveChatGptWebContextLimits, resolveChatGptWebTransportLimits } from "../../src/chatgpt-web-models";
import type {
  BrowserCapacitySettings,
  BrowserInteractionMode,
  BrowserState,
  DoctorReport,
  Language,
  LauncherSnapshot,
  LauncherState,
  LogRecord,
  OperationState,
  ProModelVersion,
  Surface,
} from "./types";

const api = window.codexWebLauncher;
const COMPACT_SIDEBAR_QUERY = "(max-width: 820px)";
const MCP_GUIDE_MEDIA = [
  new URL("./assets/mcp-create-tunnel.mp4", import.meta.url).href,
  new URL("./assets/mcp-connect-connector.mp4", import.meta.url).href,
  new URL("./assets/mcp-connect-connector.mp4", import.meta.url).href,
] as const;

export function App() {
  const [snapshot, setSnapshot] = useState<LauncherSnapshot | null>(null);
  const [browser, setBrowser] = useState<BrowserState | null>(null);
  const [operation, setOperation] = useState<OperationState | null>(null);
  const [logs, setLogs] = useState<LogRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [startupAttempt, setStartupAttempt] = useState(0);
  const stateRevision = useRef(0);
  const snapshotRefresh = useRef(0);
  const refreshOwner = useRef(0);
  const refreshInFlight = useRef<Promise<void> | null>(null);
  const refreshOperationRevision = useRef(0);
  const operationRevision = useRef(0);
  const lastOperationStatus = useRef<OperationState["status"] | null>(null);
  const completionRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const documentLanguage = snapshot?.state.language ?? "en";

  const refreshMetadata = useCallback((reuseCompletedOperation: boolean): Promise<void> => {
    // A completion snapshot starts after that operation publishes its state and credentials.
    // A later operation, including a failed verification, needs its own fresh read.
    if (reuseCompletedOperation && refreshInFlight.current
      && lastOperationStatus.current === "completed"
      && refreshOperationRevision.current === operationRevision.current) {
      return refreshInFlight.current;
    }
    const request = ++snapshotRefresh.current;
    const owner = refreshOwner.current;
    const revision = stateRevision.current;
    refreshOperationRevision.current = operationRevision.current;
    const pending = api!.snapshot().then(fresh => {
      if (owner !== refreshOwner.current || request !== snapshotRefresh.current) return;
      setSnapshot(current => current ? {
        ...current,
        ...(revision === stateRevision.current ? { state: fresh.state } : {}),
        mcpCredentialsConfigured: fresh.mcpCredentialsConfigured,
        contextCapabilities: fresh.contextCapabilities,
      } : current);
    });
    refreshInFlight.current = pending;
    void pending.finally(() => {
      if (refreshInFlight.current === pending) refreshInFlight.current = null;
    }).catch(() => {});
    return pending;
  }, []);

  useEffect(() => {
    document.documentElement.lang = documentLanguage;
  }, [documentLanguage]);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    let initialized = false;
    let pendingState: LauncherState | null = null;
    let pendingBrowser: BrowserState | null = null;
    let pendingOperation: OperationState | null = null;
    let pendingUpdate: LauncherSnapshot["update"] | null = null;
    const pendingLogs: LogRecord[] = [];
    const refreshCompletedOperation = () => {
      // Collapse completion events in one turn; an explicit verification read can
      // take over this pending request before the full IPC snapshot is started.
      if (completionRefreshTimer.current !== null) return;
      completionRefreshTimer.current = setTimeout(() => {
        completionRefreshTimer.current = null;
        void refreshMetadata(true).catch(() => {});
      }, 0);
    };
    const unsubscribeState = api.onStateChanged((state) => {
      stateRevision.current += 1;
      if (!initialized) pendingState = state;
      setSnapshot((current) => current
        ? {
            ...current,
            state,
            smokePassed: current.smokePassed
              || (state.browserSmokePassed === true && state.browserSmokeVersion === current.version),
          }
        : current);
    });
    const unsubscribeBrowser = api.onBrowserState(next => {
      if (!initialized) pendingBrowser = next;
      else setBrowser(next);
    });
    const unsubscribeOperation = api.onOperation((next) => {
      operationRevision.current += 1;
      lastOperationStatus.current = next.status;
      if (!initialized) pendingOperation = next;
      else setOperation(next);
      if (next.status === "failed" && next.name !== "mcp-verification") setError(next.message);
      if (next.status === "completed" && initialized) refreshCompletedOperation();
    });
    const unsubscribeLog = api.onLog((record) => {
      if (!initialized) {
        pendingLogs.push(record);
        if (pendingLogs.length > 300) pendingLogs.shift();
      }
      else setLogs((current) => [...current.slice(-299), record]);
    });
    const unsubscribeUpdate = api.onUpdateState((update) => {
      if (!initialized) pendingUpdate = update;
      setSnapshot((current) => current ? { ...current, update } : current);
    });
    void api.snapshot().then((next) => {
      if (cancelled) return;
      const latestState = (pendingState as LauncherState | null) ?? next.state;
      const latestOperation = (pendingOperation as OperationState | null) ?? next.operation;
      setSnapshot({
        ...next,
        state: latestState,
        update: pendingUpdate ?? next.update,
        smokePassed: next.smokePassed || (latestState.browserSmokePassed === true && latestState.browserSmokeVersion === next.version),
      });
      setBrowser(pendingBrowser ?? next.browser);
      const unseenLogs = pendingLogs.filter(record => !next.logs.some(existing =>
        existing.at === record.at && existing.level === record.level && existing.event === record.event
          && JSON.stringify(existing.detail) === JSON.stringify(record.detail)));
      setLogs([...next.logs, ...unseenLogs].slice(-300));
      setOperation(latestOperation);
      if (latestOperation?.status === "failed" && latestOperation.name !== "mcp-verification") {
        setError(latestOperation.message);
      }
      initialized = true;
      if ((pendingOperation as OperationState | null)?.status === "completed") refreshCompletedOperation();
    }).catch((cause) => {
      if (!cancelled) setStartupError(messageOf(cause));
    });
    return () => {
      cancelled = true;
      if (completionRefreshTimer.current !== null) {
        clearTimeout(completionRefreshTimer.current);
        completionRefreshTimer.current = null;
      }
      refreshOwner.current += 1;
      snapshotRefresh.current += 1;
      refreshInFlight.current = null;
      unsubscribeState();
      unsubscribeBrowser();
      unsubscribeOperation();
      unsubscribeLog();
      unsubscribeUpdate();
    };
  }, [startupAttempt, refreshMetadata]);

  const updateState = useCallback((state: LauncherState) => {
    stateRevision.current += 1;
    setSnapshot((current) => current
      ? {
          ...current,
          state,
          smokePassed: current.smokePassed
            || (state.browserSmokePassed === true && state.browserSmokeVersion === current.version),
        }
      : current);
  }, []);

  const updateSnapshot = useCallback(async () => {
    if (completionRefreshTimer.current !== null) {
      clearTimeout(completionRefreshTimer.current);
      completionRefreshTimer.current = null;
    }
    await refreshMetadata(true);
  }, [refreshMetadata]);

  const updateBrowserCapacity = useCallback((browserCapacity: BrowserCapacitySettings) => {
    setSnapshot(current => current ? { ...current, browserCapacity } : current);
  }, []);

  const updateProModelVersion = useCallback((proModelVersion: ProModelVersion | null) => {
    setSnapshot((current) => current ? { ...current, proModelVersion } : current);
  }, []);

  if (!api) return <FatalMessage message="Launcher IPC is unavailable." />;
  if (!snapshot && startupError) return (
    <FatalMessage
      message={localizeLauncherError(copyFor(documentLanguage), startupError)}
      retryLabel={copyFor(documentLanguage).retry}
      onRetry={() => {
        setStartupError(null);
        setStartupAttempt((attempt) => attempt + 1);
      }}
    />
  );
  if (!snapshot) return <LaunchLoading />;

  const language = snapshot.state.language ?? "en";
  const copy = copyFor(language);

  return (
    <div
      className="app-root"
      data-language={language}
      data-platform={snapshot.platform}
      data-profile={snapshot.profile}
      data-theme="dark"
    >
        {!snapshot.state.onboardingComplete ? (
          <Onboarding
            key="onboarding"
            language={language}
            setError={setError}
            snapshot={snapshot}
            updateState={updateState}
          />
        ) : (
          <LauncherShell
            browser={browser}
            copy={copy}
            key="launcher"
            language={language}
            logs={logs}
            operation={operation}
            setError={setError}
            snapshot={snapshot}
            updateBrowserCapacity={updateBrowserCapacity}
            updateProModelVersion={updateProModelVersion}
            updateState={updateState}
            updateSnapshot={updateSnapshot}
          />
        )}
        {error ? <ErrorToast copy={copy} message={localizeLauncherError(copy, error)} onDismiss={() => setError(null)} /> : null}
    </div>
  );
}

function Onboarding({
  language,
  setError,
  snapshot,
  updateState,
}: {
  language: Language;
  setError: (error: string | null) => void;
  snapshot: LauncherSnapshot;
  updateState: (state: LauncherState) => void;
}) {
  const [stage, setStage] = useState<"language" | "interaction" | "support">(
    snapshot.state.language ? "interaction" : "language",
  );
  const [selectedLanguage, setSelectedLanguage] = useState<Language>(language);
  const [selectedInteractionMode, setSelectedInteractionMode] = useState<BrowserInteractionMode>(
    snapshot.state.browserInteractionMode,
  );
  const [busy, setBusy] = useState(false);
  const localized = copyFor(selectedLanguage);
  const isLanguage = stage === "language";
  const isInteraction = stage === "interaction";
  const stageIndex = isLanguage ? 0 : isInteraction ? 1 : 2;

  const chooseLanguage = async () => {
    setBusy(true);
    setError(null);
    try {
      updateState(await api!.setLanguage(selectedLanguage));
      setStage("interaction");
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };


  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      updateState(await api!.completeOnboarding(selectedLanguage, selectedInteractionMode));
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main
      className="welcome"
    >
      <header className="welcome-top draggable">
        <div className="welcome-brand no-drag">
          <BrandMark small />
          <span>{localized.product}</span>
          {snapshot.profile === "development" ? <em className="dev-profile-badge">{localized.devBadge}</em> : null}
        </div>
        <span className="welcome-version no-drag">v{snapshot.version}</span>
      </header>

        <section
          className="welcome-stage"
          key={stage}
        >
          <span className="welcome-kicker">0{stageIndex + 1}</span>
          <h1>{isLanguage
            ? localized.chooseLanguage
            : isInteraction ? localized.interactionMode : localized.welcomeReady}</h1>
          <p>{isLanguage
            ? localized.chooseLanguageHint
            : isInteraction ? localized.interactionModeOnboardingBody : localized.welcomeReadyBody}</p>

          {isLanguage ? (
            <div className="welcome-options" role="radiogroup" aria-label={localized.chooseLanguage}>
              <WelcomeOption
                active={selectedLanguage === "en"}
                detail={localized.english}
                label={localized.english}
                marker="EN"
                onClick={() => setSelectedLanguage("en")}
              />
              <WelcomeOption
                active={selectedLanguage === "zh-CN"}
                detail={localized.chinese}
                label={localized.chinese}
                marker="简"
                onClick={() => setSelectedLanguage("zh-CN")}
              />
              <WelcomeOption
                active={selectedLanguage === "ja"}
                detail={localized.japanese}
                label={localized.japanese}
                marker="日"
                onClick={() => setSelectedLanguage("ja")}
              />
            </div>
          ) : isInteraction ? (
            <InteractionModePicker
              className="welcome-interaction-mode-picker"
              copy={localized}
              disabled={busy}
              mode={selectedInteractionMode}
              onChange={setSelectedInteractionMode}
            />
          ) : (
            <div className="welcome-features">
              {([
                ["accounts", localized.welcomeAccounts, localized.welcomeAccountsBody],
                ["mcp", localized.welcomeTools, localized.welcomeToolsBody],
                ["settings", localized.welcomePrivacy, localized.welcomePrivacyBody],
              ] as const).map(([icon, title, body]) => <div key={icon}><Icon name={icon} /><span><strong>{title}</strong><small>{body}</small></span></div>)}
            </div>
          )}
        </section>

      <footer className="welcome-footer">
        <div>
          {!isLanguage ? (
            <button
              className="text-button"
              disabled={busy}
              onClick={() => setStage(isInteraction ? "language" : "interaction")}
              type="button"
            >
              {localized.previous}
            </button>
          ) : null}
        </div>
        <div className="welcome-progress" aria-label={`${stageIndex + 1} / 3`}>
          {[0, 1, 2].map(index => (
            <span
              className={index < stageIndex ? "is-complete" : index === stageIndex ? "is-active" : ""}
              key={index}
            />
          ))}
        </div>
        <PrimaryButton
          disabled={busy}
          onClick={isLanguage
            ? chooseLanguage
            : isInteraction ? () => setStage("support") : finish}
        >
          {stage === "support" ? localized.finishWelcome : localized.continue}
        </PrimaryButton>
      </footer>
    </main>
  );
}

function LauncherShell({
  browser,
  copy,
  language,
  logs,
  operation,
  setError,
  snapshot,
  updateBrowserCapacity,
  updateProModelVersion,
  updateState,
  updateSnapshot,
}: {
  browser: BrowserState | null;
  copy: Copy;
  language: Language;
  logs: LogRecord[];
  operation: OperationState | null;
  setError: (error: string | null) => void;
  snapshot: LauncherSnapshot;
  updateBrowserCapacity: (value: BrowserCapacitySettings) => void;
  updateProModelVersion: (value: ProModelVersion | null) => void;
  updateState: (state: LauncherState) => void;
  updateSnapshot: () => Promise<void>;
}) {
  const interactionSetupComplete = snapshot.state.coreSetupComplete === true
    && (snapshot.state.browserInteractionMode === "manual"
      || snapshot.profile === "development"
      || (snapshot.state.codexCatalogVerified === true && snapshot.state.codexPickerConfirmed === true));
  const firstRunZeroRiskSetup = snapshot.state.browserInteractionMode === "manual"
    && snapshot.state.coreSetupComplete !== true;
  const [surface, setSurface] = useState<Surface>(
    firstRunZeroRiskSetup ? "mcp" : "overview",
  );
  const devProfile = snapshot.profile === "development";
  const compactAtMount = useRef(window.matchMedia(COMPACT_SIDEBAR_QUERY).matches).current;
  const [sidebarOpen, setSidebarOpen] = useState(!compactAtMount);
  const [compactSidebar, setCompactSidebar] = useState(compactAtMount);
  const [browserSlot, setBrowserSlot] = useState<HTMLDivElement | null>(null);
  const [sessionReminderBusy, setSessionReminderBusy] = useState(false);
  const [sessionReminderDue, setSessionReminderDue] = useState(false);
  const [mcpTargetMode, setMcpTargetMode] = useState<BrowserInteractionMode | null>(null);
  const [biggerContextRecommendationOpen, setBiggerContextRecommendationOpen] = useState(false);
  const [biggerContextRecommendationBusy, setBiggerContextRecommendationBusy] = useState(false);
  const browserSlotRef = useCallback((node: HTMLDivElement | null) => setBrowserSlot(node), []);
  const browserSurfaceActive = surface === "browser"
    && !(compactSidebar && sidebarOpen)
    && !biggerContextRecommendationOpen;
  const needsBrowser = snapshot.state.browserInteractionMode === "automatic"
    && browser?.authenticated !== true;
  const needsSetup = !needsBrowser && !interactionSetupComplete;
  const mcpOptional = snapshot.state.browserInteractionMode === "automatic"
    && snapshot.state.codexCatalogVerified === true
    && snapshot.state.mcpSetupComplete !== true;
  const [updateCheckCooldown, setUpdateCheckCooldown] = useState(false);
  const updateCheckTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(updateCheckTimer.current), []);
  const recheckUpdate = async () => {
    if (updateCheckCooldown) return;
    setUpdateCheckCooldown(true);
    updateCheckTimer.current = window.setTimeout(() => setUpdateCheckCooldown(false), 60_000);
    try {
      const next = await api!.recheckUpdate();
      if (next.status === "error") setError(next.message);
    } catch (error) { setError(messageOf(error)); }
  };
  const updateVisible = ["available", "downloading", "installing"].includes(snapshot.update.status);
  const updateBusy = snapshot.update.status === "downloading" || snapshot.update.status === "installing";
  const updateVersion = "version" in snapshot.update ? snapshot.update.version : null;
  const downloadLabel = snapshot.update.status === "downloading" && snapshot.update.totalBytes
    ? `${copy.updating} ${Math.floor((snapshot.update.downloadedBytes ?? 0) / snapshot.update.totalBytes * 100)}% · `
      + `${((snapshot.update.bytesPerSecond ?? 0) / 1024).toFixed(0)} KB/s`
      + (snapshot.update.remainingSeconds != null ? ` · ~${Math.ceil(snapshot.update.remainingSeconds / 60)} min` : "")
    : copy.updating;
  const selectedManualTab = browser?.tabs.find(tab => tab.active && tab.interactionMode === "manual");

  useEffect(() => {
    if (snapshot.state.browserInteractionMode === "manual") {
      setBiggerContextRecommendationOpen(false);
    }
  }, [snapshot.state.browserInteractionMode]);

  useEffect(() => {
    if (!selectedManualTab) return;
    setSurface("browser");
    setSidebarOpen(false);
    setBiggerContextRecommendationOpen(false);
    void api!.setBrowserSurfaceActive(true).catch((cause) => setError(messageOf(cause)));
  }, [selectedManualTab?.id, selectedManualTab?.manualState, setError]);

  useLayoutEffect(() => {
    let cancelled = false;
    let animationFrame = 0;
    let observer: ResizeObserver | null = null;

    const measure = () => {
      if (!browserSlot) return;
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        const rect = browserSlot.getBoundingClientRect();
        void api!.setBrowserBounds({
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        }).catch((cause) => setError(messageOf(cause)));
      });
    };

    void api!.setBrowserSurfaceActive(browserSurfaceActive).then(() => {
      if (cancelled || !browserSurfaceActive || !browserSlot) return;
      measure();
      observer = new ResizeObserver(measure);
      observer.observe(browserSlot);
      window.addEventListener("resize", measure);
    }).catch((cause) => setError(messageOf(cause)));

    return () => {
      cancelled = true;
      cancelAnimationFrame(animationFrame);
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [browserSlot, browserSurfaceActive, setError]);

  useEffect(() => {
    const media = window.matchMedia(COMPACT_SIDEBAR_QUERY);
    const apply = () => {
      setCompactSidebar(media.matches);
      setSidebarOpen(!media.matches);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const reminderAt = snapshot.state.sessionRefreshReminderAt;
    const reminderTime = reminderAt === null ? Number.NaN : Date.parse(reminderAt);
    if (browser?.authenticated !== true || !Number.isFinite(reminderTime)) {
      setSessionReminderDue(false);
      return;
    }
    const delay = reminderTime - Date.now();
    if (delay <= 0) {
      setSessionReminderDue(true);
      return;
    }
    setSessionReminderDue(false);
    const timer = window.setTimeout(() => setSessionReminderDue(true), delay);
    return () => window.clearTimeout(timer);
  }, [browser?.authenticated, snapshot.state.sessionRefreshReminderAt]);

  const activateBrowser = useCallback(async (show = false) => {
    setSurface("browser");
    await api!.setBrowserSurfaceActive(true);
    if (show) await api!.showBrowser();
  }, []);

  const toggleSidebar = () => {
    const next = !sidebarOpen;
    if (compactSidebar && next && surface === "browser") {
      void api!.setBrowserSurfaceActive(false)
        .then(() => setSidebarOpen(true))
        .catch((cause) => setError(messageOf(cause)));
      return;
    }
    setSidebarOpen(next);
  };

  const navigateSurface = (next: Surface) => {
    setSurface(next);
    if (compactSidebar) setSidebarOpen(false);
  };

  const installUpdate = async () => {
    setError(null);
    try {
      await api!.installUpdate();
    } catch (cause) {
      setError(messageOf(cause));
    }
  };

  const dismissSessionReminder = async () => {
    if (sessionReminderBusy) return;
    setSessionReminderBusy(true);
    setError(null);
    try {
      updateState(await api!.dismissSessionReminder());
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setSessionReminderBusy(false);
    }
  };

  const logoutChatGpt = async () => {
    if (sessionReminderBusy) return;
    setSessionReminderBusy(true);
    setError(null);
    try {
      const result = await api!.logoutChatGpt();
      updateState(result.state);
      navigateSurface("browser");
      await api!.setBrowserSurfaceActive(true);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setSessionReminderBusy(false);
    }
  };

  const setRecommendedBiggerContext = async (enabled: boolean) => {
    if (biggerContextRecommendationBusy) return;
    setBiggerContextRecommendationBusy(true);
    setError(null);
    try {
      updateState(await api!.setBiggerContext(enabled));
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBiggerContextRecommendationBusy(false);
    }
  };

  return (
    <main
      className={`app-shell${compactSidebar ? " is-compact" : ""}${sidebarOpen ? " is-sidebar-open" : ""}`}
    >
      <TitleBar
        copy={copy}
        surface={surface}
        devProfile={devProfile}
        draggable
        sidebarOpen={sidebarOpen}
        toggleSidebar={toggleSidebar}
      />

      {compactSidebar && sidebarOpen ? (
        <button
          aria-label={copy.hideSidebar}
          className="sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
          type="button"
        />
      ) : null}

      <aside
        inert={!sidebarOpen}
        style={{ width: sidebarOpen ? "var(--sidebar-width)" : 0 }}
        className="app-sidebar"
      >
        <div className="sidebar-clip">
          <div className="sidebar-content">
            <div className="sidebar-brand-row">
              <div className="sidebar-brand-identity">
                <BrandMark small />
                <span className="brand-wordmark"><strong>{copy.product}</strong><small>{copy.localWorkspace}</small></span>
                {devProfile ? <em className="dev-profile-badge">{copy.devBadge}</em> : null}
              </div>

            </div>

            <nav className="sidebar-nav" aria-label={copy.workspace}>
              <SidebarGroup label={copy.workspace}>
                <SidebarItem active={surface === "overview"} icon="overview" label={copy.overview} onClick={() => navigateSurface("overview")} />
                <SidebarItem active={surface === "accounts"} icon="accounts" label={copy.accountsNav} onClick={() => navigateSurface("accounts")} />
                <SidebarItem
                  active={surface === "browser"}
                  badge={needsBrowser
                    ? <ActionDot pulse tone="required" />
                    : browser?.status === "error"
                      ? <ActionDot tone="error" />
                      : null}
                  icon="browser"
                  label={copy.browser}
                  onClick={() => navigateSurface("browser")}
                />
              </SidebarGroup>
              <SidebarGroup label={copy.configuration}>
                <SidebarItem
                  active={surface === "setup"}
                  badge={needsSetup ? <ActionDot pulse tone="required" /> : null}
                  icon="setup"
                  label={copy.setup}
                  onClick={() => navigateSurface("setup")}
                />
                <SidebarItem
                  active={surface === "mcp"}
                  badge={mcpOptional ? <ActionDot tone="optional" /> : null}
                  icon="mcp"
                  label={copy.localTools}
                  onClick={() => {
                    setMcpTargetMode(null);
                    navigateSurface("mcp");
                  }}
                />
              </SidebarGroup>
              <SidebarGroup label={copy.runtime}>
                <SidebarItem active={surface === "activity"} icon="activity" label={copy.activity} onClick={() => navigateSurface("activity")} />
              </SidebarGroup>
            </nav>

            <div className="sidebar-footer">
              <div className="sidebar-session"><StateDot state={browser?.authenticated ? "ready" : "idle"} /><span>{browser?.authenticated ? copy.sessionConnected : copy.sessionDisconnected}</span></div>
              {updateVisible ? (
                <SidebarItem
                  active={false}
                  disabled={updateBusy || operation?.status === "running" || browser?.status === "running"}
                  icon="update"
                  label={updateBusy ? downloadLabel : `${copy.updateAvailable} v${updateVersion}`}
                  onClick={() => void installUpdate()}
                  tone="update"
                />
              ) : null}
              {!updateVisible && snapshot.update.status !== "disabled" ? (
                <SidebarItem active={false} icon="update"
                  disabled={updateCheckCooldown || snapshot.update.status === "checking"}
                  label={snapshot.update.status === "checking" ? copy.loading : updateCheckCooldown ? copy.updateCheckCooldown : copy.checkUpdates}
                  onClick={() => void recheckUpdate()} />
              ) : null}
              <SidebarItem
                active={surface === "settings"}
                icon="settings"
                label={copy.settings}
                onClick={() => navigateSurface("settings")}
              />
              <button className="sidebar-source" type="button" onClick={() => void api!.openExternal(snapshot.urls.github).catch(cause => setError(messageOf(cause)))}><Icon name="github" /><span>{copy.sourceCode}</span><small>v{snapshot.version}</small></button>
            </div>
          </div>
        </div>
      </aside>

      <section className="workspace">
          <div
            className="surface-transition"
            key={surface}
          >
            {surface === "overview" ? <Overview copy={copy} browser={browser} snapshot={snapshot} logs={logs} navigate={navigateSurface} /> : null}
            {surface === "accounts" ? <ContentSurface title={copy.accountsTitle} subtitle={copy.accountsBody}>
              <AccountSettings copy={copy} openBrowser={() => navigateSurface("browser")} setError={setError} manual={snapshot.state.browserInteractionMode === "manual"} />
            </ContentSurface> : null}
            {surface === "browser" ? (
              <BrowserSurface
                browser={browser}
                browserSlotRef={browserSlotRef}
                copy={copy}
                interactionMode={snapshot.state.browserInteractionMode}
                operation={operation}
                platform={snapshot.platform}
                setError={setError}
              />
            ) : null}
            {surface === "setup" ? (
              <SetupSurface
                activateBrowser={activateBrowser}
                browser={browser}
                copy={copy}
                devProfile={devProfile}
                operation={operation}
                setError={setError}
                showMcp={() => {
                  setMcpTargetMode(null);
                  setSurface("mcp");
                }}
                snapshot={snapshot}
                updateState={updateState}
              />
            ) : null}
            {surface === "mcp" ? (
              <McpSurface
                copy={copy}
                devProfile={devProfile}
                interactionMode={mcpTargetMode ?? snapshot.state.browserInteractionMode}
                language={language}
                onDone={() => {
                  setMcpTargetMode(null);
                  setSurface("browser");
                }}
                operation={operation}
                setError={setError}
                snapshot={snapshot}
                updateState={updateState}
                updateSnapshot={updateSnapshot}
              />
            ) : null}
            {surface === "activity" ? (
              <ActivitySurface copy={copy} language={language} logs={logs} setError={setError} />
            ) : null}
            {surface === "settings" ? (
              <SettingsSurface
                browser={browser}
                configureInteractionMode={(mode) => {
                  setMcpTargetMode(mode);
                  setSurface("mcp");
                }}
                copy={copy}
                devProfile={devProfile}
                language={language}
                operation={operation}
                setError={setError}
                snapshot={snapshot}
                updateBrowserCapacity={updateBrowserCapacity}
                updateProModelVersion={updateProModelVersion}
                showBiggerContextInfo={() => setBiggerContextRecommendationOpen(true)}
                updateState={updateState}
              />
            ) : null}
          </div>
      </section>

        {biggerContextRecommendationOpen ? (
          <BiggerContextRecommendation
            busy={biggerContextRecommendationBusy || operation?.status === "running"}
            checked={snapshot.state.experimentalBiggerContext}
            copy={copy}
            onChange={(enabled) => void setRecommendedBiggerContext(enabled)}
            onClose={() => setBiggerContextRecommendationOpen(false)}
          />
        ) : null}

        {sessionReminderDue && !biggerContextRecommendationOpen ? (
          <SessionRefreshReminder
            busy={sessionReminderBusy}
            copy={copy}
            onDismiss={() => void dismissSessionReminder()}
            onLogout={() => void logoutChatGpt()}
          />
        ) : null}
    </main>
  );
}

function TitleBar({
  copy,
  surface,
  devProfile,
  draggable,
  sidebarOpen,
  toggleSidebar,
}: {
  copy: Copy;
  surface: Surface;
  devProfile: boolean;
  draggable: boolean;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
}) {
  return (
    <header className={`app-titlebar${draggable ? " draggable" : ""}`}>
      <div className="titlebar-left no-drag">
        <IconButton
          icon="sidebar"
          label={sidebarOpen ? copy.hideSidebar : copy.showSidebar}
          onClick={toggleSidebar}
        />
        {devProfile ? <span className="titlebar-dev-profile">{copy.devBadge}</span> : null}
      </div>
      <div className="titlebar-location"><span>NEKODEX</span><span aria-hidden="true">/</span><strong>{({ overview: copy.overview, accounts: copy.accountsNav, browser: copy.browser, setup: copy.setup, mcp: copy.localTools, activity: copy.activity, settings: copy.settings })[surface]}</strong></div>
    </header>
  );
}

function SidebarGroup({ children, label }: { children: ReactNode; label: string }) {
  return (
    <section className="sidebar-group">
      <h2>{label}</h2>
      <div>{children}</div>
    </section>
  );
}

function SidebarItem({
  active,
  badge,
  disabled = false,
  icon,
  label,
  onClick,
  tone,
}: {
  active: boolean;
  badge?: ReactNode;
  disabled?: boolean;
  icon: IconName;
  label: string;
  onClick: () => void;
  tone?: "update";
}) {
  return (
    <button
      aria-current={active ? "page" : undefined}
      className={`sidebar-item${active ? " is-active" : ""}${tone === "update" ? " is-update" : ""}`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {icon === "mcp" ? <McpMark /> : <Icon name={icon} />}
      <span>{label}</span>
      {badge ? <i className="sidebar-item-badge">{badge}</i> : null}
    </button>
  );
}

function BrowserSurface({
  browser,
  browserSlotRef,
  copy,
  interactionMode,
  operation,
  platform,
  setError,
}: {
  browser: BrowserState | null;
  browserSlotRef: (node: HTMLDivElement | null) => void;
  copy: Copy;
  interactionMode: BrowserInteractionMode;
  operation: OperationState | null;
  platform: string;
  setError: (error: string | null) => void;
}) {
  const [passkeyStarting, setPasskeyStarting] = useState(false);
  const [passkeyRequestPending, setPasskeyRequestPending] = useState(false);
  const [existingChromeStarting, setExistingChromeStarting] = useState(false);
  const visible = browser?.visible === true;
  const manualInteraction = interactionMode === "manual";
  const { navigationLocked, passkeyAvailable, passkeyWaiting, passkeyBlocked, passkeyCanImport,
    existingChromeAvailable, existingChromeWaiting, existingChromeBlocked } = browserControls(
    browser, operation, platform, interactionMode,
  );
  const selectedManualTab = browser?.tabs.find(tab => tab.active && tab.interactionMode === "manual");
  const passkeyLabel = passkeyStarting || browser?.passkeyLogin?.phase === "starting" ? copy.passkeyStarting
    : !passkeyWaiting ? copy.passkeySignIn
    : passkeyCanImport ? copy.passkeyContinue
    : browser?.passkeyLogin?.phase === "verifying" ? copy.passkeyVerifying
    : browser?.passkeyLogin?.phase === "cancelling" ? copy.passkeyCancelling
    : copy.passkeyImporting;
  const passkeyActionDisabled = passkeyBlocked || passkeyRequestPending
    || (passkeyWaiting ? !passkeyCanImport : passkeyStarting);
  useEffect(() => {
    if (passkeyWaiting) setPasskeyStarting(false);
  }, [passkeyWaiting]);
  const navigate = async (action: "back" | "forward" | "reload") => {
    if (navigationLocked) return;
    try {
      await api!.navigateBrowser(action);
    } catch (cause) {
      setError(messageOf(cause));
    }
  };
  const zoom = async (action: "in" | "out" | "reset") => {
    try {
      await api!.zoomBrowser(action);
    } catch (cause) {
      setError(messageOf(cause));
    }
  };
  const toggle = async () => {
    try {
      if (visible) await api!.hideBrowser();
      else await api!.showBrowser();
    } catch (cause) {
      setError(messageOf(cause));
    }
  };
  const selectTab = async (tabId: string) => {
    try {
      await api!.selectBrowserTab(tabId);
    } catch (cause) {
      setError(messageOf(cause));
    }
  };
  const closeTab = async (tabId: string) => {
    try {
      await api!.closeBrowserTab(tabId);
    } catch (cause) {
      setError(messageOf(cause));
    }
  };
  const openPasskeyLogin = async () => {
    if (passkeyActionDisabled || passkeyWaiting) return;
    setPasskeyStarting(true);
    setError(null);
    try {
      await api!.openPasskeyLogin();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setPasskeyStarting(false);
    }
  };
  const openExistingChromeLogin = async () => {
    if (existingChromeBlocked || existingChromeWaiting || existingChromeStarting) return;
    setExistingChromeStarting(true);
    setError(null);
    try { await api!.openExistingChromeLogin(); }
    catch { setError(copy.existingChromeFailure); }
    finally { setExistingChromeStarting(false); }
  };
  const continuePasskeyLogin = async () => {
    if (!passkeyCanImport || passkeyRequestPending) return;
    setPasskeyRequestPending(true);
    setError(null);
    try {
      await api!.continuePasskeyLogin();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setPasskeyRequestPending(false);
    }
  };
  const copyManualPrompt = async (tabId: string) => {
    try {
      await api!.copyManualPrompt(tabId);
    } catch (cause) {
      setError(messageOf(cause));
    }
  };
  const confirmManualSent = async (tabId: string) => {
    try {
      await api!.confirmManualSent(tabId);
    } catch (cause) {
      setError(messageOf(cause));
    }
  };

  return (
    <section className="browser-surface">
      {browser?.accountName ? <div className="browser-account-label">{copy.accountsCurrent}: {browser.accountName}</div> : null}
      <div className="browser-tab-strip" role="tablist" aria-label={copy.browser} title={copy.browserTabLimit}>
        {(browser?.tabs ?? []).map((tab) => (
          <div
            className={`browser-tab${tab.active ? " is-active" : ""}`}
            key={tab.id}
            onClick={() => void selectTab(tab.id)}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                void selectTab(tab.id);
              }
              if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                event.preventDefault();
                const tabs = browser?.tabs ?? [];
                const index = tabs.findIndex((candidate) => candidate.id === tab.id);
                const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
                  : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
                const next = tabs[nextIndex];
                if (next) {
                  void selectTab(next.id);
                  event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]')[nextIndex]?.focus();
                }
              }
            }}
            role="tab"
            aria-selected={tab.active}
            tabIndex={tab.active ? 0 : -1}
          >
            <BrandMark small />
            <span title={tab.traceId ? `${tab.title} · ${tab.traceId}` : tab.title}>
              {browserTabTitleFromTitle(tab.title, copy)}
            </span>
            {tab.loading ? <i className="tab-spinner" /> : <StateDot state={browserTabTone(tab.status)} />}
            {tab.closable ? (
              <button
                aria-label={copy.hideTab}
                onClick={(event) => {
                  event.stopPropagation();
                  void closeTab(tab.id);
                }}
                title={copy.hideTab}
                type="button"
              >
                <Icon name="close" />
              </button>
            ) : null}
          </div>
        ))}
        <div className="browser-tab-drag draggable" />
      </div>
      <div className="browser-toolbar">
        <div className="browser-history">
          <IconButton
            disabled={navigationLocked || !browser?.canGoBack}
            icon="back"
            label={copy.back}
            onClick={() => void navigate("back")}
          />
          <IconButton
            disabled={navigationLocked || !browser?.canGoForward}
            icon="forward"
            label={copy.forward}
            onClick={() => void navigate("forward")}
          />
          <IconButton disabled={navigationLocked || !visible} icon="reload" label={copy.reload} onClick={() => void navigate("reload")} />
        </div>
        <div className="browser-address" title={formatBrowserAddress(browser?.url, copy)}>
          <Icon name="globe" />
          <span>{formatBrowserAddress(browser?.url, copy)}</span>
        </div>
        <div className="browser-zoom-controls">
          <IconButton icon="minus" label={copy.zoomOut} onClick={() => void zoom("out")} />
          <button
            aria-label={copy.zoomReset}
            className="browser-zoom-reset"
            onClick={() => void zoom("reset")}
            title={copy.zoomReset}
            type="button"
          >
            {Math.round((browser?.zoomFactor ?? 1) * 100)}%
          </button>
          <IconButton icon="plus" label={copy.zoomIn} onClick={() => void zoom("in")} />
        </div>
        {existingChromeAvailable ? (
          <button className="toolbar-text-button" type="button"
            disabled={existingChromeBlocked || existingChromeStarting || existingChromeWaiting}
            onClick={() => void openExistingChromeLogin()}>{copy.existingChromeSignIn}</button>
        ) : null}
        {passkeyAvailable ? (
          <button
            className="toolbar-text-button"
            disabled={passkeyActionDisabled}
            onClick={() => void (passkeyWaiting ? continuePasskeyLogin() : openPasskeyLogin())}
            type="button"
          >
            {passkeyLabel}
          </button>
        ) : null}
        <button className="toolbar-text-button" onClick={() => void toggle()} type="button">
          {visible ? copy.hideBrowser : copy.openChatgpt}
        </button>
        {browser?.loading ? <i className="browser-loading-line" /> : null}
      </div>
      {!manualInteraction && browser?.existingChromeLogin ? (
        <ExistingChromeLoginGuide progress={browser.existingChromeLogin} copy={copy} onRetry={openExistingChromeLogin} setError={setError} />
      ) : !manualInteraction && browser?.passkeyLogin && browser.passkeyLogin.phase !== "completed" ? (
        <PasskeyLoginGuide progress={browser.passkeyLogin} copy={copy} onRetry={openPasskeyLogin} setError={setError} />
      ) : browser?.loginKind === "embedded" ? (
        <div className="browser-login-guide" role="status">
          <p>{passkeyAvailable ? copy.embeddedLoginPasskeyBody : copy.embeddedLoginBody}</p>
        </div>
      ) : null}
      {selectedManualTab
        && ["awaiting-user", "sent"].includes(selectedManualTab.manualState ?? "") ? (
        <ManualTurnGuide
          copy={copy}
          onCancel={() => void closeTab(selectedManualTab.id)}
          onCopy={() => void copyManualPrompt(selectedManualTab.id)}
          onSent={() => void confirmManualSent(selectedManualTab.id)}
          tab={selectedManualTab}
        />
      ) : null}
      <div className="browser-viewport" ref={browserSlotRef}>
        {!visible ? (
          <div className="browser-empty">
            <BrandMark />
            <h1>{manualInteraction
              ? copy.browserReady
              : browser?.authenticated ? copy.noActiveTask : copy.stepAccount}</h1>
            <p>{manualInteraction
              ? copy.stepAccountBody
              : browser?.authenticated
              ? copy.noActiveTaskBody
              : existingChromeWaiting ? copy.existingChromeBody : passkeyWaiting ? copy.passkeyContinueBody : copy.stepAccountBody}</p>
            <div className="browser-empty-actions">
              {existingChromeAvailable ? <PrimaryButton
                disabled={existingChromeBlocked || existingChromeStarting || existingChromeWaiting}
                onClick={() => void openExistingChromeLogin()}>{copy.existingChromeSignIn}</PrimaryButton> : null}
              <SecondaryButton disabled={passkeyWaiting || existingChromeWaiting} onClick={() => void toggle()}>
                {manualInteraction || browser?.authenticated ? copy.openChatgpt : copy.signIn}
              </SecondaryButton>
              {passkeyAvailable ? (
                <SecondaryButton
                  disabled={passkeyActionDisabled}
                  onClick={passkeyWaiting ? continuePasskeyLogin : openPasskeyLogin}
                >
                  {passkeyLabel}
                </SecondaryButton>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="browser-underlay" aria-hidden="true">
            <span>{copy.loading}</span>
          </div>
        )}
      </div>
    </section>
  );
}

function ManualTurnGuide({
  copy,
  onCancel,
  onCopy,
  onSent,
  tab,
}: {
  copy: Copy;
  onCancel: () => void;
  onCopy: () => void;
  onSent: () => void;
  tab: BrowserState["tabs"][number];
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (tab.manualState !== "awaiting-user" || !tab.manualDeadlineAt) return;
    setNow(Date.now());
    let timer: number | undefined;
    const refresh = () => {
      window.clearInterval(timer);
      timer = undefined;
      if (document.hidden) return;
      setNow(Date.now());
      timer = window.setInterval(() => setNow(Date.now()), 1_000);
    };
    refresh();
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [tab.manualDeadlineAt, tab.manualState]);
  const deadline = tab.manualDeadlineAt ? Date.parse(tab.manualDeadlineAt) : Number.NaN;
  const seconds = Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - now) / 1_000)) : 0;
  const waiting = tab.manualState === "awaiting-user";
  const status = waiting
    ? `${seconds} ${copy.manualPromptSeconds}`
    : tab.manualState === "sent"
      ? copy.manualPromptSent
      : tab.manualState === "running"
        ? copy.manualPromptRunning
        : tab.manualState === "completed"
          ? copy.complete
          : copy.failed;
  return (
    <div className={`manual-turn-guide${waiting ? " is-waiting" : ""}`}>
      <div>
        <strong>{waiting ? copy.manualPromptTitle : copy.manualPromptWaiting}</strong>
        {waiting ? <p>{copy.manualPromptInstruction}</p> : null}
      </div>
      <span className="manual-turn-status">{status}</span>
      <div className="manual-turn-actions">
        <SecondaryButton onClick={onCancel}>{copy.manualPromptCancel}</SecondaryButton>
        <SecondaryButton disabled={!tab.canCopyPrompt} onClick={onCopy}>{copy.manualPromptCopy}</SecondaryButton>
        <PrimaryButton disabled={!tab.canConfirmSent} onClick={onSent}>{copy.manualPromptSent}</PrimaryButton>
      </div>
    </div>
  );
}

function SetupSurface({
  activateBrowser,
  browser,
  copy,
  devProfile,
  operation,
  setError,
  showMcp,
  snapshot,
  updateState,
}: {
  activateBrowser: (show?: boolean) => Promise<void>;
  browser: BrowserState | null;
  copy: Copy;
  devProfile: boolean;
  operation: OperationState | null;
  setError: (error: string | null) => void;
  showMcp: () => void;
  snapshot: LauncherSnapshot;
  updateState: (state: LauncherState) => void;
}) {
  const [localBusy, setLocalBusy] = useState(false);
  const [hermesAdded, setHermesAdded] = useState(false);
  const manualInteraction = snapshot.state.browserInteractionMode === "manual";
  const catalogPending = !devProfile && snapshot.state.coreSetupComplete === true
    && snapshot.state.codexCatalogVerified !== true;
  const pickerReady = snapshot.state.coreSetupComplete === true && (devProfile || (snapshot.state.codexCatalogVerified === true && snapshot.state.codexPickerConfirmed === true));
  const confirmPending = !devProfile && snapshot.state.coreSetupComplete === true && snapshot.state.codexCatalogVerified === true && !snapshot.state.codexPickerConfirmed;
  const pendingContext = typeof snapshot.state.pendingBiggerContext === "boolean";
  const troubleshooting = useRef<HTMLDetailsElement>(null);
  const nextStep = setupNextStep({ manual: manualInteraction, signedIn: browser?.authenticated === true,
    smokePassed: snapshot.smokePassed, installed: snapshot.state.coreSetupComplete === true,
    catalogVerified: snapshot.state.codexCatalogVerified === true, pickerConfirmed: snapshot.state.codexPickerConfirmed === true,
    toolsInstalled: snapshot.state.mcpRuntimeInstalled === true && snapshot.mcpCredentialsConfigured,
    toolsVerified: snapshot.state.mcpSetupComplete === true, development: devProfile });
  const busy = localBusy
    || operation?.status === "running"
    || (!manualInteraction && (
      browser?.loginInProgress === true
      || browser?.navigationLocked === true
      || browser?.status === "loading"
      || browser?.status === "testing"
      || browser?.status === "running"
    ));
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setLocalBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setLocalBusy(false);
    }
  };

  const openLogin = () => run(async () => {
    await activateBrowser();
    await api!.openLogin();
  });
  const useExistingChrome = !manualInteraction && ["darwin", "win32", "linux"].includes(snapshot.platform);
  const openExistingChromeLogin = () => run(async () => {
    await activateBrowser(false);
    await api!.openExistingChromeLogin();
  });
  const smoke = () => run(async () => {
    await activateBrowser();
    await api!.smokeTest();
    updateState((await api!.snapshot()).state);
  });
  const install = () => run(async () => {
    await api!.setupCore();
    updateState((await api!.snapshot()).state);
  });
  const setZeroRiskPro = (enabled: boolean) => run(async () => {
    updateState(await api!.setZeroRiskPro(enabled));
  });
  // Saving a separate Hermes provider does not navigate the browser or replace a running turn.
  const addHermes = async (runtime: "codex_responses" | "codex_app_server" = "codex_app_server") => {
    if (localBusy) return;
    setLocalBusy(true);
    setError(null);
    try { await api!.setupHermes({ runtime, makeDefault: runtime === "codex_app_server" }); setHermesAdded(true); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setLocalBusy(false); }
  };

  const confirmModels = () => run(async () => { updateState(await api!.confirmCodexModels()); });
  const showTroubleshooting = () => {
    if (!troubleshooting.current) return;
    troubleshooting.current.open = true;
    troubleshooting.current.scrollIntoView({ block: "start" });
    troubleshooting.current.querySelector<HTMLButtonElement>("button")?.focus();
  };
  const nextTitle = { "sign-in": copy.stepAccount, test: copy.stepSmoke, install: copy.stepInstall,
    catalog: copy.setupCatalogTitle, confirm: copy.setupConfirmTitle, tools: copy.localTools,
    ready: snapshot.state.mcpSetupComplete ? copy.setupReadyFull : copy.setupReadyModels }[nextStep];
  const nextBody = { "sign-in": copy.stepAccountBody, test: copy.stepSmokeBody, install: copy.stepInstallBody,
    catalog: copy.setupCatalogBody, confirm: copy.setupConfirmBody, tools: copy.mcpBody,
    ready: copy.setupUseCodex }[nextStep];
  const nextLabel = { "sign-in": copy.signIn, test: copy.runSmoke, install: copy.install,
    catalog: copy.diagnostics, confirm: copy.confirmPicker, tools: copy.configureMcp,
    ready: copy.openWorkspace }[nextStep];
  const nextAction = () => {
    if (nextStep === "sign-in") void openLogin();
    else if (nextStep === "test") void smoke();
    else if (nextStep === "install") void install();
    else if (nextStep === "confirm") void confirmModels();
    else if (nextStep === "catalog") showTroubleshooting();
    else if (nextStep === "tools") showMcp();
    else void activateBrowser().catch(cause => setError(messageOf(cause)));
  };

  return (
    <ContentSurface
      eyebrow={copy.required}
      subtitle={devProfile
        ? copy.devSetupSubtitle
        : manualInteraction ? copy.manualInteractionBody : copy.setupSubtitle}
      title={devProfile ? copy.devSetupTitle : copy.setupTitle}
    >
      <section className="setup-overview setup-next" aria-label={copy.setupNext}>
        <div><small>{copy.setupNext}</small><h2>{nextTitle}</h2><p>{nextBody}</p>
          {confirmPending && pendingContext ? <p role="status">{copy.contextWaiting}</p> : null}
        </div>
        <PrimaryButton disabled={busy || (nextStep === "confirm" && pendingContext)} onClick={nextAction}>{nextLabel}</PrimaryButton>
      </section>
      <SectionHeading label={devProfile ? copy.devCoreSetup : copy.coreSetup} />
      <div className="setup-list">
        {!manualInteraction ? <>
          <SetupRow
            action={browser?.authenticated
              ? copy.signedIn
              : browser?.status === "loading" ? copy.checkingSignIn : useExistingChrome ? copy.existingChromeSignIn : copy.signIn}
            complete={browser?.authenticated === true}
            description={browser?.authenticated && browser.accountLabel
              ? `${copy.signedIn}: ${browser.accountLabel}`
              : useExistingChrome ? copy.existingChromeBody : copy.stepAccountBody}
            disabled={busy}
            index={1}
            onAction={useExistingChrome ? openExistingChromeLogin : openLogin}
            secondaryAction={useExistingChrome && !browser?.authenticated ? copy.signIn : undefined}
            onSecondaryAction={openLogin}
            secondaryDisabled={busy}
            title={copy.stepAccount}
          />
          <SetupRow
            action={snapshot.smokePassed ? copy.smokePassed : copy.runSmoke}
            complete={snapshot.smokePassed}
            description={snapshot.state.coreSetupComplete ? copy.setupOptionalCheck : copy.stepSmokeBody}
            titleAction={snapshot.state.coreSetupComplete ? <small className="setup-optional">{copy.optional}</small> : undefined}
            disabled={busy || !browser?.authenticated}
            index={2}
            onAction={smoke}
            title={copy.stepSmoke}
          />
        </> : null}
        <SetupRow
          action={confirmPending ? copy.confirmPicker : catalogPending ? copy.diagnostics : pickerReady ? copy.done : devProfile ? copy.devInstall : copy.install}
          complete={pickerReady}
          description={confirmPending ? copy.setupConfirmBody : catalogPending ? copy.setupCatalogBody : devProfile ? copy.devStepInstallBody : copy.stepInstallBody}
          disabled={busy || (confirmPending && pendingContext) || (!manualInteraction && !browser?.authenticated)
            || (!snapshot.state.coreSetupComplete && !snapshot.smokePassed && !manualInteraction)}
          index={manualInteraction ? 1 : 3}
          onAction={confirmPending ? confirmModels : catalogPending ? showTroubleshooting : manualInteraction && !snapshot.state.mcpRuntimeInstalled ? showMcp : install}
          title={confirmPending ? copy.setupConfirmTitle : catalogPending ? copy.setupCatalogTitle : snapshot.state.coreSetupComplete ? copy.setupInstalledTitle : devProfile ? copy.devStepInstall : copy.stepInstall}
          titleAction={manualInteraction ? (
            <ZeroRiskModelMenu
              busy={busy || snapshot.state.coreSetupComplete !== true}
              copy={copy}
              proEnabled={snapshot.state.zeroRiskProEnabled}
              onChange={(enabled) => void setZeroRiskPro(enabled)}
            />
          ) : undefined}
        />
      </div>

      <details className="setup-troubleshooting" ref={troubleshooting}>
        <summary>{copy.setupTroubleshooting}<Icon name="chevron" /></summary>
        {!devProfile ? <RouteDiagnostics disabled={busy} language={snapshot.state.language ?? "en"} readReport={() => api!.routeDiagnostics()} /> : null}
        {snapshot.state.coreSetupComplete ? <button className="button-secondary" type="button" disabled={busy} onClick={() => void install()}>{copy.setupRepair}</button> : null}
      </details>

      <SectionHeading label={copy.localTools} meta={manualInteraction ? copy.required : copy.optional} spaced />
      {snapshot.state.mcpSetupComplete && snapshot.state.setupVerifiedAt ? (
        <p>{`Last connector verification: ${new Date(snapshot.state.setupVerifiedAt).toLocaleString()}`}</p>
      ) : null}
      <button
        className="next-surface-row"
        disabled={!manualInteraction && !snapshot.state.codexCatalogVerified}
        onClick={showMcp}
        type="button"
      >
        <McpMark />
        <span>
          <strong>{devProfile ? copy.devMcpTitle : copy.mcpTitle}</strong>
          <small>{devProfile ? copy.devMcpBody : copy.mcpBody}</small>
        </span>
        <em>{snapshot.state.mcpSetupComplete ? copy.mcpReady : copy.configureMcp}</em>
        <Icon name="chevron" />
      </button>
      {!devProfile && !manualInteraction ? <>
        <details className="setup-troubleshooting"><summary>Hermes <small>{copy.optional}</small><Icon name="chevron" /></summary>
        <div className="setup-overview">
          <strong>{copy.hermesTitle}</strong>
          <p>{copy.hermesBody}</p>
          <PrimaryButton disabled={localBusy || !snapshot.state.mcpRuntimeInstalled} onClick={() => void addHermes()}>{hermesAdded ? copy.hermesUpdate : copy.hermesAdd}</PrimaryButton>
          <p role="status">{hermesAdded ? copy.hermesAdded : !snapshot.state.mcpSetupComplete ? copy.hermesPending : copy.hermesChoose}</p>
          <details>
            <summary>{copy.hermesDirectTitle}</summary>
            <p>{copy.hermesDirectBody}</p>
            <button className="secondary-button" disabled={localBusy || !snapshot.state.mcpRuntimeInstalled} onClick={() => void addHermes("codex_responses")} type="button">{copy.hermesDirectAdd}</button>
          </details>
        </div>
        </details>
      </> : null}
    </ContentSurface>
  );
}

function McpSurface({
  copy,
  devProfile,
  interactionMode,
  language,
  onDone,
  operation,
  setError,
  snapshot,
  updateState,
  updateSnapshot,
}: {
  copy: Copy;
  devProfile: boolean;
  interactionMode: BrowserInteractionMode;
  language: Language;
  onDone: () => void;
  operation: OperationState | null;
  setError: (error: string | null) => void;
  snapshot: LauncherSnapshot;
  updateState: (state: LauncherState) => void;
  updateSnapshot: () => Promise<void>;
}) {
  const configuringInactiveMode = interactionMode !== snapshot.state.browserInteractionMode;
  const [step, setStep] = useState(
    configuringInactiveMode ? 1
      : snapshot.state.mcpRuntimeInstalled && snapshot.mcpCredentialsConfigured ? 2
      : Math.min(2, Math.max(0, snapshot.state.mcpGuideStep || 0)),
  );
  const [tunnelId, setTunnelId] = useState("");
  const [runtimeKey, setRuntimeKey] = useState("");
  const [credentialsConfigured, setCredentialsConfigured] = useState(
    interactionMode === snapshot.state.browserInteractionMode
      ? snapshot.mcpCredentialsConfigured
      : false,
  );
  const [replacingCredentials, setReplacingCredentials] = useState(false);
  useEffect(() => {
    if (!replacingCredentials && interactionMode === snapshot.state.browserInteractionMode) {
      setCredentialsConfigured(snapshot.mcpCredentialsConfigured);
    }
  }, [interactionMode, replacingCredentials, snapshot.mcpCredentialsConfigured, snapshot.state.browserInteractionMode]);
  const [localBusy, setLocalBusy] = useState(false);
  const busy = localBusy || operation?.status === "running";
  const [doctor, setDoctor] = useState<DoctorReport | null>(null);
  const verified = !configuringInactiveMode && snapshot.state.mcpSetupComplete === true;
  const manualInteraction = interactionMode === "manual";
  const steps = useMemo(() => [
    { title: copy.mcpStepOne, body: copy.mcpStepOneBody },
    { title: copy.mcpStepTwo, body: copy.mcpStepTwoBody },
    {
      title: copy.mcpStepThree,
      body: manualInteraction ? copy.manualMcpStepThreeBody : copy.mcpStepThreeBody,
    },
  ], [copy, manualInteraction]);
  const guideMedia = MCP_GUIDE_MEDIA[step];

  const move = async (next: number) => {
    setStep(next);
    updateState(await api!.setMcpStep(next));
  };
  const safeMove = async (next: number) => {
    if (busy) return;
    setError(null);
    try {
      await move(next);
    } catch (cause) {
      setError(messageOf(cause));
    }
  };
  const openExternal = async (url: string) => {
    setError(null);
    try {
      await api!.openExternal(url);
    } catch (cause) {
      setError(messageOf(cause));
    }
  };
  const install = async () => {
    if (busy) return;
    setLocalBusy(true);
    setError(null);
    try {
      await api!.setupMcp({
        interactionMode,
        ...(credentialsConfigured && !replacingCredentials
          ? { replace: false }
          : { tunnelId, runtimeKey, replace: true }),
      });
      setRuntimeKey("");
      setTunnelId("");
      setCredentialsConfigured(true);
      setReplacingCredentials(false);
      await updateSnapshot();
      await move(2);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setLocalBusy(false);
    }
  };
  const verify = async () => {
    if (busy) return;
    setLocalBusy(true);
    setError(null);
    setDoctor(null);
    try {
      setDoctor(await api!.verifyMcp());
      await updateSnapshot();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setLocalBusy(false);
    }
  };

  return (
    <ContentSurface
      subtitle={devProfile ? copy.devMcpSubtitle : copy.mcpSubtitle}
      title={devProfile ? copy.devMcpTitle : copy.localTools}
    >
      {!manualInteraction && !configuringInactiveMode && !snapshot.state.codexCatalogVerified ? (
        <NoticeRow icon="setup" tone="warning">{copy.mcpCatalogRequired}</NoticeRow>
      ) : null}

      <div className="wizard-stepper" aria-label={`${step + 1} / 3`}>
        {steps.map((item, index) => (
          <button
            className={`${index === step ? "is-active" : ""}${index < step || (index === 2 && verified) ? " is-complete" : ""}`}
            aria-label={`${index + 1}. ${item.title}`}
            title={item.title}
            disabled={busy || index > step}
            key={item.title}
            onClick={() => void safeMove(index)}
            type="button"
          >
            <span>{index < step || (index === 2 && verified) ? <Icon name="check" /> : index + 1}</span>
            <em>{item.title}</em>
          </button>
        ))}
      </div>

      <div className="mcp-stage">
        {guideMedia ? <details className="setup-video-help" onToggle={event => { if (!event.currentTarget.open) event.currentTarget.querySelector("video")?.pause(); }}><summary>{copy.guideVideo}</summary>
          <TutorialVideo
            copy={copy}
            label={`${copy.guideVideo}: ${steps[step]!.title}`}
            src={guideMedia}
          />
        </details> : null}

          <section
            className="wizard-content"
            key={step}
          >
            <header>
              <span>0{step + 1}</span>
              <div>
                <h2>{steps[step]!.title}</h2>
                <p>{steps[step]!.body}</p>
              </div>
            </header>

            {step === 0 ? (
              <div className="inline-actions">
                <SecondaryButton icon="external" onClick={() => void openExternal(snapshot.urls.tunnels)}>
                  {copy.openTunnels}
                </SecondaryButton>
                <SecondaryButton icon="external" onClick={() => void openExternal(snapshot.urls.keys)}>
                  {copy.openKeys}
                </SecondaryButton>
              </div>
            ) : null}
            {step === 1 ? (
              credentialsConfigured && !replacingCredentials ? (
                <div className="saved-credentials">
                  <NoticeRow icon="check" tone="success">
                    <span>
                      <strong>{copy.credentialsConfigured}</strong>
                      <small>{copy.credentialsConfiguredBody}</small>
                    </span>
                  </NoticeRow>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => setReplacingCredentials(true)}
                    type="button"
                  >
                    {copy.replaceCredentials}
                  </button>
                </div>
              ) : (
                <div className="field-list">
                  <FieldRow label={copy.tunnelId}>
                    <input
                      autoCapitalize="none"
                      autoCorrect="off"
                      onChange={(event) => setTunnelId(event.target.value)}
                      placeholder="tunnel_…"
                      spellCheck={false}
                      value={tunnelId}
                    />
                  </FieldRow>
                  <FieldRow label={copy.runtimeKey}>
                    <input
                      autoCapitalize="none"
                      autoCorrect="off"
                      onChange={(event) => setRuntimeKey(event.target.value)}
                      placeholder="sk-…"
                      spellCheck={false}
                      type="password"
                      value={runtimeKey}
                    />
                  </FieldRow>
                  {credentialsConfigured ? (
                    <button
                      className="text-button keep-credentials"
                      disabled={busy}
                      onClick={() => {
                        setTunnelId("");
                        setRuntimeKey("");
                        setReplacingCredentials(false);
                      }}
                      type="button"
                    >
                      {copy.keepCredentials}
                    </button>
                  ) : null}
                </div>
              )
            ) : null}
            {step === 1 ? (
              <p className="mcp-step-two-hint">
                {manualInteraction || configuringInactiveMode || snapshot.state.codexCatalogVerified
                  ? copy.mcpStepTwoHint
                  : copy.mcpCatalogRequired}
              </p>
            ) : null}
            {step === 2 ? (
              <div className="connector-actions">
                <details className="connector-upgrade-help"><summary>{copy.connectorUpgradeHelp}</summary><NoticeRow icon="alert" tone="warning">
                  {manualInteraction
                    ? copy.manualConnectorNotice
                    : devProfile ? copy.devConnectorIsolationNotice : copy.connectorMigrationNotice}
                </NoticeRow></details>
                <div className="connector-name">
                  <span>{copy.connectorName}</span>
                  <code>{snapshot.connectorNames[interactionMode]}</code>
                </div>
                <div className="inline-actions">
                  {snapshot.urls.developerMode ? <SecondaryButton icon="external"
                    onClick={() => void openExternal(snapshot.urls.developerMode!)}>{copy.openDeveloperMode}</SecondaryButton> : null}
                  <SecondaryButton
                    icon="external"
                    onClick={() => void (async () => {
                      setError(null);
                      try {
                        await api!.openExternal(snapshot.urls.connectors);
                      } catch (cause) {
                        setError(messageOf(cause));
                      }
                    })()}
                  >
                    {copy.openConnectors}
                  </SecondaryButton>
                </div>
                {doctor ? <DoctorSummary copy={copy} language={language} report={doctor} /> : null}
              </div>
            ) : null}
          </section>
      </div>

      <div className="wizard-footer">
        <button className="text-button" disabled={step === 0 || busy} onClick={() => void safeMove(step - 1)} type="button">
          {copy.previous}
        </button>
        {step === 0 ? <PrimaryButton disabled={busy} onClick={() => void safeMove(1)}>{copy.next}</PrimaryButton> : null}
        {step === 1 ? (
          <PrimaryButton
            disabled={
              busy
              || (!manualInteraction && !configuringInactiveMode && !snapshot.state.codexCatalogVerified)
              || ((!credentialsConfigured || replacingCredentials) && (!tunnelId || !runtimeKey))
            }
            onClick={() => void install()}
          >
            {busy ? copy.running : credentialsConfigured && !replacingCredentials ? copy.reconnect : copy.connect}
          </PrimaryButton>
        ) : null}
        {step === 2 ? (
          <>
            {verified ? (
              <SecondaryButton disabled={busy} onClick={() => void verify()}>
                {copy.verifyRuntime}
              </SecondaryButton>
            ) : null}
            <PrimaryButton
              disabled={busy}
              onClick={() => void (verified ? onDone() : verify())}
            >
              {busy
                ? operation?.name === "mcp-verification" && operation.status === "running"
                  ? localizeRuntimeMessage(copy, operation.message, undefined, language)
                  : copy.running
                : verified ? copy.done : copy.verifyRuntime}
            </PrimaryButton>
          </>
        ) : null}
      </div>
    </ContentSurface>
  );
}

function ActivitySurface({
  copy,
  language,
  logs,
  setError,
}: {
  copy: Copy;
  language: Language;
  logs: LogRecord[];
  setError: (error: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("all");
  const visibleLogs = logs.filter(record => (level === "all" || record.level === level)
    && `${humanEvent(record.event)} ${logDetail(record.detail)}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return (
    <ContentSurface subtitle={copy.activitySubtitle} title={copy.activityTitle}>
      <div className="section-heading activity-heading">
        <span>{copy.recentActivity}</span>
        <SecondaryButton
          icon="external"
          onClick={() => void api!.exportLogs().catch((cause) => setError(messageOf(cause)))}
        >
          {copy.exportSafeLog}
        </SecondaryButton>
      </div>
      <div className="activity-filters">
        <input type="search" aria-label={copy.searchActivity} placeholder={copy.searchActivity} value={query} onChange={event => setQuery(event.target.value)} />
        <select className="settings-select" aria-label={copy.eventLevel} value={level} onChange={event => setLevel(event.target.value)}>
          <option value="all">{copy.allEvents}</option><option value="error">{copy.errorEvents}</option><option value="warning">{copy.warningEvents}</option><option value="info">{copy.infoEvents}</option><option value="debug">{copy.debugEvents}</option>
        </select>
      </div>
      <div className="activity-table">
        {visibleLogs.length === 0 ? (
          <div className="surface-empty">
            <Icon name="logs" />
            <span>{logs.length ? copy.noMatchingEvents : copy.noLogs}</span>
          </div>
        ) : null}
        {[...visibleLogs].reverse().map((record, index) => (
          <div className="activity-row" key={`${record.at}-${record.event}-${index}`}>
            <StateDot state={record.level === "error" ? "error" : record.level === "warning" ? "busy" : "ready"} />
            <div>
              <strong>{humanEvent(record.event)}</strong>
              <span>{logDetail(record.detail)}</span>
            </div>
            <time>{formatTime(record.at, language)}</time>
          </div>
        ))}
      </div>
    </ContentSurface>
  );
}

function SettingsSurface({
  browser,
  configureInteractionMode,
  copy,
  devProfile,
  language,
  operation,
  setError,
  snapshot,
  updateBrowserCapacity,
  updateProModelVersion,
  showBiggerContextInfo,
  updateState,
}: {
  browser: BrowserState | null;
  configureInteractionMode: (mode: BrowserInteractionMode) => void;
  copy: Copy;
  devProfile: boolean;
  language: Language;
  operation: OperationState | null;
  setError: (error: string | null) => void;
  snapshot: LauncherSnapshot;
  updateBrowserCapacity: (value: BrowserCapacitySettings) => void;
  updateProModelVersion: (value: ProModelVersion | null) => void;
  showBiggerContextInfo: () => void;
  updateState: (state: LauncherState) => void;
}) {
  const [capacity, setCapacity] = useState(snapshot.browserCapacity);
  const [capacityInput, setCapacityInput] = useState(String(snapshot.browserCapacity.configured));
  const capacityValue = Number(capacityInput);
  const capacityValid = capacityInput.trim() !== "" && Number.isSafeInteger(capacityValue)
    && capacityValue >= 1 && capacityValue <= capacity.maximum;
  const saveCapacity = async () => {
    if (busy || !capacityValid || capacityValue === capacity.configured) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await api!.setBrowserCapacity(capacityValue);
      setCapacity(saved);
      updateBrowserCapacity(saved);
      setCapacityInput(String(saved.configured));
    } catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };
  const [doctor, setDoctor] = useState<DoctorReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [turnsCancelled, setTurnsCancelled] = useState(false);
  const [integrationRemoved, setIntegrationRemoved] = useState(false);
  const proModelBusy = busy
    || operation?.status === "running"
    || browser?.tabs.some((tab) => tab.status === "running") === true;

  const savePreference = async (action: () => Promise<LauncherState>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { updateState(await action()); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };
  const updateLanguage = async (next: Language) => {
    if (busy) return;
    setBusy(true);
    try {
      updateState(await api!.setLanguage(next));
    } catch (cause) {
      setError(messageOf(cause));
    } finally { setBusy(false); }
  };
  const runDoctor = async () => {
    setBusy(true);
    try {
      setDoctor(await api!.doctor());
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };
  const cancelTurns = async () => {
    setBusy(true);
    setError(null);
    try {
      await api!.cancelTurns();
      setTurnsCancelled(true);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };
  const setBiggerContext = async (enabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      updateState(await api!.setBiggerContext(enabled));
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };
  const setInteractionMode = async (mode: BrowserInteractionMode) => {
    setBusy(true);
    setError(null);
    try {
      const result = await api!.setBrowserInteractionMode(mode);
      updateState(result.state);
      if (result.credentialsRequired) configureInteractionMode(result.targetMode);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };
  const setProModelVersion = async (value: ProModelVersion | null) => {
    setBusy(true);
    setError(null);
    try {
      const result = await api!.setProModelVersion(value);
      updateProModelVersion(result.proModelVersion);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };
  const uninstallIntegration = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api!.uninstallIntegration();
      if (!result.cancelled) {
        updateState(result.state);
        setIntegrationRemoved(true);
      }
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ContentSurface narrow title={devProfile ? copy.devSettingsTitle : copy.settingsTitle} subtitle={copy.settingsSubtitle}>
      <SectionHeading label={copy.agentSettings} />
      <div className="settings-list">
        {!devProfile ? <SettingRow body={copy.launchAtLoginBody} flushAfter label={copy.launchAtLogin}>
          <Switch
            label={copy.launchAtLogin}
            checked={snapshot.state.autoStart}
            disabled={busy}
            onChange={(checked) => void savePreference(async () => (await api!.setAutostart(checked)).state)}
          />
        </SettingRow> : null}
        <InteractionModePicker
          copy={copy}
          disabled={busy}
          mode={snapshot.state.browserInteractionMode}
          onChange={(mode) => void setInteractionMode(mode)}
        />
        <SettingRow body={copy.browserCapacityBody} label={copy.browserCapacity}>
          <div className="capacity-setting">
            <form className="capacity-controls" noValidate onSubmit={event => { event.preventDefault(); void saveCapacity(); }}>
              <input aria-label={copy.browserCapacity} type="number" min={1} max={capacity.maximum} step={1}
                aria-invalid={!capacityValid} aria-describedby="capacity-feedback"
                value={capacityInput} disabled={busy} onChange={event => setCapacityInput(event.target.value)} />
              <button className="button-secondary" type="submit" disabled={busy || !capacityValid || capacityValue === capacity.configured}>{busy ? copy.loading : copy.browserCapacitySave}</button>
            </form>
            <p id="capacity-feedback" className={!capacityValid ? "field-error" : "field-hint"} role="status">{!capacityValid ? copy.capacityInvalid.replace("{max}", String(capacity.maximum)) : capacityValue !== capacity.configured ? copy.unsavedChanges : copy.capacitySaved}</p>
            <p role="status">{copy.browserCapacityStatus.replace("{active}", String(capacity.active)).replace("{saved}", String(capacity.configured))}</p>
            {capacity.restartRequired ? <p role="status">{copy.browserCapacityRestart}</p> : null}
          </div>
        </SettingRow>
        <SettingRow body={copy.proModelVersionBody} label={copy.proModelVersion}>
          <ProModelVersionMenu
            copy={copy}
            disabled={proModelBusy || snapshot.state.coreSetupComplete !== true}
            onChange={(value) => void setProModelVersion(value)}
            value={snapshot.proModelVersion}
          />
        </SettingRow>
        <SectionHeading label={copy.appearanceLabel} spaced />
        <SettingRow body={devProfile ? copy.devKeepRunningBody : copy.keepRunningOnCloseBody} label={copy.keepRunningOnClose}>
          <Switch
            label={copy.keepRunningOnClose}
            checked={snapshot.state.keepRunningOnClose}
            disabled={busy}
            onChange={(checked) => void savePreference(() => api!.setPreference("keepRunningOnClose", checked))}
          />
        </SettingRow>
        <SettingRow body={copy.showDuringTurnsBody} label={copy.showDuringTurns}>
          <Switch
            label={copy.showDuringTurns}
            checked={snapshot.state.showBrowserDuringTurns}
            disabled={busy || snapshot.state.browserInteractionMode === "manual"}
            onChange={(checked) => void savePreference(() => api!.setPreference("showBrowserDuringTurns", checked))}
          />
        </SettingRow>
        <details className="advanced-settings" open={typeof snapshot.state.pendingBiggerContext === "boolean" ? true : undefined}>
        <summary>{copy.advancedContext}<Icon name="chevron" /></summary>
        <SettingRow
          body={snapshot.state.browserInteractionMode === "manual"
            ? copy.manualBiggerContextUnavailable
            : copy.biggerContextBody}
          label={copy.biggerContext}
        >
          <button className="text-button" type="button" onClick={showBiggerContextInfo} disabled={busy || snapshot.state.browserInteractionMode === "manual"}>
            {copy.setupDetails}
          </button>
          <Switch
            label={copy.biggerContext}
            checked={snapshot.state.pendingBiggerContext ?? snapshot.state.experimentalBiggerContext}
            disabled={busy
              || snapshot.state.browserInteractionMode === "manual"
              || snapshot.state.coreSetupComplete !== true}
            onChange={(checked) => void setBiggerContext(checked)}
          />
        </SettingRow>
        <p role="status">{snapshot.state.experimentalBiggerContext ? copy.contextActiveBigger : copy.contextActiveStandard}</p>
        <ContextBudgetTable snapshot={snapshot} copy={copy} />
        {typeof snapshot.state.pendingBiggerContext === "boolean" ? <div role="status">
          <p>{snapshot.state.contextChangeApplying ? copy.contextApplying : snapshot.state.contextChangeError ? copy.contextFailed : copy.contextWaiting}</p>
          {snapshot.state.contextChangeError ? <p>{snapshot.state.contextChangeError}</p> : null}
          <button className="secondary-button" type="button" disabled={busy || snapshot.state.contextChangeApplying}
            onClick={() => void api!.cancelContextChange().then(updateState).catch(cause => setError(messageOf(cause)))}>{copy.cancelContextChange}</button>
          {snapshot.state.contextChangeError ? <button className="secondary-button" type="button" disabled={busy}
            onClick={() => void setBiggerContext(snapshot.state.pendingBiggerContext!)}>{copy.retryContextChange}</button> : null}
        </div> : null}
        </details>
        <SettingRow body={copy.chooseLanguageHint} label={copy.language}>
          <LanguageMenu copy={copy} language={language} onChange={(next) => void updateLanguage(next)} />
        </SettingRow>
      </div>

      {!devProfile && snapshot.state.codexRestartRequired ? (
        <NoticeRow icon="alert" tone="warning">
          {copy.restartCodex}
        </NoticeRow>
      ) : null}

      <SectionHeading label={copy.diagnostics} spaced />
      {!devProfile ? <RouteDiagnostics
        disabled={busy || operation?.status === "running" || browser?.navigationLocked === true}
        language={language}
        readReport={() => api!.routeDiagnostics()}
      /> : null}
      <button className="diagnostic-row" disabled={busy} onClick={() => void runDoctor()} type="button">
        <Icon name="activity" />
        <span>
          <strong>{copy.runDoctor}</strong>
          <small>{doctor ? (doctor.ok && doctor.checks.every(check => check.status === "ok") ? copy.healthy : copy.needsAttention) : copy.status}</small>
        </span>
        <Icon name="chevron" />
      </button>
      {!devProfile ? <button className="diagnostic-row" disabled={busy} onClick={() => void cancelTurns()} type="button">
        <Icon name="close" />
        <span>
          <strong>{copy.cancelTurns}</strong>
          <small>{turnsCancelled ? copy.turnsCancelled : copy.cancelTurnsBody}</small>
        </span>
        <Icon name="chevron" />
      </button> : null}
      {!devProfile ? <button className="diagnostic-row" disabled={busy} onClick={() => void uninstallIntegration()} type="button">
        <Icon name="close" />
        <span>
          <strong>{copy.uninstallIntegration}</strong>
          <small>{integrationRemoved ? copy.integrationRemoved : copy.uninstallIntegrationBody}</small>
        </span>
        <Icon name="chevron" />
      </button> : null}
      {doctor ? <DoctorSummary copy={copy} language={language} report={doctor} /> : null}

      <div className="about-row">
        <BrandMark small />
        <span>
          <strong>{copy.product}</strong>
          <small>
            {devProfile ? `${copy.devBadge} · ${snapshot.profilePaths.coreHome} · ` : ""}
            FroRaut · {platformLabel(snapshot.platform)} · v{snapshot.version}
          </small>
        </span>
      </div>
    </ContentSurface>
  );
}

function ContentSurface({
  children,
  eyebrow,
  fit = false,
  narrow = false,
  subtitle,
  title,
}: {
  children: ReactNode;
  eyebrow?: string;
  fit?: boolean;
  narrow?: boolean;
  subtitle?: string;
  title: string;
}) {
  return (
    <section className={`content-surface${fit ? " is-fit-surface" : " is-page-scroll"}`}>
      <div className={`content-scroll${narrow ? " is-narrow" : ""}${fit ? " is-fit" : ""}`}>
        <header className="surface-header">
          {eyebrow ? <span>{eyebrow}</span> : null}
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </header>
        {children}
      </div>
    </section>
  );
}

function SetupRow({
  action,
  complete,
  description,
  disabled,
  index,
  onAction,
  onSecondaryAction,
  repeatable = false,
  secondaryAction,
  secondaryDisabled = false,
  title,
  titleAction,
}: {
  action: string;
  complete: boolean;
  description: string;
  disabled: boolean;
  index: number;
  onAction: () => void;
  onSecondaryAction?: () => void;
  repeatable?: boolean;
  secondaryAction?: string;
  secondaryDisabled?: boolean;
  title: string;
  titleAction?: ReactNode;
}) {
  return (
    <div className={`setup-row${complete ? " is-complete" : ""}`}>
      <span className="setup-index">{complete ? <Icon name="check" /> : index}</span>
      <div className="setup-row-copy">
        <div className="setup-row-heading">
          <strong>{title}</strong>
          {titleAction}
        </div>
        <p>{description}</p>
      </div>
      <div className="setup-actions">
        {secondaryAction && onSecondaryAction ? (
          <SecondaryButton disabled={secondaryDisabled || complete} onClick={onSecondaryAction}>
            {secondaryAction}
          </SecondaryButton>
        ) : null}
        <SecondaryButton disabled={disabled || (complete && !repeatable)} onClick={onAction}>
          {action}
        </SecondaryButton>
      </div>
    </div>
  );
}

function ZeroRiskModelMenu({
  busy,
  copy,
  onChange,
  proEnabled,
}: {
  busy: boolean;
  copy: Copy;
  onChange: (enabled: boolean) => void;
  proEnabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const choose = (enabled: boolean) => {
    setOpen(false);
    if (enabled !== proEnabled) onChange(enabled);
  };

  return (
    <div
      className={`zero-risk-model-menu${open ? " is-open" : ""}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={copy.zeroRiskModelSettings}
        className="zero-risk-model-trigger"
        disabled={busy}
        onClick={() => setOpen((current) => !current)}
        title={copy.zeroRiskModelSettings}
        type="button"
      >
        <Icon name="settings" />
      </button>
      {open ? (
        <>
          <button
            aria-label={`${copy.close}: ${copy.zeroRiskModelSettings}`}
            className="zero-risk-model-scrim"
            onClick={() => setOpen(false)}
            type="button"
          />
          <div
            aria-label={copy.zeroRiskModelSettings}
            className="zero-risk-model-panel"
            role="radiogroup"
          >
            <p>{copy.zeroRiskModelSettingsBody}</p>
            <div className="zero-risk-model-option-row">
              <button
                aria-checked={!proEnabled}
                className={!proEnabled ? "is-selected" : ""}
                onClick={() => choose(false)}
                role="radio"
                type="button"
              >
                {!proEnabled ? <span className="zero-risk-model-radio"><Icon name="check" /></span> : null}
                <span>
                  <strong>{copy.zeroRiskDefaultProfile}</strong>
                  <small>{copy.zeroRiskDefaultProfileBody}</small>
                </span>
              </button>
            </div>
            <div className="zero-risk-model-option-row has-info">
              <button
                aria-checked={proEnabled}
                className={proEnabled ? "is-selected" : ""}
                onClick={() => choose(true)}
                role="radio"
                type="button"
              >
                {proEnabled ? <span className="zero-risk-model-radio"><Icon name="check" /></span> : null}
                <span>
                  <strong>{copy.zeroRiskProProfile}</strong>
                  <small>{copy.zeroRiskProProfileBody}</small>
                </span>
              </button>
              <span
                aria-label={copy.zeroRiskProProfileInfo}
                className="zero-risk-model-info"
                role="img"
                tabIndex={0}
              >
                <Icon name="info" />
                <span className="zero-risk-model-tooltip" role="tooltip">
                  {copy.zeroRiskProProfileInfo}
                </span>
              </span>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function TutorialVideo({ copy, label, src }: { copy: Copy; label: string; src: string }) {
  const [expanded, setExpanded] = useState(false);
  const inlineVideo = useRef<HTMLVideoElement>(null);
  const expandedVideo = useRef<HTMLVideoElement>(null);
  const expandedAt = useRef(0);

  const closeExpanded = () => {
    const currentTime = expandedVideo.current?.currentTime;
    if (inlineVideo.current && Number.isFinite(currentTime)) {
      inlineVideo.current.currentTime = currentTime ?? 0;
    }
    setExpanded(false);
  };

  useEffect(() => {
    if (!expanded) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeExpanded();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [expanded]);

  return (
    <>
      <div className="guide-media">
        <video aria-label={label} controls preload="metadata" muted playsInline ref={inlineVideo} src={src} />
        <button
          aria-label={copy.expandGuideVideo}
          className="guide-media-expand"
          onClick={() => {
            expandedAt.current = inlineVideo.current?.currentTime ?? 0;
            inlineVideo.current?.pause();
            setExpanded(true);
          }}
          type="button"
        >
          <Icon name="expand" />
        </button>
      </div>
      {expanded ? createPortal(
        <div
          aria-label={label}
          aria-modal="true"
          className="guide-media is-expanded"
          role="dialog"
        >
          <video
            aria-label={label}
            controls
            preload="metadata"
            muted
            onLoadedMetadata={(event) => {
              event.currentTarget.currentTime = expandedAt.current;
            }}
            playsInline
            ref={expandedVideo}
            src={src}
          />
          <button
            aria-label={copy.closeGuideVideo}
            autoFocus
            className="guide-media-close"
            onClick={closeExpanded}
            type="button"
          >
            <Icon name="close" />
          </button>
        </div>,
        document.body,
      ) : null}
    </>
  );
}

function SectionHeading({ label, meta, spaced = false }: { label: string; meta?: string; spaced?: boolean }) {
  return (
    <div className={`section-heading${spaced ? " is-spaced" : ""}`}>
      <span>{label}</span>
      {meta ? <small>{meta}</small> : null}
    </div>
  );
}

function NoticeRow({
  children,
  icon,
  tone,
}: {
  children: ReactNode;
  icon: IconName;
  tone: "warning" | "success";
}) {
  return (
    <div className={`notice-row tone-${tone}`}>
      <Icon name={icon} />
      <span>{children}</span>
    </div>
  );
}

function InteractionModePicker({
  className,
  copy,
  disabled,
  mode,
  onChange,
}: {
  className?: string;
  copy: Copy;
  disabled: boolean;
  mode: BrowserInteractionMode;
  onChange: (mode: BrowserInteractionMode) => void;
}) {
  return (
    <div
      aria-label={copy.interactionMode}
      className={`interaction-mode-picker${className ? ` ${className}` : ""}`}
      role="radiogroup"
    >
      <button
        aria-checked={mode === "automatic"}
        className={mode === "automatic" ? "is-selected" : ""}
        disabled={disabled}
        onClick={() => onChange("automatic")}
        role="radio"
        type="button"
      >
        {mode === "automatic" ? (
          <span className="interaction-mode-check"><Icon name="check" /></span>
        ) : null}
        <span>
          <strong>{copy.automaticInteraction}</strong>
          <small>{copy.automaticInteractionBody}</small>
        </span>
      </button>
      <button
        aria-checked={mode === "manual"}
        className={mode === "manual" ? "is-selected" : ""}
        disabled={disabled}
        onClick={() => onChange("manual")}
        role="radio"
        type="button"
      >
        {mode === "manual" ? (
          <span className="interaction-mode-check"><Icon name="check" /></span>
        ) : null}
        <span>
          <strong>{copy.manualInteraction}</strong>
          <small>{copy.manualInteractionBody}</small>
        </span>
      </button>
    </div>
  );
}

function ContextBudgetTable({ snapshot, copy }: { snapshot: LauncherSnapshot; copy: Copy }) {
  if (!snapshot.state.coreSetupComplete || !snapshot.contextCapabilities) return null;
  const capabilities = { ...snapshot.contextCapabilities, browserInteractionMode: snapshot.state.browserInteractionMode,
    experimentalBiggerContext: snapshot.state.experimentalBiggerContext, zeroRiskProEnabled: snapshot.state.zeroRiskProEnabled };
  const routes = availableChatGptWebModelRoutes(capabilities);
  return <div className="context-budget-table">
    <table>
      <caption>{copy.contextBudgetCaption}</caption>
      <thead><tr><th scope="col">{copy.contextBudgetModel}</th><th scope="col">{copy.contextBudgetHistory}</th><th scope="col">{copy.contextBudgetMessage}</th></tr></thead>
      <tbody>{routes.map(route => {
        const effort = route.interactionMode === "manual" ? "low" : route.adapterEffort;
        const limits = resolveChatGptWebContextLimits(route.backendModel, effort, capabilities);
        const transport = resolveChatGptWebTransportLimits(route.backendModel, effort, capabilities);
        const number = (value: number) => value.toLocaleString(snapshot.state.language || "en");
        const oneMessage = transport.browserMessageTokenLimit !== undefined
          ? `${number(transport.browserMessageTokenLimit)} ${copy.contextTokenUnit}`
          : transport.browserComposerCharLimit !== undefined ? `${number(transport.browserComposerCharLimit)} ${copy.contextCharUnit}` : "—";
        return <tr key={route.slug}><th scope="row">{route.displayName}</th><td>{number(limits.autoCompactTokenLimit)} {copy.contextTokenUnit}</td><td>{oneMessage}</td></tr>;
      })}</tbody>
    </table>
    <p>{copy.contextBudgetEvidence}</p>
  </div>;
}

function SettingRow({
  body,
  children,
  flushAfter = false,
  label,
}: {
  body: string;
  children: ReactNode;
  flushAfter?: boolean;
  label: string;
}) {
  return (
    <div className={`setting-row${flushAfter ? " is-flush-after" : ""}`}>
      <div>
        <strong>{label}</strong>
        <p>{body}</p>
      </div>
      {children}
    </div>
  );
}

function FieldRow({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="field-row">
      <span>{label}</span>
      {children}
    </label>
  );
}

function DoctorSummary({ copy, language, report }: { copy: Copy; language: Language; report: DoctorReport }) {
  const healthy = report.ok && report.checks.every(check => check.status === "ok");
  const visibleChecks = healthy
    ? report.checks.slice(-6)
    : report.checks.filter((check) => check.status !== "ok");
  return (
    <div className={`doctor-summary${healthy ? " is-healthy" : ""}`}>
      <header>
        <Icon name={healthy ? "check" : "activity"} />
        <strong>{healthy ? copy.healthy : copy.needsAttention}</strong>
      </header>
      <div>
        {visibleChecks.map((check) => (
          <p key={check.id}>
            <StateDot state={check.status === "ok" ? "ready" : check.status === "warning" ? "busy" : "error"} />
            <span>{check.status === "ok"
              ? localizeRuntimeMessage(copy, check.message, check.id, language)
              : check.message}</span>
          </p>
        ))}
      </div>
    </div>
  );
}

function WelcomeOption({
  active,
  detail,
  label,
  marker,
  onClick,
}: {
  active: boolean;
  detail: string;
  label: string;
  marker: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-checked={active}
      className={`welcome-option${active ? " is-active" : ""}`}
      onClick={onClick}
      role="radio"
      type="button"
    >
      <span>{marker}</span>
      <strong>{label}</strong>
      <small>{detail}</small>
      {active ? <Icon name="check" /> : null}
    </button>
  );
}


function PrimaryButton({
  children,
  disabled = false,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button className="button-primary" disabled={disabled} onClick={onClick} type="button">
      {children}
    </button>
  );
}

function SecondaryButton({
  children,
  disabled = false,
  icon,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  icon?: IconName;
  onClick: () => void;
}) {
  return (
    <button className="button-secondary" disabled={disabled} onClick={onClick} type="button">
      {icon ? <Icon name={icon} /> : null}
      <span>{children}</span>
    </button>
  );
}

function IconButton({
  disabled = false,
  icon,
  label,
  onClick,
}: {
  disabled?: boolean;
  icon: IconName;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className="icon-button"
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      <Icon name={icon} />
    </button>
  );
}

function Switch({
  label,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      aria-label={label}
      aria-checked={checked}
      className={`switch${checked ? " is-on" : ""}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span />
    </button>
  );
}

function LanguageMenu({ copy, language, onChange }: { copy: Copy; language: Language; onChange: (language: Language) => void }) {
  const [open, setOpen] = useState(false);
  const options: Array<{ label: string; value: Language }> = [
    { label: copy.english, value: "en" },
    { label: copy.chinese, value: "zh-CN" },
    { label: copy.japanese, value: "ja" },
  ];
  const selected = options.find((option) => option.value === language) ?? options[0];

  return (
    <div
      className={`language-menu${open ? " is-open" : ""}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        className="language-menu-trigger"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span>{selected.label}</span>
        <Icon name="chevron" />
      </button>
      {open ? (
        <>
          <button
            aria-label={`${copy.close}: ${copy.language}`}
            className="language-menu-scrim"
            onClick={() => setOpen(false)}
            type="button"
          />
          <div aria-label={copy.language} className="language-menu-panel" role="listbox">
            {options.map((option) => (
              <button
                aria-selected={option.value === language}
                className={option.value === language ? "is-selected" : ""}
                key={option.value}
                onClick={() => {
                  setOpen(false);
                  if (option.value !== language) onChange(option.value);
                }}
                role="option"
                type="button"
              >
                <span>{option.label}</span>
                {option.value === language ? <Icon name="check" /> : null}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function ProModelVersionMenu({
  copy,
  disabled,
  onChange,
  value,
}: {
  copy: Copy;
  disabled: boolean;
  onChange: (value: ProModelVersion | null) => void;
  value: ProModelVersion | null;
}) {
  return (
    <select
      aria-label={copy.proModelVersion}
      className="settings-select"
      disabled={disabled}
      onChange={(event) => onChange(event.target.value === ""
        ? null
        : event.target.value as ProModelVersion)}
      value={value ?? ""}
    >
      <option value="">{copy.proModelFollow}</option>
      <option value="5.6">{copy.proModel56}</option>
      <option value="5.5">{copy.proModel55}</option>
      <option value="6">{copy.proModel6}</option>
    </select>
  );
}

function StateDot({ state }: { state: "idle" | "ready" | "busy" | "error" }) {
  return <i aria-hidden="true" className={`state-dot is-${state}`} />;
}

function ActionDot({ pulse = false, tone }: { pulse?: boolean; tone: "required" | "optional" | "success" | "error" }) {
  return <i aria-hidden="true" className={`action-dot is-${tone}${pulse ? " is-pulse" : ""}`} />;
}

function ErrorToast({ copy, message, onDismiss }: { copy: Copy; message: string; onDismiss: () => void }) {
  return (
    <div
      className="error-toast"
      role="alert"
    >
      <StateDot state="error" />
      <span>
        <strong>{copy.error}</strong>
        <p>{message}</p>
      </span>
      <button onClick={onDismiss} type="button">{copy.dismiss}</button>
    </div>
  );
}

function SessionRefreshReminder({
  busy,
  copy,
  onDismiss,
  onLogout,
}: {
  busy: boolean;
  copy: Copy;
  onDismiss: () => void;
  onLogout: () => void;
}) {
  return (
    <aside
      aria-live="polite"
      className="session-refresh-reminder"
    >
      <span className="session-refresh-reminder-icon"><Icon name="alert" /></span>
      <div className="session-refresh-reminder-copy">
        <strong>{copy.sessionReminderTitle}</strong>
        <p>{copy.sessionReminderBody}</p>
      </div>
      <div className="session-refresh-reminder-actions">
        <button className="text-button" disabled={busy} onClick={onDismiss} type="button">
          {copy.dismiss}
        </button>
        <button className="button-primary" disabled={busy} onClick={onLogout} type="button">
          {copy.logOut}
        </button>
      </div>
    </aside>
  );
}

function BiggerContextRecommendation({
  busy,
  checked,
  copy,
  onChange,
  onClose,
}: {
  busy: boolean;
  checked: boolean;
  copy: Copy;
  onChange: (checked: boolean) => void;
  onClose: () => void;
}) {
  return (
    <div
      aria-describedby="bigger-context-recommendation-body"
      aria-labelledby="bigger-context-recommendation-title"
      aria-modal="true"
      className="bigger-context-recommendation-backdrop"
      role="dialog"
    >
      <section
        className="bigger-context-recommendation"
      >
        <header className="bigger-context-recommendation-header">
          <small>{copy.biggerContext}</small>
          <h2 id="bigger-context-recommendation-title">{copy.biggerContextRecommendationTitle}</h2>
        </header>
        <p className="bigger-context-recommendation-body" id="bigger-context-recommendation-body">{copy.biggerContextRecommendationBody}</p>
        <div className="bigger-context-recommendation-toggle">
          <div>
            <strong>{copy.biggerContext}</strong>
            <p>{copy.biggerContextRecommendationToggleBody}</p>
          </div>
          <Switch label={copy.biggerContext} checked={checked} disabled={busy} onChange={onChange} />
        </div>
        {checked ? <p className="bigger-context-recommendation-restart">{copy.restartCodex}</p> : null}
        <footer>
          <SecondaryButton disabled={busy} onClick={onClose}>{copy.close}</SecondaryButton>
        </footer>
      </section>
    </div>
  );
}

function McpMark() {
  return <i aria-hidden="true" className="mcp-mark" />;
}

function LaunchLoading() {
  return (
    <main className="launch-loading">
      <BrandMark />
      <span />
    </main>
  );
}

function FatalMessage({ message, onRetry, retryLabel }: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <main className="fatal-message">
      <BrandMark />
      <h1>NEKODEX</h1>
      <p role="alert">{message}</p>
      {onRetry ? <PrimaryButton onClick={onRetry}>{retryLabel}</PrimaryButton> : null}
    </main>
  );
}

function browserTabTitleFromTitle(value: string | undefined, copy: Copy): string {
  const title = value?.trim();
  if (!title || title === "about:blank" || title.includes("codex-web-gpt-browser-host")) return copy.temporaryChat;
  return title.replace(/\s*[|–-]\s*ChatGPT\s*$/i, "") || copy.temporaryChat;
}

function browserTabTone(status: BrowserState["tabs"][number]["status"]): "idle" | "ready" | "busy" | "error" {
  if (status === "error" || status === "aborted") return "error";
  if (status === "loading" || status === "running" || status === "testing") return "busy";
  if (status === "ready") return "ready";
  return "idle";
}

function formatBrowserAddress(url: string | undefined, copy: Copy): string {
  if (!url || url.startsWith("about:blank")) return copy.browserAddress;
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return copy.browserAddress;
    if (parsed.hostname === "chatgpt.com" && parsed.searchParams.get("temporary-chat") === "true") {
      return `chatgpt.com  /  ${copy.temporaryChat}`;
    }
    return `${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return copy.browserAddress;
  }
}

function messageOf(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function platformLabel(value: string): string {
  return value === "darwin" ? "macOS" : value === "win32" ? "Windows" : value === "linux" ? "Linux" : value;
}

function humanEvent(value: string): string {
  return value.split(".").map((part) => part.replaceAll("_", " ")).join(" · ");
}

function logDetail(detail: Record<string, unknown>): string {
  const entries = Object.entries(detail).filter(([, value]) => value !== undefined && value !== null);
  if (entries.length === 0) return "";
  return entries
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join(" · ");
}

function formatTime(value: string, language: Language): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString(language === "ja" ? "ja-JP" : language === "zh-CN" ? "zh-CN" : "en", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
}
