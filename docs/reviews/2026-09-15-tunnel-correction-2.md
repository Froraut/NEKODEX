# Tunnel correction run 2 — 2026-09-15

Baseline: run 1's uncommitted changes on `359d8fc000d73b32497cf6465fbd3cd1998d3a14`. This run revised only `src/tunnel-service.ts` and wrote this report. No tests, typecheck, service commands, network fetch, installation, dependency changes, production mutations or commit.

## Result and counts

**New unique defects found in run-1 T01/T02 failure paths: 0.** **Refinements to known T03: 1.** No independent optimization was made. This does not claim exhaustive archive/network correctness or a live macOS service result.

The known T03 deadline edge was that `waitForTunnelServiceUnloaded()` started a `launchctl print` before checking the deadline, then made a final print after it. Even with run 1's 5-second per-print timeout, these probes could overrun the intended 20-second polling window. The loop now checks positive remaining time before each probe, passes `min(5 seconds, remaining)` to `getTunnelServiceStatus()`, sleeps no longer than remaining time and throws at expiry without a post-deadline probe. `runCommand` still throws on `ETIMEDOUT`; ordinary nonzero `launchctl print` retains its existing unloaded meaning. The 20-second window describes only the unload-poll phase. Initial status inspection, `bootout`, and `stopTunnelService()`'s final status read are outside that phase.

## Scoped source re-review

- T01: reviewed declared-length rejection, body chunk count, final bounded copy, size-error cancellation/abort, timeout propagation and reader-lock release. No new concrete failure path established. The single arriving chunk can already exist in memory before its size is checked, as reported in run 1.
- T02: reviewed filter timing against local locked `fflate@0.8.3` implementation. It invokes the filter before materializing each selected member; deflate allocates from the checked `originalSize`. Unsafe paths, duplicate executable basenames and entry count are checked in the filter; hash/version checks still happen before install. No new concrete failure path established. Parsing malformed central-directory metadata and archive CPU remain practical limits, not proven new regressions.
- T03: reviewed `src/process.ts`'s timeout throw and direct `stopTunnelService()`/CLI/setup callers. A timed-out print cannot be reported as an unloaded service. The total stop command is not asserted to complete in 20 seconds.

The two already added named cases in `tests/tunnel-improvements-focused.test.ts` remain unchanged and unexecuted. A third test was not added: a pure deadline/probe injection would require extra seams in the macOS command wrapper for little benefit in this local correction. Parent may run the two-case file within the standing shared 60-second/1–5-case budget and review the deadline branch manually. No live `launchctl` exercise is requested.

## Timing and scope

Run 2 began **16:47:36 UTC**; source edit and report draft completed **16:48:17 UTC** (about **41 seconds** elapsed). Timing is wall-clock coordination/review/edit time, not automated verification. Inspected changed slices of `src/tunnel.ts`, `src/tunnel-service.ts`, `src/process.ts`, the direct stop/setup/CLI call paths, the existing two-case test file and `fflate`'s local `unzipSync` implementation. No broader repository review. Run 3 should inspect this implementation for remaining concrete failure paths and may correctly report no source change.
