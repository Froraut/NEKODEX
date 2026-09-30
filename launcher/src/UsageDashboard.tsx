import { useUsageReport, type UsageLoader } from "./useUsageReport";
import { UsageCalendar, completeCalendar, dateLabel, dateRangeLabel } from "./UsageCalendar";
import languages from "../electron/languages.json";
import { activityCopy, usageIdentityWords } from "./activity-copy";
import { useEffect, useId, useLayoutEffect, useMemo, useRef } from "react";
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
import { UsageInsights, type UsageIdentityWords } from "./UsageInsights";
import { Button, Disclosure, EmptyState, Notice, Panel, Select, Stat, StatGroup, StateDot, type Status } from "./design";
import { workflowCopy } from "./workflow-copy";

const loadUsage: UsageLoader = query => window.codexWebLauncher!.usage(query);
const ranges: UsageRangeDays[] = [1, 7, 30, 90];
const number = (value: number, language: Language) => value.toLocaleString(language);

const known = (value: string | null | undefined) => value && value.trim() && value !== "unknown" ? value : null;

const groupLabel = (row: UsageGroup, copy: Copy, source: UsageSource, words: UsageIdentityWords) => {
  if (source === "native") return known(row.modelId?.trim()) ?? copy.usageUnknown;
  const mode = known(row.mode), effort = known(row.effort), version = known(row.modelVersion);
  return `${mode ? words.mode(mode) : copy.usageUnknown} · ${effort ? words.effort(effort) : copy.usageUnknown} · ${version ? `GPT-${version}` : copy.usageUnknown}`;
};

function UsageTable({ caption, groups, copy, language, showIncomplete, showUnrecorded, totalLabel }: { caption: string; groups: UsageDisplayGroup[]; copy: Copy; language: Language; showIncomplete: boolean; showUnrecorded: boolean; totalLabel: string }) {
  return <div className="usage-table-scroll"><table className="usage-table">
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

/** A Stat label led by the outcome's status dot. */
const outcomeLabel = (label: string, state?: Status) => state ? <><StateDot state={state} />{label}</> : label;

export function UsageDashboard({ copy, language }: { copy: Copy; language: Language }) {
  const { filters, visible, visibleError, refreshing, knownAccounts, changeFilters, retry } = useUsageReport(loadUsage, copy.usageUnavailable);
  const sourceId = useId(), accountId = useId(), rangeId = useId();
  const text = activityCopy(language);
  const heading = useRef<HTMLHeadingElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  const retryHadFocus = useRef(false);
  useEffect(() => {
    // focusin does not fire when the focused button is removed, so this still holds when the notice goes away.
    const track = (event: FocusEvent) => { retryHadFocus.current = retryButton.current !== null && event.target === retryButton.current; };
    document.addEventListener("focusin", track);
    return () => document.removeEventListener("focusin", track);
  }, []);
  // A report that loads (after Retry or a background refresh) removes the notice with its focused Retry button:
  // continue from this view's heading.
  useLayoutEffect(() => {
    if (visibleError || !retryHadFocus.current) return;
    retryHadFocus.current = false;
    const active = document.activeElement;
    if (!active || active === document.body) heading.current?.focus();
  }, [visibleError]);
  const locale = languages[language]?.locale ?? language;
  const words = useMemo<UsageIdentityWords>(() => ({ ...usageIdentityWords(activityCopy(language)),
    mode: value => value === "automatic" ? copy.automaticShort : value === "manual" ? copy.manualShort : value }), [language, copy]);

  const groups = useMemo(() => aggregateUsageGroups(visible?.rows ?? [], visible?.source ?? filters.source,
    (row, source) => groupLabel(row, copy, source, words)), [visible, copy, filters.source, words]);
  const lifetimeGroups = useMemo(() => aggregateUsageGroups(visible?.lifetimeGroups ?? [], visible?.source ?? filters.source,
    (row, source) => groupLabel(row, copy, source, words)), [visible, copy, filters.source, words]);

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
  const insightsCopy = workflowCopy(language).insights;
  const calendar = visible ? completeCalendar(visible) : [];
  const rate = visible?.metrics.knownOutcomeCompletionRate;
  const generatedAt = visible?.generatedAt ? new Date(visible.generatedAt) : null;
  const stale = Boolean(visible && visibleError);
  const source = visible?.source ?? filters.source;
  const web = source === "web";
  const totalLabel = web ? copy.usageWebTotal : copy.usageNativeTotal;
  const sourceBody = web ? copy.usageBody : copy.usageNativeBody;
  const emptyCopy = web ? copy.usageEmpty : copy.usageNativeEmpty;
  const durationSamples = web ? copy.usageDurationSamples : copy.usageNativeDurationSamples;
  const noDurations = web ? copy.usageNoDurations : copy.usageNativeNoDurations;
  const knownRateBody = web ? copy.usageWebKnownRateBody : copy.usageNativeKnownRateBody;
  const nativeRecordedOnly = copy.usageNativeRecordedOnly;
  const diagnosticGroups = (visible?.diagnosticGroups ?? []).filter(group => group.source === source);
  // Cancellations have their own column and stat; "Failures" lists failures only.
  const failures = visible?.failures.filter(item => item.count > 0 && item.code !== "aborted") ?? [];
  const rateValue = rate === null || rate === undefined ? copy.usageNotAvailable : formatUsageRate(rate, language);
  const medianValue = visible ? duration(visible.durations.medianMs, copy, language) : copy.usageNotAvailable;
  const p95Value = visible ? duration(visible.durations.p95Ms, copy, language) : copy.usageNotAvailable;
  const exportable = Boolean(visible && visible.metrics.total > 0);
  // The generic "unavailable" message is already the title; the body then gives the next step instead of repeating it.
  const errorBody = stale ? copy.usageStaleBody : visibleError === copy.usageUnavailable ? text.usageUnavailableBody : visibleError;

  // The view tab already shows "Local usage", so the heading is for assistive navigation only. The CSV export is this
  // view's own header action, shown only when there is something to export.
  return <section className="usage-dashboard" aria-labelledby="usage-title">
    <header className="usage-header">
      <div>
        <h2 className="nk-visually-hidden" id="usage-title" ref={heading} tabIndex={-1}>{copy.usageTitle}</h2>
        <p>{sourceBody}</p>
      </div>
      {exportable ? <Button size="sm" icon="external" onClick={() => visible && exportReport({ ...visible, calendar })}>{copy.usageExportCsv}</Button> : null}
    </header>

    <div className="usage-filters" role="group" aria-label={copy.usageFilters}>
      <div className="nk-field">
        <label htmlFor={sourceId}>{copy.usageSource}</label>
        <Select id={sourceId} value={filters.source}
          options={[{ value: "web", label: copy.usageSourceWeb }, { value: "native", label: copy.usageSourceNative }]}
          onChange={value => changeFilters({ ...filters, source: value as UsageSource, accountId: null })} />
      </div>
      {filters.source === "web" ? <div className="nk-field">
        <label htmlFor={accountId}>{copy.usageAccount}</label>
        <Select id={accountId} value={filters.accountId ?? ""}
          options={[{ value: "", label: copy.usageAllAccounts }, ...knownAccounts.map(account => ({
            value: account.id, label: `${account.label}${account.available ? "" : ` · ${copy.usageAccountUnavailable}`}`,
          }))]}
          onChange={value => changeFilters({ ...filters, accountId: value || null })} />
      </div> : <div className="usage-account-boundary">
        <span>{copy.usageAccount}</span>
        <strong>{copy.usageAccountUnavailable}</strong>
        <small>{copy.usageNativeAccountUnavailable}</small>
      </div>}
      <div className="nk-field">
        <label htmlFor={rangeId}>{copy.usageRange}</label>
        <Select id={rangeId} value={String(filters.days)}
          options={ranges.map(value => ({ value: String(value), label: value === 1 ? copy.usageOneDay : `${value} ${copy.usageDays}` }))}
          onChange={value => changeFilters({ ...filters, days: Number(value) as UsageRangeDays })} />
      </div>
      {refreshing ? <span className="usage-refreshing" role="status"><StateDot state="busy" />{visible ? copy.usageRefreshing : copy.loading}</span> : null}
    </div>

    {visibleError ? <Notice tone={stale ? "warning" : "error"} title={stale ? copy.usageStaleTitle : copy.usageUnavailable}
      action={<Button size="sm" busy={refreshing} ref={retryButton} onClick={retry}>{text.retryUsage}</Button>}>
      {errorBody}
    </Notice> : null}

    {!visible ? refreshing ? <p className="usage-status" role="status">{copy.loading}</p> : visibleError ? null
      : <Panel className="usage-empty"><div role="status"><EmptyState icon="activity" title={emptyCopy} /></div></Panel> : <>
      {visible.recovered ? <Notice>{copy.usageRecovered}</Notice> : null}
      {visible.backupAvailable === false && (visible.lifetime ?? 0) > 0 ? <Notice tone="warning">{copy.usageBackupUnavailable}</Notice> : null}

      <p className="usage-meta">
        <span>{dateRangeLabel(visible.period.startDay, visible.period.endDay, language,
          copy.usagePeriod.replace("{start}", dateLabel(visible.period.startDay, language)).replace("{end}", dateLabel(visible.period.endDay, language)))}</span>
        <span>{copy.usageUpdated.replace("{time}", generatedAt && Number.isFinite(generatedAt.getTime())
          ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(generatedAt) : copy.usageUnknown)}</span>
      </p>

      {visible.metrics.total === 0 ? <Panel className="usage-empty"><div role="status">
        <EmptyState icon="activity" title={emptyCopy}>{copy.usageEmptyHelp}</EmptyState>
      </div></Panel> : <>
        <div className="usage-figures">
          <StatGroup className={`usage-stats${web ? "" : " is-native"}`} label={copy.usageTitle}>
            <Stat label={totalLabel} value={number(visible.metrics.total, language)} />
            <Stat label={outcomeLabel(copy.usageCompleted, "ready")} value={number(visible.metrics.completed, language)} />
            <Stat label={outcomeLabel(copy.usageFailed, "error")} value={number(visible.metrics.failed, language)} />
            <Stat label={outcomeLabel(copy.usageAborted, "idle")} value={number(visible.metrics.cancelled, language)} />
            {web
              ? <Stat label={outcomeLabel(copy.usageUnrecorded, "idle")} value={number(visible.metrics.unrecorded, language)} />
              : <Stat label={outcomeLabel(copy.usageIncomplete, "optional")} value={number(visible.metrics.incomplete ?? 0, language)} />}
          </StatGroup>
          {!web ? <p className="usage-note">{nativeRecordedOnly}</p> : null}
          <StatGroup className="usage-stats usage-stats--rates">
            <Stat label={copy.usageKnownRate} value={rateValue}
              note={<>
                {visible.metrics.knownOutcomeTotal ? knownRateBody.replace("{completed}", number(visible.metrics.completed, language)).replace("{known}", number(visible.metrics.knownOutcomeTotal, language)) : copy.usageNoKnownOutcomes}
                {visible.metrics.unrecorded > 0 ? <> {copy.usageUnrecordedExcluded.replace("{count}", number(visible.metrics.unrecorded, language))}</> : null}
              </>} />
            <Stat label={insightsCopy.median} value={medianValue}
              note={visible.durations.observedSamples ? durationSamples.replace("{count}", number(visible.durations.observedSamples, language)) : noDurations} />
            <Stat label={insightsCopy.p95} value={p95Value} />
          </StatGroup>
        </div>

        {!web && visible.tokens ? <Panel headingLevel={3} titleId="usage-token-title" title={copy.usageTokenUsage} description={copy.usageTokenUsageBody} className="usage-tokens">
          <dl>{([
            [copy.usageInputTokens, visible.tokens.inputTokens, visible.tokens.reportedSamples],
            [copy.usageOutputTokens, visible.tokens.outputTokens, visible.tokens.reportedSamples],
            [copy.usageCachedInputTokens, visible.tokens.cachedInputTokens, visible.tokens.cachedInputReportedSamples],
            [copy.usageReasoningTokens, visible.tokens.reasoningTokens, visible.tokens.reasoningReportedSamples],
          ] as const).map(([label, value, coverage]) => <div key={label}><dt>{label}</dt><dd>{value == null ? "—" : number(value, language)}
            <small>{coverage === undefined ? "—" : copy.usageTokenFieldCoverage.replace("{count}", number(coverage, language))}</small></dd></div>)}</dl>
          <p className="usage-note">{copy.usageTokenCoverage.replace("{reported}", number(visible.tokens.reportedSamples, language)).replace("{unreported}", number(visible.tokens.unreportedSamples, language))}</p>
        </Panel> : null}

        <UsageInsights groups={diagnosticGroups} accounts={visible.accounts} copy={insightsCopy}
          language={language} failureLabels={failureLabels} detailsLabel={text.showComparison} words={words}
          hideDetailsLabel={text.hideComparison} completedLabel={copy.usageCompleted} failedLabel={copy.usageFailed}
          cancelledLabel={copy.usageAborted} incompleteLabel={copy.usageIncomplete}
          labels={{ unknown: copy.usageUnknown, group: copy.usageModel, seconds: copy.usageSeconds, minutes: copy.usageMinutes }} />

        <div className="usage-columns">
          <UsageCalendar report={visible} copy={copy} text={text} language={language} />
          <Panel headingLevel={3} titleId="usage-failures-title" title={copy.usageFailures} className="usage-failures">
            {failures.length ? <ul>{failures.map(item => <li key={item.code}><span>{failureLabels[item.code]}</span><strong>{number(item.count, language)}</strong></li>)}</ul>
              : <EmptyState icon="info" title={copy.usageNoFailures} />}
          </Panel>
        </div>
      </>}

      {(groups.length > 0 || lifetimeGroups.length > 0 || (visible.lifetime ?? 0) > 0 || (visible.lifetimeUnclassified ?? 0) > 0) ? <Disclosure className="usage-breakdown" title={copy.usageDetailedBreakdown}><div className="usage-breakdown__content">
        {groups.length > 0 ? <UsageTable caption={copy.usageGroups} groups={groups} copy={copy} language={language} showIncomplete={!web} showUnrecorded={web} totalLabel={totalLabel} /> : null}
        {lifetimeGroups.length > 0 ? <UsageTable caption={copy.usageLifetimeGroups} groups={lifetimeGroups} copy={copy} language={language} showIncomplete={!web} showUnrecorded={web} totalLabel={totalLabel} /> : null}
        <p>{copy.usageLifetime}: <span className="usage-figure">{number(visible.lifetime ?? 0, language)}</span> · {copy.usageSince}: {visible.startedAt && Number.isFinite(new Date(visible.startedAt).getTime())
          ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(visible.startedAt)) : copy.usageUnknown}</p>
        {!!visible.lifetimeUnclassified && <p>{copy.usageLifetimeUnclassified}: <span className="usage-figure">{number(visible.lifetimeUnclassified, language)}</span></p>}
      </div></Disclosure> : null}
    </>}
  </section>;
}
