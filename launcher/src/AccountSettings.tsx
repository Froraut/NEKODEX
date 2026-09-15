import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import type { AccountPoolSnapshot } from "./types";
import type { Copy } from "./i18n";

export function AccountSettings({ copy, openBrowser, setError, manual }: {
  manual: boolean; copy: Copy; openBrowser: () => void; setError: (message: string | null) => void;
}) {
  const api = window.codexWebLauncher!;
  const [state, setState] = useState<AccountPoolSnapshot | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const refreshRef = useRef<() => void>(() => {});
  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;
    let inFlight = false;
    let revision = 0;
    const load = () => {
      timer = undefined;
      if (disposed || inFlight) return;
      inFlight = true;
      const requestedRevision = revision;
      void api.accounts().then(value => {
        if (disposed || requestedRevision !== revision) return;
        setState(value);
        setLoadFailed(false);
      }).catch(error => {
        if (disposed || requestedRevision !== revision) return;
        setLoadFailed(true);
        setError(String(error));
      }).finally(() => {
        inFlight = false;
        if (!disposed && requestedRevision !== revision) schedule(false);
      });
    };
    const schedule = (changed = true) => {
      if (disposed) return;
      if (changed && (inFlight || timer === undefined)) revision += 1;
      if (timer === undefined && !inFlight) timer = window.setTimeout(load, 150);
    };
    refreshRef.current = () => schedule();
    // The host publishes the selected browser view even when another account changes.
    const unsubscribeBrowser = api.onBrowserState(() => schedule());
    const unsubscribeOperation = api.onOperation(operation => {
      if (operation.status !== "running") schedule();
    });
    setLoadFailed(false);
    schedule();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      unsubscribeBrowser();
      unsubscribeOperation();
      refreshRef.current = () => {};
    };
  }, [api, setError, attempt]);
  const run = async (action: () => Promise<AccountPoolSnapshot>) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await action(); refreshRef.current(); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  if (!state) return <div className="account-loading" role="status">{loadFailed
    ? <button type="button" className="button-secondary" onClick={() => setAttempt(value => value + 1)}>{copy.retry}</button>
    : copy.accountsLoading}</div>;
  return <section className="account-settings" aria-label={copy.accountsTitle} aria-busy={busy}>
    {manual ? <p>{copy.accountsManual}</p> : null}
    <div className="account-routing">
      <label htmlFor="account-routing">{copy.accountsRouting}</label>
      <select id="account-routing" className="settings-select" value={manual ? "selected" : state.mode} disabled={busy || manual}
        onChange={event => void run(() => api.setAccountMode(event.target.value as "selected" | "balanced"))}>
        <option value="selected">{copy.accountsSelected}</option>
        <option value="balanced">{copy.accountsBalanced}</option>
      </select>
    </div>
    {state.accounts.map(account => <article className={`account-card${account.id === state.selectedId ? " is-selected" : ""}`} key={account.id}>
      <header className="account-card-header">
        <span className="account-avatar" aria-hidden="true">{account.label.trim().slice(0, 1).toLocaleUpperCase()}</span>
        <div><h2>{account.label}</h2><p>{account.accountLabel || (account.authenticated ? copy.accountsSignedIn : copy.accountsSignInNeeded)}</p></div>
        {account.id === state.selectedId ? <span className="account-selected">{copy.accountsCurrent}</span> : null}
      </header>
      <div className="account-facts">
        <span>{copy.accountsActive}: {account.activeTurns}</span>
        <span className={account.checked ? "is-ready" : ""}><i className={`state-dot is-${account.checked ? "ready" : "idle"}`} />{copy.accountsChecked}: {account.checked ? copy.connectionVerified : copy.connectionPending}</span>
        <span className={account.connectorReady ? "is-ready" : ""}><i className={`state-dot is-${account.connectorReady ? "ready" : "idle"}`} />{copy.toolConnection}: {account.connectorReady ? copy.connectionVerified : copy.connectionPending}</span>
      </div>
      <div className="account-actions">
        <label><input type="checkbox" checked={account.enabled} disabled={busy}
          onChange={event => void run(() => api.setAccountEnabled(account.id, event.target.checked))} />{copy.accountsEnabled}</label>
        <button type="button" className="button-primary" disabled={busy} onClick={() => void run(async () => {
          const next = await api.selectAccount(account.id);
          openBrowser();
          void api.openAccountLogin(account.id).catch(error => setError(String(error)));
          return next;
        })}><Icon name="browser" />{copy.accountsSignIn}</button>
        <button type="button" className="button-secondary" disabled={busy || account.id === state.selectedId}
          onClick={() => void run(() => api.selectAccount(account.id))}>{account.id === state.selectedId ? copy.accountsCurrent : copy.accountsSelect}</button>
        <button type="button" className="text-button" disabled={busy || manual} onClick={() => void run(() => api.checkAccount(account.id, false))}>{copy.accountsCheck}</button>
        <button type="button" className="text-button" disabled={busy || manual} onClick={() => void run(() => api.checkAccount(account.id, true))}>{copy.accountsCheckConnector}</button>
      </div>
    </article>)}
    <form className="account-add" onSubmit={event => {
      event.preventDefault();
      if (!busy && label.trim()) void run(async () => {
        const next = await api.addAccount(label.trim()); setLabel(""); return next;
      });
    }}>
      <label htmlFor="account-name">{copy.accountsAdd}</label>
      <div><input id="account-name" type="text" aria-label={copy.accountsLabel} placeholder={copy.accountsLabel} maxLength={80}
        autoComplete="off" value={label} disabled={busy} onChange={event => setLabel(event.target.value)} />
        <button type="submit" className="button-secondary" disabled={busy || !label.trim()}><Icon name="plus" />{copy.accountsAdd}</button></div>
    </form>
  </section>;
}
