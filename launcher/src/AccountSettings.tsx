import { useEffect, useState } from "react";
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
  useEffect(() => {
    let disposed = false;
    setLoadFailed(false);
    api.accounts().then(value => { if (!disposed) setState(value); }).catch(error => {
      if (!disposed) { setLoadFailed(true); setError(String(error)); }
    });
    return () => { disposed = true; };
  }, [api, setError, attempt]);
  const run = async (action: () => Promise<AccountPoolSnapshot>) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { setState(await action()); }
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
