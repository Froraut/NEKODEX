import { useAccountPoolSnapshot } from "./useAccountPoolSnapshot";
import { useAccountCodexLogin } from "./useAccountCodexLogin";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AccountSafetySettings } from "./AccountSafetySettings";
import { AccountProxySettings, proxyModeOptions } from "./AccountProxySettings";
import { AccountCodexAllowance, AccountCodexLogin } from "./AccountCodexControls";
import { AccountReadiness, accountPacingStatus } from "./AccountReadiness";
import { AccountToolsOnboarding } from "./AccountToolsOnboarding";
import { QuotaPortfolioSummary } from "./QuotaPortfolioSummary";
import { accountToolsStep } from "./account-tools-onboarding";
import { accountsCopy } from "./accounts-copy";
import { AccountCard, Button, Checkbox, Disclosure, Notice, Page, Panel, Select, SurfaceHeader, TextField, cx, type Status, type Tone } from "./design";
import { accountCodexCopyFor, type Copy } from "./i18n";
import { sessionIssueCopy } from "./session-issue-copy";
import { workflowCopy } from "./workflow-copy";
import type { AccountPoolSnapshot, AccountQuotaSnapshot, Language, LauncherSnapshot } from "./types";
import "./surfaces/accounts.css";

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

type FormStateReporter = (state: string | null) => void;

/** One disclosure for an account's pacing, new-session window and proxy forms; unsaved work shows in its summary. */
function AccountControlsDisclosure({ title, summary, held, pacing, proxy }: {
  title: string; summary: string; held: boolean;
  pacing: (report: FormStateReporter) => ReactNode;
  proxy: (report: FormStateReporter) => ReactNode;
}) {
  const [pacingState, setPacingState] = useState<string | null>(null);
  const [proxyState, setProxyState] = useState<string | null>(null);
  const attention = pacingState ?? proxyState;
  return <Disclosure className="accounts-controls" title={title}
    hint={<span className={cx("accounts-hint", (attention || held) && "is-attention")}>{attention ?? summary}</span>}>
    <div className="accounts-disclosure accounts-controls__body">
      {pacing(setPacingState)}
      {proxy(setProxyState)}
    </div>
  </Disclosure>;
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
  const [createdAccountId, setCreatedAccountId] = useState<string | null>(null);
  const accountList = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!createdAccountId || !state) return;
    // Cards render in snapshot order; the kit card's h3 is the account name.
    const index = state.accounts.findIndex(account => account.id === createdAccountId);
    const heading = index < 0 ? null : accountList.current?.children[index]?.querySelector<HTMLElement>("h3");
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
    heading.scrollIntoView({ block: "start" });
    setCreatedAccountId(null);
  }, [createdAccountId, state]);
  const [addOpen, setAddOpen] = useState(false);
  const addInput = useRef<HTMLInputElement>(null);
  const addToggle = useRef<HTMLButtonElement>(null);
  const focusAddInput = useRef(false);
  useEffect(() => {
    if (!addOpen || !focusAddInput.current) return;
    focusAddInput.current = false;
    addInput.current?.focus();
  }, [addOpen]);
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
  const text = accountsCopy(language);
  if (!state) return <Page className="accounts-page">
    <SurfaceHeader title={copy.accountsTitle} subtitle={copy.accountsBody} />
    {loadFailed
      ? <Notice tone="error" action={<Button ref={retryRef} size="sm" icon="reload" onClick={retryAccounts}>{copy.retry}</Button>}>
        {copy.accountsRefreshFailed}</Notice>
      : <p className="accounts-loading nk-type-small" role="status" aria-live="polite">{copy.accountsLoading}</p>}
  </Page>;
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
  const addVisible = addOpen || state.accounts.length === 0;
  const toggleAdd = () => {
    if (!addVisible) { focusAddInput.current = true; setAddOpen(true); return; }
    if (state.accounts.length === 0) { addInput.current?.focus(); return; }
    setAddOpen(false);
  };
  const submitAdd = () => {
    if (!accountAddDisabled && startingId.current === null && loginLockedIdRef.current === null
      && label.trim()) void run(async () => {
      const existingIds = new Set(state.accounts.map(account => account.id));
      const next = await api.addAccount(label.trim());
      setLabel("");
      setAddOpen(false);
      setCreatedAccountId(existingIds.has(next.selectedId) ? null : next.selectedId);
      return next;
    });
  };
  return <Page className="accounts-page">
    <SurfaceHeader title={copy.accountsTitle} subtitle={copy.accountsBody}
      actions={<Button ref={addToggle} icon="plus" aria-expanded={addVisible} aria-controls="accounts-add"
        onClick={toggleAdd}>{copy.accountsAdd}</Button>} />
    <section className="accounts-surface" aria-label={copy.accountsTitle} aria-busy={busy || transitionBusy}>
      <div id="accounts-add" hidden={!addVisible}><Panel padding="compact" className="accounts-add">
        <form onSubmit={event => { event.preventDefault(); submitAdd(); }}
          onKeyDown={event => {
            if (event.key !== "Escape" || state.accounts.length === 0) return;
            event.preventDefault();
            setAddOpen(false);
            addToggle.current?.focus();
          }}>
          <TextField id="account-name" ref={addInput} label={copy.accountsLabel} maxLength={80}
            autoComplete="off" value={label} disabled={accountAddDisabled} title={accountAddBlockedReason}
            hint={accountAddBlockedReason}
            onChange={event => setLabel(event.target.value)}
            action={<Button type="submit" variant="primary" icon="plus" disabled={accountAddDisabled || !label.trim()}
              title={accountAddBlockedReason}>{copy.accountsAdd}</Button>} />
        </form>
      </Panel></div>
      {loadFailed ? <Notice tone="error" className="accounts-stale-status"
        action={<Button ref={retryRef} size="sm" icon="reload" onClick={retryAccounts}>{copy.retry}</Button>}>
        {copy.accountsRefreshFailed}</Notice> : null}
      {loginSnapshotStatus === "failed" ? <Notice tone="error"
        action={<Button size="sm" icon="reload" onClick={recoverLoginStatus}>{copy.retry}</Button>}>
        {codexCopy.loginStatusUnavailable}</Notice> : null}
      <Panel variant="brand" padding="compact">
        <div className="accounts-routing">
          <div className="accounts-routing__copy">
            <label htmlFor="account-routing" className="nk-type-body-strong">{copy.accountsRouting}</label>
            {manual ? <p id="accounts-manual-reason" className="nk-type-small">{copy.accountsManual}</p> : <p className="nk-type-small">{text.routingBody}</p>}
          </div>
          <Select id="account-routing" value={manual ? "selected" : state.mode} disabled={mutationsDisabled || manual}
            options={[{ value: "selected", label: copy.accountsSelected }, { value: "balanced", label: copy.accountsBalanced }]}
            onChange={value => void run(() => api.setAccountMode(value as "selected" | "balanced"))} />
        </div>
      </Panel>
      <div className="accounts-allowances">
        <Notice meta={refreshAllDisabledReason && !loadFailed ? refreshAllDisabledReason : undefined}
          action={<Button size="sm" icon="reload" busy={refreshAllBusy}
            disabled={Boolean(refreshAllDisabledReason)}
            title={refreshAllDisabledReason}
            onClick={() => void refreshAllQuotas()}>
            {refreshAllBusy ? workflow.portfolio.refreshing : workflow.portfolio.refreshAll}
          </Button>}>
          {codexCopy.quotaReportedOnly}
        </Notice>
        {refreshAllBusy || quotaPortfolio ? <QuotaPortfolioSummary copy={workflow.portfolio}
          pending={refreshAllBusy ? state.accounts.length : 0}
          rows={(quotaPortfolio?.rows ?? []).map(row => ({ status: row.status, snapshot: row.snapshot }))} /> : null}
      </div>
      <div className="accounts-list" ref={accountList}>
        {state.accounts.map((account, accountIndex) => {
          const selected = account.id === state.selectedId;
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
          const selectionReadinessReason = !selected
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
          const toolsDisabled = mutationsDisabled || active || loginBoundActive || quotaReadBusy || authRefreshBusy;
          const runtimeConfigured = toolsSetup.runtimeConfigured;
          const toolsStep = accountToolsStep(account, runtimeConfigured);
          const showCheckConnector = !manual && runtimeConfigured && (toolsStep === "connector" || toolsStep === "verified");
          const pacing = accountPacingStatus(account, language);
          const codexIds = `account-codex-${accountIndex}`;
          const facts: Array<{ label: string; tone?: Tone; dot?: Status }> = [];
          if (authUnavailable) facts.push({ label: workflow.session.verificationUnavailable, tone: "warning", dot: "optional" });
          else if (account.authenticationStatus === "unknown") facts.push({ label: copy.checkingSignIn, dot: "busy" });
          else if (!account.authenticated) facts.push({ label: copy.accountsSignInNeeded, tone: "warning", dot: "optional" });
          facts.push({ label: `${copy.accountsActive}: ${account.activeTurns}`, dot: active ? "busy" : undefined });
          facts.push(account.checked
            ? { label: `${copy.accountsChecked}: ${copy.connectionVerified}`, tone: "success", dot: "ready" }
            : { label: `${copy.accountsChecked}: ${copy.connectionPending}`, dot: "idle" });
          facts.push(account.connectorReady
            ? { label: `${copy.toolConnection}: ${copy.connectionVerified}`, tone: "success", dot: "ready" }
            : { label: `${copy.toolConnection}: ${copy.connectionPending}`, dot: "idle" });
          if (pacing && (pacing.held || !account.safety)) {
            facts.push({ label: `${pacing.label}: ${pacing.value}`, tone: pacing.held ? "warning" : undefined, dot: pacing.held ? "busy" : "ready" });
          }
          return <AccountCard key={account.id} className="accounts-card" name={account.label}
            email={account.accountLabel || (account.authenticated ? copy.accountsSignedIn : undefined)}
            initial={account.label.trim().slice(0, 1).toLocaleUpperCase()}
            selected={selected} selectedLabel={copy.accountsCurrent} facts={facts}
            actions={<>
              <Checkbox label={copy.accountsEnabled} checked={account.enabled} disabled={mutationsDisabled || loginBoundActive}
                title={loginBoundReason}
                aria-describedby={(mutationsDisabled || loginBoundActive) ? describedBy(blockedReason) : undefined}
                onChange={checked => void run(() => api.setAccountEnabled(account.id, checked))} />
              {!authUnavailable ? <Button size="sm" variant={account.authenticated ? "secondary" : "primary"}
                icon="browser"
                disabled={mutationsDisabled || active || loginBoundActive || quotaReadBusy} aria-label={credentialLabel}
                aria-describedby={describedBy(credentialActionReason)}
                title={sessionMutationReason} onClick={() => void run(async () => {
                  const next = await api.selectAccount(account.id);
                  applyReceipt(next);
                  openBrowser();
                  await api.openAccountLogin(account.id);
                  return api.accounts();
                })}>{credentialLabel}</Button> : null}
              {authUnavailable ? <Button size="sm" icon="reload"
                busy={authRefreshBusy}
                disabled={Boolean(authRetryDisabledReason)}
                aria-describedby={authRetryDisabledReason === actionHint ? actionHintId : authRetryReasonId}
                title={authRetryDisabledReason}
                onClick={() => void refreshAuthentication(account.id)}>{authRefreshBusy
                  ? workflow.session.checkingVerification : workflow.session.retryVerification}</Button> : null}
              {!selected ? <Button size="sm"
                disabled={mutationsDisabled || loginBoundActive || !account.authenticated || (!manual && !account.checked)}
                aria-describedby={describedBy(blockedReason ?? selectionReadinessReason)}
                title={loginBoundReason}
                onClick={() => void run(() => api.selectAccount(account.id))}>{copy.accountsSelect}</Button> : null}
              <Button size="sm" variant="ghost" disabled={mutationsDisabled || manual || active || loginBoundActive || !account.authenticated}
                aria-describedby={describedBy(checkActionReason)}
                title={loginBoundReason} onClick={() => void run(() => api.checkAccount(account.id, false))}>{copy.accountsCheck}</Button>
              {showCheckConnector ? <Button size="sm" variant={toolsStep === "verified" ? "ghost" : "primary"}
                disabled={toolsDisabled || !toolsSetup.connectorName}
                onClick={() => void run(() => api.checkAccount(account.id, true))}>{copy.accountsCheckConnector}</Button> : null}
              {authUnavailable && authRetryDisabledReason && authRetryDisabledReason !== actionHint
                ? <p className="accounts-card__hint nk-type-caption" id={authRetryReasonId}>{authRetryDisabledReason}</p> : null}
              {actionHint ? <p className="accounts-card__hint nk-type-caption" id={actionHintId} role="status">{actionHint}</p> : null}
            </>}>
            <div className="accounts-card__body">
              {authUnavailable ? <Notice tone="warning"
                meta={lastVerified ? workflow.session.lastVerifiedAt.replace("{time}", lastVerified) : undefined}
                action={selected ? <Button size="sm" variant="ghost" icon="browser"
                  disabled={mutationsDisabled || active || loginBoundActive || quotaReadBusy}
                  onClick={openBrowser}>{copy.browser}</Button> : undefined}>
                {sessionIssueCopy(language, account.authenticationIssue)}
              </Notice> : null}
              <AccountCodexAllowance copy={codexCopy} idPrefix={codexIds} language={language}
                transitionBusy={transitionBusy}
                quota={quotas.has(account.id) ? quotas.get(account.id) : undefined}
                quotaFailed={quotaFailures.has(account.id)}
                quotaBusy={quotaRefreshing.has(account.id)} quotaDisabledReason={quotaDisabledReason}
                quotaFreshnessCopy={workflow.portfolio} quotaNow={quotaClock}
                onRefreshQuota={() => refreshQuota(account.id)} />
              <div className="accounts-card__more">
                <AccountToolsOnboarding account={account} copy={copy} language={language}
                  runtimeConfigured={runtimeConfigured} connectorName={toolsSetup.connectorName} urls={toolsSetup.urls}
                  manual={manual} disabled={toolsDisabled}
                  focus={focusAccountId === account.id} onError={setError}
                  onSetup={() => onSetupTools(account.id, account.accountLabel ? `${account.label} · ${account.accountLabel}` : account.label)} />
                <AccountCodexLogin account={account} copy={codexCopy} idPrefix={codexIds} language={language}
                  transitionBusy={transitionBusy}
                  quotaDisabledReason={quotaDisabledReason}
                  login={flowForAccount} loginStarting={startingAccountId === account.id}
                  loginRecovery={loginSnapshotStatus === "failed" ? { label: copy.retry, retry: recoverLoginStatus } : undefined}
                  loginDisabledReason={loginDisabledReason}
                  loginAction={loginAction?.accountId === account.id ? loginAction.kind : null}
                  onStartLogin={() => startCodexLogin(account.id)}
                  onOpenLogin={async () => { if (flowForAccount) await openCodexLogin(flowForAccount); }}
                  onCopyCode={async () => flowForAccount ? await copyCodexLoginCode(flowForAccount) : false}
                  onCancelLogin={async () => { if (flowForAccount) await cancelCodexLogin(flowForAccount); }} />
                <AccountReadiness account={account} language={language} />
                {account.safety || account.proxy ? <AccountControlsDisclosure title={text.controlsTitle}
                  held={pacing?.held === true}
                  summary={[account.safety ? pacing?.value : null,
                    account.proxy ? proxyModeOptions(copy).find(option => option.value === account.proxy.mode)?.label ?? account.proxy.mode : null]
                    .filter(Boolean).join(" · ")}
                  pacing={report => account.safety ? <AccountSafetySettings id={account.id} language={language} safety={account.safety} copy={copy}
                    pacingStatus={pacing} onStateChange={report}
                    resumeRequired={account.availability?.reason === "session-limit"}
                    disabled={mutationsDisabled || active || loginBoundActive} blockedReason={blockedReason}
                    save={policy => run(() => api.setAccountSafety(account.id, policy))}
                    resume={() => void run(() => api.resumeAccount(account.id))} /> : null}
                  proxy={report => account.proxy ? <AccountProxySettings proxy={account.proxy} copy={copy} language={language}
                    onStateChange={report}
                    disabled={mutationsDisabled || active || loginBoundActive || quotaReadBusy} blockedReason={sessionMutationReason ?? blockedReason}
                    save={value => run(() => api.setAccountProxy(account.id, value))} /> : null} /> : null}
              </div>
            </div>
          </AccountCard>;
        })}
      </div>
    </section>
  </Page>;
}
