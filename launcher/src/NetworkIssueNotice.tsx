import { Icon } from "./icons";
import { workflowCopy } from "./workflow-copy";
import type { BrowserState, Language } from "./types";

/** Explains repeated Cloudflare checks caused by a network whose public address changes. */
export function NetworkIssueNotice({ language, browser, className = "browser-recovery-notice" }: {
  language: Language; browser: BrowserState | null; className?: string;
}) {
  const issue = browser?.networkIssue;
  if (!issue) return null;
  const copy = workflowCopy(language).network;
  return <section className={className} role="status" aria-live="polite" data-testid="network-issue-notice">
    <Icon name="alert" />
    <div>
      <strong>{copy.title}</strong>
      <p>{issue === "egress-unstable" ? copy.egressUnstable : copy.challengeRoute}</p>
      {browser.networkIssueCheckedAt
        ? <small>{copy.checkedAt.replace("{time}", new Date(browser.networkIssueCheckedAt).toLocaleString(language))}</small>
        : null}
    </div>
  </section>;
}
