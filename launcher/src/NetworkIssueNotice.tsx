import { useEffect, useState, useSyncExternalStore, type MouseEvent } from "react";
import { Button, Notice, cx } from "./design";
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

const focusable = "button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])";

/**
 * Dismissing removes the notice and the button that was pressed. The focus target is chosen before that: the next
 * control after the notice on the page, or else the page heading. It is focused once the notice is gone, unless the
 * user moved focus meanwhile.
 */
function focusAfterRemoval(event: MouseEvent<HTMLElement>) {
  const notice = event.currentTarget.closest(".nk-notice");
  if (!notice) return () => {};
  const page = notice.closest(".nk-page") ?? document.body;
  const next = [...page.querySelectorAll<HTMLElement>(focusable)].find(element =>
    !notice.contains(element) && !element.closest("[inert]") && element.getClientRects().length > 0
    && Boolean(notice.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING));
  const target = next ?? page.querySelector<HTMLElement>("h1");
  return () => requestAnimationFrame(() => {
    if (notice.isConnected || !target?.isConnected) return;
    if (document.activeElement && document.activeElement !== document.body) return;
    if (target.tagName === "H1" && !target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
  });
}

/** Explains repeated Cloudflare checks caused by a network whose public address changes. */
export function NetworkIssueNotice({ language, browser, className, muted = false, onDontShowAgain }: {
  language: Language; browser: BrowserState | null;
  /** Extra class on the kit Notice. */
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
  const dontShowAgain = onDontShowAgain ? async (event: MouseEvent<HTMLElement>) => {
    const restoreFocus = focusAfterRemoval(event);
    setSaving(true);
    try { await onDontShowAgain(); } finally { setSaving(false); restoreFocus(); }
  } : null;
  const dismiss = (event: MouseEvent<HTMLElement>) => {
    const restoreFocus = focusAfterRemoval(event);
    setDismissed(issue);
    restoreFocus();
  };
  return <Notice className={cx("network-notice", className)} data-testid="network-issue-notice" tone="warning" title={copy.title}
    meta={browser?.networkIssueCheckedAt && Number.isFinite(Date.parse(browser.networkIssueCheckedAt))
      ? copy.checkedAt.replace("{time}", new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" })
        .format(new Date(browser.networkIssueCheckedAt)))
      : undefined}
    action={<>
      <Button variant="ghost" size="sm" disabled={saving} onClick={dismiss}>{copy.dismiss}</Button>
      {dontShowAgain
        ? <Button size="sm" disabled={saving} onClick={event => void dontShowAgain(event)}>{copy.dontShowAgain}</Button>
        : null}
    </>}>
    {issue === "egress-unstable" ? copy.egressUnstable : copy.challengeRoute}
  </Notice>;
}

/** Call once where browser state is always observed: a cleared verdict ends the dismissal. */
export function useNetworkIssueDismissalReset(issue: BrowserState["networkIssue"] | undefined) {
  useEffect(() => { if (!issue) setDismissed(null); }, [issue]);
}
