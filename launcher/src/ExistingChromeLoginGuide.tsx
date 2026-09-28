import { useEffect, useRef, useState } from "react";
import type { Copy } from "./i18n";
import { Button, Notice, Panel, PhaseSteps, type PhaseStep } from "./design";
import { browserSurfaceCopy } from "./browser-surface-copy";
import type { ExistingChromeLoginProgress, Language } from "./types";
import { existingChromeFailureText } from "./existing-chrome-copy";


export function ExistingChromeLoginGuide({ progress, copy, onRetry, setError, transitionBusy = false, language = 'en' }: {
  language?: Language;
  progress: ExistingChromeLoginProgress;
  copy: Copy;
  onRetry: () => Promise<void>;
  setError: (error: string | null) => void;
  transitionBusy?: boolean;
}) {
  const [now, setNow] = useState(Date.now());
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [progress.startedAt]);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2_000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  useEffect(() => {
    setNow(Date.now());
    if (!progress.active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [progress.active, progress.startedAt]);
  const seconds = Math.max(0, Math.ceil((Date.parse(progress.deadlineAt) - now) / 1000));
  const remaining = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const terminal = !progress.active && progress.phase !== "completed";
  const title = progress.phase === "consent" ? copy.existingChromeConsent
    : progress.phase === "preparing" ? copy.existingChromePreparing
    : progress.phase === "file-access" ? copy.existingChromeFileSelection
    : progress.phase === "discovering" ? copy.existingChromeSetup
    : progress.phase === "waiting-for-chrome" ? copy.existingChromeWaiting
    : progress.phase === "reading-session" ? copy.existingChromeReading
    : progress.phase === "verifying" ? copy.existingChromeVerify
    : progress.phase === "cancelling" ? copy.passkeyCancelling
    : progress.phase === "cancelled" ? copy.existingChromeCancelled
    : progress.phase === "completed" ? copy.existingChromeDone
    : progress.phase === "timed-out" && progress.error === "existing-chrome-handoff-timeout" ? copy.existingChromePreparing
    : progress.phase === "timed-out" ? copy.existingChromeTimeout : copy.passkeyFailed;
  const verificationFailed = progress.error === "session-verification-failed";
  const settings = !["existing-chrome-handoff-timeout", "session-verification-failed"].includes(progress.error ?? "")
    && ["discovering", "waiting-for-chrome", "failed", "timed-out", "cancelled"].includes(progress.phase);
  const steps = existingChromeSteps(progress, language);
  const act = async (action: () => Promise<unknown>, allowedDuringTransition = false) => {
    if (inFlight.current || (transitionBusy && !allowedDuringTransition)) return;
    inFlight.current = true;
    setPending(true);
    try { await action(); } catch { setError(copy.existingChromeFailure); }
    finally { inFlight.current = false; setPending(false); }
  };
  return <Panel as="div" padding="compact" className="browser-guide">
    <div className="browser-guide__status" role="status" aria-live="polite">
      <strong className="browser-guide__title">{title}</strong>
      {settings ? <p>{copy.existingChromeSteps}</p>
        : !verificationFailed && progress.phase !== "completed" ? <p>{progress.phase === "consent" ? copy.existingChromeBody
          : progress.phase === "file-access" ? copy.existingChromeFileBody
          : progress.phase === "preparing" || progress.error === "existing-chrome-handoff-timeout" ? copy.existingChromePreparingBody : copy.existingChromeDuringImport}</p> : null}
    </div>
    {steps ? <PhaseSteps className="browser-guide__steps" label={browserSurfaceCopy(language).signInProgress} steps={steps} /> : null}
    {settings ? <p className="browser-guide__address"><span>{copy.existingChromeAddress}:</span> <code className="nk-type-code">chrome://inspect/#remote-debugging</code></p> : null}
    {progress.active && settings ? <p className="browser-guide__meta">{copy.existingChromeRemaining.replace("{time}", remaining)}</p> : null}
    {progress.active && progress.phase === "preparing" ? <p className="browser-guide__meta">{copy.existingChromeHandoffRemaining.replace("{time}", remaining)}</p> : null}
    {progress.error ? <Notice tone="error">{existingChromeFailureText(progress.error, copy, language)}</Notice> : null}
    <div className="browser-guide__actions">
      {progress.canAllowFileAccess ? <Button variant="primary" disabled={pending || transitionBusy}
        onClick={() => void act(() => window.codexWebLauncher!.allowExistingChromeFileAccess())}>{copy.existingChromeAllowFile}</Button> : null}
      {progress.canCopySettings ? <Button disabled={pending || transitionBusy}
        onClick={() => void act(async () => { await window.codexWebLauncher!.copyExistingChromeSettingsAddress(); setCopied(true); })}>
        {copied ? copy.existingChromeCopied : copy.existingChromeCopy}</Button> : null}
      {progress.canCancel ? <Button variant="ghost" disabled={pending}
        onClick={() => void act(() => window.codexWebLauncher!.cancelExistingChromeLogin(), true)}>{copy.passkeyCancel}</Button> : null}
      {terminal ? <Button variant={progress.canAllowFileAccess ? "secondary" : "primary"} disabled={pending || transitionBusy}
        onClick={() => void act(onRetry)}>{copy.retry}</Button> : null}
      {terminal ? <Button disabled={pending || transitionBusy}
        onClick={() => void act(() => window.codexWebLauncher!.openLogin())}>{copy.signIn}</Button> : null}
    </div>
  </Panel>;
}

/** Connect to Chrome (consent, file access, remote debugging approval), read the session, verify it. */
function existingChromeSteps(progress: ExistingChromeLoginProgress, language: Language): PhaseStep[] | null {
  if (!progress.active) return null;
  const current = ["consent", "preparing", "file-access", "discovering", "waiting-for-chrome"].includes(progress.phase) ? 0
    : progress.phase === "reading-session" ? 1
    : progress.phase === "verifying" ? 2
    : -1;
  if (current < 0) return null;
  return browserSurfaceCopy(language).existingChromeSteps.map((label, index) => ({
    label, state: index < current ? "complete" : index === current ? "current" : "upcoming",
  }));
}
