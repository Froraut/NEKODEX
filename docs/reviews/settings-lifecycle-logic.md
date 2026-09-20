# Settings and account lifecycle logic review — 2026-09-20

This follow-up reviewed related state transitions after the Codex refresh-hint correction in PR13.
It is a source change for the next combined release; no installer or installed-app replacement is
part of this review.

## Confirmed findings and corrections

1. A context queue could resume after `stop()` while its readiness read was outstanding. Readiness
   checking is now a cancellable phase, separate from applying a mutation. Requests, cancellation
   and stop advance a revision; stale results do not apply or write late errors. Main-process
   readiness also rechecks shutdown and the exact configuration after the asynchronous health read,
   with a final shutdown gate immediately before starting the apply operation.
2. An older context apply could attach its failure to a newer user choice. Failure publication and
   pending-intent clearing now require the matching request revision. A successfully committed older
   choice is still recorded as the real active mode, then the newer queued choice can run.
3. Pending Bigger Context intent survived switching to Manual or removing the integration. The
   incompatible queue intent/error is now cleared on those state transitions and when loading such
   an older saved state.
4. Lifecycle events rejected by the snapshot's revision guard still changed catalog alerts outside
   that guard. One synchronous accepted receipt now governs event, initial snapshot and metadata
   refresh paths, including catalog diagnostics. Older catalog-operation messages cannot override
   the accepted lifecycle. Manual mode also suppresses Automatic catalog failures in state handling,
   Overview and Setup.
5. Terminal Codex sign-in returned `active=false` before account-session reconciliation released its
   lease. The account DTO and UI now expose settlement separately. The owned read-only inspection
   receives cancellation, and account controls remain locked until its actual lease release.
6. Cached quota hydration could supersede a newer manual refresh for a later account. Hydration
   ownership is reserved before sequential reads, and unrelated account evidence changes preserve
   a still-current manual refresh for another account. Replacing that same account still invalidates
   stale results.

The account work is maintained in PR14; this parent change integrates its final reviewed source.

## Scope decisions

The review did not turn missing account-specific proof metadata into an automatic demand to
reconfirm the global Codex picker on every account selection. Picker visibility and per-account
eligibility/connector checks are different observations; the reported timestamp/Boolean mismatch
alone was not sufficient evidence to impose that extra user gate. The retired-runtime-proof idea
was likewise not promoted without a defined compatibility violation.

## Verification

The parent coordinates all checks. Six focused context-queue cases and the Manual/uninstall
persisted-state case passed. Three production-component UI sequences passed: newer snapshot success
rejects old failure, current failure survives old success, and Manual mode remains usable after an
Automatic catalog error. The 1.759-second UI pass used synthetic data and delayed messages; rendered
screens were inspected. Three account reconciliation cases also passed: terminal settlement holds the lease, abort releases
it without resolving a queued probe, and a failed start retains its busy state until reconciliation
finishes. The integrated renderer typecheck/Vite build and changed main-process syntax checks passed.

Three account UI scenarios passed: controls track terminal settlement and unlock afterward while
another account remains usable; a manual refresh for account B survives A's delayed initial cached
read; and B's in-flight refresh also survives a later change in A's evidence epoch. The two quota
scenarios took 1.837 seconds. A synthetic late result of 73% remained visible in B's general quota.
The settlement screenshot and both quota states were visually inspected.

The first two account backend fixtures initially pre-created a login lock before calling start;
that correctly hit the product's existing-lock rejection. The fixtures were corrected, and only
those two failed cases were repeated. An ambiguous UI locator matching both general and additional
quota buckets was scoped to the general bucket; only affected quota flows were repeated. These
were fixture corrections, not suppressed product failures. Reviewers ran no test suites or live
account operations. No full repository/package suite, live provider login, or release packaging
was run. Controlled promises establish the changed asynchronous boundaries; they do not establish
every provider/OS failure or a real successful account login.
