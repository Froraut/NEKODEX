import { useAccountPoolSnapshot } from "./useAccountPoolSnapshot";
import { useAccountCodexLogin } from "./useAccountCodexLogin";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { AccountSafetySettings } from "./AccountSafetySettings";
import { AccountProxySettings } from "./AccountProxySettings";
import { AccountCodexControls } from "./AccountCodexControls";
import { AccountReadiness } from "./AccountReadiness";
import { AccountToolsOnboarding } from "./AccountToolsOnboarding";
import { QuotaPortfolioSummary } from "./QuotaPortfolioSummary";
import { accountCodexCopyFor, type Copy } from "./i18n";
import { sessionIssueCopy } from "./session-issue-copy";
import { workflowCopy } from "./workflow-copy";
import type { AccountPoolSnapshot, AccountQuotaSnapshot, Language, LauncherSnapshot } from "./types";
import "./account-codex.css";
import "./quota-portfolio.css";

type Account = AccountPoolSnapshot["accounts"][number];

function quotaEvidenceFor(account: Account) {
  return JSON.stringify([account.id, account.evidenceEpoch ?? null]);
}

function localizedTime(value: string | null | undefined, language: Language) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(date) : null;
}

function nextQuotaClockAt(values: Iterable<AccountQuotaSnapshot | null>, now: number) {
  let next: number | null = null;
  for (const quota of values) {
    for (const value of [quota?.retryAt, quota?.freshUntil]) {
      const at = typeof value === "string" ? Date.parse(value) : Number.NaN;
      if (Number.isFinite(at) && at > now) next = next === null ? at : Math.min(next, at);
    }
  }
  return next;
}

export function AccountSettings({ copy, language, openBrowser, setError, manual, transitionBusy = false,
  toolsSetup, focusAccountId, onSetupTools }: {
  toolsSetup: { runtimeConfigured: boolean; connectorName: string; urls: LauncherSnapshot["urls"] };
  focusAccountId: string | null; onSetupTools: (accountId: string, accountLabel: string) => void;
  manual: boolean; copy: Copy; language: Language; openBrowser: () => void; setError: (message: string | null) => void;
  transitionBusy?: boolean;
}) {
  const api = window.codexWebLauncher!;
  const codexCopy = accountCodexCopyFor(language);
  const workflow = workflowCopy(language);
  const { snapshot: state, failed: loadFailed, retry: retryPool, applyReceipt } = useAccountPoolSnapshot({ api });
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const actionInFlight = useRef(false);
  const retryRef = useRef<HTMLButtonElement | null>(null);
  const [quotas, setQuotas] = useState<Map<string, AccountQuotaSnapshot | null>>(new Map());
  const [quotaFailures, setQuotaFailures] = useState<Set<string>>(new Set());
  const [quotaRefreshing, setQuotaRefreshing] = useState<Set<string>>(new Set());
  const [refreshAllBusy, setRefreshAllBusy] = useState(false);
  const [, wakeQuotaClock] = useState(0);
  // Hydration can settle after a cached deadline; compare against this render's
  // time and keep state only to wake the UI when a future deadline expires.
  const quotaClock = Date.now();
  const quotaInFlight = useRef(new Set<string>());
  const quotaBusySequence = useRef(0);
  const quotaBusyOwners = useRef(new Map<string, number>());
  const quotaRevisions = useRef(new Map<string, number>());
  const quotaRefreshEvidence = useRef(new Map<string, string>());
  const quotaAccountEvidence = useRef(new Map<string, string>());
  const quotaGlobalLock = useRef(false);
  const [quotaPortfolio, setQuotaPortfolio] = useState<Awaited<ReturnType<typeof api.refreshAccountCodexQuotas>> | null>(null);
  const authInFlight = useRef(new Set<string>());
  const authRevisions = useRef(new Map<string, number>());
  const [authRefreshing, setAuthRefreshing] = useState<Set<string>>(new Set());
  const { login, loginSnapshotStatus, startingAccountId, startingId, loginAction, loginLockedId,
    loginLockedIdRef, startCodexLogin, cancelCodexLogin, openCodexLogin, copyCodexLoginCode, retryLogin
  } = useAccountCodexLogin({ api, transitionBusy, loadFailed,
    isQuotaBusy: id => quotaInFlight.current.has(id), setError });
  quotaAccountEvidence.current = new Map((state?.accounts ?? [])
    .map(account => [account.id, quotaEvidenceFor(account)] as const));
  useEffect(() => {
    if (loadFailed && state === null) retryRef.current?.focus();
  }, [loadFailed, state === null]);

  const quotaEvidenceKey = state === null ? "" : JSON.stringify(state.accounts.map(quotaEvidenceFor));
  useEffect(() => {
    if (!state) return;
    let disposed = false;
    const accounts = state.accounts.map(account => account.id);
    const activeIds = new Set(accounts);
    const evidenceById = new Map(state.accounts.map(account => [account.id, quotaEvidenceFor(account)]));
    const hydrationAccounts = accounts.filter(id => !quotaInFlight.current.has(id)
      || quotaRefreshEvidence.current.get(id) !== evidenceById.get(id));
    // Reserve every hydration revision before the sequential reads begin. A newer manual
    // refresh can then supersede its account's reserved read even while an earlier account
    // is still loading. Preserve a matching in-flight refresh when unrelated evidence changes;
    // a replacement epoch for that account still joins hydration and invalidates the old read.
    const revisions = new Map(hydrationAccounts.map(id => {
      const revision = (quotaRevisions.current.get(id) ?? 0) + 1;
      quotaRevisions.current.set(id, revision);
      return [id, revision] as const;
    }));
    setQuotas(current => {
      const next = new Map([...current].filter(([id]) => activeIds.has(id)));
      for (const id of hydrationAccounts) next.set(id, null);
      return next;
    });
    setQuotaFailures(current => new Set([...current].filter(id => activeIds.has(id))));
    void (async () => {
      for (const id of hydrationAccounts) {
        const revision = revisions.get(id)!;
        try {
          const value = await api.accountCodexQuotaSnapshot(id);
          if (disposed || quotaRevisions.current.get(id) !== revision) continue;
          setQuotas(current => new Map(current).set(id, value));
          setQuotaFailures(current => {
            if (!current.has(id)) return current;
            const next = new Set(current);
            next.delete(id);
            return next;
          });
        } catch (error) {
          if (!disposed && quotaRevisions.current.get(id) === revision) {
            setQuotaFailures(current => new Set(current).add(id));
            setError(error instanceof Error ? error.message : String(error));
          }
        }
      }
    })();
    return () => { disposed = true; };
  }, [api, quotaEvidenceKey, setError]);

  useEffect(() => {
    const nextChange = nextQuotaClockAt(quotas.values(), quotaClock);
    if (nextChange === null) return;
    const timer = window.setTimeout(() => wakeQuotaClock(value => value + 1),
      Math.min(2_147_483_647, Math.max(0, nextChange - Date.now()) + 50));
    return () => window.clearTimeout(timer);
  }, [quotaClock, quotas]);

  // "Checked N minutes ago" labels are relative to render time; refresh them once a minute.
  const hasQuotas = quotas.size > 0;
  useEffect(() => {
    if (!hasQuotas) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) wakeQuotaClock(value => value + 1);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [hasQuotas]);

  const refreshQuota = async (id: string) => {
    if (transitionBusy || loadFailed || loginLockedIdRef.current === id
      || quotaGlobalLock.current || quotaInFlight.current.has(id)) return;
    const refreshEvidence = quotaAccountEvidence.current.get(id);
    if (!refreshEvidence) return;
    quotaInFlight.current.add(id);
    const busyOwner = ++quotaBusySequence.current;
    quotaBusyOwners.current.set(id, busyOwner);
    quotaRefreshEvidence.current.set(id, refreshEvidence);
    setQuotaRefreshing(current => new Set(current).add(id));
    const revision = (quotaRevisions.current.get(id) ?? 0) + 1;
    quotaRevisions.current.set(id, revision);
    setError(null);
    try {
      const value = await api.refreshAccountCodexQuota(id);
      if (quotaRevisions.current.get(id) === revision) {
        setQuotas(current => new Map(current).set(id, value));
        setQuotaFailures(current => {
          if (!current.has(id)) return current;
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }
    } catch (error) {
      if (quotaRevisions.current.get(id) === revision) setError(error instanceof Error ? error.message : String(error));
    } finally {
      quotaInFlight.current.delete(id);
      if (quotaRefreshEvidence.current.get(id) === refreshEvidence) quotaRefreshEvidence.current.delete(id);
      if (quotaBusyOwners.current.get(id) === busyOwner) quotaBusyOwners.current.delete(id);
      setQuotaRefreshing(current => {
        if (quotaBusyOwners.current.has(id)) return current;
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  };

  const refreshAllQuotas = async () => {
    if (!state || transitionBusy || loadFailed || manual || quotaGlobalLock.current || quotaInFlight.current.size > 0) return;
    const revisions = new Map(state.accounts.map(account => {
      const revision = (quotaRevisions.current.get(account.id) ?? 0) + 1;
      quotaRevisions.current.set(account.id, revision);
      return [account.id, revision] as const;
    }));
    const busyOwners = new Map(state.accounts.map(account => {
      const owner = ++quotaBusySequence.current;
      quotaBusyOwners.current.set(account.id, owner);
      return [account.id, owner] as const;
    }));
    quotaGlobalLock.current = true;
    setRefreshAllBusy(true);
    setQuotaPortfolio(null);
    setQuotaRefreshing(new Set(state.accounts.map(account => account.id)));
    setError(null);
    try {
      const result = await api.refreshAccountCodexQuotas();
      const currentRows = result.rows.filter(row => quotaAccountEvidence.current.get(row.accountId)
        === JSON.stringify([row.accountId, row.evidenceEpoch])
        && quotaRevisions.current.get(row.accountId) === revisions.get(row.accountId));
      setQuotaPortfolio({ ...result, rows: currentRows });
      setQuotas(current => {
        const next = new Map(current);
        for (const row of currentRows) {
          if ((row.status === "updated" || row.status === "retained") && row.snapshot) next.set(row.accountId, row.snapshot);
          else if (row.status === "unavailable") next.set(row.accountId, row.snapshot);
        }
        return next;
      });
      setQuotaFailures(current => {
        const next = new Set(current);
        for (const row of currentRows) {
          if (row.status === "retained" || row.status === "unavailable") next.add(row.accountId);
          else if (row.status === "updated") next.delete(row.accountId);
        }
        return next;
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setQuotaRefreshing(current => {
        const next = new Set(current);
        for (const [id, owner] of busyOwners) {
          if (quotaBusyOwners.current.get(id) !== owner) continue;
          quotaBusyOwners.current.delete(id);
          next.delete(id);
        }
        return next;
      });
      quotaGlobalLock.current = false;
      setRefreshAllBusy(false);
    }
  };

  const refreshAuthentication = async (id: string) => {
    const current = state?.accounts.find(account => account.id === id);
    if (transitionBusy || loadFailed || authInFlight.current.has(id) || current?.activeTurns
      || loginLockedIdRef.current === id || quotaBusyOwners.current.has(id)) return;
    const evidence = quotaAccountEvidence.current.get(id);
    if (!evidence) return;
    const revision = (authRevisions.current.get(id) ?? 0) + 1;
    authRevisions.current.set(id, revision);
    authInFlight.current.add(id);
    setAuthRefreshing(current => new Set(current).add(id));
    setError(null);
    try {
      const next = await api.refreshAccountAuthentication(id);
      if (authRevisions.current.get(id) === revision && quotaAccountEvidence.current.get(id) === evidence) {
        applyReceipt(next);
      }
    } catch (error) {
      if (authRevisions.current.get(id) === revision) setError(error instanceof Error ? error.message : String(error));
    } finally {
      authInFlight.current.delete(id);
      setAuthRefreshing(current => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  };

  const run = async (action: () => Promise<AccountPoolSnapshot>) => {
    if (transitionBusy || loadFailed || actionInFlight.current) return false;
    actionInFlight.current = true;
    setBusy(true); setError(null);
    try {
      const next = await action();
      applyReceipt(next);
      return true;
    }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); return false; }
    finally { actionInFlight.current = false; setBusy(false); }
  };
  const retryAccounts = () => {
    setError(null);
    retryPool();
  };
  if (!state) return <div className={`account-loading${loadFailed ? " is-error" : ""}`}
    role={loadFailed ? "alert" : "status"} aria-live="polite">{loadFailed
      ? <><p>{copy.accountsRefreshFailed}</p><button ref={retryRef} type="button" className="button-secondary"
        onClick={retryAccounts}>{copy.retry}</button></>
      : copy.accountsLoading}</div>;
  const mutationsDisabled = transitionBusy || busy || loadFailed;
  const transitionReason = transitionBusy ? copy.loading : undefined;
  const authenticatedAccounts = state.accounts.filter(account => account.authenticated);
  const loginLockedAccount = loginLockedId
    ? state.accounts.find(account => account.id === loginLockedId)?.label ?? loginLockedId : null;
  const loginLockedReason = loginLockedAccount
    ? (login?.settling ? codexCopy.loginSettlingCurrent : codexCopy.loginCurrent)
      .replace("{account}", loginLockedAccount)
    : undefined;
  const startingAccount = startingAccountId
    ? state.accounts.find(account => account.id === startingAccountId)?.label ?? startingAccountId : null;
  const accountAddBlockedReason = transitionReason ?? (startingAccount
    ? codexCopy.loginCurrent.replace("{account}", startingAccount) : loginLockedReason);
  const accountAddDisabled = mutationsDisabled || Boolean(accountAddBlockedReason);
  const refreshableAccounts = authenticatedAccounts.filter(account => {
    const retryAt = quotas.get(account.id)?.retryAt;
    return account.id !== loginLockedId
      && !(typeof retryAt === "string" && Number.isFinite(Date.parse(retryAt)) && Date.parse(retryAt) > quotaClock);
  });
  const refreshAllDisabledReason = transitionReason ?? (loadFailed ? copy.accountsRefreshFailed
    : manual ? codexCopy.quotaManualUnavailable
    : authenticatedAccounts.length === 0 ? codexCopy.quotaSignedOut
      : refreshAllBusy || quotaInFlight.current.size > 0 ? codexCopy.quotaChecking
      : refreshableAccounts.length === 0 ? (loginLockedId
        ? loginLockedReason
        : codexCopy.quotaRateLimited) : undefined);
  const recoverLoginStatus = () => { setError(null); retryLogin(); };
  return <section className="account-settings" aria-label={copy.accountsTitle} aria-busy={busy || transitionBusy}>
    {manual ? <p id="accounts-manual-reason">{copy.accountsManual}</p> : null}
    {loadFailed ? <div className="account-codex-toolbar account-stale-status" role="alert">
      <p>{copy.accountsRefreshFailed}</p>
      <button ref={retryRef} type="button" className="button-secondary"
        onClick={retryAccounts}>{copy.retry}</button>
    </div> : null}
    {loginSnapshotStatus === "failed" ? <div className="account-codex-toolbar" role="alert">
      <p>{codexCopy.loginStatusUnavailable}</p>
      <button type="button" className="button-secondary" onClick={recoverLoginStatus}>{copy.retry}</button>
    </div> : null}
    <div className="account-routing">
      <label htmlFor="account-routing">{copy.accountsRouting}</label>
      <select id="account-routing" className="settings-select" value={manual ? "selected" : state.mode} disabled={mutationsDisabled || manual}
        onChange={event => void run(() => api.setAccountMode(event.target.value as "selected" | "balanced"))}>
        <option value="selected">{copy.accountsSelected}</option>
        <option value="balanced">{copy.accountsBalanced}</option>
      </select>
    </div>
    <div className="account-codex-toolbar">
      <p>{codexCopy.quotaReportedOnly}</p>
      <button className="button-secondary" type="button"
        disabled={Boolean(refreshAllDisabledReason)}
        title={refreshAllDisabledReason}
        onClick={() => void refreshAllQuotas()}>
        {refreshAllBusy ? workflow.portfolio.refreshing : workflow.portfolio.refreshAll}
      </button>
    </div>
    {refreshAllBusy || quotaPortfolio ? <QuotaPortfolioSummary copy={workflow.portfolio}
      pending={refreshAllBusy ? state.accounts.length : 0}
      rows={(quotaPortfolio?.rows ?? []).map(row => ({ status: row.status, snapshot: row.snapshot }))} /> : null}
    {refreshAllDisabledReason && !loadFailed ? <p className="account-codex-disabled-reason">{refreshAllDisabledReason}</p> : null}
    {state.accounts.map((account, accountIndex) => <article className={`account-card${account.id === state.selectedId ? " is-selected" : ""}`} key={account.id}>
      {(() => {
        const credentialLabel = account.authenticated ? copy.replaceCredentials : copy.accountsSignIn;
        const authUnavailable = account.authenticationStatus === "unavailable";
        const authRefreshBusy = authRefreshing.has(account.id);
        const lastVerified = localizedTime(account.lastVerifiedAt, language);
        const active = account.activeTurns > 0;
        const flowForAccount = login?.accountId === account.id ? login : null;
        const flowAccount = login ? state.accounts.find(candidate => candidate.id === login.accountId) : null;
        const loginBoundActive = startingAccountId === account.id
          || flowForAccount?.active === true || flowForAccount?.settling === true;
        const loginBoundReason = flowForAccount?.settling
          ? codexCopy.loginSettlingCurrent.replace("{account}", account.label)
          : loginBoundActive ? codexCopy.loginCurrent.replace("{account}", account.label) : undefined;
        const quotaReadBusy = quotaRefreshing.has(account.id);
        const sessionMutationReason = loginBoundReason ?? (quotaReadBusy ? codexCopy.quotaChecking : undefined);
        const blockedReason = transitionReason ?? (loadFailed ? copy.accountsRefreshFailed
          : loginBoundReason ?? (active ? copy.accountsBusyTasks.replace("{count}", String(account.activeTurns))
            : busy ? copy.loading : undefined));
        const selectionReadinessReason = account.id !== state.selectedId
          ? authUnavailable ? workflow.session.verificationUnavailable
            : !account.authenticated ? copy.accountsSignInNeeded
            : !manual && !account.checked ? copy.connectionPending : undefined
          : undefined;
        const credentialActionReason = blockedReason ?? (quotaReadBusy ? codexCopy.quotaChecking : undefined);
        const authRetryDisabledReason = blockedReason ?? (quotaReadBusy ? codexCopy.quotaChecking : undefined);
        const authRetryReasonId = authRetryDisabledReason ? `account-auth-retry-reason-${accountIndex}` : undefined;
        const checkActionReason = blockedReason ?? (manual ? copy.accountsManual
          : authUnavailable ? workflow.session.verificationUnavailable
            : !account.authenticated ? copy.accountsSignInNeeded : undefined);
        const actionHint = blockedReason ?? selectionReadinessReason
          ?? (!manual ? checkActionReason : undefined) ?? credentialActionReason;
        const actionHintId = actionHint ? `account-action-reason-${accountIndex}` : undefined;
        const describedBy = (reason?: string) => reason === actionHint
          ? actionHintId : reason === copy.accountsManual && manual ? "accounts-manual-reason" : undefined;
        const anotherLoginReason = (startingAccountId !== null && startingAccountId !== account.id)
          || Boolean(login && (login.active || login.settling) && login.accountId !== account.id)
          ? (login?.settling ? codexCopy.loginSettlingCurrent : codexCopy.loginCurrent)
            .replace("{account}", flowAccount?.label ?? login?.accountId ?? "Codex") : undefined;
        const loginDisabledReason = transitionReason ?? (loadFailed ? copy.accountsRefreshFailed
          : quotaReadBusy ? codexCopy.quotaChecking
          : authUnavailable ? workflow.session.verificationUnavailable
            : !account.authenticated ? codexCopy.quotaSignedOut
          : loginSnapshotStatus === "loading" ? codexCopy.loginStarting
            : loginSnapshotStatus === "failed" ? codexCopy.loginFailed : anotherLoginReason);
        const retryAt = quotas.get(account.id)?.retryAt;
        const quotaRetryBlocked = typeof retryAt === "string" && Number.isFinite(Date.parse(retryAt)) && Date.parse(retryAt) > quotaClock;
        const quotaDisabledReason = transitionReason ?? (loadFailed ? copy.accountsRefreshFailed
          : manual ? codexCopy.quotaManualUnavailable
          : authUnavailable ? workflow.session.verificationUnavailable
            : !account.authenticated ? codexCopy.quotaSignedOut
            : refreshAllBusy ? codexCopy.quotaChecking
              : loginBoundReason ?? (quotaRetryBlocked ? codexCopy.quotaRateLimited : undefined));
        return <>
      <header className="account-card-header">
        <span className="account-avatar" aria-hidden="true">{account.label.trim().slice(0, 1).toLocaleUpperCase()}</span>
        <div><h2>{account.label}</h2><p>{account.accountLabel || (account.authenticated ? copy.accountsSignedIn
          : authUnavailable ? workflow.session.verificationUnavailable : copy.accountsSignInNeeded)}</p>
          {authUnavailable && lastVerified ? <small>{workflow.session.lastVerifiedAt.replace("{time}", lastVerified)}</small> : null}</div>
        {account.id === state.selectedId ? <span className="account-selected">{copy.accountsCurrent}</span> : null}
      </header>
      <div className="account-facts">
        <span>{copy.accountsActive}: {account.activeTurns}</span>
        <span className={account.checked ? "is-ready" : ""}><i className={`state-dot is-${account.checked ? "ready" : "idle"}`} />{copy.accountsChecked}: {account.checked ? copy.connectionVerified : copy.connectionPending}</span>
        <span className={account.connectorReady ? "is-ready" : ""}><i className={`state-dot is-${account.connectorReady ? "ready" : "idle"}`} />{copy.toolConnection}: {account.connectorReady ? copy.connectionVerified : copy.connectionPending}</span>
      </div>
      <AccountReadiness account={account} language={language} />
      <AccountToolsOnboarding account={account} copy={copy} language={language}
        runtimeConfigured={toolsSetup.runtimeConfigured} connectorName={toolsSetup.connectorName} urls={toolsSetup.urls}
        manual={manual} disabled={mutationsDisabled || active || loginBoundActive || quotaReadBusy || authRefreshBusy}
        focus={focusAccountId === account.id} onError={setError}
        onSetup={() => onSetupTools(account.id, account.accountLabel ? `${account.label} · ${account.accountLabel}` : account.label)}
        onVerify={() => void run(() => api.checkAccount(account.id, true))} />
      <div className="account-actions">
        <label title={loginBoundReason}><input type="checkbox" checked={account.enabled} disabled={mutationsDisabled || loginBoundActive}
          aria-describedby={(mutationsDisabled || loginBoundActive) ? describedBy(blockedReason) : undefined}
          onChange={event => void run(() => api.setAccountEnabled(account.id, event.target.checked))} />{copy.accountsEnabled}</label>
        {!authUnavailable ? <button type="button" className={account.authenticated ? "button-secondary" : "button-primary"}
          disabled={mutationsDisabled || active || loginBoundActive || quotaReadBusy} aria-label={credentialLabel}
          aria-describedby={describedBy(credentialActionReason)}
          title={sessionMutationReason} onClick={() => void run(async () => {
          const next = await api.selectAccount(account.id);
          applyReceipt(next);
          openBrowser();
          await api.openAccountLogin(account.id);
          return api.accounts();
        })}><Icon name="browser" />{credentialLabel}</button> : null}
        {authUnavailable ? <button type="button" className="button-secondary"
          disabled={authRefreshBusy || Boolean(authRetryDisabledReason)}
          aria-busy={authRefreshBusy || undefined}
          aria-describedby={authRetryReasonId}
          title={authRetryDisabledReason}
          onClick={() => void refreshAuthentication(account.id)}>{authRefreshBusy
            ? workflow.session.checkingVerification : workflow.session.retryVerification}</button> : null}
        {account.id !== state.selectedId ? <button type="button" className="button-secondary"
          disabled={mutationsDisabled || loginBoundActive || !account.authenticated || (!manual && !account.checked)}
          aria-describedby={describedBy(blockedReason ?? selectionReadinessReason)}
          title={loginBoundReason}
          onClick={() => void run(() => api.selectAccount(account.id))}>{copy.accountsSelect}</button> : null}
        <button type="button" className="text-button" disabled={mutationsDisabled || manual || active || loginBoundActive || !account.authenticated}
          aria-describedby={describedBy(checkActionReason)}
          title={loginBoundReason} onClick={() => void run(() => api.checkAccount(account.id, false))}>{copy.accountsCheck}</button>
      </div>
      {authUnavailable ? <p className="field-hint" role="status">{sessionIssueCopy(language, account.authenticationIssue)}</p> : null}
      {authUnavailable && account.id === state.selectedId ? <button type="button" className="text-button"
        disabled={mutationsDisabled || active || loginBoundActive || quotaReadBusy}
        onClick={openBrowser}>{copy.browser}</button> : null}
      {authUnavailable && authRetryDisabledReason ? <p className="field-hint" id={authRetryReasonId}>{authRetryDisabledReason}</p> : null}
      {actionHint ? <p className="field-hint" id={actionHintId} role="status">{actionHint}</p> : null}
      <AccountCodexControls account={account} copy={codexCopy} language={language}
        transitionBusy={transitionBusy}
        quota={quotas.has(account.id) ? quotas.get(account.id) : undefined}
        quotaFailed={quotaFailures.has(account.id)}
        quotaBusy={quotaRefreshing.has(account.id)} quotaDisabledReason={quotaDisabledReason}
        quotaFreshnessCopy={workflow.portfolio} quotaNow={quotaClock}
        onRefreshQuota={() => refreshQuota(account.id)}
        login={flowForAccount} loginStarting={startingAccountId === account.id}
        loginRecovery={loginSnapshotStatus === "failed" ? { label: copy.retry, retry: recoverLoginStatus } : undefined}
        loginDisabledReason={loginDisabledReason}
        loginAction={loginAction?.accountId === account.id ? loginAction.kind : null}
        onStartLogin={() => startCodexLogin(account.id)}
        onOpenLogin={async () => { if (flowForAccount) await openCodexLogin(flowForAccount); }}
        onCopyCode={async () => flowForAccount ? await copyCodexLoginCode(flowForAccount) : false}
        onCancelLogin={async () => { if (flowForAccount) await cancelCodexLogin(flowForAccount); }} />
      {account.safety ? <AccountSafetySettings id={account.id} language={language} safety={account.safety} copy={copy}
        resumeRequired={account.availability?.reason === "session-limit"}
        disabled={mutationsDisabled || active || loginBoundActive} blockedReason={blockedReason}
        save={policy => run(() => api.setAccountSafety(account.id, policy))}
        resume={() => void run(() => api.resumeAccount(account.id))} /> : null}
      {account.proxy ? <AccountProxySettings proxy={account.proxy} copy={copy} language={language}
        disabled={mutationsDisabled || active || loginBoundActive || quotaReadBusy} blockedReason={sessionMutationReason ?? blockedReason}
        save={value => run(() => api.setAccountProxy(account.id, value))} /> : null}
        </>;
      })()}
    </article>)}
    <form className="account-add" onSubmit={event => {
      event.preventDefault();
      if (!accountAddDisabled && startingId.current === null && loginLockedIdRef.current === null
        && label.trim()) void run(async () => {
        const next = await api.addAccount(label.trim()); setLabel(""); return next;
      });
    }}>
      <label htmlFor="account-name">{copy.accountsAdd}</label>
      <div><input id="account-name" type="text" aria-label={copy.accountsLabel} placeholder={copy.accountsLabel} maxLength={80}
        autoComplete="off" value={label} disabled={accountAddDisabled} title={accountAddBlockedReason}
        onChange={event => setLabel(event.target.value)} />
        <button type="submit" className="button-secondary" disabled={accountAddDisabled || !label.trim()}
          title={accountAddBlockedReason}><Icon name="plus" />{copy.accountsAdd}</button></div>
      {accountAddBlockedReason
        ? <p className="account-codex-disabled-reason">{accountAddBlockedReason}</p> : null}
    </form>
  </section>;
}
