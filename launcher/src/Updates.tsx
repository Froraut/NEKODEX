import { UpdateProgress } from "./UpdateProgress";
import { Button, Mark, Notice, Page, Panel, PhaseSteps, SurfaceHeader, type CatReaction, type PhaseStep } from "./design";
import { updateCopyFor } from "./update-copy";
import type { Language, UpdateState } from "./types";
import "./surfaces/tasks-updates.css";

export function Updates({ language, currentVersion, state, busy, blocked, checking, cooldown, error, onCheck, onInstall, cancelling = false, onCancel, transitionBusy = false }: {
  language: Language; currentVersion: string; state: UpdateState; busy: boolean; blocked: boolean;
  checking: boolean; cooldown: boolean; error: string | null; onCheck: () => void; onInstall: () => void;
  cancelling?: boolean; onCancel?: () => void;
  transitionBusy?: boolean;
}) {
  const copy = updateCopyFor(language);
  const failure = error || (state.status === "error" ? state.message : null);
  const failedReleaseCheck = Boolean(failure);
  // The worker handoff is authoritative even while the cancellation IPC reply
  // is still pending: from this point the installed app may be replaced.
  const cancellationPending = state.status === "cancelling" || (cancelling && state.status !== "installing");
  const statusTitle = {
    disabled: copy.disabled, idle: copy.idle, checking: copy.checking, "up-to-date": copy.latest,
    available: copy.available, downloading: copy.downloading, verifying: copy.verifying, installing: copy.installing,
    error: copy.failed, cancelling: copy.cancelling,
  }[state.status];
  const candidate = "version" in state ? state.version : null;
  // Download · Verify · Install · Restart. The app closes during installation, so Restart is never current here.
  const phase = ["downloading", "verifying", "installing"].indexOf(state.status);
  const steps: PhaseStep[] = [copy.stageDownload, copy.stageVerify, copy.stageInstall, copy.stageRestart].map((label, index) => ({
    label, state: index < phase ? "complete" : index === phase ? "current" : "upcoming",
  }));
  // Ancillary action failures (for example, a cancellation requested after worker handoff)
  // must not replace the still-running updater phase with a terminal failure state.
  const title = cancellationPending ? copy.cancelling : phase >= 0 ? statusTitle : failure ? copy.failed : statusTitle;
  const reaction: CatReaction | undefined = failure && phase < 0 ? "surprised" : state.status === "up-to-date" ? "happy" : undefined;
  const checkBusy = checking || state.status === "checking";
  const showCancel = Boolean(onCancel) && (["downloading", "verifying", "cancelling"].includes(state.status) || cancellationPending);
  // Installing hands over to the worker: no action is possible, so the empty action row is left out.
  const showActions = showCancel || state.status === "available" || !busy;
  return <Page width="narrow" className="updates-surface">
    <SurfaceHeader title={copy.title} subtitle={copy.subtitle} />
    <Panel className="updates-panel">
      <div className="updates-current"><span>{copy.current}</span><strong>NEKODEX {currentVersion}</strong></div>
      <div className="updates-body">
        <div className="updates-status" role="status" aria-live="polite">
          <span className="updates-tile" aria-hidden="true"><Mark label={null} size={32} reaction={reaction} /></span>
          <div><h2>{title}</h2>{candidate ? <p>NEKODEX {candidate}</p> : null}</div>
        </div>
        {phase >= 0 ? <PhaseSteps label={copy.progress} steps={steps} /> : null}
        {busy && phase < 1 && !cancellationPending ? <UpdateProgress key={candidate ?? "pending"} state={state} label={copy.progress} language={language} /> : null}
        {failure ? <Notice tone="error">{failure}</Notice> : null}
        {!failure && state.status === "available" && state.lastFailure
          ? <Notice tone="error">{copy.previousFailed.replace("{message}", state.lastFailure)}</Notice> : null}
        {state.status === "disabled" ? <p className="updates-note">{copy.disabledBody}</p> : <>
          <p className="updates-note">{cancellationPending ? copy.cancellingBody : busy ? copy.restart : copy.automatic}</p>
          {(blocked || transitionBusy) && state.status === "available" ? <Notice tone="warning">{copy.wait}</Notice> : null}
          {showActions ? <div className="updates-actions">
            {showCancel ? (
              <Button busy={cancellationPending} onClick={onCancel}>{cancellationPending ? copy.cancelling : copy.cancel}</Button>
            ) : null}
            {state.status === "available" ? <Button variant="primary" icon="update" disabled={blocked || transitionBusy || busy || checking}
              onClick={onInstall}>{copy.install}</Button> : null}
            {!busy ? <Button variant={state.status === "available" ? "secondary" : "primary"} icon="reload" busy={checkBusy}
              disabled={transitionBusy || cooldown} onClick={onCheck}>
              {checkBusy ? copy.checking : failedReleaseCheck ? copy.retryCheck : copy.check}
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
