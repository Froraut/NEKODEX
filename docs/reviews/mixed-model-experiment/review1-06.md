# NEKODEX mixed-model experiment review wave 1, lane 6

- Baseline: `9925453bd51e61c7b398abec12ec0da3aca3d3af`
- Review type: manual source review only
- UTC start: `2026-09-15T20:31:27Z`
- UTC end: `2026-09-15T20:32:58Z`

## Inspected scope

Primary file: `launcher/electron/account-pool.cjs`.

Direct callers and contracts inspected as needed:

- `launcher/electron/main.cjs`: account selection, enable/disable, login, and account-check IPC handlers; startup authentication refresh.
- `launcher/electron/control-server.cjs`: automatic `/v1/turn/start` caller of `beginTurn`.
- `launcher/electron/account-registry.cjs`: enabled-account and selected-mode contract.
- `launcher/src/AccountSettings.tsx`: the renderer's split select-then-login flow.
- Relevant `BrowserHost` method contracts for `ready`, `openLogin`, and turn acquisition.

I did not read other wave reports. I ran no tests, typechecks, scripts, live actions, or delegation, as requested. Findings below are based on source-level executable interleavings and current baseline behavior.

## Findings

### 1. Selected mode lets the default account bypass capability and connector evidence

- Severity: High
- Exact location: `launcher/electron/account-pool.cjs`, `AccountBrowserPool.chooseAccount`, lines 396–406, especially line 399.
- Confidence: High.
- Classification: Bug, not a design limitation.

Trigger:

1. Leave routing mode as `selected` and keep the selected account as `default`.
2. Do not run a successful capability check for `default`, or check it and obtain `proAvailable: false` / `solAvailable: false`.
3. Start an automatic turn with `requestedEffort: "max"`, `"xhigh"`, or `"luna"`; or supply a connector requirement.

`eligible()` returns `true` immediately for `selected` + `default` after only the enabled/current-operation check. It therefore skips authentication, effort capability, and connector evidence checks. The turn proceeds to `host.beginTurn()` even though the account has not proved the requested capability or connector. This conflicts with the account-registry contract that selected-mode scheduling must enforce the selected account's state; it also makes the UI instruction to check accounts before routing ineffective for the default account.

Impact: a turn can be assigned to the default account with an unsupported effort or without verified connector capability, producing a wrong-model or connector failure after account selection has already committed the turn owner.

Smallest fix: remove the early `if (config.mode === 'selected' && account.id === 'default') return true` bypass. Apply the same authentication, capability, and connector predicates to `default` as to other automatically routed accounts. If product intent is that selected mode intentionally permits unverified default-account turns, encode that as a separate explicit policy and do not call the result capability-ready; the current implicit account-ID exception is the defect.

### 2. Account disablement can race with turn acquisition and still start a new turn

- Severity: High
- Exact location: `launcher/electron/account-pool.cjs`, `AccountBrowserPool.beginTurn`, lines 464–489; direct mutation is `setAccountEnabled`, lines 215–218.
- Confidence: High.
- Classification: Bug.

Trigger:

1. Begin an automatic `/v1/turn/start` for an eligible account. `beginTurn()` chooses the account and reaches `await host.ready()` while that host is still opening.
2. Before `host.ready()` resolves, invoke the account-enabled IPC handler with `enabled: false` for that account (`launcher/electron/main.cjs` lines 1004–1009).
3. Let `host.ready()` resolve.

`setAccountEnabled()` updates the registry and invalidates capability evidence, but `beginTurn()` does not re-read the registry, re-check enabled state, or revalidate the selected capability epoch after its await. It proceeds through `ensureTabCapacity()` and calls `host.beginTurn()` for the account that is now disabled. The account-registry comment explicitly requires selected-mode scheduling to fail when the selected account is disabled; the same currentness rule is needed for a turn acquisition that selected the account before the mutation.

Impact: disabling an account does not reliably prevent a new turn already in the acquisition window from starting there. This can violate operator intent and can create a fresh task on an account the UI reports disabled.

Smallest fix: capture the account-selection/evidence revision when `chooseAccount()` succeeds, then immediately after every acquisition await (at minimum `host.ready()`) verify that the account still exists, remains enabled, and still satisfies the same fresh-turn eligibility predicate. Abort before `host.beginTurn()` when any check changed. Keep the existing exception only for exact retained/running continuations, whose ownership is already established.

### 3. `openAccountLogin()` can open login for an account that is no longer selected

- Severity: Medium
- Exact location: `launcher/electron/account-pool.cjs`, `AccountBrowserPool.openAccountLogin`, lines 296–303; renderer split call in `launcher/src/AccountSettings.tsx`, lines 95–98.
- Confidence: High.
- Classification: Bug.

Trigger:

1. In Account Settings, click Sign in for account A. The renderer first awaits `api.selectAccount(A)`, then calls `api.openAccountLogin(A)` as a separate IPC request.
2. Between those two IPC requests, select account B from another renderer action/window or automation client.
3. `openAccountLogin(A)` calls `selectAccount(A)`, returns, then yields to `host.openLogin()` (or the manual reveal path). A selection of B can commit during that gap.

The function establishes selection in one awaited operation and starts login in a later operation without retaining/checking a selection revision. The account-A host can therefore be put into login while B is the visible selected account; the renderer's browser navigation and account status can describe B while credentials are being entered into A.

Impact: credentials may be entered into an unintended account surface, or login UI may be hidden/inconsistent with the selected account. This is a selection ownership race, not merely a stale display.

Smallest fix: make account selection and login one pool-owned critical operation, or capture the post-selection `selectionRevision` and re-check both revision and `registry.snapshot().selectedId === id` immediately before starting `openLogin()` / reveal. On mismatch, abort with a selection-changed error rather than opening the login surface.

## Design boundaries and zero-findings

The following are intentional design boundaries and were not reported as bugs:

- Exact retained/running continuations may finish on their original account even after it is disabled; `chooseAccount()` documents this exception and uses exact ownership checks.
- Manual mode does not inspect ChatGPT capabilities or connector selection; the UI and control server explicitly describe connector selection as a manual per-turn step. That is a product limitation, not missing automatic evidence.
- Account capability evidence is account-scoped and is invalidated on checks, enablement changes, logout, and observed unauthentication. The reported defects concern bypassing or failing to re-check that evidence at selection/await boundaries.

No additional concrete current bugs were identified within the requested account-pool scope.
