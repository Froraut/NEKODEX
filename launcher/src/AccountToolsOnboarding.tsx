import { useAccountPoolSnapshot } from "./useAccountPoolSnapshot";
import { useEffect, useRef } from 'react';
import type { Copy } from './i18n';
import type { AccountPoolSnapshot, BrowserState, Language, LauncherSnapshot } from './types';
import { accountToolsCopy, accountToolsHandoffAccount, accountToolsStep } from './account-tools-onboarding';
import './account-tools-onboarding.css';

type Account = AccountPoolSnapshot['accounts'][number];

export function AccountToolsOnboarding({ account, copy, language, runtimeConfigured, connectorName, urls,
  disabled, manual, focus, onSetup, onVerify, onError }: {
  account: Account; copy: Copy; language: Language; runtimeConfigured: boolean; connectorName: string;
  urls: LauncherSnapshot['urls']; disabled: boolean; manual: boolean; focus: boolean;
  onSetup: () => void; onVerify: () => void; onError: (message: string | null) => void;
}) {
  const text = accountToolsCopy(language);
  const step = accountToolsStep(account, runtimeConfigured);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!focus) return;
    heading.current?.scrollIntoView({ block: 'nearest' });
    heading.current?.focus({ preventScroll: true });
  }, [focus]);
  const open = async (url: string) => {
    if (disabled) return;
    onError(null);
    try { await window.codexWebLauncher!.openExternal(url); }
    catch (error) { onError(error instanceof Error ? error.message : String(error)); }
  };
  return <section className="account-tools-onboarding" aria-label={text.title}>
    <h3 tabIndex={-1} ref={heading}>{text.title}</h3>
    <p role="status">{manual ? text.manual : text[step === 'sign-in' ? 'signIn' : step]}</p>
    {step !== 'sign-in' || manual ? <>
      {step !== 'verified' ? <>
        <p>{text.sharedTunnel}</p>
        {runtimeConfigured && !manual ? <>
          <p>{text.instructions}</p>
          <label className="account-tools-identity"><span>{copy.currentSavedConnector}</span>
            <input readOnly aria-label={copy.currentSavedConnector} value={connectorName || copy.connectorIdentityUnavailable}
              onFocus={event => event.currentTarget.select()} /></label>
          <p>{text.identity}</p>
          <div className="inline-actions">
            {urls.developerMode ? <button type="button" className="button-secondary" disabled={disabled}
              onClick={() => void open(urls.developerMode!)}>{copy.openDeveloperMode}</button> : null}
            <button type="button" className="button-secondary" disabled={disabled || !connectorName}
              onClick={() => void open(urls.connectors)}>{copy.openConnectors}</button>
            <button type="button" className="text-button" disabled={disabled}
              onClick={() => void open(urls.tunnels)}>{copy.openTunnels}</button>
          </div>
        </> : null}
      </> : null}
      <div className="inline-actions">
        {!manual && runtimeConfigured ? <button type="button" className={step === 'verified' ? 'button-secondary' : 'button-primary'}
          disabled={disabled || !connectorName} onClick={onVerify}>{copy.accountsCheckConnector}</button> : null}
        <button type="button" className={step === 'runtime' ? 'button-primary' : 'text-button'}
          disabled={disabled} onClick={onSetup}>{text.setup}</button>
      </div>
    </> : null}
  </section>;
}

export function AccountToolsHandoff({ browser, language, disabled, onContinue }: {
  browser: BrowserState; language: Language; disabled: boolean; onContinue: (accountId: string) => void;
}) {
  const { snapshot: pool } = useAccountPoolSnapshot({ api: window.codexWebLauncher!,
    initial: 'immediate', retainOnFailure: false,
    identity: JSON.stringify([browser.accountId, browser.authenticated, browser.authenticationStatus, browser.loginInProgress]),
  });
  const account = pool ? accountToolsHandoffAccount(browser, pool) : null;
  if (!account) return null;
  const text = accountToolsCopy(language);
  return <aside className="account-tools-handoff" aria-label={text.title}>
    <div><strong>{account.accountLabel || account.label}</strong><p>{text.connector}</p></div>
    <button type="button" className="button-secondary" disabled={disabled}
      onClick={() => onContinue(account.id)}>{text.continue}</button>
  </aside>;
}
