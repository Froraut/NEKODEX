import { useEffect, useRef, useState } from "react";
import type { Copy } from "./i18n";
import { Button, Notice, Panel, PhaseSteps, type PhaseStep } from "./design";
import { browserSurfaceCopy } from "./browser-surface-copy";
import { passkeyFailureText } from "./passkey-copy";
import type { PasskeyLoginProgress, Language } from "./types";

export function PasskeyLoginGuide({ progress, copy, onRetry, onContinue, continuePending, setError, transitionBusy = false, language = 'en' }: {
  language?: Language;
  progress: PasskeyLoginProgress;
  copy: Copy;
  onRetry: () => Promise<void>;
  onContinue: () => Promise<void>;
  continuePending: boolean;
  setError: (error: string | null) => void;
  transitionBusy?: boolean;
}) {
  const [now, setNow] = useState(Date.now());
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => {
    setNow(Date.now());
    if (!progress.active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [progress.active, progress.startedAt]);
  const seconds = Math.max(0, Math.ceil((Date.parse(progress.deadlineAt) - now) / 1000));
  const remaining = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const terminal = !progress.active && progress.phase !== "completed";
  const chromeWaiting = progress.active && ["discovering", "waiting-for-chrome"].includes(progress.chromePhase ?? "");
  const title = chromeWaiting ? copy.existingChromeWaiting
    : progress.active && progress.chromePhase === "reading-session" ? copy.existingChromeReading
    : progress.phase === "waiting" ? copy.passkeyWindowTitle
    : progress.phase === "starting" ? copy.passkeyStarting
    : progress.phase === "verifying" ? copy.passkeyVerifying
    : progress.phase === "cancelling" ? copy.passkeyCancelling
    : progress.phase === "cancelled" ? copy.passkeyCancelled
    : progress.phase === "timed-out" ? copy.passkeyTimedOut
    : progress.phase === "failed" ? copy.passkeyFailed
    : copy.passkeyImporting;
  const steps = passkeySteps(progress, language);
  const act = async (action: () => Promise<unknown>, allowedDuringTransition = false, failure: string = copy.passkeyFailed) => {
    if (inFlight.current || (transitionBusy && !allowedDuringTransition)) return;
    inFlight.current = true;
    setPending(true);
    try { await action(); } catch {
      setError(failure);
    } finally { inFlight.current = false; setPending(false); }
  };
  return <Panel as="div" padding="compact" className="browser-guide">
    <div className="browser-guide__status" role="status" aria-live="polite">
      <strong className="browser-guide__title">{title}</strong>
      <p>{chromeWaiting ? copy.existingChromeSteps : terminal ? copy.passkeyRecoveryBody : ["starting", "waiting"].includes(progress.phase) ? copy.passkeyContinueBody : copy.passkeyImportingBody}</p>
    </div>
    {steps ? <PhaseSteps className="browser-guide__steps" label={browserSurfaceCopy(language).signInProgress} steps={steps} /> : null}
    {progress.active && (chromeWaiting || ["starting", "waiting"].includes(progress.phase)) ? (
      <p className="browser-guide__meta">{copy.passkeyTimeRemaining.replace("{time}", remaining)}</p>
    ) : null}
    {progress.error && passkeyFailureText(progress.error, copy, language) !== title
      ? <Notice tone="error">{passkeyFailureText(progress.error, copy, language)}</Notice> : null}
    {progress.revealError ? <Notice tone="error">{passkeyFailureText(progress.revealError, copy, language)}</Notice> : null}
    <div className="browser-guide__actions">
      {progress.canImport ? <Button variant="primary" disabled={pending || continuePending || transitionBusy}
        onClick={() => void act(onContinue)}>{copy.passkeyContinue}</Button> : null}
      {progress.canReveal ? <Button disabled={pending || transitionBusy}
        onClick={() => void act(() => window.codexWebLauncher!.revealPasskeyLogin(), false, copy.passkeyRevealFailed)}>{copy.passkeyReveal}</Button> : null}
      {progress.canCancel ? <Button variant="ghost" disabled={pending}
        onClick={() => void act(() => window.codexWebLauncher!.cancelPasskeyLogin(), true)}>{copy.passkeyCancel}</Button> : null}
      {terminal ? <Button variant="primary" disabled={pending || transitionBusy}
        onClick={() => void act(onRetry)}>{copy.retry}</Button> : null}
      {terminal ? <Button disabled={pending || transitionBusy}
        onClick={() => void act(() => window.codexWebLauncher!.openLogin())}>{copy.stepAccount}</Button> : null}
    </div>
  </Panel>;
}

/** Sign in in the separate window, import the session, verify it. Shown only while the flow runs. */
function passkeySteps(progress: PasskeyLoginProgress, language: Language): PhaseStep[] | null {
  if (!progress.active) return null;
  const current = progress.chromePhase === "verifying" ? 2
    : progress.chromePhase === "reading-session" ? 1
    : progress.chromePhase === "discovering" || progress.chromePhase === "waiting-for-chrome" ? 0
    : progress.phase === "starting" || progress.phase === "waiting" ? 0
    : progress.phase === "importing" ? 1
    : progress.phase === "verifying" ? 2
    : -1;
  if (current < 0) return null;
  return browserSurfaceCopy(language).passkeySteps.map((label, index) => ({
    label, state: index < current ? "complete" : index === current ? "current" : "upcoming",
  }));
}
