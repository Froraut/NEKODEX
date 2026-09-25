import type { LauncherLogStore } from './launcher-log-store';
import languages from "../electron/languages.json";
import { memo, useMemo, useState, useSyncExternalStore } from "react";
import { UsageDashboard } from "./UsageDashboard";
import { Icon } from "./icons";
import { ContentSurface, StateDot, SecondaryButton, messageOf } from "./launcher-ui";
import type { Copy } from "./i18n";
import type { Language } from "./types";
import { humanEvent } from "./log-format";
const api = window.codexWebLauncher;
const ActivityUsage = memo(UsageDashboard);

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
  const logs = useSyncExternalStore(logStore.subscribe, logStore.getSnapshot);
  const formatted = useMemo(() => {
    const time = new Intl.DateTimeFormat(languages[language].locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return logs.map(({ id, record }) => {
      const event = humanEvent(record.event), detail = logDetail(record.detail), date = new Date(record.at);
      return { id, level: record.level, event, detail, search: `${event} ${detail}`.toLocaleLowerCase(),
        time: Number.isNaN(date.getTime()) ? record.at : time.format(date) };
    });
  }, [logs, language]);
  const [exporting, setExporting] = useState(false);
  const search = query.trim().toLocaleLowerCase();
  const visibleLogs = formatted.filter(record => (level === "all" || record.level === level) && record.search.includes(search));
  return (
    <ContentSurface subtitle={copy.activitySubtitle} title={copy.activityTitle}>
      <ActivityUsage copy={copy} language={language} />
      <div className="section-heading activity-heading">
        <span>{copy.recentActivity}</span>
        <SecondaryButton
          icon="external"
          disabled={transitionBusy || exporting}
          onClick={() => {
            if (exporting) return;
            setExporting(true);
            void api!.exportLogs().catch((cause) => setError(messageOf(cause))).finally(() => setExporting(false));
          }}
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
        {[...visibleLogs].reverse().map((record) => (
          <div className="activity-row" key={record.id}>
            <StateDot state={record.level === "error" ? "error" : record.level === "warning" ? "busy" : "ready"} />
            <div>
              <strong>{record.event}</strong>
              <span title={record.detail || undefined}>{record.detail}</span>
            </div>
            <time>{record.time}</time>
          </div>
        ))}
      </div>
    </ContentSurface>
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
