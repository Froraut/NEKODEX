import { useLocaleCopy } from './useLocaleCopy';
import { LocaleNotice } from './LocaleNotice';
import { newerBrowserState } from './snapshot-observation';
import { createLauncherLogStore, type LauncherLogStore } from './launcher-log-store';
import { deferredSurface } from './deferred-surface';
import { Onboarding } from "./Onboarding";
import { BrowserSurface } from "./BrowserSurface";
import { SetupSurface } from './SetupSurface';
import { McpSurface } from './McpSurface';
import { IconButton, ContentSurface, messageOf } from './launcher-ui';
import { currentToolProof } from './launcher-readiness';

import { taskCenterSubtitle, taskCenterTitle } from './task-center-copy';
import { QueueControls } from './QueueControls';
import type { CompactionModel } from "./types";
import { modelConnectionReadiness } from "./setup-progress";
import { Button, Mark, Notice, StateDot } from "./design";
import { Overview } from "./Overview";
import { AccountToolsHandoff } from "./AccountToolsOnboarding";

import { updateCopyFor } from "./update-copy";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { copyFor, localizeLauncherError, type Copy } from "./i18n";

import { deriveWorkspaceReadiness, workspaceReadinessInput } from "./workspace-readiness";
import { connectionStatusWord } from "./connections-copy";
import { workflowCopy } from "./workflow-copy";
import { useNetworkIssueDismissalReset } from "./NetworkIssueNotice";
import { ActionDot, BiggerContextRecommendation, COMPACT_SIDEBAR_QUERY, ErrorToast, FatalMessage, LaunchLoading, SidebarGroup, SidebarItem, TitleBar, useCompactSidebarDrawer } from "./AppShell";
import { useUpdateControls } from "./useUpdateControls";
import { useAppliedAppearance } from "./theme";
import { rememberLanguage, shellCopy, startupLanguage } from "./shell-copy";

import type { BrowserCapacitySettings, BrowserInteractionMode, BrowserState, Language, LauncherLifecycle as LifecycleProjection, LauncherSnapshot, LauncherState, LogRecord, OperationState, ProModelVersion, Surface } from "./types";

const ActivitySurface = deferredSurface(async () => ({ default: (await import('./ActivitySurface')).ActivitySurface }));
const AccountSettings = deferredSurface(async () => ({ default: (await import('./AccountSettings')).AccountSettings }));
const SettingsSurface = deferredSurface(async () => ({ default: (await import('./SettingsSurface')).SettingsSurface }));
const TaskCenter = deferredSurface(async () => ({ default: (await import('./TaskCenter')).TaskCenter }));
const Updates = deferredSurface(async () => ({ default: (await import('./Updates')).Updates }));
const api = window.codexWebLauncher;

function smokePassedForState(state: LauncherState, version: string): boolean {
  return state.browserSmokePassed === true && state.browserSmokeVersion === version;
}

function withLauncherState(current: LauncherSnapshot | null, state: LauncherState): LauncherSnapshot | null {
  return current ? { ...current, state, smokePassed: smokePassedForState(state, current.version) } : current;
}

export function App() {
  const [snapshot, setSnapshot] = useState<LauncherSnapshot | null>(null);
  useAppliedAppearance(snapshot?.state.appearance);
  const [browser, setBrowser] = useState<BrowserState | null>(null);
  const [operation, setOperation] = useState<OperationState | null>(null);
  const [logStore] = useState(createLauncherLogStore);
  const [error, setError] = useState<string | null>(null);
  const [catalogFailure, setCatalogFailure] = useState<string | null>(null);
  const catalogAlert = useRef<string | null>(null);
  const acceptedLifecycle = useRef<LifecycleProjection | null>(null);
  const currentInteractionMode = useRef<BrowserInteractionMode>("automatic");
  const [startupError, setStartupError] = useState<string | null>(null);
  const [startupAttempt, setStartupAttempt] = useState(0);
  const stateRevision = useRef(0);
  const snapshotRefresh = useRef(0);
  const refreshOwner = useRef(0);
  const refreshInFlight = useRef<Promise<void> | null>(null);
  const refreshOperationRevision = useRef(0);
  const operationRevision = useRef(0);
  const lastOperationStatus = useRef<OperationState["status"] | null>(null);
  const lastOperationName = useRef<string | null>(null);
  const completionRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestedLanguage = snapshot?.state.language ?? "en";
  const locale = useLocaleCopy(requestedLanguage);
  const documentLanguage = locale.language;
  const hasPresentedLocale = useRef(false);
  // Onboarding hands over to the workspace: its first page takes the focus the Finish button had.
  const sawOnboarding = useRef(false);
  if (snapshot && !snapshot.state.onboardingComplete) sawOnboarding.current = true;
  const currentLanguage = useRef(documentLanguage);
  currentLanguage.current = documentLanguage;
  // Clears only the catalog alert this code raised; a later unrelated error stays visible.
  const releaseCatalogAlert = () => {
    const staleCatalogAlert = catalogAlert.current;
    catalogAlert.current = null;
    setCatalogFailure(null);
    setError(current => current === staleCatalogAlert ? null : current);
  };
  const acceptLifecycle = useCallback((next: LifecycleProjection | null | undefined) => {
    if (!next || (acceptedLifecycle.current?.revision ?? -1) >= next.revision) return false;
    // Advance the receipt synchronously. React may defer setSnapshot, while a
    // competing event or snapshot must already observe this same revision.
    acceptedLifecycle.current = next;
    if (currentInteractionMode.current === "manual" || next.catalog?.status === "ready") {
      releaseCatalogAlert();
    } else if (next.catalog?.status === "failed") {
      setCatalogFailure(copyFor(currentLanguage.current).catalogFailureKeptInstall);
    }
    return true;
  }, []);
  const [updatePanelRequest, setUpdatePanelRequest] = useState(0);
  const seenUpdatePanelRequest = useRef(0);
  useEffect(() => {
    if (!api) return;
    let mounted = true;
    const receive = () => {
      void api.readUpdateRequestRevision?.().then(revision => {
        if (mounted && revision > seenUpdatePanelRequest.current) {
          seenUpdatePanelRequest.current = revision;
          setUpdatePanelRequest(revision);
        }
      }).catch(cause => { if (mounted) setError(messageOf(cause)); });
    };
    const unsubscribe = api.onOpenUpdates?.(receive);
    receive(); // Retain a native menu click made before the renderer finished loading.
    return () => { mounted = false; unsubscribe?.(); };
  }, []);

  const refreshMetadata = useCallback((reuseCompletedOperation: boolean): Promise<void> => {
    // A completion snapshot starts after that operation publishes its state and credentials.
    // A later operation, including a failed verification, needs its own fresh read.
    if (reuseCompletedOperation && refreshInFlight.current
      && lastOperationStatus.current === "completed"
      && lastOperationName.current === "mcp-verification"
      && refreshOperationRevision.current === operationRevision.current) {
      return refreshInFlight.current;
    }
    const request = ++snapshotRefresh.current;
    const owner = refreshOwner.current;
    const operation = operationRevision.current;
    refreshOperationRevision.current = operation;
    const load = async (attempt: number): Promise<void> => {
      const revision = stateRevision.current;
      const fresh = await api!.snapshot() as LauncherSnapshot;
      if (owner !== refreshOwner.current || request !== snapshotRefresh.current
        || operation !== operationRevision.current) return;
      // Never pair identity/capability metadata from an older read with a newer
      // state event. Retry once against the latest state revision instead.
      if (revision !== stateRevision.current) {
        if (attempt === 0) await load(1);
        return;
      }
      currentInteractionMode.current = fresh.state.browserInteractionMode;
      acceptLifecycle(fresh.lifecycle);
      setSnapshot(current => {
        if (!current) return current;
        const keepNewerLifecycle = (current.lifecycle?.revision ?? -1) > (fresh.lifecycle?.revision ?? -1);
        return {
          ...current,
          state: fresh.state,
          smokePassed: smokePassedForState(fresh.state, fresh.version),
          browserCapacity: fresh.browserCapacity,
          proModelVersion: fresh.proModelVersion,
          compactionModel: fresh.compactionModel,
          contextCapabilities: fresh.contextCapabilities,
          connectorName: fresh.connectorName,
          connectorNames: fresh.connectorNames,
          mcpCredentialsConfigured: fresh.mcpCredentialsConfigured,
          runtimeCapabilities: keepNewerLifecycle ? current.runtimeCapabilities : fresh.runtimeCapabilities,
          runtimeStatus: keepNewerLifecycle ? current.runtimeStatus : fresh.runtimeStatus,
          lifecycle: keepNewerLifecycle ? current.lifecycle : fresh.lifecycle,
          recommendedConnectorNames: fresh.recommendedConnectorNames ?? current.recommendedConnectorNames,
        };
      });
    };
    const pending = load(0);
    refreshInFlight.current = pending;
    void pending.finally(() => {
      if (refreshInFlight.current === pending) refreshInFlight.current = null;
    }).catch(() => {});
    return pending;
  }, [acceptLifecycle]);

  useEffect(() => {
    document.documentElement.lang = documentLanguage;
    // The next launch (and its startup-failure screen) opens in the language presented now.
    if (snapshot?.state.language && !locale.pending) rememberLanguage(documentLanguage);
  }, [documentLanguage, snapshot?.state.language, locale.pending]);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    let initialized = false;
    acceptedLifecycle.current = null;
    let pendingState: LauncherState | null = null;
    let pendingBrowser: BrowserState | null = null;
    let pendingOperation: OperationState | null = null;
    let pendingUpdate: LauncherSnapshot["update"] | null = null;
    let pendingLifecycle: LifecycleProjection | null = null;
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
      currentInteractionMode.current = state.browserInteractionMode;
      if (state.browserInteractionMode === "manual"
        || (state.codexCatalogVerified === true && !api.onLifecycle)) {
        releaseCatalogAlert();
      }
      if (!initialized) pendingState = state;
      setSnapshot(current => withLauncherState(current, state));
    });
    const unsubscribeBrowser = api.onBrowserState(next => {
      if (!initialized) pendingBrowser = newerBrowserState(pendingBrowser, next);
      else setBrowser(current => newerBrowserState(current, next));
    });
    const unsubscribeOperation = api.onOperation((next) => {
      const lifecycleRevision = (next as OperationState & { revision?: number }).revision;
      if (next.name === "catalog-verification" && typeof lifecycleRevision === "number"
        && lifecycleRevision < (acceptedLifecycle.current?.revision ?? -1)) return;
      operationRevision.current += 1;
      lastOperationStatus.current = next.status;
      lastOperationName.current = next.name;
      if (!initialized) pendingOperation = next;
      else setOperation(next);
      if (initialized && next.status === "running" && ["runtime-start", "runtime-recovery"].includes(next.name)) {
        setSnapshot(current => {
          if (!current?.runtimeCapabilities) return current;
          const status = next.name === "runtime-recovery" ? "recovering" : "starting";
          return { ...current, runtimeStatus: status,
            runtimeCapabilities: { ...current.runtimeCapabilities, runtimeStatus: status,
              tunnelStatus: status } };
        });
      }
      if (next.name === "catalog-verification") {
        if (next.status === "failed" && currentInteractionMode.current !== "manual") {
          catalogAlert.current = next.message;
          setCatalogFailure(next.message);
          setError(next.message);
        } else if (next.status === "completed") {
          releaseCatalogAlert();
        }
      } else if (next.status === "failed" && next.name !== "mcp-verification"
        // The sign-in guide may recover a protected-file denial in this same
        // operation. It owns terminal import errors and their retry actions.
        && next.name !== "existing-chrome-login") {
        setError(next.message);
      }
      if (next.status === "completed" && initialized) refreshCompletedOperation();
      if (next.status === "failed" && initialized
        && ["runtime-start", "runtime-recovery", "runtime-supervisor"].includes(next.name)) {
        refreshCompletedOperation();
      }
      if (next.status === "failed" && next.name === "mcp-setup" && initialized) {
        // Setup may report an earlier command completion before rollback finishes.
        // Its final failure needs the credentials and capabilities after recovery.
        refreshCompletedOperation();
      }
    });
    const unsubscribeLog = api.onLog((record) => {
      if (!initialized) {
        pendingLogs.push(record);
        if (pendingLogs.length > 300) pendingLogs.shift();
      }
      else logStore.append(record);
    });
    const unsubscribeUpdate = api.onUpdateState((update) => {
      if (!initialized) pendingUpdate = update;
      setSnapshot((current) => current ? { ...current, update } : current);
    });
    const unsubscribeLifecycle = api.onLifecycle?.((next) => {
      if (!initialized) {
        if (!pendingLifecycle || pendingLifecycle.revision < next.revision) pendingLifecycle = next;
      }
      else {
        if (!acceptLifecycle(next)) return;
        setSnapshot(current => {
          if (!current) return current;
          return { ...current, lifecycle: next, runtimeStatus: next.runtimeStatus,
            runtimeCapabilities: next };
        });
      }
    }) ?? (() => {});
    void api.snapshot().then((rawNext) => {
      if (cancelled) return;
      const next = rawNext as LauncherSnapshot;
      const latestState = (pendingState as LauncherState | null) ?? next.state;
      const latestOperation = (pendingOperation as OperationState | null) ?? next.operation;
      const lifecycle = pendingLifecycle && pendingLifecycle.revision > (next.lifecycle?.revision ?? -1)
        ? pendingLifecycle : next.lifecycle;
      currentInteractionMode.current = latestState.browserInteractionMode;
      acceptLifecycle(lifecycle);
      setSnapshot({
        ...next,
        ...(lifecycle ? { lifecycle, runtimeStatus: lifecycle.runtimeStatus,
          runtimeCapabilities: lifecycle } : {}),
        state: latestState,
        update: pendingUpdate ?? next.update,
        smokePassed: smokePassedForState(latestState, next.version),
      });
      setBrowser(newerBrowserState(next.browser, pendingBrowser));
      logStore.seed(next.logs, pendingLogs);
      setOperation(latestOperation);
      if (latestState.browserInteractionMode !== "manual" && latestState.codexCatalogVerified !== true && lifecycle?.catalog?.status === "failed") {
        setCatalogFailure(copyFor(latestState.language ?? "en").catalogFailureKeptInstall);
      }
      const catalogOperationRevision = (latestOperation as (OperationState & { revision?: number }) | null)?.revision;
      if (latestOperation?.status === "failed" && latestOperation.name === "catalog-verification"
        && latestState.browserInteractionMode !== "manual" && latestState.codexCatalogVerified !== true && lifecycle?.catalog?.status !== "ready"
        && (typeof catalogOperationRevision !== "number" || catalogOperationRevision >= (lifecycle?.revision ?? -1))) {
        catalogAlert.current = latestOperation.message;
        setCatalogFailure(latestOperation.message);
        setError(latestOperation.message);
      } else if (latestOperation?.status === "failed"
        && latestOperation.name !== "mcp-verification"
        && latestOperation.name !== "catalog-verification"
        // As in the live listener: the sign-in guide owns terminal import errors and their retry actions.
        && latestOperation.name !== "existing-chrome-login") {
        setError(latestOperation.message);
      }
      initialized = true;
      if ((pendingOperation as OperationState | null)?.status === "completed"
        || ((pendingOperation as OperationState | null)?.status === "failed"
          && (pendingOperation as OperationState | null)?.name === "mcp-setup")) refreshCompletedOperation();
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
      logStore.cancelPendingNotification();
      unsubscribeUpdate();
      unsubscribeLifecycle();
    };
  }, [startupAttempt, refreshMetadata, acceptLifecycle, logStore]);

  const updateState = useCallback((state: LauncherState) => {
    stateRevision.current += 1;
    currentInteractionMode.current = state.browserInteractionMode;
    if (state.codexCatalogVerified === true || state.browserInteractionMode === "manual") {
      releaseCatalogAlert();
    }
    setSnapshot(current => withLauncherState(current, state));
  }, []);

  const updateSnapshot = useCallback(async () => {
    if (completionRefreshTimer.current !== null) {
      clearTimeout(completionRefreshTimer.current);
      completionRefreshTimer.current = null;
    }
    try {
      await refreshMetadata(true);
    } catch {
      // An explicit read can recover when a shared completion snapshot failed.
      await refreshMetadata(false);
    }
  }, [refreshMetadata]);

  const updateBrowserCapacity = useCallback((browserCapacity: BrowserCapacitySettings) => {
    setSnapshot(current => current ? { ...current, browserCapacity } : current);
  }, []);

  const updateProModelVersion = useCallback((proModelVersion: ProModelVersion | null) => {
    setSnapshot((current) => current ? { ...current, proModelVersion } : current);
  }, []);
  const updateCompactionModel = useCallback((compactionModel: CompactionModel | null) => {
    setSnapshot((current) => current ? { ...current, compactionModel } : current);
  }, []);

  // "Try again" gives way to the loading screen, so its focus falls to <body>. A failed retry hands it to the new
  // failure screen's Try again; a successful one to the first page (the shell's focusPageOnMount hand-off) or, when
  // onboarding opens instead, to its step heading. Focus the user placed meanwhile stays.
  const startupRetried = useRef(false);
  const startupRetryFocus = useRef(false);
  const retryButton = useRef<HTMLButtonElement>(null);
  const appRoot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!startupRetryFocus.current) return;
    const retryFailed = !snapshot && startupError !== null;
    if (!retryFailed && !(snapshot && hasPresentedLocale.current)) return;
    startupRetryFocus.current = false;
    if (document.activeElement && document.activeElement !== document.body) return;
    if (retryFailed) {
      retryButton.current?.focus();
      return;
    }
    const heading = appRoot.current?.querySelector<HTMLElement>(".nk-onboarding__scroll h1");
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  });

  const retryStartup = () => {
    startupRetried.current = true;
    startupRetryFocus.current = true;
    setStartupError(null);
    setStartupAttempt((attempt) => attempt + 1);
  };
  if (!api) return <FatalMessage language="en" message="Launcher IPC is unavailable." />;
  if (!snapshot && startupError) return (
    <FatalMessage
      language={startupLanguage()}
      message={localizeLauncherError(copyFor(startupLanguage()), startupError)}
      retryLabel={shellCopy(startupLanguage()).tryAgain}
      retryRef={retryButton}
      onRetry={retryStartup}
    />
  );
  if (!snapshot || (locale.pending && !hasPresentedLocale.current)) return <LaunchLoading
    key={startupAttempt} language={snapshot ? requestedLanguage : undefined}
    phase={snapshot ? "language" : "workspace"} onRetry={snapshot ? undefined : retryStartup} />;
  hasPresentedLocale.current = true;

  const language = locale.language;
  const copy = locale.copy;
  const visibleOperation: OperationState | null = snapshot.lifecycle?.transition && operation?.status !== "running"
    ? { name: "launcher-transition", status: "running", message: copy.running }
    : operation;

  return (
    <div
      className="app-root"
      data-language={language}
      data-platform={snapshot.platform}
      data-profile={snapshot.profile}
      ref={appRoot}
    >
        {(locale.pending || locale.status === "failed") ? <LocaleNotice language={requestedLanguage} copy={copy} failed={locale.status === "failed"} floating /> : null}
        {!snapshot.state.onboardingComplete ? (
          <Onboarding
            key="onboarding"
            language={requestedLanguage}
            setError={setError}
            snapshot={snapshot}
            updateState={updateState}
          />
        ) : (
          <LauncherShell
            browser={browser}
            focusPageOnMount={sawOnboarding.current || startupRetried.current}
            catalogFailure={catalogFailure}
            error={error}
            copy={copy}
            key="launcher"
            language={language}
            logStore={logStore}
            operation={visibleOperation}
            setError={setError}
            snapshot={snapshot}
            updateBrowserCapacity={updateBrowserCapacity}
            updateProModelVersion={updateProModelVersion}
            updateCompactionModel={updateCompactionModel}
            updateState={updateState}
            updateSnapshot={updateSnapshot}
            updatePanelRequest={updatePanelRequest}
          />
        )}
        {error && !snapshot.state.onboardingComplete ? <ErrorToast copy={copy} message={localizeLauncherError(copy, error)} onDismiss={() => setError(null)} /> : null}
    </div>
  );
}

function LauncherShell({
  browser,
  focusPageOnMount,
  catalogFailure,
  error,
  copy,
  language,
  logStore,
  operation,
  setError,
  snapshot,
  updateBrowserCapacity,
  updateProModelVersion,
  updateCompactionModel,
  updateState,
  updateSnapshot,
  updatePanelRequest,
}: {
  browser: BrowserState | null;
  /** Focus the first page's heading once it renders (the shell replaces onboarding or a retried startup, which had focus). */
  focusPageOnMount: boolean;
  catalogFailure: string | null;
  error: string | null;
  copy: Copy;
  language: Language;
  logStore: LauncherLogStore;
  operation: OperationState | null;
  setError: (error: string | null) => void;
  snapshot: LauncherSnapshot;
  updateBrowserCapacity: (value: BrowserCapacitySettings) => void;
  updateProModelVersion: (value: ProModelVersion | null) => void;
  updateCompactionModel: (value: CompactionModel | null) => void;
  updateState: (state: LauncherState) => void;
  updateSnapshot: () => Promise<void>;
  updatePanelRequest: number;
}) {
  const manualInteraction = snapshot.state.browserInteractionMode === "manual";
  useNetworkIssueDismissalReset(browser?.networkIssue);
  const networkNoticeMuted = snapshot.state.showNetworkIssueNotice === false;
  const muteNetworkNotice = async () => {
    try { updateState(await api!.setPreference("showNetworkIssueNotice", false)); }
    catch (cause) { setError(messageOf(cause)); }
  };
  const modelReadiness = modelConnectionReadiness({
    manual: manualInteraction,
    installed: snapshot.state.coreSetupComplete === true,
    catalogVerified: snapshot.state.codexCatalogVerified === true,
    pickerConfirmed: snapshot.state.codexPickerConfirmed === true,
    development: snapshot.profile === "development",
  });
  const devProfile = snapshot.profile === "development";
  const toolProof = currentToolProof(snapshot, operation);
  const browserAuthenticationStatus = browser?.authenticationStatus
    ?? (browser?.authenticated ? "verified"
      : browser?.status === "signed-out" ? "signed-out" : "unknown");
  // The same readiness input as Overview and Connections, so the sidebar, the rows and the tabs agree.
  const readiness = deriveWorkspaceReadiness(workspaceReadinessInput({ snapshot, browser, catalogFailure, toolsVerified: toolProof }));
  const interactionSetupComplete = modelReadiness === "available" && (!manualInteraction || toolProof);
  const firstRunZeroRiskSetup = snapshot.state.browserInteractionMode === "manual"
    && snapshot.state.coreSetupComplete !== true;
  const [surface, setSurface] = useState<Surface>(
    firstRunZeroRiskSetup ? "mcp" : "overview",
  );
  const compactAtMount = useRef(window.matchMedia(COMPACT_SIDEBAR_QUERY).matches).current;
  const [sidebarOpen, setSidebarOpen] = useState(!compactAtMount);
  const [compactSidebar, setCompactSidebar] = useState(compactAtMount);
  const sidebar = useRef<HTMLElement>(null);
  const sidebarToggle = useRef<HTMLButtonElement>(null);
  const [browserSlot, setBrowserSlot] = useState<HTMLDivElement | null>(null);
  const browserSurfaceCommand = useRef(Promise.resolve());
  const browserSurfaceIntent = useRef(0);
  const [accountToolsTargetId, setAccountToolsTargetId] = useState<string | null>(null);
  const [mcpReturnAccountId, setMcpReturnAccountId] = useState<string | null>(null);
  const [mcpReturnAccountLabel, setMcpReturnAccountLabel] = useState<string | null>(null);
  const [mcpTargetMode, setMcpTargetMode] = useState<BrowserInteractionMode | null>(null);
  const [biggerContextRecommendationOpen, setBiggerContextRecommendationOpen] = useState(false);
  const [biggerContextRecommendationBusy, setBiggerContextRecommendationBusy] = useState(false);
  // A failed save from the dialog is shown in it: the page's toast would sit behind the open dialog.
  const [biggerContextRecommendationError, setBiggerContextRecommendationError] = useState<string | null>(null);
  const browserSlotRef = useCallback((node: HTMLDivElement | null) => setBrowserSlot(node), []);
  const browserSurfaceActive = surface === "browser"
    && !(compactSidebar && sidebarOpen)
    && !biggerContextRecommendationOpen;
  const needsBrowser = snapshot.state.browserInteractionMode === "automatic"
    && browserAuthenticationStatus === "signed-out";
  const needsSetup = !needsBrowser && !interactionSetupComplete;
  const transitionBusy = Boolean(snapshot.lifecycle?.transition);
  const updateCopy = updateCopyFor(language);
  const {
    updateError, setUpdateError, updateCheckCooldown, updateCheckBusy, updateInstallPending, updateCancelPending,
    recheckUpdate, installUpdate, cancelUpdate,
  } = useUpdateControls(api!, transitionBusy, updateCopy);
  const [restartPending, setRestartPending] = useState(false);
  const restartInFlight = useRef(false);

  useCompactSidebarDrawer(compactSidebar, sidebarOpen, sidebar, sidebarToggle, setSidebarOpen);
  const updateBusy = updateInstallPending || updateCancelPending || ["downloading", "verifying", "installing", "cancelling"].includes(snapshot.update.status);
  useEffect(() => {
    if (["downloading", "verifying", "installing"].includes(snapshot.update.status)) setUpdateError(null);
  }, [snapshot.update.status]);
  const handledUpdatePanelRequest = useRef(0);
  useEffect(() => {
    if (updatePanelRequest <= handledUpdatePanelRequest.current) return;
    handledUpdatePanelRequest.current = updatePanelRequest;
    setSurface("updates");
    void recheckUpdate();
  }, [updatePanelRequest]);
  const updateBlocked = operation?.status === "running" || browser?.status === "running"
    || browser?.tabs.some(tab => tab.status === "running") === true;
  const selectedManualTab = browser?.tabs.find(tab => tab.active && tab.interactionMode === "manual");

  const enqueueBrowserSurface = useCallback((active: boolean, intent: number, show = false) => {
    const command = browserSurfaceCommand.current
      .catch(() => {})
      .then(async () => {
        const result = await api!.setBrowserSurfaceActive(active);
        if (show && intent === browserSurfaceIntent.current) await api!.showBrowser();
        return result;
      });
    browserSurfaceCommand.current = command.then(() => undefined, () => undefined);
    return command.then(result => ({ intent, result }));
  }, []);

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
    const intent = ++browserSurfaceIntent.current;
    void enqueueBrowserSurface(true, intent).catch((cause) => {
      if (intent === browserSurfaceIntent.current) setError(messageOf(cause));
    });
  }, [enqueueBrowserSurface, selectedManualTab?.id, setError]);

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

    const intent = ++browserSurfaceIntent.current;
    void enqueueBrowserSurface(browserSurfaceActive, intent).then(({ intent: completedIntent }) => {
      if (cancelled || completedIntent !== browserSurfaceIntent.current || !browserSurfaceActive || !browserSlot) return;
      measure();
      observer = new ResizeObserver(measure);
      observer.observe(browserSlot);
      window.addEventListener("resize", measure);
    }).catch((cause) => {
      if (!cancelled && intent === browserSurfaceIntent.current) setError(messageOf(cause));
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(animationFrame);
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [browserSlot, browserSurfaceActive, enqueueBrowserSurface, setError]);

  // The rail's open/collapsed choice on wide windows, kept while the window is narrow (where the rail is a closed
  // drawer) and restored when it widens again; a drawer that is open when the window widens stays open as the rail.
  const desktopSidebarOpen = useRef(true);
  const railState = useRef({ compact: compactSidebar, open: sidebarOpen });
  railState.current = { compact: compactSidebar, open: sidebarOpen };
  useEffect(() => {
    const media = window.matchMedia(COMPACT_SIDEBAR_QUERY);
    const apply = () => {
      const wide = !media.matches;
      if (wide && railState.current.compact && railState.current.open) desktopSidebarOpen.current = true;
      const open = wide && desktopSidebarOpen.current;
      // The focused toggle is replaced when the rail opens or closes, and a rail that closes takes its focused item
      // with it: focus follows to the toggle that shows it again.
      const active = document.activeElement;
      if (open !== railState.current.open
        && (active === sidebarToggle.current || (!open && active instanceof Node && sidebar.current?.contains(active)))) {
        toggleFocusPending.current = true;
      }
      setCompactSidebar(media.matches);
      setSidebarOpen(open);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  const activateBrowser = useCallback(async (show = false) => {
    const intent = ++browserSurfaceIntent.current;
    setSurface("browser");
    await enqueueBrowserSurface(true, intent, show);
  }, [enqueueBrowserSurface]);

  // Opening a task's tab means showing it: a hidden ChatGPT view would leave the idle screen in place.
  const openBrowserTab = async (tabId: string) => {
    try {
      await api!.selectBrowserTab(tabId);
      await activateBrowser(true);
    } catch (cause) {
      setError(messageOf(cause));
    }
  };

  const toggleSidebar = () => {
    const next = !sidebarOpen;
    if (compactSidebar && next && surface === "browser") {
      const intent = ++browserSurfaceIntent.current;
      void enqueueBrowserSurface(false, intent)
        .then(() => {
          if (intent === browserSurfaceIntent.current) setSidebarOpen(true);
        })
        .catch((cause) => {
          if (intent === browserSurfaceIntent.current) setError(messageOf(cause));
        });
      return;
    }
    toggleFocusPending.current = !compactSidebar && document.activeElement === sidebarToggle.current;
    if (!compactSidebar) desktopSidebarOpen.current = next;
    setSidebarOpen(next);
  };

  // "Hide sidebar" sits in the rail and "Show sidebar" in the titlebar: after a toggle, focus moves to the
  // control that replaced the pressed one (the compact drawer manages its own focus).
  const toggleFocusPending = useRef(false);
  useEffect(() => {
    if (!toggleFocusPending.current) return;
    toggleFocusPending.current = false;
    requestAnimationFrame(() => sidebarToggle.current?.focus());
  }, [sidebarOpen]);

  // The account-tools focus target is a one-shot handoff; leaving Accounts must not replay it.
  useEffect(() => {
    if (surface !== "accounts") setAccountToolsTargetId(null);
  }, [surface]);
  // Likewise the per-account tools setup and an inactive mode being configured belong to that visit to Connections:
  // leaving both of its tabs ends them, so Overview's "Manage tools connection" opens the ordinary page.
  useEffect(() => {
    if (surface === "mcp" || surface === "setup") return;
    setMcpReturnAccountId(null);
    setMcpTargetMode(null);
  }, [surface]);

  const navigateSurface = (next: Surface) => {
    if (next !== "browser") browserSurfaceIntent.current += 1;
    // Closing the drawer returns focus to its toggle (useCompactSidebarDrawer); the page hand-off leaves it there.
    drawerNavigation.current = compactSidebar && sidebarOpen;
    setSurface(next);
    if (compactSidebar) setSidebarOpen(false);
  };

  // Each surface remounts its scroller (key={surface}). When the control that navigated was on the old page, focus
  // fell to <body>: hand it to the new page's h1 (once a deferred page has rendered it), else the page region. A nav
  // item, a tab that restores its own focus, or anything the user focused meanwhile keeps focus. The same hand-off
  // runs once on mount when the shell replaces onboarding or a retried startup failure.
  const workspace = useRef<HTMLElement>(null);
  const drawerNavigation = useRef(false);
  const shownSurface = useRef<Surface | null>(focusPageOnMount ? null : surface);
  useLayoutEffect(() => {
    if (shownSurface.current === surface) return;
    shownSurface.current = surface;
    const fromDrawer = drawerNavigation.current;
    drawerNavigation.current = false;
    const region = workspace.current;
    const dropped = () => !document.activeElement || document.activeElement === document.body;
    if (fromDrawer || !region || !dropped()) return;
    let observer: MutationObserver | null = null;
    // A page can replace the heading it first rendered once its state settles (Browser swaps the idle h1 for its own
    // when the ChatGPT view appears after "Sign in to ChatGPT"): while the handed-off element is removed with focus,
    // focus follows to the new heading. Once anything else holds focus, the hand-off is over.
    let handed: HTMLElement | null = null;
    const settle = () => {
      if (handed?.isConnected) return document.activeElement !== handed;
      if (!dropped()) return true;
      const heading = region.querySelector<HTMLElement>(".nk-shell__scroll h1");
      const loading = region.querySelector(".nk-shell__scroll .surface-empty[role='status']");
      if (!heading && loading) return false;
      const target = heading ?? region;
      if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
      handed = target;
      return false;
    };
    if (settle()) return;
    observer = new MutationObserver(() => { if (settle()) observer?.disconnect(); });
    observer.observe(region, { childList: true, subtree: true });
    const timer = window.setTimeout(() => observer?.disconnect(), 5000);
    return () => { observer?.disconnect(); window.clearTimeout(timer); };
  }, [surface]);

  const setRecommendedBiggerContext = async (enabled: boolean) => {
    if (biggerContextRecommendationBusy) return;
    setBiggerContextRecommendationBusy(true);
    setBiggerContextRecommendationError(null);
    try {
      updateState(await api!.setBiggerContext(enabled));
    } catch (cause) {
      setBiggerContextRecommendationError(messageOf(cause));
    } finally {
      setBiggerContextRecommendationBusy(false);
    }
  };

  // One derived state drives the session line's word and dot: signed in (ready), checking (busy, pulsing), and
  // sign-in needed or verification unavailable (amber, steady: they need the user). Manual mode needs no session.
  const sessionPhase = manualInteraction ? "manual"
    : browserAuthenticationStatus === "unavailable" ? "unavailable"
      : browser?.authenticated ? "ready" : browserAuthenticationStatus === "signed-out" ? "signed-out" : "checking";
  const sessionState = sessionPhase === "ready" ? "ready" : sessionPhase === "manual" ? "idle" : "busy";
  const sessionLabel = sessionPhase === "manual" ? copy.manualInteraction
    : sessionPhase === "unavailable" ? workflowCopy(language).session.verificationUnavailable
      : sessionPhase === "ready" ? copy.sessionConnected : sessionPhase === "signed-out" ? copy.sessionDisconnected : copy.checkingSignIn;
  const shell = shellCopy(language);
  // Live browser runs, as counted on Overview (Active browser runs).
  const runningTabs = browser?.tabs.filter(tab => tab.id !== "home" && ["running", "loading", "testing"].includes(tab.status)).length ?? 0;
  // The Browser item reports the session with the Overview row's word and tone: sign-in needed (pulsing) and
  // verification unavailable (amber, steady; not an error), else a browser error, else the running count.
  const sessionConnection = readiness.connections.session;
  const browserAttention = needsBrowser ? "required"
    : sessionConnection.key === "verification-unavailable" ? "warning"
      : browser?.status === "error" ? "error" : null;
  // The Connections item reports what its two tabs report (the session belongs to the Browser item): a failed or
  // degraded models or tools connection first, then optional tools setup once the models are in Codex.
  const modelsConnection = readiness.connections.models;
  const toolsConnection = readiness.connections.tools;
  const connectionsProblem = [modelsConnection, toolsConnection].find(connection => connection.dot === "error")
    ?? [modelsConnection, toolsConnection].find(connection => connection.key === "needs-attention");
  const mcpOptional = snapshot.state.browserInteractionMode === "automatic"
    && snapshot.state.codexCatalogVerified === true
    && (toolsConnection.key === "not-connected" || toolsConnection.key === "connector-pending");
  const connectionsAttention = needsSetup ? "required"
    : connectionsProblem ? connectionsProblem.dot === "error" ? "error" : "warning"
    : mcpOptional ? "optional" : null;
  const updateReady = snapshot.update.status === "available";

  return (
    <div
      className={`nk-shell${compactSidebar ? " is-compact" : !sidebarOpen ? " is-collapsed" : ""}${sidebarOpen ? " is-sidebar-open" : ""}`}
      data-surface={surface}
    >
      {compactSidebar && sidebarOpen ? (
        <button
          aria-hidden="true"
          aria-label={copy.hideSidebar}
          className="nk-shell__scrim"
          onClick={() => setSidebarOpen(false)}
          tabIndex={-1}
          type="button"
        />
      ) : null}

      <aside
        aria-label={shell.navigation}
        aria-modal={compactSidebar && sidebarOpen ? "true" : undefined}
        inert={!sidebarOpen}
        id="app-sidebar"
        ref={sidebar}
        role={compactSidebar ? "dialog" : undefined}
        tabIndex={compactSidebar ? -1 : undefined}
        className="nk-sidebar"
      >
        <div className="nk-sidebar__chrome">
          <span aria-hidden="true" className="nk-sidebar__controls" />
          <IconButton
            buttonRef={sidebarOpen ? sidebarToggle : undefined}
            controls="app-sidebar"
            expanded
            icon="sidebar"
            label={copy.hideSidebar}
            onClick={toggleSidebar}
          />
        </div>
        <div className="nk-sidebar__brand">
          <Mark label={null} size={32} />
          <div className="nk-wordmark"><strong>{copy.product}</strong><small>{copy.localWorkspace}</small></div>
        </div>

        {/* One nav landmark for every destination: the groups scroll, the footer items stay pinned below them. */}
        <nav className="nk-sidebar__navigation">
          <div className="nk-sidebar__nav">
          <SidebarGroup label={copy.workspace}>
            <SidebarItem active={surface === "overview"} icon="overview" label={copy.overview} onClick={() => navigateSurface("overview")} />
            <SidebarItem active={surface === "accounts"} icon="accounts" label={copy.accountsNav} onClick={() => navigateSurface("accounts")} />
            <SidebarItem
              active={surface === "browser"}
              badge={browserAttention === "required"
                ? <ActionDot pulse tone="required" />
                : browserAttention === "warning" ? <ActionDot tone="required" />
                  : browserAttention === "error"
                    ? <ActionDot tone="error" />
                    : runningTabs || null}
              icon="browser"
              label={copy.browser}
              onClick={() => navigateSurface("browser")}
              status={browserAttention === "required" || browserAttention === "warning"
                ? connectionStatusWord(sessionConnection, copy, language)
                : browserAttention === "error" ? shell.needsAttention
                  : runningTabs ? shell.running(runningTabs) : undefined}
            />
            <SidebarItem active={surface === "activity"} icon="activity" label={copy.activity} onClick={() => navigateSurface("activity")} />
            <SidebarItem active={surface === 'tasks'} icon="logs" label={taskCenterTitle(language)} onClick={() => navigateSurface('tasks')} />
          </SidebarGroup>
          <SidebarGroup label={copy.configuration}>
            <SidebarItem
              active={surface === "setup" || surface === "mcp"}
              badge={connectionsAttention === "required"
                ? <ActionDot pulse tone="required" />
                : connectionsAttention === "error" ? <ActionDot tone="error" />
                  : connectionsAttention === "warning" ? <ActionDot tone="required" />
                    : connectionsAttention === "optional" ? <ActionDot tone="optional" /> : null}
              icon="setup"
              label={copy.connectionsNav}
              onClick={() => navigateSurface("setup")}
              status={connectionsAttention === "required" ? shell.needsSetup
                : connectionsProblem && (connectionsAttention === "error" || connectionsAttention === "warning")
                  ? connectionStatusWord(connectionsProblem, copy, language)
                  : connectionsAttention === "optional" ? shell.optionalSetup : undefined}
            />
          </SidebarGroup>
          </div>

          <div className="nk-sidebar__footer">
            <div className="nk-sidebar__session" role="status">
              <StateDot className={sessionPhase === "signed-out" || sessionPhase === "unavailable" ? "nk-action-dot is-static" : undefined} state={sessionState} />
              <span>{sessionLabel}</span>
            </div>
            {/* A ready release renames the item (the update tone marks it) rather than adding a dot beside it. */}
            <SidebarItem
              active={surface === "updates"}
              icon="update"
              label={updateReady ? shell.updateAvailable : updateCopy.title}
              tone={updateReady ? "update" : undefined}
              onClick={() => navigateSurface("updates")}
            />
            <SidebarItem
              active={surface === "settings"}
              icon="settings"
              label={copy.settings}
              onClick={() => navigateSurface("settings")}
            />
            <div className="nk-sidebar__version"><Mark label={null} size={20} /><span>v{snapshot.version}</span></div>
          </div>
        </nav>
      </aside>

      <div className="nk-shell__main">
        <TitleBar
          copy={copy}
          language={language}
          surface={surface}
          devProfile={devProfile}
          sidebarOpen={sidebarOpen}
          sidebarToggle={sidebarToggle}
          toggleSidebar={toggleSidebar}
        />
        <main className="nk-shell__content workspace" ref={workspace}>
          {snapshot.state.launcherRestartRequired ? (
            <div className="nk-shell__notice-row">
            <Notice
              action={(
                <Button busy={restartPending} disabled={updateBusy || transitionBusy}
                  onClick={() => {
                    if (restartInFlight.current) return;
                    restartInFlight.current = true;
                    setRestartPending(true);
                    setError(null);
                    void api!.restartLauncher().catch(cause => {
                      setError(messageOf(cause));
                      restartInFlight.current = false;
                      setRestartPending(false);
                    });
                  }}>{restartPending ? copy.restartingRuntime : copy.launcherRuntimeRestartAction}</Button>
              )}
              className="nk-shell__notice"
              title={copy.launcherRuntimeRestartTitle}
              tone="warning"
            >
              {copy.launcherRuntimeRestartBody}
            </Notice>
            </div>
          ) : null}
          <div
            className="nk-shell__scroll"
            key={surface}
          >
            {surface === "overview" ? <Overview copy={copy} browser={browser} catalogFailure={catalogFailure}
              snapshot={snapshot} toolsReady={toolProof} logStore={logStore} navigate={navigateSurface}
              openTab={(tabId) => void openBrowserTab(tabId)} onMuteNetworkNotice={muteNetworkNotice} /> : null}
            {surface === "accounts" ? <AccountSettings loadCopy={copy} copy={copy} language={language} openBrowser={() => navigateSurface("browser")}
              setError={setError} manual={snapshot.state.browserInteractionMode === "manual"} transitionBusy={transitionBusy}
              focusAccountId={accountToolsTargetId}
              toolsSetup={{ runtimeConfigured: snapshot.state.mcpRuntimeInstalled === true && snapshot.mcpCredentialsConfigured,
                connectorName: snapshot.connectorNames[snapshot.state.browserInteractionMode], urls: snapshot.urls }}
              onSetupTools={(accountId, accountLabel) => {
                setMcpReturnAccountId(accountId);
                setMcpReturnAccountLabel(accountLabel);
                setMcpTargetMode(null);
                navigateSurface("mcp");
              }} /> : null}
            {surface === 'tasks' ? <ContentSurface title={taskCenterTitle(language)} subtitle={taskCenterSubtitle(language)}>
              <QueueControls queue={browser?.queue} language={language} disabled={transitionBusy}
                action={(id, action) => api!.queueAction(id, action)} pause={(accountId, paused) => api!.pauseQueue(accountId, paused)}
                onError={cause => setError(messageOf(cause))} />
              <TaskCenter loadCopy={copy} tasks={browser?.tasks ?? []} language={language} disabled={transitionBusy}
                historyHealth={browser?.taskHistoryHealth}
                open={async tabId => { await api!.selectBrowserTab(tabId); await activateBrowser(true); }}
                cancel={(tabId, traceId) => api!.closeBrowserTab(tabId, traceId)}
                dismiss={(accountId, id) => api!.dismissTask(accountId, id)}
                onError={cause => setError(messageOf(cause))} />
            </ContentSurface> : null}
            {surface === "browser" ? (
              <BrowserSurface
                accountSetup={!manualInteraction && browser ? <AccountToolsHandoff browser={browser} language={language}
                  disabled={transitionBusy} onContinue={accountId => {
                    setAccountToolsTargetId(accountId);
                    navigateSurface("accounts");
                  }} /> : null}
                browser={browser}
                error={error}
                browserSlotRef={browserSlotRef}
                copy={copy}
                interactionMode={snapshot.state.browserInteractionMode}
                language={language}
                transitionBusy={transitionBusy}
                operation={operation}
                platform={snapshot.platform}
                readiness={readiness}
                setError={setError}
                networkNoticeMuted={networkNoticeMuted}
                onMuteNetworkNotice={muteNetworkNotice}
                onOpenConnections={() => {
                  setMcpTargetMode(null);
                  setMcpReturnAccountId(null);
                  navigateSurface("mcp");
                }}
              />
            ) : null}
            {surface === "setup" ? (
              <SetupSurface
                activateBrowser={activateBrowser}
                browser={browser}
                copy={copy}
                catalogFailure={catalogFailure}
                devProfile={devProfile}
                operation={operation}
                readiness={readiness}
                setError={setError}
                showMcp={() => {
                  setMcpTargetMode(null);
                  setMcpReturnAccountId(null);
                  setSurface("mcp");
                }}
                showActivity={() => setSurface("activity")}
                snapshot={snapshot}
                updateState={updateState}
              />
            ) : null}
            {surface === "mcp" ? (
              <McpSurface
                accountSetupLabel={mcpReturnAccountId ? mcpReturnAccountLabel : null}
                targetAccountId={mcpReturnAccountId}
                browserAccountId={browser?.accountId ?? null}
                onReturnToAccount={mcpReturnAccountId ? () => {
                  setAccountToolsTargetId(mcpReturnAccountId);
                  setMcpReturnAccountId(null);
                  navigateSurface("accounts");
                } : undefined}
                copy={copy}
                devProfile={devProfile}
                interactionMode={mcpTargetMode ?? snapshot.state.browserInteractionMode}
                language={language}
                showSetup={() => setSurface("setup")}
                onDone={() => {
                  setMcpTargetMode(null);
                  if (mcpReturnAccountId) {
                    setAccountToolsTargetId(mcpReturnAccountId);
                    setMcpReturnAccountId(null);
                    navigateSurface("accounts");
                  } else navigateSurface("browser");
                }}
                operation={operation}
                readiness={readiness}
                setError={setError}
                snapshot={snapshot}
                updateState={updateState}
                updateSnapshot={updateSnapshot}
              />
            ) : null}
            {surface === "activity" ? (
              <ActivitySurface loadCopy={copy} transitionBusy={transitionBusy} copy={copy} language={language} logStore={logStore} setError={setError} />
            ) : null}
            {surface === "updates" ? <Updates loadCopy={copy} language={language} currentVersion={snapshot.version}
              state={snapshot.update} busy={updateBusy} blocked={updateBlocked} checking={updateCheckBusy}
              cooldown={updateCheckCooldown} error={updateError} transitionBusy={transitionBusy}
              onCheck={() => void recheckUpdate()} onInstall={() => void installUpdate()}
              cancelling={updateCancelPending} onCancel={() => void cancelUpdate()} platform={snapshot.platform} /> : null}
            {surface === "settings" ? (
              <SettingsSurface loadCopy={copy}
                browser={browser}
                catalogFailure={catalogFailure}
                showModelSetup={() => navigateSurface("setup")}
                configureInteractionMode={(mode) => {
                  setMcpTargetMode(mode);
                  setMcpReturnAccountId(null);
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
                updateCompactionModel={updateCompactionModel}
                showBiggerContextInfo={() => setBiggerContextRecommendationOpen(true)}
                showActivity={() => navigateSurface("activity")}
                updateState={updateState}
              />
            ) : null}
          </div>
        </main>
      </div>

      {error && surface !== "browser" ? <ErrorToast copy={copy} message={localizeLauncherError(copy, error)} onDismiss={() => setError(null)} /> : null}
        {biggerContextRecommendationOpen ? (
          <BiggerContextRecommendation
            busy={biggerContextRecommendationBusy || operation?.status === "running"}
            checked={snapshot.state.experimentalBiggerContext}
            copy={copy}
            error={biggerContextRecommendationError ? localizeLauncherError(copy, biggerContextRecommendationError) : null}
            onChange={(enabled) => void setRecommendedBiggerContext(enabled)}
            onClose={() => {
              setBiggerContextRecommendationOpen(false);
              setBiggerContextRecommendationError(null);
            }}
          />
        ) : null}

    </div>
  );
}
