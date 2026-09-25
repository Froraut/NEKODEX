import { useEffect, useRef, useState } from "react";
import type { Copy } from "./i18n";
import type { ExistingChromeLoginProgress, Language } from "./types";
import { profileLoginFailureText } from './profile-login-copy';

export function existingChromeFailureText(code: string | null, copy: Copy, language: Language = 'en'): string {
  const profile = profileLoginFailureText(code, language);
  if (profile) return profile;
  switch (code) {
    case "chrome-profile-access-denied": return copy.existingChromeAccessDenied;
    case "chrome-file-selection-invalid": return copy.existingChromeWrongFile;
    case "chrome-unavailable": return copy.existingChromeMissingConnection;
    case "invalid-endpoint": return copy.existingChromeInvalidConnection;
    case "chrome-permission-denied": return copy.existingChromeDenied;
    case "chrome-permission-timeout": case "existing-chrome-timeout": return copy.existingChromeTimeout;
    case "chrome-too-old": return copy.existingChromeOldVersion;
    case "chrome-disconnected": return copy.existingChromeDisconnected;
    case "invalid-response": return copy.existingChromeInvalidResponse;
    case "session-missing": return copy.existingChromeNoSession;
    case "session-verification-failed": return copy.existingChromeVerificationFailed;
    case "capture-write-failed": return copy.existingChromeCaptureFailed;
    case "launcher-authorization-failed": return copy.existingChromeAuthorizationFailed;
    case "consent-required": return copy.existingChromeConsent;
    case "cancelled": return copy.existingChromeCancelled;
    case "existing-chrome-handoff-timeout": return copy.existingChromeHandoffTimeout;
    case "existing-chrome-cleanup-failed": return copy.existingChromeCleanupFailed;
    default: return copy.existingChromeFailure;
  }
}

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
  const act = async (action: () => Promise<unknown>, allowedDuringTransition = false) => {
    if (inFlight.current || (transitionBusy && !allowedDuringTransition)) return;
    inFlight.current = true;
    setPending(true);
    try { await action(); } catch { setError(copy.existingChromeFailure); }
    finally { inFlight.current = false; setPending(false); }
  };
  return <div className="browser-login-guide existing-chrome-login-guide">
    <div role="status" aria-live="polite">
      <strong>{title}</strong>
      {settings ? <p>{copy.existingChromeSteps}</p>
        : !verificationFailed && progress.phase !== "completed" ? <p>{progress.phase === "consent" ? copy.existingChromeBody
          : progress.phase === "file-access" ? copy.existingChromeFileBody
          : progress.phase === "preparing" || progress.error === "existing-chrome-handoff-timeout" ? copy.existingChromePreparingBody : copy.existingChromeDuringImport}</p> : null}
    </div>
    {settings ? <p><span>{copy.existingChromeAddress}: <code>chrome://inspect/#remote-debugging</code></span></p> : null}
    {progress.active && settings ? <p>{copy.existingChromeRemaining.replace("{time}", remaining)}</p> : null}
    {progress.active && progress.phase === "preparing" ? <p>{copy.existingChromeHandoffRemaining.replace("{time}", remaining)}</p> : null}
    {progress.error ? <p role="alert">{existingChromeFailureText(progress.error, copy, language)}</p> : null}
    <div className="browser-empty-actions">
      {progress.canAllowFileAccess ? <button className="toolbar-text-button" type="button" disabled={pending || transitionBusy}
        onClick={() => void act(() => window.codexWebLauncher!.allowExistingChromeFileAccess())}>{copy.existingChromeAllowFile}</button> : null}
      {progress.canCopySettings ? <button className="toolbar-text-button" type="button" disabled={pending || transitionBusy}
        onClick={() => void act(async () => { await window.codexWebLauncher!.copyExistingChromeSettingsAddress(); setCopied(true); })}>
        {copied ? copy.existingChromeCopied : copy.existingChromeCopy}</button> : null}
      {progress.canCancel ? <button className="toolbar-text-button" type="button" disabled={pending}
        onClick={() => void act(() => window.codexWebLauncher!.cancelExistingChromeLogin(), true)}>{copy.passkeyCancel}</button> : null}
      {terminal ? <button className="toolbar-text-button" type="button" disabled={pending || transitionBusy}
        onClick={() => void act(onRetry)}>{copy.retry}</button> : null}
      {verificationFailed ? <button className="toolbar-text-button" type="button" disabled={pending || transitionBusy}
        onClick={() => void act(() => window.codexWebLauncher!.openLogin())}>{copy.signIn}</button> : null}
    </div>
  </div>;
}
