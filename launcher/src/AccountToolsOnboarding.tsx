import { useAccountPoolSnapshot } from "./useAccountPoolSnapshot";
import type { Copy } from './i18n';
import type { AccountPoolSnapshot, BrowserState, Language, LauncherSnapshot } from './types';
import { accountToolsCopy, accountToolsHandoffAccount, accountToolsStep } from './account-tools-onboarding';
import { Button, Notice, TextField } from './design';

type Account = AccountPoolSnapshot['accounts'][number];

/** Account tools setup: a section of the card's setup disclosure. "Check connector" lives in the card's action row. */
export function AccountToolsOnboarding({ account, copy, language, runtimeConfigured, connectorName, urls,
  disabled, manual, headingId, onSetup, onError }: {
  account: Account; copy: Copy; language: Language; runtimeConfigured: boolean; connectorName: string;
  urls: LauncherSnapshot['urls']; disabled: boolean; manual: boolean; headingId: string;
  onSetup: () => void; onError: (message: string | null) => void;
}) {
  const text = accountToolsCopy(language);
  const step = accountToolsStep(account, runtimeConfigured);
  // Platform pages (tunnels) open in the system browser; ChatGPT pages open in this account's own window, so developer
  // mode and the connector are set up in this account rather than whichever one the system browser is signed in to.
  const open = async (url: string, inAccount = false) => {
    if (disabled) return;
    onError(null);
    try {
      if (inAccount) await window.codexWebLauncher!.openBrowserWorkspace(account.id, { asTab: false, address: url });
      else await window.codexWebLauncher!.openExternal(url);
    } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
  };
  const status = manual ? text.manual : step === 'checking' ? copy.checkingSignIn : text[step === 'sign-in' ? 'signIn' : step];
  return <section className="accounts-details__section accounts-tools" aria-labelledby={headingId}>
    <h3 id={headingId} className="nk-type-label">{text.title}</h3>
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
            {urls.developerMode ? <Button size="sm" iconEnd="browser" disabled={disabled}
              onClick={() => void open(urls.developerMode!, true)}>{copy.openDeveloperMode}</Button> : null}
            <Button size="sm" iconEnd="browser" disabled={disabled || !connectorName}
              onClick={() => void open(urls.connectors, true)}>{copy.openConnectors}</Button>
            <Button size="sm" variant="ghost" iconEnd="external" disabled={disabled}
              onClick={() => void open(urls.tunnels)}>{copy.openTunnels}</Button>
          </div>
        </> : null}
      </> : null}
      {/* The shared runtime is set up once from the page-level notice; this per-account entry stays secondary. */}
      <div className="accounts-inline-actions">
        <Button size="sm" variant="ghost" iconEnd="forward"
          disabled={disabled} onClick={onSetup}>{text.setup}</Button>
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
  // A kit Notice among the Browser surface's notices: the account and its next step, and the way back to Accounts.
  return <Notice data-testid="account-tools-handoff" title={text.title}
    action={<Button size="sm" disabled={disabled} onClick={() => onContinue(account.id)}>{text.continue}</Button>}>
    {account.accountLabel || account.label} · {text.connector}
  </Notice>;
}
