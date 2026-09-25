import { useEffect, useId, useState } from "react";
import { PrimaryButton, SecondaryButton } from "./launcher-ui";
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
  onCancel: () => void;
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
  return (
    <section className={`manual-turn-guide${waiting ? " is-waiting" : ""}`} aria-labelledby={headingId}>
      <div>
        <strong id={headingId}>{waiting ? copy.manualPromptTitle : copy.manualPromptWaiting}</strong>
        {waiting ? <p>{copy.manualPromptInstruction}</p> : null}
      </div>
      <span className="manual-turn-status">{status}</span>
      <span className="visually-hidden" aria-live="polite">{waiting ? "" : status}</span>
      <div className="manual-turn-actions">
        <SecondaryButton disabled={transitionBusy} onClick={onCancel}>{copy.manualPromptCancel}</SecondaryButton>
        <SecondaryButton disabled={transitionBusy || !tab.canCopyPrompt} onClick={() => void onCopy().then(ok => { if (ok) setCopied(true); })}>{copied ? copy.manualPromptCopied : copy.manualPromptCopy}</SecondaryButton>
        <PrimaryButton disabled={transitionBusy || confirmPending || !tab.canConfirmSent} onClick={onSent}>{confirmPending ? copy.running : waiting ? copy.manualPromptConfirmSent : copy.manualPromptSent}</PrimaryButton>
      </div>
    </section>
  );
}
