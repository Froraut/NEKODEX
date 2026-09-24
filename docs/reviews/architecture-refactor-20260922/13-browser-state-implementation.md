# Lane 13 — browser state implementation

## Disposition

- **13-browser-state-F1: implemented.** Independently inspected the original host allocation/progress, retained selection/eviction, heartbeat/suspension, removal, user close, begin/end and shutdown paths. The review correctly identifies a cohesive lifecycle responsibility spread across the host. Extracted `BrowserTurnLifecycle` with explicit context, view, presentation, Manual, artifact and event collaborators; it never receives the host, imports Electron, or imports BrowserHost. Host APIs retain their original signatures/defaults and delegate to the single collaborator created per host.
- **13-browser-state-F2: implemented.** Confirmed the native `closed` handler discarded `persist()` failure after deleting its metadata and saved entry, whereas dormant deletion restored the retry target. Both paths now use `removeSavedWorkspace`. A non-overflow storage failure restores the saved rows. Native close publishes a saved retry row; manager close rejects with the same storage error after the window closes. Overflow still permits successive deletions. Preserve-on-shutdown remains separate.
- No findings rejected; no queue, capacity, ledger semantics, account-pool, renderer or account changes required.

## Main changes and invariants

`BrowserTurnLifecycle` owns automatic allocation, begin/reuse/progress/end, registry membership, retained matching/eviction, heartbeat/suspension/expiry, user close, exact removal and separate shutdown disposal. Manual creation registers through this same owner; Manual prompt/navigation/waiter behavior remains in BrowserHost and is supplied through explicit callbacks. View creation, attachment, initialization, authentication trust proof, presentation and artifact implementation remain host responsibilities.

The original `host.turnTabs` Map is supplied directly and never replaced. No competing registry, second task-state machine, runtime import cycle, mixin, arbitrary method installation or account-pool edits were introduced. The sweep interval is exported by the lifecycle module so the host timer and suspension detector use the same value.

Normal removal preserves side-effect order: exact membership check → capture full account/trace/helper/tab/surface/task receipt → terminal ledger write if necessary → release downloads → delete membership → settle Manual disposal → power blocker/aborted-owner state → dispose view → emit receipt → update selected surface and publish descriptor/state. A ledger write failure stops before downloads, deletion or receipt. Expiry still waits for cancellation and rechecks object identity, trace, helper and running status before removal. End-turn retains its pre-existing ordering (artifact release precedes ledger end), failed submitted documents stay inspectable, and retained matching still calls the host's principal/epoch/document trust predicate.

Shutdown explicitly disposes Manual waiters/views and clears the same registry without terminal-ledger writes or removal receipts. Its Manual callback settles even suppressed terminal waiters; normal removal continues respecting suppression. Suspension grace, inspection retention and original cancellation error class remain intact.

Workspace native close removes live-window bookkeeping first, then records the durable removal result on the captured window metadata. The requestClose observer, registered after the native bookkeeping observer, consumes that result. A failed disk commit does not reopen a window: the saved row supplies the existing UI retry action.

## Focused verification

All test invocations below were wrapped in Python `subprocess.run([...], timeout=30, check=True)`. No full suite/typecheck/build, app launch or provider/account access occurred.

1. `node --test launcher/tests/browser-turn-lifecycle.test.cjs launcher/tests/browser-workspace-live-removal.test.cjs launcher/tests/retained-turn-identity.test.cjs` — **11 passed**, approximately 104 ms (initial four lifecycle tests, two live workspace deletion tests, five existing retained-identity tests).
   - Terminal ledger failure is injected at `ledger.end`; test asserts one reached call, exact owner retained, no downstream effects, then successful ordered removal emits precisely one full receipt.
   - Rejected expiry cancellation is asserted to reach the runtime callback with exact trace/reason; owner remains live with no receipt.
   - Deferred expiry acknowledgement after registry replacement preserves the new owner.
   - Manager and direct native close tests use real manifest files, prove initial persistence, intercept atomic rename only after reading the valid deletion candidate, assert unchanged disk bytes and saved retry row, then retry and read back absence.
   - Existing identity tests cover exact reuse and changed principal, session epoch and signed-out rejection through the BrowserHost facade.
2. `node --test --test-name-pattern='wave5: dormant deletion|wave5 overflow|orderly close and disposal' launcher/tests/browser-workspace-restoration.test.cjs` — **3 passed**, approximately 171 ms. Reuses dormant retry, successive overflow deletion and preserve-on-shutdown/bounds proof unchanged.
3. `node --test --test-name-pattern='the first sweep after a suspension' launcher/tests/turn-suspension.test.cjs` — **1 passed**, approximately 52 ms. Existing facade-level suspension grace proof.
4. `node --test --test-name-pattern='automatic allocation' launcher/tests/browser-turn-lifecycle.test.cjs` — **1 passed**, approximately 66 ms. Added after the initial batch: real task ledger, exact allocation receipt, registration before view attachment, surface initialization, wrong-helper progress refusal, accepted progress, failed-end inspection projection and no eviction of the failed document.
5. `node --test --test-name-pattern='shutdown disposes' launcher/tests/browser-turn-lifecycle.test.cjs` — **1 passed**, approximately 55 ms. Targeted rerun after strengthening this case to invoke the real BrowserHost Manual-disposal callback and assert both waiter settlements and prompt clearing, including suppression override at shutdown.
6. `node --check` for each of `launcher/electron/browser-host.cjs`, `launcher/electron/browser-turn-lifecycle.cjs`, `launcher/electron/browser-workspace-windows.cjs` — **passed** on final source.
7. Scoped `git diff --check` on the two modified tracked source files — **passed**.

Total distinct behavioral cases covered: **16**; only the strengthened shutdown case was repeated. Existing shared test files were not edited. The two new test files remain local source artifacts.

## Exact changed paths

- `launcher/electron/browser-host.cjs`
- `launcher/electron/browser-turn-lifecycle.cjs` (new)
- `launcher/electron/browser-workspace-windows.cjs`
- `launcher/tests/browser-turn-lifecycle.test.cjs` (new)
- `launcher/tests/browser-workspace-live-removal.test.cjs` (new; avoids editing the shared restoration test file)
- `docs/reviews/architecture-refactor-20260922/13-browser-state-implementation.md` (this report)

## Integration constraints for parent

- Review lifecycle side-effect ordering at the explicit host composition root and collaborator. Production public facades, receipt shape and Map identity are preserved; callers do not need synchronized edits.
- Source inspection found some legacy fixtures call BrowserHost prototype methods on partial objects and stub internal `removeTurnTab` or `createTurnTab` (for example the oldest-ready eviction, terminal-Manual eviction and ordinary orphan-reaping fixtures). Internal lifecycle transitions now execute inside the collaborator, so those partial fixtures may need migration to explicit collaborator ports / complete prototype-backed host fixtures. They were not run or modified under this lane's shared-test restriction. Do not restore arbitrary host method overrides as the extraction mechanism or replace behavioral proof with source-text assertions. The new tests prove the ordered removal, allocation and failure boundaries directly.
- Parent owns integrated core/renderer types, renderer/helper build, rendered UI checks, broader fixture integration and all Git/release decisions. No commits, push, branch switch, app launches, installs/releases or additional agents were performed by this lane.
