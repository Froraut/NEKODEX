# Triwave review 1, lane 5 — account pool

Frozen source: `3740505b0107af9a83053fd523ae1ad30be36465` (`3740505`). Read-only manual review of `launcher/electron/account-pool.cjs`, its direct IPC/control-server callers, `browser-host.cjs`, the account registry, and the four-wave results/adjudication. No tests, typechecks, scripts, broad audits, account actions, builds, production actions, or source edits were performed. The requested Native4 / Native4 DEV / ZeroRisk4 connector ABI and names were not changed.

## T1-5-1 — disabled account retains readiness evidence across re-enable

- **Priority:** P2, conditional source defect.
- **Trigger:** Account `B` is authenticated and has been checked, so `capabilities` and possibly `connectors` contain positive evidence (`account-pool.cjs:216-233`). The user disables `B` through `setAccountEnabled` (`account-pool.cjs:203`), then `B` remains disabled while its ChatGPT account changes model access or connector availability. The user later re-enables `B` without running Check account / Check connector. `setAccountEnabled` changes only the registry (`account-pool.cjs:203`); it does not clear `this.capabilities` or `this.connectors`. `refreshAuthentication()` also processes only currently enabled accounts (`account-pool.cjs:235-247`), so a disabled account receives no refresh that would replace or retire those entries.
- **Admission path:** After re-enable, balanced-mode selection evaluates `eligible(account)` (`account-pool.cjs:356-367`). It requires enabled and `host.state.authenticated === true`, then trusts the cached capability map for requested effort (`:361-365`) and the cached exact connector name (`:366`) without checking their age or requiring a new inspection. `accountSnapshot()` exposes those same entries as `checked` and `connectorReady` (`:88-97`), so the UI can continue to show the old positive evidence.
- **Consequence:** A newly enabled account can be selected for a model or connector that was only verified before the account was disabled. The pool's “ready” decision is then based on stale process-local evidence; the request may fail later in the browser/model or connector path, and balanced routing can prefer this account over an actually checked account. The fix should invalidate capability and connector evidence when an account is disabled, or mark it stale and require a fresh check before re-enabling it for evidence-gated automatic turns. This must preserve exact account affinity and must not relabel or migrate an existing Native4 / ZeroRisk4 retained tab.
- **Counterevidence and limit:** `eligible()` rejects disabled accounts while the flag is false (`:356-359`), and `publish()` clears both maps when a host reports `authenticated === false` (`:110-115`). Explicit `checkAccount()` clears capability evidence first and removes connector evidence on failure (`:216-233`), while `refreshAuthentication()` clears evidence for enabled accounts before inspecting them (`:235-247`). Therefore this finding requires the account to remain apparently authenticated while its model/connector readiness changes during the disabled interval; it does not claim that every disable/re-enable sequence fails or that a live account-side change was reproduced.

## Prior findings and adjudication comparison

- **D05 / R1-8-1 is repeated and fixed, not T1-5-1.** The current pinned path resolves the owner, then applies `eligible()` to a fresh automatic request when there is no exact retained tab or matching running trace (`account-pool.cjs:371-381`). It preserves exact retained/running continuation behavior and does not migrate affinity. This matches the four-wave adjudication's D05 contract.
- **D17 / R2-8-2 is repeated and fixed, not T1-5-2.** `selectTab()` captures a request revision, awaits host readiness, verifies the original tab object still exists, and compensates the selected tab/account/descriptor only while it still owns the selection revision (`account-pool.cjs:293-331`). A closed target therefore fails before publishing a new home, subject to the documented rollback failure warning.
- The earlier account-snapshot freshness concern is already addressed in the current renderer: `AccountSettings.tsx:16-59` subscribes to browser-state and operation events, coalesces refreshes, and rejects stale replies by revision. It is not a new finding here.
- Manual mode following the selected visible account remains the adjudicated optional continuity concern. It does not establish an account-pool defect and does not receive a T1-5 ID.
- The retained-conversation proof boundary remains a known limit: `beginTurn()` performs the pool precheck before capacity reclamation and `BrowserHost.exactRetainedTurnTab()` requires exact conversation and connector identity (`account-pool.cjs:442-445`; `browser-host.cjs:2322-2343`). No live ChatGPT account transition or retained-task continuation was exercised.

## Counts

- **New concrete conditional defects:** 1 (`T1-5-1`).
- **Repeated prior findings:** 2 (D05 and D17); no new IDs assigned.
- **Rejected first-wave claims:** 0.
- **Known limitations:** 1 (live account-side capability/retained-task transition was not exercised).
- **Optional improvements:** 1 (manual-mode task/account continuity, carried forward from adjudication; no T1-5 ID).
- **ABI/name changes proposed:** 0.
