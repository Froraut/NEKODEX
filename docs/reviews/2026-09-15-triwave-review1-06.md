# NEKODEX triwave review 1, lane 6 — browser selection

Baseline reviewed: `3740505b0107af9a83053fd523ae1ad30be36465` (`HEAD`).

Scope: browser selection, `launcher/electron/account-pool.cjs` and its direct startup/UI callers. Read-only manual review only. No tests, typechecks, scripts, broad audits, runtime, production action, commit, or code edit was performed. Native4 / Native4 DEV / ZeroRisk4 connector ABI and identities were treated as fixed.

## Finding

### T1-6-1 — automatic turn reveal can overwrite a later explicit account selection

- **Classification:** one residual correction to the accepted selection-ownership root D17; not a new unrelated root. It is not a repeat of the fixed `selectTab` activation branch, because this path is `beginTurn` and does not call `selectTab`.
- **Trigger:** an automatic `/v1/turn/start` request reaches `AccountBrowserPool.beginTurn()` with `reveal=true` while the selected account's `host.ready()` is still pending. During that await, the user selects another account through the launcher. `selectAccount()` increments `selectionRevision` before and after its own readiness wait and may either complete or remain pending. When the turn resumes, `beginTurn()` has no revision or ownership check and executes `this.registry.select(id)` at `launcher/electron/account-pool.cjs:442-446` (current numbered source: `:442` awaits readiness and `:446` publishes the turn's account). It then increments the revision and calls `syncVisibility()`.
- **Direct callers:** `launcher/electron/control-server.cjs:281-294` passes `preferences.showBrowserDuringTurns === true` as `reveal` for `/v1/turn/start`; the renderer account action reaches `launcher/electron/main.cjs:944`, `launcher/electron/preload.cjs:57`, and `launcher/src/AccountSettings.tsx:95-101`.
- **Consequence:** the later user choice can be silently replaced by the account selected for the automatic turn. If the explicit `selectAccount()` is still awaiting the same host readiness, its current revision guard then rejects with `Account selection changed while opening the browser account`; if it already completed, the later `beginTurn()` selection still jumps the visible account back to `id`. The descriptor and account visibility therefore expose the turn owner instead of the user's latest selection. The turn's task affinity is still correctly pinned; the defect is UI/account selection ownership and ordering.
- **Minimum correction:** capture the selection revision before the asynchronous turn preparation and, immediately before the `reveal` selection, verify that no later explicit selection owns the revision. If a later selection exists, preserve it while still creating/starting the turn on its pinned owner; do not move task affinity or change the Native4/Native4 DEV/ZeroRisk4 contract. The same guard must cover the turn's `registry.select(id)` and subsequent visibility publication.

## Counterevidence and boundaries

- `selectTab()` itself now captures `selectionRevision`, revalidates the target tab after `host.ready()`, and conditionally compensates account/tab state at `launcher/electron/account-pool.cjs:293-331`; that fixes the previously adjudicated D17 stale-tab activation branch but does not guard `beginTurn()` at `:442-446`.
- With `reveal=false`, `beginTurn()` does not select an account, so this particular overwrite does not occur. If no explicit selection overlaps the `host.ready()` await, selecting the pinned turn owner is the intended behavior.
- `selectAccount()` rejects while `currentOperation()` is already active, but `beginTurn()` does not mark a browser operation before its `host.ready()` await. Therefore that guard does not exclude the interleaving above; the automatic turn only enters the host operation after the vulnerable selection step.
- This is a source-provable asynchronous interleaving. No live account, browser, or runtime reproduction was run, per the requested read-only boundary.

## Counts

- New independent defects: **0**.
- Residual corrections/refinements to accepted defects: **1** (`T1-6-1`, D17 selection-ownership root).
- Repeats of earlier findings: **0**.
- Known limits / optional improvements: **0 additional findings**.

Finding IDs: **T1-6-1**.
