# Independent blind review wave2 lane6

- Repository: `/Users/alex/Dev/nekodex`
- Baseline: `9925453`
- Source state: unchanged; no source edits
- UTC review start: `2026-09-15T20:35:19Z`
- UTC review end: `2026-09-15T20:39:06Z`
- Requested focus: `launcher/electron/account-pool.cjs`, account capability evidence, selection and admission races
- Instructions applied: `/Users/alex/Dev/nekodex/skills/nekodex-regression-prevention/SKILL.md`; `/Users/alex/.codex/skills/right-size-test-runs/SKILL.md`
- Verification: manual source review only; no tests, typechecks, scripts, runtime, commits, delegation, or source changes

## Inspected scope

Reviewed `launcher/electron/account-pool.cjs`, its direct account IPC callers in `launcher/electron/main.cjs`, the browser control caller in `launcher/electron/control-server.cjs`, the account settings caller in `launcher/src/AccountSettings.tsx`, the account registry, and the directly reached readiness/inspection methods in `launcher/electron/browser-host.cjs`. Followed positive capability writers, invalidation, account selection, balanced/selected routing, turn admission, connector verification, login, failure, cancellation/retained-owner, and direct control-server paths. Prior mixed-model review reports and historical findings were not inspected.

## Findings

### 1. `checkAccount` leaves old capability evidence usable while it waits for host readiness

- Trigger: invoke `checkAccount(id, ...)` while that account's `host.ready()` is pending, and concurrently admit a new turn through the control server. The account already has a prior capability result.
- Exact location: `launcher/electron/account-pool.cjs:233-241`, especially the `await host.ready()` at line 235 and `invalidateEvidence(id)` only at line 239.
- Consequence: the old `this.capabilities` entry remains visible to `accountSnapshot()` and usable by `chooseAccount()` during the readiness wait. A new turn can be admitted using evidence that the new check is about to replace, contrary to invalidate-before-start. A failed or cancelled readiness path also leaves the previous claim until some later invalidation.
- Counterevidence: `inspectSession()` invalidates before its awaited host inspection at lines 279-294, and `setAccountEnabled()`/`logout()` invalidate synchronously. Those paths do not cover the initial await in `checkAccount()`.
- Smallest fix: move `const epoch = this.invalidateEvidence(id)` before `await host.ready()`; retain the currentness check before publishing. If the active-operation guard is intentionally a precondition, invalidate before that guard as well so a rejected check cannot preserve stale proof.
- Confidence: high.

### 2. Turn admission does not revalidate account proof or enablement after its async readiness wait

- Trigger: start `/v1/turn/start` through `control-server.cjs:281-293` so `AccountBrowserPool.beginTurn()` chooses an eligible account, then during `await host.ready()` run `setAccountEnabled(id, false)` or any account check/other path that invalidates that account's capability epoch.
- Exact location: `launcher/electron/account-pool.cjs:464-489`. `chooseAccount()` makes the decision at line 469; after the await at line 483 the method proceeds directly to retained checks, capacity, and `host.beginTurn()` at line 489. The only revision check in this method, `revealRevision`, is used later only for optional visible-account reveal at lines 490-496.
- Consequence: a fresh turn can still create or reuse a browser tab on an account that was disabled or whose capability/connector evidence was invalidated while acquisition was in flight. The reservation and `traceOwners` entries make the stale choice authoritative for that turn. This can route a model or connector request using proof that is no longer current.
- Counterevidence: pinned retained/running continuations are deliberately allowed to finish, and visible selection races are guarded by `selectionRevision` in `selectAccount()` and `selectTab()`. Those protections do not revalidate fresh turn admission after `host.ready()`.
- Smallest fix: capture the selected account's relevant enablement/capability/connector identity (at minimum its evidence epoch and account-config identity) immediately after `chooseAccount()`, then re-check currentness and eligibility after every awaited acquisition step and before `host.beginTurn()`. Abort and release the reservation when the check fails; preserve the existing retained continuation exception.
- Confidence: high.

### 3. Balanced routing can admit an authenticated but unchecked secondary account

- Trigger: add/sign in a secondary account, leave its capability check untouched, select `balanced` mode, then send a new automatic turn whose request omits `requestedEffort` and `connectorIdentity` (both are optional in `control-server.cjs:279-280` and the turn payload path).
- Exact location: `launcher/electron/account-pool.cjs:396-407`, especially the absence of a general `this.capabilities.has(account.id)` requirement. In balanced mode, `chooseAccount()` filters all accounts at lines 423-425; for a non-default authenticated account with no requested effort or connector, the checks at lines 402-406 impose no capability-evidence requirement, so line 407 returns `true`.
- Consequence: the scheduler can choose a secondary account with `checked: false`, despite the account UI stating that each account should be checked before balanced routing. The turn then runs without account-side model capability evidence and may expose an unsupported route or fail only after browser admission.
- Counterevidence: requested `luna`, `max`, `xhigh`, other non-luna effort, and connector turns do consult the corresponding evidence; selected mode also contains an intentional special case for the default account. The finding is limited to fresh balanced routing of non-default accounts when those optional requirements are absent.
- Smallest fix: in balanced mode, require a current capability record for every non-default candidate before returning it from `eligible()`; require the connector proof separately when a connector is needed. Keep the selected-mode default-account behavior unchanged unless the product contract is changed.
- Confidence: medium-high.
