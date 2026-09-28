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

/** Ids shared by an account's allowance section and its Codex sign-in disclosure. */
export function accountCodexIds(prefix: string) {
  return { quotaTitle: `${prefix}-quota-title`, quotaReason: `${prefix}-quota-reason`, loginReason: `${prefix}-login-reason` };
}

/** The allowance and sign-in controls share one visible reason when both are blocked for the same cause. */
function sharedReason(login: CodexLoginProgress | null, quotaDisabledReason?: string, loginDisabledReason?: string) {
  return !login?.active && quotaDisabledReason === loginDisabledReason ? quotaDisabledReason : undefined;
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
  transitionBusy?: boolean;
}) {
  const ids = accountCodexIds(idPrefix);
  const reported = quota && quota.availability === "available" && quota.coverage === "reported_buckets";
  const updatedAt = reported ? quota.fetchedAt ?? quota.checkedAt ?? null : null;
  return <section className="accounts-allowance" aria-labelledby={ids.quotaTitle}>
    <header className="accounts-allowance__header">
      <h3 id={ids.quotaTitle} className="nk-type-label">{copy.quotaTitle}</h3>
      {updatedAt ? <p className="accounts-caption nk-type-caption">{copy.quotaUpdated.replace("{time}", formatDateTime(updatedAt, language, copy.quotaUnknown))}</p> : null}
      <Button size="sm" icon="reload"
        busy={quotaBusy}
        disabled={transitionBusy || Boolean(quotaDisabledReason)}
        aria-describedby={quotaDisabledReason ? ids.quotaReason : undefined}
        title={quotaDisabledReason}
        onClick={() => void onRefreshQuota()}>
        {quotaBusy ? copy.quotaChecking : copy.quotaRefresh}
      </Button>
    </header>
    {quotaDisabledReason ? <p className="accounts-reason nk-type-caption" id={ids.quotaReason}>{quotaDisabledReason}</p> : null}
    <QuotaContent copy={copy} language={language} quota={quota} disabledReason={quotaDisabledReason}
      failed={quotaFailed} freshnessCopy={quotaFreshnessCopy} now={quotaNow} />
  </section>;
}

export function AccountCodexLogin({
  account,
  copy,
  idPrefix,
  language,
  login,
  loginAction,
  loginDisabledReason,
  loginStarting,
  loginRecovery,
  onCancelLogin,
  onCopyCode,
  onOpenLogin,
  onStartLogin,
  quotaDisabledReason,
  transitionBusy = false,
}: {
  account: Account;
  copy: AccountCodexCopy;
  idPrefix: string;
  language: Language;
  login: CodexLoginProgress | null;
  loginAction: "open" | "copy" | "cancel" | null;
  loginDisabledReason?: string;
  loginStarting: boolean;
  loginRecovery?: { label: string; retry: () => void };
  onCancelLogin: () => Promise<void>;
  onCopyCode: () => Promise<boolean>;
  onOpenLogin: () => Promise<void>;
  onStartLogin: () => Promise<void>;
  quotaDisabledReason?: string;
  transitionBusy?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | undefined>(undefined);
  const ids = accountCodexIds(idPrefix);
  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);
  // A sign-in flow opens the disclosure when it starts; otherwise it stays under the user's control.
  const hasLogin = Boolean(login);
  const [open, setOpen] = useState(hasLogin);
  useEffect(() => { if (hasLogin) setOpen(true); }, [hasLogin]);

  const shared = sharedReason(login, quotaDisabledReason, loginDisabledReason);
  const flowRunning = Boolean(login?.active || login?.settling);

  const copyCode = async () => {
    if (transitionBusy || loginAction !== null) return;
    if (!await onCopyCode()) return;
    setCopied(true);
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), 2_000);
  };

  return <Disclosure className="accounts-codex-login" title={copy.loginTitle} open={open} onToggle={setOpen}>
    <div className="accounts-disclosure">
    <p>{copy.loginBody}</p>
    {loginDisabledReason && !flowRunning && !shared
      ? <p className="accounts-reason nk-type-caption" id={ids.loginReason}>{loginDisabledReason}</p>
      : null}
    {!flowRunning || loginRecovery ? <div className="accounts-inline-actions">
      {!flowRunning ? <Button size="sm"
        busy={loginStarting}
        disabled={transitionBusy || Boolean(loginDisabledReason)}
        aria-describedby={loginDisabledReason ? (shared ? ids.quotaReason : ids.loginReason) : undefined}
        title={loginDisabledReason}
        onClick={() => void onStartLogin()}>
        {loginStarting ? copy.loginStarting : copy.loginAction}
      </Button> : null}
      {loginRecovery ? <Button size="sm" variant="ghost" icon="reload"
        aria-label={`${loginRecovery.label}: ${copy.loginTitle}`}
        onClick={loginRecovery.retry}>{loginRecovery.label}</Button> : null}
    </div> : null}
    {login ? <LoginProgressView account={account} copy={copy} language={language} login={login}
      action={loginAction} copied={copied} transitionBusy={transitionBusy}
      onCancel={onCancelLogin} onCopy={copyCode} onOpen={onOpenLogin} /> : null}
    </div>
  </Disclosure>;
}

function QuotaContent({ copy, disabledReason, failed, freshnessCopy, language, now, quota }: {
  copy: AccountCodexCopy;
  disabledReason?: string;
  failed: boolean;
  freshnessCopy?: QuotaFreshnessCopy;
  language: Language;
  now: number;
  quota: AccountQuotaSnapshot | null | undefined;
}) {
  if (failed && (quota === null || quota === undefined)) {
    return <p className="accounts-allowance__message nk-type-small" role="alert">{copy.quotaUnavailable}</p>;
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
    <QuotaBucketView bucket={quota.accountBucket} copy={copy} language={language} fallbackName={copy.quotaGeneral} />
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
    <div className="accounts-bucket__meters">
      <QuotaWindowMeter label={copy.quotaPrimary} value={bucket.primary} copy={copy} language={language} />
      <QuotaWindowMeter label={copy.quotaSecondary} value={bucket.secondary} copy={copy} language={language} />
    </div>
  </article>;
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

function LoginProgressView({ account, action, copied, copy, language, login, onCancel, onCopy, onOpen, transitionBusy }: {
  account: Account;
  action: "open" | "copy" | "cancel" | null;
  copied: boolean;
  copy: AccountCodexCopy;
  language: Language;
  login: CodexLoginProgress;
  onCancel: () => Promise<void>;
  onCopy: () => Promise<void>;
  onOpen: () => Promise<void>;
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
    {login.settling ? <p>{copy.loginSettlingCurrent.replace("{account}", account.label)}</p>
      : login.active ? <p>{copy.loginCurrent.replace("{account}", account.label)}</p> : null}
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
      {login.canOpen ? <Button variant="primary" size="sm" iconEnd="external" disabled={transitionBusy || action !== null}
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
