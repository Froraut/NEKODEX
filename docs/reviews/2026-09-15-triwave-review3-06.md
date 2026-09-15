# NEKODEX triwave review 3 — lane 6 — browser selection

Baseline: `3740505b0107af9a83053fd523ae1ad30be36465` (`HEAD`). Scope: current browser-selection implementation, `launcher/electron/account-pool.cjs`, `launcher/electron/browser-host.cjs`, direct Electron IPC/control callers, and the renderer account/tab selection callers. Read-only final adversarial pass after wave1 and wave2. No tests, typechecks, scripts, runtime/account actions, broad audit, production action, source edit, or commit was performed. Native4, Native4 DEV, ZeroRisk4 identities and ABI/public connector boundaries remain fixed.

## Final disposition

**No new independent defect root and no new T3-6-n finding.**

The current source still contains the accepted D17 selection-ownership gap already recorded by the earlier waves:

- The automatic `/v1/turn/start` path chooses a pinned account, awaits `host.ready()`, then may publish that account as selected at `launcher/electron/account-pool.cjs:442-447`. A later explicit account selection can be overwritten or rejected after that wait. This repeats/refines T1-6-1.
- A fresh automatic turn tab is created through the awaited `BrowserHost.createTurnTab()` path, then `BrowserHost.beginTurn()` publishes the new turn tab at `launcher/electron/browser-host.cjs:2429-2433`. A later explicit tab choice can be replaced after that await. This is the concrete T2-6-1 path.
- No third asynchronous publication boundary or distinct ownership root was found.

## Candidate roots reviewed and rejected

### Automatic reveal versus retained-tab selection — repeat/refinement of D17/T2

For an exact retained tab, `BrowserHost.beginTurn()` selects the retained tab synchronously at `browser-host.cjs:2380-2415`. The pool has already awaited `host.ready()`, so a later account or tab selection can race the pool’s account publication, but there is no additional await between the pool’s `registry.select(id)` at `account-pool.cjs:446` and the retained tab’s `selectedTabId = existing.id` at `browser-host.cjs:2411`. This is the same turn-reveal ownership problem, not a new T3 root. If the user selection has completed before this synchronous segment, it owns the newer revision but the automatic path does not check it; if it starts after the segment, normal JavaScript serialization lets the explicit choice win.

### Home/tab selection versus account selection — rejected

`AccountBrowserPool.selectTab()` captures `selectionRevision` before awaiting the target host readiness, rechecks the target and revision at `account-pool.cjs:293-302`, and performs account publication plus `host.selectTab()` in one synchronous segment at `:308-313`. A later explicit account or tab selection therefore either advances the revision before publication and causes this request to reject, or begins after the publication segment and can own the later state. The existing rollback is conditional on the publishing request still owning its revision at `:317-328`. No independent stale-home or cross-account tab root remains.

### Browser show/reveal versus account switch — rejected

The renderer’s show action reaches `launcher:browser-show` at `main.cjs:549-551`, while account switching reaches `launcher:account-select` at `:942-947`. The proxy resolves the selected host at call time, and `BrowserHost.reveal()` shows that host before its optional inspection/load await. During a later account switch, the old host’s `isAccountVisible()` predicate makes its view invisible and the pool publish path snapshots the currently selected account. The reveal response is not written directly into renderer state; state comes through `launcher:browser-state` publication. This can produce expected transient work on the old host, but source review found no separate selected-tab ownership overwrite.

### Account “Sign in” double selection — rejected

`AccountSettings.tsx:94-98` first selects the account, then opens its login flow. `openAccountLogin()` selects the same account again before opening the login surface. The calls are sequential in the renderer action, and each pool selection has the existing revision/readiness checks. A competing selection is rejected by the UI busy path or detected by the revision checks. The duplicate same-account selection is redundant work, but it does not expose a distinct cross-scope browser-selection root in this wave.

### Manual turn versus browser tab selection — known/intentional boundary

Manual turns deliberately bind to the visible selected account in `account-pool.cjs:463-496`; the source and UI copy describe this as selected-account behavior. Manual turn start does not automatically select a newly created turn tab through the automatic reveal path. A user must select the owning account for a retained/manual continuation, and active manual operations block account/tab selection through the existing operation checks. This remains a known product boundary and receives no T3 ID.

### Turn completion/removal versus explicit tab choice — rejected

`BrowserHost.endTurn()` changes terminal state and removes or retains the finishing tab synchronously through `browser-host.cjs:2464-2489`. There is no await between the finishing-tab decision and removal, so an explicit tab IPC cannot interleave inside that publication. When the selected tab is removed, the host’s normal fallback selection is a consequence of the selected tab no longer existing, not an independent stale-selection race. Concurrent retained tabs and active turns remain represented in the host snapshot.

### Connector identity and account/tab visibility — rejected as ABI-safe

The turn owner and connector identity remain pinned through `chooseAccount()`, `pendingAffinity`, `traceOwners`, `conversationKey`, and `connectorIdentity` checks. The browser-selection paths only choose visible account/tab state; they do not rewrite the connector names or connector binding. Native4, Native4 DEV, and ZeroRisk4 remain separate identities, and no candidate requires changing the ABI or connector contract.

## Wave accounting

- New independent defect roots: **0**.
- New concrete T3-6-n paths: **0**.
- Repeats/refinements: **T1-6-1** (pre-readiness automatic account reveal), **T2-6-1** (post-surface automatic turn-tab reveal).
- Rejected cross-scope candidates: retained-tab synchronous reuse, home/tab versus account selection, browser show versus account switch, duplicate sign-in selection, and turn completion/removal.
- Known/optional boundaries: selected-account Manual mode behavior and the inability of this source-only pass to prove live browser occurrence.

Parent owns the final focused verification under the shared **<=60 seconds / maximum 10 scenarios** limit. This final lane ran none.
