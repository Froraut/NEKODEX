# Mixed-model experiment review 1-07 — supervisor

- Repository: `/Users/alex/Dev/nekodex`
- Baseline: `9925453`
- Review mode: manual source review only
- UTC start: `2026-09-15T20:28:26Z`
- UTC end: `2026-09-15T20:32:03Z`

## Inspected scope

Reviewed `launcher/electron/runtime-supervisor.cjs`, with only the direct Electron callers in `launcher/electron/main.cjs` and the ownership primitive used by the supervisor in `launcher/electron/process-tree.cjs`. The review focused on launcher-owned daemon/tunnel children, tunnel control-child serialization, cancellation, shutdown, and recovery ownership. I did not read other wave reports. No tests, typechecks, scripts, live actions, delegation, or source edits were performed.

## Findings

### 1. Tunnel-control queue is not FIFO when environment resolution overlaps

- Severity: High (P1 candidate)
- Classification: Current bug
- Exact location: `launcher/electron/runtime-supervisor.cjs:1796-1805`, `RuntimeSupervisor.runTunnelCommand`
- Trigger: Make `tunnelProxyEnvironmentProvider()` for command A remain pending, invoke a second `runTunnelCommand` for command B, and let B's provider resolve first. B snapshots the old `tunnelControlQueue` and installs its successor before A does. B therefore spawns and completes ahead of A even though A was invoked first.
- Impact: The queue serializes commands in provider-completion order rather than invocation order. A concurrent stop/connect/recovery or monitor command can execute in the wrong lifecycle order, so a later stop can precede an earlier connect, or a recovery command can act on state changed by a later command. This can leave the tunnel alias in an unexpected state while each individual command reports normally.
- Smallest fix: Reserve the queue slot synchronously before the first `await` in `runTunnelCommand`; resolve the proxy environment only after the command has acquired its predecessor slot. Preserve the existing abort handoff so a cancelled waiter keeps its slot closed until the predecessor releases it.
- Confidence: High. The ordering follows directly from the two separate `await` points and the queue assignment after the provider await; no external behavior assumption is needed.

### 2. `stopChild` can signal a reused process group after the owned child has exited

- Severity: High (P1 candidate on Unix)
- Classification: Current ownership bug
- Exact location: `launcher/electron/runtime-supervisor.cjs:2157-2190`, `RuntimeSupervisor.stopChild`; termination primitive at `launcher/electron/process-tree.cjs:17-51`
- Trigger: On a Unix host, let the owned detached child exit and let `waitForChildExit` resolve. Before line 2189 executes, arrange for the exited PID/process-group ID to be reused by an unrelated process group. The unconditional `terminateOwnedProcessTree(child, "SIGKILL")` then calls `process.kill(-pid, "SIGKILL")` without checking that the original child is still alive or that the group still belongs to it.
- Impact: A normal or forced shutdown can kill an unrelated process group after ownership of the original child has ended. The helper protects only the invalid-PID and Windows cases; on Unix it treats the stale numeric process-group ID as sufficient authority. This violates the supervisor's child-ownership boundary and can damage unrelated user work.
- Smallest fix: Remove the unconditional post-settlement SIGKILL, or guard it with a live-child/identity check and perform the final group kill only while the original child remains unsettled. The forced branch already sends SIGKILL before waiting for settlement; a second kill after settlement is unsafe.
- Confidence: High for the race. The exact PID-reuse window is narrow, but the code has no identity checkpoint after `waitForChildExit`, so the failure is executable under normal OS PID reuse.

### 3. Forced shutdown does not cancel active non-recovery tunnel-control children

- Severity: Medium-High (P1/P2 boundary)
- Classification: Current cancellation/ownership bug
- Exact location: `launcher/electron/runtime-supervisor.cjs:1832-1853`, `runTunnelCommand`; `tunnelControlChildren` is populated at line 1847; `forceStopOwnedRuntime` at `2311-2383` never drains or terminates that set
- Trigger: Start a tunnel control command through a path without a `recoverySignal` (for example, a monitor or ordinary shutdown control call), keep its native control child running, then enter `shutdown({ force: true })` after another shutdown failure. `cancelRecoveries()` aborts only `startController` and `recoveryControllers`; the active non-recovery child has no abort signal. `forceStopOwnedRuntime` stops the daemon and may enqueue another tunnel stop, but does not terminate the already-tracked control child.
- Impact: The force path is not actually bounded by its forced cleanup intent: it can remain behind the unresolved queue slot until the original command's ordinary timeout and termination delays complete, and a non-cooperating child can remain live while the method reports `forced-partial` or while the queued cleanup waits. The set that records ownership is not used as a force-cancellation checkpoint.
- Smallest fix: Give every tunnel-control child a supervisor-owned cancellation path, and have `forceStopOwnedRuntime` synchronously initiate SIGKILL for each currently tracked child before attempting a new tunnel stop; keep the queue slot held until each child emits `close`. Record any child that does not settle as a partial-cleanup failure.
- Confidence: High. The set membership and force-shutdown control flow are visible in the inspected source; the exact delay depends on the native command's behavior.

## Design limitation, distinguished from a bug

The supervisor cannot prove that an externally managed tunnel alias has stopped by killing the local CLI control child. `stopTunnelGracefully`, `waitForTunnelStopped`, and forced cleanup therefore depend on the native runtime manager's health/status response. A non-cooperating or unreachable native manager can leave the alias state unknown; treating that as a failed or partial cleanup is a design limitation of the external control boundary, not by itself an additional supervisor bug. The findings above concern local queue ordering and local child ownership/cancellation.

## Zero-findings note

This lane is not zero-findings: the three findings above are concrete current behaviors in the inspected scope. No claim is made about uninspected wave reports, live runtime state, installed-app behavior, or account-side behavior.
