import { useEffect, useState } from "react";
import { Button, Notice, Panel } from "./design";
import { runtimeSwitchCopyFor } from "./runtime-switch-copy";
import type { Language, RuntimeSwitchState } from "./types";

const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);

/** Remaining time as m:ss; past targets read as "now". */
export function formatSwitchCountdown(target: string | null, now: number, nowLabel: string): string {
  const at = target ? Date.parse(target) : Number.NaN;
  if (!Number.isFinite(at)) return nowLabel;
  const seconds = Math.ceil((at - now) / 1_000);
  if (seconds <= 0) return nowLabel;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** What the Updates page says about the in-session runtime switch, or null when none is pending. */
export function runtimeSwitchMessage(language: Language, state: RuntimeSwitchState, now: number): string {
  const copy = runtimeSwitchCopyFor(language);
  const drainIn = formatSwitchCountdown(state.drainAt, now, copy.now);
  const deadlineIn = formatSwitchCountdown(state.deadlineAt, now, copy.now);
  const detail = state.detail ?? "";
  switch (state.phase) {
    case "waiting": return fill(copy.waiting, { drainIn, deadlineIn });
    case "draining": return state.activeTurns
      ? fill(copy.draining, { count: String(state.activeTurns), deadlineIn }) : copy.drainingIdle;
    case "cancelling": return copy.cancelling;
    case "switching": return copy.switching;
    case "deferred": return fill(copy.deferred, { detail, drainIn });
    case "failed": return fill(copy.failed, { detail });
    default: return copy.pending;
  }
}

export function RuntimeSwitchPanel({ language, state, onSwitchNow, busy }: {
  language: Language;
  state: RuntimeSwitchState;
  onSwitchNow: () => void;
  busy: boolean;
}) {
  const copy = runtimeSwitchCopyFor(language);
  const [now, setNow] = useState(() => Date.now());
  const counting = Boolean(state.drainAt || state.deadlineAt);
  useEffect(() => {
    if (!counting) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [counting]);
  const inFlight = state.phase === "switching" || state.phase === "cancelling";
  const tone = state.phase === "failed" ? "error" : state.phase === "deferred" ? "warning" : "info";
  return <Panel className="updates-panel updates-runtime-switch" title={copy.title}
    description={state.fromVersion ? fill(copy.versions, { from: state.fromVersion, to: state.toVersion }) : state.toVersion}>
    <div className="updates-body">
      <Notice tone={tone} role="status" aria-live="polite">{runtimeSwitchMessage(language, state, now)}</Notice>
      <p className="updates-note">{copy.switchNowHint}</p>
      <div className="updates-actions">
        <Button variant="primary" icon="reload" busy={busy || inFlight} disabled={busy || inFlight}
          onClick={onSwitchNow}>{copy.switchNow}</Button>
      </div>
    </div>
  </Panel>;
}
