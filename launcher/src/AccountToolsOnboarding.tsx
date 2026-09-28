import { useAccountPoolSnapshot } from "./useAccountPoolSnapshot";
import { useEffect, useRef, useState } from 'react';
import type { Copy } from './i18n';
import type { AccountPoolSnapshot, BrowserState, Language, LauncherSnapshot } from './types';
import { accountToolsCopy, accountToolsHandoffAccount, accountToolsStep } from './account-tools-onboarding';
import { Button, Disclosure, TextField } from './design';
import './account-tools-onboarding.css';

type Account = AccountPoolSnapshot['accounts'][number];

/** Account tools setup for one account card. "Check connector" lives in the card's action row. */
export function AccountToolsOnboarding({ account, copy, language, runtimeConfigured, connectorName, urls,
  disabled, manual, focus, onSetup, onError }: {
  account: Account; copy: Copy; language: Language; runtimeConfigured: boolean; connectorName: string;
  urls: LauncherSnapshot['urls']; disabled: boolean; manual: boolean; focus: boolean;
  onSetup: () => void; onError: (message: string | null) => void;
}) {
  const text = accountToolsCopy(language);
  const step = accountToolsStep(account, runtimeConfigured);
  const region = useRef<HTMLElement>(null);
  // Returning from the tools setup opens this disclosure once; afterwards the user controls it.
  const [pinnedOpen, setPinnedOpen] = useState(focus);
  useEffect(() => {
    if (!focus) return;
    setPinnedOpen(true);
    const summary = region.current?.querySelector<HTMLElement>('summary');
    summary?.scrollIntoView({ block: 'nearest' });
    summary?.focus({ preventScroll: true });
  }, [focus]);
  const open = async (url: string) => {
    if (disabled) return;
    onError(null);
    try { await window.codexWebLauncher!.openExternal(url); }
    catch (error) { onError(error instanceof Error ? error.message : String(error)); }
  };
  const status = manual ? text.manual : step === 'checking' ? copy.checkingSignIn : text[step === 'sign-in' ? 'signIn' : step];
  return <section className="accounts-tools" aria-label={text.title} ref={region}>
    <Disclosure title={text.title} defaultOpen={pinnedOpen}
      hint={manual ? undefined : step === 'verified' ? copy.connectionVerified : copy.connectionPending}>
      <div className="accounts-disclosure">
      <p role="status">{status}</p>
      {(step !== 'sign-in' && step !== 'verification' && step !== 'checking') || manual ? <>
        {step !== 'verified' ? <>
          <p>{text.sharedTunnel}</p>
          {runtimeConfigured && !manual ? <>
            <p>{text.instructions}</p>
            <TextField className="accounts-tools__identity" label={copy.currentSavedConnector} readOnly
              aria-label={copy.currentSavedConnector} value={connectorName || copy.connectorIdentityUnavailable}
              onFocus={event => event.currentTarget.select()} />
            <p>{text.identity}</p>
            <div className="accounts-inline-actions">
              {urls.developerMode ? <Button size="sm" iconEnd="external" disabled={disabled}
                onClick={() => void open(urls.developerMode!)}>{copy.openDeveloperMode}</Button> : null}
              <Button size="sm" iconEnd="external" disabled={disabled || !connectorName}
                onClick={() => void open(urls.connectors)}>{copy.openConnectors}</Button>
              <Button size="sm" variant="ghost" iconEnd="external" disabled={disabled}
                onClick={() => void open(urls.tunnels)}>{copy.openTunnels}</Button>
            </div>
          </> : null}
        </> : null}
        <div className="accounts-inline-actions">
          <Button size="sm" variant={step === 'runtime' ? 'primary' : 'ghost'} iconEnd="forward"
            disabled={disabled} onClick={onSetup}>{text.setup}</Button>
        </div>
      </> : null}
      </div>
    </Disclosure>
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
