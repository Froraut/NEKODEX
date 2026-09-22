# Heavy browser module refactor — September 22, 2026

Continues from `6f35482` on `codex/architecture-refactor-20260922`, PR #20. The user specifically requested the remaining heavy browser implementation areas. No additional agent wave was started.

## Boundaries implemented

- `browser-personalization.ts`: the complete connector personalization transaction, deadline ownership, rollback and verified composer cleanup. Persistent cleanup errors keep their class identity across the worker facade.
- `browser-submission-dom.ts`: logical user/assistant history and submission evidence with explicit caller-owned revision caches.
- `browser-response-dom.ts`: bound-response Markdown, commentary, status and completion-action extraction, including visibility/cache invalidation and embedded-chart handling.
- `browser-dom-revision.ts`: the shared mutation-attribute contract; `browser-visible-trace.ts`: append-only visible progress and retained-byte accounting.
- `browser-diagnostics.ts`: privacy-filtered capture, retention and stalled-turn structural diagnostics. Bounded observation and shared UI timing live in `browser-operation-support.ts`.
- `browser-manual-turns.cjs`: prompt identity, human confirmation deadlines, retained continuation, observers, completion and cancellation. Explicit context/lifecycle/presentation ports receive the existing host maps. The same turn-lifecycle owner still creates/removes registry membership; Electron view creation remains in the host.
- `browser-artifact-transfers.cjs`: exact turn/surface leases and host-owned partial cleanup. Network request interception and writes remain in the download guard.

Public worker exports and host method signatures remain available. No whole-host injection, runtime method copying, competing tab registry, account migration or protocol change was introduced. The worker still owns page acquisition, submission, rebind, stage cancellation and the main turn loop; the host still owns Electron composition and authentication.

`browser-worker.ts`: **5,416 → 3,802 lines**. `browser-host.cjs`: **3,952 → 3,505 lines**. These are responsibility reductions in the orchestration files, not claims about total source size, speed or memory use.

## Confirmed defect fixed

A pending artifact wait checked ownership only before awaiting the download. If the task released its lease or its surface stopped running while completion was pending, it could still return a successful receipt. The new regression reached the exact registered WebContents boundary, released the lease, completed the deferred download, and failed with “Missing expected rejection” before the fix.

Delivery now rechecks the same lease object, release flag and exact live tab after completion. The regression covers both lease release and surface retirement; neither emits a completion receipt. Existing transfer cancellation, partial cleanup and promoted-file preservation continue to pass.

## Focused verification

- Core `bun run typecheck` and `bun run scripts/build-browser-helper.ts` passed on final source. Initial extraction omissions were corrected before successful verification.
- Syntax checks passed for the host and both new Electron controllers.
- `node --test launcher/tests/task-artifact-host.test.cjs`: **3 cases passed**.
- Selected `browser-host.test.cjs` and `browser-turn-lifecycle.test.cjs` cases: **9 passed**. Covered idempotent start/completion, independent Copy/Sent, configurable human deadlines, incremental retained prompt, changed-prompt refusal, failed cancellation then acknowledged retry, delayed acknowledgement against a replacement tab, and shutdown waiter disposal. The existing Manual fixture now explicitly supplies its expected 30-second setting instead of omitting the required configuration callback.
- Selected `browser-worker-contract.test.ts` cases: **12 passed**. Covered virtualized submission identities, persistent cleanup error identity, closed-page refusal, aborted connector proof cleanup, native editor deletion, diagnostic privacy, trace interleaving, localized stopped-thinking, real-browser stylesheet cache invalidation, commentary classification and embedded-chart Markdown.
- One existing connector fixture initially rejected the current `.popover` scope before reaching its intended abort boundary; it was corrected to represent the production popup, and its exact ordered cleanup assertion passed. The old stalled-diagnostic source-layout assertion was replaced with execution of the actual production function, asserting counts and absence of private content. Marked DOM predicates now read their extracted production module. Unrelated legacy tests were not broadly migrated or run.
- Actual source Electron with a fresh isolated Manual DEV profile and real preload/snapshot IPC passed in about 1.3 seconds across Overview, Accounts, Task center, Connections and Settings. The task process exited and its temporary profile was removed. Renderer source was unchanged in this phase; the previously built current renderer was reused.

Worker command: `bun test tests/browser-worker-contract.test.ts --test-name-pattern 'submission DOM tracks|closing the launcher page|a mutating stage timeout preserves|an aborted connector proof|connector cleanup uses native|response snapshot invalidates|browser diagnostic state drops|stalled-turn diagnostics record|visible DOM trace interleaves|the shipped stopped-thinking detector|the shipped commentary classifier|embedded chart hydration'`. Only the two corrected fixtures were rerun after the initial batch.

Host command: `node --test --test-name-pattern='manual start is idempotent|manual confirmation deadlines|manual completion is idempotent|retained manual chat copies|manual Copy and Sent|manual start rejects a different|extracted Manual cancellation|shutdown disposes' launcher/tests/browser-host.test.cjs launcher/tests/browser-turn-lifecycle.test.cjs`.

## Electron verifier correction

The first source run selected the embedded idle WebContents via `firstWindow()`. Diagnostic inventory showed both that empty data-URL page and a ready source renderer with the expected UI. The mistaken page timed out at four seconds; its zero-width screenshot then masked the original timeout. This establishes a verifier targeting defect, not a product startup failure.

The fixture now selects the exact `file:` renderer URL under the source checkout, checks the expected DEV profile through real IPC, and preserves the original error if a diagnostic screenshot fails. The existing shell timeout was not increased. The corrected run passed; the source URL, process identity, profile and closed state are retained in ignored local evidence. The global development-instance guidance was updated with this verified lesson.

## Delivery scope

Version remains `5.9.0-nekodex.5`. Source/DEV only: no installable assets, installed-app replacement, account/session changes, provider turn, full repository suite or cross-platform runtime claim. The unchanged renderer was not repeatedly rebuilt. Existing production work was preserved.
