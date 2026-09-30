import { useEffect, useRef, useState } from "react";
import type { Copy } from "./i18n";
import { Button, Notice, Panel, PhaseSteps, type PhaseStep } from "./design";
import { browserSurfaceCopy } from "./browser-surface-copy";
import type { ExistingChromeLoginProgress, Language } from "./types";
import { existingChromeFailureText } from "./existing-chrome-copy";


export function ExistingChromeLoginGuide({ progress, copy, onRetry, setError, transitionBusy = false, language = 'en', headingLevel = 2 }: {
  language?: Language;
  progress: ExistingChromeLoginProgress;
  copy: Copy;
  onRetry: () => Promise<void>;
  setError: (error: string | null) => void;
  transitionBusy?: boolean;
  /** 1 when the guide replaces the idle state (it is the page's heading), 2 above a visible page. */
  headingLevel?: 1 | 2;
}) {
  const [now, setNow] = useState(Date.now());
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [cancelPending, setCancelPending] = useState(false);
  const cancelInFlight = useRef(false);
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
  // A failed or timed-out import: the heading names the flow and one error Notice says what failed.
  const failed = terminal && (progress.phase === "failed" || progress.phase === "timed-out");
  const handoffTimeout = progress.error === "existing-chrome-handoff-timeout";
  const phaseTitle = progress.phase === "consent" ? copy.existingChromeConsent
    : progress.phase === "preparing" ? copy.existingChromePreparing
    : progress.phase === "file-access" ? copy.existingChromeFileSelection
    : progress.phase === "discovering" ? copy.existingChromeSetup
    : progress.phase === "waiting-for-chrome" ? copy.existingChromeWaiting
    : progress.phase === "reading-session" ? copy.existingChromeReading
    : progress.phase === "verifying" ? copy.existingChromeVerify
    : progress.phase === "cancelling" ? copy.passkeyCancelling
    : progress.phase === "cancelled" ? copy.existingChromeCancelled
    : progress.phase === "completed" ? copy.existingChromeDone
    : progress.phase === "timed-out" && handoffTimeout ? copy.existingChromePreparing
    : progress.phase === "timed-out" ? copy.existingChromeTimeout : copy.passkeyFailed;
  const title = failed ? browserSurfaceCopy(language).existingChromeGuideTitle : phaseTitle;
  const failureText = progress.error ? existingChromeFailureText(progress.error, copy, language) : null;
  // The error Notice's title: what failed. A handoff timeout has no short summary; its message says it all.
  const failureTitle = !failed ? null : progress.phase === "failed" ? copy.passkeyFailed
    : handoffTimeout ? null : copy.existingChromeTimeout;
  const verificationFailed = progress.error === "session-verification-failed";
  const settings = !["existing-chrome-handoff-timeout", "session-verification-failed"].includes(progress.error ?? "")
    && ["discovering", "waiting-for-chrome", "failed", "timed-out", "cancelled"].includes(progress.phase);
  const steps = existingChromeSteps(progress, language);
  const Heading = headingLevel === 1 ? "h1" : "h2";
  const act = async (action: () => Promise<unknown>, allowedDuringTransition = false) => {
    if (inFlight.current || (transitionBusy && !allowedDuringTransition)) return;
    inFlight.current = true;
    setPending(true);
    try { await action(); } catch { setError(copy.existingChromeFailure); }
    finally { inFlight.current = false; setPending(false); }
  };
  // Cancel stays usable while another action (file access, copy) awaits the host.
  const cancel = async () => {
    if (cancelInFlight.current) return;
    cancelInFlight.current = true;
    setCancelPending(true);
    try { await window.codexWebLauncher!.cancelExistingChromeLogin(); } catch { setError(copy.existingChromeFailure); }
    finally { cancelInFlight.current = false; setCancelPending(false); }
  };
  const copyButton = progress.canCopySettings ? <Button size={settings ? "sm" : "md"} disabled={pending || transitionBusy}
    onClick={() => void act(async () => { await window.codexWebLauncher!.copyExistingChromeSettingsAddress(); setCopied(true); })}>
    {copied ? copy.existingChromeCopied : copy.existingChromeCopy}</Button> : null;
  const body = settings ? copy.existingChromeSteps
    : verificationFailed || progress.phase === "completed" ? null
    : progress.phase === "consent" ? copy.existingChromeBody
    : progress.phase === "file-access" ? copy.existingChromeFileBody
    : progress.phase === "preparing" ? copy.existingChromePreparingBody
    // After a handoff timeout the error Notice says what to do; the waiting text no longer applies.
    : handoffTimeout ? (failed ? null : copy.existingChromePreparingBody) : copy.existingChromeDuringImport;
  return <Panel as="div" padding="compact" className="browser-guide">
    <div className="browser-guide__status" role="status" aria-live="polite">
      {/* Focus lands here when the guide opens or its focused control goes away. */}
      <Heading className="browser-guide__title" tabIndex={-1}>{title}</Heading>
      {!failed && body ? <p>{body}</p> : null}
    </div>
    {failed ? <Notice tone="error" title={failureTitle ?? undefined}>
      {failureText && failureText !== failureTitle ? failureText : null}
    </Notice> : failureText && failureText !== title ? <Notice tone="error">{failureText}</Notice> : null}
    {failed && body ? <p>{body}</p> : null}
    {steps ? <PhaseSteps className="browser-guide__steps" label={browserSurfaceCopy(language).signInProgress} steps={steps} /> : null}
    {/* The copy button sits with the address it copies, so the action row keeps the next steps only. */}
    {settings ? <div className="browser-guide__address">
      <p><span>{copy.existingChromeAddress}:</span> <code className="nk-type-code">chrome://inspect/#remote-debugging</code></p>
      {copyButton}
    </div> : null}
    {progress.active && settings ? <p className="browser-guide__meta">{copy.existingChromeRemaining.replace("{time}", remaining)}</p> : null}
    {progress.active && progress.phase === "preparing" ? <p className="browser-guide__meta">{copy.existingChromeHandoffRemaining.replace("{time}", remaining)}</p> : null}
    {/* The next step comes first: allow file access, else retry; then the other ways forward. */}
    <div className="browser-guide__actions">
      {progress.canAllowFileAccess ? <Button variant="primary" disabled={pending || transitionBusy}
        onClick={() => void act(() => window.codexWebLauncher!.allowExistingChromeFileAccess())}>{copy.existingChromeAllowFile}</Button> : null}
      {/* Retry resolves only when the restarted import ends, so it does not hold the guide's pending state (that would
          disable the restarted flow's own controls); BrowserSurface guards a repeated start. */}
      {terminal ? <Button variant={progress.canAllowFileAccess ? "secondary" : "primary"} disabled={pending || transitionBusy}
        onClick={() => void onRetry()}>{copy.retry}</Button> : null}
      {settings ? null : copyButton}
      {terminal ? <Button disabled={pending || transitionBusy}
        onClick={() => void act(() => window.codexWebLauncher!.openLogin())}>{copy.stepAccount}</Button> : null}
      {progress.canCancel ? <Button variant="ghost" disabled={cancelPending}
        onClick={() => void cancel()}>{copy.passkeyCancel}</Button> : null}
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
