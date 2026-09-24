# Lane 02 — Responses implementation

Worktree: `/Users/alex/Dev/nekodex-refactor-20260922`.
Branch and HEAD verified: `codex/architecture-refactor-20260922`, `53d17361f3e9c81910055a7e2c18759ffce458bc`.
Read the entire lane review and applied `right-size-test-runs`. Changes are local source only in the shared worktree.

## Finding disposition

- **02-responses-F1 — implemented.** Independently confirmed that the unserializable, oversized and post-prune capacity early returns recorded rejection state without reaching the old persistence scheduling call. Extracted the disk graph codec and unified retention-attempt persistence scheduling. A fresh-process behavioral test now proves a rejection-only mutation survives flush/reload after a prior successful flush. It explicitly asserts the injected serialization boundary was reached and the returned reason is `unserializable` before checking restart behavior. No oversized allocation was necessary; the other early returns use the same scheduling boundary and were reviewed in source.
- **02-responses-F2 — implemented.** Independently confirmed discovery used the raw tool projection while final context applied collaboration policy later. Both discovery and active tool lists now use the same availability projection. Tests prove blocked collaboration tools disappear from both, enabled collaboration remains announced, unrelated namespaced tools remain available, blocked-only results make no availability claim, and failure status is preserved.

## Main changes and invariants

`state-snapshot.ts` owns persisted graph types, v1/v2 decoding, bounded newest-first v2 encoding, shared node metadata/byte accounting and individual-chain eligibility. The byte budget is injectable for deterministic tiny fixtures. It has no filesystem, clock, live-state or runtime dependency on `state.ts`. Scope decoding is a narrow callback supplied by the live owner; existing scope validation and comparison therefore remain authoritative in `state.ts` without a circular import.

`state.ts` retains live maps, TTL/eviction, completion eligibility, ownership hashing/validation/comparison, exact-object replay WeakMaps, lazy loading, debounce/path capture and best-effort filesystem writes. Public exports remain available from the original module, including the scope type and serialized-size helper. A single finalization boundary schedules persistence for eligible retention attempts including rejection-only branches. Invalid IDs, reads and skipped completions stay outside it. `restartPersistence: eligible` still means eligibility, not guaranteed durable storage.

`tool-projection.ts` owns tool shape projection, known-function schema validation, namespace/custom/discovery/open-extension handling, availability policy, stable wire-name deduplication and choice normalization. `parser.ts` retains history ordering, reasoning, replay and file handling. Declared-before-loaded precedence and hosted exclusions are unchanged. No caller migration or schema/policy changes are required.

## Focused verification performed

1. `bun test tests/responses-state-snapshot-contract.test.ts tests/responses-loaded-tool-validation.test.ts`
   - Exit 0; **8 passed, 0 failed**, 44 Bun expectations; reported elapsed **75 ms**.
   - Covers shared-ancestor round trip, exact-fit and one-byte-too-small eligibility, bounded newest-root selection, v1 compatibility, invalid parent/depth rejection, owner mismatch, exact-object replay prefix before/after restart, rejection-only persistence, existing nested function validation/freeform/extensions/wire names and the new discovery policy cases.
   - Persistence fixtures use two short-lived offline Bun processes with temporary isolated homes and 5-second subprocess timeouts. No live account/provider or app launch.
2. Strengthened the existing restart case to remove the flushed temporary snapshot, perform a retained-state read and invalid-ID retention, then flush and assert no file was recreated. Ran only that changed case:
   `bun test tests/responses-state-snapshot-contract.test.ts --test-name-pattern 'rejection-only'`
   - Exit 0; **1 passed, 2 filtered out, 0 failed**; reported elapsed **42 ms**. Child-process assertions cover the boundary and replay checks; the four outer expectations validate subprocess stderr/exit status.
3. `git diff --check -- src/responses/state.ts src/responses/parser.ts tests/responses-loaded-tool-validation.test.ts`
   - Exit 0, no whitespace errors at diff review.

No full suites, package builds, typechecks or UI checks ran. Existing source-string fixtures were not rewritten. Parent owns integrated types/builds/rendered UI verification.

## Exact changed paths

- `src/responses/state.ts`
- `src/responses/state-snapshot.ts` (new)
- `src/responses/parser.ts`
- `src/responses/tool-projection.ts` (new)
- `tests/responses-state-snapshot-contract.test.ts` (new)
- `tests/responses-loaded-tool-validation.test.ts`
- `docs/reviews/architecture-refactor-20260922/02-responses-implementation.md` (this report)

## Integration constraints

No unresolved caller migration or cross-lane source need identified. `src/responses/file-content.ts`, shared tests, server/native callers, collaboration policy and other owners' files were not edited. The new modules must be included with their facade edits. Integrated TypeScript verification remains the parent's responsibility. Snapshot persistence remains bounded and best effort; the tests do not establish disk-failure durability or live upstream behavior. No commit, push, branch switch, install, release, application launch or additional agent was performed.
