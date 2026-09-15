import { useEffect, useState } from 'react';
import type { AccountPoolSnapshot } from './types';
import type { Copy } from './i18n';

export function AccountSettings({ copy, openBrowser, setError, manual }: {
  manual: boolean; copy: Copy; openBrowser: () => void; setError: (message: string | null) => void;
}) {
  const api = window.codexWebLauncher!;
  const [state, setState] = useState<AccountPoolSnapshot | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { let disposed = false;
    api.accounts().then(value => { if (!disposed) setState(value); }).catch(error => { if (!disposed) setError(String(error)); });
    return () => { disposed = true; };
  }, [api, setError]);
  const run = async (action: () => Promise<AccountPoolSnapshot>) => {
    setBusy(true); setError(null);
    try { setState(await action()); } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  if (!state) return <p>{copy.accountsLoading}</p>;
  return <section className="account-settings" aria-label={copy.accountsTitle}>
    <h2>{copy.accountsTitle}</h2>
    <p>{manual ? copy.accountsManual : copy.accountsBody}</p>
    <label>{copy.accountsRouting} <select className="settings-select" value={manual ? "selected" : state.mode} disabled={busy || manual}
      onChange={event => void run(() => api.setAccountMode(event.target.value as 'selected' | 'balanced'))}>
      <option value="selected">{copy.accountsSelected}</option>
      <option value="balanced">{copy.accountsBalanced}</option>
    </select></label>
    {state.accounts.map(account => <div className="account-row" key={account.id}>
      <div><strong>{account.label}</strong>
        <p>{account.accountLabel || (account.authenticated ? copy.accountsSignedIn : copy.accountsSignInNeeded)}
          {' · '}{copy.accountsActive}: {account.activeTurns}
          {account.checked ? ` · ${copy.accountsChecked}` : ''}
          {account.connectorReady ? ` · ${copy.accountsConnectorReady}` : ''}</p></div>
      <div className="account-actions">
        <label><input type="checkbox" checked={account.enabled} disabled={busy}
          onChange={event => void run(() => api.setAccountEnabled(account.id, event.target.checked))} /> {copy.accountsEnabled}</label>
        <button className="text-button" disabled={busy || account.id === state.selectedId}
          onClick={() => void run(() => api.selectAccount(account.id))}>{account.id === state.selectedId ? copy.accountsCurrent : copy.accountsSelect}</button>
        <button className="text-button" disabled={busy} onClick={() => void run(async () => {
          const next = await api.selectAccount(account.id); openBrowser();
          // Login remains an explicit user flow inside the selected isolated session.
          void api.openAccountLogin(account.id).catch(error => setError(String(error)));
          return next;
        })}>{copy.accountsSignIn}</button>
        <button className="text-button" disabled={busy || manual} onClick={() => void run(() => api.checkAccount(account.id, false))}>{copy.accountsCheck}</button>
        <button className="text-button" disabled={busy || manual} onClick={() => void run(() => api.checkAccount(account.id, true))}>{copy.accountsCheckConnector}</button>
      </div>
    </div>)}
    <div className="capacity-controls">
      <input type="text" aria-label={copy.accountsLabel} placeholder={copy.accountsLabel} maxLength={80}
        value={label} disabled={busy} onChange={event => setLabel(event.target.value)} />
      <button className="text-button" disabled={busy || !label.trim()} onClick={() => void run(async () => {
        const next = await api.addAccount(label); setLabel(''); return next;
      })}>{copy.accountsAdd}</button>
    </div>
  </section>;
}
