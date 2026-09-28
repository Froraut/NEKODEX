import { useId, useLayoutEffect, useRef, useState } from "react";
import { UpdateProgress } from "./UpdateProgress";
import { Button, Mark, Notice, Page, Panel, PhaseSteps, ProgressMeter, SurfaceHeader, type CatReaction, type PhaseStep } from "./design";
import { updateCopyFor } from "./update-copy";
import type { UpdateFeedback } from "./useUpdateControls";
import type { Language, UpdateState } from "./types";
import "./surfaces/tasks-updates.css";

const installPhases: ReadonlyArray<UpdateState["status"]> = ["downloading", "verifying", "installing", "cancelling"];

export function Updates({ language, currentVersion, state, busy, blocked, checking, cooldown, error, onCheck, onInstall, cancelling = false, onCancel, transitionBusy = false, platform }: {
  language: Language; currentVersion: string; state: UpdateState; busy: boolean; blocked: boolean;
  checking: boolean; cooldown: boolean;
  /** The last action's outcome from useUpdateControls (a plain string is treated as a failed check). */
  error: UpdateFeedback | string | null;
  onCheck: () => void; onInstall: () => void;
  cancelling?: boolean; onCancel?: () => void;
  transitionBusy?: boolean;
  /** process.platform of the launcher; macOS adds the DMG note to the restart copy. */
  platform?: string;
}) {
  const copy = updateCopyFor(language);
  const feedback: UpdateFeedback | null = typeof error === "string" ? { tone: "error", source: "check", message: error } : error;
  const actionFailure = feedback?.tone === "error" ? feedback : null;
  const failure = actionFailure?.message || (state.status === "error" ? state.message : null);
  // Whether the updater was last seen preparing an install, so an "error" state that follows it is titled as a
  // failed update rather than a failed check. Kept across the error state itself; any other state resets it.
  const [installFlow, setInstallFlow] = useState(() => installPhases.includes(state.status));
  const nextInstallFlow = installPhases.includes(state.status) ? true : state.status === "error" ? installFlow : false;
  if (nextInstallFlow !== installFlow) setInstallFlow(nextInstallFlow);
  const failureSource = actionFailure?.source ?? (state.status === "error" ? (installFlow ? "install" : "check") : null);
  const failureTitle = failureSource === "check" ? copy.checkFailed : copy.failed;
  // The worker handoff is authoritative even while the cancellation IPC reply
  // is still pending: from this point the installed app may be replaced.
  const cancellationPending = state.status === "cancelling" || (cancelling && state.status !== "installing");
  // "Download and restart" was pressed and the updater has not reported a transfer yet.
  const installPending = busy && state.status === "available" && !cancellationPending;
  const statusTitle = {
    disabled: copy.disabled, idle: copy.idle, checking: copy.checking, "up-to-date": copy.latest,
    available: copy.available, downloading: copy.downloading, verifying: copy.verifying, installing: copy.installing,
    error: failureTitle, cancelling: copy.cancelling,
  }[state.status];
  const candidate = "version" in state ? state.version : null;
  // Download · Verify · Install · Restart. The app closes during installation, so Restart is never current here.
  const phase = ["downloading", "verifying", "installing"].indexOf(state.status);
  const steps: PhaseStep[] = [copy.stageDownload, copy.stageVerify, copy.stageInstall, copy.stageRestart].map((label, index) => ({
    label, state: index < phase ? "complete" : index === phase ? "current" : "upcoming",
  }));
  // Ancillary action failures (for example, a cancellation requested after worker handoff)
  // must not replace the still-running updater phase with a terminal failure state.
  const title = cancellationPending ? copy.cancelling : phase >= 0 ? statusTitle
    : installPending ? copy.preparing : failure ? failureTitle : statusTitle;
  const reaction: CatReaction | undefined = failure && phase < 0 ? "surprised" : state.status === "up-to-date" ? "happy" : undefined;
  const checkBusy = checking || state.status === "checking";
  const showCancel = Boolean(onCancel) && (["downloading", "verifying", "cancelling"].includes(state.status) || cancellationPending);
  // Installing hands over to the worker: no action is possible, so the empty action row is left out.
  const showActions = showCancel || state.status === "available" || !busy;
  const showWait = (blocked || transitionBusy) && state.status === "available";
  const waitId = useId();
  const restart = platform === "darwin" ? `${copy.restart} ${copy.restartMac}` : copy.restart;

  // The action row changes with the updater state: "Download and restart" and "Check for updates" leave when a
  // download starts, "Cancel update" leaves when it ends. When the focused button is removed, focus moves to the
  // status heading (announced with the new state) instead of falling to the document.
  const heading = useRef<HTMLHeadingElement>(null);
  const focusedAction = useRef<Element | null>(null);
  useLayoutEffect(() => {
    const action = focusedAction.current;
    if (!action || action.isConnected) return;
    focusedAction.current = null;
    if (!document.activeElement || document.activeElement === document.body) heading.current?.focus();
  });

  return <Page width="narrow" className="updates-surface">
    <SurfaceHeader title={copy.title} subtitle={copy.subtitle} />
    <Panel className="updates-panel">
      <div className="updates-current"><span>{copy.current}</span><strong>NEKODEX {currentVersion}</strong></div>
      <div className="updates-body">
        <div className="updates-status" role="status" aria-live="polite">
          <span className="updates-tile" aria-hidden="true"><Mark label={null} size={32} reaction={reaction} /></span>
          <div><h2 ref={heading} tabIndex={-1}>{title}</h2>{candidate ? <p>NEKODEX {candidate}</p> : null}</div>
        </div>
        {phase >= 0 ? <PhaseSteps label={copy.steps} steps={steps} /> : null}
        {busy && phase < 1 && !cancellationPending ? <UpdateProgress key={candidate ?? "pending"} state={state} label={copy.progress} language={language} /> : null}
        {/* Verification has no measurable size, so its meter stays indeterminate. */}
        {phase === 1 && !cancellationPending ? <ProgressMeter className="updates-download" label={copy.verifyProgress} value={null} /> : null}
        {failure ? <Notice tone="error">{failure}</Notice> : null}
        {feedback?.tone === "info" ? <Notice tone="info">{feedback.message}</Notice> : null}
        {!failure && state.status === "available" && state.lastFailure
          ? <Notice tone="error">{copy.previousFailed.replace("{message}", state.lastFailure)}</Notice> : null}
        {state.status === "disabled" ? <p className="updates-note">{copy.disabledBody}</p> : <>
          <p className="updates-note">{cancellationPending ? copy.cancellingBody : busy ? restart : copy.automatic}</p>
          {showWait ? <Notice id={waitId} tone="warning">{copy.wait}</Notice> : null}
          {showActions ? <div
            className="updates-actions"
            onBlur={event => {
              // Focus moving to another element forgets the button; a removed or disabled button keeps it.
              if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) focusedAction.current = null;
            }}
            onFocus={event => { focusedAction.current = event.target; }}
          >
            {showCancel ? (
              <Button busy={cancellationPending} onClick={onCancel}>{cancellationPending ? copy.cancelBusy : copy.cancel}</Button>
            ) : null}
            {state.status === "available" ? <Button variant="primary" icon="update" busy={installPending}
              aria-describedby={showWait ? waitId : undefined} disabled={blocked || transitionBusy || busy || checking}
              onClick={onInstall}>{copy.install}</Button> : null}
            {!busy ? <Button variant={state.status === "available" ? "secondary" : "primary"} icon="reload" busy={checkBusy}
              disabled={transitionBusy || cooldown} onClick={onCheck}>
              {checkBusy ? copy.checkBusy : failureSource === "check" ? copy.retryCheck : copy.check}
            </Button> : null}
            {cooldown && !busy ? <span className="updates-cooldown">{copy.cooldown}</span> : null}
          </div> : null}
        </>}
      </div>
      {state.status !== "disabled" ? <p className="updates-preserved">{copy.preserved}</p> : null}
    </Panel>
    <p className="updates-source">{copy.source}</p>
  </Page>;
}
