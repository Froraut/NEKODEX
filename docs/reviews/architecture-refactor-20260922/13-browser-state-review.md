# Lane 13 — browser state, queues, ledger and workspaces

Baseline inspected: `53d17361f3e9c81910055a7e2c18759ffce458bc` in `/Users/alex/Dev/nekodex-refactor-20260922`.

Read-only source review. No tests, builds, apps, real accounts/providers or agents were run. Only this report was written. Verification below is a proposal for the implementation/integration wave; `right-size-test-runs/SKILL.md` was read and applied.

## Recommendation

Implement two bounded changes: extract the browser turn lifecycle behind one owner, and unify durable workspace removal to close an evidenced live-window failure gap. Architecture improvement is an independent acceptance goal; F1 does not depend on inventing a new bug. Keep both under one lane implementation agent if the parent assigns one agent per review lane, with disjoint component write sets.

Prior-work reconciliation: reviewed the queue/task/workspace sections in `docs/reviews/app-improvements-20260922.md:59-68`, `app-improvements-wave3-20260922.md:47-49,73-76,127` and `app-improvements-waves4-5-20260922.md:76-79,96-101,116-119`. Lost-lease reconciliation, priority re-reading after awaits, strongest multipart submission evidence, explicit restore retries, manifest overflow refusal and exact unsent-removal receipts already exist. Those are preservation requirements, not new findings. Wave 5's workspace correction covers **dormant** deletion; F2 concerns its separate live-window path.

## 13-browser-state-F1 — Extract one browser turn lifecycle owner (maintainability, worthwhile now)

**Evidence and extension cost.** `launcher/electron/browser-host.cjs` has 4,309 lines. Turn ownership is distributed across task projection/progress and automatic allocation (`797-891`), retained eviction (`996-1016`), heartbeat/suspension/expiry (`1714-1855`), removal (`1996-2048`), user close (`2167-2206`), retained lookup/begin/end (`2900-3089`), and shutdown disposal (`4273-4286`). Adding an ownership rule currently requires editing several distant branches inside the same class that also handles authentication, remote DOM behavior, view geometry, workspace integration and artifact downloads.

This is not just file length: `removeTurnTab` first writes the terminal ledger, then releases downloads, removes the registry entry, disposes the view, and emits the exact removal receipt. Automatic completion has a separate retention/inspection decision; expiry waits for runtime cancellation; shutdown deliberately has different disposal semantics. These ordered contracts must stay together. `retained-turn-release.cjs:1-15` already delegates to host removal, so another independent cleanup owner would be a regression.

**Callers inspected.** `launcher/electron/account-pool.cjs:1300-1359` validates account/helper/tab/surface/task receipts before rolling back safety reservations and pending affinity; `1361-1406` consumes progress and completion. Its reads of `host.turnTabs`, `taskLedger`, `exactRetainedTurnTab`, and current callback contracts mean a wholesale registry/API replacement would create unnecessary cross-lane work.

**Concrete change.** Introduce `launcher/electron/browser-turn-lifecycle.cjs`, constructed once per host, to own turn registry membership, automatic begin/reuse/progress/end, retained selection/eviction, lease expiry and exact removal orchestration. Preserve thin BrowserHost public delegates and the existing `turnTabs` Map identity for pool readers. Keep Electron view construction/binding/presentation, authentication probes and artifact implementation in the host, supplied as explicit adapters. Keep Manual prompt/navigation/waiter behavior in its existing host methods; route its registration/removal through the same lifecycle owner, with an explicit manual-disposal callback. Do not give Manual and automatic controllers competing Maps.

Make normal removal and shutdown disposal separate explicit operations; do not manufacture unsent-refund authority during shutdown. Reuse the existing ledger's monotonic submission rules rather than adding a second task-state machine. A small immutable owner-receipt constructor can eliminate duplicate tuples, but must not weaken the pool's matching predicates. Avoid a mixin that merely moves methods while retaining unrestricted access to every host field.

**Benefit.** New expiry, retention or task-progress behavior has one implementation home and one side-effect order. Authentication, workspace or viewport changes no longer require understanding the entire turn lifecycle. This is a coherent extraction, not a generic event bus or new platform.

**Owned write set.** `launcher/electron/browser-host.cjs`, new `launcher/electron/browser-turn-lifecycle.cjs`, and a focused new `launcher/tests/browser-turn-lifecycle.test.cjs`. Include `retained-turn-release.cjs` only if its delegate needs adjustment. Leave ledger/queue semantics unchanged. One lifecycle writer must own all host edits; auth/artifact/account lanes submit wiring requirements to that writer. `account-pool.cjs` is a read-only compatibility consumer for this proposal, not a second assigned write target.

**Smallest meaningful verification.** Proposed focused fixture cases: exact retained reuse vs wrong principal, terminal-ledger-write failure retains the tab and emits no removal receipt, cancellation rejection preserves the live owner, and expiry cancellation resolving after ownership changed does not remove the replacement. Reuse selected existing retained/queue cases where they prove the same boundary instead of duplicating them. Maximum 30 seconds per selected command, with no real browser/provider; parent owns any integrated build/UI checks. Preserve inspection tabs, suspension grace, Manual waiters and shutdown behavior in source review.

## 13-browser-state-F2 — Live workspace close loses durable-deletion retry target (confirmed source defect, P2)

**Trigger/evidence.** Open a normal workspace already captured in its manifest, then encounter a commit I/O failure while closing it. In `launcher/electron/browser-workspace-windows.cjs:166-182`, the native `closed` handler removes the live metadata and saved entry, calls `persist()`, and discards its result. `persist()` (`365-377`) catches the write error and returns `{ok:false,...}`. `requestClose()` (`505-524`) resolves on `closed` regardless; live `close()` (`501-502`) returns success.

Consequently, the disk still contains the old saved workspace, the in-memory row has disappeared, and the next explicit restore after restart can offer it again. The persistence warning remains, but the specific removal cannot be retried in the current manager. This applies to native window close/keyboard close as well as manager close. It is source-confirmed, not runtime-reproduced.

**Caller proof and prior fix distinction.** `browser-workspace-directory.cjs:42-45` delegates directly; `account-pool.cjs:815-818` treats the resolved boolean as success. `launcher/src/BrowserWorkspaceManager.tsx:110-120` renders removal actions from snapshot items, so the vanished row removes the retry action. In contrast, the dormant branch (`browser-workspace-windows.cjs:483-499`) restores its previous Map and throws on non-overflow persistence failure. The existing regression explicitly tests dormant deletion (`launcher/tests/browser-workspace-restoration.test.cjs:348-387`).

**Concrete change and benefit.** Factor one `removeSavedWorkspace(id)` transaction used by dormant deletion and the native closed handler. On ordinary I/O failure restore the saved entry, publish it as `saved` (the actual window remains closed), and preserve the persistence warning. Carry that deletion outcome to `requestClose` so manager-initiated close rejects with the actual storage failure; native close has no awaiting caller but must publish the retry row. Retain the current overflow exception that permits successive deletions to reach the limit, and keep preserve-on-shutdown behavior distinct. This reuses the existing UI action and fixes a durable receipt mismatch without reopening a window or inventing a new workflow.

**Owned write set.** `launcher/electron/browser-workspace-windows.cjs` and `launcher/tests/browser-workspace-restoration.test.cjs`, disjoint from F1. No renderer, pool or IPC signature changes required. Coordinate with the workspace UI lane only to preserve its existing error/retry presentation.

**Smallest meaningful verification.** Add one live-close commit-failure case using the existing real-file manifest fixture: prove successful initial persistence, inject failure at deletion commit, assert window gone but saved retry row and unchanged file remain, then retry deletion and read back absence. Cover direct native close using the same fixture if it takes a distinct settlement branch. Reuse the existing dormant/overflow cases. Maximum 30 seconds for the selected cases; no application launch.

## Boundaries

No additional queue, capacity, navigation-state or launcher lifecycle projection rewrite is recommended from this review. Their current separation is useful; queue pause/reconnect, typed terminal failures and terminal ledger evidence should remain stable. Parent owns acceptance across all 16 lanes, integration, build/UI planning, Git and publication. No tests run.
