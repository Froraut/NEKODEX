import type { LauncherLogStore } from './launcher-log-store';
import { sessionIssueCopy } from "./session-issue-copy";
import { browserTabTitleFromTitle } from "./BrowserSurface";
import { humanEvent } from "./log-format";
import { useId, useSyncExternalStore } from "react";
import type { Copy } from "./i18n";
import { deriveWorkspaceReadiness, type WorkspaceAction } from "./workspace-readiness";
import { modelConnectionReadiness } from "./setup-progress";
import { workflowCopy } from "./workflow-copy";
import { overviewCopy } from "./overview-copy";
import { NetworkIssueNotice } from "./NetworkIssueNotice";
import {
  Button, ConnectionRow, EmptyState, EventList, Hero, Page, Panel, Stat, StatGroup, SurfaceHeader,
  type EventItem, type IconName,
} from "./design";
import type { BrowserState, LauncherSnapshot, Surface } from "./types";

export function Overview({ copy, browser, catalogFailure, snapshot, toolsReady, logStore, navigate, openTab, onMuteNetworkNotice }: {
  copy: Copy; browser: BrowserState | null; snapshot: LauncherSnapshot;
  catalogFailure: string | null;
  toolsReady: boolean;
  logStore: LauncherLogStore; navigate: (surface: Surface) => void; openTab: (tabId: string) => void;
  onMuteNetworkNotice?: () => Promise<void>;
}) {
  const logs = useSyncExternalStore(logStore.subscribe, logStore.getSnapshot);
  const overviewId = useId();
  const workflow = workflowCopy(snapshot.state.language ?? "en");
  const manual = snapshot.state.browserInteractionMode === "manual";
  const catalogUnavailable = !manual && Boolean(catalogFailure);
  const signedIn = browser?.authenticated === true;
  const authenticationStatus = browser?.authenticationStatus
    ?? (signedIn ? "verified" : browser?.status === "signed-out" ? "signed-out" : "unknown");
  const accountVerified = authenticationStatus === "verified";
  const runtime = snapshot.runtimeCapabilities ?? snapshot.lifecycle;
  const readiness = deriveWorkspaceReadiness({
    manual,
    authenticationStatus,
    catalogUnavailable,
    smokePassed: snapshot.smokePassed,
    installed: snapshot.state.coreSetupComplete === true,
    catalogVerified: snapshot.state.codexCatalogVerified === true,
    pickerConfirmed: snapshot.state.codexPickerConfirmed === true,
    toolsInstalled: snapshot.state.mcpRuntimeInstalled === true && snapshot.mcpCredentialsConfigured,
    toolsVerified: toolsReady,
    development: snapshot.profile === "development",
    runtime: runtime ? { ...runtime, transitionActive: Boolean(snapshot.lifecycle?.transition) }
      : { transitionActive: Boolean(snapshot.lifecycle?.transition) },
  });
  const activeTabs = browser?.tabs.filter(tab => tab.id !== "home" && ["running", "loading", "testing"].includes(tab.status)) ?? [];
  const active = activeTabs.length;
  const runStatus = (status: BrowserState["tabs"][number]["status"]) => status === "running"
    ? copy.overviewRunRunning : status === "testing" ? copy.overviewRunTesting : copy.overviewRunLoading;
  const modelReadiness = modelConnectionReadiness({
    manual,
    installed: snapshot.state.coreSetupComplete === true,
    catalogVerified: snapshot.state.codexCatalogVerified === true,
    pickerConfirmed: snapshot.state.codexPickerConfirmed === true,
    development: snapshot.profile === "development",
  });
  const modelsReady = modelReadiness === "available";
  const modelStatus = catalogUnavailable ? copy.catalogUnavailable
    : modelsReady ? (manual ? copy.setupInstalledTitle : copy.connectionVerified)
      : modelReadiness === "catalog-pending" ? copy.modelsWaitingShort
        : modelReadiness === "picker-pending" ? copy.modelsConfirmShort : copy.connectionPending;
  const toolsError = readiness.tools === "degraded"
    || (readiness.tools === "unavailable" && readiness.action === "open-tools");
  const connections: Array<{ error?: boolean; icon: IconName; label: string; ready: boolean; surface: Surface; status: string }> = [
    { icon: "accounts", label: copy.accountConnection, ready: manual || accountVerified, surface: "accounts",
      status: manual ? copy.manualShort : accountVerified ? copy.connectionVerified
        : authenticationStatus === "unavailable" ? workflow.session.verificationUnavailable
          : authenticationStatus === "unknown" ? workflow.session.checkingVerification : copy.signInNeededShort },
    { error: catalogUnavailable, icon: "setup", label: copy.modelsConnectionTab, ready: modelsReady && !catalogUnavailable,
      surface: "setup", status: modelStatus },
    { error: toolsError, icon: "mcp", label: copy.toolsConnectionTab,
      ready: readiness.tools === "ready", surface: "mcp",
      status: toolsError
        ? copy.localToolsUnavailable : toolsReady ? copy.connectorVerified : copy.connectorNotVerified },
  ];
  const actionSurface: Partial<Record<WorkspaceAction, Surface>> = {
    "retry-session": "accounts", "open-accounts": "accounts", "open-setup": "setup",
    "open-tools": "mcp", "repair-web": "mcp", "open-browser": "browser",
  };
  const nativePreserved = readiness.native === "ready"
    && (readiness.web === "degraded" || readiness.web === "unavailable"
      || readiness.tools === "degraded" || readiness.tools === "unavailable");
  const setupPending = readiness.action === "open-setup";
  const toolsPending = readiness.action === "open-tools" || readiness.action === "repair-web"
    || readiness.reason === "web-repair-active";
  const catalogIsNext = readiness.reason === "catalog-unavailable";
  const heroTitle = catalogIsNext ? copy.catalogUnavailable
    : readiness.reason === "session-unavailable" ? workflow.session.verificationUnavailable
      : toolsPending ? workflow.recovery.webTransportTitle
        : readiness.action === "open-browser" ? (nativePreserved ? copy.setupReadyModels : copy.setupChecksPassed)
          : setupPending ? copy.setupInstalledTitle : copy.overviewTitle;
  const heroBody = catalogIsNext ? copy.catalogFailureKeptInstall
    : readiness.reason === "session-unavailable" ? sessionIssueCopy(snapshot.state.language ?? "en", browser?.authenticationIssue)
      : toolsPending ? (readiness.native === "ready" ? workflow.recovery.webTransportBody : copy.localToolsUnavailableBody)
        : readiness.action === "open-browser" ? (nativePreserved ? workflow.recovery.webTransportBody : copy.connectorAvailableNotExecuted)
          : setupPending ? (readiness.reason === "picker-confirmation-required" ? copy.setupConfirmTitle
            : readiness.reason === "catalog-waiting" ? copy.setupCatalogTitle : copy.overviewBody)
            : copy.overviewBody;
  const heroSurface = catalogIsNext ? "setup" : actionSurface[readiness.action];
  const heroAction = catalogIsNext ? copy.openRoutingChecks
    : readiness.action === "retry-session" ? workflow.session.retryVerification
      : readiness.action === "open-accounts" ? copy.accountConnection
        : readiness.action === "repair-web" ? workflow.recovery.repairAction
          : readiness.action === "open-tools" ? copy.manageToolsConnection
          : readiness.action === "open-browser" ? copy.openWorkspace
            : readiness.action === "open-setup" ? copy.finishSetup
              : readiness.reason === "web-repair-active" ? workflow.recovery.repairing : copy.loading;
  const heroRecovery = catalogIsNext || readiness.reason === "session-unavailable" || toolsPending;
  const showActivityAction = heroRecovery || readiness.action === "open-browser";
  const language = snapshot.state.language ?? "en";
  const overview = overviewCopy(language);
  const modeValue = manual ? copy.manualShort : copy.automaticShort;
  const events: EventItem[] = logs.slice(-8).reverse().map(({ id, record: log }) => {
    const text = humanEvent(log.event);
    return {
      id: String(id),
      text: text.charAt(0).toUpperCase() + text.slice(1),
      time: new Date(log.at).toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" }),
      dateTime: log.at,
      level: log.level === "error" ? "error" : log.level === "warning" ? "warning" : "info",
    };
  });
  return <Page width="wide" className="overview-page">
    <div className="nk-stack">
      <SurfaceHeader title={copy.overview} subtitle={copy.overviewSubtitle} />
      <Hero eyebrow={heroSurface ? copy.setupNext : undefined} title={heroTitle}
        actions={<>
          <Button variant="primary" iconEnd="forward" disabled={!heroSurface}
            onClick={() => { if (heroSurface) navigate(heroSurface); }}>{heroAction}</Button>
          {showActivityAction ? <Button variant="ghost" onClick={() => navigate("activity")}>{copy.viewActivity}</Button> : null}
        </>}>
        {heroBody}
      </Hero>
      <NetworkIssueNotice language={language} browser={browser}
        muted={snapshot.state.showNetworkIssueNotice === false} onDontShowAgain={onMuteNetworkNotice} />
      <StatGroup label={copy.overviewActiveRuns}>
        <Stat label={copy.overviewActiveRuns} value={active} note={copy.overviewActiveRunsBody} />
        <Stat label={copy.configuredLimit} value={snapshot.browserCapacity.active} onClick={() => navigate("settings")}
          title={copy.capacityHint} aria-label={`${copy.configuredLimit}: ${snapshot.browserCapacity.active}. ${copy.capacityLink}`}
          aria-describedby={`${overviewId}-capacity`} note={<span id={`${overviewId}-capacity`}>{copy.capacityNotMeasured}</span>} />
        <Stat label={copy.modeLabel} value={modeValue} note={copy.modeLink} onClick={() => navigate("settings")}
          title={copy.modeLink} aria-label={`${copy.modeLabel}: ${modeValue}. ${copy.modeLink}`} />
      </StatGroup>
      <div className="nk-columns">
        <div className="nk-stack">
          {activeTabs.length ? <Panel title={overview.runningNow} titleId={`${overviewId}-runs`} padding="compact"
            actions={<Button variant="link" size="sm" iconEnd="chevron" onClick={() => navigate("browser")}>{overview.openBrowser}</Button>}>
            <div className="nk-conn-list">{activeTabs.map(tab => {
              const mode = tab.interactionMode === "manual" ? copy.manualShort
                : tab.interactionMode === "automatic" ? copy.automaticShort : copy.usageUnknown;
              return <ConnectionRow key={tab.id} icon="browser" label={browserTabTitleFromTitle(tab.title, copy)}
                status={`${runStatus(tab.status)} · ${mode}`} state="busy" action={copy.overviewOpenRun}
                onClick={() => openTab(tab.id)} />;
            })}</div>
          </Panel> : null}
          <Panel title={copy.connectionsShort} titleId={`${overviewId}-connections`} padding="compact">
            <p className="nk-visually-hidden">{copy.connectionsBody}</p>
            <div className="nk-conn-list">{connections.map(connection => <ConnectionRow key={connection.surface}
              icon={connection.icon} label={connection.label} status={connection.status}
              state={connection.error ? "error" : connection.ready ? "ready" : "idle"}
              action={connection.ready ? copy.manageShort : connection.surface === "setup" ? copy.openRoutingChecks : copy.connectShort}
              onClick={() => navigate(connection.surface)} />)}</div>
          </Panel>
        </div>
        <Panel title={copy.recentActivity} titleId={`${overviewId}-events`} padding="compact" className="overview-activity"
          actions={<Button variant="link" size="sm" iconEnd="chevron" onClick={() => navigate("activity")}>{copy.viewAllShort}</Button>}>
          <EventList items={events}
            empty={<EmptyState title={copy.activityEmpty} icon="logs">{copy.activityEmptyBody}</EmptyState>} />
        </Panel>
      </div>
    </div>
  </Page>;
}
