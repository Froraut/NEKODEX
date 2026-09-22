import languages from "../electron/languages.json";
import { useState } from "react";
import { UsageDashboard } from "./UsageDashboard";
import { Icon } from "./icons";
import { ContentSurface, StateDot, SecondaryButton, messageOf } from "./launcher-ui";
import type { Copy } from "./i18n";
import type { Language, LogRecord } from "./types";
const api = window.codexWebLauncher;

export function ActivitySurface({
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
