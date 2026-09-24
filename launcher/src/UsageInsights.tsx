import { useRef, useState } from "react";
import type { Language, UsageAccountOption, UsageDiagnosticGroup, UsageFailureCode } from "./types";
import { rankUsageDiagnosticGroups, usageAttentionFacts } from "./usage-diagnostics";
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

function duration(value: number | null, language: Language) {
  if (value === null) return "—";
  return value < 60_000
    ? `${(value / 1_000).toLocaleString(language, { maximumFractionDigits: 1 })} s`
    : `${(value / 60_000).toLocaleString(language, { maximumFractionDigits: 1 })} min`;
}

function identity(group: UsageDiagnosticGroup, accounts: UsageAccountOption[], copy: UsageInsightsCopy) {
  if (group.source === "native") {
    return [group.modelId || copy.unknownIdentity, group.endpoint, group.modelIdSource].join(" · ");
  }
  const account = accounts.find(candidate => candidate.id === group.accountId)?.label || copy.unknownIdentity;
  const model = group.modelVersion && group.modelVersion !== "unknown" ? `GPT-${group.modelVersion}` : copy.unknownIdentity;
  const effort = group.effort === "max" ? "Pro"
    : group.effort && group.effort !== "unknown" ? group.effort : copy.unknownIdentity;
  return [account, group.mode, model, group.modelVersionSource, effort, group.messageKind].join(" · ");
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
  completedLabel, failedLabel, cancelledLabel, incompleteLabel }: {
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
}) {
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
          <strong>{identity(group, accounts, copy)}</strong>
          <span>{kind === "failures" ? failures(group, failureLabels, language)
            : kind === "median" ? `${copy.median}: ${duration(eligibility.medianMs, language)}`
            : `${copy.p95}: ${duration(eligibility.p95Ms, language)}`}</span>
          {kind === "failures"
            ? <small>{insufficient ? copy.insufficientEvidence : replace(copy.knownOutcomes, { count: eligibility.knownOutcomes })}</small>
            : <><small>{replace(copy.durationSamples, { count: eligibility.observedSamples })}</small>
              <small>{replace(copy.coverage, { observed: eligibility.observedSamples, eligible: eligibility.eligibleSamples, count: `${eligibility.observedSamples}/${eligibility.eligibleSamples}` })}</small></>}
        </article>;
      })}</div> : hasComparableGroups ? null : <p className="usage-diagnostic-empty">{copy.noComparison}</p>}
      {open ? <div id="usage-diagnostic-details" className="usage-diagnostic-details" ref={detailsRef} tabIndex={-1}>
        <p>{copy.notBestModel}</p>
        <div className="usage-table-scroll"><table className="usage-diagnostic-table">
          <thead><tr><th scope="col">{copy.title}</th><th scope="col">{copy.completionRate}</th>
            <th scope="col">{copy.median}</th><th scope="col">{copy.p95}</th><th scope="col">{copy.coverage}</th></tr></thead>
          <tbody>{ranked.map(({ group, eligibility }) => {
            const insufficient = !eligibility.eligible.failureRate && !eligibility.eligible.median && !eligibility.eligible.p95;
            return <tr key={groupKey(group)} className={insufficient ? "is-insufficient" : undefined}>
              <th scope="row">{identity(group, accounts, copy)}<small>{failures(group, failureLabels, language)}</small></th>
              <td>{!eligibility.eligible.failureRate || group.knownOutcomeCompletionRate === null ? "—"
                : new Intl.NumberFormat(language, { style: "percent", maximumFractionDigits: 1 }).format(group.knownOutcomeCompletionRate)}
                <small>{replace(copy.knownOutcomes, { count: eligibility.knownOutcomes })}</small>
                <small>{completedLabel}: {group.completed.toLocaleString(language)} · {failedLabel}: {group.failed.toLocaleString(language)} · {cancelledLabel}: {group.cancelled.toLocaleString(language)}
                  {group.source === "native" ? ` · ${incompleteLabel}: ${(group.incomplete ?? 0).toLocaleString(language)}` : ""}</small></td>
              <td>{duration(eligibility.medianMs, language)}</td><td>{duration(eligibility.p95Ms, language)}</td>
              <td>{replace(copy.durationSamples, { count: eligibility.observedSamples })}<small>{replace(copy.coverage, { observed: eligibility.observedSamples, eligible: eligibility.eligibleSamples, count: `${eligibility.observedSamples}/${eligibility.eligibleSamples}` })}</small>{insufficient ? <small>{copy.insufficientEvidence}</small> : null}</td>
            </tr>;
          })}</tbody>
        </table></div>
      </div> : null}
    </>}
  </section>;
}
