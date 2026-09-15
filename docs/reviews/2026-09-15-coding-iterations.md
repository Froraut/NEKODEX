# NEKODEX — three sixteen-Sol coding iterations

Baseline: f58398b42045a975556875431c6c8df1b09b92dd. Development version remains **5.2.0-nekodex.2**; no new binary release or installed-production replacement was requested in this code-iteration task.

## Outcome

All **48 newly spawned gpt-5.6-sol medium agents** completed across three sequential waves of sixteen. Each wave operated on the preceding wave's code. Every worker was closed before the next wave. Parent integrated cross-file wiring, handled compilation issues and ran the final focused verification.

The 21 E01–E21 findings from [the three-round review](2026-09-15-three-rounds-summary.md) have source-level repairs. Three optimizations were implemented: bounded delta/checkpoint continuation storage, coalesced metadata refreshes, and explicit update recheck with cooldown.

| Iteration | Approach | Workers changing code | Workers with no change | Worker-reported result | Review/implementation window |
| --- | --- | ---: | ---: | --- | --- |
| 1 | Localized fixes and targeted optimizations | 16 | 0 | All 21 original findings addressed; 3 optimization proposals implemented | 5m 08s |
| 2 | Failure-path correction of the new implementation | 11 | 5 | 20 localized corrections/defensive improvements across those areas | 6m 03s |
| 3 | Safe consolidation and remaining inconsistencies | 5 | 11 | 5 residual bugfixes; no forced cosmetic refactoring | 2m 11s |

The correction numbers are not additive counts of new unique bugs. Several address another callsite or ordering in the same E finding. Timing includes coordinator review/collection, not summed model compute. It excludes the final parent verification and publication. Token usage and monetary cost were not exposed.

Source changes excluding review documents touched 28 paths in iteration 1, 15 in iteration 2 (including a new focused test file), and 6 in iteration 3 (including the updated UI fixture). Lines changed and files touched are work-size indicators, not correctness or speed scores.

## Iteration checkpoints

- **032c327eb922dbb68c1d85894b9ffff61147c36e** — localized repairs and optimization implementation.
- **c06307c1fd20994f168dd129dc4585ab981947eb** — failure-path corrections and UI/controller integration.
- This document and [wave 3](2026-09-15-coding-wave-3.md) are committed with the final iteration. Its commit is reported in the task handoff.

Raw worker reports: [wave 1](2026-09-15-coding-wave-1.md), [wave 2](2026-09-15-coding-wave-2.md), [wave 3](2026-09-15-coding-wave-3.md).

## Final implementation map

- **E01/E11:** unresolved helper trace IDs remain reserved until acknowledged cleanup or actual exit; Send activation uses request identity and abort guards on both sides.
- **E02/E09/E17/E19:** capacity exemption uses exact reuse rules; simultaneous conversation ownership is excluded in automatic and Manual paths; account-add rollback protects already-acquired tabs; failed inspections cannot leave stale evidence silently usable.
- **E03/E04/E12:** rollback recognizes unchanged pre-write config; DEV validates before writing and compensates owned changes; managed keys check expected-before bytes. Compensation does not replace uncertain external edits or files still used by validation runtime.
- **E05/E18:** initial startup has cancellation/settlement ownership; failure continuations and state publication are fenced once Quit begins, including preliminary startup operations.
- **E06:** attached-session removals use retryable acknowledged release obligations, including clear/prune/interruption. Missing callbacks do not imply release success; a late preservation request joins an in-flight release obligation.
- **E07/E14:** unresolved file_id-only tool images are explicitly rejected; recognized tool_search call/output shapes require usable IDs before history projection.
- **E08/E15:** old verification marker is invalidated before state replacement; uncertain launch closure preserves its profile; browser/context/page acquisition failures retain or close the correct handles.
- **E10:** installers select exact platform/architecture assets from at most ten published releases and keep checksum verification.
- **E13:** thread environment state stages changes, persists and only then publishes the map; TTL deletion follows the same rule.
- **E16:** push rename classification includes both source and destination.
- **E20:** complete staged artifacts are validated and copied before swapping output; prior output is recoverable after an interrupted swap; symlink output directories and inherited distributable symlinks are handled safely.
- **E21:** cached compaction checks interruption at lookup and again after awaiting summary before publishing it.
- **O01 history:** bounded delta links, at most seven before a self-contained checkpoint; persisted version-1 snapshots remain self-contained; ancestor references count toward memory bounds.
- **O02 snapshots:** completion refreshes coalesce, while setup and verification lifecycle differences preserve final credentials/state and guard stale replies.
- **O03 updates:** recheck IPC/preload/type/UI are connected; concurrent calls coalesce, checks have a completion-based cooldown, installation state and original errors survive temporary-directory failures.

## Verification performed

The shared budget was reserved for parent; workers performed manual source/diff review and did not run suites.

Five named tests in tests/coding-iterations-focused.test.ts passed:
1. Invalid tool-image/search-history shapes reject explicitly.
2. Interrupted successful compaction cannot replay its cached summary.
3. Delta history remains exact across checkpoint rollover and a self-contained disk snapshot.
4. Failed environment persistence leaves prior in-memory authority intact.
5. Update recheck coalesces concurrent calls and respects completion cooldown.

Backend and renderer typechecks passed at integration checkpoints and on final source. Iteration 1 initially exposed DEV closure-narrowing types and old compaction fixture calls; parent corrected those integration issues before its commit. Total observed test/typecheck command time was about 13 seconds, below the shared 60-second limit. No full package/repository suite or large fault-injection pipeline ran.

The renderer production bundle was built for local UI verification. The credential-free loopback fixture initially lacked the now-required browserCapacity snapshot field; parent updated that fixture and retried only the failed UI scenario. The current renderer displayed Check for updates; clicking it produced a disabled Check again in a minute action. This verifies renderer feedback against the fixture, not a live GitHub update or Electron IPC round trip. The temporary browser tab and both task-owned fixture server instances were closed.

## Which approach was most useful

These were sequential dependent iterations, not a controlled same-input benchmark. The data supports a workflow recommendation, not a universal ranking:

1. Localized repairs were necessary to cover the original scope quickly.
2. Failure-path review was the strongest quality-control step: 11 of 16 areas needed adjustment after the first implementation, including meaningful late-cancellation and rollback cases.
3. Broad consolidation had smaller marginal yield: 11 of 16 areas needed no source change; five narrow fixes were useful, but broad refactoring was not justified.

For future small changes, prefer localized implementation followed by 4–6 risk-focused reviewers, then only the necessary final integration check. Use sixteen scopes again for a large architectural change. Fix shared lifecycle/transaction rules, not a growing list of independent guards. Keep the E-ID ledger and explicit counterevidence; no-change outcomes are valid.

No application speedup percentage is claimed. Delta storage and coalescing remove identifiable repeated work, but long-history latency, heap use and IPC rates have not been benchmarked. Before performance claims, compare 1–3 representative workloads within the existing small measurement budget.

## Remaining limits

- Real Playwright close failures, all concurrent process/file interleavings, Windows installation and live model/connector combinations were not fault-injected.
- A compare-to-write gap remains without cooperating cross-process locks. Unknown profile writes and unfinished validation-runtime cleanup are retained for manual recovery rather than overwritten.
- Compatibility of legacy acknowledgement frames without request IDs cannot provide the full stale-message guarantees of the current matched helper/client pair.
- The published .1 release and its old repository trust identity remain immutable; the documented manual transition still applies to a future signed .2 release.
- No release build, signing/notarization, deployment, production restart or installed-app update was performed in these three coding iterations.
