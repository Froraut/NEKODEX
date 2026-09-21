import { useEffect, useId, useRef, useState } from "react";
import type { AccountNewSessionWindowStatus, AccountSafetyPolicy } from "./types";
import type { Copy } from "./i18n";
import "./account-forms.css";

export function AccountSafetySettings({ id, safety, disabled, blockedReason, copy, save, resume }: {
  id: string;
  safety: { policy: AccountSafetyPolicy; cooldownUntil: number; stopped: boolean;
    newSessionWindow: AccountNewSessionWindowStatus | null };
  disabled: boolean; blockedReason?: string; copy: Copy;
  save: (policy: AccountSafetyPolicy) => Promise<boolean>;
  resume: () => void;
}) {
  const normalizedPolicy = { ...safety.policy, newSessionWindow: safety.policy.newSessionWindow ?? null };
  const [draft, setDraft] = useState(normalizedPolicy);
  const [windowEnabled, setWindowEnabled] = useState(normalizedPolicy.newSessionWindow !== null);
  const [windowLimit, setWindowLimit] = useState(normalizedPolicy.newSessionWindow?.limit.toString() ?? "");
  const [windowMinutes, setWindowMinutes] = useState(normalizedPolicy.newSessionWindow?.minutes.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const savingRef = useRef(false);
  const statusId = useId();
  const saved = JSON.stringify(normalizedPolicy);
  useEffect(() => {
    const policy = JSON.parse(saved) as AccountSafetyPolicy;
    setDraft(policy);
    setWindowEnabled(policy.newSessionWindow !== null);
    setWindowLimit(policy.newSessionWindow?.limit.toString() ?? "");
    setWindowMinutes(policy.newSessionWindow?.minutes.toString() ?? "");
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
    try { if (!await save(candidate)) setFailed(true); }
    finally { savingRef.current = false; setSaving(false); }
  };
  return <details className="account-safety account-form-panel">
    <summary>{copy.pacingTitle}</summary>
    <p>{copy.pacingBody}</p>
    {safety.stopped ? <p role="status">{copy.pacingStopped}</p> : null}
    {safety.cooldownUntil > Date.now() ? <p role="status">{copy.pacingUntil}: {new Date(safety.cooldownUntil).toLocaleString()}</p> : null}
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <fieldset disabled={disabled || saving} aria-describedby={statusId}>
        <label className="account-policy-enabled"><span><input type="checkbox" checked={draft.enabled}
          onChange={event => { setFailed(false); setDraft({ ...draft, enabled: event.target.checked }); }} /> {copy.pacingEnabled}</span></label>
        {fields.map(([key, label, min, max]) => <label key={key}>
          {label}
          <input type="number" min={min} max={max} step={1} required
            aria-describedby={statusId} aria-invalid={!Number.isInteger(draft[key]) || draft[key] < min || draft[key] > max}
            value={Number.isFinite(draft[key]) ? draft[key] : ""}
            onChange={event => { setFailed(false); setDraft({ ...draft, [key]: event.target.valueAsNumber }); }} />
        </label>)}
        <section className="account-new-session-window" aria-labelledby={`${statusId}-window-title`}>
          <h3 id={`${statusId}-window-title`}>{copy.newSessionWindowTitle}</h3>
          <p>{copy.newSessionWindowBody}</p>
          <p className="field-hint" role="status">{windowStatusText}</p>
          {windowResetsAt !== null
            ? <p className="field-hint">{copy.newSessionWindowNextSlot}: {new Date(windowResetsAt).toLocaleString()}</p>
            : windowStatus ? <p className="field-hint">{copy.newSessionWindowNoSessions}</p> : null}
          <label className="account-policy-enabled"><span><input type="checkbox" checked={windowEnabled}
            onChange={event => { setFailed(false); setWindowEnabled(event.target.checked); }} /> {copy.newSessionWindowEnabled}</span></label>
          {windowEnabled ? <div className="account-new-session-window-fields">
            <label>{copy.newSessionWindowLimit}
              <input type="number" min={1} max={10_000} step={1} required aria-describedby={statusId}
                aria-invalid={!Number.isInteger(parsedWindowLimit) || parsedWindowLimit < 1 || parsedWindowLimit > 10_000}
                value={windowLimit} onChange={event => { setFailed(false); setWindowLimit(event.target.value); }} />
            </label>
            <label>{copy.newSessionWindowMinutes}
              <input type="number" min={1} max={525_600} step={1} required aria-describedby={statusId}
                aria-invalid={!Number.isInteger(parsedWindowMinutes) || parsedWindowMinutes < 1 || parsedWindowMinutes > 525_600}
                value={windowMinutes} onChange={event => { setFailed(false); setWindowMinutes(event.target.value); }} />
            </label>
          </div> : null}
        </section>
        <button type="submit" className="button-secondary" disabled={!changed || !valid || saving}>
          {saving ? copy.accountFormSaving : copy.pacingSave}
        </button>
        {safety.stopped ? <button type="button" className="button-secondary" onClick={resume}>{copy.pacingResume}</button> : null}
      </fieldset>
      <p id={statusId} className={!valid || failed ? "field-error" : "field-hint"} role={!valid || failed ? "alert" : "status"}>
        {blockedReason || (!valid ? copy.accountSafetyInvalid : failed ? copy.accountFormFailed
          : saving ? copy.accountFormSaving : changed ? copy.accountFormUnsaved : copy.accountFormSaved)}
      </p>
    </form>
  </details>;
}
