import { useEffect, useRef, useState } from 'react';
import { accountTunnelCredentialCopy } from './account-tunnel-credential-copy';
import { Button, Notice } from './design';
import type { AccountTunnelCredentialMigrationResult, AccountTunnelView, BrowserInteractionMode, Language } from './types';

type Props = {
  accountId: string; interactionMode: BrowserInteractionMode; language: Language;
  tunnel: AccountTunnelView | null; disabled: boolean; onChanged: () => void;
};

/** Migration owns no secrets or process lifecycle here. Main captures the current principal and exact lease. */
export function AccountTunnelCredentialStatus(props: Props) {
  return <ScopedCredentialStatus key={JSON.stringify([props.accountId, props.interactionMode, props.tunnel?.tunnelId])} {...props} />;
}

function ScopedCredentialStatus({ accountId, interactionMode, language, tunnel, disabled, onChanged }: Props) {
  const text = accountTunnelCredentialCopy(language);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [result, setResult] = useState<AccountTunnelCredentialMigrationResult | null>(null);
  const inFlight = useRef(false);
  const settledObservation = useRef<AccountTunnelView | null>(null);
  const currentObservation = useRef(tunnel);
  currentObservation.current = tunnel;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const storage = tunnel?.credentialStorage;
  const matchingBinding = Boolean(tunnel?.tunnelId && tunnel.accountId === accountId && tunnel.interactionMode === interactionMode);
  const legacy = storage === 'legacy' && matchingBinding;
  const finishMigration = storage === 'protected' && matchingBinding && tunnel?.credentialMigrationPending === true;
  // A resumed migration uses the existing protected reference in main. A local receipt alone cannot authorize
  // the next attempt: observe this same binding after the previous operation has settled first.
  const awaitingStatusRefresh = (failed || Boolean(result)) && tunnel === settledObservation.current;
  const cleanupPending = tunnel?.credentialMigrationPending === true
    || Boolean(awaitingStatusRefresh && result?.saved && !result.legacyRetired);
  const eligible = (legacy && !cleanupPending) || finishMigration;
  const displayedReady = result && !awaitingStatusRefresh && matchingBinding ? tunnel?.ready === true : result?.ready === true;
  const recoveryRequired = result?.recoveryRequired && (awaitingStatusRefresh || cleanupPending || !displayedReady);
  const label = storage === 'protected' ? text.protected : storage === 'legacy' ? text.legacy
    : storage === 'unavailable' ? text.unavailable : text.unknown;
  const migrate = async () => {
    if (disabled || inFlight.current || awaitingStatusRefresh || !eligible) return;
    inFlight.current = true;
    setPending(true); setFailed(false); setResult(null);
    try {
      const receipt = await window.codexWebLauncher!.migrateAccountTunnelCredential(accountId, { interactionMode });
      if (!mounted.current) return;
      if (!receipt.ok || !receipt.saved || !receipt.migrated) setFailed(true);
      else setResult(receipt);
    } catch {
      // Provider errors are sanitized by main; avoid echoing raw IPC messages or provider identifiers here.
      if (mounted.current) setFailed(true);
    } finally {
      // Navigation retires this UI observer, never the main process's in-flight migration.
      if (mounted.current) {
        settledObservation.current = currentObservation.current;
        setPending(false); inFlight.current = false; onChanged();
      }
    }
  };
  return <div data-testid="account-tunnel-credential-storage" data-account-id={accountId} data-interaction-mode={interactionMode}>
    <Notice title={`${text.title}: ${label}`} aria-busy={pending}
      action={legacy || finishMigration || pending || result?.saved ? <Button size="sm" variant="ghost" busy={pending}
        disabled={disabled || !eligible || awaitingStatusRefresh} onClick={() => void migrate()}>
        {pending ? text.migrating : finishMigration ? text.finishMigration : result?.saved ? text.migrated : text.migrate}
      </Button> : undefined}>
      {text.hint}{storage === 'legacy' ? <><br />{text.legacyWarning}</> : null}
      {cleanupPending ? <><br />{text.cleanupPending}</> : null}
    </Notice>
    {result?.saved ? <Notice tone={displayedReady && !recoveryRequired ? 'success' : 'warning'}>
      {displayedReady ? text.savedReady : text.savedNotReady}
      {recoveryRequired ? <><br />{text.recovery}</> : null}
    </Notice> : null}
    {failed ? <Notice tone="error">{text.failed}</Notice> : null}
  </div>;
}
