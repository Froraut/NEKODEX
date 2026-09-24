# Lane 16 — feature UI implementation

Source implementation in shared worktree `/Users/alex/Dev/nekodex-refactor-20260922`, baseline `53d17361f3e9c81910055a7e2c18759ffce458bc`. Read the complete lane review and independently inspected the affected implementations and callers' public contracts. No branch changes, commits, pushes, apps, providers, installations, releases, or additional agents. Other lanes' changes were left untouched.

## Finding disposition

- **F1 implemented.** `useUsageReport` owns query identity, injected loader, keyed result/error, 12-entry cache, account options, retry, disposal, coalescing, 30-second polling and hidden/focus scheduling. Native requests omit accountId. Failed refresh retains visible successful data. Disposal ignores completion rather than claiming cancellation of IPC. `UsageCalendar` owns completion, chart, table and expansion state; Dashboard retains source presentation/export and existing totals. Public Dashboard props are unchanged.
- **F2 implemented.** Independently confirmed that the prior string error rendered unconditionally after account selection/fallback. Workspace now captures `{accountId, action}` for each operation and stores `{accountId, message}`; rendering compares with the actual displayed account, including fallback before the selection effect settles. `useFeatureAction` provides a synchronous ref gate and pending identity for Workspace and Queue; callbacks and raw workspace error messages are preserved. Selection does not retarget an operation. Queue still delegates errors to its parent. Task Center's existing gate is unchanged. This is error-attribution and action-contract work, not a claim of reproduced double-click corruption.
- **F3 implemented.** All six local language arrays became named, typed copy records, with exhaustive phase keys. Filtering and capability-based confirmation eligibility live in `task-center-model`. One target `{kind, taskKey}` and one `TaskActionConfirmation` replace duplicate dialogs. Cancellation and dismissal retain different warnings, safe Keep labels and exact mutation arguments. Parent TaskCenter still owns Keep focus, trigger restoration, filter-focus preservation, Escape gate and action gate. `taskCenterTitle` remains re-exported from TaskCenter for existing callers.
- **F4 implemented.** Pure `projectWebUsage`/`projectNativeUsage` accept validated state, observation time, metadata and narrow health observations. They share local-date period construction and statistics, preserving independent denominators, token coverage and unavailable shapes. `usage-schema` contains shared keys, counters, empty aggregates and failure classification; it has no dependency on store/report. Query/sample/persisted-state validation, mutations, recovery, receipts and durable persistence remain in UsageStore. Snapshot facades and public exports remain compatible. Direct `snapshotNative` now rejects unsupported ranges consistently with `snapshot`; supported calls are unchanged. Projection results detach retained rows/maps. No migration or retention change.

No findings were rejected. No changes were made to QuotaPortfolioSummary, Updates, UpdateProgress or update-copy: the review's no-change rationale remains valid for this scope.

## Focused verification

All test invocations were wrapped in Python `subprocess.run(..., timeout=30, check=True)`. Existing passing checks were not repeatedly rerun.

1. `node --test launcher/tests/feature-ui-contracts.test.cjs launcher/tests/usage-report-projection.test.cjs launcher/tests/usage-period-boundary.test.cjs` — **8/8 passed**, ~208 ms Node test duration at that revision. Covered:
   - Web A → Native → late A completion, Native account omission and visible identity;
   - focus/timer coalescing, hidden suppression, rejected refresh preserving report, retry clearing error;
   - synchronous duplicate action admission, captured account on rejection, pending recovery;
   - both confirmation kinds under revoked capability, removed row and account filtering;
   - frozen Web/Native projection fixtures, detached result mutation, future exclusion, unknown lifetime, optional tokens unknown versus measured zero, Web unavailable state;
   - selected existing persisted-store regressions: Native cross-midnight and Web clock rollback, retained lifetime and on-disk history.
2. After adding the component-specific case: `node --test --test-name-pattern='workspace hides' launcher/tests/feature-ui-contracts.test.cjs` — **1/1 passed**, ~260 ms. Explicitly entered onOpen for A before injected failure; settled error disappeared on B; another A request remained captured while A was removed, and its late rejection stayed hidden on B with recovered controls.
3. After adding confirmation callback coverage: `node --test --test-name-pattern='both Task Center' launcher/tests/feature-ui-contracts.test.cjs` — **1/1 passed**, ~213 ms. Both extracted dialogs retain safe Keep labels and alertdialog semantics; confirmation invokes cancel(tabId, traceId) or dismiss(accountId, id) exactly and clears the target.
4. Focused `typescript.transpileModule` syntax pass for the ten lane-owned TS/TSX source modules — passed. This was a syntax check, **not** renderer typechecking or a build.
5. `git diff --check -- launcher/src/UsageDashboard.tsx launcher/src/BrowserWorkspaceManager.tsx launcher/src/QueueControls.tsx launcher/src/TaskCenter.tsx launcher/electron/usage-store.cjs` — passed.

There are 10 distinct passing behavior cases across the three test invocations. The test host executes actual extracted hooks/components with deterministic state/effect scheduling and event callbacks; it is not a mounted React DOM or keyboard/focus proof. Injected failures assert the loader/action boundary was reached. The final narrow health-argument change and removal of unused report imports were manually reviewed; no unrelated suite was run.

## Exact changed paths owned by this lane

Modified:
- `launcher/src/UsageDashboard.tsx`
- `launcher/src/BrowserWorkspaceManager.tsx`
- `launcher/src/QueueControls.tsx`
- `launcher/src/TaskCenter.tsx`
- `launcher/electron/usage-store.cjs`
- `launcher/tests/task-center-focused.test.cjs` (parent-authorized follow-up)

Added:
- `launcher/src/useUsageReport.ts`
- `launcher/src/UsageCalendar.tsx`
- `launcher/src/useFeatureAction.ts`
- `launcher/src/task-center-copy.ts`
- `launcher/src/task-center-model.ts`
- `launcher/src/TaskActionConfirmation.tsx`
- `launcher/electron/usage-report.cjs`
- `launcher/electron/usage-schema.cjs`
- `launcher/tests/feature-ui-contracts.test.cjs`
- `launcher/tests/usage-report-projection.test.cjs`
- `docs/reviews/architecture-refactor-20260922/16-feature-ui-implementation.md`

## Parent integration constraints

- Parent owns integrated renderer/core types, renderer/helper build and rendered UI checks. No App, i18n, shared types or shared fixture edits were made here.
- Parent-authorized follow-up resolved the `task-center-focused.test.cjs` loader constraint: relative TS/TSX imports now resolve recursively with per-harness module caching, and hook-free confirmation presentation is expanded once before simulated ref commit. Existing test bodies and behavioral assertions are unchanged. The shared fixture server was not edited.
- The shared renderer fixture may likewise need explicit module registration for the new feature files. Preserve `taskCenterTitle` facade; production callers need no synchronized edits.
- Remaining rendered checks: both confirmation kinds' Keep autofocus, Escape, capability revocation/removal and filter-focus preservation; calendar expansion and CSV export; workspace account error attribution plus existing durable-delete retry. These are parent-owned integrated acceptance, not claims of this lane's source-level tests.

## Parent-authorized focused fixture follow-up

Changed only `launcher/tests/task-center-focused.test.cjs` and this report. The loader compiles local imports and injects the same hook host across modules; each render expands the extracted hook-free confirmation before traversal/ref commit. Existing behavioral assertions were retained verbatim.

Command (Python subprocess timeout 30 seconds):

```sh
node --test --test-name-pattern='both confirmations focus|live row removal|disabled or revoked capabilities|combined filters preserve|retained failure requires|completed continuation' launcher/tests/task-center-focused.test.cjs
```

**6/6 passed**, no failures, Node test duration **205.747417 ms**:

1. `retained failure requires confirmation, Keep preserves it, Open still works, exact account is dismissed once`
2. `completed continuation and unavailable document keep direct dismissal`
3. `combined filters preserve order and records, clear restores all, hidden confirmations are discarded`
4. `disabled or revoked capabilities cannot confirm; dismissal failure reports error and preserves confirmation`
5. `both confirmations focus the safe choice; Escape and Keep restore their trigger without acting`
6. `live row removal falls back to search, while filtering preserves the user focus`

This adds existing simulated focus/keyboard and eligibility proof; mounted React DOM flows remain parent-owned. No unrelated test suites or shared fixture server changes.
