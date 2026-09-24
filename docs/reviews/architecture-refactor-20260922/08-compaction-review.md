# Lane 08 — compaction/checkpoint lifecycle

Baseline: `53d17361f3e9c81910055a7e2c18759ffce458bc` (HEAD verified). Read-only source review; **no tests or builds run**, no providers/accounts/apps used, no agents spawned. Only this report was written. Paths below are relative to `/Users/alex/Dev/nekodex-refactor-20260922`.

Reviewed all assigned compaction modules, rolling checkpoints, input/resource budgets and model policy/configuration, plus callers in adapter `index.ts`, `server.ts`, `turn-broker.ts`, browser-worker/prompt imports, persistence primitives and relevant existing test definitions. Applied `right-size-test-runs` to the proposed verification only.

Existing review exclusions: `app-improvements-20260922.md:72,144-145`, `app-improvements-wave3-20260922.md:59,70-72`, and `app-improvements-waves4-5-20260922.md:72,106` already cover failed exact-run retention, canonical prefix instructions, current-turn replay preservation, aborted capability consumption and adjacent-parent enforcement. Those protections exist in this baseline; they are invariants below, not new findings.

## 08-compaction-F1 — Extract a compaction-specific run registry with one cancellation transition

**Type/priority:** architectural improvement, implement now; no new production failure claimed.

**Evidence:** `src/adapters/chatgpt-web/compaction-handoff.ts:419-622` owns three process-global maps, exact-request replay, native interruption tombstones, per-owner serialization, physical settlement and three cancellation entry points. This is independent of browser handoff construction at `291-417` and tool-result settlement at `176-289`. `existingStructuredCompactionRun` (`501-514`) and `runStructuredCompactionOnce` (`527-541`) repeat interruption/aborted-run checks. `cancelStructuredCompactionRuns` (`578-588`) and native-turn cancellation (`591-611`) repeat selection, abort and settlement aggregation, while correctly differing in the synchronous interruption barrier and return shape.

Callers establish why these states must stay coupled: adapter `index.ts:988-1049` registers work and retains fallback physical ownership; `1185-1215` distinguishes an HTTP observer disconnect from operator interruption and rechecks authority before publication. `server.ts:1065,1229,1268` uses counts, trace cancellation and native cancellation. An extension to cancellation currently needs edits to multiple transition paths within a file also responsible for provider operations.

**Concrete change:** move this entire registry into `compaction-run-registry.ts`, encapsulated by a compaction-specific registry object with the existing default process-local instance. Preserve exports through `compaction-handoff.ts` initially so consumers need no simultaneous edit. Centralize synchronous selection/abort into a helper returning `{cancelled, settlement}`; native cancellation records its tombstone first, then delegates. Centralize replay eligibility without changing the public missing-run semantics. A clock dependency is useful for existing retention checks; do not introduce a generic task scheduler or persistent replay store.

Preserve: 30-minute failed/successful exact-run retention; active runs surviving TTL until physical cleanup; predecessor ownership gates for cancelled queued work; first cancellation reason with refreshed interruption lifetime; synchronous registration/interruption ordering; publication recheck. Never equate logical completion with physical settlement.

**Owned write set:** `compaction-handoff.ts`, new `compaction-run-registry.ts`, selected cases in `tests/retained-compaction.test.ts`. F1 and F2 require the **same lane-08 writer** because they share handoff/tests. Server, adapter orchestration and turn-session registry remain parent/adjacent-lane owned; facade exports avoid cross-lane edits.

**Smallest verification:** selected existing cases for failed exact replay, interruption before registration, replay after later interruption, and delayed physical ownership after timeout/queued cancellation. Fake/deferred promises only; max **30 seconds per focused command**, per-case timeout at most 5 seconds. Parent coordinates any shared caller coverage.

## 08-compaction-F2 — Share active-source settlement mechanics, keep delivery policies explicit

**Type/priority:** architectural improvement, implement now together with F1.

**Evidence:** `compaction-handoff.ts:176-230` and `232-289` duplicate exclusive access, pre-abort/source checks, outstanding-result completeness, token acquisition, progress accounting, result-delivered marking, browser-outcome checking, physical-settlement wait, abort handling and final revocation. The differences are consequential: automatic mode preserves canonical results and intercepts a later call; Manual mode may append its instruction to the last canonical result when no queued call was interrupted. Automatic mode returns whether an ordinary final answer is preservable; Manual mode can return `undefined` when no instruction was delivered. Adapter `index.ts:1079-1139` consumes these differences to select fresh fallback and preserve the ordinary final response.

**Concrete change:** extract `active-compaction-source.ts` with one private settlement skeleton and explicit automatic/manual wrappers (keep current public signatures through re-exports). Give the skeleton a small typed delivery policy covering runtime eligibility, queued interruption result, per-result augmentation and terminal interpretation. Keep the Manual instruction rule visibly in its wrapper/policy; do not collapse both modes into a boolean-heavy universal handoff. Use the broker's structural owner contract and await possibly asynchronous counts consistently. Share the existing abort-wait helper in a lane-local `compaction-lifecycle.ts` if both extracted modules need it, preserving its error/reason behavior.

**Benefit:** future tool-result or cancellation changes get one accounting/cleanup path, while mode-specific consent and delivery rules remain reviewable. Leave retained browser submission, journal acceptance and safe-before-Send fallback classification separate. Do not merge the re-armed outer fallback deadline with the fixed retained-handoff deadline; their phases intentionally differ.

**Owned write set:** `compaction-handoff.ts`, new `active-compaction-source.ts`, optional new `compaction-lifecycle.ts`, selected `tests/retained-compaction.test.ts` cases. No edits to `turn-broker.ts`, `turn-execution.ts`, `index.ts` or native-control wording required.

**Smallest verification:** selected existing cases for canonical automatic results, ordinary final versus intercepted later tool, Manual completion control, queued call interruption and source cancellation. Assert delivered result bytes, one result-accounting update and revocation/physical-settlement behavior rather than helper call order. Max **30 seconds per focused command**, no real broker/account needed beyond existing local fixtures.

## 08-compaction-F3 — Separate rolling-checkpoint responsibilities and publish cache only after persistence

**Type/priority:** bounded architecture improvement plus **source-confirmed rollback defect** (not runtime-reproduced in this wave).

**Evidence:** `rolling-checkpoint.ts` mixes schema/hash/stream framing (`11-191`), authority-sensitive request projection (`193-261,301-342`) and shared persistent storage (`263-299,344-439`). Browser-worker imports stream types/implementation and prompt imports format constants, while adapter `index.ts:432-439,468-470,518-523` uses store application/commit. A format extension therefore shares a module with file locking and history authority.

The concrete defect is `commit()` at `354-366`: after loading, it deletes/sets the shared map and prunes it **before** `persist()`. If lock acquisition or `atomicWriteFile` fails before file replacement (`423-438`; primitive `src/config.ts:210-234`), the caller receives a failure, but the new entry remains in the process-wide backend. Later `load(true)` merges that cache with disk (`416-420`) rather than restoring disk-only state. Thus a failed commit can remain eligible for exact-parent application in the same process and can enter a subsequent successful persistence. `index.ts:518-523` propagates commit failure into browser completion, so success/failure is observable beyond the store. This does not prove that a failed browser answer was actually replayed by a real client.

**Concrete change:** extract `rolling-checkpoint-format.ts` (schema/hash/stream) and `rolling-checkpoint-projection.ts` (one pure boundary/parent/current-input analysis plus projection). Keep `rolling-checkpoint.ts` as compatible public facade/store owner. Build a candidate map without mutating the shared backend; for disk-backed commits, acquire the existing lock, merge latest disk state with the candidate, write atomically, then publish the successful map. For memory-only stores, publish directly. Preserve existing path canonicalization, strict parsing, TTL/cap, route model/options restoration and exact revision assertion. Preserve current failure propagation; swallowing storage errors would be a separate behavior decision. No file-format migration or new authority is needed.

**Owned write set:** `rolling-checkpoint.ts`, the two new modules, `tests/rolling-checkpoint.test.ts`. This is disjoint from F1/F2 except lane ownership. No change to shared filesystem helpers, parser, environment, prompt or browser-worker; compatibility exports keep their wiring stable.

**Smallest verification:** one injected pre-replacement write failure with a valid committed predecessor: prove the candidate reached persistence, assert rejection and unchanged durable bytes, restore I/O, then assert failed candidate is not applicable and a later successful commit does not resurrect it. Reuse selected existing split-marker, exact-parent/current-turn and canonical-prefix cases after extraction. Max **30 seconds per focused command**, injected failure rather than a real five-second lock wait.

## Acceptance and integration boundary

Recommend all three as one coherent lane-08 implementation assignment. F1/F2 share files and must not be split across writers. No worthwhile standalone changes found in `resource-budgets.ts`, `input-tokens.ts`, `compaction-model-config.ts` or the small execution policy: do not enlarge scope merely to touch them. Diagnostic SQLite checkpoints, continuation acceptance and one-shot transaction capabilities remain distinct contracts, not one generic checkpoint repository. No UI change is proposed from this backend-only lane. Parent owns final selection, exactly-16 implementation allocation, integrated build/UI plan, Git and publication.
