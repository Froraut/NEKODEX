import { UpdateProgress } from "./UpdateProgress";
import { Icon } from "./icons";
import { updateCopyFor } from "./update-copy";
import type { Language, UpdateState } from "./types";

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
  const phase = ["downloading", "verifying", "installing"].indexOf(state.status);
  // Ancillary action failures (for example, a cancellation requested after worker handoff)
  // must not replace the still-running updater phase with a terminal failure state.
  const title = cancellationPending ? copy.cancelling : phase >= 0 ? statusTitle : failure ? copy.failed : statusTitle;
  return <section className="content-surface updates-surface is-page-scroll">
    <div className="content-scroll">
      <header className="surface-header"><h1>{copy.title}</h1><p>{copy.subtitle}</p></header>
      <div className="updates-card">
        <div className="updates-current"><span>{copy.current}</span><strong>NEKODEX {currentVersion}</strong></div>
        <div className="updates-status" role="status" aria-live="polite">
          <span className={`updates-symbol${busy || checking ? " is-working" : ""}`} aria-hidden="true"><Icon name={failure && phase < 0 ? "alert" : state.status === "up-to-date" ? "check" : phase > 0 || checking ? "reload" : "update"} /></span>
          <div><h2>{title}</h2>{candidate ? <p>NEKODEX {candidate}</p> : null}</div>
        </div>
        {phase >= 0 ? <ol className="updates-phases" aria-label={copy.progress}>
          {[copy.stageDownload, copy.stageVerify, copy.stageRestart].map((stage, index) => <li key={index}
            className={index === phase ? "is-current" : index < phase ? "is-complete" : ""}
            aria-current={index === phase ? "step" : undefined}>
            <span aria-hidden="true">{index < phase ? <Icon name="check" /> : index + 1}</span>{stage}
          </li>)}
        </ol> : null}
        {busy && phase < 1 && !cancellationPending ? <UpdateProgress key={candidate ?? "pending"} state={state} label={copy.progress} language={language} /> : null}
        {failure ? <p className="updates-error" role="alert">{failure}</p> : null}
        {state.status === "disabled" ? <p>{copy.disabledBody}</p> : <>
          <p>{cancellationPending ? copy.cancellingBody : busy ? copy.restart : copy.automatic}</p>
          {(blocked || transitionBusy) && state.status === "available" ? <p className="updates-wait">{copy.wait}</p> : null}
          <div className="updates-actions">
            {onCancel && (["downloading", "verifying", "cancelling"].includes(state.status) || cancellationPending) ? (
              <button type="button" className="button-secondary" disabled={cancellationPending}
                onClick={onCancel}>{cancellationPending ? copy.cancelling : copy.cancel}</button>
            ) : null}
            {state.status === "available" ? <button type="button" className="button-primary" disabled={blocked || transitionBusy || busy || checking} onClick={onInstall}>
              <Icon name="update" />{copy.install}
            </button> : null}
            {!busy ? <button type="button" className={state.status === "available" ? "button-secondary" : "button-primary"} disabled={transitionBusy || checking || cooldown || state.status === "checking"} onClick={onCheck}>
              <Icon name="update" />{checking || state.status === "checking" ? copy.checking : failedReleaseCheck ? copy.retryCheck : copy.check}
            </button> : null}
            {cooldown && !busy ? <span>{copy.cooldown}</span> : null}
          </div>
        </>}
        {state.status !== "disabled" ? <p className="updates-preserved">{copy.preserved}</p> : null}
      </div>
      <p className="updates-source">{copy.source}</p>
    </div>
  </section>;
}
