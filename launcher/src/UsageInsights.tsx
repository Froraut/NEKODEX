import { Fragment, useRef, useState } from "react";
import type { Language, UsageAccountOption, UsageDiagnosticGroup, UsageFailureCode } from "./types";
import { rankUsageDiagnosticGroups, usageAttentionFacts } from "./usage-diagnostics";
import { formatUsageDuration, formatUsageRate } from "./usage-statistics";
import { Button, EmptyState, Panel } from "./design";

/** Localised words for the identity parts (mode, effort, version or model source, message kind). */
export interface UsageIdentityWords {
  mode: (value: string) => string;
  effort: (value: string) => string;
  versioned: (model: string, source: string | null) => string;
  reported: (model: string, source: string | null) => string;
  messageKind: (value: string) => string;
}

const rawWords: UsageIdentityWords = {
  mode: value => value, effort: value => value === "max" ? "Pro" : value, messageKind: value => value,
  versioned: (model, source) => source ? `${model} (${source})` : model, reported: (model, source) => source ? `${model} (${source})` : model,
};

export interface UsageInsightsCopy {
  title: string;
  body: string;
  completionRate: string;
  median: string;
  p95: string;
  knownOutcomes: string;
  durationSamples: string;
  coverage: string;
  insufficientEvidence: string;
  unknownIdentity: string;
  noComparison: string;
  notBestModel: string;
}

const replace = (value: string, fields: Record<string, string | number>) =>
  Object.entries(fields).reduce((text, [key, field]) => text.replaceAll(`{${key}}`, String(field)), value);

/** A "{label}: {count}" template as a column header ("Observed sample coverage"). */
const columnLabel = (template: string) => template.replace(/\s*[:：]\s*\{count\}\s*$/, "");

export interface UsageInsightsLabels {
  /** Short placeholder for one unreported identity field; the full explanation is shown once per group. */
  unknown: string;
  group: string;
  seconds: string;
  minutes: string;
}

const defaultLabels: UsageInsightsLabels = { unknown: "?", group: "", seconds: "{value} s", minutes: "{value} min" };

function duration(value: number | null, language: Language, labels: UsageInsightsLabels) {
  if (value === null || !Number.isFinite(value)) return "—";
  return formatUsageDuration(value, language, labels.seconds, labels.minutes);
}

const known = (value: string | null | undefined) => value && value.trim() && value !== "unknown" ? value : null;

/** Identity parts in reading order; null marks a field that was not reported (shown as "unknown", never guessed). */
function identityParts(group: UsageDiagnosticGroup, accounts: UsageAccountOption[], words: UsageIdentityWords) {
  if (group.source === "native") {
    const model = known(group.modelId);
    return [model ? words.reported(model, known(group.modelIdSource)) : null, known(group.endpoint)];
  }
  const account = accounts.find(candidate => candidate.id === group.accountId)?.label || null;
  const model = known(group.modelVersion) ? words.versioned(`GPT-${group.modelVersion}`, known(group.modelVersionSource)) : null;
  const mode = known(group.mode), effort = known(group.effort), kind = known(group.messageKind);
  return [account, mode && words.mode(mode), model, effort && words.effort(effort), kind && words.messageKind(kind)];
}

function identity(group: UsageDiagnosticGroup, accounts: UsageAccountOption[], labels: UsageInsightsLabels, words: UsageIdentityWords) {
  return identityParts(group, accounts, words).map(part => part ?? labels.unknown).join(" · ");
}

function identityIncomplete(group: UsageDiagnosticGroup, accounts: UsageAccountOption[]) {
  const fields = group.source === "native" ? [group.modelId, group.endpoint, group.modelIdSource]
    : [accounts.find(candidate => candidate.id === group.accountId)?.label, group.mode, group.modelVersion, group.modelVersionSource, group.effort, group.messageKind];
  return fields.some(field => !known(field));
}

function groupKey(group: UsageDiagnosticGroup) {
  return group.source === "web"
    ? [group.source, group.accountId, group.mode, group.effort, group.modelVersion, group.modelVersionSource, group.messageKind].join(":")
    : [group.source, group.endpoint, group.modelId, group.modelIdSource].join(":");
}

function failures(group: UsageDiagnosticGroup, labels: Partial<Record<UsageFailureCode, string>>, language: Language) {
  const visible = group.failures.filter(failure => failure.count > 0);
  return visible.length ? visible.map(failure => `${labels[failure.code] ?? failure.code}: ${failure.count.toLocaleString(language)}`).join(", ") : "—";
}

export function UsageInsights({ groups, accounts, copy, language, failureLabels, detailsLabel, hideDetailsLabel,
  completedLabel, failedLabel, cancelledLabel, incompleteLabel, labels, words = rawWords }: {
  groups: UsageDiagnosticGroup[];
  accounts: UsageAccountOption[];
  copy: UsageInsightsCopy;
  language: Language;
  failureLabels: Partial<Record<UsageFailureCode, string>>;
  detailsLabel: string;
  hideDetailsLabel: string;
  completedLabel: string;
  failedLabel: string;
  cancelledLabel: string;
  incompleteLabel: string;
  labels?: Partial<UsageInsightsLabels>;
  words?: UsageIdentityWords;
}) {
  const text = { ...defaultLabels, unknown: copy.unknownIdentity, group: copy.title, ...labels };
  const note = (group: UsageDiagnosticGroup) => text.unknown !== copy.unknownIdentity && identityIncomplete(group, accounts)
    ? <small className="usage-identity-note">{copy.unknownIdentity}</small> : null;
  const [open, setOpen] = useState(false);
  const detailsRef = useRef<HTMLDivElement>(null);
  const source = groups[0]?.source;
  const scoped = source ? groups.filter(group => group.source === source) : [];
  const ranked = source ? rankUsageDiagnosticGroups(scoped, source) : [];
  const facts = source ? usageAttentionFacts(scoped, source) : [];
  const hasComparableGroups = ranked.some(({ eligibility }) =>
    eligibility.eligible.failureRate || eligibility.eligible.median || eligibility.eligible.p95);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) requestAnimationFrame(() => detailsRef.current?.focus());
  };

  // The table toggle sits under the facts, just above the table it opens (in the header it would wrap between the
  // title and the description in a narrow workspace).
  return <Panel headingLevel={3} titleId="usage-diagnostic-title" title={copy.title} description={copy.body} className="usage-diagnostic-insights">
    {!ranked.length ? <EmptyState icon="activity" title={copy.noComparison} /> : <>
      {facts.length ? <div className="usage-diagnostic-facts">{facts.map(({ group, eligibility, kind }) => {
        const insufficient = kind === "failures" && !eligibility.eligible.failureRate;
        return <article key={`${groupKey(group)}:${kind}`} className={insufficient ? "is-insufficient" : undefined}>
          <strong>{identity(group, accounts, text, words)}</strong>{note(group)}
          <span>{kind === "failures" ? failures(group, failureLabels, language)
            : kind === "median" ? `${copy.median}: ${duration(eligibility.medianMs, language, text)}`
            : `${copy.p95}: ${duration(eligibility.p95Ms, language, text)}`}</span>
          {kind === "failures"
            ? <small>{insufficient ? copy.insufficientEvidence : replace(copy.knownOutcomes, { count: eligibility.knownOutcomes })}</small>
            : <><small>{replace(copy.durationSamples, { count: eligibility.observedSamples })}</small>
              <small>{replace(copy.coverage, { observed: eligibility.observedSamples, eligible: eligibility.eligibleSamples, count: `${eligibility.observedSamples}/${eligibility.eligibleSamples}` })}</small></>}
        </article>;
      })}</div> : hasComparableGroups ? null : <EmptyState icon="activity" title={copy.noComparison} />}
      <div className="usage-diagnostic-toggle">
        <Button variant="ghost" size="sm" aria-expanded={open} aria-controls={open ? "usage-diagnostic-details" : undefined}
          onClick={toggle}>{open ? hideDetailsLabel : detailsLabel}</Button>
      </div>
      {open ? <div id="usage-diagnostic-details" className="usage-diagnostic-details" ref={detailsRef} tabIndex={-1}>
        <p>{copy.notBestModel}</p>
        <div className="usage-table-scroll"><table className="usage-table usage-diagnostic-table">
          <caption className="nk-visually-hidden">{copy.title}</caption>
          <thead><tr><th scope="col">{text.group}</th><th scope="col">{copy.completionRate}</th>
            <th scope="col">{copy.median}</th><th scope="col">{copy.p95}</th><th scope="col">{columnLabel(copy.coverage)}</th></tr></thead>
          <tbody>{ranked.map(({ group, eligibility }) => {
            const insufficient = !eligibility.eligible.failureRate && !eligibility.eligible.median && !eligibility.eligible.p95;
            return <tr key={groupKey(group)} className={insufficient ? "is-insufficient" : undefined}>
              <th scope="row">{identity(group, accounts, text, words)}{note(group)}<small>{failures(group, failureLabels, language)}</small></th>
              <td>{!eligibility.eligible.failureRate || group.knownOutcomeCompletionRate === null ? "—"
                : formatUsageRate(group.knownOutcomeCompletionRate, language)}
                <small>{replace(copy.knownOutcomes, { count: eligibility.knownOutcomes })}</small>
                <small className="usage-pairs">{[[completedLabel, group.completed], [failedLabel, group.failed], [cancelledLabel, group.cancelled],
                  ...(group.source === "native" ? [[incompleteLabel, group.incomplete ?? 0] as const] : [])].map(([label, count], index) =>
                  <Fragment key={label}>{index ? " · " : null}<span>{label}: {count.toLocaleString(language)}</span></Fragment>)}</small></td>
              <td>{duration(eligibility.medianMs, language, text)}</td><td>{duration(eligibility.p95Ms, language, text)}</td>
              <td>{replace(copy.durationSamples, { count: eligibility.observedSamples })}<small>{replace(copy.coverage, { observed: eligibility.observedSamples, eligible: eligibility.eligibleSamples, count: `${eligibility.observedSamples}/${eligibility.eligibleSamples}` })}</small>{insufficient ? <small>{copy.insufficientEvidence}</small> : null}</td>
            </tr>;
          })}</tbody>
        </table></div>
      </div> : null}
    </>}
  </Panel>;
}
