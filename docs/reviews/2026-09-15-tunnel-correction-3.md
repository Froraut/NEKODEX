# Tunnel correction run 3 — 2026-09-15

Baseline: uncommitted run-2 tunnel changes on `359d8fc000d73b32497cf6465fbd3cd1998d3a14`. Final narrow manual review found **0 new unique defects**, **0 further T03 refinements** and **0 independent optimizations**. No source code or tests were changed in this run. Two review documents were clarified, and this report was added. No tests, typecheck, service command, installation, dependency action, production mutation or commit.

## Final changed-path review

- **T01:** `readBoundedResponse` checks declared length after acquiring a reader so rejection requests cancellation. It checks each chunk before adding it to the aggregate, copies no more than the cap into the final array, and releases the reader lock on success/error. The size-error path aborts `fetch`; the download timer spans body consumption. A single large incoming chunk and roughly double bounded peak memory during the final copy remain stated limits, not a newly proven defect.
- **T02:** the locked `fflate@0.8.3` `unzipSync` filter runs before materializing a selected file. The filter rejects unsafe paths, duplicate expected basenames and excessive entry count; it checks declared output size before inflation and validates resulting length. The release archive hash, binary hash manifest and staged `--version` check remain in the install path. No new concrete failure path was established from the selected-member extraction.
- **T03:** ordinary `getTunnelServiceStatus()` probes have a 5-second command timeout. The unload-poll loop checks remaining time before each probe, caps its timeout and sleep to that remainder, and performs no probe after its deadline. `runCommand` throws on process timeout, so a timed-out print is not classified as unloaded. `stopTunnelService()` also performs initial status inspection, `bootout` and final status read; its total duration is not claimed to be 20 seconds.

Direct callers reviewed in scope: setup profile bootstrap/rollback and service migration in `src/setup.ts`; tunnel stop/restart/status and uninstall in `src/cli.ts`; tunnel runtime and service reporting in `src/doctor.ts`; DEV attach readiness in `src/dev-chat/transport.ts`; timeout propagation in `src/process.ts`. Existing key/profile compensation caveats and earlier E/B findings were not recounted. The other upstream researchers' paths were not inspected or changed.

## Documentation and validation handoff

[Tunnel research](2026-09-15-tunnel-research.md) now says the three selected findings were all authorized together for **run 1**, with runs 2/3 reviewing that implementation. It also limits T03's 20-second claim to the unload-poll phase. [Run 1](2026-09-15-tunnel-correction-1.md) now counts three findings addressed while distinguishing T03's initial per-probe correction from the deadline edge fixed in run 2. No third test was added; the existing two named cases in `tests/tunnel-improvements-focused.test.ts` remain unexecuted. Parent plans minimal development `tsc` plus those two focused cases within the standing shared budget; any failure should be corrected only in the failed path.

## Timing and files

Run 3 began **16:49:48 UTC**; manual review and document clarification were complete **16:50:31 UTC** (about **43 seconds** elapsed before this report). This is wall-clock review/edit time, not automated check time or model compute. Code paths inspected: `src/tunnel.ts`, `src/tunnel-service.ts`, `src/setup.ts`, `src/cli.ts`, `src/doctor.ts`, `src/dev-chat/transport.ts`, `src/process.ts`, plus the two-case test and local `fflate` API/implementation already examined in run 2. Edited only `docs/reviews/2026-09-15-tunnel-research.md`, `docs/reviews/2026-09-15-tunnel-correction-1.md` and this report.
