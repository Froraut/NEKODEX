import { useAccountPoolSnapshot } from "./useAccountPoolSnapshot";
import { useAccountCodexLogin } from "./useAccountCodexLogin";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AccountSafetySettings, type AccountFormState } from "./AccountSafetySettings";
import { AccountProxySettings, proxyModeOptions } from "./AccountProxySettings";
import { AccountCodexAllowance, AccountCodexLogin, AccountCodexLoginProgress } from "./AccountCodexControls";
import { AccountReadiness, accountPacingStatus } from "./AccountReadiness";
import { AccountToolsOnboarding } from "./AccountToolsOnboarding";
import { quotaPortfolioSummary } from "./QuotaPortfolioSummary";
import { accountToolsCopy, accountToolsStep } from "./account-tools-onboarding";
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

/** The card action (or page action) a pool mutation is running for: that control shows the spinner. */
type PendingKind = "enabled" | "credentials" | "select" | "check" | "connector" | "mode" | "add" | "safety" | "proxy" | "resume";
type Pending = { kind: PendingKind; accountId: string | null };

/** The page's one next step, which alone gets the primary button. */
type PrimaryStep = { kind: "add" | "runtime" } | { kind: "login-open" | "sign-in" | "check" | "connector"; accountId: string };

/** Moves focus to a heading (or other non-control) that only script focuses; accounts.css hides its ring. */
function focusTarget(element: HTMLElement | null | undefined) {
  if (!element) return;
  if (!element.matches("button, input, select, textarea, summary, a[href]")) element.tabIndex = -1;
  element.focus();
}

/**
 * The card's one disclosure: account tools setup, Codex sign-in, models, pacing and proxy. Its summary is one line:
 * what is inside ("Pacing on · Proxy: System settings"), led by a short token while a form there is unsaved,
 * saving or failed. `focus` (returning from the shared tools setup) opens it once and focuses its summary.
 */
function AccountDetails({ title, summary, tokens, focus, children }: {
  title: string; summary: string[]; focus: boolean;
  tokens: Record<NonNullable<AccountFormState>, string>;
  children: (report: { pacing: (state: AccountFormState) => void; proxy: (state: AccountFormState) => void }) => ReactNode;
}) {
  const summaryRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(focus);
  const [pacingState, setPacingState] = useState<AccountFormState>(null);
  const [proxyState, setProxyState] = useState<AccountFormState>(null);
  useEffect(() => {
    if (!focus) return;
    setOpen(true);
    summaryRef.current?.scrollIntoView({ block: "nearest" });
    summaryRef.current?.focus({ preventScroll: true });
  }, [focus]);
  const states = [pacingState, proxyState];
  const formState = (["failed", "saving", "unsaved"] as const).find(state => states.includes(state)) ?? null;
  const plain = [formState ? tokens[formState] : null, ...summary].filter(Boolean).join(" · ");
  const hint = plain ? <span className="accounts-details__hint" title={plain}>
    {formState ? <><span className={cx("accounts-details__state", `is-${formState}`)}>{tokens[formState]}</span>
      {summary.length ? " · " : null}</> : null}
    {summary.join(" · ")}
  </span> : undefined;
  return <Disclosure className="accounts-details" title={title} hint={hint} open={open} onToggle={setOpen} summaryRef={summaryRef}>
    <div className="accounts-details__body">{children({ pacing: setPacingState, proxy: setProxyState })}</div>
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
  const { snapshot: state, failed: loadFailed, loading: poolLoading, retry: retryPool, applyReceipt } = useAccountPoolSnapshot({ api });
  const [label, setLabel] = useState("");
  const [createdAccountId, setCreatedAccountId] = useState<string | null>(null);
  // The new account's card hands over its name heading, which takes focus once the card has rendered.
  const createdHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!createdAccountId || !state) return;
    const heading = createdHeading.current;
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
  const [pending, setPending] = useState<Pending | null>(null);
  const busy = pending !== null;
  const actionInFlight = useRef(false);
  const retryRef = useRef<HTMLButtonElement | null>(null);
  // A focused control that an action removes (Select on the card that became selected, Retry verification once
  // verified) hands focus to the card's next action, or its name heading, instead of <body>.
  const focusReturn = useRef<{ accountId: string; trigger: Element } | null>(null);
  const rememberFocus = (accountId: string) => {
    const trigger = document.activeElement;
    focusReturn.current = trigger && trigger !== document.body ? { accountId, trigger } : null;
  };
  useEffect(() => {
    const target = focusReturn.current;
    if (!target) return;
    const active = document.activeElement;
    if (target.trigger.isConnected) {
      if (active !== target.trigger) focusReturn.current = null;
      return;
    }
    focusReturn.current = null;
    if (active && active !== document.body && active.isConnected) return;
    const card = [...document.querySelectorAll<HTMLElement>(".accounts-list > [data-account-id]")]
      .find(element => element.dataset.accountId === target.accountId);
    focusTarget(card?.querySelector<HTMLElement>(".accounts-card__buttons .nk-btn:not(:disabled)")
      ?? card?.querySelector<HTMLElement>(".nk-account__who > :is(h2, h3, h4)"));
  });
  const focusAddAfterFailure = useRef(false);
  // Retry of a failed account read: spinner until that read settles; on success focus goes to the page heading
  // (the notice holding Retry is gone).
  const [retrying, setRetrying] = useState(false);
  const retrySawLoading = useRef(false);
  const retryRequested = useRef(false);
  useEffect(() => {
    if (!retrying) return;
    if (poolLoading) { retrySawLoading.current = true; return; }
    if (!retrySawLoading.current) return;
    retrySawLoading.current = false;
    setRetrying(false);
  }, [retrying, poolLoading]);
  useEffect(() => {
    if (!retryRequested.current || retrying) return;
    retryRequested.current = false;
    if (loadFailed || !state) return;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    focusTarget(document.querySelector<HTMLElement>(".accounts-page > .nk-surface-header h1"));
  }, [loadFailed, retrying, state]);
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
        } catch {
          // The card says the allowance could not be read; a toast would repeat it without more detail.
          if (!disposed && quotaRevisions.current.get(id) === revision) setQuotaFailures(current => new Set(current).add(id));
        }
      }
    })();
    return () => { disposed = true; };
  }, [api, quotaEvidenceKey]);

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
    rememberFocus(id);
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

  const run = async (kind: PendingKind, accountId: string | null, action: () => Promise<AccountPoolSnapshot>,
    onFailed?: () => void) => {
    if (transitionBusy || loadFailed || actionInFlight.current) return false;
    actionInFlight.current = true;
    if (accountId) rememberFocus(accountId);
    setPending({ kind, accountId }); setError(null);
    try {
      const next = await action();
      applyReceipt(next);
      return true;
    }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); onFailed?.(); return false; }
    finally { actionInFlight.current = false; setPending(null); }
  };
  const retryAccounts = () => {
    setError(null);
    retryRequested.current = true;
    retrySawLoading.current = false;
    setRetrying(true);
    retryPool();
  };
  // A failed add keeps the typed name: focus returns to it once the field is enabled again.
  useEffect(() => {
    if (busy || !focusAddAfterFailure.current) return;
    focusAddAfterFailure.current = false;
    addInput.current?.focus();
  }, [busy]);
  // Closing the add form brings back the header's "Add account" button, which takes focus again.
  const focusAddToggle = useRef(false);
  useEffect(() => {
    if (addOpen || !focusAddToggle.current) return;
    focusAddToggle.current = false;
    addToggle.current?.focus();
  }, [addOpen]);
  // "Sign in to Codex" was pressed on this account: its flow takes focus when the start button goes away.
  const loginStartRequested = useRef<string | null>(null);
  const text = accountsCopy(language);
  const toolsText = accountToolsCopy(language);
  if (!state) return <Page className="accounts-page">
    <SurfaceHeader title={copy.accountsTitle} subtitle={copy.accountsBody} />
    {loadFailed
      ? <Notice tone="error" action={<Button ref={retryRef} size="sm" icon="reload" busy={retrying} onClick={retryAccounts}>{copy.retry}</Button>}>
        {text.loadFailed}</Notice>
      : <p className="accounts-loading nk-type-small" role="status" aria-live="polite">{copy.accountsLoading}</p>}
  </Page>;
  const mutationsDisabled = transitionBusy || busy || loadFailed;
  const transitionReason = transitionBusy ? copy.loading : undefined;
  const loadFailedReason = loadFailed ? copy.accountsRefreshFailed : undefined;
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
  // The allowance notice names a lasting reason once. A running refresh shows only as the spinner on its button.
  const allowanceReason = refreshAllDisabledReason && refreshAllDisabledReason !== transitionReason
    && refreshAllDisabledReason !== loadFailedReason && refreshAllDisabledReason !== codexCopy.quotaChecking
    ? refreshAllDisabledReason : undefined;
  const portfolioSummary = !refreshAllBusy && quotaPortfolio
    ? quotaPortfolioSummary(text, quotaPortfolio.rows, language) : null;
  const freshnessCopy = { ...workflow.portfolio, quotaUnavailable: text.quotaRefreshFailed };
  // Reasons that are already on screen once for the whole page: disabled card controls point at them.
  const pageReasons = new Map<string, string>();
  if (manual) pageReasons.set(copy.accountsManual, "accounts-manual-reason");
  if (loadFailedReason) pageReasons.set(loadFailedReason, "accounts-stale-status");
  if (allowanceReason) pageReasons.set(allowanceReason, "accounts-allowance-reason");
  if (refreshAllBusy) pageReasons.set(codexCopy.quotaChecking, "accounts-refresh-all");
  const recoverLoginStatus = () => { setError(null); retryLogin(); };
  const addVisible = addOpen || state.accounts.length === 0;
  const openAdd = () => { focusAddInput.current = true; setAddOpen(true); };
  const closeAdd = () => {
    if (state.accounts.length === 0) return;
    focusAddToggle.current = true;
    setAddOpen(false);
  };
  const submitAdd = () => {
    if (!accountAddDisabled && startingId.current === null && loginLockedIdRef.current === null
      && label.trim()) void run("add", null, async () => {
      const existingIds = new Set(state.accounts.map(account => account.id));
      const next = await api.addAccount(label.trim());
      setLabel("");
      setAddOpen(false);
      setCreatedAccountId(existingIds.has(next.selectedId) ? null : next.selectedId);
      return next;
    }, () => { focusAddAfterFailure.current = true; });
  };
  // The shared tunnel runtime is set up once for every account: one page notice instead of a step in each card.
  const runtimeAccount = !manual && !toolsSetup.runtimeConfigured
    ? [state.accounts.find(account => account.id === state.selectedId), ...state.accounts]
      .find(account => account && accountToolsStep(account, false) === "runtime") ?? null
    : null;
  const primaryStep = ((): PrimaryStep | null => {
    if (addVisible) return { kind: "add" };
    if (login?.active && login.canOpen && state.accounts.some(account => account.id === login.accountId)) {
      return { kind: "login-open", accountId: login.accountId };
    }
    const signIn = state.accounts.find(account => !account.authenticated
      && account.authenticationStatus !== "unknown" && account.authenticationStatus !== "unavailable");
    if (signIn) return { kind: "sign-in", accountId: signIn.id };
    if (manual) return null;
    const check = state.accounts.find(account => account.authenticated && !account.checked
      && (!account.authenticationStatus || account.authenticationStatus === "verified"));
    if (check) return { kind: "check", accountId: check.id };
    if (runtimeAccount) return { kind: "runtime" };
    const connector = toolsSetup.runtimeConfigured && toolsSetup.connectorName
      ? state.accounts.find(account => accountToolsStep(account, true) === "connector") : undefined;
    return connector ? { kind: "connector", accountId: connector.id } : null;
  })();
  const isPrimary = (kind: PrimaryStep["kind"], accountId?: string) => primaryStep?.kind === kind
    && (!("accountId" in primaryStep) || primaryStep.accountId === accountId);
  return <Page className="accounts-page">
    <SurfaceHeader title={copy.accountsTitle} subtitle={copy.accountsBody}
      actions={!addVisible ? <Button ref={addToggle} icon="plus" aria-expanded={false} aria-controls="accounts-add"
        onClick={openAdd}>{copy.accountsAdd}</Button> : undefined} />
    <section className="accounts-surface" aria-label={copy.accountsTitle} aria-busy={busy || transitionBusy}>
      <div id="accounts-add" hidden={!addVisible}><Panel padding="compact" className="accounts-add">
        <form onSubmit={event => { event.preventDefault(); submitAdd(); }}
          onKeyDown={event => {
            if (event.key !== "Escape" || state.accounts.length === 0) return;
            event.preventDefault();
            closeAdd();
          }}>
          <TextField id="account-name" ref={addInput} label={copy.accountsLabel} maxLength={80}
            autoComplete="off" value={label} disabled={accountAddDisabled} title={accountAddBlockedReason}
            hint={accountAddBlockedReason}
            onChange={event => setLabel(event.target.value)}
            action={<>
              <Button type="submit" variant="primary" icon="plus" busy={pending?.kind === "add"}
                disabled={accountAddDisabled || !label.trim()} title={accountAddBlockedReason}>{copy.accountsAdd}</Button>
              {state.accounts.length > 0 ? <Button variant="ghost" onClick={closeAdd}>{text.cancel}</Button> : null}
            </>} />
        </form>
      </Panel></div>
      {loadFailed ? <Notice tone="error" id="accounts-stale-status" className="accounts-stale-status"
        action={<Button ref={retryRef} size="sm" icon="reload" busy={retrying} onClick={retryAccounts}>{copy.retry}</Button>}>
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
            onChange={value => void run("mode", null, () => api.setAccountMode(value as "selected" | "balanced"))} />
        </div>
      </Panel>
      <Notice className="accounts-allowances"
        meta={allowanceReason || portfolioSummary ? <>
          {allowanceReason ? <span id="accounts-allowance-reason">{allowanceReason}</span> : null}
          {allowanceReason && portfolioSummary ? <span aria-hidden="true"> · </span> : null}
          {portfolioSummary ? <span className="accounts-portfolio">{portfolioSummary}</span> : null}
        </> : undefined}
        action={<Button id="accounts-refresh-all" size="sm" icon="reload" busy={refreshAllBusy}
          disabled={Boolean(refreshAllDisabledReason)}
          title={refreshAllDisabledReason}
          aria-describedby={allowanceReason ? "accounts-allowance-reason" : undefined}
          onClick={() => void refreshAllQuotas()}>
          {refreshAllBusy ? text.refreshingAll : text.refreshAll}
        </Button>}>
        {codexCopy.quotaReportedOnly}
      </Notice>
      {runtimeAccount ? <Notice className="accounts-runtime"
        action={<Button size="sm" variant={isPrimary("runtime") ? "primary" : "secondary"} iconEnd="forward"
          disabled={mutationsDisabled}
          onClick={() => onSetupTools(runtimeAccount.id, runtimeAccount.accountLabel
            ? `${runtimeAccount.label} · ${runtimeAccount.accountLabel}` : runtimeAccount.label)}>{toolsText.setup}</Button>}>
        {text.runtimeNotice}
      </Notice> : null}
      <div className="accounts-list">
        {state.accounts.map((account, accountIndex) => {
          const selected = account.id === state.selectedId;
          const credentialLabel = account.authenticated ? copy.replaceCredentials : copy.accountsSignIn;
          const authUnavailable = account.authenticationStatus === "unavailable";
          const authChecking = account.authenticationStatus === "unknown";
          const authRefreshBusy = authRefreshing.has(account.id);
          const lastVerified = localizedTime(account.lastVerifiedAt, language);
          const active = account.activeTurns > 0;
          const pendingHere = pending?.accountId === account.id ? pending.kind : null;
          const flowForAccount = login?.accountId === account.id ? login : null;
          const flowAccount = login ? state.accounts.find(candidate => candidate.id === login.accountId) : null;
          const loginBoundActive = startingAccountId === account.id
            || flowForAccount?.active === true || flowForAccount?.settling === true;
          const loginBoundReason = flowForAccount?.settling
            ? codexCopy.loginSettlingCurrent.replace("{account}", account.label)
            : loginBoundActive ? codexCopy.loginCurrent.replace("{account}", account.label) : undefined;
          const quotaReadBusy = quotaRefreshing.has(account.id);
          const sessionMutationReason = loginBoundReason ?? (quotaReadBusy ? codexCopy.quotaChecking : undefined);
          // A pool mutation in progress disables the other actions without a caption: its button shows the spinner.
          const blockedReason = transitionReason ?? loadFailedReason ?? loginBoundReason
            ?? (active ? copy.accountsBusyTasks.replace("{count}", String(account.activeTurns)) : undefined);
          const readinessReason = authUnavailable ? workflow.session.verificationUnavailable
            : authChecking ? text.waitForSessionCheck
            : !account.authenticated ? codexCopy.quotaSignedOut : undefined;
          const selectReason = blockedReason ?? readinessReason
            ?? (!manual && !account.checked ? text.selectNeedsCheck : undefined);
          const checkReason = blockedReason ?? (manual ? copy.accountsManual : readinessReason);
          const credentialReason = blockedReason ?? (quotaReadBusy ? codexCopy.quotaChecking : undefined);
          const anotherLoginReason = (startingAccountId !== null && startingAccountId !== account.id)
            || Boolean(login && (login.active || login.settling) && login.accountId !== account.id)
            ? (login?.settling ? codexCopy.loginSettlingCurrent : codexCopy.loginCurrent)
              .replace("{account}", flowAccount?.label ?? login?.accountId ?? "Codex") : undefined;
          const loginDisabledReason = transitionReason ?? (loadFailed ? copy.accountsRefreshFailed
            : quotaReadBusy ? codexCopy.quotaChecking
            : authUnavailable ? workflow.session.verificationUnavailable
              : authChecking && !account.authenticated ? text.waitForSessionCheck
              : !account.authenticated ? codexCopy.quotaSignedOut
            : loginSnapshotStatus === "loading" ? codexCopy.loginStarting
              : loginSnapshotStatus === "failed" ? codexCopy.loginFailed : anotherLoginReason);
          const retryAt = quotas.get(account.id)?.retryAt;
          const quotaRetryBlocked = typeof retryAt === "string" && Number.isFinite(Date.parse(retryAt)) && Date.parse(retryAt) > quotaClock;
          const quotaDisabledReason = transitionReason ?? (loadFailed ? copy.accountsRefreshFailed
            : manual ? codexCopy.quotaManualUnavailable
            : authUnavailable ? workflow.session.verificationUnavailable
              : authChecking && !account.authenticated ? text.waitForSessionCheck
              : !account.authenticated ? codexCopy.quotaSignedOut
              : refreshAllBusy ? codexCopy.quotaChecking
                : loginBoundReason ?? (quotaRetryBlocked ? codexCopy.quotaRateLimited : undefined));
          const toolsDisabled = mutationsDisabled || active || loginBoundActive || quotaReadBusy || authRefreshBusy;
          const runtimeConfigured = toolsSetup.runtimeConfigured;
          const toolsStep = accountToolsStep(account, runtimeConfigured);
          const showCheckConnector = !manual && runtimeConfigured && (toolsStep === "connector" || toolsStep === "verified");
          const pacing = accountPacingStatus(account, language);
          const ids = {
            codex: `account-codex-${accountIndex}`,
            session: `account-session-${accountIndex}`,
            flow: `account-flow-${accountIndex}`,
            hint: `account-action-reason-${accountIndex}`,
            details: `account-details-${accountIndex}`,
          };
          // Reasons already on screen (page notices, this card's session notice, sign-in flow or allowance line):
          // disabled controls point at them, and the action row shows at most one other reason.
          const shown = new Map(pageReasons);
          if (authUnavailable) shown.set(workflow.session.verificationUnavailable, ids.session);
          if (flowForAccount && (flowForAccount.active || flowForAccount.settling) && loginBoundReason) shown.set(loginBoundReason, ids.flow);
          if (quotaReadBusy && !refreshAllBusy) shown.set(codexCopy.quotaChecking, `${ids.codex}-quota-refresh`);
          const quotaReasonId = quotaDisabledReason ? shown.get(quotaDisabledReason) : undefined;
          if (quotaDisabledReason && !quotaReasonId) shown.set(quotaDisabledReason, `${ids.codex}-quota-reason`);
          const enabledDisabled = mutationsDisabled || loginBoundActive;
          const credentialDisabled = mutationsDisabled || active || loginBoundActive || quotaReadBusy;
          const authRetryDisabled = Boolean(credentialReason);
          const selectDisabled = mutationsDisabled || loginBoundActive || !account.authenticated || (!manual && !account.checked);
          const checkDisabled = mutationsDisabled || manual || active || loginBoundActive || !account.authenticated;
          const caption = [
            enabledDisabled ? blockedReason : undefined,
            !authUnavailable && credentialDisabled ? credentialReason : undefined,
            authUnavailable && authRetryDisabled ? credentialReason : undefined,
            !selected && selectDisabled ? selectReason : undefined,
            checkDisabled ? checkReason : undefined,
          ].find(reason => reason && !shown.has(reason));
          const describedBy = (disabled: boolean, reason?: string) => !disabled || !reason ? undefined
            : shown.get(reason) ?? (reason === caption ? ids.hint : undefined);
          const facts: Array<{ label: string; tone?: Tone; dot?: Status }> = [];
          if (authUnavailable) facts.push({ label: workflow.session.verificationUnavailable, tone: "warning", dot: "optional" });
          else if (authChecking) facts.push({ label: copy.checkingSignIn, dot: "busy" });
          else if (!account.authenticated) facts.push({ label: copy.accountsSignInNeeded, tone: "warning", dot: "optional" });
          facts.push({ label: `${copy.accountsActive}: ${account.activeTurns}`, dot: active ? "busy" : undefined });
          facts.push(account.checked
            ? { label: `${copy.accountsChecked}: ${copy.connectionVerified}`, tone: "success", dot: "ready" }
            : { label: `${copy.accountsChecked}: ${copy.connectionPending}`, dot: "idle" });
          // The same evidence as the tools setup's "verified" step (and the Check connector button's weight).
          facts.push(account.checked && account.connectorReady
            ? { label: `${copy.toolConnection}: ${copy.connectionVerified}`, tone: "success", dot: "ready" }
            : { label: `${copy.toolConnection}: ${copy.connectionPending}`, dot: "idle" });
          if (pacing && (pacing.held || !account.safety)) {
            facts.push({ label: `${pacing.label}: ${pacing.value}`, tone: pacing.held ? "warning" : undefined, dot: pacing.held ? "busy" : "ready" });
          }
          const proxyLabel = account.proxy
            ? proxyModeOptions(copy).find(option => option.value === account.proxy.mode)?.label ?? account.proxy.mode : null;
          const detailsSummary = [
            account.safety ? account.safety.policy.enabled ? text.pacingOn : text.pacingOff : null,
            proxyLabel ? text.proxyMode.replace("{mode}", proxyLabel) : null,
          ].filter((part): part is string => Boolean(part));
          const checkVariant = isPrimary("check", account.id) ? "primary"
            : !manual && account.authenticated && !account.checked ? "secondary" : "ghost";
          return <AccountCard key={account.id} data-account-id={account.id} className="accounts-card" name={account.label} headingLevel={2}
            headingRef={account.id === createdAccountId ? createdHeading : undefined}
            email={account.accountLabel || (account.authenticated ? copy.accountsSignedIn : undefined)}
            initial={account.label.trim().slice(0, 1).toLocaleUpperCase()}
            selected={selected} selectedLabel={copy.accountsCurrent} facts={facts}
            actions={<>
              <Checkbox label={copy.accountsEnabled} checked={account.enabled} disabled={enabledDisabled}
                title={loginBoundReason}
                aria-describedby={describedBy(enabledDisabled, blockedReason)}
                onChange={checked => void run("enabled", account.id, () => api.setAccountEnabled(account.id, checked))} />
              <div className="accounts-card__buttons">
                {!authUnavailable ? <Button size="sm" variant={isPrimary("sign-in", account.id) ? "primary" : "secondary"}
                  icon="browser" busy={pendingHere === "credentials"}
                  disabled={credentialDisabled} aria-label={credentialLabel}
                  aria-describedby={describedBy(credentialDisabled, credentialReason)}
                  title={sessionMutationReason} onClick={() => void run("credentials", account.id, async () => {
                    const next = await api.selectAccount(account.id);
                    applyReceipt(next);
                    openBrowser();
                    await api.openAccountLogin(account.id);
                    return api.accounts();
                  })}>{credentialLabel}</Button> : null}
                {authUnavailable ? <Button size="sm" icon="reload"
                  busy={authRefreshBusy}
                  disabled={authRetryDisabled}
                  aria-describedby={describedBy(authRetryDisabled, credentialReason)}
                  title={credentialReason}
                  onClick={() => void refreshAuthentication(account.id)}>{authRefreshBusy
                    ? workflow.session.checkingVerification : workflow.session.retryVerification}</Button> : null}
                {!selected ? <Button size="sm" busy={pendingHere === "select"}
                  disabled={selectDisabled}
                  aria-describedby={describedBy(selectDisabled, selectReason)}
                  title={selectDisabled ? selectReason : undefined}
                  onClick={() => void run("select", account.id, () => api.selectAccount(account.id))}>{copy.accountsSelect}</Button> : null}
                <Button size="sm" variant={checkVariant} busy={pendingHere === "check"}
                  disabled={checkDisabled}
                  aria-describedby={describedBy(checkDisabled, checkReason)}
                  title={checkDisabled ? checkReason : undefined}
                  onClick={() => void run("check", account.id, () => api.checkAccount(account.id, false))}>
                  {pendingHere === "check" ? workflow.session.checkingVerification : copy.accountsCheck}</Button>
                {showCheckConnector ? <Button size="sm"
                  variant={isPrimary("connector", account.id) ? "primary" : toolsStep === "verified" ? "ghost" : "secondary"}
                  busy={pendingHere === "connector"}
                  disabled={toolsDisabled || !toolsSetup.connectorName}
                  onClick={() => void run("connector", account.id, () => api.checkAccount(account.id, true))}>
                  {pendingHere === "connector" ? workflow.session.checkingVerification : copy.accountsCheckConnector}</Button> : null}
              </div>
              {caption ? <p className="accounts-card__hint nk-type-caption" id={ids.hint} role="status">{caption}</p> : null}
            </>}>
            <div className="accounts-card__body">
              {authUnavailable ? <Notice tone="warning" id={ids.session}
                meta={lastVerified ? workflow.session.lastVerifiedAt.replace("{time}", lastVerified) : undefined}
                action={selected ? <Button size="sm" variant="ghost" icon="browser"
                  disabled={mutationsDisabled || active || loginBoundActive || quotaReadBusy}
                  onClick={openBrowser}>{copy.browser}</Button> : undefined}>
                {sessionIssueCopy(language, account.authenticationIssue)}
              </Notice> : null}
              {flowForAccount ? <AccountCodexLoginProgress account={account} copy={codexCopy} language={language}
                login={flowForAccount} statusId={ids.flow} primary={isPrimary("login-open", account.id)}
                transitionBusy={transitionBusy}
                claimFocus={loginStartRequested.current === account.id}
                onFocusClaimed={() => { loginStartRequested.current = null; }}
                loginAction={loginAction?.accountId === account.id ? loginAction.kind : null}
                onOpenLogin={async () => { await openCodexLogin(flowForAccount); }}
                onCopyCode={async () => await copyCodexLoginCode(flowForAccount)}
                onCancelLogin={async () => { await cancelCodexLogin(flowForAccount); }} /> : null}
              <AccountCodexAllowance copy={codexCopy} idPrefix={ids.codex} language={language}
                transitionBusy={transitionBusy}
                quota={quotas.has(account.id) ? quotas.get(account.id) : undefined}
                quotaFailed={quotaFailures.has(account.id)}
                quotaReadFailedText={text.quotaReadFailed}
                quotaBusy={quotaReadBusy && !refreshAllBusy} quotaDisabledReason={quotaDisabledReason}
                quotaReasonId={quotaReasonId}
                quotaFreshnessCopy={freshnessCopy} quotaNow={quotaClock}
                onRefreshQuota={() => refreshQuota(account.id)} />
              <AccountDetails title={text.detailsTitle} summary={detailsSummary} focus={focusAccountId === account.id}
                tokens={{ failed: text.notSaved, saving: copy.accountFormSaving, unsaved: copy.accountFormUnsaved }}>
                {report => <>
                  <AccountToolsOnboarding account={account} copy={copy} language={language} headingId={`${ids.details}-tools`}
                    runtimeConfigured={runtimeConfigured} connectorName={toolsSetup.connectorName} urls={toolsSetup.urls}
                    manual={manual} disabled={toolsDisabled} onError={setError}
                    onSetup={() => onSetupTools(account.id, account.accountLabel ? `${account.label} · ${account.accountLabel}` : account.label)} />
                  <AccountCodexLogin copy={codexCopy} headingId={`${ids.details}-login`} idPrefix={ids.codex}
                    transitionBusy={transitionBusy}
                    login={flowForAccount} loginStarting={startingAccountId === account.id}
                    loginRecovery={loginSnapshotStatus === "failed" ? { label: copy.retry, retry: recoverLoginStatus } : undefined}
                    loginDisabledReason={loginDisabledReason}
                    onStartLogin={() => { loginStartRequested.current = account.id; return startCodexLogin(account.id); }} />
                  <AccountReadiness account={account} language={language} headingId={`${ids.details}-models`}
                    notChecked={text.modelsNotChecked} />
                  {account.safety ? <AccountSafetySettings id={account.id} language={language} safety={account.safety} copy={copy}
                    pacingStatus={pacing} onStateChange={report.pacing}
                    resumeRequired={account.availability?.reason === "session-limit"}
                    disabled={mutationsDisabled || active || loginBoundActive} blockedReason={blockedReason}
                    save={policy => run("safety", account.id, () => api.setAccountSafety(account.id, policy))}
                    resume={() => void run("resume", account.id, () => api.resumeAccount(account.id))} /> : null}
                  {account.proxy ? <AccountProxySettings proxy={account.proxy} copy={copy} language={language}
                    onStateChange={report.proxy}
                    disabled={mutationsDisabled || active || loginBoundActive || quotaReadBusy} blockedReason={sessionMutationReason ?? blockedReason}
                    save={value => run("proxy", account.id, () => api.setAccountProxy(account.id, value))} /> : null}
                </>}
              </AccountDetails>
            </div>
          </AccountCard>;
        })}
      </div>
    </section>
  </Page>;
}
