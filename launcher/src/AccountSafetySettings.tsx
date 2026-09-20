import { useEffect, useId, useRef, useState } from "react";
import type { AccountSafetyPolicy } from "./types";
import type { Copy } from "./i18n";
import "./account-forms.css";

export function AccountSafetySettings({ id, safety, disabled, blockedReason, copy, save, resume }: {
  id: string;
  safety: { policy: AccountSafetyPolicy; cooldownUntil: number; stopped: boolean };
  disabled: boolean; blockedReason?: string; copy: Copy;
  save: (policy: AccountSafetyPolicy) => Promise<boolean>;
  resume: () => void;
}) {
  const [draft, setDraft] = useState(safety.policy);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const savingRef = useRef(false);
  const statusId = useId();
  const saved = JSON.stringify(safety.policy);
  useEffect(() => { setDraft(JSON.parse(saved)); setFailed(false); }, [id, saved]);
  const fields = [
    ["minIntervalSec", copy.pacingInterval, 0, 600],
    ["maxConcurrent", copy.pacingConcurrency, 1, 1000],
    ["breakAfterMinutes", copy.pacingBreakAfter, 1, 240],
    ["breakMinutes", copy.pacingBreakLength, 1, 60],
    ["maxSessionMinutes", copy.pacingSession, 1, 1440],
    ["cooldownMinutes", copy.pacingCooldown, 1, 120],
  ] as const;
  const valid = fields.every(([key, , min, max]) => Number.isInteger(draft[key]) && draft[key] >= min && draft[key] <= max);
  const changed = JSON.stringify(draft) !== saved;
  const submit = async () => {
    if (disabled || savingRef.current || !changed || !valid) return;
    savingRef.current = true; setSaving(true); setFailed(false);
    try { if (!await save(draft)) setFailed(true); }
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
