# Lane 08 — compaction implementation

Implemented F1–F3 in the shared `codex/architecture-refactor-20260922` worktree. Independently read the original implementations and relevant callers/tests before editing. No finding was rejected; F1/F2 are architecture improvements, while F3 also corrects a demonstrated persistence rollback defect. No commits, branch changes, app launches, provider/account access, installation, release, or additional agents.

## Finding disposition

- **F1 implemented:** `createCompactionRunRegistry` encapsulates exact-run cache, owner gates and native interruption tombstones, with an injectable clock and one process-local default. Native cancellation records its synchronous barrier before the shared cancellation transition. Trace and global cancellation use that same transition. Replay eligibility and publication assertions share the interruption/abort check, while a missing exact-run lookup still returns undefined. Failed/successful 30-minute retention, active ownership beyond retention, first cancellation reason, interruption refresh and queued predecessor gates remain intact. The handoff module re-exports existing APIs.
- **F2 implemented:** `active-compaction-source.ts` owns result encoding, completeness validation and one exclusive settlement path. A narrow structural `Pick<TurnBrokerOwner, ...>` accepts both synchronous and asynchronous broker count implementations. Explicit automatic/manual policies retain canonical automatic bytes, manual final-result augmentation only when no queued call received the instruction, runtime eligibility, delivery observation timing and terminal interpretation. Accounting, result marking, abort handling, physical-settlement waiting and revocation are shared. `compaction-lifecycle.ts` contains the unchanged abort-reason/wait mechanics. Retained browser submission, journal acceptance, fallback classification and retained deadline remain in handoff unchanged.
- **F3 implemented:** format/schema/hash/stream framing moved to `rolling-checkpoint-format.ts`; request analysis/projection moved to `rolling-checkpoint-projection.ts`. One analysis supplies the adjacent parent and current-input boundary, retaining canonical prefix instructions, exact native revision assertion and resolved model/options. Store/facade still owns canonical paths, strict persisted parsing, retention/cap and locking. Commit creates a candidate map, merges latest disk state under the existing lock, writes atomically and only then publishes the map. Memory-only publication remains direct. Storage errors propagate. An optional atomic-writer constructor dependency preserves existing constructor calls and enables a failure at the actual write boundary.

The F3 regression starts with a valid durable predecessor and proves applicability before injecting failure. The writer verifies the failed turn reached the serialized candidate, then rejects before replacement. Durable bytes stay identical; a second store sharing the backend cannot apply the failed answer; a later successful commit cannot resurrect it. This proves the bounded source defect, not any historical live-client replay.

## Focused checks

All Bun invocations below were executed through Python `subprocess.run(argv, timeout=30)`; every Bun invocation also used `--timeout 5000`. Existing linked dependencies were used. No whole-suite, package typecheck or build ran.

1. `bun test tests/rolling-checkpoint.test.ts --test-name-pattern 'failed persistence|split across|replaces only exact-parent|canonical prefix|current-turn input|server-resolved|unsummarized intervening' --timeout 5000`
   - **9 pass, 0 fail, 5 filtered; 223 ms.** Includes injected write failure, split marker, adjacent-parent rejection, current-turn replay, canonical authority and route restoration.
2. Initial selected retained checks: `bun test tests/retained-compaction.test.ts --test-name-pattern 'a rejected exact compaction|native interruption before registration|a completed exact compaction rejects replay|a duplicate native interruption|active compaction settles canonical|active compaction distinguishes|active compaction aborts its source|Manual mode active compaction returns|active compaction interrupts a queued|isolated compaction registry' --timeout 5000`
   - **10 individual existing cases reported pass**, including actual local queued broker interception. The invocation then hit the 30-second process limit in the new isolated registry fixture. The fixture had invoked Bun's rejection matcher before initiating cancellation. Fixed the fixture to attach a rejection handler, initiate cancellation, then assert rejection. This was not a successful whole invocation and is not reported as one.
3. `bun test tests/retained-compaction.test.ts --test-name-pattern 'isolated compaction registry' --timeout 5000`
   - **1 pass, 0 fail, 37 filtered; 250 ms.** Corrected fixture proves logical timeout and queued cancellation retain physical predecessor ownership beyond TTL; cancellation completes only after release, and expired settled replay is then pruned.
4. Final affected-policy/publication checks: `bun test tests/retained-compaction.test.ts --test-name-pattern 'active compaction settles canonical|active compaction distinguishes|active compaction aborts its source|Manual mode active compaction returns|a completed exact compaction rejects replay' --timeout 5000`
   - **6 pass, 0 fail, 33 filtered; 193 ms.** Automatic async broker fixture asserts exact canonical result bytes, one progress update per delivered result, emptied outstanding set and one revocation. Manual cases exercise asynchronous queued counts of zero and one, including no duplicate instruction augmentation. Also verifies interception versus ordinary final, source cancellation and interrupted replay after completion.
5. Scoped `git diff --check -- src/adapters/chatgpt-web/compaction-handoff.ts src/adapters/chatgpt-web/rolling-checkpoint.ts tests/retained-compaction.test.ts tests/rolling-checkpoint.test.ts` — passed. Manually reviewed extracted modules and facade imports for dependency direction and preserved boundaries.

## Exact changed paths owned by this lane

- `src/adapters/chatgpt-web/compaction-handoff.ts`
- `src/adapters/chatgpt-web/compaction-run-registry.ts` (new)
- `src/adapters/chatgpt-web/active-compaction-source.ts` (new)
- `src/adapters/chatgpt-web/compaction-lifecycle.ts` (new)
- `src/adapters/chatgpt-web/rolling-checkpoint.ts`
- `src/adapters/chatgpt-web/rolling-checkpoint-format.ts` (new)
- `src/adapters/chatgpt-web/rolling-checkpoint-projection.ts` (new)
- `tests/retained-compaction.test.ts`
- `tests/rolling-checkpoint.test.ts`
- `docs/reviews/architecture-refactor-20260922/08-compaction-implementation.md` (this report)

## Integration constraints

No caller source changes required: existing handoff/checkpoint imports remain valid. Concurrent extraction of broker, turn-session, config and environment is consumed through their existing facades. `compaction-model-config.ts` remains exclusively lane10's work; this lane did not edit it. No cross-lane source ownership conflict identified. Parent still owns integrated core/renderer typing, builds and UI verification. Focused runtime fixtures do not substitute for those integrated checks or live provider proof. No UI or source-release claim is made here.

## Integrated writer contract follow-up

Parent's integrated core typing identified that the concurrently extracted atomic writer accepts `string | Uint8Array` and returns a `FileSnapshot` receipt. Updated only the injected writer in `tests/rolling-checkpoint.test.ts`: decode byte input with `TextDecoder` before JSON parsing, and return the real `atomicWriteFile` receipt on success. The injected failure still occurs only after confirming the candidate reached the write boundary.

Ran only `bun test tests/rolling-checkpoint.test.ts --test-name-pattern 'failed persistence' --timeout 5000`, through `subprocess.run(..., timeout=30)`: **1 pass, 0 fail, 13 filtered; 189 ms, 9 assertions**. No global typecheck or other test pipeline rerun. Follow-up changed paths: `tests/rolling-checkpoint.test.ts` and this report. Integrated typing remains parent-owned.
