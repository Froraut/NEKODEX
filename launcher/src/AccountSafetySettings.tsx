import { useEffect, useId, useRef, useState } from "react";
import type { AccountNewSessionWindowStatus, AccountSafetyPolicy, Language } from "./types";
import type { Copy } from "./i18n";
import { Button, Checkbox, TextField, cx } from "./design";

/** A settings form's state for the summary of the disclosure that holds it. */
export type AccountFormState = "saving" | "failed" | "unsaved" | null;

function formatSafetyTime(value: number | string, language: Language): string {
  return new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function AccountSafetySettings({ id, language, safety, resumeRequired = false, disabled, blockedReason, copy, save, resume,
  pacingStatus, onStateChange }: {
  id: string;
  language: Language;
  /** Current local pacing state ("New task pacing: No local hold"), shown in the section. */
  pacingStatus?: { label: string; value: string; held: boolean; retryAt: number | null } | null;
  /** Reports saving / failed / unsaved (or null) for the enclosing disclosure summary. */
  onStateChange?: (state: AccountFormState) => void;
  safety: { policy: AccountSafetyPolicy; cooldownUntil: number; stopped: boolean;
    newSessionWindow: AccountNewSessionWindowStatus | null };
  resumeRequired?: boolean; disabled: boolean; blockedReason?: string; copy: Copy;
  save: (policy: AccountSafetyPolicy) => Promise<boolean>;
  resume: () => void;
}) {
  const normalizedPolicy = { ...safety.policy, newSessionWindow: safety.policy.newSessionWindow ?? null };
  const toDraft = (policy: AccountSafetyPolicy) => ({
    policy, windowEnabled: policy.newSessionWindow != null,
    windowLimit: policy.newSessionWindow?.limit.toString() ?? "",
    windowMinutes: policy.newSessionWindow?.minutes.toString() ?? "",
  });
  const [rawDraft, setRawDraft] = useState(() => toDraft(normalizedPolicy));
  const { policy: draft, windowEnabled, windowLimit, windowMinutes } = rawDraft;
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const savingRef = useRef(false);
  const statusId = useId();
  const saved = JSON.stringify(normalizedPolicy);
  const previous = useRef({ id, saved, raw: JSON.stringify(toDraft(normalizedPolicy)) });
  const submitted = useRef<{ id: string; saved: string; raw: string } | null>(null);
  useEffect(() => {
    const policy: AccountSafetyPolicy = JSON.parse(saved);
    const next = toDraft(policy);
    const prior = previous.current;
    const receipt = submitted.current;
    previous.current = { id, saved, raw: JSON.stringify(next) };
    setRawDraft(current => {
      const raw = JSON.stringify(current);
      const acknowledged = receipt?.id === id && receipt.saved === saved && receipt.raw === raw;
      return prior.id !== id || raw === prior.raw || acknowledged ? next : current;
    });
    if (prior.id !== id) { savingRef.current = false; setSaving(false); submitted.current = null; }
    setFailed(false);
  }, [id, saved]);
  const fields = [
    ["minIntervalSec", copy.pacingInterval, 0, 600],
    ["maxConcurrent", copy.pacingConcurrency, 1, 1000],
    ["breakAfterMinutes", copy.pacingBreakAfter, 1, 240],
    ["breakMinutes", copy.pacingBreakLength, 1, 60],
    ["maxSessionMinutes", copy.pacingSession, 1, 1440],
    ["cooldownMinutes", copy.pacingCooldown, 1, 120],
  ] as const;
  const parsedWindowLimit = windowLimit.trim() === "" ? Number.NaN : Number(windowLimit);
  const parsedWindowMinutes = windowMinutes.trim() === "" ? Number.NaN : Number(windowMinutes);
  const windowValid = !windowEnabled
    || (Number.isInteger(parsedWindowLimit) && parsedWindowLimit >= 1 && parsedWindowLimit <= 10_000
      && Number.isInteger(parsedWindowMinutes) && parsedWindowMinutes >= 1 && parsedWindowMinutes <= 525_600);
  const candidate: AccountSafetyPolicy = {
    ...draft,
    newSessionWindow: windowEnabled
      ? { limit: parsedWindowLimit, minutes: parsedWindowMinutes }
      : null,
  };
  const valid = fields.every(([key, , min, max]) => Number.isInteger(draft[key]) && draft[key] >= min && draft[key] <= max)
    && windowValid;
  const changed = JSON.stringify(candidate) !== saved;
  const dirty = JSON.stringify(rawDraft) !== JSON.stringify(toDraft(normalizedPolicy));
  const windowStatus = safety.newSessionWindow ?? null;
  const windowResetsAt = windowStatus?.resetsAt ?? null;
  const windowStatusText = windowStatus === null
    ? copy.newSessionWindowDisabled
    : copy.newSessionWindowUsage
      .replace("{used}", String(windowStatus.used))
      .replace("{limit}", String(windowStatus.limit))
      .replace("{minutes}", String(windowStatus.windowMinutes))
      .replace("{remaining}", String(windowStatus.remaining));
  const submit = async () => {
    if (disabled || savingRef.current || !changed || !valid) return;
    savingRef.current = true; setSaving(true); setFailed(false);
    const receipt = { id, saved: JSON.stringify(candidate), raw: JSON.stringify(rawDraft) };
    submitted.current = receipt;
    try {
      if (!await save(candidate) && submitted.current === receipt) { submitted.current = null; setFailed(true); }
    } catch {
      if (submitted.current === receipt) { submitted.current = null; setFailed(true); }
    } finally {
      if (previous.current.id === id) { savingRef.current = false; setSaving(false); }
    }
  };
  const formState: AccountFormState = saving ? "saving" : failed ? "failed" : dirty ? "unsaved" : null;
  useEffect(() => { onStateChange?.(formState); }, [formState, onStateChange]);
  // Controls are disabled one by one (not through <fieldset disabled>) so a focused control keeps focus while saving.
  const locked = disabled || saving;
  // The pacing line already names the hold's end time; print "Paused until" only for a different deadline.
  const cooldownShown = pacingStatus?.retryAt != null && Math.abs(pacingStatus.retryAt - safety.cooldownUntil) < 60_000;
  return <section className="accounts-details__section accounts-controls__section" aria-labelledby={`${statusId}-title`}>
    <h3 id={`${statusId}-title`} className="nk-type-label">{copy.pacingTitle}</h3>
    <p>{copy.pacingBody}</p>
    {pacingStatus ? <p className={cx("accounts-caption nk-type-caption", pacingStatus.held && "accounts-attention")}>{pacingStatus.label}: {pacingStatus.value}</p> : null}
    {safety.stopped ? <p role="status" className="accounts-attention">{copy.pacingStopped}</p> : null}
    {safety.cooldownUntil > Date.now() && !cooldownShown ? <p role="status" className="accounts-attention">{copy.pacingUntil}: {formatSafetyTime(safety.cooldownUntil, language)}</p> : null}
    <form className="accounts-form" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <fieldset aria-describedby={statusId}>
        <Checkbox label={copy.pacingEnabled} checked={draft.enabled} disabled={locked}
          onChange={checked => { setFailed(false); setRawDraft({ ...rawDraft, policy: { ...draft, enabled: checked } }); }} />
        <div className="accounts-form__grid">
          {fields.map(([key, label, min, max]) => <TextField key={key} label={label} disabled={locked}
            type="number" min={min} max={max} step={1} required
            aria-describedby={statusId} aria-invalid={!Number.isInteger(draft[key]) || draft[key] < min || draft[key] > max}
            value={Number.isFinite(draft[key]) ? draft[key] : ""}
            onChange={event => { setFailed(false); setRawDraft({ ...rawDraft, policy: { ...draft, [key]: event.target.valueAsNumber } }); }} />)}
        </div>
        <section className="accounts-form__section" aria-labelledby={`${statusId}-window-title`}>
          <h4 id={`${statusId}-window-title`} className="nk-type-label">{copy.newSessionWindowTitle}</h4>
          <p>{copy.newSessionWindowBody}</p>
          <p className="accounts-caption nk-type-caption" role="status">{windowStatusText}</p>
          {windowResetsAt !== null
            ? <p className="accounts-caption nk-type-caption">{copy.newSessionWindowNextSlot}: {formatSafetyTime(windowResetsAt, language)}</p>
            : windowStatus ? <p className="accounts-caption nk-type-caption">{copy.newSessionWindowNoSessions}</p> : null}
          <Checkbox label={copy.newSessionWindowEnabled} checked={windowEnabled} disabled={locked}
            onChange={checked => { setFailed(false); setRawDraft({ ...rawDraft, windowEnabled: checked }); }} />
          {windowEnabled ? <div className="accounts-form__grid">
            <TextField label={copy.newSessionWindowLimit} disabled={locked} type="number" min={1} max={10_000} step={1} required aria-describedby={statusId}
              aria-invalid={!Number.isInteger(parsedWindowLimit) || parsedWindowLimit < 1 || parsedWindowLimit > 10_000}
              value={windowLimit} onChange={event => { setFailed(false); setRawDraft({ ...rawDraft, windowLimit: event.target.value }); }} />
            <TextField label={copy.newSessionWindowMinutes} disabled={locked} type="number" min={1} max={525_600} step={1} required aria-describedby={statusId}
              aria-invalid={!Number.isInteger(parsedWindowMinutes) || parsedWindowMinutes < 1 || parsedWindowMinutes > 525_600}
              value={windowMinutes} onChange={event => { setFailed(false); setRawDraft({ ...rawDraft, windowMinutes: event.target.value }); }} />
          </div> : null}
        </section>
        <div className="accounts-inline-actions">
          <Button type="submit" size="sm" busy={saving} disabled={disabled || !changed || !valid}>
            {saving ? copy.accountFormSaving : copy.pacingSave}
          </Button>
          <Button size="sm" variant="ghost" disabled={disabled || saving || !dirty}
            onClick={() => {
              if (disabled || savingRef.current) return;
              setRawDraft(toDraft(normalizedPolicy)); setFailed(false); submitted.current = null;
            }}>{copy.accountSafetyRestore}</Button>
          {safety.stopped || resumeRequired ? <Button size="sm" disabled={locked}
            onClick={() => { if (!disabled && !savingRef.current) resume(); }}>{copy.pacingResume}</Button> : null}
        </div>
      </fieldset>
      <p id={statusId} className={cx("accounts-form__status nk-type-caption", (!valid || failed) && "is-error")} role={!valid || failed ? "alert" : "status"}>
        {blockedReason || (!valid ? copy.accountSafetyInvalid : failed ? copy.accountFormFailed
          : saving ? copy.accountFormSaving : dirty ? copy.accountFormUnsaved : copy.accountFormSaved)}
      </p>
    </form>
  </section>;
}
