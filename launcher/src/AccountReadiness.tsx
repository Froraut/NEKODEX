import type { AccountPoolSnapshot, Language } from './types';
import { accountAvailabilityCopy } from './account-availability';

export function AccountReadiness({ account, language }: {
  account: AccountPoolSnapshot['accounts'][number]; language: Language;
}) {
  const copy = accountAvailabilityCopy(language);
  const caps = account.checked && account.authenticated ? account.capabilities : null;
  const modes: Array<[string, boolean | null | undefined]> = [
    ['Instant', caps?.solAvailable], ['Medium', caps?.solAvailable], ['High', caps?.solAvailable],
    ['Extra High', caps?.extraHighAvailable], ['Pro', caps?.proAvailable],
    ['Luna', caps ? caps.solAvailable === false ? true : caps.solAvailable === true ? false : null : undefined],
  ];
  const availability = account.availability;
  const reason = availability?.reason;
  const status = reason && Object.hasOwn(copy, reason) ? copy[reason as keyof typeof copy] : copy.unknown;
  return <section className="account-readiness" aria-label={copy.models}>
    <dl className="account-readiness-models">
      {modes.map(([name, supported]) => <div key={name}><dt>{name}</dt>
        <dd>{supported === undefined ? copy.check : supported === null ? copy.unknown : supported ? copy.supported : copy.unavailable}</dd></div>)}
    </dl>
    {availability ? <p>{copy.local}: {availability.eligible ? copy.ready : status}
      {typeof availability.retryAt === 'number' && Number.isFinite(availability.retryAt)
        ? <> · {copy.retry} {new Intl.DateTimeFormat(language, { dateStyle: 'short', timeStyle: 'short' }).format(availability.retryAt)}</> : null}</p> : null}
  </section>;
}
