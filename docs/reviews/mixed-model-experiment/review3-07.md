# NEKODEX adjudication review3 — lane 7 supervisor

- Repository: `/Users/alex/Dev/nekodex`
- Baseline: `9925453bd51e61c7b398abec12ec0da3aca3d3af`
- Scope: `launcher/electron/runtime-supervisor.cjs`, direct callers as necessary, process-tree ownership helper
- Review inputs: `review1-07.md`, `review2-07.md`
- Method: manual source adjudication only; no source edits, tests, typechecks, automated audit, runtime actions, commits, delegation, or ABI/name changes

## Result

Review1 has three accepted, unique actionable roots. Review2 has no numbered claim and its zero-findings conclusion is rejected because the three review1 behaviors remain directly visible in the baseline source. No additional defects were added.

Counts:

- Accepted: 3
- Rejected: 1 report-level zero-findings conclusion
- Design-limit: 0 numbered claims
- Accepted roots: 3
- Additional defects: 0

## Claim adjudication

### Review1 claim 1 — accepted

**Claim:** `runTunnelCommand` can execute commands in provider-completion order rather than invocation order when proxy-environment resolution overlaps.

**Verdict:** accepted. At `runtime-supervisor.cjs:1796-1805`, the method awaits `tunnelProxyEnvironmentProvider()` before reading the predecessor and assigning the successor promise. If invocation A is suspended in that provider and invocation B resolves first, B snapshots the old queue and installs its successor; A then snapshots B's successor. B can therefore spawn first. The later wait at `1817-1825` serializes the queue that each call observed, but cannot restore invocation order after the queue reservation was delayed.

This is a real ordering gap for direct callers including local tunnel inventory/status, managed connect, and stop. It is not an invented gateway envelope contract and does not depend on UI state.

Root: `L07-queue-reservation`.

### Review1 claim 2 — accepted

**Claim:** `stopChild` can issue a stale Unix process-group kill after the owned child has already settled.

**Verdict:** accepted. At `runtime-supervisor.cjs:2174-2189`, `waitForChildExit` resolves on either `exit` or `close`; after either event, `stopChild` unconditionally calls `terminateOwnedProcessTree(child, "SIGKILL")`. On Unix, `process-tree.cjs:17-51` uses `process.kill(-pid, signal)` and does not revalidate child identity or group ownership after settlement. A PID/process-group reuse between settlement and the final call can target an unrelated group. The normal pre-wait force branch does not remove the unsafe post-settlement call.

The race is narrow, but the missing ownership checkpoint is an actionable source-level defect, not a merely unavoidable scheduling race.

Root: `L07-post-settlement-kill`.

### Review1 claim 3 — accepted

**Claim:** forced shutdown does not cancel or directly settle an active non-recovery tunnel-control child.

**Verdict:** accepted. `cancelRecoveries()` at `runtime-supervisor.cjs:1444-1453` aborts only `startController` and `recoveryControllers`. `runTunnelCommand` receives no signal for ordinary stop/cleanup calls such as `stopTunnelGracefully`, stores those children in `tunnelControlChildren` at `1847`, and releases ownership only on `close` at `1932`. The force path at `2311-2387` never drains that set or initiates termination for its members; it can then enqueue another stop command at `2338` behind an unresolved control slot. The existing signal-driven cancellation of recovery children is valid counterevidence for recovery calls, but it does not cover these non-recovery children.

This can leave forced shutdown waiting on the original command's timeout/termination path or return partial cleanup while a locally owned control child remains unsettled. The fix must retain queue ownership until close and record non-settlement as partial cleanup.

Root: `L07-force-control-cancel`.

### Review2 zero-findings conclusion — rejected

Review2-07 contains no numbered claim to accept or reject, but its report-level conclusion of zero findings is rejected. Its own counterevidence confirms only the recovery-signal path and queue release after `close`; it does not address the provider-before-reservation interleaving, the unconditional post-settlement SIGKILL, or the un-signaled ordinary control child during force cleanup. The direct caller trace therefore does not invalidate the three accepted review1 claims.

## Design boundary

The supervisor cannot prove that an externally managed tunnel alias has stopped solely by terminating its local CLI control child. `waitForTunnelStopped` depends on the native runtime manager's status response and can leave external alias state unknown when that manager is unreachable or non-cooperating. Treating that outcome as failed/partial cleanup is the existing external-control boundary, not an additional defect. Public connector ABI and names remain unchanged.

## Essential fixes

1. Reserve the tunnel-control queue slot synchronously before awaiting proxy-environment resolution, while preserving cancelled-waiter slot ownership until the predecessor settles.
2. Remove the unconditional post-settlement group kill in `stopChild`, or perform a verified live identity/ownership check before any final kill.
3. Give every tunnel-control child a supervisor-owned cancellation/force path. During forced shutdown, initiate termination for all tracked children, wait for close settlement within the bounded cleanup policy, and report unresolved children as partial cleanup.
