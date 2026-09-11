import { useEffect, useState } from "react";
import { localizeLauncherError, type Copy } from "./i18n";
import type { PasskeyLoginProgress } from "./types";

export function PasskeyLoginGuide({ progress, copy, onRetry, setError }: {
  progress: PasskeyLoginProgress;
  copy: Copy;
  onRetry: () => Promise<void>;
  setError: (error: string | null) => void;
}) {
  const [now, setNow] = useState(Date.now());
  const [pending, setPending] = useState(false);
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
  const act = async (action: () => Promise<unknown>) => {
    if (pending) return;
    setPending(true);
    try { await action(); } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally { setPending(false); }
  };
  return <div className="browser-login-guide">
    <div role="status" aria-live="polite">
      <strong>{title}</strong>
      <p>{terminal ? copy.passkeyRecoveryBody : ["starting", "waiting"].includes(progress.phase) ? copy.passkeyContinueBody : copy.passkeyImportingBody}</p>
    </div>
    {progress.active && ["starting", "waiting"].includes(progress.phase) ? (
      <p>{copy.passkeyTimeRemaining.replace("{time}", remaining)}</p>
    ) : null}
    {progress.error ? <p role="alert">{localizeLauncherError(copy, progress.error)}</p> : null}
    {progress.revealError ? <p role="alert">{copy.passkeyRevealFailed}</p> : null}
    <div className="browser-empty-actions">
      {progress.canReveal ? <button className="toolbar-text-button" type="button" disabled={pending}
        onClick={() => void act(() => window.codexWebLauncher!.revealPasskeyLogin())}>{copy.passkeyReveal}</button> : null}
      {progress.canCancel ? <button className="toolbar-text-button" type="button" disabled={pending}
        onClick={() => void act(() => window.codexWebLauncher!.cancelPasskeyLogin())}>{copy.passkeyCancel}</button> : null}
      {terminal ? <button className="toolbar-text-button" type="button" disabled={pending}
        onClick={() => void onRetry()}>{copy.retry}</button> : null}
    </div>
  </div>;
}
