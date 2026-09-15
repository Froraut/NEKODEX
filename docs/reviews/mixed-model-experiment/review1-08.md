# NEKODEX mixed-model experiment — review 1, lane 8 (recovery)

- Baseline: `9925453bd51e61c7b398abec12ec0da3aca3d3af`
- Review type: manual source review only
- UTC start: `2026-09-15T20:32:12Z`
- UTC end: `2026-09-15T20:33:27Z`

## Inspected scope

Reviewed `launcher/electron/browser-helper-verifier.cjs` in full, `launcher/electron/startup-recovery.cjs` in full, and the direct recovery/helper callers needed to establish ownership and error flow: `launcher/electron/main.cjs`, `launcher/electron/browser-host.cjs`, and the directly awaited `BrowserControlServer.close()` path in `launcher/electron/control-server.cjs`. The review was anchored to baseline `9925453`; no other wave reports were read. No source edits, tests, typechecks, scripts, live actions, commits, or delegation were performed.

The repo skill `skills/nekodex-regression-prevention/SKILL.md` and `/Users/alex/.codex/skills/right-size-test-runs/SKILL.md` were applied. The review used the requested recovery questions: partial cleanup ownership, helper exit/stream settlement, and primary-versus-cleanup error precedence.

## Findings

### 1. High — helper ownership is released on `exit` before stdio `close`

- **Exact location:** `launcher/electron/browser-helper-verifier.cjs`, `waitForExit()` (lines 40–56), `stopChild()` (lines 71–96), and `runBrowserHelperOperation()` (lines 226–243).
- **Executable trigger:** A helper process exits after producing a result, while one of its stdout/stderr pipes remains open or has not emitted `close` yet. This is possible when a helper or a descendant retains an inherited pipe, or when pipe delivery/close is delayed. `waitForExit()` resolves as soon as either `exit` or `close` fires. `stopChild()` then returns, `runBrowserHelperOperation()` releases the per-descriptor operation scope, and a subsequent verification can start while the previous child’s stdio is still unsettled.
- **Impact:** The verifier treats a process as no longer owned while resources associated with that exact child remain live. The next helper operation can overlap the previous helper’s pipe lifetime, and the old child is no longer present in `unsettledChildren` for the guard in `reconcileUnsettledHelperChildren()`. This can produce late output/stream errors after the operation has been reported and weakens the intended no-overlap guarantee.
- **Smallest fix:** Make the stop/settlement predicate require the child’s `close` event after `exit` (with the existing bounded timeout). If `exit` occurs but `close` does not, retain the exact child in `unsettledChildren` and block the next operation until close is observed; do not release the scope on `exit` alone.
- **Confidence:** High. The current code explicitly resolves on either event, while the ownership contract requires process and stdio settlement.

### 2. Medium — a valid final helper response can lose to the child `exit` event

- **Exact location:** `launcher/electron/browser-helper-verifier.cjs`, the `output.on("line", ...)` result handler (lines 149–186) and `child.once("exit", ...)` handler (lines 188–191) inside `runBrowserHelperOperationOnce()`.
- **Executable trigger:** The helper writes a complete, correctly identified `{ type: "result", id }` line and exits, but Node emits the child `exit` event before the buffered stdout line is delivered to the `readline` interface. The `exit` listener calls `finish(error)` immediately; the later valid result line is ignored because `completed` is already true.
- **Impact:** A successful smoke, inspect, or connector verification is reported as `Browser helper verification exited ...`. This is an error-precedence/lifecycle race: process termination is treated as proof of failure before all protocol output has been consumed, so a valid final response can be discarded.
- **Smallest fix:** Do not fail the operation on `exit` until stdout has been allowed to drain and the `close`/readline completion boundary has been observed; alternatively, record the exit status and let the protocol line decide first, then fail only if no valid result/error arrives by the bounded cleanup deadline.
- **Confidence:** Medium-high. Node permits child stdio to remain readable after `exit`; the current handler makes the failure decision at `exit` and does not wait for the stream boundary.

## Recovery limitation observed, not counted as a third bug

`startup-recovery.cjs:settleWithin()` races cleanup against a timeout without cancellation. On timeout it returns `false` while the cleanup promise may still be pending, and `main.cjs` then offers restart and eventually calls `app.exit()`. This is a deliberate bounded-recovery design tradeoff for avoiding a stuck single-instance lock. It becomes a concrete bug only if a cleanup implementation is allowed to continue mutating shared state after the old process remains alive; the direct baseline caller performs its important synchronous destruction before awaiting `browserControl.close()`, and the old process is unconditionally exited. The returned `cleaned: false` correctly exposes the timeout, so I did not count this as a current defect.

## Summary

Two concrete current bugs were found, both in helper lifecycle/error ordering. No additional startup-recovery bug met the requested bar without relying on speculative external interleavings or stylistic hardening.
