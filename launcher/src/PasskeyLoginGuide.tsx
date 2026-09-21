import { useEffect, useRef, useState } from "react";
import type { Copy } from "./i18n";
import { passkeyFailureText } from "./passkey-copy";
import type { PasskeyLoginProgress } from "./types";

export function PasskeyLoginGuide({ progress, copy, onRetry, setError, transitionBusy = false }: {
  progress: PasskeyLoginProgress;
  copy: Copy;
  onRetry: () => Promise<void>;
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
  const title = progress.phase === "waiting" ? copy.passkeyWindowTitle
    : progress.phase === "starting" ? copy.passkeyStarting
    : progress.phase === "verifying" ? copy.passkeyVerifying
    : progress.phase === "cancelling" ? copy.passkeyCancelling
    : progress.phase === "cancelled" ? copy.passkeyCancelled
    : progress.phase === "timed-out" ? copy.passkeyTimedOut
    : progress.phase === "failed" ? copy.passkeyFailed
    : copy.passkeyImporting;
  const act = async (action: () => Promise<unknown>, allowedDuringTransition = false, failure: string = copy.passkeyFailed) => {
    if (inFlight.current || (transitionBusy && !allowedDuringTransition)) return;
    inFlight.current = true;
    setPending(true);
    try { await action(); } catch {
      setError(failure);
    } finally { inFlight.current = false; setPending(false); }
  };
  return <div className="browser-login-guide">
    <div role="status" aria-live="polite">
      <strong>{title}</strong>
      <p>{terminal ? copy.passkeyRecoveryBody : ["starting", "waiting"].includes(progress.phase) ? copy.passkeyContinueBody : copy.passkeyImportingBody}</p>
    </div>
    {progress.active && ["starting", "waiting"].includes(progress.phase) ? (
      <p>{copy.passkeyTimeRemaining.replace("{time}", remaining)}</p>
    ) : null}
    {progress.error ? <p role="alert">{passkeyFailureText(progress.error, copy)}</p> : null}
    {progress.revealError ? <p role="alert">{passkeyFailureText(progress.revealError, copy)}</p> : null}
    <div className="browser-empty-actions">
      {progress.canReveal ? <button className="toolbar-text-button" type="button" disabled={pending || transitionBusy}
        onClick={() => void act(() => window.codexWebLauncher!.revealPasskeyLogin(), false, copy.passkeyRevealFailed)}>{copy.passkeyReveal}</button> : null}
      {progress.canCancel ? <button className="toolbar-text-button" type="button" disabled={pending}
        onClick={() => void act(() => window.codexWebLauncher!.cancelPasskeyLogin(), true)}>{copy.passkeyCancel}</button> : null}
      {terminal ? <button className="toolbar-text-button" type="button" disabled={pending || transitionBusy}
        onClick={() => void act(onRetry)}>{copy.retry}</button> : null}
    </div>
  </div>;
}
