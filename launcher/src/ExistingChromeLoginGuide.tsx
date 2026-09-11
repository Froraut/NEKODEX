import { useEffect, useRef, useState } from "react";
import type { Copy } from "./i18n";
import type { ExistingChromeLoginProgress } from "./types";

export function ExistingChromeLoginGuide({ progress, copy, onRetry, setError }: {
  progress: ExistingChromeLoginProgress;
  copy: Copy;
  onRetry: () => Promise<void>;
  setError: (error: string | null) => void;
}) {
  const [now, setNow] = useState(Date.now());
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [copied, setCopied] = useState(false);
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
    : progress.phase === "discovering" ? copy.existingChromeSetup
    : progress.phase === "waiting-for-chrome" ? copy.existingChromeWaiting
    : progress.phase === "reading-session" ? copy.existingChromeReading
    : progress.phase === "verifying" ? copy.existingChromeVerify
    : progress.phase === "cancelling" ? copy.passkeyCancelling
    : progress.phase === "cancelled" ? copy.existingChromeCancelled
    : progress.phase === "completed" ? copy.existingChromeDone
    : progress.phase === "timed-out" ? copy.existingChromeTimeout : copy.passkeyFailed;
  const settings = ["discovering", "waiting-for-chrome", "failed", "timed-out", "cancelled"].includes(progress.phase);
  const act = async (action: () => Promise<unknown>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    try { await action(); } catch { setError(copy.existingChromeFailure); }
    finally { inFlight.current = false; setPending(false); }
  };
  return <div className="browser-login-guide existing-chrome-login-guide">
    <div role="status" aria-live="polite">
      <strong>{title}</strong>
      {settings ? <p>{copy.existingChromeSteps}</p>
        : progress.phase !== "completed" ? <p>{progress.phase === "consent" ? copy.existingChromeBody : copy.existingChromeDuringImport}</p> : null}
    </div>
    {settings ? <p><label>{copy.existingChromeAddress}: <code>chrome://inspect/#remote-debugging</code></label></p> : null}
    {progress.active && settings ? <p>{copy.existingChromeRemaining.replace("{time}", remaining)}</p> : null}
    {progress.error ? <p role="alert">{progress.error === "existing-chrome-cleanup-failed" ? copy.existingChromeCleanupFailed
      : progress.phase === "timed-out" ? copy.existingChromeTimeout : copy.existingChromeFailure}</p> : null}
    <div className="browser-empty-actions">
      {progress.canCopySettings ? <button className="toolbar-text-button" type="button" disabled={pending}
        onClick={() => void act(async () => { await window.codexWebLauncher!.copyExistingChromeSettingsAddress(); setCopied(true); })}>
        {copied ? copy.existingChromeCopied : copy.existingChromeCopy}</button> : null}
      {progress.canCancel ? <button className="toolbar-text-button" type="button" disabled={pending}
        onClick={() => void act(() => window.codexWebLauncher!.cancelExistingChromeLogin())}>{copy.passkeyCancel}</button> : null}
      {terminal ? <button className="toolbar-text-button" type="button" disabled={pending}
        onClick={() => void onRetry()}>{copy.retry}</button> : null}
    </div>
  </div>;
}
