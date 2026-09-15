# NEKODEX — three sequential sixteen-Sol reviews

## Scope and counting

Frozen source: **258d89c2a4274e66faf8d6d7ee437a7ce64b23c4**, development version 5.2.0-nekodex.2.
All 48 agents were newly spawned as **gpt-5.6-sol, medium**: 16 in round 1, then 16 in round 2, then 16 in round 3. Every report was collected; every agent was closed before the next round began.

Rounds 2 and 3 received the preceding same-scope findings and were asked to challenge direct callers/guards and inspect additional failure paths. This is an informed iterative review, not three blind independent experiments. No runtime source changed between rounds. No tests, benchmark requests, app restarts, packaging or live-account traffic were run.

“Accepted error” means a specific source-level path supports an unintended outcome under its stated trigger. It does **not** mean a live failure was reproduced. Some triggers require I/O failure, concurrent authenticated API requests, older platform releases, or unusual cancellation history. Confidence and these limits are retained in the raw reports.

Deduplication uses root cause plus repair: clear/prune/native-interrupt removal without retained release is one error at multiple callsites. Finding the same code again does not add another error. Clean-area assessments are not bug findings, even when a later reviewer marks a prior clean assessment “refute.”

## Results per run

| Run | Sol agents completed | Newly proposed bug candidates | Accepted new unique errors | Earlier unique errors reconfirmed | Accepted unique errors covered in run | New optimization proposals | Elapsed review window |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | 16 | 11 | **10** | 0 | 10 | 3 | 2m 28s |
| 2 | 16 | 8 | **6** | 10 | 16 | 0 | 2m 53s |
| 3 | 16 | 6 | **5** | 16 | 21 | 0 | 2m 39s |

**Total: 21 unique accepted source-level errors and 3 unique optimization proposals.**
The 10/16/21 coverage column must not be summed: it contains repeats. New errors are 10+6+5.
Timing is coordinator wall-clock from dispatch completion through collection/closure; it includes some parent integration time, not summed model compute. Token usage and monetary cost were not exposed, so no cost comparison is claimed.

Raw reports:
- [Round 1](2026-09-15-three-rounds-1.md)
- [Round 2](2026-09-15-three-rounds-2.md)
- [Round 3](2026-09-15-three-rounds-3.md)

## Accepted errors

All priorities below are P2: actionable reliability/consistency defects under stated triggers, without a demonstrated current production incident.

| Canonical ID | First run / reviewer claim | Location | Supported failure and repair direction |
| --- | --- | --- | --- |
| E01 | 1 / IPC-R1-01 | src/adapters/chatgpt-web/launcher-helper-client.ts:614 | Abort cannot be delivered within its deadline; launcher forgets the turn while helper still owns its trace ID. A same-ID retry can collide. Preserve a helper acknowledgement/ID reservation until physical cleanup, with bounded failure handling. |
| E02 | 1 / R1-2-B01 | launcher/electron/account-pool.cjs:269 | Pool capacity exempts a matching conversation key even when host status/connector rules cannot reuse its tab. An authenticated new-tab acquisition can exceed the global limit while a per-host slot is available. Base the exemption on exact reusable tab identity. |
| E03 | 1 / S4-01 | src/setup.ts:752 | Config save fails before replacement; catch mistakes the unchanged original bytes for a concurrent edit and suppresses key/client/tunnel compensation. Accept the unchanged pre-write snapshot or record successful write completion. |
| E04 | 1 / S4-02 | src/setup.ts:880 | DEV tunnel setup writes key/client before validating later inputs and has no equivalent transaction compensation. Validate first and extend bounded owned-write rollback to DEV. Production profile remains separate. |
| E05 | 1 / R1-5-01 | launcher/electron/runtime-supervisor.cjs:2121 | Stop waits on initial startPromise before bounded recovery settlement; initial startup's tunnel command has no cancellation signal. Shutdown can wait through its command timeout/cleanup. Give initial startup cancellation and settlement ownership too. |
| E06 | 1 / R1-6-01; extended in 2 / R2-6-01 | src/adapters/chatgpt-web/turn-execution.ts:925,992 | clear, TTL prune and exact interruption can forget attached retained sessions without creating a Launcher release obligation. Route all attached-session removals through acknowledged release; count this invariant once across entrypoints. |
| E07 | 1 / R1-8-01 | src/responses/parser.ts:254 | Accepted file_id-only images in tool results fall through projection and can produce an empty result. Preserve an explicit reference or reject the unsupported shape. |
| E08 | 1 / R1-11-02 | src/browser-login.ts:481 | Repeat login replaces storage before writing a new marker; marker-write failure leaves old verification metadata accepted with new bytes. The new state was already inspected, so this is stale metadata, not proof of unauthenticated access. Invalidate or transactionally bind the marker. |
| E09 | 1 / R1-13-01 | launcher/electron/account-pool.cjs:125 | addAccount commits metadata before host readiness; a readiness failure restores selection but leaves the new account saved while UI reports failure. Roll back the new record when safe or return an explicit partial-success state and refresh it. |
| E10 | 1 / R1-14-B1 | scripts/install-launcher.ps1:37; install-launcher.sh:38 | Default installer chooses newest release without checking target-platform assets. A macOS-only release hides an older usable Windows/Linux release. Filter a bounded release list by required asset and report no-platform-release explicitly. |
| E11 | 2 / IPC-R2-01 | src/adapters/chatgpt-web/launcher-helper-client.ts:515 | Send acknowledgement can be emitted after abort removed its waiter; same-ID acknowledgement error races the intended abort result. Check abort state and handle already-aborted waiters idempotently. |
| E12 | 2 / S4-03 | src/setup.ts:588; src/tunnel.ts:272 | Runtime key is snapshotted then replaced without validating expected-before bytes at its mutation boundary. An intervening edit can be overwritten and rollback can restore an even older value. Use owned conditional-write/serialization policy. |
| E13 | 2 / R2-7-01 | src/adapters/chatgpt-web/thread-environment.ts:243 | set/TTL removal publish an in-memory authority change before persistence succeeds; failed writes leave memory and restart state divergent. Stage/persist/publish or restore memory on failure. |
| E14 | 2 / R2-8-01 | src/responses/parser.ts:535 | Recognized tool_search types use the generic unknown-item schema; missing pairing IDs become empty IDs in emitted history. Validate their recognized shapes and reject empty pairing IDs. |
| E15 | 2 / R2-11-01 | src/adapters/chatgpt-web/browser-worker.ts:2386 | Browser launch succeeds but newContext fails before this.browser is assigned. The local browser handle is lost to close(). Close the local browser on partial acquisition failure. |
| E16 | 2 / push-rename-loses-mapped-source | scripts/focused-pr-check.ts:78 | Push rename detection reports only destination names; mapped source renamed to metadata can lose its behavior/manual-review classification. Include source and destination, as PR handling already does. |
| E17 | 3 / R3-2-B01 | launcher/electron/browser-host.cjs:2353 | Host's authenticated start boundary accepts different trace IDs for the same running conversation key and can create duplicate retained tabs. Normal adapter owner serialization reduces exposure; this finding is scoped to the host/API invariant, not a demonstrated normal UI race. Reject conflicting live conversation-key ownership. |
| E18 | 3 / R3-5-01 | launcher/electron/main.cjs:1428 | Detached startup-failure continuation may begin route restoration after Quit passed its operation check. Existing pending connection is guarded, but newly starting failure cleanup is not coordinated. Fence or join failure cleanup into shutdown before spawning commands/updating state. |
| E19 | 3 / R3-13-01 | launcher/electron/account-pool.cjs:154 | Check account clears capabilities before busy-host inspection rejects; no resulting snapshot is published and failed UI action does not refresh. Reject conflicts before invalidating evidence or publish consistent invalidation on failure. |
| E20 | 3 / package-removes-previous-artifacts-before-validating-staging | launcher/scripts/package.cjs:150 | Existing local artifacts are removed before the general no-distributable check/copy. An empty-success staging output can erase the fallback artifact set. macOS has earlier ZIP validation, reducing this exact path there; validate complete staged output before swapping artifact directories. This is not deletion of published release assets. |
| E21 | 3 / reviewer 16, canonical R3-compaction-cache-interruption | src/adapters/chatgpt-web/compaction-handoff.ts:474 | Cached successful compaction bypasses interruption checks. After the HTTP interruption map evicts that identity at 1,024 entries, replay before the 30-minute cache expiry can return it despite the structured-compaction interruption record. Check cancellation at cache lookups and align retention. Rare history; no new tool execution or live reproduction asserted. |

## Candidates excluded from error counts

1. **R1-11-01, partial persistent-context launch:** missing local attempted-launch guard is real, but whether Playwright can leave Chrome alive after rejection was not established. Round 3 correctly marked it uncertain. Counted in neither the 10 nor the later repeats.
2. **R2-5-01, Quit during bridge connection:** refuted for its stated trigger. runtime.cjs:973 sets lifecycleOperation before its first await, and main.cjs:1001 refuses Quit while that operation is active. E18 is a different failure-continuation ordering.
3. **R2-6-01, TTL prune release:** valid additional callsite of E06, not a new root cause. Third-round exact native interruption inspection also extends E06.
4. **S4-04, final config compare-to-write gap:** an already documented limitation of non-atomic cross-process file comparison. Moving the same comparison closer does not eliminate the gap. A shared lock or transactional filesystem contract is a design improvement, not counted as a newly discovered defect.

## How to make NEKODEX more efficient

### Three code-supported proposals

1. **Avoid repeatedly copying and serializing full continuation history** (responses/state.ts:188,225). Store turn deltas with periodic self-contained checkpoints; materialize history only on replay. Preserve TTL/eviction behavior and avoid dangling parent links when large entries are omitted from disk snapshots. Expected benefit is less allocation and serialization work on long tasks; no end-to-end speedup was measured.
2. **Coalesce completed-operation metadata refreshes** (launcher/src/App.tsx:69,102). Request only state/credential/capability fields, or coalesce duplicate completion and explicit-verification refreshes. Keep credential correctness and current generation guards. A full browser/log snapshot is unnecessary when only these fields are applied.
3. **Allow explicit update recheck with a cooldown** (launcher/electron/update.cjs:397). An initial failed check currently remains checked for the process lifetime. A user-triggered refresh avoids app restart and continuous polling. This is availability/interaction efficiency, not measured CPU performance.

### Reduce repeated reliability defects

The strongest shared cause is partial lifecycle state publication:
- one owned acquisition/release abstraction for browser, context, tab and helper handles;
- one transaction helper for prepare → validate → commit → compensate, recording exact expected bytes and success state;
- one rule for retained-session removal, so clear/prune/interrupt cannot diverge;
- one validator for every recognized protocol item, with explicitly separate unknown extensions;
- one startup/shutdown owner covering both successful startup and detached failure continuations.

These are targeted consolidation directions, not a recommendation to add a new framework or rewrite the application.

## Make future review cheaper and more useful

- This fixed-code experiment found 10, 6 and 5 new accepted errors per 16-agent round: **0.63, 0.38 and 0.31 new errors per reviewer**. That is review yield, not a benchmark of model quality or application speed.
- In round 3, 16 of 21 covered unique errors were repeats. Repeating all 16 scopes without fixing the baseline increasingly spends work on reconfirmation.
- Next use one broad 16-scope pass, then 4–6 focused reviewers for new/changed high-risk paths and a small adjudication pass. Do not automatically launch this plan; delegation still requires authorization.
- Give each reviewer one invariant and concrete failure matrix: before acquisition, after acquisition/before commit, cancellation, timeout, rollback, retry, shutdown. Include direct callers and known guards.
- Keep an ID-based finding ledger with trigger, exact evidence, counterevidence, proposed repair, confidence, reproduction status and duplicate-of. A clean report is valid; never reward a quota of bugs.
- Fix by root cause, then review the changed callsites on a new commit. Record that new baseline rather than comparing incompatible snapshots.
- For implementation verification use 1–5 exact regression cases and at most the existing shared budget. Measure 1–3 representative long-history/refresh workloads before claiming performance gains. Do not run a broad suite to turn static review into apparent certainty.

No fixes or runtime performance measurements are part of these three review rounds. The installed app and published release are unchanged.
