# Triwave review 3, lane 5 — account pool

Frozen source: `3740505b0107af9a83053fd523ae1ad30be36465` (`3740505`, current `HEAD`). Final adversarial read-only review of the current account-pool source, its direct control-server/IPC callers, `browser-host.cjs`, `account-registry.cjs`, and lane-5 wave1/wave2 reports. No tests, typechecks, scripts, broad audits, runtime/account actions, builds, production actions, code edits, or commits were performed. Native4 / Native4 DEV / ZeroRisk4 identities, retained-tab affinity, and public ABI remain unchanged.

## Final disposition

No new independent concrete account-pool path was found in wave3. Therefore this report assigns **no `T3-5-n` IDs**.

The two existing lane-5 findings remain source-valid and conditional:

- **T1-5-1 confirmed:** disabling an account does not retire its process-local capability or connector evidence; re-enabling it can make balanced admission trust evidence collected before the disabled interval.
- **T2-5-1 confirmed:** a failed control-server capability reinspection through `inspectSession(true, accountId)` does not invalidate earlier capability evidence when the host still appears authenticated.

The final pass found additional interleavings, but they refine those same roots or belong to the already documented D17 selection-ownership root. They do not qualify for new `T3-5-n` IDs.

## Candidate roots confirmed

### T1-5-1 — disabled account retains readiness evidence across re-enable

The current code still changes only registry metadata in `setAccountEnabled` (`account-pool.cjs:203`). It does not clear `capabilities` or `connectors`. `accountSnapshot()` continues to report `checked` and `connectorReady` from those maps (`:88-97`). Startup refresh processes only accounts that are enabled at the time the loop is created (`:235-247`). After re-enable, balanced admission checks the cached maps in `eligible()` (`:356-367`) while requiring only the current host authentication bit.

This remains a conditional evidence-lifecycle defect. It requires the account to stay apparently authenticated while model entitlement or connector availability changes during the disabled interval. The code does reject the account while `enabled === false), and `publish()` clears both maps when the host publishes `authenticated === false) (`:110-115`). No live account-side transition was exercised.

### T2-5-1 — failed control-server capability reinspection preserves readiness

The control-server passes an explicit `accountId` to the pool proxy (`control-server.cjs:121-130`). The pool's `inspectSession()` awaits the selected account host and writes capability evidence only after success (`account-pool.cjs:250-254`); it has no invalidate-before-recheck step and no failure cleanup. A failed `BrowserHost.inspectSession(true)` can therefore leave an old capability map in place while `withManualOperation()` reports an operation error without necessarily changing `authenticated` to false.

The resulting account snapshot can still say `checked: true`, and balanced admission can still use the old model capability evidence. This is distinct in trigger from T1-5-1, but the same evidence-lifecycle family. `checkAccount()` and `refreshAuthentication()` do clear their maps before their own inspection paths (`:216-247`), so this finding remains specific to the direct `inspectSession(true, accountId)` path.

## Cross-scope interactions checked

### In-flight disable during inspection or refresh — refinement of T1-5-1/T2-5-1, no T3 ID

A user can disable an account after an inspection or refresh has started but before it completes. The in-flight operation can then repopulate `capabilities` (and, for `checkAccount(..., true)`, possibly `connectors`) after the account has become disabled. This is the same stale-evidence lifecycle as T1-5-1, with an asynchronous trigger; it is not a separate root. Re-enabling later can expose that evidence without a fresh check. The current source has no generation or enabled-state validation around the awaited inspection result.

### Automatic reveal versus explicit account/tab selection — confirmed cross-scope interaction, no T3 account-pool ID

The lane-6 paths remain present:

- Before `host.ready()` completes, `beginTurn()` can publish its pinned owner through `registry.select(id)` when `reveal` is enabled (`account-pool.cjs:424-447`). A later explicit account selection can therefore be overwritten or rejected by the turn's later publication. This is T1-6-1, a residual D17 selection-ownership path.
- After account selection, `BrowserHost.beginTurn()` can await `createTurnTab()` and then set `selectedTabId` without consulting the pool's selection revision (`browser-host.cjs:2429-2433`). A later explicit tab choice can be replaced by the newly revealed turn tab. This is T2-6-1, another D17 residual path.

These affect visible selection ownership and surface presentation. Task affinity and account ownership remain pinned as intended, so they are not new account-admission roots and receive no T3-5 ID in this lane.

### Retained/running continuation after disable — confirmed intended boundary

`chooseAccount()` deliberately allows an exact retained or matching running continuation to remain on its pinned account even when that account is disabled (`account-pool.cjs:369-381`). New pinned turns still pass `eligible()` when they are not exact continuations. This preserves affinity and retained-tab identity. The source therefore supports the existing contract; no new defect is assigned.

### Manual continuation on the visible account — optional policy, no T3 ID

`beginManualTurn()` follows the trace owner, affinity, retained owner, pending owner, or the selected account, and rejects a new manual task on a disabled selected account (`account-pool.cjs:465-496`). The deferred question of whether manual mode should automatically follow an account-owned conversation across a visible-account change remains an optional continuity policy. It is not a concrete defect under the current contract.

## Candidate roots rejected

- **Default selected-mode capability bypass:** `eligible()` permits the selected `default` account in selected mode before capability checks (`:356-360`). This is the compatibility path for the primary account and is bounded by the enabled check. Source review does not establish that it violates the existing Native4/Native4 DEV/ZeroRisk4 contract.
- **Connector failure incorrectly retaining connector readiness:** `checkAccount()` deletes the connector claim before checking and again on any failure (`:222-232`). A successful capability inspection followed by a failed connector verification retains model evidence but does not retain connector evidence; that is coherent and is not a new defect.
- **Direct inspection changing the selected visible account:** `inspectSession(..., accountId)` addresses the explicit account host through `getHost(id)) and does not call `registry.select`. It can leave the selected UI account unchanged. No cross-account selection corruption follows from this call itself.
- **Disabled owner losing exact turn ownership:** `traceOwners`, affinity, and exact retained/running checks preserve the owner across disabled-account continuation. No evidence supports re-routing or migration in this path.
- **Unknown or malformed account ID escaping registry validation:** `getHost(id)) reaches `validateAccountId` and rejects IDs that are not the default or canonical UUID; unknown validated IDs are rejected against the registry. No new path was found here.

## ABI and proof boundaries

Native4, Native4 DEV, and ZeroRisk4 names, connector identity handling, retained conversation keys, account affinity, and public control/IPC shapes were not changed or proposed for change.

This remains source evidence only. The pass does not prove a live ChatGPT entitlement change, live connector removal, account-specific schema loading, retained-task continuation across an account transition, or the occurrence rate of the asynchronous selection/evidence interleavings.

## Counts

- New concrete `T3-5-n` paths: **0**.
- Existing lane-5 findings confirmed: **2** (`T1-5-1`, `T2-5-1`).
- Refinements without new IDs: **1** (in-flight disable during inspection/refresh).
- Cross-scope existing D17 paths confirmed: **2** (`T1-6-1`, `T2-6-1`).
- Candidate roots rejected: **5**.
- Optional/known boundaries: **2** (manual continuity policy; live account/connector proof).
- ABI/name changes: **0**.

Parent final focused verification remains bounded by the requested `<=60` seconds and at most 10 scenarios. This lane ran no verification scenarios.

