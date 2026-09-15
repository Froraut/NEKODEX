# UI/UX inventory — lane 7

Scope: manual review of `launcher/src/AccountSettings.tsx` at baseline `5401800`. `launcher/src/Accounts.tsx` is not present at this baseline, so no claims are made about a separate Accounts component. No tests, typechecks, scripts, runtime, or app were run.

## Findings

### P1 — Verified account remains freely editable and the primary affordance still says “Sign in”

- Component/lines: `AccountSettings.tsx:91-103`, especially lines 94-103.
- Trigger/state sequence: an account is authenticated and its credentials/tunnel/API-key checks have completed (`account.authenticated`, `account.checked`, and `account.connectorReady` are true); the account card re-renders with the successful state dots; the user then views or clicks the card actions.
- Expected: completed credential and connection steps are read-only. The card should expose a clear completed state and only an explicit `Replace credentials` action or the permitted upgrade flow should unlock editing/rechecking. The primary action should reflect the state, such as `Manage credentials` or `Replace credentials`, rather than inviting another sign-in.
- Actual: the same card always renders an enabled `Sign in` button unless the unrelated global `busy` flag is set. `Check` and `Check connector` also remain enabled whenever `manual` is false, even after their corresponding checks are successful. `Select` remains available for any non-current account. There is no verified-state lock, replace action, or unlock transition in this component.
- Accessibility impact: keyboard and screen-reader users receive actionable controls that imply an editable or incomplete flow after completion. The success indicators do not establish which controls are intentionally locked, and repeated actions can move focus into a browser/login flow unexpectedly.
- Smallest fix: derive an explicit locked/verified view from the account snapshot, disable or replace the sign-in and check actions after successful completion, and add one explicit `Replace credentials`/upgrade entry point that clears the lock through the existing account operation. Make the accessible name and disabled explanation state-specific.
- Confidence: high. The control predicates and labels are directly visible in the component.
- Classification: product UI/state-machine issue; this is independent of ChatGPT as an external service and of technical connector naming.
- Screenshot relevance: high. This is the described post-credentials/tunnel/API-key state in which completed steps remain freely editable.

### P1 — An unverified account can become the selected/current account

- Component/lines: `AccountSettings.tsx:80-101`.
- Trigger/state sequence: an account is added or loaded with `authenticated === false`, `checked === false`, or `connectorReady === false`; the user clicks `Select` on that account.
- Expected: selection should be unavailable until the minimum account/login state required by the selected routing mode is verified, or the UI should clearly enter a pending setup state without marking the account current. The user should be directed to the required login/check/upgrade step.
- Actual: the `Select` button is disabled only when the account is already current or when `busy` is true. It does not consult authentication, account check, or connector readiness. `api.selectAccount(account.id)` can therefore make an incomplete account current, while the card still displays pending state dots.
- Accessibility impact: the selected/current badge can move to an account whose required setup is incomplete, creating a misleading status relationship for assistive technology and keyboard users. The user has no inline explanation that selection may be unusable until setup finishes.
- Smallest fix: gate `Select` on the minimum verified state for the current mode, or change the action to `Continue setup` until that state is reached; provide an adjacent status explanation tied to the disabled control.
- Confidence: medium-high. The missing guards are explicit; the exact backend acceptance policy is outside the two-file scope.
- Classification: product UI/state-machine issue, not a technical compatibility exception.

## Rejected / out of scope

- `launcher/src/Accounts.tsx`: rejected as an inspection target because the file does not exist at baseline `5401800`; the available account UI is `AccountSettings.tsx`.
- ChatGPT wording: no external-service wording in the reviewed component requires a branding change. Account labels such as signed-in/sign-in-needed describe authentication state and should remain state language.
- Technical compatibility: no recommendation is made to rename account API methods, connector fields, route fields, package imports, filesystem identifiers, or service identifiers. Those are outside the product UI decision and may be compatibility contracts.

## Clean areas

- The account cards expose selected/current state separately from the verification dots, which is a useful basis for a locked-state design.
- Global `aria-busy` and the loading retry status are present, so the review did not flag those as defects from these files alone.
