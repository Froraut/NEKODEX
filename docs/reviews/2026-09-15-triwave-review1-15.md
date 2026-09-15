# NEKODEX — triwave review 1, lane 15: tunnel lifecycle

Baseline: `3740505b0107af9a83053fd523ae1ad30be36465` (HEAD). Read-only manual review of the current tunnel supervisor, tunnel command helper, setup callers, and prior results/adjudication. No tests, typechecks, scripts, broad audits, runtime actions, production actions, or code edits were performed. Native4, Native4 DEV, ZeroRisk4 and their public connector ABI were not changed.

## New concrete findings (1)

### T1-15-1 — Timed-out tunnel control processes are no longer owned after forced termination

- **Trigger:** A launcher-owned tunnel control invocation such as local inventory/status, `runtimes connect`, or `runtimes stop` reaches its timeout, and the spawned tunnel-client process or one of its descendants does not exit after the initial termination request and the later SIGKILL request. The same applies when shutdown aborts the control invocation and the abort cleanup cannot make the process exit.
- **Exact source path:** `launcher/electron/runtime-supervisor.cjs:1794-1808` creates the control child locally inside `runTunnelCommand`; no supervisor field or task registry retains that handle. The timeout path at `1862-1893` calls `terminateOwnedProcessTree(child)`, schedules a second call with `SIGKILL` after 5 seconds, and rejects after another 2 seconds if the child still has not exited. The abort path at `1832-1859` has the same bounded sequence. The final timeout rejection at `1887-1892` and abort rejection at `1854-1859` settle the promise without retaining the child for later observation or cleanup.
- **Direct callers:** `startTunnel` calls connect and stop through `runTunnelCommand` at `launcher/electron/runtime-supervisor.cjs:1074-1094`; its failure cleanup can immediately issue another stop at `1100-1117`. Graceful shutdown calls stop at `1725-1755`, and inventory/health polling calls the same helper at `671-682`. Thus a timed-out control operation can return to a caller while the process tree remains live, and a subsequent control invocation can overlap it.
- **Consequence:** The launcher can leave a tunnel-client control process or descendant running without an owned handle, exit/close settlement, or a later exact cleanup obligation. A follow-up stop, recovery, or health probe may race the abandoned command and report native runtime state from a different operation. If the lingering child holds profile, key, proxy, or control-plane resources, a later connect/stop can fail or be misclassified while the supervisor has no way to distinguish the old command from the current one. This is a control-process lifecycle leak; it does not require changing the tunnel alias or connector ABI.
- **Counterevidence / limits:** The normal path settles on the child’s `exit` event at `launcher/electron/runtime-supervisor.cjs:1918-1944`, and the bounded termination sequence normally kills the child and its process group. The supervisor also keeps `this.tunnel`/`recoveryAliasMayBeLive` and, for a failed managed startup, attempts a separate runtime stop at `1104-1115`; this limits the possibility of losing the tunnel alias itself. The finding requires a non-cooperating or unobservable control process after forced termination, so it is a conditional source-level lifecycle defect rather than a reproduced incident. The existing D16 finding concerns the browser-helper verifier’s child ownership; this finding is the analogous but separate tunnel-client control path and has different owning code.

**Minimum correction direction:** Keep each tunnel control child in a supervisor-owned in-flight registry until `exit`/final `close` is observed. After the bounded SIGKILL deadline, report the timeout while preserving the handle and a cleanup/reconciliation obligation; serialize later control operations for the same tunnel alias until that obligation settles or the supervisor records an explicit unresolved child. Preserve the existing bounded termination and diagnostic behavior.

## Repeats / prior findings (1)

### T1-15-R1 — Prior journal status-read ownership issue repeats adjudicated D07

The earlier lane report `R1-15-1` found that an ordinary journal/status read could reconcile and delete an identical hook restored after disconnect. The adjudicator accepted it as **D07**, and the current results document records the repair: ordinary reads are non-mutating and explicit recovery requires matching ownership evidence. This is not a new tunnel lifecycle defect in the current HEAD and is counted only as a repeat.

## Known limits and optional improvements (2)

- `launcher/electron/runtime-supervisor.cjs:957-975` prefers local health endpoints when they are fully observed and uses native inventory as fallback. This review did not count a stale loopback endpoint as a defect because the supervisor resets/discovers the base URL around managed acquisition and retains the managed tunnel identity; proving an external alias swap would require a concrete concurrent actor and runtime evidence.
- The tunnel control helper caps stdout/stderr at `MAX_CONTROL_OUTPUT_BYTES` and uses bounded termination. A longer diagnostic retention window or a richer per-alias operation queue would be optional hardening after the ownership fix, not an ABI change and not a separate defect.

## Counts

- New concrete findings: **1** (`T1-15-1`)
- Repeats of adjudicated findings: **1** (D07 / earlier `R1-15-1`)
- Known limits: **1**
- Optional improvements: **1**
- Rejected/overclaimed candidates: **0**
- Tests/typechecks/scripts/audits/production actions: **0**
