# NEKODEX triwave review 2, lane 6 — browser selection

Baseline: `3740505b0107af9a83053fd523ae1ad30be36465` (`HEAD`). Scope: current `launcher/electron/account-pool.cjs`, direct renderer/control callers, and the `BrowserHost` tab-selection path. Compared with `2026-09-15-triwave-review1-06.md` and the adjudicated four-wave ledger/results. Manual source review only; no tests, typechecks, scripts, runtime/account actions, broad audits, production action, source edit, or commit. Native4, Native4 DEV, ZeroRisk4 identities and public ABI pins are fixed.

## Disposition of first-wave claim

**T1-6-1 is supported, but is a repeat here, not a new root.** `beginTurn()` chooses and reserves the task owner before awaiting `host.ready()` (`account-pool.cjs:429-442`). With `reveal=true`, it later writes that owner into the selected account and increments `selectionRevision` without checking whether an explicit selection began during the wait (`:446`). `selectAccount()` records its request revision before its own readiness wait and rejects if another selection advanced it (`:183-200`). The `/v1/turn/start` caller enables reveal from `showBrowserDuringTurns` (`control-server.cjs:281-294`); renderer account selection is a separate IPC action (`main.cjs:944`, `preload.cjs:57`, `AccountSettings.tsx:98-101`). Thus a later user request can be overwritten or rejected. The accepted D17 `selectTab()` repair (`account-pool.cjs:293-331`) does not cover this automatic reveal path.

The claim is conditional. `reveal=false` does not select the turn account. If a login/manual operation becomes active before `:446`, the `currentOperation()` guard prevents that publication. If no later explicit selection overlaps, showing the turn owner is intended. The source supports an interleaving, not evidence that it occurred in an installed app. This repeats the first-wave residual correction to D17 and receives no `T2-6-n` bug count.

## New concrete source path

### T2-6-1 — turn-tab reveal can replace a later explicit tab choice during surface creation

- **Classification:** new residual path of the accepted D17 selection-ownership root, independent of T1-6-1's pre-readiness account overwrite; not a new unrelated root. **P2, source confidence high for the ordering; live occurrence unverified.**
- **Trigger:** an automatic `/v1/turn/start` with `reveal=true` reaches a fresh-tab path on owner A. The pool selects A at `account-pool.cjs:446`, then awaits `host.beginTurn()` at `:447`. `BrowserHost.beginTurn()` awaits `createTurnTab()` (`browser-host.cjs:2429`), which adds the running tab and waits for idle-page load and ownership marking (`:652-662`). While that work is pending, the user explicitly selects another existing tab or Home on A through `launcher:browser-tab-select` (`main.cjs:555`, `App.tsx:1033-1038`). The pool's `selectTab()` revision and target checks can let the click complete (`account-pool.cjs:293-314`). When the new turn surface finishes, `BrowserHost.beginTurn()` sets `selectedTabId` to its turn tab and calls `show()` with no selection-revision/explicit-choice check (`browser-host.cjs:2429-2433`).
- **Consequence:** the later explicit tab choice is replaced by the automatic turn tab, even though the account stays A. The selected WebContents and browser snapshot follow the turn tab (`browser-host.cjs:1322-1360,1580-1600`). Task affinity and exact turn-tab ownership remain pinned correctly; the failure is visible tab selection ownership.
- **Minimum correction:** carry a view-selection token from the pool into turn reveal, and apply the account/tab reveal only if no later explicit account or tab selection owns it. Still create and lease the turn tab on A and keep its hidden renderer viewport usable for the helper. Guard both pre-readiness account selection and post-surface tab selection under the same D17 repair; do not change connector identity, public tools, or ABI.

**Counterevidence and limit:** the `selectTab()` revision guard protects the user's request from earlier *explicit* selections, but `BrowserHost.beginTurn()` does not participate in that revision (`account-pool.cjs:298-302`, `browser-host.cjs:2430`). If the turn uses an exact retained/running tab, `beginTurn()` has no `createTurnTab()` await before its reveal (`browser-host.cjs:2381-2416`), so this specific interleaving is unavailable. If the user click happens after turn reveal, the explicit choice wins. Browser navigation/viewport lock during active turns (`browser-host.cjs:1363`) does not disable the tab-click IPC; `App.tsx:1033-1038` submits it directly. No live reproduction was performed.

## Repeats, optional paths, and known limits

- **Repeat of repaired D17:** explicit `selectTab()` now revalidates the original target after readiness and compensates its own failed publication while it still owns the revision (`account-pool.cjs:293-331`). This is separate from T2-6-1's later automatic publication.
- **Related first-wave scope, no new count:** T1-5-1's disabled/re-enabled account capability evidence belongs to account admission, not browser selection. This lane does not reclassify it.
- **Optional/known limit:** Manual ZeroRisk4 continuation follows the visible selected account by design (`account-pool.cjs:465-480`), as the four-wave adjudication deferred. A source review cannot prove live ChatGPT account transition, tab visibility on a particular OS, or connector availability. None of these receives a T2-6 ID.

## Counts

- New independent defect roots: **0**.
- New concrete residual source paths under D17: **1** (`T2-6-1`).
- First-wave findings repeated/challenged: **1** (`T1-6-1`, supported conditionally).
- Optional/known-limit bugs counted: **0**.

Parent owns the final focused verification under the shared `<=60s`, max 10 scenarios limit. This read-only lane ran none.
