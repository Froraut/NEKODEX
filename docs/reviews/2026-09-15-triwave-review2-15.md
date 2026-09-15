# NEKODEX — triwave review 2, lane 15: tunnel lifecycle

Baseline: `3740505b0107af9a83053fd523ae1ad30be36465` (`HEAD`). Read-only manual source review of `launcher/electron/runtime-supervisor.cjs`, its direct start/monitor/stop/shutdown callers, `launcher/electron/process-tree.cjs`, the tunnel helper, wave-one lane 15, and the adjudicated four-wave ledger/results. No tests, typechecks, scripts, broad audits, runtime/production actions, code edits, or commits. This report is the sole new artifact. Native4, Native4 DEV, Zero Risk4 identities and their public ABI remain untouched.

## New concrete source path, same root as wave one (1)

### T2-15-1 — A tunnel control pipe error bypasses the bounded termination sequence

- **Trigger:** An already spawned `tunnel-client` control command has a `child.stdout` or `child.stderr` stream error before the child exits. This can occur independently of the command deadline during local inventory/status, managed connect, or stop; it does not require the child to survive SIGKILL.
- **Exact source path:** `runTunnelCommand` creates the child at `runtime-supervisor.cjs:1794-1808`. Its pipe-error handler at `:1899-1909` sets `settled = true`, clears the timeout/abort/force timers, requests `terminateOwnedProcessTree(child)` once with default SIGTERM, ignores a termination exception, and rejects immediately. The `exit` handler at `:1918-1944` returns without cleanup when `settled` is already true. No supervisor-owned control-child field, exit wait, or later force-kill obligation exists. In contrast, timeout/abort at `:1832-1893` schedule a SIGKILL and bounded wait, and a timed-out child that exits at `:1922-1931` receives a final process-group SIGKILL.
- **Direct callers/consequence:** Health/inventory reads at `:671-682`, discovery at `:851-860`, startup stop/connect at `:1074-1094`, and graceful shutdown at `:1725-1755` all use this helper. A child that ignores SIGTERM or whose process-group termination request fails can remain live after the caller has received a pipe failure. Startup failure cleanup may issue another stop at `:1099-1117`; shutdown may retry/force stop at `:2292-2328`. Those commands can overlap the unresolved first control command. The exact leaked object is the *control child/process group*, not necessarily the managed tunnel alias.
- **Counterevidence and priority:** Normal pipe behavior and normal child exit avoid the trigger. On POSIX, `terminateOwnedProcessTree` signals the detached group; on Windows it runs forced `taskkill /T /F` (`process-tree.cjs:17-52`), so a surviving Windows child needs failure of that operation. The `exit` listener remains attached in Node, but after settlement it cannot perform further cleanup. This is source-provable conditional behavior, not a reproduced leaked process. The correction is to retain the exact control child until observed exit/close and use the same bounded escalation on pipe failure, preserving the pipe error as primary diagnostic.
- **Deduplication:** `T1-15-1` already identified missing retained ownership after the timeout/abort force deadline. `T2-15-1` is a newly traced, shorter entry path into that same ownership root; it is **not an additional independent defect**. D16 concerns the separate browser-helper verifier child, and D07 concerns journal hook reads.

## Challenge to the first-wave report

`T1-15-1` is supportable only as a conditional unresolved-child path. Its wording that the child has no later *exit/close settlement* is too broad: the Node `exit` listener still exists and can fire after the promise rejects, although `settled` prevents it from acting. The forced timeout/abort branches first request termination, then SIGKILL; ordinary exit before the final deadline settles through `:1918-1931` and requests one last process-group kill. Thus the normal timeout is not itself an orphan. The actionable gap is that after the final rejection the supervisor has no registry, wait, or reconciliation obligation for a child still alive. The wave-one suggestion to serialize later alias operations is reasonable hardening, but its claimed resource/operation races remain consequences conditional on a lingering child, not observed facts.

The four-wave adjudication's D07 (`four-wave-adjudication.md`) was about a different journal-read ownership path and is repaired in the current results. D16's retained browser-helper child is analogous lifecycle design, not proof that a tunnel child has leaked. Neither is a new lane-15 tunnel finding.

## Known limits and optional work

- **Known limit:** `observeTunnelForMonitor` at `runtime-supervisor.cjs:957-975` uses fully observed loopback health before native inventory. The endpoint is discovered/reset around managed acquisition (`:719-720,851-882,1055-1056`), and `readLocalTunnelHealth` rejects a dead known PID (`:913-925`). A false positive would require a stale/reused loopback endpoint or a missing PID plus another actor serving matching health and logs. This review found no current-build transition proving that actor, so it is not a second defect.
- **Optional:** A per-alias control-operation queue could simplify overlap and later reconciliation. Output capture is already bounded at 1 MiB per stream (`:1813-1820`); expanding diagnostics is not needed for the ownership correction.
- **ABI boundary:** The proposed lifecycle correction concerns child handles, waits, and diagnostics only. It requires no change to connector names, App IDs, tunnel profile command contract, or public Native4/Zero Risk4 tool schemas.

## Counts and verification handoff

- New concrete source paths: **1** (`T2-15-1`), **0 new independent roots** after deduplication with `T1-15-1`.
- First-wave findings narrowed: **1** (`T1-15-1`); outright rejected: **0**.
- Adjudicated repeats: **1** (D07, not a current tunnel defect).
- Known limits: **1**; optional improvements: **1**; overclaimed stale-endpoint candidates rejected: **1**.
- Executable checks in this lane: **0**. The parent owns the single final focused verification pass, at most 60 seconds and ten expanded scenarios across the task.
