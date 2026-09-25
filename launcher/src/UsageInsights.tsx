import { useRef, useState } from "react";
import type { Language, UsageAccountOption, UsageDiagnosticGroup, UsageFailureCode } from "./types";
import { rankUsageDiagnosticGroups, usageAttentionFacts } from "./usage-diagnostics";
import { formatUsageDuration, formatUsageRate } from "./usage-statistics";
import "./usage-insights.css";

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

function identityParts(group: UsageDiagnosticGroup, accounts: UsageAccountOption[]) {
  if (group.source === "native") return [known(group.modelId), known(group.endpoint), known(group.modelIdSource)];
  const account = accounts.find(candidate => candidate.id === group.accountId)?.label || null;
  const model = known(group.modelVersion) ? `GPT-${group.modelVersion}` : null;
  const effort = group.effort === "max" ? "Pro" : known(group.effort);
  return [account, known(group.mode), model, known(group.modelVersionSource), effort, known(group.messageKind)];
}

function identity(group: UsageDiagnosticGroup, accounts: UsageAccountOption[], labels: UsageInsightsLabels) {
  return identityParts(group, accounts).map(part => part ?? labels.unknown).join(" · ");
}

function identityIncomplete(group: UsageDiagnosticGroup, accounts: UsageAccountOption[]) {
  return identityParts(group, accounts).some(part => part === null);
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
  completedLabel, failedLabel, cancelledLabel, incompleteLabel, labels }: {
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

  return <section className="usage-diagnostic-insights" aria-labelledby="usage-diagnostic-title">
    <div className="usage-diagnostic-heading">
      <div><h3 id="usage-diagnostic-title">{copy.title}</h3><p>{copy.body}</p></div>
      {ranked.length ? <button className="text-button" type="button" aria-expanded={open}
        aria-controls="usage-diagnostic-details" onClick={toggle}>{open ? hideDetailsLabel : detailsLabel}</button> : null}
    </div>
    {!ranked.length ? <p className="usage-diagnostic-empty">{copy.noComparison}</p> : <>
      {facts.length ? <div className="usage-diagnostic-facts">{facts.map(({ group, eligibility, kind }) => {
        const insufficient = kind === "failures" && !eligibility.eligible.failureRate;
        return <article key={`${groupKey(group)}:${kind}`} className={insufficient ? "is-insufficient" : undefined}>
          <strong>{identity(group, accounts, text)}</strong>{note(group)}
          <span>{kind === "failures" ? failures(group, failureLabels, language)
            : kind === "median" ? `${copy.median}: ${duration(eligibility.medianMs, language, text)}`
            : `${copy.p95}: ${duration(eligibility.p95Ms, language, text)}`}</span>
          {kind === "failures"
            ? <small>{insufficient ? copy.insufficientEvidence : replace(copy.knownOutcomes, { count: eligibility.knownOutcomes })}</small>
            : <><small>{replace(copy.durationSamples, { count: eligibility.observedSamples })}</small>
              <small>{replace(copy.coverage, { observed: eligibility.observedSamples, eligible: eligibility.eligibleSamples, count: `${eligibility.observedSamples}/${eligibility.eligibleSamples}` })}</small></>}
        </article>;
      })}</div> : hasComparableGroups ? null : <p className="usage-diagnostic-empty">{copy.noComparison}</p>}
      {open ? <div id="usage-diagnostic-details" className="usage-diagnostic-details" ref={detailsRef} tabIndex={-1}>
        <p>{copy.notBestModel}</p>
        <div className="usage-table-scroll"><table className="usage-diagnostic-table">
          <caption className="visually-hidden">{copy.title}</caption>
          <thead><tr><th scope="col">{text.group}</th><th scope="col">{copy.completionRate}</th>
            <th scope="col">{copy.median}</th><th scope="col">{copy.p95}</th><th scope="col">{copy.coverage}</th></tr></thead>
          <tbody>{ranked.map(({ group, eligibility }) => {
            const insufficient = !eligibility.eligible.failureRate && !eligibility.eligible.median && !eligibility.eligible.p95;
            return <tr key={groupKey(group)} className={insufficient ? "is-insufficient" : undefined}>
              <th scope="row">{identity(group, accounts, text)}{note(group)}<small>{failures(group, failureLabels, language)}</small></th>
              <td>{!eligibility.eligible.failureRate || group.knownOutcomeCompletionRate === null ? "—"
                : formatUsageRate(group.knownOutcomeCompletionRate, language)}
                <small>{replace(copy.knownOutcomes, { count: eligibility.knownOutcomes })}</small>
                <small>{completedLabel}: {group.completed.toLocaleString(language)} · {failedLabel}: {group.failed.toLocaleString(language)} · {cancelledLabel}: {group.cancelled.toLocaleString(language)}
                  {group.source === "native" ? ` · ${incompleteLabel}: ${(group.incomplete ?? 0).toLocaleString(language)}` : ""}</small></td>
              <td>{duration(eligibility.medianMs, language, text)}</td><td>{duration(eligibility.p95Ms, language, text)}</td>
              <td>{replace(copy.durationSamples, { count: eligibility.observedSamples })}<small>{replace(copy.coverage, { observed: eligibility.observedSamples, eligible: eligibility.eligibleSamples, count: `${eligibility.observedSamples}/${eligibility.eligibleSamples}` })}</small>{insufficient ? <small>{copy.insufficientEvidence}</small> : null}</td>
            </tr>;
          })}</tbody>
        </table></div>
      </div> : null}
    </>}
  </section>;
}
