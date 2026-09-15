import { BrandMark } from "./BrandMark";
import { Icon, type IconName } from "./icons";
import type { Copy } from "./i18n";
import type { BrowserState, LauncherSnapshot, LogRecord, Surface } from "./types";

export function Overview({ copy, browser, snapshot, logs, navigate }: {
  copy: Copy;
  browser: BrowserState | null;
  snapshot: LauncherSnapshot;
  logs: LogRecord[];
  navigate: (surface: Surface) => void;
}) {
  const signedIn = browser?.authenticated === true;
  const modelsReady = snapshot.state.codexCatalogVerified === true && snapshot.state.codexPickerConfirmed === true;
  const toolsReady = snapshot.state.mcpSetupComplete === true;
  const ready = signedIn && modelsReady && toolsReady;
  const active = browser?.tabs.filter(tab => tab.status === "running").length ?? 0;
  const connections: Array<{ icon: IconName; label: string; ready: boolean; surface: Surface }> = [
    { icon: "accounts", label: copy.accountConnection, ready: signedIn, surface: "accounts" },
    { icon: "setup", label: copy.modelConnection, ready: modelsReady, surface: "setup" },
    { icon: "mcp", label: copy.toolConnection, ready: toolsReady, surface: "mcp" },
  ];
  return <section className="content-surface overview-surface">
    <div className="content-scroll overview-scroll">
      <header className="overview-heading"><h1>{copy.overview}</h1><span className="workspace-location"><Icon name="globe" />{copy.localWorkspace}</span></header>
      <section className="workspace-intro">
        <div className="intro-copy"><h2>{ready ? copy.overviewReady : copy.overviewTitle}</h2>
          <p>{ready ? copy.overviewReadyBody : copy.overviewBody}</p>
          <button className="button-primary" type="button" onClick={() => navigate(modelsReady ? "browser" : "setup")}>{modelsReady ? copy.openWorkspace : copy.finishSetup}<Icon name="forward" /></button>
        </div>
        <div className="intro-emblem"><BrandMark /><span>NEKODEX</span></div>
      </section>
      <div className="workspace-metrics">
        <div><span>{copy.capacityLabel}</span><strong>{snapshot.browserCapacity.active}</strong><small>{copy.capacityHint}</small><button className="text-button" type="button" onClick={() => navigate("settings")}>{copy.capacityLink}<Icon name="chevron" /></button></div>
        <div><span>{copy.runningLabel}</span><strong>{active}<i className={`state-dot is-${active ? "busy" : "idle"}`} /></strong><small>{copy.runningHint}</small><button className="text-button" type="button" onClick={() => navigate("browser")}>{copy.openWorkspace}<Icon name="chevron" /></button></div>
        <div><span>{copy.modeLabel}</span><strong className="metric-mode">{snapshot.state.browserInteractionMode === "manual" ? copy.manualInteraction : copy.automaticInteraction}</strong><small>{copy.workspaceTagline}</small><button className="text-button" type="button" onClick={() => navigate("settings")}>{copy.modeLink}<Icon name="chevron" /></button></div>
      </div>
      <section className="connection-section" aria-labelledby="connection-heading">
        <div className="overview-section-heading"><h2 id="connection-heading">{copy.connectionTitle}</h2><small>{copy.connectionsBody}</small></div>
        <div className="connection-list">{connections.map(connection => <button type="button" key={connection.surface} onClick={() => navigate(connection.surface)}>
          <Icon name={connection.icon} /><strong>{connection.label}</strong><span className={`connection-status${connection.ready ? " is-ready" : ""}`}><i className={`state-dot is-${connection.ready ? "ready" : "idle"}`} />{connection.ready ? copy.connectionVerified : copy.connectionPending}</span><Icon name="chevron" />
        </button>)}</div>
      </section>
      <div className="workspace-shortcuts">
        <button type="button" onClick={() => navigate("accounts")}><Icon name="accounts" /><span><strong>{copy.quickAccounts}</strong><small>{copy.quickAccountsBody}</small></span><Icon name="chevron" /></button>
        <button type="button" onClick={() => navigate("mcp")}><Icon name="mcp" /><span><strong>{copy.quickTools}</strong><small>{copy.quickToolsBody}</small></span><Icon name="chevron" /></button>
      </div>
      <section className="overview-activity">
        <div className="overview-section-heading"><h2>{copy.recentActivity}</h2><button className="text-button" type="button" onClick={() => navigate("activity")}>{copy.viewActivity}</button></div>
        {logs.length ? <ul>{logs.slice(-3).reverse().map((log, index) => <li key={`${log.at}-${index}`}><Icon name="activity" /><span>{log.event}</span><time>{new Date(log.at).toLocaleTimeString(snapshot.state.language ?? "en", { hour: "2-digit", minute: "2-digit" })}</time></li>)}</ul>
          : <div className="overview-empty"><Icon name="activity" /><div><strong>{copy.activityEmpty}</strong><p>{copy.activityEmptyBody}</p></div></div>}
      </section>
    </div>
  </section>;
}
