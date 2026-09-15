# NEKODEX — triwave review 3, lane 15: tunnel lifecycle

Baseline: `3740505b0107af9a83053fd523ae1ad30be36465` (`HEAD`). Read-only final adversarial pass over the current tunnel lifecycle source, wave1 lane 15, wave2 lane 15, and the direct startup/shutdown paths. No tests, typechecks, scripts, broad audits, runtime/production actions, code edits, or commits were performed. Native4, Native4 DEV, ZeroRisk4, and the public ABI remain untouched.

## Final disposition

One new concrete cross-scope path is accepted. It is separate from the unresolved control-child ownership root in T1-15-1/T2-15-1 because it concerns cancellation propagation and shutdown settlement during stale-owner recovery, even when every control child eventually exits normally.

### T3-15-1 — Stale-owner tunnel recovery ignores startup cancellation during probe and stop

- **Trigger:** `startConfigured(startSignal)` is recovering a same-boot or version-mismatched stale runtime, the configured mode is `full`, and `stopStaleOwnedRuntime(config, startSignal)` has reached the tunnel branch. Shutdown or another cancellation aborts `startSignal` while stale tunnel status is being inspected or while the stale tunnel is being stopped.
- **Exact source path:** `startConfigured` passes the signal at `runtime-supervisor.cjs:1333` and `:1360`. The method checks it before/after some work, but the tunnel branch calls `waitForKnownTunnelStatus(config)` without `startSignal` at `:1973-1977`. If the tunnel is considered live, it then calls `runTunnelStopCommand(config)` without the signal at `:2029-2035`; `runTunnelStopCommand` therefore cannot activate `runTunnelCommand`'s abort path. The later `assertCanStart(startSignal)` at `:2030` is only a pre-call check and does not protect the in-flight stop from a concurrent abort.
- **Cross-scope consequence:** The cancelled startup can continue native tunnel inventory and issue a tunnel stop after shutdown has begun. `settleInitialStart()` gives the pending starter only `RECOVERY_SHUTDOWN_SETTLEMENT_MS = 3_000` at `:23` and `:1472-1485`; the tunnel control/probe paths have 5–10 second deadlines and can exceed that bound. Shutdown can therefore enter forced cleanup while stale-owner recovery still owns an in-flight tunnel operation. The later stale-recovery `clearState()` at `:2038` can also race the shutdown's ownership/state decision. This is a cancellation/settlement ordering defect, not merely a lingering child after forced termination.
- **Counterevidence / limits:** The signal is correctly propagated through ordinary managed start/recovery (`startTunnel` → status, pre-start stop, wait, and health paths), and the final `assertCanStart` prevents normal continuation after a completed cancelled operation. This finding requires cancellation during the specific stale-owner tunnel branch. It does not claim that every shutdown leaves a live tunnel or that the native manager ignores the stop; the defect is that the launcher permits the operation to continue past its own cancellation/settlement contract.
- **Minimum correction direction:** Pass `startSignal` through the stale-owner tunnel status and stop calls, and ensure the stale-owner tunnel branch uses the same cancellation contract as ordinary startup. Preserve the existing verified-owner checks and Native4/Native4 DEV/ZeroRisk4 ABI.

## Confirmed / rejected candidates

- **Confirmed:** T3-15-1 above. This is the only new independent root found in the final pass.
- **Confirmed but repeat/refinement:** T1-15-1 remains a conditional unresolved control-child ownership root. T2-15-1 remains a pipe-error entry path into that same root. `onOutputError` at `runtime-supervisor.cjs:1899-1907` still settles immediately after one termination request, but that is not a new ID here.
- **Refinement, no new ID:** `stopTunnelGracefully` restarts the monitor after a stop command error or an unconfirmed stopped state (`:1735-1753`). If the command is the unresolved control-child case, a monitor probe may overlap the unresolved command; this is a consequence of T1/T2's retained-child gap, not a separate monitor root.
- **Rejected:** stale loopback health or alias reuse as a new defect. Current code resets/discovers the endpoint around managed acquisition, checks the managed PID where available, and falls back to native inventory (`:907-975`, `:1055-1056`); no current-source transition proves an independent actor serving matching health.
- **Rejected:** normal timeout as automatic orphaning. The timeout/abort paths request SIGTERM, then SIGKILL, and the ordinary `exit` listener remains attached (`:1832-1893`, `:1918-1931`). The actionable gap is only the post-rejection ownership/reconciliation obligation already counted by T1/T2.
- **Rejected:** public identity or ABI interaction. No tunnel lifecycle path reviewed here changes connector names, App IDs, tool schemas, or ABI pins.

## Parent final focused handoff (maximum 10 scenarios)

Use at most these six source-focused scenarios within the shared final 60-second budget:

1. Cancel startup while `stopStaleOwnedRuntime` is waiting on tunnel inventory: verify the status control receives cancellation and no later stale recovery continuation occurs.
2. Cancel startup after stale inventory reports a live tunnel but before stale `runtimes stop`: verify no stop is launched after the cancellation boundary.
3. Let a normal managed connect command time out and exit after SIGTERM/SIGKILL: verify existing bounded behavior remains unchanged.
4. Force a control stdout/stderr pipe error while the child remains alive: verify the retained-child/cleanup correction covers the T2 entry path.
5. Fail graceful tunnel stop and observe monitor restart: verify monitor generation and control-child ownership do not create a second unowned operation.
6. Shutdown during tunnel recovery and then force-stop: verify ownership state is not cleared by stale recovery after force-stop has taken control.

## Counts

- New concrete findings: **1** (`T3-15-1`)
- New independent roots beyond wave1/wave2: **1**
- Repeats/refinements: **2** (T1-15-1/T2-15-1 control-child ownership; monitor-overlap consequence)
- Rejected/known/optional candidates: **3**
- Verification actions: **0** tests, **0** typechecks, **0** scripts, **0** runtime/production actions
- Native4 / Native4 DEV / ZeroRisk4 and public ABI: **preserved**
