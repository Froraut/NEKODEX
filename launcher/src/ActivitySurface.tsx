import type { LauncherLogStore } from './launcher-log-store';
import languages from "../electron/languages.json";
import { memo, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { UsageDashboard } from "./UsageDashboard";
import { Badge, Button, EmptyState, EventList, Page, Panel, Select, SurfaceHeader, Tabs, TextField, type EventItem } from "./design";
import { messageOf } from "./launcher-ui";
import type { Copy } from "./i18n";
import type { Language, LogRecord } from "./types";
import { humanEvent } from "./log-format";
import { activityCopy } from "./activity-copy";
import "./surfaces/activity.css";
const api = window.codexWebLauncher;
const ActivityUsage = memo(UsageDashboard);

const eventLevel = (level: LogRecord["level"]): EventItem["level"] => level === "debug" ? "info" : level;
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

type ActivityView = "events" | "usage";
const TAB_PREFIX = "activity-tab";
const PANEL_PREFIX = "activity-panel";
/** Both views stay mounted (filters and the last usage report survive switching); the inactive one is hidden. */
const viewPanel = (id: ActivityView) => ({ id: `${PANEL_PREFIX}-${id}`, role: "tabpanel", "aria-labelledby": `${TAB_PREFIX}-${id}` } as const);

export function ActivitySurface({
  copy,
  transitionBusy,
  language,
  logStore,
  setError,
}: {
  copy: Copy;
  transitionBusy: boolean;
  language: Language;
  logStore: LauncherLogStore;
  setError: (error: string | null) => void;
}) {
  const [view, setView] = useState<ActivityView>("events");
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("all");
  const levelId = useId();
  const searchInput = useRef<HTMLInputElement>(null);
  const text = activityCopy(language);
  const logs = useSyncExternalStore(logStore.subscribe, logStore.getSnapshot);
  const formatted = useMemo(() => {
    const locale = languages[language]?.locale ?? language;
    // Today's events show the time; older ones carry their date so a long-running log stays unambiguous.
    const time = new Intl.DateTimeFormat(locale, { timeStyle: "short" });
    const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
    const now = new Date();
    return logs.map(({ id, record }) => {
      const event = humanEvent(record.event, language), detail = logDetail(record.detail), date = new Date(record.at);
      // The raw event id stays searchable next to its readable title (support asks for ids such as browser.turn_ended).
      return { id, level: record.level, event, detail, at: record.at, search: `${event} ${record.event} ${detail}`.toLocaleLowerCase(),
        time: Number.isNaN(date.getTime()) ? record.at : (sameDay(date, now) ? time : dateTime).format(date) };
    });
  }, [logs, language]);
  const [exporting, setExporting] = useState(false);
  const search = query.trim().toLocaleLowerCase();
  const visibleLogs = formatted.filter(record => (level === "all" || record.level === level) && record.search.includes(search));
  const items: EventItem[] = [...visibleLogs].reverse().map(record => ({
    id: String(record.id),
    level: eventLevel(record.level),
    icon: record.level === "debug" ? "logs" : undefined,
    time: record.time,
    dateTime: record.at,
    text: (
      <span className="activity-row">
        {/* Errors and warnings share the alert icon; the level word keeps them apart without colour. */}
        {record.level === "error" || record.level === "warning" ? <span className="activity-row__head">
          <Badge tone={record.level}>{record.level === "error" ? text.levelError : text.levelWarning}</Badge>
          <span className="nk-visually-hidden">: </span>
          <strong>{record.event}</strong>
        </span> : <strong>{record.event}</strong>}
        {record.detail ? <span className="activity-row__detail">{record.detail}</span> : null}
      </span>
    ),
  }));
  const levels = [
    { value: "all", label: copy.allEvents },
    { value: "error", label: copy.errorEvents },
    { value: "warning", label: copy.warningEvents },
    { value: "info", label: copy.infoEvents },
    { value: "debug", label: copy.debugEvents },
  ];
  const clearFilters = () => { setQuery(""); setLevel("all"); searchInput.current?.focus(); };
  return (
    <Page className="activity-surface">
      <SurfaceHeader
        title={copy.activityTitle}
        subtitle={copy.activitySubtitle}
        actions={(
          <Button
            icon="external"
            busy={exporting}
            disabled={transitionBusy || exporting}
            onClick={() => {
              if (exporting) return;
              setExporting(true);
              void api!.exportLogs().catch((cause) => setError(messageOf(cause))).finally(() => setExporting(false));
            }}
          >
            {copy.exportSafeLog}
          </Button>
        )}
      />
      {/* The event log comes first (layouts.md "Activity"); usage statistics are the second view. */}
      <Tabs className="activity-tabs" label={text.views} active={view} onSelect={id => setView(id as ActivityView)}
        idPrefix={TAB_PREFIX} panelId={`${PANEL_PREFIX}-${view}`}
        tabs={[{ id: "events", label: copy.recentActivity }, { id: "usage", label: copy.usageTitle }]} />
      <div className="activity-view" {...viewPanel("events")} hidden={view !== "events"}>
        {/* The tab panel names this view; the hidden heading keeps it in heading navigation. */}
        <div className="activity-events">
          <h2 className="nk-visually-hidden">{copy.recentActivity}</h2>
          {/* Filters only help when there are events to narrow down. */}
          {logs.length ? <div className="activity-filters">
            <TextField
              className="activity-filters__search"
              ref={searchInput}
              type="search"
              label={copy.searchActivity}
              value={query}
              onChange={event => setQuery(event.target.value)}
            />
            <div className="nk-field">
              <label htmlFor={levelId}>{copy.eventLevel}</label>
              <Select id={levelId} options={levels} value={level} onChange={value => setLevel(value)} />
            </div>
          </div> : null}
          <Panel padding="flush" className="activity-log">
            <EventList
              items={items}
              empty={logs.length
                ? <EmptyState icon="logs" title={text.noMatchingEvents} action={<Button size="sm" onClick={clearFilters}>{text.clearFilters}</Button>} />
                : <EmptyState icon="activity" title={copy.noLogs}>{text.noEventsBody}</EmptyState>}
            />
          </Panel>
        </div>
      </div>
      {/* Kept mounted while hidden so its filters and last report survive switching views. */}
      <div className="activity-view" {...viewPanel("usage")} hidden={view !== "usage"}>
        <ActivityUsage copy={copy} language={language} />
      </div>
    </Page>
  );
}


function logDetail(detail: Record<string, unknown>): string {
  const entries = Object.entries(detail).filter(([, value]) => value !== undefined && value !== null);
  if (entries.length === 0) return "";
  return entries
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join(" · ");
}
