import { useEffect, useRef, useState } from "react";
import { accountCodexCopyFor } from "./i18n";
import { accountAvailabilityCopy, quotaAvailability } from "./account-availability";
import { Badge, Button, Disclosure, ProgressMeter, cx, type Status, type Tone } from "./design";
import type {
  AccountPoolSnapshot,
  AccountQuotaBucket,
  AccountQuotaSnapshot,
  AccountQuotaWindow,
  CodexLoginProgress,
  Language,
} from "./types";

type Account = AccountPoolSnapshot["accounts"][number];
type AccountCodexCopy = ReturnType<typeof accountCodexCopyFor>;

export interface QuotaFreshnessCopy {
  quotaCurrent: string;
  quotaLastKnown: string;
  quotaUnavailable: string;
  checkedAt: string;
  retainedAt: string;
}

/** Ids of an account's allowance section and its Codex sign-in section. */
export function accountCodexIds(prefix: string) {
  return { quotaTitle: `${prefix}-quota-title`, quotaReason: `${prefix}-quota-reason`, quotaRefresh: `${prefix}-quota-refresh`,
    loginReason: `${prefix}-login-reason` };
}

export function AccountCodexAllowance({
  copy,
  idPrefix,
  language,
  onRefreshQuota,
  quota,
  quotaBusy,
  quotaFailed = false,
  quotaDisabledReason,
  quotaFreshnessCopy,
  quotaNow = Date.now(),
  quotaReadFailedText,
  quotaReasonId,
  transitionBusy = false,
}: {
  copy: AccountCodexCopy;
  idPrefix: string;
  language: Language;
  onRefreshQuota: () => Promise<void>;
  quota: AccountQuotaSnapshot | null | undefined;
  quotaBusy: boolean;
  quotaFailed?: boolean;
  quotaDisabledReason?: string;
  quotaFreshnessCopy?: QuotaFreshnessCopy;
  quotaNow?: number;
  /** Shown when the allowance could not be read at all (the read failed, not "no allowance"). */
  quotaReadFailedText: string;
  /**
   * The disabled reason is already visible elsewhere (the page notice, the card's session notice):
   * the button points there instead of repeating it under the header.
   */
  quotaReasonId?: string;
  transitionBusy?: boolean;
}) {
  const ids = accountCodexIds(idPrefix);
  const reasonId = quotaDisabledReason ? quotaReasonId ?? ids.quotaReason : undefined;
  const reported = quota && quota.availability === "available" && quota.coverage === "reported_buckets";
  const updatedAt = reported ? quota.fetchedAt ?? quota.checkedAt ?? null : null;
  // The account-wide bucket is the allowance itself: its state sits beside the title and its meters follow
  // directly, instead of a second "General Codex allowance" heading row.
  const accountState = reported ? bucketTone[quotaAvailability(quota.accountBucket)] : null;
  return <section className="accounts-allowance" aria-labelledby={ids.quotaTitle}>
    <header className="accounts-allowance__header">
      <div className="accounts-allowance__title">
        <h3 id={ids.quotaTitle} className="nk-type-label">{copy.quotaTitle}</h3>
        {reported && accountState ? <Badge {...accountState}>
          {accountAvailabilityCopy(language)[quotaAvailability(quota.accountBucket)]}</Badge> : null}
      </div>
      {updatedAt ? <p className="accounts-caption nk-type-caption">{copy.quotaUpdated.replace("{time}", formatDateTime(updatedAt, language, copy.quotaUnknown))}</p> : null}
      <Button size="sm" icon="reload" id={ids.quotaRefresh}
        busy={quotaBusy}
        disabled={transitionBusy || Boolean(quotaDisabledReason)}
        aria-describedby={reasonId}
        title={quotaDisabledReason}
        onClick={() => void onRefreshQuota()}>
        {quotaBusy ? copy.quotaChecking : copy.quotaRefresh}
      </Button>
    </header>
    {quotaDisabledReason && !quotaReasonId ? <p className="accounts-reason nk-type-caption" id={ids.quotaReason}>{quotaDisabledReason}</p> : null}
    <QuotaContent copy={copy} language={language} quota={quota} disabledReason={quotaDisabledReason}
      failed={quotaFailed} readFailedText={quotaReadFailedText} freshnessCopy={quotaFreshnessCopy} now={quotaNow} />
  </section>;
}

/** "Sign in to Codex": a section of the card's setup disclosure. A running flow shows in the card body instead. */
export function AccountCodexLogin({
  copy,
  headingId,
  idPrefix,
  login,
  loginDisabledReason,
  loginStarting,
  loginRecovery,
  onStartLogin,
  transitionBusy = false,
}: {
  copy: AccountCodexCopy;
  headingId: string;
  idPrefix: string;
  login: CodexLoginProgress | null;
  loginDisabledReason?: string;
  loginStarting: boolean;
  loginRecovery?: { label: string; retry: () => void };
  onStartLogin: () => Promise<void>;
  transitionBusy?: boolean;
}) {
  const ids = accountCodexIds(idPrefix);
  const flowRunning = Boolean(login?.active || login?.settling);
  return <section className="accounts-details__section accounts-codex-login" aria-labelledby={headingId}>
    <h3 id={headingId} className="nk-type-label">{copy.loginTitle}</h3>
    <p>{copy.loginBody}</p>
    {loginDisabledReason && !flowRunning
      ? <p className="accounts-reason nk-type-caption" id={ids.loginReason}>{loginDisabledReason}</p>
      : null}
    {!flowRunning || loginRecovery ? <div className="accounts-inline-actions">
      {!flowRunning ? <Button size="sm"
        busy={loginStarting}
        disabled={transitionBusy || Boolean(loginDisabledReason)}
        aria-describedby={loginDisabledReason ? ids.loginReason : undefined}
        title={loginDisabledReason}
        onClick={() => void onStartLogin()}>
        {loginStarting ? copy.loginStarting : copy.loginAction}
      </Button> : null}
      {loginRecovery ? <Button size="sm" variant="ghost" icon="reload"
        aria-label={`${loginRecovery.label}: ${copy.loginTitle}`}
        onClick={loginRecovery.retry}>{loginRecovery.label}</Button> : null}
    </div> : null}
  </section>;
}

/**
 * A Codex sign-in flow for this account, shown in the card body while it exists.
 * `primary`: "Open OpenAI sign-in" is the page's next step. `claimFocus`: the flow was just started from this
 * card, so focus moves here once the start button is gone.
 */
export function AccountCodexLoginProgress({
  account,
  claimFocus = false,
  copy,
  language,
  login,
  loginAction,
  onCancelLogin,
  onCopyCode,
  onFocusClaimed,
  onOpenLogin,
  primary = true,
  statusId,
  transitionBusy = false,
}: {
  account: Account;
  claimFocus?: boolean;
  copy: AccountCodexCopy;
  language: Language;
  login: CodexLoginProgress;
  loginAction: "open" | "copy" | "cancel" | null;
  onCancelLogin: () => Promise<void>;
  onCopyCode: () => Promise<boolean>;
  onFocusClaimed?: () => void;
  onOpenLogin: () => Promise<void>;
  primary?: boolean;
  /** Id of the "sign-in is in progress for …" line, which explains the card's disabled actions. */
  statusId?: string;
  transitionBusy?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);
  const region = useRef<HTMLDivElement>(null);
  // Set when one of this flow's buttons is used; if that button is then removed (the flow moved on), focus
  // goes to the next button of the flow or to its message instead of falling back to the document.
  const keepFocus = useRef(false);
  useEffect(() => {
    const active = document.activeElement;
    const lost = !active || active === document.body || !active.isConnected;
    if (claimFocus) {
      onFocusClaimed?.();
      if (lost) moveFocus(region.current);
      return;
    }
    if (!keepFocus.current) return;
    if (!lost) { if (loginAction === null) keepFocus.current = false; return; }
    keepFocus.current = false;
    moveFocus(region.current);
  });

  const copyCode = async () => {
    if (transitionBusy || loginAction !== null) return;
    keepFocus.current = true;
    if (!await onCopyCode()) return;
    setCopied(true);
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), 2_000);
  };
  return <div ref={region} className="accounts-login-flow">
    <h3 className="nk-type-label">{copy.loginTitle}</h3>
    <LoginProgressView account={account} copy={copy} language={language} login={login}
      action={loginAction} copied={copied} transitionBusy={transitionBusy} primary={primary} statusId={statusId}
      onCancel={() => { keepFocus.current = true; return onCancelLogin(); }} onCopy={copyCode}
      onOpen={() => { keepFocus.current = true; return onOpenLogin(); }} />
  </div>;
}

/** The flow's first enabled button, else its message (focusable only by script). */
function moveFocus(region: HTMLElement | null) {
  if (!region) return;
  const button = region.querySelector<HTMLButtonElement>("button:not(:disabled)");
  if (button) { button.focus(); return; }
  const message = region.querySelector<HTMLElement>(".accounts-login-progress__message") ?? region;
  message.tabIndex = -1;
  message.focus();
}

function QuotaContent({ copy, disabledReason, failed, freshnessCopy, language, now, quota, readFailedText }: {
  copy: AccountCodexCopy;
  disabledReason?: string;
  failed: boolean;
  readFailedText: string;
  freshnessCopy?: QuotaFreshnessCopy;
  language: Language;
  now: number;
  quota: AccountQuotaSnapshot | null | undefined;
}) {
  if (failed && (quota === null || quota === undefined)) {
    return <p className="accounts-allowance__message nk-type-small" role="status">{readFailedText}</p>;
  }
  if (quota === undefined) return disabledReason ? null : <p className="accounts-allowance__message nk-type-small" role="status">{copy.quotaChecking}</p>;
  if (quota === null) return disabledReason ? null : <p className="accounts-allowance__message nk-type-small">{copy.quotaNotChecked}</p>;
  if (quota.availability !== "available" || quota.coverage !== "reported_buckets") {
    const message = quotaUnavailableMessage(copy, quota.reason);
    if (message === disabledReason && !quota.checkedAt && !quota.retryAt) return null;
    return <div className="accounts-allowance__status" role="status">
      {message !== disabledReason ? <p className="accounts-allowance__message nk-type-small">{message}</p> : null}
      {quota.checkedAt ? <p className="accounts-caption nk-type-caption">{copy.quotaUpdated.replace("{time}", formatDateTime(quota.checkedAt, language, copy.quotaUnknown))}</p> : null}
      {quota.retryAt ? <p className="accounts-caption nk-type-caption">{copy.quotaResets.replace("{time}", formatDateTime(quota.retryAt, language, copy.quotaUnknown))}</p> : null}
    </div>;
  }
  const updatedAt = quota.fetchedAt ?? quota.checkedAt ?? null;
  return <div className="accounts-allowance__content">
    {freshnessCopy ? <QuotaFreshness copy={freshnessCopy} failed={failed} language={language}
      now={now} quota={quota} updatedAt={updatedAt} /> : null}
    <QuotaBucketMeters bucket={quota.accountBucket} copy={copy} language={language} />
    {quota.additionalBuckets.length ? <Disclosure className="accounts-allowance__more"
      title={copy.quotaAdditional.replace("{count}", String(quota.additionalBuckets.length))}>
      <div className="accounts-allowance__buckets">
        {quota.additionalBuckets.map(bucket => <QuotaBucketView key={bucket.id} bucket={bucket} copy={copy}
          language={language} fallbackName={bucket.id} />)}
      </div>
    </Disclosure> : null}
    {quota.additionalBucketsTruncated ? <p className="accounts-caption nk-type-caption">{copy.quotaCoverageTruncated}</p> : null}
  </div>;
}

function QuotaFreshness({ copy, failed, language, now, quota, updatedAt }: {
  copy: QuotaFreshnessCopy;
  failed: boolean;
  language: Language;
  now: number;
  quota: AccountQuotaSnapshot;
  updatedAt: string | null;
}) {
  const metadata = quota as AccountQuotaSnapshot & {
    freshness?: "fresh" | "stale";
    freshUntil?: string | null;
    refreshError?: string | null;
  };
  const freshUntil = metadata.freshUntil ? Date.parse(metadata.freshUntil) : Number.NaN;
  const stale = metadata.freshness === "stale" || (Number.isFinite(freshUntil) && freshUntil <= now);
  const retained = Boolean(metadata.refreshError) || failed;
  const label = retained || stale ? copy.quotaLastKnown : copy.quotaCurrent;
  const updated = updatedAt ? Date.parse(updatedAt) : Number.NaN;
  const age = Number.isFinite(updated) ? (retained || stale ? copy.retainedAt : copy.checkedAt)
    .replace("{time}", formatAge(now - updated, language)) : null;
  return <div className={`accounts-freshness nk-type-caption is-${retained ? "retained" : stale ? "stale" : "fresh"}`}>
    <p>{label}{age ? <><span aria-hidden="true"> · </span><span>{age}</span></> : null}</p>
    {retained ? <p>{copy.quotaUnavailable}</p> : null}
  </div>;
}

const bucketTone: Record<ReturnType<typeof quotaAvailability>, { tone?: Tone; dot: Status }> = {
  allowed: { tone: "success", dot: "ready" },
  exhausted: { tone: "error", dot: "error" },
  unavailable: { tone: "warning", dot: "error" },
  unknown: { dot: "idle" },
};

/** A model-specific bucket: its name and state, then its meters. */
function QuotaBucketView({ bucket, copy, fallbackName, language }: {
  bucket: AccountQuotaBucket;
  copy: AccountCodexCopy;
  fallbackName: string;
  language: Language;
}) {
  const name = bucket.name || bucket.normalModelSlug || fallbackName;
  const availability = quotaAvailability(bucket);
  return <article className="accounts-bucket">
    <header className="accounts-bucket__head">
      <h4 className="nk-type-label">{name}</h4>
      <Badge {...bucketTone[availability]}>{accountAvailabilityCopy(language)[availability]}</Badge>
    </header>
    <QuotaBucketMeters bucket={bucket} copy={copy} language={language} />
  </article>;
}

function QuotaBucketMeters({ bucket, copy, language }: {
  bucket: AccountQuotaBucket;
  copy: AccountCodexCopy;
  language: Language;
}) {
  return <div className="accounts-bucket__meters">
    <QuotaWindowMeter label={copy.quotaPrimary} value={bucket.primary} copy={copy} language={language} />
    <QuotaWindowMeter label={copy.quotaSecondary} value={bucket.secondary} copy={copy} language={language} />
  </div>;
}

function QuotaWindowMeter({ copy, label, language, value }: {
  copy: AccountCodexCopy;
  label: string;
  language: Language;
  value: AccountQuotaWindow;
}) {
  const duration = value.windowDurationMins === null ? null
    : formatDuration(value.windowDurationMins, copy, language);
  const reset = value.resetsAt === null ? null
    : copy.quotaResets.replace("{time}", formatDateTime(value.resetsAt * 1_000, language, copy.quotaUnknown));
  const note = [duration, reset].filter(Boolean).join(" · ") || undefined;
  const remaining = value.remainingPercent;
  if (remaining === null) {
    // Missing values are not zero: the kit shows the words and an empty, decorative track (no progressbar).
    return <ProgressMeter className="accounts-meter is-unreported" label={label} unreported={copy.quotaUnknown} note={note} />;
  }
  const tone = remaining <= 0 ? "error" : remaining < 25 ? "warning" : "success";
  return <ProgressMeter className="accounts-meter" label={label}
    valueLabel={copy.quotaRemaining.replace("{value}", formatPercent(remaining, language))}
    value={remaining / 100} tone={tone} note={note} />;
}

function LoginProgressView({ account, action, copied, copy, language, login, onCancel, onCopy, onOpen, primary, statusId, transitionBusy }: {
  account: Account;
  action: "open" | "copy" | "cancel" | null;
  copied: boolean;
  copy: AccountCodexCopy;
  language: Language;
  login: CodexLoginProgress;
  onCancel: () => Promise<void>;
  onCopy: () => Promise<void>;
  onOpen: () => Promise<void>;
  primary: boolean;
  /** Id of the "sign-in is in progress for …" line, which explains the card's disabled actions. */
  statusId?: string;
  transitionBusy: boolean;
}) {
  const actual = login.actualAccount?.email || login.actualAccount?.planType || null;
  const expected = account.accountLabel?.trim().toLocaleLowerCase() ?? null;
  const wrongIdentity = Boolean(actual && login.actualAccount?.email && expected?.includes("@")
    && login.actualAccount.email.toLocaleLowerCase() !== expected);
  const message = loginMessage(copy, login, wrongIdentity);
  const repeatsOpenAction = login.active && login.phase === "waiting" && login.canOpen && message === copy.loginOpen;
  return <div className={cx("accounts-login-progress nk-type-small", `phase-${login.phase}`)} aria-live="polite">
    {!repeatsOpenAction ? <p className="accounts-login-progress__message"><strong>{message}</strong></p> : null}
    {login.settling ? <p id={statusId}>{copy.loginSettlingCurrent.replace("{account}", account.label)}</p>
      : login.active ? <p id={statusId}>{copy.loginCurrent.replace("{account}", account.label)}</p> : null}
    {login.active ? <p>{copy.loginDeadline.replace("{time}", formatDateTime(login.deadlineAt, language, copy.quotaUnknown))}</p> : null}
    {actual ? <p>{copy.loginActualAccount.replace("{account}", actual)}</p> : null}
    {login.userCode ? <div className="accounts-device-code">
      <div className="accounts-device-code__row">
        <div><span className="nk-type-caption">{copy.loginCode}</span><code className="nk-type-heading">{login.userCode}</code></div>
        {login.active ? <Button size="sm" disabled={transitionBusy || action !== null}
          busy={action === "copy"}
          onClick={() => void onCopy()}>{copied ? copy.Copied : copy.copyCode}</Button> : null}
      </div>
      <small className="nk-type-caption">{copy.loginCodeHint}</small>
    </div> : null}
    {login.active ? <div className="accounts-inline-actions">
      {login.canOpen ? <Button variant={primary ? "primary" : "secondary"} size="sm" iconEnd="external" disabled={transitionBusy || action !== null}
        busy={action === "open"}
        onClick={() => void onOpen()}>{copy.loginOpen}</Button> : null}
      {login.canCancel ? <Button variant="ghost" size="sm" disabled={action !== null}
        busy={action === "cancel"}
        onClick={() => void onCancel()}>{login.phase === "cancelling" ? copy.loginCancelling : copy.loginCancel}</Button> : null}
    </div> : null}
  </div>;
}

function quotaUnavailableMessage(copy: AccountCodexCopy, reason?: string) {
  if (["signed_out", "session_expired"].includes(reason ?? "")) return copy.quotaSignedOut;
  if (["unsupported_session", "codex_auth_unsupported"].includes(reason ?? "")) return copy.quotaUnsupportedSession;
  if (reason === "rate_limited") return copy.quotaRateLimited;
  return copy.quotaUnavailable;
}

function loginMessage(copy: AccountCodexCopy, login: CodexLoginProgress, wrongIdentity: boolean) {
  if (login.settling) return copy.loginSettling;
  if (login.error?.code === "account_ownership_changed") return copy.loginAccountChanged;
  if (wrongIdentity) return copy.loginWrongAccount;
  if (login.phase === "starting") return copy.loginStarting;
  if (login.phase === "waiting") return copy.loginOpen;
  if (login.phase === "cancelling") return copy.loginCancelling;
  if (login.phase === "confirming") return copy.loginConfirming;
  if (login.phase === "cancelled" && login.authOutcome === "cancelled") return copy.loginCancelled;
  // requiresOpenaiAuth describes the configured provider, not whether login is missing.
  if (login.phase === "completed" && login.actualAccount) return copy.loginCompleted;
  if (login.phase === "failed" && ["codex_not_found", "startup_failed"].includes(login.error?.code ?? "")) {
    return copy.loginCLIUnavailable;
  }
  if (login.phase === "needs-confirmation" || login.requiresIdentityConfirmation
    || login.authOutcome === "uncertain" || login.authOutcome === "committed_identity_unverified") {
    return copy.loginUncertain;
  }
  return copy.loginFailed;
}

function formatDuration(minutes: number | null, copy: AccountCodexCopy, language: Language) {
  if (minutes === null) return copy.quotaUnknown;
  if (minutes % (24 * 60) === 0) return copy.quotaWindowDays.replace("{count}", formatNumber(minutes / (24 * 60), language));
  if (minutes % 60 === 0) return copy.quotaWindowHours.replace("{count}", formatNumber(minutes / 60, language));
  return copy.quotaWindowMinutes.replace("{count}", formatNumber(minutes, language));
}

function formatPercent(value: number, language: Language) {
  return new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(value);
}

function formatNumber(value: number, language: Language) {
  return new Intl.NumberFormat(language, { maximumFractionDigits: 0 }).format(value);
}

function formatDateTime(value: string | number, language: Language, fallback: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return fallback;
  return new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatAge(elapsedMs: number, language: Language) {
  const minutes = Math.max(0, Math.floor(elapsedMs / 60_000));
  if (minutes < 60) return new Intl.RelativeTimeFormat(language, { numeric: "auto" }).format(-minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return new Intl.RelativeTimeFormat(language, { numeric: "auto" }).format(-hours, "hour");
  return new Intl.RelativeTimeFormat(language, { numeric: "auto" }).format(-Math.floor(hours / 24), "day");
}
