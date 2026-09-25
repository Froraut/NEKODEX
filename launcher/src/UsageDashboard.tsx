import { useUsageReport, type UsageLoader } from "./useUsageReport";
import { UsageCalendar, completeCalendar, dateLabel } from "./UsageCalendar";
import { useMemo } from "react";
import type { Copy } from "./i18n";
import type {
  UsageFailureCode,
  UsageGroup,
  Language,
  UsageRangeDays,
  UsageSource,
  UsageSnapshot,
} from "./types";
import { aggregateUsageGroups, formatUsageDuration, formatUsageRate, usageReportCsv, type UsageDisplayGroup } from "./usage-statistics";
import { UsageInsights } from "./UsageInsights";
import { workflowCopy } from "./workflow-copy";
import "./usage-lifetime.css";

const loadUsage: UsageLoader = query => window.codexWebLauncher!.usage(query);
const ranges: UsageRangeDays[] = [1, 7, 30, 90];
const number = (value: number, language: Language) => value.toLocaleString(language);

const groupLabel = (row: UsageGroup, copy: Copy, source: UsageSource) => {
  if (source === "native") {
    const modelId = row.modelId?.trim();
    return modelId && modelId !== "unknown" ? modelId : copy.usageUnknown;
  }
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
  return formatUsageDuration(value, language, copy.usageSeconds, copy.usageMinutes);
}

function exportReport(report: UsageSnapshot) {
  const scope = report.source === "native" ? "native-recorded-only"
    : report.selectedAccountId !== null ? "selected-account" : "all-accounts";
  const csv = usageReportCsv(report);
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `nekodex-usage-${report.source}-${report.period.startDay}-${report.period.endDay}-${scope}.csv`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function UsageDashboard({ copy, language }: { copy: Copy; language: Language }) {
  const { filters, visible, visibleError, refreshing, knownAccounts, changeFilters, retry } = useUsageReport(loadUsage, copy.usageUnavailable);

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
  const diagnosticGroups = (visible?.diagnosticGroups ?? []).filter(group => group.source === source);

  return <section className="usage-dashboard" aria-labelledby="usage-title">
    <div className="usage-heading">
      <div><h2 id="usage-title">{copy.usageTitle}</h2><p>{sourceBody}</p></div>
      <button className="button-secondary" type="button" disabled={!visible || visible.metrics.total === 0} onClick={() => visible && exportReport({ ...visible, calendar })}>{copy.usageExportCsv}</button>
    </div>
    <div className="usage-filters" role="group" aria-label={copy.usageFilters}>
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
      {refreshing ? <span className="usage-refreshing" role="status">{visible ? copy.usageRefreshing : copy.loading}</span> : null}
    </div>

    {visibleError ? <div className={`usage-notice${stale ? " is-stale" : " is-error"}`} role={stale ? "status" : "alert"}>
      <strong>{stale ? copy.usageStaleTitle : copy.usageUnavailable}</strong><span>{stale ? copy.usageStaleBody : visibleError}</span>
      <button className="button-secondary" type="button" disabled={refreshing} onClick={retry}>{refreshing ? copy.loading : copy.retry}</button>
    </div> : null}

    {!visible ? refreshing ? <div className="usage-loading" role="status">{copy.loading}</div> : visibleError ? null : <div className="usage-loading" role="status">{emptyCopy}</div> : <>
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

      <UsageInsights groups={diagnosticGroups} accounts={visible.accounts} copy={workflowCopy(language).insights}
        language={language} failureLabels={failureLabels} detailsLabel={copy.usageDetailedBreakdown}
        hideDetailsLabel={copy.usageHideTable} completedLabel={copy.usageCompleted} failedLabel={copy.usageFailed}
        cancelledLabel={copy.usageAborted} incompleteLabel={copy.usageIncomplete}
        labels={{ unknown: copy.usageUnknown, group: copy.usageModel, seconds: copy.usageSeconds, minutes: copy.usageMinutes }} />

      <div className="usage-insights">
        <section><span>{copy.usageKnownRate}</span><strong>{rate === null || rate === undefined ? copy.usageNotAvailable : formatUsageRate(rate, language)}</strong>
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

      <UsageCalendar report={visible} copy={copy} language={language} />

      <section className="usage-failures" aria-labelledby="usage-failures-title"><h3 id="usage-failures-title">{copy.usageFailures}</h3>
        {visible.failures.some(item => item.count > 0) ? <ul>{visible.failures.filter(item => item.count > 0).map(item => <li key={item.code}><span>{failureLabels[item.code]}</span><strong>{number(item.count, language)}</strong></li>)}</ul> : <p>{copy.usageNoFailures}</p>}
      </section>
      </>}

      {(groups.length > 0 || lifetimeGroups.length > 0 || (visible.lifetime ?? 0) > 0 || (visible.lifetimeUnclassified ?? 0) > 0) ? <details className="usage-breakdown"><summary>{copy.usageDetailedBreakdown}</summary>
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
