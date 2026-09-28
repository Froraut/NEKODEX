import { useEffect, useState, useSyncExternalStore } from "react";
import { Button, Notice, cx } from "./design";
import { workflowCopy } from "./workflow-copy";
import type { BrowserState, Language } from "./types";
import "./surfaces/overview.css";

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
export function NetworkIssueNotice({ language, browser, className, muted = false, onDontShowAgain }: {
  language: Language; browser: BrowserState | null;
  /** Layout class for the wrapper (the notice itself is the kit Notice). */
  className?: string;
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
  return <div className={cx("network-notice", className)} data-testid="network-issue-notice">
    <Notice tone="warning" title={copy.title}
      meta={browser?.networkIssueCheckedAt
        ? copy.checkedAt.replace("{time}", new Date(browser.networkIssueCheckedAt)
          .toLocaleString(language, { dateStyle: "medium", timeStyle: "short" }))
        : undefined}
      action={<div className="network-notice__actions">
        <Button variant="ghost" size="sm" disabled={saving} onClick={() => setDismissed(issue)}>{copy.dismiss}</Button>
        {dontShowAgain
          ? <Button size="sm" disabled={saving} onClick={() => void dontShowAgain()}>{copy.dontShowAgain}</Button>
          : null}
      </div>}>
      {issue === "egress-unstable" ? copy.egressUnstable : copy.challengeRoute}
    </Notice>
  </div>;
}

/** Call once where browser state is always observed: a cleared verdict ends the dismissal. */
export function useNetworkIssueDismissalReset(issue: BrowserState["networkIssue"] | undefined) {
  useEffect(() => { if (!issue) setDismissed(null); }, [issue]);
}
