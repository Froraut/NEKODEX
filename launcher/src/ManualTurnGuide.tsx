import { useEffect, useId, useState } from "react";
import { Badge, Button, Panel, type Status, type Tone } from "./design";
import type { Copy } from "./i18n";
import type { BrowserState } from "./types";

export function ManualTurnGuide({
  copy,
  confirmPending,
  transitionBusy,
  onCancel,
  onCopy,
  onSent,
  tab,
}: {
  copy: Copy;
  confirmPending: boolean;
  transitionBusy: boolean;
  /** Receives the Cancel turn button, so focus can return to it when a confirmation closes. */
  onCancel: (opener: HTMLElement) => void;
  onCopy: () => Promise<boolean>;
  onSent: () => void;
  tab: BrowserState["tabs"][number];
}) {
  const headingId = useId();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2_000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (tab.manualState !== "awaiting-user" || !tab.manualDeadlineAt) return;
    setNow(Date.now());
    let timer: number | undefined;
    const refresh = () => {
      window.clearInterval(timer);
      timer = undefined;
      if (document.hidden) return;
      setNow(Date.now());
      timer = window.setInterval(() => setNow(Date.now()), 1_000);
    };
    refresh();
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [tab.manualDeadlineAt, tab.manualState]);
  const deadline = tab.manualDeadlineAt ? Date.parse(tab.manualDeadlineAt) : Number.NaN;
  const seconds = Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - now) / 1_000)) : 0;
  const waiting = tab.manualState === "awaiting-user";
  const status = waiting
    ? `${seconds} ${copy.manualPromptSeconds}`
    : tab.manualState === "sent"
      ? copy.manualPromptSent
      : tab.manualState === "running"
        ? copy.manualPromptRunning
        : tab.manualState === "completed"
          ? copy.complete
          : copy.failed;
  // Status word + dot: the countdown and in-flight states are busy, the settled ones ready or failed.
  const [tone, dot]: [Tone, Status] = waiting ? ["warning", "busy"]
    : tab.manualState === "sent" || tab.manualState === "running" ? ["accent", "busy"]
      : tab.manualState === "completed" ? ["success", "ready"] : ["error", "error"];
  return (
    <Panel as="section" titleId={headingId} variant="brand" padding="compact" className={`browser-manual${waiting ? " is-waiting" : ""}`}>
      <div className="browser-manual__copy">
        <h2 id={headingId} className="browser-manual__title" tabIndex={-1}>{waiting ? copy.manualPromptTitle : copy.manualPromptWaiting}</h2>
        {tab.canCopyPrompt ? <p>{copy.manualPromptInstruction}</p> : null}
      </div>
      <Badge className="browser-manual__status" tone={tone} dot={dot}>{status}</Badge>
      <span className="nk-visually-hidden" aria-live="polite">{waiting ? "" : status}</span>
      <div className="browser-manual__actions">
        <Button variant="ghost" disabled={transitionBusy} onClick={event => onCancel(event.currentTarget)}>{copy.manualPromptCancel}</Button>
        <Button disabled={transitionBusy || !tab.canCopyPrompt} onClick={() => void onCopy().then(ok => { if (ok) setCopied(true); })}>{copied ? copy.manualPromptCopied : copy.manualPromptCopy}</Button>
        {/* Once sent, the status badge says so; the confirm button is only the next step while the turn waits. */}
        {waiting ? <Button variant="primary" disabled={transitionBusy || confirmPending || !tab.canConfirmSent} onClick={onSent}>
          {confirmPending ? copy.running : copy.manualPromptConfirmSent}</Button> : null}
      </div>
    </Panel>
  );
}
