import { createLauncherLogStore, type LauncherLogStore } from './launcher-log-store';
import { deferredSurface } from './deferred-surface';
import { Onboarding } from "./Onboarding";
import { BrowserSurface } from "./BrowserSurface";
import { SetupSurface } from './SetupSurface';
import { McpSurface } from './McpSurface';
import { IconButton, StateDot, ContentSurface, PrimaryButton, McpMark, messageOf, useModalFocus, Switch } from './launcher-ui';
import { runtimeCapabilities, currentToolProof } from './launcher-readiness';

import { taskCenterTitle } from './task-center-copy';
import { QueueControls } from './QueueControls';
import type { CompactionModel } from "./types";
import { modelConnectionReadiness } from "./setup-progress";
import { BrandMark } from "./BrandMark";
import { Overview } from "./Overview";
import { AccountToolsHandoff } from "./AccountToolsOnboarding";

import { updateCopyFor } from "./update-copy";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { copyFor, localizeLauncherError, type Copy } from "./i18n";
import { Icon, type IconName } from "./icons";

import { deriveWorkspaceReadiness } from "./workspace-readiness";
import { workflowCopy } from "./workflow-copy";

import "./connections.css";
import "./connection-recovery.css";
import type { BrowserCapacitySettings, BrowserInteractionMode, BrowserState, Language, LauncherLifecycle as LifecycleProjection, LauncherSnapshot, LauncherState, LogRecord, OperationState, ProModelVersion, Surface } from "./types";

const ActivitySurface = deferredSurface(async () => ({ default: (await import('./ActivitySurface')).ActivitySurface }));
const AccountSettings = deferredSurface(async () => ({ default: (await import('./AccountSettings')).AccountSettings }));
const SettingsSurface = deferredSurface(async () => ({ default: (await import('./SettingsSurface')).SettingsSurface }));
const TaskCenter = deferredSurface(async () => ({ default: (await import('./TaskCenter')).TaskCenter }));
const Updates = deferredSurface(async () => ({ default: (await import('./Updates')).Updates }));
const api = window.codexWebLauncher;
const COMPACT_SIDEBAR_QUERY = "(max-width: 860px)";

function smokePassedForState(state: LauncherState, version: string): boolean {
  return state.browserSmokePassed === true && state.browserSmokeVersion === version;
}

type ProjectedLauncherApi = NonNullable<typeof api> & {
  onLifecycle?: (listener: (projection: LifecycleProjection) => void) => () => void;
};

export function App() {
  const [snapshot, setSnapshot] = useState<LauncherSnapshot | null>(null);
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
  const documentLanguage = snapshot?.state.language ?? "en";
  const currentLanguage = useRef(documentLanguage);
  currentLanguage.current = documentLanguage;
  const acceptLifecycle = useCallback((next: LifecycleProjection | null | undefined) => {
    if (!next || (acceptedLifecycle.current?.revision ?? -1) >= next.revision) return false;
    // Advance the receipt synchronously. React may defer setSnapshot, while a
    // competing event or snapshot must already observe this same revision.
    acceptedLifecycle.current = next;
    if (currentInteractionMode.current === "manual" || next.catalog?.status === "ready") {
      const staleCatalogAlert = catalogAlert.current;
      catalogAlert.current = null;
      setCatalogFailure(null);
      setError(current => current === staleCatalogAlert ? null : current);
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
  }, [documentLanguage]);

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
        || (state.codexCatalogVerified === true && !(api as ProjectedLauncherApi).onLifecycle)) {
        const staleCatalogAlert = catalogAlert.current;
        catalogAlert.current = null;
        setCatalogFailure(null);
        setError(current => current === staleCatalogAlert ? null : current);
      }
      if (!initialized) pendingState = state;
      setSnapshot((current) => current
        ? {
            ...current,
            state,
            smokePassed: smokePassedForState(state, current.version),
          }
        : current);
    });
    const unsubscribeBrowser = api.onBrowserState(next => {
      if (!initialized) pendingBrowser = next;
      else setBrowser(next);
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
          const staleCatalogAlert = catalogAlert.current;
          catalogAlert.current = null;
          setCatalogFailure(null);
          setError(current => current === staleCatalogAlert ? null : current);
        }
      } else if (next.status === "failed" && next.name !== "mcp-verification") {
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
    const unsubscribeLifecycle = (api as ProjectedLauncherApi).onLifecycle?.((next) => {
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
      setBrowser(pendingBrowser ?? next.browser);
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
        && latestOperation.name !== "catalog-verification") {
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
      const staleCatalogAlert = catalogAlert.current;
      catalogAlert.current = null;
      setCatalogFailure(null);
      setError(current => current === staleCatalogAlert ? null : current);
    }
    setSnapshot((current) => current
      ? {
          ...current,
          state,
          smokePassed: smokePassedForState(state, current.version),
        }
      : current);
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
  const visibleOperation: OperationState | null = snapshot.lifecycle?.transition && operation?.status !== "running"
    ? { name: "launcher-transition", status: "running", message: copy.running }
    : operation;

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
  const modelReadiness = modelConnectionReadiness({
    manual: manualInteraction,
    installed: snapshot.state.coreSetupComplete === true,
    catalogVerified: snapshot.state.codexCatalogVerified === true,
    pickerConfirmed: snapshot.state.codexPickerConfirmed === true,
    development: snapshot.profile === "development",
  });
  const devProfile = snapshot.profile === "development";
  const toolProof = currentToolProof(snapshot, operation);
  const readiness = deriveWorkspaceReadiness({
    manual: manualInteraction,
    development: devProfile,
    authenticationStatus: manualInteraction ? "verified"
      : browser?.authenticationStatus ?? (browser?.authenticated ? "verified"
        : browser?.status === "signed-out" ? "signed-out" : "unknown"),
    smokePassed: snapshot.smokePassed,
    installed: snapshot.state.coreSetupComplete === true,
    catalogUnavailable: Boolean(catalogFailure),
    catalogVerified: snapshot.state.codexCatalogVerified === true,
    pickerConfirmed: snapshot.state.codexPickerConfirmed === true,
    toolsInstalled: snapshot.state.mcpRuntimeInstalled === true && snapshot.mcpCredentialsConfigured,
    toolsVerified: toolProof,
    runtime: { ...(runtimeCapabilities(snapshot) ?? {}), transitionActive: Boolean(snapshot.lifecycle?.transition) },
  });
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
  const browserSlotRef = useCallback((node: HTMLDivElement | null) => setBrowserSlot(node), []);
  const browserSurfaceActive = surface === "browser"
    && !(compactSidebar && sidebarOpen)
    && !biggerContextRecommendationOpen;
  const browserAuthenticationStatus = browser?.authenticationStatus
    ?? (browser?.authenticated ? "verified"
      : browser?.status === "signed-out" ? "signed-out" : "unknown");
  const needsBrowser = snapshot.state.browserInteractionMode === "automatic"
    && browserAuthenticationStatus === "signed-out";
  const needsSetup = !needsBrowser && !interactionSetupComplete;
  const mcpOptional = snapshot.state.browserInteractionMode === "automatic"
    && snapshot.state.codexCatalogVerified === true
    && !toolProof;
  const transitionBusy = Boolean(snapshot.lifecycle?.transition);
  const updateCopy = updateCopyFor(language);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateCheckCooldown, setUpdateCheckCooldown] = useState(false);
  const [updateCheckBusy, setUpdateCheckBusy] = useState(false);
  const [updateInstallPending, setUpdateInstallPending] = useState(false);
  const [updateCancelPending, setUpdateCancelPending] = useState(false);
  const updateCancelInFlight = useRef(false);
  const [restartPending, setRestartPending] = useState(false);
  const restartInFlight = useRef(false);
  const updateInstallPendingRef = useRef(false);
  const updateCheckTimer = useRef<number | undefined>(undefined);
  const updateCheckMounted = useRef(false);
  const updateCheckPendingRef = useRef(false);
  useEffect(() => {
    updateCheckMounted.current = true;
    return () => {
      updateCheckMounted.current = false;
      window.clearTimeout(updateCheckTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!compactSidebar || !sidebarOpen || !sidebar.current) return;
    const drawer = sidebar.current;
    const workspace = drawer.parentElement?.querySelector<HTMLElement>(":scope > .workspace") ?? null;
    const workspaceWasInert = workspace?.inert ?? false;
    if (workspace) workspace.inert = true;
    const focusable = () => [...drawer.querySelectorAll<HTMLElement>('button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')];
    const focusDrawer = () => {
      const active = drawer.querySelector<HTMLElement>('.sidebar-item[aria-current="page"]');
      (active ?? focusable()[0] ?? drawer).focus();
    };
    const frame = requestAnimationFrame(focusDrawer);
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSidebarOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const controls = focusable();
      if (!controls.length) {
        event.preventDefault();
        drawer.focus();
        return;
      }
      const first = controls[0]!;
      const last = controls.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const focusin = (event: FocusEvent) => {
      if (event.target instanceof Node && drawer.contains(event.target)) return;
      event.stopPropagation();
      focusDrawer();
    };
    document.addEventListener("keydown", keydown, true);
    document.addEventListener("focusin", focusin, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", keydown, true);
      document.removeEventListener("focusin", focusin, true);
      if (workspace) workspace.inert = workspaceWasInert;
      if (window.matchMedia(COMPACT_SIDEBAR_QUERY).matches) {
        requestAnimationFrame(() => sidebarToggle.current?.focus());
      }
    };
  }, [compactSidebar, sidebarOpen]);
  const recheckUpdate = async () => {
    if (transitionBusy || updateCheckCooldown || updateCheckBusy || updateCheckPendingRef.current) return;
    updateCheckPendingRef.current = true;
    setUpdateCheckBusy(true);
    setUpdateError(null);
    try {
      const next = await api!.recheckUpdate();
      if (!updateCheckMounted.current) return;
      if (next.status === "error") setUpdateError(next.message);
      setUpdateCheckCooldown(true);
      window.clearTimeout(updateCheckTimer.current);
      updateCheckTimer.current = window.setTimeout(() => setUpdateCheckCooldown(false), 60_000);
    } catch (error) {
      if (updateCheckMounted.current) setUpdateError(messageOf(error));
    } finally {
      updateCheckPendingRef.current = false;
      if (updateCheckMounted.current) setUpdateCheckBusy(false);
    }
  };
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

  const activateBrowser = useCallback(async (show = false) => {
    const intent = ++browserSurfaceIntent.current;
    setSurface("browser");
    await enqueueBrowserSurface(true, intent, show);
  }, [enqueueBrowserSurface]);

  const openBrowserTab = async (tabId: string) => {
    try {
      await api!.selectBrowserTab(tabId);
      await activateBrowser();
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
    setSidebarOpen(next);
  };

  const navigateSurface = (next: Surface) => {
    if (next !== "browser") browserSurfaceIntent.current += 1;
    setSurface(next);
    if (compactSidebar) setSidebarOpen(false);
  };

  const installUpdate = async () => {
    if (updateInstallPendingRef.current) return;
    updateInstallPendingRef.current = true;
    setUpdateInstallPending(true);
    setUpdateError(null);
    try {
      await api!.installUpdate();
    } catch (cause) {
      setUpdateError(messageOf(cause));
    } finally {
      updateInstallPendingRef.current = false;
      setUpdateInstallPending(false);
    }
  };

  const cancelUpdate = async () => {
    if (updateCancelInFlight.current) return;
    updateCancelInFlight.current = true;
    setUpdateCancelPending(true);
    setUpdateError(null);
    try {
      const result = await api!.cancelUpdatePreparation();
      if (result.status === "too-late") setUpdateError(updateCopy.cancelTooLate);
      else if (result.status === "failed") setUpdateError(result.message || updateCopy.failed);
    } catch (cause) {
      setUpdateError(messageOf(cause));
    } finally {
      updateCancelInFlight.current = false;
      setUpdateCancelPending(false);
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
        language={language}
        surface={surface}
        devProfile={devProfile}
        draggable
        sidebarOpen={sidebarOpen}
        sidebarToggle={sidebarToggle}
        toggleSidebar={toggleSidebar}
      />

      {compactSidebar && sidebarOpen ? (
        <button
          aria-hidden="true"
          aria-label={copy.hideSidebar}
          className="sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
          tabIndex={-1}
          type="button"
        />
      ) : null}

      <aside
        aria-label={compactSidebar ? copy.workspace : undefined}
        aria-modal={compactSidebar && sidebarOpen ? "true" : undefined}
        inert={!sidebarOpen}
        id="app-sidebar"
        ref={sidebar}
        role={compactSidebar ? "dialog" : undefined}
        style={{ width: sidebarOpen ? "var(--sidebar-width)" : 0 }}
        tabIndex={compactSidebar ? -1 : undefined}
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
                <SidebarItem active={surface === "activity"} icon="activity" label={copy.activity} onClick={() => navigateSurface("activity")} />
                <SidebarItem active={surface === 'tasks'} icon="logs" label={taskCenterTitle(language)} onClick={() => navigateSurface('tasks')} />
              </SidebarGroup>
              <SidebarGroup label={copy.configuration}>
                <SidebarItem
                  active={surface === "setup" || surface === "mcp"}
                  badge={needsSetup
                    ? <ActionDot pulse tone="required" />
                    : mcpOptional ? <ActionDot tone="optional" /> : null}
                  icon="setup"
                  label={copy.connectionsNav}
                  onClick={() => navigateSurface("setup")}
                />
              </SidebarGroup>
            </nav>

            <div className="sidebar-footer">
              <div className="sidebar-session"><StateDot state={manualInteraction ? "idle" : browser?.authenticated ? "ready" : "idle"} /><span>{manualInteraction ? copy.manualInteraction
                : browserAuthenticationStatus === "unavailable" ? workflowCopy(language).session.verificationUnavailable
                  : browser?.authenticated ? copy.sessionConnected : browserAuthenticationStatus === "signed-out" ? copy.sessionDisconnected : copy.checkingSignIn}</span></div>
              <SidebarItem
                active={surface === "updates"}
                icon="update"
                label={updateCopy.title}
                badge={snapshot.update.status === "available" ? <ActionDot tone="optional" /> : null}
                tone={snapshot.update.status === "available" ? "update" : undefined}
                onClick={() => navigateSurface("updates")}
              />
              <SidebarItem
                active={surface === "settings"}
                icon="settings"
                label={copy.settings}
                onClick={() => navigateSurface("settings")}
              />
              <div className="sidebar-version"><BrandMark small /><span>v{snapshot.version}</span></div>
            </div>
          </div>
        </div>
      </aside>

      {error && surface !== "browser" ? <ErrorToast copy={copy} message={localizeLauncherError(copy, error)} onDismiss={() => setError(null)} /> : null}
      <section className={`workspace${snapshot.state.launcherRestartRequired ? " has-runtime-notice" : ""}`}>
          {snapshot.state.launcherRestartRequired ? <div className="runtime-restart-notice" role="status">
            <div><strong>{copy.launcherRuntimeRestartTitle}</strong><p>{copy.launcherRuntimeRestartBody}</p></div>
            <button type="button" className="button-secondary" disabled={restartPending || updateBusy || transitionBusy}
              aria-busy={restartPending}
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
              }}>{restartPending ? <><i className="tab-spinner" aria-hidden="true" />{updateCopy.installing}</> : copy.launcherRuntimeRestartAction}</button>
          </div> : null}
          <div
            className="surface-transition"
            key={surface}
          >
            {surface === "overview" ? <Overview copy={copy} browser={browser} catalogFailure={catalogFailure}
              snapshot={snapshot} toolsReady={toolProof} logStore={logStore} navigate={navigateSurface}
              openTab={(tabId) => void openBrowserTab(tabId)} /> : null}
            {surface === "accounts" ? <ContentSurface title={copy.accountsTitle} subtitle={copy.accountsBody}>
              <AccountSettings loadCopy={copy} copy={copy} language={language} openBrowser={() => navigateSurface("browser")}
                setError={setError} manual={snapshot.state.browserInteractionMode === "manual"} transitionBusy={transitionBusy}
                focusAccountId={accountToolsTargetId}
                toolsSetup={{ runtimeConfigured: snapshot.state.mcpRuntimeInstalled === true && snapshot.mcpCredentialsConfigured,
                  connectorName: snapshot.connectorNames[snapshot.state.browserInteractionMode], urls: snapshot.urls }}
                onSetupTools={(accountId, accountLabel) => {
                  setMcpReturnAccountId(accountId);
                  setMcpReturnAccountLabel(accountLabel);
                  setMcpTargetMode(null);
                  navigateSurface("mcp");
                }} />
            </ContentSurface> : null}
            {surface === 'tasks' ? <ContentSurface title={taskCenterTitle(language)}>
              <QueueControls queue={browser?.queue} language={language} disabled={transitionBusy}
                action={(id, action) => api!.queueAction(id, action)} pause={(accountId, paused) => api!.pauseQueue(accountId, paused)}
                onError={cause => setError(messageOf(cause))} />
              <TaskCenter loadCopy={copy} tasks={browser?.tasks ?? []} language={language} disabled={transitionBusy}
                historyHealth={browser?.taskHistoryHealth}
                open={async tabId => { await api!.selectBrowserTab(tabId); navigateSurface('browser'); }}
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
              cancelling={updateCancelPending} onCancel={() => void cancelUpdate()} /> : null}
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

    </main>
  );
}

function TitleBar({
  copy,
  language,
  surface,
  devProfile,
  draggable,
  sidebarOpen,
  sidebarToggle,
  toggleSidebar,
}: {
  copy: Copy;
  language: Language;
  surface: Surface;
  devProfile: boolean;
  draggable: boolean;
  sidebarOpen: boolean;
  sidebarToggle: RefObject<HTMLButtonElement | null>;
  toggleSidebar: () => void;
}) {
  return (
    <header className={`app-titlebar${draggable ? " draggable" : ""}`}>
      <div className="titlebar-left no-drag">
        <IconButton
          buttonRef={sidebarToggle}
          icon="sidebar"
          label={sidebarOpen ? copy.hideSidebar : copy.showSidebar}
          controls="app-sidebar"
          expanded={sidebarOpen}
          onClick={toggleSidebar}
        />
        {devProfile ? <span className="titlebar-dev-profile">{copy.devBadge}</span> : null}
      </div>
      <div className="titlebar-location"><span>NEKODEX</span><span aria-hidden="true">/</span><strong>{({ overview: copy.overview, accounts: copy.accountsNav, browser: copy.browser, tasks: taskCenterTitle(language), setup: copy.connectionsNav, mcp: copy.connectionsNav, activity: copy.activity, settings: copy.settings, updates: updateCopyFor(language).title })[surface]}</strong></div>
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
  const dialog = useRef<HTMLDivElement>(null);
  useModalFocus(true, dialog, onClose, { closeAllowed: !busy });
  return createPortal(
    <div
      aria-busy={busy}
      aria-describedby="bigger-context-recommendation-body"
      aria-labelledby="bigger-context-recommendation-title"
      aria-modal="true"
      className="bigger-context-recommendation-backdrop"
      ref={dialog}
      role="dialog"
      tabIndex={-1}
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
        {checked ? <p className="bigger-context-recommendation-restart">{copy.contextClientRefreshBody}</p> : null}
        <footer>
          <button className="button-secondary" data-modal-autofocus disabled={busy} onClick={onClose} type="button">{copy.close}</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
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
