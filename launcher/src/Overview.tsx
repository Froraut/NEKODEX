import { BrandMark } from "./BrandMark";
import { useRef, useState } from "react";
import { Icon, type IconName } from "./icons";
import type { Copy } from "./i18n";
import type { BrowserState, LauncherSnapshot, LogRecord, Surface } from "./types";

const workspaceArt = new URL("./assets/cat-workspace.png", import.meta.url).href;

export function Overview({ copy, browser, snapshot, logs, navigate }: {
  copy: Copy; browser: BrowserState | null; snapshot: LauncherSnapshot;
  logs: LogRecord[]; navigate: (surface: Surface) => void;
}) {
  const signedIn = browser?.authenticated === true;
  const modelsReady = snapshot.state.codexCatalogVerified === true && snapshot.state.codexPickerConfirmed === true;
  const toolsReady = snapshot.state.mcpSetupComplete === true;
  const ready = signedIn && modelsReady && toolsReady;
  const active = browser?.tabs.filter(tab => tab.status === "running").length ?? 0;
  const connections: Array<{ icon: IconName; label: string; ready: boolean; surface: Surface; pending: string }> = [
    { icon: "accounts", label: copy.accountConnection, ready: signedIn, surface: "accounts", pending: copy.signInNeededShort },
    { icon: "setup", label: copy.modelConnection, ready: modelsReady, surface: "setup", pending: copy.connectionPending },
    { icon: "mcp", label: copy.toolConnection, ready: toolsReady, surface: "mcp", pending: copy.notConnectedShort },
  ];
  return <section className="content-surface overview-surface is-page-scroll">
    <div className="content-scroll overview-scroll">
      <header className="overview-heading"><div><h1>{copy.overview}</h1><p>{copy.overviewSubtitle}</p></div><span className="workspace-location"><Icon name="globe" />{copy.localWorkspace}</span></header>
      <section className="workspace-intro">
        <div className="intro-copy"><h2>{ready ? copy.overviewReady : copy.overviewTitle}</h2>
          <p>{ready ? copy.overviewReadyBody : copy.overviewBody}</p>
          <button className="button-primary" type="button" onClick={() => navigate(modelsReady ? "browser" : "setup")}>{modelsReady ? copy.openWorkspace : copy.finishSetup}<Icon name="forward" /></button>
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
            {logs.length ? <ul>{logs.slice(-3).reverse().map((log, index) => <li key={`${log.at}-${index}`}><Icon name={log.level === "error" || log.level === "warning" ? "alert" : "activity"} /><span>{log.event.replaceAll(/[._-]+/g, " ")}</span><time>{new Date(log.at).toLocaleTimeString(snapshot.state.language ?? "en", { hour: "2-digit", minute: "2-digit" })}</time></li>)}</ul>
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
  const next = useRef(0);
  const active = useRef(false);
  const [reaction, setReaction] = useState<number | null>(null);
  const play = () => {
    if (active.current) return;
    active.current = true;
    setReaction(next.current++ % 3);
  };
  const stop = () => { active.current = false; setReaction(null); };
  return <div className={`workspace-illustration-stage${reaction === null ? "" : ` is-playing illustration-reaction-${reaction}`}`}
    role="img" aria-label="NEKODEX coding cat" tabIndex={0}
    onPointerEnter={play} onPointerLeave={stop} onPointerCancel={stop} onFocus={play} onBlur={stop}>
    <img className="workspace-illustration" src={workspaceArt} alt="" width="1536" height="1024" decoding="async" />
  </div>;
}
