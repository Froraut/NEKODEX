import type { AccountPoolSnapshot, Language } from './types';
import { accountAvailabilityCopy } from './account-availability';
import { Disclosure, StateDot, type Status } from './design';

type Account = AccountPoolSnapshot['accounts'][number];

function modelSupport(account: Account): Array<[string, boolean | null | undefined]> {
  const caps = account.checked && account.authenticated ? account.capabilities : null;
  return [
    ['Instant', caps?.solAvailable], ['Medium', caps?.solAvailable], ['High', caps?.solAvailable],
    ['Extra High', caps?.extraHighAvailable], ['Pro', caps?.proAvailable],
    ['Luna', caps ? caps.solAvailable === false ? true : caps.solAvailable === true ? false : null : undefined],
  ];
}

/** "New task pacing: …" for the pacing summary; `held` when the local policy is holding new tasks. */
export function accountPacingStatus(account: Account, language: Language) {
  const availability = account.availability;
  if (!availability) return null;
  const copy = accountAvailabilityCopy(language);
  const reason = availability.reason;
  const status = reason && Object.hasOwn(copy, reason) ? copy[reason as keyof typeof copy] : copy.unknown;
  const retry = typeof availability.retryAt === 'number' && Number.isFinite(availability.retryAt)
    ? ` · ${copy.retry} ${new Intl.DateTimeFormat(language, { dateStyle: 'short', timeStyle: 'short' }).format(availability.retryAt)}`
    : '';
  return {
    held: !availability.eligible,
    label: copy.local,
    value: `${availability.eligible ? copy.ready : status}${retry}`,
  };
}

/** Per-model check results for one account, folded into a disclosure. */
export function AccountReadiness({ account, language }: { account: Account; language: Language }) {
  const copy = accountAvailabilityCopy(language);
  const modes = modelSupport(account);
  const checked = modes.some(([, supported]) => supported !== undefined);
  const supported = modes.filter(([, value]) => value === true).map(([name]) => name);
  const hint = !checked ? copy.check
    : supported.length ? supported.join(', ')
    : modes.every(([, value]) => value === null) ? copy.unknown : copy.unavailable;
  return <Disclosure className="accounts-models" title={copy.models} hint={hint}>
    <dl className="accounts-models__grid">
      {modes.map(([name, value]) => {
        const state: Status = value === true ? 'ready' : value === false ? 'error' : 'idle';
        return <div key={name}><dt>{name}</dt>
          <dd><StateDot state={state} />{value === undefined ? copy.check : value === null ? copy.unknown
            : value ? copy.supported : copy.unavailable}</dd></div>;
      })}
    </dl>
  </Disclosure>;
}
