import { useEffect, useState } from "react";
import type { AccountSafetyPolicy } from "./types";
import type { Copy } from "./i18n";

export function AccountSafetySettings({ id, safety, disabled, copy, save, resume }: {
  id: string;
  safety: { policy: AccountSafetyPolicy; cooldownUntil: number; stopped: boolean };
  disabled: boolean;
  copy: Copy;
  save: (policy: AccountSafetyPolicy) => void;
  resume: () => void;
}) {
  const [draft, setDraft] = useState(safety.policy);
  const saved = JSON.stringify(safety.policy);
  useEffect(() => { setDraft(JSON.parse(saved)); }, [id, saved]);
  const fields = [
    ["minIntervalSec", copy.pacingInterval, 0, 600],
    ["maxConcurrent", copy.pacingConcurrency, 1, 1000],
    ["breakAfterMinutes", copy.pacingBreakAfter, 1, 240],
    ["breakMinutes", copy.pacingBreakLength, 1, 60],
    ["maxSessionMinutes", copy.pacingSession, 1, 1440],
    ["cooldownMinutes", copy.pacingCooldown, 1, 120],
  ] as const;
  return <details className="account-safety">
    <summary>{copy.pacingTitle}</summary>
    <p>{copy.pacingBody}</p>
    {safety.stopped ? <p role="status">{copy.pacingStopped}</p> : null}
    {safety.cooldownUntil > Date.now() ? <p role="status">{copy.pacingUntil}: {new Date(safety.cooldownUntil).toLocaleString()}</p> : null}
    <form onSubmit={event => { event.preventDefault(); if (!disabled) save(draft); }}>
      <fieldset disabled={disabled}>
        <label><input type="checkbox" checked={draft.enabled}
          onChange={event => setDraft({ ...draft, enabled: event.target.checked })} />{copy.pacingEnabled}</label>
        {fields.map(([key, label, min, max]) => <label key={key} style={{ display: "block", marginBlock: 8 }}>
          {label}
          <input type="number" min={min} max={max} step={1} required value={draft[key]}
            onChange={event => setDraft({ ...draft, [key]: event.target.valueAsNumber })} />
        </label>)}
        <button type="submit" className="button-secondary">{copy.pacingSave}</button>
        {safety.stopped ? <button type="button" className="button-secondary" onClick={resume}>{copy.pacingResume}</button> : null}
      </fieldset>
    </form>
  </details>;
}
