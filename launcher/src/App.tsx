import type { CompactionModel } from "./types";
import { codexSettingsStatus, modelConnectionReadiness, setupNextStep } from "./setup-progress";
import languages from "../electron/languages.json";
import { BrandMark } from "./BrandMark";
import { Overview } from "./Overview";
import { AccountSettings } from "./AccountSettings";
import { UsageDashboard } from "./UsageDashboard";
import { Updates } from "./Updates";
import { updateCopyFor } from "./update-copy";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { native6CopyFor, copyFor, localizeRuntimeMessage, localizeLauncherError, type Copy } from "./i18n";
import { Icon, type IconName } from "./icons";
import { browserControls } from "./browser-controls";
import { RouteDiagnostics } from "./RouteDiagnostics";
import { PasskeyLoginGuide } from "./PasskeyLoginGuide";
import { ExistingChromeLoginGuide } from "./ExistingChromeLoginGuide";
import { passkeyFailureText } from "./passkey-copy";
import { availableChatGptWebModelRoutes, resolveChatGptWebContextLimits, resolveChatGptWebTransportLimits } from "../../src/chatgpt-web-models";
import "./connections.css";
import type {
  BrowserCapacitySettings,
  BrowserInteractionMode,
  BrowserState,
  DoctorReport,
  Language,
  LauncherLifecycle as LifecycleProjection,
  LauncherSnapshot,
  LauncherState,
  LogRecord,
  OperationState,
  ProModelVersion,
  RuntimeCapabilities as RuntimeCapabilitiesProjection,
  Surface,
} from "./types";

const api = window.codexWebLauncher;
const COMPACT_SIDEBAR_QUERY = "(max-width: 860px)";
const MCP_GUIDE_MEDIA = [
  new URL("./assets/mcp-create-tunnel.mp4", import.meta.url).href,
  new URL("./assets/mcp-connect-connector.mp4", import.meta.url).href,
  null,
] as const;

function smokePassedForState(state: LauncherState, version: string): boolean {
  return state.browserSmokePassed === true && state.browserSmokeVersion === version;
}

function connectorProofMismatch(snapshot: LauncherSnapshot): boolean {
  const verifiedName = snapshot.state.setupConnectorName;
  return typeof verifiedName === "string" && verifiedName !== snapshot.connectorName;
}

type ProjectedLauncherSnapshot = LauncherSnapshot;

type ProjectedLauncherApi = NonNullable<typeof api> & {
  onLifecycle?: (listener: (projection: LifecycleProjection) => void) => () => void;
};

function runtimeCapabilities(snapshot: LauncherSnapshot): RuntimeCapabilitiesProjection | null {
  const projected = snapshot as ProjectedLauncherSnapshot;
  return projected.runtimeCapabilities ?? projected.lifecycle ?? null;
}

function localToolsRuntimeReady(snapshot: LauncherSnapshot): boolean {
  return runtimeCapabilities(snapshot)?.tunnelStatus === "ready";
}

function currentToolProof(snapshot: LauncherSnapshot, operation: OperationState | null): boolean {
  return snapshot.state.mcpSetupComplete === true
    && !connectorProofMismatch(snapshot)
    && localToolsRuntimeReady(snapshot)
    && !(snapshot.profile === "production"
      && snapshot.state.browserInteractionMode === "automatic"
      && operation?.name === "runtime-start" && operation.status === "failed");
}

function handleRadioGroupKeys(event: ReactKeyboardEvent<HTMLElement>) {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  const radios = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]:not([aria-disabled="true"]):not(:disabled)')];
  if (!radios.length) return;
  const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[role="radio"]') : null;
  if (!target || !event.currentTarget.contains(target)) return;
  const current = radios.indexOf(target);
  if (current < 0) return;
  let next = current;
  if (event.key === "Home") next = 0;
  else if (event.key === "End") next = radios.length - 1;
  else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (next - 1 + radios.length) % radios.length;
  else next = (next + 1) % radios.length;
  event.preventDefault();
  radios[next]?.focus();
  radios[next]?.click();
}

function useModalFocus(
  active: boolean,
  container: RefObject<HTMLElement | null>,
  onClose: () => void,
  { closeAllowed = true, restoreFocus }: { closeAllowed?: boolean; restoreFocus?: RefObject<HTMLElement | null> } = {},
) {
  const close = useRef(onClose);
  const canClose = useRef(closeAllowed);
  close.current = onClose;
  canClose.current = closeAllowed;
  useEffect(() => {
    if (!active || !container.current) return;
    const modal = container.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const inerted = new Map<HTMLElement, boolean>();
    let branch: HTMLElement = modal;
    let parent = branch.parentElement;
    while (parent) {
      for (const element of parent.children) {
        if (element instanceof HTMLElement && element !== branch && !inerted.has(element)) {
          inerted.set(element, element.inert);
          element.inert = true;
        }
      }
      if (parent === document.body) break;
      branch = parent;
      parent = branch.parentElement;
    }
    const visible = (element: HTMLElement) => {
      if (element.hidden || element.closest("[inert]")) return false;
      const style = window.getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
    };
    const focusable = () => [...modal.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled), video[controls], [href], [tabindex]:not([tabindex="-1"])')].filter(visible);
    const focusFirst = () => {
      const preferred = modal.querySelector<HTMLElement>("[data-modal-autofocus]");
      (preferred && visible(preferred) && !preferred.matches(":disabled") ? preferred : focusable()[0] ?? modal).focus();
    };
    const frame = requestAnimationFrame(focusFirst);
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (canClose.current) close.current();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = focusable();
      if (!controls.length) { event.preventDefault(); modal.focus(); return; }
      const first = controls[0]!;
      const last = controls.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const focusin = (event: FocusEvent) => {
      if (event.target instanceof Node && modal.contains(event.target)) return;
      event.stopPropagation();
      focusFirst();
    };
    document.addEventListener("keydown", keydown, true);
    document.addEventListener("focusin", focusin, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", keydown, true);
      document.removeEventListener("focusin", focusin, true);
      for (const [element, inert] of inerted) element.inert = inert;
      const restore = restoreFocus?.current ?? previous;
      requestAnimationFrame(() => {
        const target = restore?.isConnected && !restore.closest("[inert]") && !restore.matches(":disabled")
          ? restore
          : document.querySelector<HTMLElement>('.sidebar-item[aria-current="page"]:not(:disabled)');
        target?.focus();
      });
    };
  }, [active, container, restoreFocus]);
}

export function App() {
  const [snapshot, setSnapshot] = useState<ProjectedLauncherSnapshot | null>(null);
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
      const fresh = await api!.snapshot() as ProjectedLauncherSnapshot;
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
      const next = rawNext as ProjectedLauncherSnapshot;
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
  const toolProof = currentToolProof(snapshot, operation);
  const interactionSetupComplete = modelReadiness === "available" && (!manualInteraction || toolProof);
  const firstRunZeroRiskSetup = snapshot.state.browserInteractionMode === "manual"
    && snapshot.state.coreSetupComplete !== true;
  const [surface, setSurface] = useState<Surface>(
    firstRunZeroRiskSetup ? "mcp" : "overview",
  );
  const devProfile = snapshot.profile === "development";
  const compactAtMount = useRef(window.matchMedia(COMPACT_SIDEBAR_QUERY).matches).current;
  const [sidebarOpen, setSidebarOpen] = useState(!compactAtMount);
  const [compactSidebar, setCompactSidebar] = useState(compactAtMount);
  const sidebar = useRef<HTMLElement>(null);
  const sidebarToggle = useRef<HTMLButtonElement>(null);
  const [browserSlot, setBrowserSlot] = useState<HTMLDivElement | null>(null);
  const browserSurfaceCommand = useRef(Promise.resolve());
  const browserSurfaceIntent = useRef(0);
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
      const intent = ++browserSurfaceIntent.current;
      await enqueueBrowserSurface(true, intent);
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
              <div className="sidebar-session"><StateDot state={manualInteraction ? "idle" : browser?.authenticated ? "ready" : "idle"} /><span>{manualInteraction ? copy.manualInteraction : browser?.authenticated ? copy.sessionConnected : copy.sessionDisconnected}</span></div>
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
                setError={setError} manual={snapshot.state.browserInteractionMode === "manual"} transitionBusy={transitionBusy} />
            </ContentSurface> : null}
            {surface === "browser" ? (
              <BrowserSurface
                browser={browser}
                browserSlotRef={browserSlotRef}
                copy={copy}
                interactionMode={snapshot.state.browserInteractionMode}
                transitionBusy={transitionBusy}
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
                catalogFailure={catalogFailure}
                devProfile={devProfile}
                operation={operation}
                setError={setError}
                showMcp={() => {
                  setMcpTargetMode(null);
                  setSurface("mcp");
                }}
                showActivity={() => setSurface("activity")}
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
                showSetup={() => setSurface("setup")}
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

        {sessionReminderDue && !biggerContextRecommendationOpen ? (
          <SessionRefreshReminder
            busy={sessionReminderBusy || transitionBusy}
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
      <div className="titlebar-location"><span>NEKODEX</span><span aria-hidden="true">/</span><strong>{({ overview: copy.overview, accounts: copy.accountsNav, browser: copy.browser, setup: copy.connectionsNav, mcp: copy.connectionsNav, activity: copy.activity, settings: copy.settings, updates: updateCopyFor(language).title })[surface]}</strong></div>
    </header>
  );
}

function ConnectionsTabs({
  active,
  copy,
  modelsReady,
  onModels,
  onTools,
  toolsReady,
}: {
  active: "models" | "tools";
  copy: Copy;
  modelsReady: boolean;
  onModels: () => void;
  onTools: () => void;
  toolsReady: boolean;
}) {
  const tab = (id: "models" | "tools", label: string, ready: boolean, onClick: () => void) => (
    <button aria-current={active === id ? "page" : undefined}
      className={active === id ? "is-active" : ""} onClick={onClick} type="button">
      <span>{label}</span>
      <small><StateDot state={ready ? "ready" : "idle"} />
        {ready ? copy.connectionVerified : copy.connectionPending}</small>
    </button>
  );
  return (
    <nav aria-label={copy.connectionsNav} className="connections-tabs">
      {tab("models", copy.modelsConnectionTab, modelsReady, onModels)}
      {tab("tools", copy.toolsConnectionTab, toolsReady, onTools)}
    </nav>
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
  transitionBusy,
  operation,
  platform,
  setError,
}: {
  browser: BrowserState | null;
  browserSlotRef: (node: HTMLDivElement | null) => void;
  copy: Copy;
  interactionMode: BrowserInteractionMode;
  transitionBusy: boolean;
  operation: OperationState | null;
  platform: string;
  setError: (error: string | null) => void;
}) {
  const [passkeyStarting, setPasskeyStarting] = useState(false);
  const [passkeyRequestPending, setPasskeyRequestPending] = useState(false);
  const [existingChromeStarting, setExistingChromeStarting] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<{ id: string; traceId: string | null } | null>(null);
  const [closingTabs, setClosingTabs] = useState<Set<string>>(new Set());
  const closingTabRequests = useRef(new Set<string>());
  const confirmingTabRequests = useRef(new Set<string>());
  const [confirmingTabs, setConfirmingTabs] = useState<Set<string>>(new Set());
  const activeBrowserTabs = browser?.tabs.filter(tab => ["running", "loading", "testing"].includes(tab.status)) ?? [];
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
              <span className="browser-tab-title" title={tab.traceId ? `${tab.title} · ${tab.traceId}` : tab.title}>
                {browserTabTitleFromTitle(tab.title, copy)}
              </span>
              {tab.loading ? <i className="tab-spinner" /> : <StateDot state={browserTabTone(tab.status)} />}
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
        <ExistingChromeLoginGuide transitionBusy={transitionBusy} progress={browser.existingChromeLogin} copy={copy} onRetry={openExistingChromeLogin} setError={setError} />
      ) : !manualInteraction && browser?.passkeyLogin && browser.passkeyLogin.phase !== "completed" ? (
        <PasskeyLoginGuide transitionBusy={transitionBusy} progress={browser.passkeyLogin} copy={copy} onRetry={openPasskeyLogin} setError={setError} />
      ) : browser?.loginKind === "embedded" ? (
        <div className="browser-login-guide" role="status">
          <p>{passkeyAvailable ? copy.embeddedLoginPasskeyBody : copy.embeddedLoginBody}</p>
        </div>
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
              : browser?.authenticated ? copy.noActiveTask : copy.stepAccount}</h1>
            <p>{activeBrowserTabs.length ? copy.overviewActiveRunsBody : manualInteraction
              ? copy.stepAccountBody
              : browser?.authenticated
              ? copy.noActiveTaskBody
              : existingChromeWaiting ? copy.existingChromeBody : passkeyWaiting ? copy.passkeyContinueBody : copy.stepAccountBody}</p>
            <div className="browser-empty-actions">
              {activeBrowserTabs.length ? <PrimaryButton disabled={transitionBusy} onClick={() => void selectTab(activeBrowserTabs[0].id)}>{copy.openWorkspace}</PrimaryButton> : null}
              {existingChromeAvailable ? <PrimaryButton
                disabled={existingChromeBlocked || existingChromeStarting || existingChromeWaiting}
                onClick={() => void openExistingChromeLogin()}>{copy.existingChromeSignIn}</PrimaryButton> : null}
              <SecondaryButton disabled={transitionBusy || passkeyWaiting || existingChromeWaiting} onClick={() => void toggle()}>
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

function SetupSurface({
  activateBrowser,
  browser,
  catalogFailure,
  copy,
  devProfile,
  operation,
  setError,
  showActivity,
  showMcp,
  snapshot,
  updateState,
}: {
  activateBrowser: (show?: boolean) => Promise<void>;
  browser: BrowserState | null;
  catalogFailure: string | null;
  copy: Copy;
  devProfile: boolean;
  operation: OperationState | null;
  setError: (error: string | null) => void;
  showActivity: () => void;
  showMcp: () => void;
  snapshot: LauncherSnapshot;
  updateState: (state: LauncherState) => void;
}) {
  const [localBusy, setLocalBusy] = useState(false);
  const [hermesAdded, setHermesAdded] = useState(false);
  const verifiedAt = snapshot.state.setupVerifiedAt ? Date.parse(snapshot.state.setupVerifiedAt) : Number.NaN;
  const manualInteraction = snapshot.state.browserInteractionMode === "manual";
  const models = modelConnectionReadiness({ manual: manualInteraction,
    installed: snapshot.state.coreSetupComplete === true,
    catalogVerified: snapshot.state.codexCatalogVerified === true,
    pickerConfirmed: snapshot.state.codexPickerConfirmed === true,
    development: devProfile });
  const catalogPending = models === "catalog-pending";
  const pickerReady = models === "available";
  const confirmPending = models === "picker-pending";
  const pendingContext = typeof snapshot.state.pendingBiggerContext === "boolean";
  const troubleshooting = useRef<HTMLDetailsElement>(null);
  const accountSignInChoices = useRef<HTMLDivElement>(null);
  const toolsVerified = currentToolProof(snapshot, operation);
  const nextStep = setupNextStep({ manual: manualInteraction, signedIn: browser?.authenticated === true,
    smokePassed: snapshot.smokePassed, installed: snapshot.state.coreSetupComplete === true,
    catalogVerified: snapshot.state.codexCatalogVerified === true, pickerConfirmed: snapshot.state.codexPickerConfirmed === true,
    toolsInstalled: snapshot.state.mcpRuntimeInstalled === true && snapshot.mcpCredentialsConfigured,
    toolsVerified, development: devProfile });
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
  const showAccountSignInChoices = () => {
    accountSignInChoices.current?.scrollIntoView({ block: "center" });
    accountSignInChoices.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  };
  const readyTitle = manualInteraction ? copy.manualSetupReady
    : toolsVerified ? copy.setupChecksPassed : copy.setupReadyModels;
  const readyBody = manualInteraction ? copy.manualSetupReadyBody
    : toolsVerified ? copy.connectorAvailableNotExecuted : copy.setupUseCodex;
  const nextTitle = { "sign-in": copy.stepAccount, test: copy.stepSmoke, install: copy.stepInstall,
    catalog: copy.setupCatalogTitle, confirm: copy.setupConfirmTitle, tools: copy.localTools,
    ready: readyTitle }[nextStep];
  const nextBody = { "sign-in": copy.stepAccountBody, test: copy.stepSmokeBody, install: copy.stepInstallBody,
    catalog: copy.setupCatalogBody, confirm: copy.setupConfirmBody, tools: copy.mcpBody,
    ready: readyBody }[nextStep];
  const nextLabel = { "sign-in": copy.next, test: copy.runSmoke, install: copy.install,
    catalog: copy.diagnostics, confirm: copy.confirmPicker, tools: copy.configureMcp,
    ready: copy.openWorkspace }[nextStep];
  const nextAction = () => {
    if (nextStep === "sign-in") showAccountSignInChoices();
    else if (nextStep === "test") void smoke();
    else if (nextStep === "install") void install();
    else if (nextStep === "confirm") void confirmModels();
    else if (nextStep === "catalog") showTroubleshooting();
    else if (nextStep === "tools") showMcp();
    else void activateBrowser().catch(cause => setError(messageOf(cause)));
  };

  return (
    <ContentSurface
      eyebrow={nextStep === "ready" ? copy.connectionVerified : copy.required}
      subtitle={devProfile
        ? copy.devSetupSubtitle
        : manualInteraction ? copy.manualInteractionBody : copy.setupSubtitle}
      title={nextStep === "ready" ? copy.modelsConnectionTab : devProfile ? copy.devSetupTitle : copy.setupTitle}
    >
      <ConnectionsTabs active="models" copy={copy} modelsReady={pickerReady}
        onModels={() => {}} onTools={showMcp} toolsReady={toolsVerified} />
      {manualInteraction ? <NoticeRow icon="info" tone="success">{copy.manualInteractionBody}</NoticeRow> : null}
      {!manualInteraction && catalogFailure ? (
        <section className="connection-inline-failure" aria-labelledby="catalog-failure-title">
          <Icon name="alert" />
          <div><strong id="catalog-failure-title">{copy.catalogUnavailable}</strong><p>{copy.catalogFailureKeptInstall}</p></div>
          <button className="button-secondary" onClick={showTroubleshooting} type="button">{copy.openRoutingChecks}</button>
        </section>
      ) : null}
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
            rowRef={accountSignInChoices}
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
        <RouteDiagnostics disabled={busy} language={snapshot.state.language ?? "en"}
          onActionError={cause => setError(messageOf(cause))}
          onExport={() => api!.exportLogs()} onViewActivity={showActivity}
          readReport={() => api!.routeDiagnostics()} />
        {snapshot.state.coreSetupComplete ? <button className="button-secondary" type="button" disabled={busy} onClick={() => void install()}>{copy.setupRepair}</button> : null}
      </details>

      <SectionHeading label={copy.localTools} meta={manualInteraction ? copy.required : copy.optional} spaced />
      {Number.isFinite(verifiedAt) ? (
        <p>{copy.lastConnectorVerification.replace("{time}", new Date(verifiedAt).toLocaleString(snapshot.state.language ?? "en"))}</p>
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
        <em>{toolsVerified ? copy.mcpReady : copy.configureMcp}</em>
        <Icon name="chevron" />
      </button>
      {!devProfile && !manualInteraction ? <>
        <details className="setup-troubleshooting"><summary>Hermes <small>{copy.optional}</small><Icon name="chevron" /></summary>
        <div className="setup-overview">
          <strong>{copy.hermesTitle}</strong>
          <p>{copy.hermesBody}</p>
          <PrimaryButton disabled={localBusy || !snapshot.state.mcpRuntimeInstalled} onClick={() => void addHermes()}>{hermesAdded ? copy.hermesUpdate : copy.hermesAdd}</PrimaryButton>
          <p role="status">{hermesAdded ? copy.hermesAdded : !toolsVerified ? copy.hermesPending : copy.hermesChoose}</p>
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
  showSetup,
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
  showSetup: () => void;
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
  const wizardHeading = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef(step);
  const verified = !configuringInactiveMode && currentToolProof(snapshot, operation);
  const manualInteraction = interactionMode === "manual";
  const steps = useMemo(() => [
    { title: copy.mcpStepOne, body: copy.mcpStepOneBody },
    { title: copy.mcpStepTwo, body: copy.mcpStepTwoBody },
    {
      title: copy.mcpStepThree,
      body: manualInteraction ? copy.manualMcpStepThreeBody : null,
    },
  ], [copy, manualInteraction]);
  const guideMedia = MCP_GUIDE_MEDIA[step];
  const recommendedConnectorName = (snapshot as ProjectedLauncherSnapshot)
    .recommendedConnectorNames?.[interactionMode]?.trim() ?? "";
  const retainedTargetName = snapshot.connectorNames[interactionMode]?.trim() ?? "";
  const targetConnectorName = recommendedConnectorName
    || (manualInteraction || snapshot.state.experimentalAsyncToolOperations ? retainedTargetName : "");
  const currentConnectorName = retainedTargetName;
  const connectorIdentityAvailable = targetConnectorName.length > 0;
  const exactConnectorVerified = verified
    && snapshot.state.setupConnectorName === targetConnectorName;
  const native6UpgradeAvailable = !manualInteraction
    && (recommendedConnectorName
      ? currentConnectorName !== recommendedConnectorName
      : snapshot.state.experimentalAsyncToolOperations !== true);
  const connectorConfiguredForTarget = connectorIdentityAvailable && !native6UpgradeAvailable;

  const setAsyncConnectorIdentity = async (enabled: boolean) => {
    if (busy) return;
    setLocalBusy(true);
    setError(null);
    try {
      updateState(await api!.setAsyncToolOperations(enabled));
      await updateSnapshot();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setLocalBusy(false);
    }
  };

  useEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    requestAnimationFrame(() => wizardHeading.current?.focus());
  }, [step]);

  const move = async (next: number) => {
    const state = await api!.setMcpStep(next);
    updateState(state);
    setStep(next);
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
      try {
        await updateSnapshot();
      } catch (cause) {
        // setupMcp has already committed; a stale metadata read must not make
        // the committed setup look like an installation failure.
        setError(messageOf(cause));
      }
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
      <ConnectionsTabs active="tools" copy={copy}
        modelsReady={modelConnectionReadiness({ manual: manualInteraction,
          installed: snapshot.state.coreSetupComplete === true,
          catalogVerified: snapshot.state.codexCatalogVerified === true,
          pickerConfirmed: snapshot.state.codexPickerConfirmed === true,
          development: devProfile }) === "available"}
        onModels={showSetup} onTools={() => {}} toolsReady={verified} />
      {!manualInteraction && !configuringInactiveMode && !snapshot.state.codexCatalogVerified ? (
        <NoticeRow icon="setup" tone="warning">{copy.mcpCatalogRequired}</NoticeRow>
      ) : null}

      <div className="wizard-stepper" aria-label={`${copy.localTools}: ${step + 1} / 3`} role="group">
        {steps.map((item, index) => (
          <button
            className={`${index === step ? "is-active" : ""}${index < step || (index === 2 && verified) ? " is-complete" : ""}`}
            aria-label={`${index + 1}. ${item.title}`}
            aria-current={index === step ? "step" : undefined}
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

      <div aria-busy={busy} className="mcp-stage">
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
                <h2 ref={wizardHeading} tabIndex={-1}>{steps[step]!.title}</h2>
                {step === 2 && !manualInteraction ? <div className="connector-instructions">
                  <ol>
                    {[copy.mcpStepThreeStepOne, copy.mcpStepThreeStepTwo, copy.mcpStepThreeStepThree]
                      .map(instruction => <li key={instruction}>{instruction}</li>)}
                  </ol>
                  <p>{copy.mcpStepThreePermissions}</p>
                </div> : <p>{steps[step]!.body}</p>}
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
                      aria-describedby="mcp-credentials-hint"
                      aria-invalid={Boolean(tunnelId && !tunnelId.trim())}
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
                      aria-describedby="mcp-credentials-hint"
                      aria-invalid={Boolean(runtimeKey && !runtimeKey.trim())}
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
            <p className="mcp-step-two-hint" id="mcp-credentials-hint">
                {manualInteraction || configuringInactiveMode || snapshot.state.codexCatalogVerified
                  ? copy.mcpStepTwoHint
                  : copy.mcpCatalogRequired}
              </p>
            ) : null}
        {step === 2 ? (
              <div className="connector-actions">
                {!manualInteraction && !verified && ["Codex Native6", "Codex Native6 DEV"].includes(snapshot.connectorNames[interactionMode]) ? (
                  <NoticeRow icon="alert" tone="warning">
                    {native6CopyFor(language).body.replace("{connector}", snapshot.connectorNames[interactionMode])}
                  </NoticeRow>
                ) : <details className="connector-upgrade-help"><summary>{copy.connectorUpgradeHelp}</summary>
                  <NoticeRow icon="alert" tone="warning">
                    {manualInteraction ? copy.manualConnectorNotice : native6CopyFor(language).retained}
                  </NoticeRow>
                  {!manualInteraction && snapshot.state.experimentalAsyncToolOperations ? (
                    <button className="button-secondary" disabled={busy}
                      onClick={() => void setAsyncConnectorIdentity(false)} type="button">
                      {native6CopyFor(language).compatibility}
                    </button>
                  ) : null}
                </details>}
                {!configuringInactiveMode && connectorProofMismatch(snapshot)
                  ? <NoticeRow icon="alert" tone="warning">{native6CopyFor(language).mismatch}</NoticeRow> : null}
                {native6UpgradeAvailable ? <div className="connector-upgrade-action">
                  <p>{recommendedConnectorName
                    ? native6CopyFor(language).body.replace("{connector}", recommendedConnectorName)
                    : native6CopyFor(language).title}</p>
                  <PrimaryButton disabled={busy} onClick={() => void setAsyncConnectorIdentity(true)}>
                    {native6CopyFor(language).upgrade}
                  </PrimaryButton>
                </div> : null}
                <div className="connector-identity-card">
                  <div>
                    <span>{copy.currentSavedConnector}</span>
                    <code>{currentConnectorName || copy.connectorIdentityUnavailable}</code>
                  </div>
                  <label>
                    <span>{copy.createConnectorIdentity}</span>
                    <input aria-label={copy.createConnectorIdentity} readOnly
                      onFocus={event => event.currentTarget.select()}
                      value={targetConnectorName || copy.connectorIdentityUnavailable} />
                  </label>
                  <p className="connector-identity-warning"><Icon name="alert" />{copy.newConnectorRequired}</p>
                  <p className={`connector-verification-status${exactConnectorVerified ? " is-ready" : ""}`} role="status">
                    <StateDot state={exactConnectorVerified ? "ready" : "idle"} />
                    {exactConnectorVerified ? copy.connectorVerified : copy.connectorNotVerified}
                  </p>
                </div>
                <div className="inline-actions">
                  {snapshot.urls.developerMode ? <SecondaryButton icon="external"
                    onClick={() => void openExternal(snapshot.urls.developerMode!)}>{copy.openDeveloperMode}</SecondaryButton> : null}
                  <SecondaryButton
                    disabled={!connectorConfiguredForTarget}
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
              || ((!credentialsConfigured || replacingCredentials) && (!tunnelId.trim() || !runtimeKey.trim()))
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
              disabled={busy || !connectorConfiguredForTarget}
              onClick={() => void (verified ? onDone() : verify())}
            >
              {busy
                ? operation?.name === "mcp-verification" && operation.status === "running"
                  ? localizeRuntimeMessage(copy, operation.message, undefined, language)
                  : copy.running
                : verified ? copy.done : native6CopyFor(language).verify}
            </PrimaryButton>
          </>
        ) : null}
      </div>
    </ContentSurface>
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

function SettingsSurface({
  browser,
  catalogFailure,
  showModelSetup,
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
  updateCompactionModel,
  updateState,
}: {
  browser: BrowserState | null;
  catalogFailure: string | null;
  showModelSetup: () => void;
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
  updateCompactionModel: (value: CompactionModel | null) => void;
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
  const [localBusy, setBusy] = useState(false);
  const busy = localBusy || Boolean(snapshot.lifecycle?.transition);
  const [turnsCancelled, setTurnsCancelled] = useState(false);
  const [integrationRemoved, setIntegrationRemoved] = useState(false);
  const codexStatus = codexSettingsStatus(snapshot.state, devProfile, Boolean(catalogFailure));
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
  const setSkillAttachments = async (enabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      updateState(await api!.setSkillAttachments(enabled));
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
      <SectionHeading label={copy.executionSettings} />
      <div className="settings-list">
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
        <SettingRow body={copy.manualSubmitTimeBody} label={copy.manualSubmitTime}>
          <select className="settings-select" aria-label={copy.manualSubmitTime} disabled={busy}
            value={snapshot.state.manualSubmitTimeoutSec ?? 120}
            onChange={event => void savePreference(() => api!.setPreference("manualSubmitTimeoutSec", Number(event.target.value)))}>
            {[30, 60, 120, 180, 300, 600].map(seconds => <option key={seconds} value={seconds}>{seconds} s</option>)}
          </select>
        </SettingRow>
        <SettingRow body={copy.showDuringTurnsBody} label={copy.showDuringTurns}>
          <Switch
            label={copy.showDuringTurns}
            checked={snapshot.state.showBrowserDuringTurns}
            disabled={busy || snapshot.state.browserInteractionMode === "manual"}
            onChange={(checked) => void savePreference(() => api!.setPreference("showBrowserDuringTurns", checked))}
          />
        </SettingRow>

        <SectionHeading label={copy.connectionsNav} spaced />
        <SettingRow label={copy.toolsConnectionTab} body={copy.mcpBody}>
          <button className="button-primary" type="button" disabled={busy}
            onClick={() => configureInteractionMode(snapshot.state.browserInteractionMode)}>
            {copy.manageToolsConnection}
          </button>
        </SettingRow>

        <SectionHeading label={copy.modelsAndContextSettings} spaced />
        <SettingRow body={copy.compactionModelBody} label={copy.compactionModel}>
          <select className="settings-select" aria-label={copy.compactionModel}
            disabled={proModelBusy || !snapshot.state.coreSetupComplete || snapshot.state.browserInteractionMode === "manual"}
            value={snapshot.compactionModel ?? "follow"}
            onChange={event => {
              const value = event.target.value === "follow" ? null : event.target.value as CompactionModel;
              setBusy(true); setError(null);
              void api!.setCompactionModel(value).then(result => updateCompactionModel(result.compactionModel))
                .catch(cause => setError(messageOf(cause))).finally(() => setBusy(false));
            }}>
            <option value="follow">{copy.compactionFollow}</option>
            <option value="extra-high">GPT-5.6 Extra High</option>
            <option value="5.6-pro">GPT-5.6 Pro</option>
            <option value="5.5-pro">GPT-5.5 Pro</option>
          </select>
        </SettingRow>
        <SettingRow body={copy.proModelVersionBody} label={copy.proModelVersion}>
          <ProModelVersionMenu
            copy={copy}
            disabled={proModelBusy || snapshot.state.coreSetupComplete !== true}
            onChange={(value) => void setProModelVersion(value)}
            value={snapshot.proModelVersion}
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
        <SettingRow body={snapshot.state.browserInteractionMode === "manual"
          ? copy.manualSkillAttachmentsUnavailable : copy.skillAttachmentsBody} label={copy.skillAttachments}>
          <Switch
            label={copy.skillAttachments}
            checked={snapshot.state.experimentalSkillAttachments}
            disabled={busy || snapshot.state.browserInteractionMode === "manual" || !snapshot.state.coreSetupComplete}
            onChange={(checked) => void setSkillAttachments(checked)}
          />
        </SettingRow>
        <SettingRow body={copy.webSubagentsBody} label={copy.webSubagents}>
          <Switch label={copy.webSubagents} checked={snapshot.state.allowWebSubagents}
            disabled={proModelBusy || !snapshot.state.coreSetupComplete}
            onChange={enabled => void savePreference(() => api!.setWebSubagents(enabled))} />
        </SettingRow>
        <SettingRow body={copy.freshConversationBody} label={copy.freshConversation}>
          <Switch label={copy.freshConversation} checked={snapshot.state.experimentalFreshConversationPerTurn}
            disabled={busy || snapshot.state.browserInteractionMode === "manual" || !snapshot.state.coreSetupComplete}
            onChange={enabled => void savePreference(() => api!.setFreshConversation(enabled))} />
        </SettingRow>
        <p role="status">{snapshot.state.experimentalBiggerContext ? copy.contextActiveBigger : copy.contextActiveStandard}</p>
        <ContextBudgetTable snapshot={snapshot} copy={copy} />
        {typeof snapshot.state.pendingBiggerContext === "boolean" ? <div role="status">
          <p>{snapshot.state.contextChangeApplying ? copy.contextApplying : snapshot.state.contextChangeError ? copy.contextFailed : copy.contextWaiting}</p>
          {snapshot.state.contextChangeError ? <p>{snapshot.state.contextChangeError}</p> : null}
          <button className="secondary-button" type="button" disabled={localBusy || snapshot.state.contextChangeApplying}
            onClick={() => void api!.cancelContextChange().then(updateState).catch(cause => setError(messageOf(cause)))}>{copy.cancelContextChange}</button>
          {snapshot.state.contextChangeError ? <button className="secondary-button" type="button" disabled={busy}
            onClick={() => void setBiggerContext(snapshot.state.pendingBiggerContext!)}>{copy.retryContextChange}</button> : null}
        </div> : null}
        </details>

        <SectionHeading label={copy.applicationSettings} spaced />
        {!devProfile ? <SettingRow body={copy.launchAtLoginBody} label={copy.launchAtLogin}>
          <Switch
            label={copy.launchAtLogin}
            checked={snapshot.state.autoStart}
            disabled={busy}
            onChange={(checked) => void savePreference(async () => (await api!.setAutostart(checked)).state)}
          />
        </SettingRow> : null}
        <SettingRow body={devProfile ? copy.devKeepRunningBody : copy.keepRunningOnCloseBody} label={copy.keepRunningOnClose}>
          <Switch
            label={copy.keepRunningOnClose}
            checked={snapshot.state.keepRunningOnClose}
            disabled={busy}
            onChange={(checked) => void savePreference(() => api!.setPreference("keepRunningOnClose", checked))}
          />
        </SettingRow>
        <SettingRow body={copy.passkeyBrowserBody} label={copy.passkeyBrowser}>
          <select className="settings-select" aria-label={copy.passkeyBrowser} value={snapshot.state.passkeyBrowser ?? "chrome"}
            disabled={busy || operation?.status === "running"}
            onChange={event => void savePreference(() => api!.setPreference("passkeyBrowser", event.target.value as "chrome" | "firefox"))}>
            <option value="chrome">Google Chrome</option><option value="firefox">Firefox</option>
          </select>
        </SettingRow>
        <SettingRow body={copy.chooseLanguageHint} label={copy.language}>
          <LanguageMenu disabled={busy} copy={copy} language={language} onChange={(next) => void updateLanguage(next)} />
        </SettingRow>
      </div>

      {codexStatus ? <section className="codex-settings-status" aria-label={copy.modelsConnectionTab}>
        <div role="status"><strong>{codexStatus === "picker" ? copy.setupConfirmTitle
          : codexStatus === "catalog-error" ? copy.catalogUnavailable
          : codexStatus === "catalog" ? copy.setupCatalogTitle
          : codexStatus === "removed" ? copy.integrationRemoved : copy.codexSettingsSaved}</strong>
          <p>{codexStatus === "picker" ? copy.setupConfirmBody
            : codexStatus === "catalog-error" ? copy.catalogFailureKeptInstall
            : codexStatus === "removed" ? copy.codexIntegrationRemovedBody
            : codexStatus === "manual-refresh" ? copy.codexManualRefreshBody : copy.setupCatalogBody}</p>
        </div>
        <SecondaryButton onClick={showModelSetup}>{copy.openModelSettings}</SecondaryButton>
      </section> : null}

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
  rowRef,
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
  rowRef?: RefObject<HTMLDivElement | null>;
  secondaryAction?: string;
  secondaryDisabled?: boolean;
  title: string;
  titleAction?: ReactNode;
}) {
  return (
    <div className={`setup-row${complete ? " is-complete" : ""}`} ref={rowRef}>
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
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const selectedRadio = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (busy) setOpen(false); }, [busy]);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => selectedRadio.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);
  const closeMenu = () => {
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus());
  };
  const choose = (enabled: boolean) => {
    if (busy) return;
    closeMenu();
    if (enabled !== proEnabled) onChange(enabled);
  };

  return (
    <div
      className={`zero-risk-model-menu${open ? " is-open" : ""}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") closeMenu();
      }}
    >
      <button
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={copy.zeroRiskModelSettings}
        className="zero-risk-model-trigger"
        disabled={busy}
        onClick={() => setOpen((current) => !current)}
        ref={trigger}
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
            onClick={closeMenu}
            tabIndex={-1}
            type="button"
          />
          <div
            aria-label={copy.zeroRiskModelSettings}
            className="zero-risk-model-panel"
            id={panelId}
            onKeyDown={handleRadioGroupKeys}
            role="radiogroup"
          >
            <p>{copy.zeroRiskModelSettingsBody}</p>
            <div className="zero-risk-model-option-row">
              <button
                aria-checked={!proEnabled}
                className={!proEnabled ? "is-selected" : ""}
                disabled={busy}
                onClick={() => choose(false)}
                ref={!proEnabled ? selectedRadio : undefined}
                role="radio"
                tabIndex={!proEnabled ? 0 : -1}
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
                disabled={busy}
                onClick={() => choose(true)}
                ref={proEnabled ? selectedRadio : undefined}
                role="radio"
                tabIndex={proEnabled ? 0 : -1}
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
  const expandedDialog = useRef<HTMLDivElement>(null);
  const expandedAt = useRef(0);

  const closeExpanded = () => {
    const currentTime = expandedVideo.current?.currentTime;
    if (inlineVideo.current && Number.isFinite(currentTime)) {
      inlineVideo.current.currentTime = currentTime ?? 0;
    }
    setExpanded(false);
  };
  useModalFocus(expanded, expandedDialog, closeExpanded);

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
          ref={expandedDialog}
          role="dialog"
          tabIndex={-1}
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
            className="guide-media-close"
            data-modal-autofocus
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
      onKeyDown={handleRadioGroupKeys}
      role="radiogroup"
    >
      <button
        aria-checked={mode === "automatic"}
        className={mode === "automatic" ? "is-selected" : ""}
        disabled={disabled}
        onClick={() => onChange("automatic")}
        role="radio"
        tabIndex={mode === "automatic" ? 0 : -1}
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
        tabIndex={mode === "manual" ? 0 : -1}
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
  label,
  marker,
  onClick,
}: {
  active: boolean;
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
      tabIndex={active ? 0 : -1}
      type="button"
    >
      <span>{marker}</span>
      <strong>{label}</strong>
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

function LanguageMenu({ copy, language, onChange, disabled = false }: { disabled?: boolean; copy: Copy; language: Language; onChange: (language: Language) => void }) {
  const options: Array<{ label: string; value: Language }> =
    (Object.entries(languages) as Array<[Language, { label: string }]>).map(([value, { label }]) => ({ label, value }));
  return <label className="language-menu">
    <span className="visually-hidden">{copy.language}</span>
    <select disabled={disabled} aria-label={copy.language} className="language-menu-trigger" value={language}
      onChange={event => onChange(event.target.value as Language)}>
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </label>;
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
    : date.toLocaleTimeString(languages[language].locale, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
}
