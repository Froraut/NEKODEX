# Lane 16-feature-ui — architecture/refactoring review

Baseline inspected: `53d17361f3e9c81910055a7e2c18759ffce458bc` in `/Users/alex/Dev/nekodex-refactor-20260922`. Read-only source review; only this report was written. **No tests, builds, apps, real accounts/providers, or agents were run.** Proposed verification follows `right-size-test-runs`; execution and integrated build/UI coverage belong to the parent.

Reviewed TaskCenter, QueueControls, BrowserWorkspaceManager, UsageDashboard/Insights, usage-statistics/diagnostics, QuotaPortfolioSummary, Updates/UpdateProgress/update-copy, and usage-store, with App/preload/main callers. Consulted all three existing `app-improvements*-20260922.md` reports. Do not reopen completed fixes: task confirmation focus, removed-account queue scope, inspection-capacity explanation, workspace deletion retry/overflow, future-day report exclusion, lifetime totals, CSV formula/coverage handling, or updater handoff precedence.

## 16-feature-ui-F1 — Separate usage query lifecycle from report rendering

**Priority:** worthwhile architecture change; no newly confirmed data-loss bug.

**Evidence:** `launcher/src/UsageDashboard.tsx:106–172` owns filters, a 12-entry cache, keyed result/error state, account options, retry counters, request coalescing, visibility/focus listeners, and polling. The same component owns table/chart construction and export at `22–104`, source presentation at `174–210`, and the entire report at `212–313`. Adding a report control requires understanding request disposal and cache correctness inside the rendering component. `launcher/electron/preload.cjs:93` exposes the usage promise; `launcher/electron/main.cjs:1588–1598` validates its source/account query. The component already correctly ignores disposed requests and retains failed-refresh data: preserve these behaviors.

**Concrete change:** extract a feature-local `useUsageReport` hook with injected usage loader and explicit query key. Return the active query, visible report, keyed error, refreshing flag, known accounts, filter setter, and retry. Keep the existing 30-second cadence, hidden-page suppression, focus refresh, bounded cache, and native-account omission. Extract calendar chart/table/completion into `UsageCalendar.tsx`, leaving display-only expansion state there. Keep CSV generation in usage-statistics and leave source-dependent totals unchanged. Do not introduce a global fetching framework or treat hook disposal as cancellation of the IPC operation.

**Benefit:** later report sections can use one settled query contract without duplicating asynchronous state. Calendar interaction can change without touching polling. This is an actual responsibility split, not one file per helper.

**Disjoint write set:** `launcher/src/UsageDashboard.tsx`; new `launcher/src/useUsageReport.ts`, `launcher/src/UsageCalendar.tsx`; one focused usage lifecycle test file. No backend or App edits.

**Smallest verification:** deferred fixture responses for Web account A → Native → late A response; successful report followed by rejected refresh and retry; hidden/focus scheduling with fake time. Assert visible identity, retained data, and call counts rather than hook internals. Maximum **30 seconds** for the focused command. Parent may reuse its affected usage UI flow for calendar expansion/export; no real provider call.

## 16-feature-ui-F2 — Scope workspace errors to their account; reuse a bounded action gate

**Priority:** P2 UI defect plus small reusable renderer contract.

**Confirmed trigger/evidence:** `launcher/src/BrowserWorkspaceManager.tsx:41–61` stores a single unscoped error; only starting another operation clears it. Switching accounts at `79` updates only accountId, while `85` renders the previous error unconditionally. Therefore a failed close/restore for A remains displayed under B after the selector changes. Automatic fallback on account removal (`45–51`) has the same problem; an in-flight A failure can arrive after that fallback. `launcher/src/App.tsx:1733–1742` passes account-specific IPC callbacks and does not key/remount the manager per selected account. This is error misattribution, not evidence of an operation being sent to the wrong account.

The neighboring action wrappers differ unnecessarily: TaskCenter has a synchronous ref gate (`TaskCenter.tsx:95–101`), QueueControls checks captured pending state (`QueueControls.tsx:56–59`), and workspace run has no internal busy check. Do **not** claim ordinary double-click corruption from this difference: disabled DOM controls already prevent many repeats.

**Concrete change:** introduce a small feature-local async action hook for QueueControls and BrowserWorkspaceManager: synchronous in-flight gate, pending action identity, try/catch/finally settlement, and caller-owned error presentation. Workspace action identity includes accountId; retain errors as `{accountId, message}` and display only for the currently rendered account. A late A failure must never appear on B. Keep the operation captured for A; do not retarget or cancel it when selection changes. Preserve workspace raw error handling and queue's existing parent error callback. Leave TaskCenter's existing gate untouched in this batch to keep F3 independent.

**Benefit/UI adjustment:** errors become attributable and retry remains usable. Future workspace actions inherit one pending/error contract without changing backend authority, confirmation requirements, or global transition gating.

**Disjoint write set:** `launcher/src/BrowserWorkspaceManager.tsx`, `launcher/src/QueueControls.tsx`; new `launcher/src/useFeatureAction.ts`; one focused fixture test. No backend edits or new global lock.

**Smallest verification:** reject A close, select B and assert no A alert; remove A during pending action, reject it, and assert B remains clean; resolve/reject action and confirm controls recover; invoke the gate twice synchronously and observe one callback. Maximum **30 seconds**. Parent combines these with its workspace fixture, preserving the existing durable-delete retry case.

## 16-feature-ui-F3 — Give Task Center one typed confirmation/presentation model

**Priority:** architecture and interaction maintainability; existing safety behavior works.

**Evidence:** `launcher/src/TaskCenter.tsx:5–34` uses positional multilingual arrays plus `phaseOrder`; phase rendering at `119` depends on `8 + index`. Confirmation eligibility is separately expressed at `70–71`, `131`, and `135–151`. Cancel/dismiss each repeat the same alertdialog focus bookkeeping, Escape handling, busy disabling, and Keep button. Their focus return is deliberately managed at `72–92`; another action currently requires modifying several coupled predicates and duplicating interaction markup. App dispatches the authoritative tab/trace/account/id arguments at `App.tsx:1234–1239`.

**Concrete change:** create named typed copy fields with phase labels keyed by `BrowserTaskState['phase']`; a pure task presentation helper for filtering and confirmation eligibility; and one `TaskActionConfirmation` component. Replace the two nullable targets with a discriminated target `{kind, taskKey}`. Derive the currently eligible confirmation from the latest visible task and backend `can*` capabilities. Keep focus restoration ownership in TaskCenter, including filter-focus preservation and safe Keep autofocus. Do not derive permission from phase, collapse distinct cancellation/dismissal warnings, or change exact mutation arguments.

**Benefit:** adding or revising a task action has one eligibility path and one accessible confirmation implementation. Named copy makes phase additions auditable across languages and avoids index-coupled warnings.

**Disjoint write set:** `launcher/src/TaskCenter.tsx`; new `launcher/src/task-center-copy.ts`, `launcher/src/task-center-model.ts`, `launcher/src/TaskActionConfirmation.tsx`; focused confirmation fixture updates. No QueueControls, App, types, or backend writes.

**Smallest verification:** reuse the existing focused task keyboard flow with both confirmation kinds, capability revocation/row removal, and filter-focus preservation; assert exact IPC argument forwarding. Maximum **30 seconds**, parent-coordinated; avoid translation snapshots or one test per copied label.

## 16-feature-ui-F4 — Extract pure report projection from the durable usage store

**Priority:** architecture; retain persistence/recovery policy unchanged.

**Evidence:** `launcher/electron/usage-store.cjs:363–455` implements report statistics and diagnostic grouping, while `615–750` builds both public snapshots. The same 755-line module validates persisted data (`247–354`), owns backup recovery/persistence (`458–507`), and mutates receipts/counters (`509–612`). Calendar boundaries/construction repeat at `616–625` and `688–703`. Reporting additions therefore touch a module containing sensitive receipt retention and durable-write behavior. Account pool imports UsageStore and control-server imports its validator: retain its public exports.

**Concrete change:** extract `usage-report.cjs` with explicit Web/Native projection functions over validated state, supplied observation time, account metadata, and store-health metadata. Share only the local-date period/calendar builder and statistics primitives; preserve separate Web/Native denominators, identity fields, token coverage, and unavailable shapes. Move minimal shared key/counter definitions to `usage-schema.cjs` if needed to avoid circular dependencies; keep validation/normalization authoritative in usage-store. Snapshot methods validate the query then delegate. Report functions must not mutate retained rows, receipts, lifetime data, or failure maps owned by the store.

**Benefit:** new diagnostics can be implemented against plain report fixtures without touching filesystem recovery. The recently fixed inclusive future-day exclusion becomes one explicit projection invariant. No storage migration or retention-policy change.

**Disjoint write set:** `launcher/electron/usage-store.cjs`; new `launcher/electron/usage-report.cjs` and, only if required, `usage-schema.cjs`; focused report fixture. No account-pool/control-server changes. Coordinate with their owners to preserve validator exports, not duplicate their findings.

**Smallest verification:** one Web and one Native fixture covering future rows, local-day boundaries, unknown lifetime totals, and optional-token unknown versus zero; compare public results and assert input state unchanged. Maximum **30 seconds**. Reuse existing future-day/CSV checks rather than broadening to all store tests.

## Ownership and no-change boundaries

One lane-16 implementation owner can implement these sequentially; the four write sets above are disjoint. Parent owns acceptance, cross-lane scheduling, App/shared-type integration, build/UI plan, git and publication. New helper names are proposed, not existing modules.

No additional change recommended to QuotaPortfolioSummary, Updates, UpdateProgress or update-copy. The updater already has bounded copy/progress modules; `Updates.tsx:15–27,44–58` preserves installation-over-cancellation precedence and transition blocking, while App owns operation lifecycle (`App.tsx:914,1313–1317`). Moving that authority during this renderer lane would couple another owner without a demonstrated benefit comparable to the four proposals. Preserve measured-only ETA and cancellation throughout preparation. No speculative platform rewrite or new product feature is requested.
