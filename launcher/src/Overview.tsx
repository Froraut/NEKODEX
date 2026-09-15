import { CatTail } from "./CatTail";
import { BrandMark, CatHead, useCatReaction } from "./BrandMark";
import { useId, type CSSProperties } from "react";
import { Icon, type IconName } from "./icons";
import type { Copy } from "./i18n";
import type { BrowserState, LauncherSnapshot, LogRecord, Surface } from "./types";

const workspaceBase = new URL("./assets/cat-workspace-base.png", import.meta.url).href;
const workspaceArt = new URL("./assets/cat-workspace.png", import.meta.url).href;

export function Overview({ copy, browser, snapshot, toolsReady, logs, navigate }: {
  copy: Copy; browser: BrowserState | null; snapshot: LauncherSnapshot;
  toolsReady: boolean;
  logs: LogRecord[]; navigate: (surface: Surface) => void;
}) {
  const signedIn = browser?.authenticated === true;
  const modelsReady = snapshot.state.codexCatalogVerified === true && snapshot.state.codexPickerConfirmed === true;
  const ready = signedIn && modelsReady && toolsReady;
  const workspaceReady = signedIn && modelsReady;
  const active = browser?.tabs.filter(tab => tab.status === "running").length ?? 0;
  const connections: Array<{ icon: IconName; label: string; ready: boolean; surface: Surface; pending: string }> = [
    { icon: "accounts", label: copy.accountConnection, ready: signedIn, surface: "accounts", pending: copy.signInNeededShort },
    { icon: "setup", label: copy.modelConnection, ready: modelsReady, surface: "setup", pending: snapshot.state.coreSetupComplete ? snapshot.state.codexCatalogVerified ? copy.modelsConfirmShort : copy.modelsWaitingShort : copy.connectionPending },
    { icon: "mcp", label: copy.toolConnection, ready: toolsReady, surface: "mcp", pending: copy.notConnectedShort },
  ];
  return <section className="content-surface overview-surface is-page-scroll">
    <div className="content-scroll overview-scroll">
      <header className="overview-heading"><div><h1>{copy.overview}</h1><p>{copy.overviewSubtitle}</p></div><span className="workspace-location"><Icon name="globe" />{copy.localWorkspace}</span></header>
      <section className="workspace-intro">
        <div className="intro-copy"><h2>{ready ? copy.overviewReady : signedIn && snapshot.state.coreSetupComplete ? copy.setupInstalledTitle : copy.overviewTitle}</h2>
          <p>{ready ? copy.overviewReadyBody : signedIn && snapshot.state.coreSetupComplete ? snapshot.state.codexCatalogVerified ? copy.setupConfirmTitle : copy.setupCatalogTitle : copy.overviewBody}</p>
          <button className="button-primary" type="button" onClick={() => navigate(workspaceReady ? "browser" : "setup")}>{workspaceReady ? copy.openWorkspace : copy.finishSetup}<Icon name="forward" /></button>
        </div>
        <div className="intro-emblem"><BrandMark /><span>NEKODEX</span></div>
      </section>
      <div className="workspace-metrics">
        <button type="button" title={copy.capacityLink} onClick={() => navigate("settings")}><span className="metric-value"><strong>{snapshot.browserCapacity.active}</strong><span>{copy.capacityLabel}</span></span><small>{copy.capacityHint}</small></button>
        <button type="button" title={copy.openWorkspace} onClick={() => navigate("browser")}><span className="metric-value"><strong>{active}</strong><span>{copy.runningLabel}</span></span><small>{copy.runningHint}</small></button>
        <button type="button" title={copy.modeLink} onClick={() => navigate("settings")}><strong className="metric-mode">{snapshot.state.browserInteractionMode === "manual" ? copy.manualShort : copy.automaticShort}</strong><span className="metric-label">{copy.modeLabel}</span><small>{copy.workspaceTagline}</small></button>
      </div>
      <div className="overview-grid">
        <div className="overview-main-column">
          <section className="connection-section" aria-labelledby="connection-heading">
            <div className="overview-section-heading"><h2 id="connection-heading">{copy.connectionsShort}</h2><small>{copy.connectionsBody}</small></div>
            <div className="connection-list">{connections.map(connection => <button type="button" key={connection.surface} onClick={() => navigate(connection.surface)}>
              <Icon name={connection.icon} /><strong>{connection.label}</strong><span className={`connection-status${connection.ready ? " is-ready" : ""}`}><i className={`state-dot is-${connection.ready ? "ready" : "idle"}`} />{connection.ready ? copy.connectionVerified : connection.pending}</span><span className="connection-action">{connection.ready ? copy.manageShort : connection.surface === "setup" ? copy.setup : copy.connectShort}<Icon name="chevron" /></span>
            </button>)}</div>
          </section>
          <section className="overview-activity">
            <div className="overview-section-heading"><h2>{copy.recentActivity}</h2><button className="text-button" type="button" onClick={() => navigate("activity")}>{copy.viewAllShort}<Icon name="chevron" /></button></div>
            {logs.length ? <ul>{logs.slice(-8).reverse().map((log, index) => <li key={`${log.at}-${index}`}><Icon name={log.level === "error" || log.level === "warning" ? "alert" : "activity"} /><span>{log.event.replaceAll(/[._-]+/g, " ")}</span><time>{new Date(log.at).toLocaleTimeString(snapshot.state.language ?? "en", { hour: "2-digit", minute: "2-digit" })}</time></li>)}</ul>
              : <div className="overview-empty"><Icon name="logs" /><div><strong>{copy.activityEmpty}</strong><p>{copy.activityEmptyBody}</p></div></div>}
          </section>
        </div>
        <aside className="workspace-art-card">
          <div className="art-card-copy"><h2>{copy.artCardTitle}</h2><p>{copy.artCardBody}</p></div>
          <WorkspaceIllustration />
          <div className="art-card-actions">
            <button className="button-secondary" type="button" onClick={() => navigate("accounts")}><Icon name="accounts" />{copy.quickAccounts}</button>
            <button className="button-secondary" type="button" onClick={() => navigate("browser")}><Icon name="browser" />{copy.openBrowserShort}</button>
          </div>
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
