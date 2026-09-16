import { Icon } from "./icons";
import { updateCopyFor } from "./update-copy";
import type { Language, UpdateState } from "./types";

export function Updates({ language, currentVersion, state, busy, blocked, checking, cooldown, error, onCheck, onInstall }: {
  language: Language; currentVersion: string; state: UpdateState; busy: boolean; blocked: boolean;
  checking: boolean; cooldown: boolean; error: string | null; onCheck: () => void; onInstall: () => void;
}) {
  const copy = updateCopyFor(language);
  const failure = error || (state.status === "error" ? state.message : null);
  const title = failure ? copy.failed : {
    disabled: copy.disabled, idle: copy.idle, checking: copy.checking, "up-to-date": copy.latest,
    available: copy.available, downloading: copy.downloading, verifying: copy.verifying, installing: copy.installing,
    error: copy.failed,
  }[state.status];
  const downloading = state.status === "downloading";
  const total = downloading ? state.totalBytes : undefined;
  const downloaded = downloading ? state.downloadedBytes ?? 0 : 0;
  const percent = total && total > 0 ? Math.min(100, Math.max(0, downloaded / total * 100)) : undefined;
  const mib = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  const candidate = "version" in state ? state.version : null;
  return <section className="content-surface updates-surface is-page-scroll">
    <div className="content-scroll">
      <header className="surface-header"><h1>{copy.title}</h1><p>{copy.subtitle}</p></header>
      <div className="updates-card">
        <div className="updates-current"><span>{copy.current}</span><strong>NEKODEX {currentVersion}</strong></div>
        <div className="updates-status" role="status" aria-live="polite">
          <span className={`updates-symbol${busy || checking ? " is-working" : ""}`} aria-hidden="true"><Icon name="update" /></span>
          <div><h2>{title}</h2>{candidate ? <p>NEKODEX {candidate}</p> : null}</div>
        </div>
        {busy ? <div className="updates-download">
          <progress aria-label={copy.progress} max={100} value={downloading ? percent : undefined} />
          {downloading && total ? <div className="updates-transfer"><span>{mib(downloaded)} / {mib(total)}</span><strong>{Math.floor(percent ?? 0)}%</strong></div> : null}
          {downloading && state.bytesPerSecond ? <small>{mib(state.bytesPerSecond)}/s</small> : null}
        </div> : null}
        {failure ? <p className="updates-error" role="alert">{failure}</p> : null}
        {state.status === "disabled" ? <p>{copy.disabledBody}</p> : <>
          <p>{busy ? copy.restart : copy.automatic}</p>
          {blocked && state.status === "available" ? <p className="updates-wait">{copy.wait}</p> : null}
          <div className="updates-actions">
            {state.status === "available" ? <button type="button" className="button-primary" disabled={blocked || busy} onClick={onInstall}>
              <Icon name="update" />{failure ? copy.retry : copy.install}
            </button> : null}
            {!busy && state.status !== "available" ? <button type="button" className="button-primary" disabled={checking || cooldown || state.status === "checking"} onClick={onCheck}>
              <Icon name="update" />{checking || state.status === "checking" ? copy.checking : copy.check}
            </button> : null}
            {cooldown && !busy && state.status !== "available" ? <span>{copy.cooldown}</span> : null}
          </div>
        </>}
        {state.status !== "disabled" ? <p className="updates-preserved">{copy.preserved}</p> : null}
      </div>
      <p className="updates-source">{copy.source}</p>
    </div>
  </section>;
}
