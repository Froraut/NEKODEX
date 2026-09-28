import type { AccountPoolSnapshot, Language } from './types';
import { accountAvailabilityCopy } from './account-availability';
import { StateDot, type Status } from './design';

type Account = AccountPoolSnapshot['accounts'][number];

function modelSupport(account: Account): Array<[string, boolean | null | undefined]> {
  const caps = account.checked && account.authenticated ? account.capabilities : null;
  return [
    ['Instant', caps?.solAvailable], ['Medium', caps?.solAvailable], ['High', caps?.solAvailable],
    ['Extra High', caps?.extraHighAvailable], ['Pro', caps?.proAvailable],
    ['Luna', caps ? caps.solAvailable === false ? true : caps.solAvailable === true ? false : null : undefined],
  ];
}

/**
 * "New task pacing: …" for the pacing fact and the pacing section; `held` when the local policy is holding
 * new tasks, `retryAt` when it says until when (so the section does not print the same deadline twice).
 */
export function accountPacingStatus(account: Account, language: Language) {
  const availability = account.availability;
  if (!availability) return null;
  const copy = accountAvailabilityCopy(language);
  const reason = availability.reason;
  const status = reason && Object.hasOwn(copy, reason) ? copy[reason as keyof typeof copy] : copy.unknown;
  const retryAt = typeof availability.retryAt === 'number' && Number.isFinite(availability.retryAt) ? availability.retryAt : null;
  const retry = retryAt !== null
    ? ` · ${copy.retry} ${new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(retryAt)}`
    : '';
  return {
    held: !availability.eligible,
    label: copy.local,
    value: `${availability.eligible ? copy.ready : status}${retry}`,
    retryAt,
  };
}

/** Per-model check results for one account: a section of the card's setup disclosure. */
export function AccountReadiness({ account, language, headingId, notChecked }: {
  account: Account; language: Language; headingId: string;
  /** Shown instead of the grid until the account has been checked. */
  notChecked: string;
}) {
  const copy = accountAvailabilityCopy(language);
  const modes = modelSupport(account);
  const checked = modes.some(([, supported]) => supported !== undefined);
  return <section className="accounts-details__section" aria-labelledby={headingId}>
    <h3 id={headingId} className="nk-type-label">{copy.models}</h3>
    {!checked ? <p className="accounts-caption nk-type-caption">{notChecked}</p>
      : <dl className="accounts-models__grid">
        {modes.map(([name, value]) => {
          const state: Status = value === true ? 'ready' : value === false ? 'error' : 'idle';
          return <div key={name}><dt>{name}</dt>
            <dd><StateDot state={state} />{value === null || value === undefined ? copy.unknown
              : value ? copy.supported : copy.unavailable}</dd></div>;
        })}
      </dl>}
  </section>;
}
