import { useEffect, useState, useSyncExternalStore } from "react";
import { Icon } from "./icons";
import { workflowCopy } from "./workflow-copy";
import type { BrowserState, Language } from "./types";

type NetworkIssue = NonNullable<BrowserState["networkIssue"]>;

// "Dismiss" lasts for this window session and is shared by every place the notice appears.
// It is keyed by the verdict, so a different issue (or the same one after it cleared) shows again.
let dismissedIssue: NetworkIssue | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const readDismissed = () => dismissedIssue;
function setDismissed(issue: NetworkIssue | null) {
  if (dismissedIssue === issue) return;
  dismissedIssue = issue;
  for (const listener of listeners) listener();
}

/** Explains repeated Cloudflare checks caused by a network whose public address changes. */
export function NetworkIssueNotice({ language, browser, className = "browser-recovery-notice", muted = false, onDontShowAgain }: {
  language: Language; browser: BrowserState | null; className?: string;
  /** The user chose "Don't show again" (persisted as `showNetworkIssueNotice: false`). */
  muted?: boolean;
  onDontShowAgain?: () => Promise<void>;
}) {
  const dismissed = useSyncExternalStore(subscribe, readDismissed);
  const [saving, setSaving] = useState(false);
  const issue = browser?.networkIssue ?? null;
  if (!issue || muted || dismissed === issue) return null;
  const copy = workflowCopy(language).network;
  const dontShowAgain = onDontShowAgain ? async () => {
    setSaving(true);
    try { await onDontShowAgain(); } finally { setSaving(false); }
  } : null;
  return <section className={className} role="status" aria-live="polite" data-testid="network-issue-notice">
    <Icon name="alert" />
    <div>
      <strong>{copy.title}</strong>
      <p>{issue === "egress-unstable" ? copy.egressUnstable : copy.challengeRoute}</p>
      {browser?.networkIssueCheckedAt
        ? <small>{copy.checkedAt.replace("{time}", new Date(browser.networkIssueCheckedAt).toLocaleString(language))}</small>
        : null}
    </div>
    <div className="browser-recovery-actions network-issue-actions">
      <button className="text-button" type="button" disabled={saving} onClick={() => setDismissed(issue)}>{copy.dismiss}</button>
      {dontShowAgain
        ? <button className="button-secondary" type="button" disabled={saving} onClick={() => void dontShowAgain()}>{copy.dontShowAgain}</button>
        : null}
    </div>
  </section>;
}

/** Call once where browser state is always observed: a cleared verdict ends the dismissal. */
export function useNetworkIssueDismissalReset(issue: BrowserState["networkIssue"] | undefined) {
  useEffect(() => { if (!issue) setDismissed(null); }, [issue]);
}
