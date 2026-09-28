import type { LauncherLogStore } from './launcher-log-store';
import languages from "../electron/languages.json";
import { memo, useId, useMemo, useState, useSyncExternalStore } from "react";
import { UsageDashboard } from "./UsageDashboard";
import { Button, EmptyState, EventList, Page, Panel, Select, SurfaceHeader, TextField, type EventItem } from "./design";
import { messageOf } from "./launcher-ui";
import type { Copy } from "./i18n";
import type { Language, LogRecord } from "./types";
import { humanEvent } from "./log-format";
import "./surfaces/activity.css";
const api = window.codexWebLauncher;
const ActivityUsage = memo(UsageDashboard);

const eventLevel = (level: LogRecord["level"]): EventItem["level"] => level === "debug" ? "info" : level;

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
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("all");
  const levelId = useId();
  const logs = useSyncExternalStore(logStore.subscribe, logStore.getSnapshot);
  const formatted = useMemo(() => {
    const time = new Intl.DateTimeFormat(languages[language].locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return logs.map(({ id, record }) => {
      const event = humanEvent(record.event), detail = logDetail(record.detail), date = new Date(record.at);
      return { id, level: record.level, event, detail, at: record.at, search: `${event} ${detail}`.toLocaleLowerCase(),
        time: Number.isNaN(date.getTime()) ? record.at : time.format(date) };
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
        <strong>{record.event}</strong>
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
      <div className="activity-sections">
        <ActivityUsage copy={copy} language={language} />
        <section className="activity-events" aria-labelledby="activity-events-title">
          <h2 className="activity-section-title nk-type-heading" id="activity-events-title">{copy.recentActivity}</h2>
          <div className="activity-filters">
            <TextField
              className="activity-filters__search"
              type="search"
              label={copy.searchActivity}
              value={query}
              onChange={event => setQuery(event.target.value)}
            />
            <div className="nk-field">
              <label htmlFor={levelId}>{copy.eventLevel}</label>
              <Select id={levelId} options={levels} value={level} onChange={value => setLevel(value)} />
            </div>
          </div>
          <Panel padding="flush" className="activity-log">
            <EventList
              items={items}
              empty={<EmptyState centered title={logs.length ? copy.noMatchingEvents : copy.noLogs} />}
            />
          </Panel>
        </section>
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
