import { CatTail } from "./CatTail";
import { BrandMark, CatHead, useCatReaction } from "./BrandMark";
import { useId, type CSSProperties } from "react";
import { Icon, type IconName } from "./icons";
import type { Copy } from "./i18n";
import { modelConnectionReadiness } from "./setup-progress";
import type { BrowserState, LauncherSnapshot, LogRecord, Surface } from "./types";

const workspaceBase = new URL("./assets/cat-workspace-base.png", import.meta.url).href;
const workspaceArt = new URL("./assets/cat-workspace.png", import.meta.url).href;

export function Overview({ copy, browser, catalogFailure, snapshot, toolsReady, logs, navigate, openTab }: {
  copy: Copy; browser: BrowserState | null; snapshot: LauncherSnapshot;
  catalogFailure: string | null;
  toolsReady: boolean;
  logs: LogRecord[]; navigate: (surface: Surface) => void; openTab: (tabId: string) => void;
}) {
  const overviewId = useId();
  const manual = snapshot.state.browserInteractionMode === "manual";
  const signedIn = browser?.authenticated === true;
  const models = modelConnectionReadiness({ manual,
    installed: snapshot.state.coreSetupComplete === true,
    catalogVerified: snapshot.state.codexCatalogVerified === true,
    pickerConfirmed: snapshot.state.codexPickerConfirmed === true,
    development: snapshot.profile === "development" });
  const modelsReady = models === "available";
  const ready = modelsReady && toolsReady && (manual || signedIn);
  const workspaceReady = modelsReady && (manual || signedIn);
  const runtime = snapshot.runtimeCapabilities ?? snapshot.lifecycle;
  const toolsTransportUnavailable = snapshot.state.mcpRuntimeInstalled && runtime
    && ["degraded", "failed", "recovering", "starting", "stopping"].includes(runtime.tunnelStatus);
  const heroOpensWorkspace = workspaceReady && !toolsTransportUnavailable && !catalogFailure;
  const activeTabs = browser?.tabs.filter(tab => ["running", "loading", "testing"].includes(tab.status)) ?? [];
  const active = activeTabs.length;
  const runStatus = (status: BrowserState["tabs"][number]["status"]) => status === "running"
    ? copy.overviewRunRunning : status === "testing" ? copy.overviewRunTesting : copy.overviewRunLoading;
  const modelStatus = catalogFailure ? copy.catalogUnavailable
    : modelsReady ? (manual ? copy.setupInstalledTitle : copy.connectionVerified)
      : models === "picker-pending" ? copy.modelsConfirmShort
        : models === "catalog-pending" ? copy.modelsWaitingShort : copy.connectionPending;
  const connections: Array<{ error?: boolean; icon: IconName; label: string; ready: boolean; surface: Surface; status: string }> = [
    { icon: "accounts", label: copy.accountConnection, ready: signedIn, surface: "accounts",
      status: manual ? copy.manualShort : signedIn ? copy.connectionVerified : copy.signInNeededShort },
    { error: Boolean(catalogFailure), icon: "setup", label: copy.modelsConnectionTab, ready: modelsReady && !catalogFailure,
      surface: "setup", status: modelStatus },
    { error: Boolean(toolsTransportUnavailable), icon: "mcp", label: copy.toolsConnectionTab, ready: toolsReady, surface: "mcp",
      status: toolsTransportUnavailable ? copy.localToolsUnavailable : toolsReady ? copy.connectorVerified : copy.connectorNotVerified },
  ];
  const heroTitle = catalogFailure ? copy.catalogUnavailable
    : toolsTransportUnavailable ? copy.localToolsUnavailable : ready ? copy.setupChecksPassed
      : (manual || signedIn) && snapshot.state.coreSetupComplete ? copy.setupInstalledTitle : copy.overviewTitle;
  const heroBody = catalogFailure ? copy.catalogFailureKeptInstall
    : toolsTransportUnavailable ? runtime?.nativeAvailability === "ready" ? copy.localToolsUnavailableNativeBody : copy.localToolsUnavailableBody
    : ready ? copy.connectorAvailableNotExecuted
      : (manual || signedIn) && snapshot.state.coreSetupComplete
        ? models === "picker-pending" ? copy.setupConfirmTitle : models === "catalog-pending" ? copy.setupCatalogTitle : copy.manageToolsConnection
        : copy.overviewBody;
  return <section className="content-surface overview-surface is-page-scroll">
    <div className="content-scroll overview-scroll">
      <header className="overview-heading"><div><h1>{copy.overview}</h1><p>{copy.overviewSubtitle}</p></div><span className="workspace-location"><Icon name="globe" />{copy.localWorkspace}</span></header>
      <section className="workspace-intro" aria-labelledby="overview-intro-heading">
        <div className="intro-copy"><h2 id="overview-intro-heading">{heroTitle}</h2>
          <p>{heroBody}</p>
          <button className="button-primary" type="button" onClick={() => navigate(toolsTransportUnavailable ? "mcp" : heroOpensWorkspace ? "browser" : "setup")}>{toolsTransportUnavailable ? copy.manageToolsConnection : heroOpensWorkspace ? copy.openWorkspace : copy.finishSetup}<Icon name="forward" /></button>
        </div>
        <div className="intro-emblem"><BrandMark /><span>NEKODEX</span></div>
      </section>
      <section className="overview-work" aria-labelledby={`${overviewId}-runs`} aria-describedby={`${overviewId}-runs-description`}>
        <div className="overview-work-header">
          <div className="overview-work-summary">
            <strong className="overview-work-count">{active}</strong>
            <div className="overview-work-copy">
              <h2 id={`${overviewId}-runs`} title={copy.overviewActiveRunsBody}>{copy.overviewActiveRuns}</h2>
              {!heroOpensWorkspace ? <button className="overview-inline-action" type="button" onClick={() => navigate("browser")}>
                {copy.openWorkspace}<Icon name="forward" />
              </button> : null}
            </div>
          </div>
          <div className="overview-work-preferences">
            <div className="overview-work-actions">
              <div className="overview-capacity-control">
                <button className="overview-preference" type="button" title={copy.capacityHint}
                  aria-label={`${copy.configuredLimit}: ${snapshot.browserCapacity.active}. ${copy.capacityLink}`}
                  aria-describedby={`${overviewId}-capacity`} onClick={() => navigate("settings")}>
                  <span>{copy.configuredLimit}</span><strong>{snapshot.browserCapacity.active}</strong><Icon name="chevron" />
                </button>
                <p className="overview-capacity-note" id={`${overviewId}-capacity`}>{copy.capacityNotMeasured}</p>
              </div>
              <button className="overview-preference" type="button" title={copy.modeLink}
                aria-label={`${copy.modeLabel}: ${manual ? copy.manualShort : copy.automaticShort}. ${copy.modeLink}`}
                onClick={() => navigate("settings")}>
                <span>{copy.modeLabel}</span><strong>{manual ? copy.manualShort : copy.automaticShort}</strong><Icon name="chevron" />
              </button>
            </div>
          </div>
        </div>
        <p className="visually-hidden" id={`${overviewId}-runs-description`}>{copy.overviewActiveRunsBody}</p>
        {activeTabs.length ? <ul className="overview-live-runs">{activeTabs.map(tab => {
          const status = runStatus(tab.status);
          const mode = tab.interactionMode === "manual" ? copy.manualShort
            : tab.interactionMode === "automatic" ? copy.automaticShort : copy.usageUnknown;
          return <li key={tab.id}><button type="button" onClick={() => openTab(tab.id)} aria-label={`${tab.title}. ${status}. ${mode}. ${copy.overviewOpenRun}`}>
            <i className="state-dot is-busy" aria-hidden="true" />
            <span><strong>{tab.title}</strong><small>{status} · {mode}</small></span>
            <span className="overview-run-action" aria-hidden="true">{copy.overviewOpenRun}<Icon name="chevron" /></span>
          </button></li>;
        })}</ul> : null}
      </section>
      <div className="overview-grid">
        <div className="overview-main-column">
          <section className="connection-section" aria-labelledby="connection-heading" aria-describedby={`${overviewId}-connections-description`}>
            <div className="overview-section-heading"><h2 id="connection-heading">{copy.connectionsShort}</h2></div>
            <p className="visually-hidden" id={`${overviewId}-connections-description`}>{copy.connectionsBody}</p>
            <div className="connection-list">{connections.map(connection => <button type="button" key={connection.surface} aria-label={`${connection.label}: ${connection.status}. ${connection.ready ? copy.manageShort : connection.surface === "setup" ? copy.openRoutingChecks : copy.connectShort}`} onClick={() => navigate(connection.surface)}>
              <Icon name={connection.icon} />
              <span className="overview-connection-copy"><strong>{connection.label}</strong><span className={`connection-status${connection.ready ? " is-ready" : ""}${connection.error ? " is-error" : ""}`} aria-live="polite" aria-atomic="true"><i className={`state-dot is-${connection.error ? "error" : connection.ready ? "ready" : "idle"}`} aria-hidden="true" />{connection.status}</span></span>
              <span className="connection-action" aria-hidden="true">{connection.ready ? copy.manageShort : connection.surface === "setup" ? copy.openRoutingChecks : copy.connectShort}<Icon name="chevron" /></span>
            </button>)}</div>
          </section>
          <section className="overview-activity" aria-live="polite" aria-atomic="false">
            <div className="overview-section-heading"><h2>{copy.recentActivity}</h2><button className="text-button" type="button" onClick={() => navigate("activity")}>{copy.viewAllShort}<Icon name="chevron" /></button></div>
            {logs.length ? <ul>{logs.slice(-8).reverse().map((log, index) => <li key={`${log.at}-${index}`}><Icon name={log.level === "error" || log.level === "warning" ? "alert" : "activity"} /><span>{log.event.replaceAll(/[._-]+/g, " ")}</span><time>{new Date(log.at).toLocaleTimeString(snapshot.state.language ?? "en", { hour: "2-digit", minute: "2-digit" })}</time></li>)}</ul>
              : <div className="overview-empty"><Icon name="logs" /><div><strong>{copy.activityEmpty}</strong><p>{copy.activityEmptyBody}</p></div></div>}
          </section>
        </div>
        <aside className="workspace-art-card">
          <div className="art-card-copy"><h2>{copy.artCardTitle}</h2><p>{copy.artCardBody}</p></div>
          <WorkspaceIllustration />
        </aside>
      </div>
    </div>
  </section>;
}

function WorkspaceIllustration() {
  const id = `coding-cat-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const { reaction, play, follow, reset } = useCatReaction();
  const pawReaction = reaction === "happy" || reaction === "surprised" || reaction === "stretch" ? 2
    : reaction === "wink" || reaction === "playful" || reaction === "peek" ? 1 : 0;
  return <div className={`workspace-illustration-stage${reaction === null ? "" : ` is-playing reaction-${reaction} illustration-reaction-${pawReaction}`}`}
    role="img" aria-label="NEKODEX coding cat" tabIndex={0}
    onPointerEnter={play} onPointerMove={follow} onPointerLeave={event => reset(event.currentTarget)} onPointerCancel={event => reset(event.currentTarget)} onFocus={play} onBlur={event => reset(event.currentTarget)}>
    <svg className="workspace-illustration" viewBox="0 0 1536 1024" aria-hidden="true">
      <defs>
        <mask id={`${id}-stationary`} maskUnits="userSpaceOnUse" x="0" y="0" width="1536" height="1024">
          <rect width="1536" height="1024" fill="white" />
          <rect x="590" y="260" width="356" height="267" fill="black" />
          <ellipse cx="644" cy="514" rx="43" ry="33" fill="black" />
          <ellipse cx="894" cy="514" rx="43" ry="33" fill="black" />
        </mask>
        <clipPath id={`${id}-left-paw`}><ellipse cx="644" cy="514" rx="43" ry="33" /></clipPath>
        <clipPath id={`${id}-right-paw`}><ellipse cx="894" cy="514" rx="43" ry="33" /></clipPath>
        <clipPath id={`${id}-tail-behind`}><rect x="220" y="300" width="295" height="450" /></clipPath>
      </defs>
      {/* The scene and paws retain the original pixels; the head shares the main cat rig. */}
      <image href={workspaceBase} width="1536" height="1024" mask={`url(#${id}-stationary)`} />
      <g clipPath={`url(#${id}-tail-behind)`}>
        <CatTail reaction={reaction} id={id} />
      </g>
      {/* Restore the stationary laptop edge behind lifted paws using its own pixels. */}
      <svg x="590" y="511" width="356" height="16" viewBox="540 511 50 16" preserveAspectRatio="none" overflow="hidden">
        <image href={workspaceArt} width="1536" height="1024" />
      </svg>
      <g className="coding-cat-head" transform="translate(548 207) scale(6.8 5.3)"
        style={{ color: "#343245", "--brand-ink": "#c6bdff" } as CSSProperties}>
        <CatHead reaction={reaction} />
      </g>
      <g className="coding-cat-paw coding-cat-paw-left">
        <image href={workspaceArt} width="1536" height="1024" clipPath={`url(#${id}-left-paw)`} />
      </g>
      <g className="coding-cat-paw coding-cat-paw-right">
        <image href={workspaceArt} width="1536" height="1024" clipPath={`url(#${id}-right-paw)`} />
      </g>
    </svg>
  </div>;
}
