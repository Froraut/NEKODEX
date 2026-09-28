import type { LauncherLogStore } from './launcher-log-store';
import { browserTabTitleFromTitle } from "./BrowserSurface";
import { humanEvent } from "./log-format";
import { useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Copy } from "./i18n";
import { deriveWorkspaceReadiness, workspaceReadinessInput, type ConnectionStatus } from "./workspace-readiness";
import { connectionActionWord, connectionStatusWord, connectionsCopy, workspaceHeadline, type HeadlineStep } from "./connections-copy";
import { overviewCopy } from "./overview-copy";
import { NetworkIssueNotice } from "./NetworkIssueNotice";
import { messageOf } from "./launcher-ui";
import { requestRoutingChecks } from "./SetupSurface";
import {
  Button, ConnectionRow, EmptyState, EventList, Hero, Notice, Page, Panel, Stat, StatGroup, SurfaceHeader,
  type EventItem, type IconName,
} from "./design";
import type { BrowserState, LauncherSnapshot, Surface } from "./types";

const api = window.codexWebLauncher;

/** Where each hero step leads (retry-session runs in place; wait has no destination). */
const stepSurface: Record<Exclude<HeadlineStep, "wait" | "retry-session">, Surface> = {
  "sign-in": "browser", setup: "setup", "routing-checks": "setup", tools: "mcp", repair: "mcp",
  activity: "activity", "open-workspace": "browser",
};

export function Overview({ copy, browser, catalogFailure, snapshot, toolsReady, logStore, navigate, openTab, onMuteNetworkNotice }: {
  copy: Copy; browser: BrowserState | null; snapshot: LauncherSnapshot;
  catalogFailure: string | null;
  toolsReady: boolean;
  logStore: LauncherLogStore; navigate: (surface: Surface) => void; openTab: (tabId: string) => void;
  onMuteNetworkNotice?: () => Promise<void>;
}) {
  const logs = useSyncExternalStore(logStore.subscribe, logStore.getSnapshot);
  const overviewId = useId();
  const language = snapshot.state.language ?? "en";
  const overview = overviewCopy(language);
  const manual = snapshot.state.browserInteractionMode === "manual";
  const development = snapshot.profile === "development";
  // The same derivation the shell and the Connections page use, so every surface reports the same state.
  const readiness = deriveWorkspaceReadiness(workspaceReadinessInput({ snapshot, browser, catalogFailure, toolsVerified: toolsReady }));
  const headline = workspaceHeadline(readiness, { app: copy, language, development, manual,
    authenticationIssue: browser?.authenticationIssue });

  // "Retry verification" checks the session here instead of only navigating to Accounts.
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const retryInFlight = useRef(false);
  const retrySession = async () => {
    if (retryInFlight.current || snapshot.lifecycle?.transition || browser?.navigationLocked) return;
    if (!browser?.accountId || !api) { navigate("accounts"); return; }
    retryInFlight.current = true;
    setRetrying(true);
    setRetryError(null);
    try {
      await api.refreshAccountAuthentication(browser.accountId);
    } catch (cause) {
      setRetryError(messageOf(cause));
    } finally {
      retryInFlight.current = false;
      setRetrying(false);
    }
  };
  const waiting = headline.step === "wait";
  const runStep = () => {
    if (headline.step === "wait") return;
    if (headline.step === "retry-session") void retrySession();
    else {
      if (headline.step === "routing-checks") requestRoutingChecks();
      navigate(stepSurface[headline.step]);
    }
  };

  const activeTabs = browser?.tabs.filter(tab => tab.id !== "home" && ["running", "loading", "testing"].includes(tab.status)) ?? [];
  const active = activeTabs.length;
  const runStatus = (status: BrowserState["tabs"][number]["status"]) => status === "running"
    ? copy.overviewRunRunning : status === "testing" ? copy.overviewRunTesting : copy.overviewRunLoading;
  // While the retry runs, the session row reports the check it is waiting for.
  const sessionStatus: ConnectionStatus = retrying ? { key: "checking", dot: "busy", action: "retry", ready: false }
    : readiness.connections.session;
  const connections: Array<{ icon: IconName; label: string; surface: Surface; status: ConnectionStatus }> = [
    { icon: "accounts", label: copy.accountConnection, surface: "accounts", status: sessionStatus },
    { icon: "setup", label: copy.modelsConnectionTab, surface: "setup", status: readiness.connections.models },
    { icon: "mcp", label: copy.toolsConnectionTab, surface: "mcp", status: readiness.connections.tools },
  ];
  const modeValue = manual ? copy.manualShort : copy.automaticShort;
  // Time of day only: the list covers the current session, and the full timestamp lives in Activity.
  const timeFormat = useMemo(() => new Intl.DateTimeFormat(language, { timeStyle: "short" }), [language]);
  // Debug records (process output) stay in Activity; Overview lists launcher events.
  const events: EventItem[] = logs.filter(({ record }) => record.level !== "debug").slice(-8).reverse().map(({ id, record: log }) => {
    const text = humanEvent(log.event, language);
    const at = new Date(log.at);
    return {
      id: String(id),
      text: text.charAt(0).toUpperCase() + text.slice(1),
      time: Number.isFinite(at.getTime()) ? timeFormat.format(at) : undefined,
      dateTime: log.at,
      level: log.level === "error" ? "error" : log.level === "warning" ? "warning" : "info",
    };
  });
  return <Page width="wide" className="overview-page">
    <SurfaceHeader title={copy.overview} subtitle={copy.overviewSubtitle} />
    <div className="nk-stack">
      <Hero eyebrow={waiting ? connectionsCopy(language).inProgress : copy.setupNext} title={headline.title}
        actions={<>
          <Button variant="primary" busy={waiting || retrying} iconEnd={waiting || headline.step === "retry-session" ? undefined : "forward"}
            onClick={runStep}>{headline.action}</Button>
          {headline.secondary === "activity"
            ? <Button variant="ghost" onClick={() => navigate("activity")}>{copy.viewActivity}</Button>
            : headline.secondary === "tools" || headline.secondary === "connect-tools"
              ? <Button variant="ghost" onClick={() => navigate("mcp")}>
                {headline.secondary === "tools" ? copy.manageToolsConnection : connectionsCopy(language).toolsTitle}
              </Button>
              : null}
        </>}>
        {headline.body}
      </Hero>
      {retryError && headline.step === "retry-session"
        ? <Notice tone="error">{retryError}</Notice> : null}
      <NetworkIssueNotice language={language} browser={browser}
        muted={snapshot.state.showNetworkIssueNotice === false} onDontShowAgain={onMuteNetworkNotice} />
      <StatGroup label={overview.statsLabel}>
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
            {/* Word, dot and action all come from one derived status per connection. */}
            <div className="nk-conn-list">{connections.map(connection => <ConnectionRow key={connection.surface}
              icon={connection.icon} label={connection.label} status={connectionStatusWord(connection.status, copy, language)}
              state={connection.status.dot} action={connectionActionWord(connection.status.action, copy, language)}
              // "Retry verification" checks the session here, like the hero; every other action opens the page.
              onClick={() => {
                if (connection.status.action === "retry") { void retrySession(); return; }
                if (connection.status.action === "open-routing-checks") requestRoutingChecks();
                navigate(connection.surface);
              }} />)}</div>
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
