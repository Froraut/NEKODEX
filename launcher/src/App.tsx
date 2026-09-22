import { SetupSurface } from './SetupSurface';
import { McpSurface } from './McpSurface';
import { SettingsSurface } from './SettingsSurface';
import { StateDot, ContentSurface, SecondaryButton, handleRadioGroupKeys, PrimaryButton, McpMark, messageOf, useModalFocus, InteractionModePicker, Switch } from './launcher-ui';
import { runtimeCapabilities, currentToolProof } from './launcher-readiness';

import { TaskCenter, taskCenterTitle } from './TaskCenter';
import { QueueControls } from './QueueControls';
import { browserWindowCopy } from "./browser-window-copy";
import { BrowserWorkspaceManager } from "./BrowserWorkspaceManager";
import { sessionIssueCopy } from "./session-issue-copy";
import type { CompactionModel } from "./types";
import { modelConnectionReadiness } from "./setup-progress";
import languages from "../electron/languages.json";
import { BrandMark } from "./BrandMark";
import { Overview } from "./Overview";
import { AccountSettings } from "./AccountSettings";
import { AccountToolsHandoff } from "./AccountToolsOnboarding";

import { UsageDashboard } from "./UsageDashboard";
import { Updates } from "./Updates";
import { updateCopyFor } from "./update-copy";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { copyFor, localizeLauncherError, type Copy } from "./i18n";
import { Icon, type IconName } from "./icons";
import { browserControls } from "./browser-controls";

import { PasskeyLoginGuide } from "./PasskeyLoginGuide";
import { ExistingChromeLoginGuide } from "./ExistingChromeLoginGuide";
import { passkeyFailureText } from "./passkey-copy";
import { deriveWorkspaceReadiness, type WorkspaceReadiness } from "./workspace-readiness";
import { workflowCopy } from "./workflow-copy";

import "./connections.css";
import "./connection-recovery.css";
import type { BrowserCapacitySettings, BrowserInteractionMode, BrowserState, Language, LauncherLifecycle as LifecycleProjection, LauncherSnapshot, LauncherState, LogRecord, OperationState, ProModelVersion, Surface } from "./types";

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
  const [logs, setLogs] = useState<LogRecord[]>([]);
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
      else setLogs((current) => [...current.slice(-299), record]);
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
      const unseenLogs = pendingLogs.filter(record => !next.logs.some(existing =>
        existing.at === record.at && existing.level === record.level && existing.event === record.event
          && JSON.stringify(existing.detail) === JSON.stringify(record.detail)));
      setLogs([...next.logs, ...unseenLogs].slice(-300));
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
      unsubscribeUpdate();
      unsubscribeLifecycle();
    };
  }, [startupAttempt, refreshMetadata, acceptLifecycle]);

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
            logs={logs}
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
  const [localBusy, setBusy] = useState(false);
  const busy = localBusy || Boolean(snapshot.lifecycle?.transition);
  const localized = copyFor(selectedLanguage);
  const isLanguage = stage === "language";
  const isInteraction = stage === "interaction";
  const stageIndex = isLanguage ? 0 : isInteraction ? 1 : 2;

  const chooseLanguage = async () => {
    if (busy) return;
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
    if (busy) return;
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
      lang={selectedLanguage}
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
            <div className="welcome-options" role="radiogroup" aria-label={localized.chooseLanguage} onKeyDown={handleRadioGroupKeys}>
              {(Object.entries(languages) as Array<[Language, { label: string; marker: string }]>).map(([code, option]) => (
                <WelcomeOption
                  active={selectedLanguage === code}
                  key={code}
                  label={option.label}
                  language={code}
                  marker={option.marker}
                  onClick={() => setSelectedLanguage(code)}
                />
              ))}
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
  catalogFailure,
  error,
  copy,
  language,
  logs,
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
  logs: LogRecord[];
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
              snapshot={snapshot} toolsReady={toolProof} logs={logs} navigate={navigateSurface}
              openTab={(tabId) => void openBrowserTab(tabId)} /> : null}
            {surface === "accounts" ? <ContentSurface title={copy.accountsTitle} subtitle={copy.accountsBody}>
              <AccountSettings copy={copy} language={language} openBrowser={() => navigateSurface("browser")}
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
              <TaskCenter tasks={browser?.tasks ?? []} language={language} disabled={transitionBusy}
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
              <ActivitySurface transitionBusy={transitionBusy} copy={copy} language={language} logs={logs} setError={setError} />
            ) : null}
            {surface === "updates" ? <Updates language={language} currentVersion={snapshot.version}
              state={snapshot.update} busy={updateBusy} blocked={updateBlocked} checking={updateCheckBusy}
              cooldown={updateCheckCooldown} error={updateError} transitionBusy={transitionBusy}
              onCheck={() => void recheckUpdate()} onInstall={() => void installUpdate()}
              cancelling={updateCancelPending} onCancel={() => void cancelUpdate()} /> : null}
            {surface === "settings" ? (
              <SettingsSurface
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

function BrowserSurface({
  accountSetup,
  browser,
  error,
  browserSlotRef,
  copy,
  interactionMode,
  language,
  transitionBusy,
  operation,
  platform,
  readiness,
  setError,
}: {
  accountSetup?: ReactNode;
  browser: BrowserState | null;
  error: string | null;
  browserSlotRef: (node: HTMLDivElement | null) => void;
  copy: Copy;
  interactionMode: BrowserInteractionMode;
  language: Language;
  transitionBusy: boolean;
  operation: OperationState | null;
  platform: string;
  readiness: WorkspaceReadiness;
  setError: (error: string | null) => void;
}) {
  const [passkeyStarting, setPasskeyStarting] = useState(false);
  const workflow = workflowCopy(language);
  const windowCopy = browserWindowCopy(language);
  const [passkeyRequestPending, setPasskeyRequestPending] = useState(false);
  const [existingChromeStarting, setExistingChromeStarting] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<{ id: string; traceId: string | null } | null>(null);
  const [closingTabs, setClosingTabs] = useState<Set<string>>(new Set());
  const closingTabRequests = useRef(new Set<string>());
  const confirmingTabRequests = useRef(new Set<string>());
  const [confirmingTabs, setConfirmingTabs] = useState<Set<string>>(new Set());
  const sessionRetryInFlight = useRef(false);
  const [sessionRetryBusy, setSessionRetryBusy] = useState(false);
  const activeBrowserTabs = browser?.tabs.filter(tab => ["running", "loading", "testing"].includes(tab.status)) ?? [];
  const recoverableBrowserTabs = browser?.tabs.filter(tab => !["error", "aborted"].includes(tab.status)) ?? [];
  const cancelTab = browser?.tabs.find(tab => tab.id === cancelTarget?.id
    && tab.traceId === cancelTarget?.traceId && tab.status === "running");
  useEffect(() => { if (cancelTarget && !cancelTab) setCancelTarget(null); }, [cancelTarget, cancelTab]);
  const visible = browser?.visible === true;
  const manualInteraction = interactionMode === "manual";
  const { navigationLocked: browserNavigationLocked, passkeyAvailable, passkeyWaiting, passkeyBlocked, passkeyCanImport,
    existingChromeAvailable, existingChromeWaiting, existingChromeBlocked } = browserControls(
    browser, operation, platform, interactionMode,
  );
  const navigationLocked = transitionBusy || browserNavigationLocked;
  const selectedManualTab = browser?.tabs.find(tab => tab.active && tab.interactionMode === "manual");
  const passkeyLabel = passkeyStarting || browser?.passkeyLogin?.phase === "starting" ? copy.passkeyStarting
    : !passkeyWaiting ? copy.passkeySignIn
    : passkeyCanImport ? copy.passkeyContinue
    : browser?.passkeyLogin?.phase === "verifying" ? copy.passkeyVerifying
    : browser?.passkeyLogin?.phase === "cancelling" ? copy.passkeyCancelling
    : copy.passkeyImporting;
  const passkeyActionDisabled = transitionBusy || passkeyBlocked || passkeyRequestPending
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
    if (transitionBusy && !visible) return;
    try {
      if (visible) await api!.hideBrowser();
      else await api!.showBrowser();
    } catch (cause) {
      setError(messageOf(cause));
    }
  };
  const selectTab = async (tabId: string) => {
    if (transitionBusy) return;
    try {
      await api!.selectBrowserTab(tabId);
    } catch (cause) {
      setError(messageOf(cause));
    }
  };
  const retrySession = async () => {
    if (sessionRetryInFlight.current || transitionBusy || browser?.navigationLocked || !browser?.accountId) return;
    sessionRetryInFlight.current = true;
    setSessionRetryBusy(true);
    setError(null);
    try {
      await api!.refreshAccountAuthentication(browser.accountId);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      sessionRetryInFlight.current = false;
      setSessionRetryBusy(false);
    }
  };
  const closeTab = async (tabId: string, expectedTraceId?: string | null) => {
    if (transitionBusy) return;
    if (closingTabRequests.current.has(tabId)) return;
    closingTabRequests.current.add(tabId);
    setClosingTabs(new Set(closingTabRequests.current));
    try {
      await api!.closeBrowserTab(tabId, expectedTraceId);
      setCancelTarget(current => current?.id === tabId && current.traceId === expectedTraceId ? null : current);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      closingTabRequests.current.delete(tabId);
      setClosingTabs(new Set(closingTabRequests.current));
    }
  };
  const openPasskeyLogin = async () => {
    if (passkeyActionDisabled || passkeyWaiting) return;
    setPasskeyStarting(true);
    setError(null);
    try {
      await api!.openPasskeyLogin();
    } catch (cause) {
      setError(passkeyFailureText(messageOf(cause), copy));
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
      const detail = messageOf(cause);
      setError(detail === "No passkey sign-in is waiting for Continue"
        ? copy.passkeyImporting
        : passkeyFailureText(detail, copy));
    } finally {
      setPasskeyRequestPending(false);
    }
  };
  const copyManualPrompt = async (tabId: string) => {
    if (transitionBusy) return;
    try {
      await api!.copyManualPrompt(tabId);
    } catch (cause) {
      setError(messageOf(cause));
    }
  };
  const confirmManualSent = async (tabId: string) => {
    if (transitionBusy || confirmingTabRequests.current.has(tabId)) return;
    confirmingTabRequests.current.add(tabId);
    setConfirmingTabs(new Set(confirmingTabRequests.current));
    try {
      await api!.confirmManualSent(tabId);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      confirmingTabRequests.current.delete(tabId);
      setConfirmingTabs(new Set(confirmingTabRequests.current));
    }
  };

  return (
    <section className="browser-surface">
      {accountSetup}
      {error ? <div className="browser-inline-error" role="alert">
        <p>{localizeLauncherError(copy, error)}</p>
        <button type="button" className="text-button" onClick={() => setError(null)}>{copy.dismiss}</button>
      </div> : null}
      {browser?.accountName ? <div className="browser-account-label">{copy.accountsCurrent}: {browser.accountName}</div> : null}
      <div className="browser-tab-strip" role="tablist" aria-label={copy.browser} title={copy.browserTabLimit}>
        {(browser?.tabs ?? []).map((tab) => (
          <div
            className={`browser-tab${tab.active ? " is-active" : ""}`}
            key={tab.id}
          >
            <button
              className="browser-tab-select"
              onClick={() => void selectTab(tab.id)}
              onKeyDown={(event) => {
                if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                  event.preventDefault();
                  const tabs = browser?.tabs ?? [];
                  const index = tabs.findIndex((candidate) => candidate.id === tab.id);
                  const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
                    : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
                  const next = tabs[nextIndex];
                  if (next) {
                    void selectTab(next.id);
                    event.currentTarget.closest('[role="tablist"]')
                      ?.querySelectorAll<HTMLElement>('[role="tab"]')[nextIndex]?.focus();
                  }
                }
              }}
              aria-disabled={transitionBusy}
              role="tab"
              aria-selected={tab.active}
              aria-label={`${browserTabTitleFromTitle(tab.title, copy)} — ${tab.status === "running" ? copy.running
                : tab.status === "loading" ? copy.loading : tab.status === "testing" ? copy.overviewRunTesting
                  : tab.status === "error" ? copy.failed : tab.status === "ready" ? copy.complete : copy.noActiveTask}`}
              tabIndex={tab.active ? 0 : -1}
              type="button"
            >
              <BrandMark small />
              {tab.loading ? <i className="tab-spinner" aria-hidden="true" /> : <StateDot state={browserTabTone(tab.status)} />}
              <span className="browser-tab-title" title={tab.traceId ? `${tab.title} · ${tab.traceId}` : tab.title}>
                {browserTabTitleFromTitle(tab.title, copy)}
              </span>
            </button>
            {tab.closable ? (
              <button
                aria-label={`${tab.status === "running" ? copy.manualPromptCancel : copy.hideTab}: ${browserTabTitleFromTitle(tab.title, copy)}`}
                disabled={transitionBusy || closingTabs.has(tab.id)}
                className={tab.status === "running" ? "browser-tab-cancel" : undefined}
                onClick={() => {
                  if (tab.status === "running") setCancelTarget({ id: tab.id, traceId: tab.traceId });
                  else void closeTab(tab.id, tab.traceId);
                }}
                title={tab.status === "running" ? copy.manualPromptCancel : copy.hideTab}
                type="button"
              >
                {closingTabs.has(tab.id) ? <i className="tab-spinner" aria-hidden="true" />
                  : <Icon name={tab.status === "running" ? "stop" : "close"} />}
              </button>
            ) : null}
          </div>
        ))}
        <div className="browser-tab-drag draggable" />
      </div>
      {cancelTab ? <div className="browser-cancel-confirm" role="alert">
        <div><strong>{copy.browserCancelTaskTitle}</strong>
          <p className="browser-cancel-target">{browserTabTitleFromTitle(cancelTab.title, copy)}</p>
          <p>{copy.browserCancelTaskBody}</p></div>
        <div className="browser-cancel-actions">
          <button type="button" className="button-secondary" autoFocus disabled={transitionBusy || closingTabs.has(cancelTab.id)} onClick={() => setCancelTarget(null)}>{copy.back}</button>
          <button type="button" className="button-secondary browser-confirm-cancel" disabled={transitionBusy || closingTabs.has(cancelTab.id)}
            aria-label={`${copy.manualPromptCancel}: ${browserTabTitleFromTitle(cancelTab.title, copy)}`}
            onClick={() => void closeTab(cancelTab.id, cancelTab.traceId)}>{closingTabs.has(cancelTab.id) ? copy.browserCancellingTask : copy.manualPromptCancel}</button>
        </div>
      </div> : null}
      <div className="browser-workspace-actions">
        <button type="button" className="text-button" disabled={transitionBusy}
          onClick={() => void api!.openBrowserWindow(false).catch(cause => setError(messageOf(cause)))}>{windowCopy.newWindow}</button>
        {platform === "darwin" ? <button type="button" className="text-button" disabled={transitionBusy}
          onClick={() => void api!.openBrowserWindow(true).catch(cause => setError(messageOf(cause)))}>{windowCopy.newTab}</button> : null}
        <span>{platform === "darwin" ? windowCopy.hint : windowCopy.tabsMacOnly}</span>
      </div>
      {browser?.workspaces ? <BrowserWorkspaceManager
        language={language}
        snapshot={browser.workspaces}
        selectedAccountId={browser.accountId}
        disabled={transitionBusy}
        onOpen={(accountId, asTab) => api!.openBrowserWorkspace(accountId, { asTab })}
        onRestore={accountId => api!.restoreBrowserWorkspaces(accountId)}
        onFocus={(accountId, workspaceId) => api!.focusBrowserWorkspace(accountId, workspaceId)}
        onClose={(accountId, workspaceId) => api!.closeBrowserWorkspace(accountId, workspaceId)}
      /> : null}
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
        <button disabled={transitionBusy && !visible} className="toolbar-text-button" onClick={() => void toggle()} type="button">
          {visible ? copy.hideBrowser : copy.openChatgpt}
        </button>
        {browser?.loading ? <i className="browser-loading-line" /> : null}
      </div>
      {!manualInteraction && browser?.existingChromeLogin ? (
        <ExistingChromeLoginGuide transitionBusy={transitionBusy} progress={browser.existingChromeLogin} copy={copy} language={language} onRetry={openExistingChromeLogin} setError={setError} />
      ) : !manualInteraction && browser?.passkeyLogin && browser.passkeyLogin.phase !== "completed" ? (
        <PasskeyLoginGuide transitionBusy={transitionBusy} progress={browser.passkeyLogin} copy={copy} language={language} onRetry={openPasskeyLogin} setError={setError} />
      ) : browser?.loginKind === "embedded" ? (
        <div className="browser-login-guide" role="status">
          <p>{passkeyAvailable ? copy.embeddedLoginPasskeyBody : copy.embeddedLoginBody}</p>
        </div>
      ) : null}
      {!manualInteraction && browser?.authenticationStatus === "unavailable" ? (
        <section className="browser-recovery-notice" aria-live="polite" data-testid="browser-session-recovery">
          <Icon name="alert" />
          <div>
            <strong>{workflow.session.verificationUnavailable}</strong>
            <p>{sessionIssueCopy(language, browser?.authenticationIssue)}</p>
            {browser.lastVerifiedAt ? <small>{workflow.session.lastVerifiedAt.replace("{time}", new Date(browser.lastVerifiedAt).toLocaleString(language))}</small> : null}
          </div>
          <div className="browser-recovery-actions">
            {recoverableBrowserTabs.length ? <button className="text-button" disabled={transitionBusy}
              onClick={() => void selectTab(recoverableBrowserTabs[0]!.id)} type="button">{copy.openWorkspace}</button> : null}
            <button className="button-secondary" disabled={sessionRetryBusy || transitionBusy || browser.navigationLocked || !browser.accountId}
              aria-busy={sessionRetryBusy} onClick={() => void retrySession()} type="button">
              {sessionRetryBusy ? workflow.session.checkingVerification : workflow.session.retryVerification}
            </button>
          </div>
        </section>
      ) : browser?.authenticated === true && (readiness.web === "degraded" || readiness.web === "unavailable") ? (
        <section className="browser-recovery-notice" aria-live="polite" data-testid="browser-web-recovery">
          <Icon name="alert" />
          <div><strong>{workflow.recovery.webTransportTitle}</strong><p>{readiness.native === "ready"
            ? workflow.recovery.webTransportBody : copy.localToolsUnavailableBody}</p>
            {readiness.native === "ready" ? <small>{workflow.recovery.nativePreserved}</small> : null}</div>
        </section>
      ) : null}
      {selectedManualTab
        && ["awaiting-user", "sent"].includes(selectedManualTab.manualState ?? "") ? (
        <ManualTurnGuide
          copy={copy}
          confirmPending={confirmingTabs.has(selectedManualTab.id)}
          transitionBusy={transitionBusy}
          onCancel={() => void closeTab(selectedManualTab.id, selectedManualTab.traceId)}
          onCopy={() => void copyManualPrompt(selectedManualTab.id)}
          onSent={() => void confirmManualSent(selectedManualTab.id)}
          tab={selectedManualTab}
        />
      ) : null}
      <div className="browser-viewport" ref={browserSlotRef}>
        {!visible ? (
          <div className="browser-empty">
            <BrandMark />
            <h1>{activeBrowserTabs.length ? `${activeBrowserTabs.length} · ${copy.overviewActiveRuns}` : manualInteraction
              ? copy.browserReady
              : browser?.authenticationStatus === "unavailable" ? workflow.session.verificationUnavailable
                : browser?.authenticated ? copy.noActiveTask : copy.stepAccount}</h1>
            <p>{activeBrowserTabs.length ? copy.overviewActiveRunsBody : manualInteraction
              ? copy.stepAccountBody
              : browser?.authenticationStatus === "unavailable" ? sessionIssueCopy(language, browser.authenticationIssue)
                : browser?.authenticated
              ? copy.noActiveTaskBody
              : existingChromeWaiting ? copy.existingChromeBody : passkeyWaiting ? copy.passkeyContinueBody : copy.stepAccountBody}</p>
            <div className="browser-empty-actions">
              {activeBrowserTabs.length ? <PrimaryButton disabled={transitionBusy} onClick={() => void selectTab(activeBrowserTabs[0].id)}>{copy.openWorkspace}</PrimaryButton> : null}
              {existingChromeAvailable && browser?.authenticationStatus !== "unavailable" ? <PrimaryButton
                disabled={existingChromeBlocked || existingChromeStarting || existingChromeWaiting}
                onClick={() => void openExistingChromeLogin()}>{copy.existingChromeSignIn}</PrimaryButton> : null}
              <SecondaryButton disabled={transitionBusy || passkeyWaiting || existingChromeWaiting} onClick={() => void toggle()}>
                {manualInteraction || browser?.authenticated || browser?.authenticationStatus === "unavailable" ? copy.openChatgpt : copy.signIn}
              </SecondaryButton>
              {passkeyAvailable && browser?.authenticationStatus !== "unavailable" ? (
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
  confirmPending,
  transitionBusy,
  onCancel,
  onCopy,
  onSent,
  tab,
}: {
  copy: Copy;
  confirmPending: boolean;
  transitionBusy: boolean;
  onCancel: () => void;
  onCopy: () => void;
  onSent: () => void;
  tab: BrowserState["tabs"][number];
}) {
  const headingId = useId();
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
    <section className={`manual-turn-guide${waiting ? " is-waiting" : ""}`} aria-labelledby={headingId}>
      <div>
        <strong id={headingId}>{waiting ? copy.manualPromptTitle : copy.manualPromptWaiting}</strong>
        {waiting ? <p>{copy.manualPromptInstruction}</p> : null}
      </div>
      <span className="manual-turn-status">{status}</span>
      <span className="visually-hidden" aria-live="polite">{waiting ? "" : status}</span>
      <div className="manual-turn-actions">
        <SecondaryButton disabled={transitionBusy} onClick={onCancel}>{copy.manualPromptCancel}</SecondaryButton>
        <SecondaryButton disabled={transitionBusy || !tab.canCopyPrompt} onClick={onCopy}>{copy.manualPromptCopy}</SecondaryButton>
        <PrimaryButton disabled={transitionBusy || confirmPending || !tab.canConfirmSent} onClick={onSent}>{confirmPending ? copy.running : waiting ? copy.manualPromptConfirmSent : copy.manualPromptSent}</PrimaryButton>
      </div>
    </section>
  );
}

function ActivitySurface({
  copy,
  transitionBusy,
  language,
  logs,
  setError,
}: {
  copy: Copy;
  transitionBusy: boolean;
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
      <UsageDashboard copy={copy} language={language} />
      <div className="section-heading activity-heading">
        <span>{copy.recentActivity}</span>
        <SecondaryButton
          icon="external"
          disabled={transitionBusy}
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

function WelcomeOption({
  active,
  label,
  language,
  marker,
  onClick,
}: {
  active: boolean;
  label: string;
  language: Language;
  marker: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-checked={active}
      className={`welcome-option${active ? " is-active" : ""}`}
      lang={language}
      onClick={onClick}
      role="radio"
      tabIndex={active ? 0 : -1}
      type="button"
    >
      <span>{marker}</span>
      <strong>{label}</strong>
      {active ? <Icon name="check" /> : null}
    </button>
  );
}

function IconButton({
  buttonRef,
  controls,
  disabled = false,
  expanded,
  icon,
  label,
  onClick,
}: {
  buttonRef?: RefObject<HTMLButtonElement | null>;
  controls?: string;
  disabled?: boolean;
  expanded?: boolean;
  icon: IconName;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-controls={controls}
      aria-expanded={expanded}
      aria-label={label}
      className="icon-button"
      disabled={disabled}
      onClick={onClick}
      ref={buttonRef}
      title={label}
      type="button"
    >
      <Icon name={icon} />
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
    : date.toLocaleTimeString(languages[language].locale, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
}
