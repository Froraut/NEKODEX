import { useEffect, useId, useRef, useState } from "react";
import { accountCodexCopyFor } from "./i18n";
import { accountAvailabilityCopy, quotaAvailability } from "./account-availability";
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

export function AccountCodexControls({
  account,
  copy,
  language,
  login,
  loginAction,
  loginDisabledReason,
  loginStarting,
  loginRecovery,
  onCancelLogin,
  onCopyCode,
  onOpenLogin,
  onRefreshQuota,
  onStartLogin,
  quota,
  quotaBusy,
  quotaFailed = false,
  quotaDisabledReason,
  quotaFreshnessCopy,
  quotaNow = Date.now(),
  transitionBusy = false,
}: {
  account: Account;
  copy: AccountCodexCopy;
  language: Language;
  login: CodexLoginProgress | null;
  loginAction: "open" | "copy" | "cancel" | null;
  loginDisabledReason?: string;
  loginStarting: boolean;
  loginRecovery?: { label: string; retry: () => void };
  onCancelLogin: () => Promise<void>;
  onCopyCode: () => Promise<boolean>;
  onOpenLogin: () => Promise<void>;
  onRefreshQuota: () => Promise<void>;
  onStartLogin: () => Promise<void>;
  quota: AccountQuotaSnapshot | null | undefined;
  quotaBusy: boolean;
  quotaFailed?: boolean;
  quotaDisabledReason?: string;
  quotaFreshnessCopy?: QuotaFreshnessCopy;
  quotaNow?: number;
  transitionBusy?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | undefined>(undefined);
  const quotaHeadingId = useId();
  const quotaDisabledReasonId = useId();
  const loginHeadingId = useId();
  const loginDisabledReasonId = useId();
  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  const sharedDisabledReason = !login?.active && quotaDisabledReason === loginDisabledReason
    ? quotaDisabledReason : undefined;

  const copyCode = async () => {
    if (transitionBusy || loginAction !== null) return;
    if (!await onCopyCode()) return;
    setCopied(true);
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), 2_000);
  };

  return <div className="account-codex-controls">
    {sharedDisabledReason ? <p className="account-codex-disabled-reason account-codex-shared-reason"
      id={quotaDisabledReasonId}>{sharedDisabledReason}</p> : null}
    <section className="account-codex-quota" aria-labelledby={quotaHeadingId}>
      <header>
        <h3 id={quotaHeadingId}>{copy.quotaTitle}</h3>
        <button className="button-secondary" type="button"
          disabled={transitionBusy || quotaBusy || Boolean(quotaDisabledReason)}
          aria-busy={quotaBusy || undefined}
          aria-describedby={quotaDisabledReason ? quotaDisabledReasonId : undefined}
          title={quotaDisabledReason}
          onClick={() => void onRefreshQuota()}>
          {quotaBusy ? copy.quotaChecking : copy.quotaRefresh}
        </button>
      </header>
      {quotaDisabledReason && !sharedDisabledReason
        ? <p className="account-codex-disabled-reason" id={quotaDisabledReasonId}>{quotaDisabledReason}</p>
        : null}
      <QuotaContent copy={copy} language={language} quota={quota} disabledReason={quotaDisabledReason}
        failed={quotaFailed} freshnessCopy={quotaFreshnessCopy} now={quotaNow} />
    </section>

    <section className="account-codex-login" aria-labelledby={loginHeadingId}>
      <header>
        <h3 id={loginHeadingId}>{copy.loginTitle}</h3>
        {!login?.active && !login?.settling ? <button className="button-secondary" type="button"
          disabled={transitionBusy || loginStarting || Boolean(loginDisabledReason)}
          aria-busy={loginStarting || undefined}
          aria-describedby={loginDisabledReason ? (sharedDisabledReason ? quotaDisabledReasonId : loginDisabledReasonId) : undefined}
          title={loginDisabledReason}
          onClick={() => void onStartLogin()}>
          {loginStarting ? copy.loginStarting : copy.loginAction}
        </button> : null}
      </header>
      <p className="account-codex-login-body">{copy.loginBody}</p>
      {loginDisabledReason && !login?.active && !login?.settling && !sharedDisabledReason
        ? <p className="account-codex-disabled-reason" id={loginDisabledReasonId}>{loginDisabledReason}</p>
        : null}
      {loginRecovery ? <button className="button-secondary" type="button"
        aria-label={`${loginRecovery.label}: ${copy.loginTitle}`}
        onClick={loginRecovery.retry}>{loginRecovery.label}</button> : null}
      {login ? <LoginProgressView account={account} copy={copy} language={language} login={login}
        action={loginAction} copied={copied} transitionBusy={transitionBusy}
        onCancel={onCancelLogin} onCopy={copyCode} onOpen={onOpenLogin} /> : null}
    </section>
  </div>;
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
    return <p className="account-codex-status" role="alert">{copy.quotaUnavailable}</p>;
  }
  if (quota === undefined) return disabledReason ? null : <p className="account-codex-status" role="status">{copy.quotaChecking}</p>;
  if (quota === null) return disabledReason ? null : <p className="account-codex-status">{copy.quotaNotChecked}</p>;
  if (quota.availability !== "available" || quota.coverage !== "reported_buckets") {
    const message = quotaUnavailableMessage(copy, quota.reason);
    if (message === disabledReason && !quota.checkedAt && !quota.retryAt) return null;
    return <div className="account-codex-status" role="status">
      {message !== disabledReason ? <p>{message}</p> : null}
      {quota.checkedAt ? <small>{copy.quotaUpdated.replace("{time}", formatDateTime(quota.checkedAt, language, copy.quotaUnknown))}</small> : null}
      {quota.retryAt ? <small>{copy.quotaResets.replace("{time}", formatDateTime(quota.retryAt, language, copy.quotaUnknown))}</small> : null}
    </div>;
  }
  const updatedAt = quota.fetchedAt ?? quota.checkedAt ?? null;
  return <div className="account-codex-quota-content">
    {freshnessCopy ? <QuotaFreshness copy={freshnessCopy} failed={failed} language={language}
      now={now} quota={quota} updatedAt={updatedAt} /> : null}
    <QuotaBucketView bucket={quota.accountBucket} copy={copy} language={language} fallbackName={copy.quotaGeneral} />
    {quota.additionalBuckets.length ? <details className="account-codex-additional">
      <summary>{copy.quotaAdditional.replace("{count}", String(quota.additionalBuckets.length))}</summary>
      {quota.additionalBuckets.map(bucket => <QuotaBucketView key={bucket.id} bucket={bucket} copy={copy}
        language={language} fallbackName={bucket.id} />)}
    </details> : null}
    {quota.additionalBucketsTruncated ? <p className="account-codex-status">{copy.quotaCoverageTruncated}</p> : null}
    {updatedAt ? <p className="account-codex-updated">{copy.quotaUpdated.replace("{time}", formatDateTime(updatedAt, language, copy.quotaUnknown))}</p> : null}
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
  return <div className={`account-codex-freshness is-${retained ? "retained" : stale ? "stale" : "fresh"}`}>
    <strong>{label}</strong>{age ? <span>{age}</span> : null}
    {retained ? <small>{copy.quotaUnavailable}</small> : null}
  </div>;
}

function QuotaBucketView({ bucket, copy, fallbackName, language }: {
  bucket: AccountQuotaBucket;
  copy: AccountCodexCopy;
  fallbackName: string;
  language: Language;
}) {
  const name = bucket.name || bucket.normalModelSlug || fallbackName;
  return <article className="account-codex-bucket">
    <h4>{name}</h4>
    <p role="status">{accountAvailabilityCopy(language)[quotaAvailability(bucket)]}</p>
    <div className="account-codex-windows">
      <QuotaWindowView label={copy.quotaPrimary} value={bucket.primary} copy={copy} language={language} />
      <QuotaWindowView label={copy.quotaSecondary} value={bucket.secondary} copy={copy} language={language} />
    </div>
  </article>;
}

function QuotaWindowView({ copy, label, language, value }: {
  copy: AccountCodexCopy;
  label: string;
  language: Language;
  value: AccountQuotaWindow;
}) {
  const remaining = value.remainingPercent === null ? null
    : copy.quotaRemaining.replace("{value}", formatPercent(value.remainingPercent, language));
  const duration = value.windowDurationMins === null ? null
    : formatDuration(value.windowDurationMins, copy, language);
  const reset = value.resetsAt === null ? null
    : copy.quotaResets.replace("{time}", formatDateTime(value.resetsAt * 1_000, language, copy.quotaUnknown));
  const reported = remaining !== null || duration !== null || reset !== null;
  return <section className={`account-codex-window${reported ? "" : " is-unreported"}`}>
    <h5>{label}</h5>
    {reported ? <div className="account-codex-window-values">
      {remaining ? <span>{remaining}</span> : null}
      {duration ? <small>{duration}</small> : null}
      {reset ? <small>{reset}</small> : null}
    </div> : <span className="account-codex-window-unknown">{copy.quotaUnknown}</span>}
  </section>;
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
  return <div className={`account-codex-login-progress phase-${login.phase}`} aria-live="polite">
    {!repeatsOpenAction ? <p className="account-codex-status"><strong>{message}</strong></p> : null}
    {login.settling ? <p>{copy.loginSettlingCurrent.replace("{account}", account.label)}</p>
      : login.active ? <p>{copy.loginCurrent.replace("{account}", account.label)}</p> : null}
    {login.active ? <p>{copy.loginDeadline.replace("{time}", formatDateTime(login.deadlineAt, language, copy.quotaUnknown))}</p> : null}
    {actual ? <p>{copy.loginActualAccount.replace("{account}", actual)}</p> : null}
    {login.userCode ? <div className="account-codex-device-code">
      <div className="account-codex-device-code-row">
        <div><span>{copy.loginCode}</span><code>{login.userCode}</code></div>
        {login.active ? <button className="button-secondary" type="button" disabled={transitionBusy || action !== null}
          aria-busy={action === "copy" || undefined}
          onClick={() => void onCopy()}>{copied ? copy.Copied : copy.copyCode}</button> : null}
      </div>
      <small>{copy.loginCodeHint}</small>
    </div> : null}
    {login.active ? <div className="account-codex-login-actions">
      {login.canOpen ? <button className="button-primary" type="button" disabled={transitionBusy || action !== null}
        aria-busy={action === "open" || undefined}
        onClick={() => void onOpen()}>{copy.loginOpen}</button> : null}
      {login.canCancel ? <button className="text-button" type="button" disabled={action !== null}
        aria-busy={action === "cancel" || undefined}
        onClick={() => void onCancel()}>{login.phase === "cancelling" ? copy.loginCancelling : copy.loginCancel}</button> : null}
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
