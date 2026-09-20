import { useEffect, useMemo, useRef, useState } from "react";
import type { Copy } from "./i18n";
import type {
  UsageCalendarDay,
  UsageFailureCode,
  UsageGroup,
  Language,
  UsageQuery,
  UsageRangeDays,
  UsageSource,
  UsageSnapshot,
} from "./types";
import { aggregateUsageGroups, normalizedUsageSnapshot, type UsageDisplayGroup } from "./usage-statistics";
import "./usage-lifetime.css";

const ranges: UsageRangeDays[] = [1, 7, 30, 90];
const filterKey = ({ days, source, accountId = null }: UsageQuery) => `${source}:${days}:${source === "web" ? accountId ?? "all" : "native"}`;
const number = (value: number, language: Language) => value.toLocaleString(language);

const groupLabel = (row: UsageGroup, copy: Copy, source: UsageSource) => {
  if (source === "native") return row.modelId?.trim() || copy.usageUnknown;
  const effort = row.effort === "max" ? "Pro" : !row.effort || row.effort === "unknown" ? copy.usageUnknown : row.effort;
  return `${row.mode ?? copy.usageUnknown} · ${effort} · ${!row.modelVersion || row.modelVersion === "unknown" ? copy.usageUnknown : `GPT-${row.modelVersion}`}`;
};

function UsageTable({ caption, groups, copy, language, showIncomplete, showUnrecorded, totalLabel }: { caption: string; groups: UsageDisplayGroup[]; copy: Copy; language: Language; showIncomplete: boolean; showUnrecorded: boolean; totalLabel: string }) {
  return <div className="usage-table-scroll"><table>
    <caption>{caption}</caption>
    <thead><tr><th scope="col">{copy.usageModel}</th><th scope="col">{totalLabel}</th><th scope="col">{copy.usageCompleted}</th><th scope="col">{copy.usageFailed}</th><th scope="col">{copy.usageAborted}</th>{showIncomplete ? <th scope="col">{copy.usageIncomplete}</th> : null}{showUnrecorded ? <th scope="col">{copy.usageUnrecorded}</th> : null}</tr></thead>
    <tbody>{groups.map(({ key, label, row }) => <tr key={key}>
      <th scope="row">{label}</th><td>{number(row.accepted, language)}</td><td>{number(row.completed, language)}</td><td>{number(row.failed, language)}</td><td>{number(row.aborted, language)}</td>
      {showIncomplete ? <td>{number(row.incomplete ?? 0, language)}</td> : null}
      {showUnrecorded ? <td>{number(Math.max(0, row.accepted - row.completed - row.failed - row.aborted - (row.incomplete ?? 0)), language)}</td> : null}
    </tr>)}</tbody>
  </table></div>;
}

function duration(value: number | null, copy: Copy, language: Language) {
  if (value === null || !Number.isFinite(value)) return copy.usageNotAvailable;
  if (value < 60_000) return copy.usageSeconds.replace("{value}", (value / 1_000).toLocaleString(language, { maximumFractionDigits: 1 }));
  return copy.usageMinutes.replace("{value}", (value / 60_000).toLocaleString(language, { maximumFractionDigits: 1 }));
}

function dateLabel(day: string, language: Language, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) {
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(language, { ...options, timeZone: "UTC" }).format(date) : day;
}

function completeCalendar(report: UsageSnapshot): UsageCalendarDay[] {
  const present = new Map(report.calendar.map(day => [day.day, day]));
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(report.period.startDay);
  if (!match) return report.calendar;
  const first = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Array.from({ length: report.period.days }, (_, index) => {
    const date = new Date(first + index * 86_400_000);
    const day = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
    return present.get(day) ?? { day, total: 0, completed: 0, failed: 0, cancelled: 0,
      ...(report.source === "native" ? { incomplete: 0 } : {}), unrecorded: 0 };
  });
}

function csvCell(value: string | number | null) {
  const text = value === null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function exportReport(report: UsageSnapshot) {
  const scope = report.source === "native" ? "native-recorded-only"
    : report.selectedAccountId !== null ? "selected-account" : "all-accounts";
  const header = ["record_type", "source", "scope", "period_start", "period_end", "time_zone", "day", "account_id", "mode", "effort", "model_version", "model_version_source", "message_kind", "endpoint", "model_id", "model_id_source", "total_count", "completed_count", "failed_count", "cancelled_count", "incomplete_count", "unrecorded_count", "known_outcome_count", "known_outcome_completion_rate", "duration_samples", "median_accept_to_outcome_ms", "p95_accept_to_outcome_ms", "input_tokens", "output_tokens", "cached_input_tokens", "reasoning_tokens", "reported_token_samples", "unreported_token_samples", "failure_code", "failure_count"];
  const token = report.tokens;
  type CsvValue = string | number | null | undefined;
  const base = { source: report.source, scope, period_start: report.period.startDay, period_end: report.period.endDay,
    time_zone: report.timeZone };
  const records: Array<Record<string, CsvValue>> = [{ ...base, record_type: "summary",
    total_count: report.metrics.total, completed_count: report.metrics.completed, failed_count: report.metrics.failed,
    cancelled_count: report.metrics.cancelled, incomplete_count: report.metrics.incomplete ?? 0,
    unrecorded_count: report.source === "web" ? report.metrics.unrecorded : null,
    known_outcome_count: report.metrics.knownOutcomeTotal,
    known_outcome_completion_rate: report.metrics.knownOutcomeCompletionRate,
    duration_samples: report.durations.observedSamples, median_accept_to_outcome_ms: report.durations.medianMs,
    p95_accept_to_outcome_ms: report.durations.p95Ms, input_tokens: token?.inputTokens,
    output_tokens: token?.outputTokens, cached_input_tokens: token?.cachedInputTokens,
    reasoning_tokens: token?.reasoningTokens, reported_token_samples: token?.reportedSamples,
    unreported_token_samples: token?.unreportedSamples }];
  for (const day of report.calendar) records.push({ ...base, record_type: "day", day: day.day, total_count: day.total,
    completed_count: day.completed, failed_count: day.failed, cancelled_count: day.cancelled,
    incomplete_count: day.incomplete ?? 0, unrecorded_count: report.source === "web" ? day.unrecorded : null });
  for (const row of report.rows) records.push({ ...base, record_type: "group", account_id: row.accountId,
    mode: row.mode, effort: row.effort, model_version: row.modelVersion, model_version_source: row.modelVersionSource,
    message_kind: row.messageKind, endpoint: row.endpoint, model_id: row.modelId, model_id_source: row.modelIdSource,
    total_count: row.accepted, completed_count: row.completed, failed_count: row.failed, cancelled_count: row.aborted,
    incomplete_count: row.incomplete ?? 0,
    unrecorded_count: report.source === "web"
      ? Math.max(0, row.accepted - row.completed - row.failed - row.aborted - (row.incomplete ?? 0)) : null });
  for (const failure of report.failures) records.push({ ...base, record_type: "failure",
    failure_code: failure.code, failure_count: failure.count });
  const csv = [header, ...records.map(record => header.map(column => record[column] ?? ""))]
    .map(row => row.map(csvCell).join(",")).join("\n") + "\n";
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `nekodex-usage-${report.source}-${report.period.startDay}-${report.period.endDay}-${scope}.csv`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function CalendarChart({ calendar, language, totalLabel }: { calendar: UsageCalendarDay[]; language: Language; totalLabel: string }) {
  const maximum = Math.max(1, ...calendar.map(day => day.total));
  return <div className="usage-calendar" aria-hidden="true">
    <div className="usage-calendar-bars">
      {calendar.map(day => {
        const height = day.total ? Math.max(5, day.total / maximum * 100) : 2;
        const segment = (value: number) => day.total ? `${value / day.total * 100}%` : "0%";
        return <div className="usage-calendar-column" key={day.day} title={`${dateLabel(day.day, language)} · ${totalLabel}: ${day.total}`}>
          <span className={`usage-calendar-bar${day.total ? "" : " is-zero"}`} style={{ height: `${height}%` }}>
            <i className="is-completed" style={{ height: segment(day.completed) }} />
            <i className="is-failed" style={{ height: segment(day.failed) }} />
            <i className="is-cancelled" style={{ height: segment(day.cancelled) }} />
            <i className="is-incomplete" style={{ height: segment(day.incomplete ?? 0) }} />
            <i className="is-unrecorded" style={{ height: segment(day.unrecorded) }} />
          </span>
        </div>;
      })}
    </div>
    <div className="usage-calendar-axis"><span>{dateLabel(calendar[0]?.day ?? "", language)}</span><span>{dateLabel(calendar.at(-1)?.day ?? "", language)}</span></div>
  </div>;
}

function CalendarTable({ calendar, copy, language, showIncomplete, showUnrecorded, totalLabel }: { calendar: UsageCalendarDay[]; copy: Copy; language: Language; showIncomplete: boolean; showUnrecorded: boolean; totalLabel: string }) {
  return <div className="usage-table-scroll"><table className="usage-calendar-table">
    <caption>{copy.usageCalendarTable}</caption>
    <thead><tr><th scope="col">{copy.usageDate}</th><th scope="col">{totalLabel}</th><th scope="col">{copy.usageCompleted}</th><th scope="col">{copy.usageFailed}</th><th scope="col">{copy.usageAborted}</th>{showIncomplete ? <th scope="col">{copy.usageIncomplete}</th> : null}{showUnrecorded ? <th scope="col">{copy.usageUnrecorded}</th> : null}</tr></thead>
    <tbody>{calendar.map(day => <tr key={day.day}><th scope="row">{dateLabel(day.day, language, { year: "numeric", month: "short", day: "numeric" })}</th><td>{number(day.total, language)}</td><td>{number(day.completed, language)}</td><td>{number(day.failed, language)}</td><td>{number(day.cancelled, language)}</td>{showIncomplete ? <td>{number(day.incomplete ?? 0, language)}</td> : null}{showUnrecorded ? <td>{number(day.unrecorded, language)}</td> : null}</tr>)}</tbody>
  </table></div>;
}

export function UsageDashboard({ copy, language }: { copy: Copy; language: Language }) {
  const [filters, setFilters] = useState<UsageQuery>({ days: 7, source: "web", accountId: null });
  const activeKey = filterKey(filters);
  const cache = useRef(new Map<string, UsageSnapshot>());
  const [result, setResult] = useState<{ key: string; report: UsageSnapshot } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [knownAccounts, setKnownAccounts] = useState<UsageSnapshot["accounts"]>([]);
  const [showTable, setShowTable] = useState(false);
  const rawVisible = result?.key === activeKey ? result.report : cache.current.get(activeKey) ?? null;
  const visible = useMemo(() => normalizedUsageSnapshot(rawVisible), [rawVisible]);
  const visibleError = error?.key === activeKey ? error.message : null;
  const changeFilters = (next: UsageQuery) => {
    setError(current => current?.key === filterKey(next) ? current : null);
    setRefreshing(filterKey(next));
    setFilters(next);
  };
  const rememberReport = (key: string, report: UsageSnapshot) => {
    cache.current.delete(key);
    cache.current.set(key, report);
    while (cache.current.size > 12) {
      const oldest = cache.current.keys().next().value;
      if (oldest === undefined) break;
      cache.current.delete(oldest);
    }
  };

  useEffect(() => {
    let disposed = false;
    let pending = false;
    const key = filterKey(filters);
    const refresh = async () => {
      if (document.hidden || pending) return;
      pending = true;
      setRefreshing(key);
      try {
        const next = await window.codexWebLauncher!.usage({ days: filters.days, source: filters.source,
          ...(filters.source === "web" ? { accountId: filters.accountId ?? null } : {}) });
        if (disposed) return;
        if (!next.available) {
          setError({ key, message: next.error ?? copy.usageUnavailable });
          return;
        }
        rememberReport(key, next);
        setResult({ key, report: next });
        if (filters.source === "web") setKnownAccounts(next.accounts);
        setError(current => current?.key === key ? null : current);
      } catch {
        if (!disposed) setError({ key, message: copy.usageUnavailable });
      } finally {
        pending = false;
        if (!disposed) setRefreshing(current => current === key ? null : current);
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    const resume = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
    };
  }, [filters.days, filters.source, filters.accountId, copy.usageUnavailable]);

  const groups = useMemo(() => aggregateUsageGroups(visible?.rows ?? [], visible?.source ?? filters.source,
    (row, source) => groupLabel(row, copy, source)), [visible, copy, filters.source]);
  const lifetimeGroups = useMemo(() => aggregateUsageGroups(visible?.lifetimeGroups ?? [], visible?.source ?? filters.source,
    (row, source) => groupLabel(row, copy, source)), [visible, copy, filters.source]);

  const failureLabels: Record<UsageFailureCode, string> = {
    rate_limit: copy.usageFailureRateLimit,
    safety_stop: copy.usageFailureSafetyStop,
    timeout: copy.usageFailureTimeout,
    browser_failure: copy.usageFailureBrowser,
    other: copy.usageFailureOther,
    unknown: copy.usageFailureUnknown,
    "http-auth": copy.usageFailureHttpAuth,
    "http-rate-limit": copy.usageFailureRateLimit,
    "http-client": copy.usageFailureHttpClient,
    "http-server": copy.usageFailureHttpServer,
    transport: copy.usageFailureTransport,
    stream: copy.usageFailureStream,
    protocol: copy.usageFailureProtocol,
    aborted: copy.usageAborted,
  };
  const calendar = visible ? completeCalendar(visible) : [];
  const activeDays = calendar.filter(day => day.total > 0).length;
  const rate = visible?.metrics.knownOutcomeCompletionRate;
  const generatedAt = visible?.generatedAt ? new Date(visible.generatedAt) : null;
  const stale = Boolean(visible && visibleError);
  const source = visible?.source ?? filters.source;
  const web = source === "web";
  const totalLabel = web ? copy.usageWebTotal : copy.usageNativeTotal;
  const sourceBody = web ? copy.usageBody : copy.usageNativeBody;
  const emptyCopy = web ? copy.usageEmpty : copy.usageNativeEmpty;
  const calendarSummary = web ? copy.usageCalendarSummary : copy.usageNativeCalendarSummary;
  const durationSamples = web ? copy.usageDurationSamples : copy.usageNativeDurationSamples;
  const noDurations = web ? copy.usageNoDurations : copy.usageNativeNoDurations;
  const knownRateBody = web ? copy.usageWebKnownRateBody : copy.usageNativeKnownRateBody;
  const nativeRecordedOnly = copy.usageNativeRecordedOnly;

  return <section className="usage-dashboard" aria-labelledby="usage-title">
    <div className="usage-heading">
      <div><h2 id="usage-title">{copy.usageTitle}</h2><p>{sourceBody}</p></div>
      <button className="button-secondary" type="button" disabled={!visible || visible.metrics.total === 0} onClick={() => visible && exportReport({ ...visible, calendar })}>{copy.usageExportCsv}</button>
    </div>
    <div className="usage-filters" aria-label={copy.usageFilters}>
      <label>{copy.usageSource}<select aria-label={copy.usageSource} className="settings-select" value={filters.source} onChange={event => {
        const nextSource = event.target.value as UsageSource;
        changeFilters({ ...filters, source: nextSource, accountId: null });
      }}><option value="web">{copy.usageSourceWeb}</option><option value="native">{copy.usageSourceNative}</option></select></label>
      {filters.source === "web" ? <label>{copy.usageAccount}<select aria-label={copy.usageAccount} className="settings-select" value={filters.accountId ?? ""}
        onChange={event => changeFilters({ ...filters, accountId: event.target.value || null })}>
        <option value="">{copy.usageAllAccounts}</option>
        {knownAccounts.map(account => <option key={account.id} value={account.id}>{account.label}{account.available ? "" : ` · ${copy.usageAccountUnavailable}`}</option>)}
      </select></label> : <div className="usage-account-boundary"><span>{copy.usageAccount}</span><strong>{copy.usageAccountUnavailable}</strong>
        <small>{copy.usageNativeAccountUnavailable}</small></div>}
      <label>{copy.usageRange}<select aria-label={copy.usageRange} className="settings-select" value={filters.days} onChange={event => changeFilters({ ...filters, days: Number(event.target.value) as UsageRangeDays })}>
        {ranges.map(value => <option key={value} value={value}>{value === 1 ? copy.usageOneDay : `${value} ${copy.usageDays}`}</option>)}
      </select></label>
      {refreshing === activeKey ? <span className="usage-refreshing" role="status">{visible ? copy.usageRefreshing : copy.loading}</span> : null}
    </div>

    {visibleError ? <div className={`usage-notice${stale ? " is-stale" : " is-error"}`} role={stale ? "status" : "alert"}>
      <strong>{stale ? copy.usageStaleTitle : copy.usageUnavailable}</strong><span>{stale ? copy.usageStaleBody : visibleError}</span>
    </div> : null}

    {!visible ? refreshing === activeKey ? <div className="usage-loading" role="status">{copy.loading}</div> : visibleError ? null : <div className="usage-loading" role="status">{emptyCopy}</div> : <>
      <div className="usage-report-meta">
        <span>{copy.usagePeriod.replace("{start}", dateLabel(visible.period.startDay, language)).replace("{end}", dateLabel(visible.period.endDay, language))}</span>
        <span>{copy.usageUpdated.replace("{time}", generatedAt && Number.isFinite(generatedAt.getTime()) ? generatedAt.toLocaleString(language) : copy.usageUnknown)}</span>
      </div>
      {visible.metrics.total === 0 ? <section className="usage-empty-state" role="status"><strong>{emptyCopy}</strong>
        <span>{copy.usageEmptyHelp}</span>
        <span>{calendarSummary.replace("{total}", "0").replace("{active}", "0").replace("{days}", number(visible.period.days, language))}</span>
      </section> : <>
      <div className={`usage-metrics${web ? "" : " is-native"}`}>
        {([
          [totalLabel, visible.metrics.total, "is-total"],
          [copy.usageCompleted, visible.metrics.completed, "is-completed"],
          [copy.usageFailed, visible.metrics.failed, "is-failed"],
          [copy.usageAborted, visible.metrics.cancelled, "is-cancelled"],
          ...(!web ? [[copy.usageIncomplete, visible.metrics.incomplete ?? 0, "is-incomplete"] as const] : []),
          ...(web ? [[copy.usageUnrecorded, visible.metrics.unrecorded, "is-unrecorded"] as const] : []),
        ] as const).map(([label, value, tone]) => <div className={`usage-metric ${tone}`} key={tone}><span>{label}</span><strong>{number(value, language)}</strong></div>)}
      </div>
      {!web ? <p className="usage-recorded-only-note">{nativeRecordedOnly}</p> : null}

      <div className="usage-insights">
        <section><span>{copy.usageKnownRate}</span><strong>{rate === null || rate === undefined ? copy.usageNotAvailable : new Intl.NumberFormat(language, { style: "percent", maximumFractionDigits: 1 }).format(rate)}</strong>
          <p>{visible.metrics.knownOutcomeTotal ? knownRateBody.replace("{completed}", number(visible.metrics.completed, language)).replace("{known}", number(visible.metrics.knownOutcomeTotal, language)) : copy.usageNoKnownOutcomes}</p>
          {visible.metrics.unrecorded > 0 ? <small>{copy.usageUnrecordedExcluded.replace("{count}", number(visible.metrics.unrecorded, language))}</small> : null}
        </section>
        <section><span>{copy.usageDurations}</span><div className="usage-duration-values"><p><strong>{duration(visible.durations.medianMs, copy, language)}</strong><small>{copy.usageMedian}</small></p><p><strong>{duration(visible.durations.p95Ms, copy, language)}</strong><small>{copy.usageP95}</small></p></div>
          <small>{visible.durations.observedSamples ? durationSamples.replace("{count}", number(visible.durations.observedSamples, language)) : noDurations}</small>
        </section>
      </div>

      {!web && visible.tokens ? <section className="usage-token-report" aria-labelledby="usage-token-title">
        <div><h3 id="usage-token-title">{copy.usageTokenUsage}</h3><p>{copy.usageTokenUsageBody}</p></div>
        <dl>{([
          [copy.usageInputTokens, visible.tokens.inputTokens, visible.tokens.reportedSamples],
          [copy.usageOutputTokens, visible.tokens.outputTokens, visible.tokens.reportedSamples],
          [copy.usageCachedInputTokens, visible.tokens.cachedInputTokens, visible.tokens.cachedInputReportedSamples],
          [copy.usageReasoningTokens, visible.tokens.reasoningTokens, visible.tokens.reasoningReportedSamples],
        ] as const).map(([label, value, coverage]) => <div key={label}><dt>{label}</dt><dd>{value == null ? "—" : number(value, language)}
          <small>{coverage === undefined ? "—" : copy.usageTokenFieldCoverage.replace("{count}", number(coverage, language))}</small></dd></div>)}</dl>
        <p>{copy.usageTokenCoverage.replace("{reported}", number(visible.tokens.reportedSamples, language)).replace("{unreported}", number(visible.tokens.unreportedSamples, language))}</p>
      </section> : null}

      <section className="usage-calendar-section" aria-labelledby="usage-calendar-title">
        <div className="usage-section-heading"><div><h3 id="usage-calendar-title">{copy.usageCalendar}</h3><p>{calendarSummary.replace("{total}", number(visible.metrics.total, language)).replace("{active}", number(activeDays, language)).replace("{days}", number(visible.period.days, language))}</p></div>
          <button className="text-button" type="button" aria-expanded={showTable} onClick={() => setShowTable(value => !value)}>{showTable ? copy.usageHideTable : copy.usageShowTable}</button>
        </div>
        <CalendarChart calendar={calendar} language={language} totalLabel={totalLabel} />
        {showTable ? <CalendarTable calendar={calendar} copy={copy} language={language} showIncomplete={!web} showUnrecorded={web} totalLabel={totalLabel} /> : null}
      </section>

      <section className="usage-failures" aria-labelledby="usage-failures-title"><h3 id="usage-failures-title">{copy.usageFailures}</h3>
        {visible.failures.some(item => item.count > 0) ? <ul>{visible.failures.filter(item => item.count > 0).map(item => <li key={item.code}><span>{failureLabels[item.code]}</span><strong>{number(item.count, language)}</strong></li>)}</ul> : <p>{copy.usageNoFailures}</p>}
      </section>
      </>}

      {(groups.length > 0 || lifetimeGroups.length > 0) ? <details className="usage-breakdown"><summary>{copy.usageDetailedBreakdown}</summary>
        {groups.length > 0 ? <UsageTable caption={copy.usageGroups} groups={groups} copy={copy} language={language} showIncomplete={!web} showUnrecorded={web} totalLabel={totalLabel} /> : null}
        {lifetimeGroups.length > 0 ? <UsageTable caption={copy.usageLifetimeGroups} groups={lifetimeGroups} copy={copy} language={language} showIncomplete={!web} showUnrecorded={web} totalLabel={totalLabel} /> : null}
        <p>{copy.usageLifetime}: {number(visible.lifetime ?? 0, language)} · {copy.usageSince}: {visible.startedAt ? new Date(visible.startedAt).toLocaleDateString(language) : copy.usageUnknown}</p>
        {!!visible.lifetimeUnclassified && <p>{copy.usageLifetimeUnclassified}: {number(visible.lifetimeUnclassified, language)}</p>}
      </details> : null}
      {visible.recovered && <p className="usage-notice" role="status">{copy.usageRecovered}</p>}
      {visible.backupAvailable === false && (visible.lifetime ?? 0) > 0 && <p className="usage-notice" role="status">{copy.usageBackupUnavailable}</p>}
    </>}
  </section>;
}
