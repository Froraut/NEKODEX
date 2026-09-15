# NEKODEX mixed-model experiment — review 3, lane 8 adjudication

- Repository: `/Users/alex/Dev/nekodex`
- Baseline: `9925453bd51e61c7b398abec12ec0da3aca3d3af`
- Review type: manual source adjudication only
- Source scope: `launcher/electron/browser-helper-verifier.cjs`, `launcher/electron/startup-recovery.cjs`, and direct callers required to trace cleanup and error flow

The requested regression-prevention skill and fast-verification limits were applied. The source tree was unchanged at the baseline. No tests, typechecks, automated audits, runtime actions, commits, or delegation were performed.

## Adjudication

### Review1 claim 1 — accepted; merged with review2 claim 3

**Verdict: accepted. Root: `L08-helper-stdio` (P2).**

`waitForExit()` resolves on either `exit` or `close` (`browser-helper-verifier.cjs:40-56`). `stopChild()` also returns immediately when `exitCode` or `signalCode` is already set (`:71-75`). The operation then closes its readline interfaces and releases the per-descriptor operation slot (`:205-218`, `:239-243`), while the child stdio close boundary may still be pending. A later operation can therefore pass `reconcileUnsettledHelperChildren()` without the previous helper's stream settlement having been observed. The existing `unsettledChildren` retention is used only after the SIGKILL observation timeout (`:85-96`), so it does not cover the normal exit-before-close path.

The callers do serialize operations with `scope.tail`, but that tail ends in the operation's `finally`; it does not wait for child `close`. This makes the ownership gap actionable rather than a confidence-label issue. Review1 and review2 describe the same root and are merged.

**Essential fix:** track process exit and stdio close independently; retain the exact child in the descriptor scope until the close boundary is observed, including the already-exited path. Release the scope only after that settlement or an explicitly surfaced bounded failure.

### Review1 claim 2 — accepted

**Verdict: accepted. Root: `L08-helper-response` (P2).**

The protocol result handler completes the promise on a valid `{ type: "result", id }` line (`browser-helper-verifier.cjs:149-176`). Independently, the child `exit` handler rejects immediately (`:188-191`). Node's child-process lifecycle permits `exit` to precede the `close` event for stdio, so a final stdout line that has been written but has not yet reached the readline `line` handler can lose to the exit rejection. Once `completed` is set (`:129-135`), the valid line is ignored. The `finally` cleanup at `:205-218` does not repair this ordering because it runs after the result promise has already been rejected.

No direct caller guard changes this protocol precedence: `verifyConnectorWithBrowserHelper()` consumes the returned message only after `runBrowserHelperOperation()` succeeds (`:246-262`). Thus a valid helper response can become a false verification failure before connector identity validation runs.

**Essential fix:** record exit status and defer failure until the stdout protocol/close boundary has been consumed, then reject only when no valid identified result or helper error was received within the bounded operation cleanup window. Preserve the valid response as primary when it arrives before the boundary is complete.

### Review2 claim 1 — rejected

**Verdict: rejected. No root.**

`settleWithin()` does leave the underlying cleanup promise in flight after its deadline (`startup-recovery.cjs:21-29`), and the returned `cleaned: false` records the deadline (`:45-46`). That fact alone does not establish the claimed actionable race. The recovery path deliberately treats a fresh process as the retry boundary (`:43-44`), calls `app.relaunch()` only for an explicit Restart (`:65-69`), and unconditionally calls `app.exit()` in `finally` (`:75-78`). The production cleanup performs synchronous browser-host, tray, and window destruction before awaiting the control server close (`main.cjs:1603-1613`); `BrowserControlServer.close()` itself awaits the server's close callback (`control-server.cjs:342-347`).

The report supplies no source evidence that the old process continues running after `app.exit()` long enough for the awaited close continuation to mutate a resource concurrently with the replacement. The possible non-atomic interval before the old process exits is a known bounded recovery tradeoff, and the requested review rule excludes accepting that hypothetical race without an actionable gap. `cleaned: false` remains an honest timeout result. No root is recorded.

### Review2 claim 2 — accepted

**Verdict: accepted. Root: `L08-recovery-error` (P1).**

The startup recovery cleanup callback catches and discards every exception from `browserHost?.destroy()` (`main.cjs:1607-1610`), then awaits `browserControl?.close()` (`:1612`). Because the callback can resolve after that later close succeeds, `settleWithin()` reports `true` even when browser-host teardown stopped partway through (`startup-recovery.cjs:45-46`). Recovery can consequently proceed to Restart or return a successful cleanup status without preserving the earlier cleanup failure.

The direct `BrowserHost.destroy()` path contains uncaught operations after its local best-effort catches, including listener removal, `closeAuthView`, and webContents close (`browser-host.cjs:3241-3274`). The caller's outer empty catch therefore materially suppresses a possible partial cleanup failure. This is a primary-versus-cleanup error precedence defect, not a request to harden every best-effort teardown operation.

**Essential fix:** attempt independent cleanup steps, retain the first browser-host failure, and return/reject a failed cleanup result after all steps have been attempted; preserve the cleanup failure as bounded detail while keeping the startup failure primary where both exist.

### Review2 claim 3 — accepted; merged with review1 claim 1

**Verdict: accepted, merged into `L08-helper-stdio`.**

This claim identifies the same `waitForExit()`/`stopChild()`/scope-release path and the same missing normal `close` settlement. Its proposed fix and impact are covered by the merged root above.

## Counts

- Numbered claims adjudicated: 5
- Accepted claims: 4
- Rejected claims: 1
- Design-limit claims: 0
- Unique accepted actionable roots: 3

## Essential fixes

1. Keep helper ownership attached to the exact child until both process exit and stdio close settlement are observed.
2. Let a valid final helper response win over an earlier process-exit notification when stdout has not reached its protocol boundary.
3. Stop swallowing `BrowserHost.destroy()` failures in startup recovery; aggregate independent cleanup failures and expose the cleanup result without losing the primary startup error.
