# Independent blind review wave 2, lane 8 recovery

- Repository: `/Users/alex/Dev/nekodex`
- Baseline: `9925453`
- Source state: unchanged; review only
- UTC review start: `2026-09-15T20:38:28Z`
- UTC review end: `2026-09-15T20:40:00Z`

## Inspected scope

Read `/Users/alex/Dev/nekodex/skills/nekodex-regression-prevention/SKILL.md` and `/Users/alex/.codex/skills/right-size-test-runs/SKILL.md`. Inspected:

- `launcher/electron/browser-helper-verifier.cjs`
- `launcher/electron/startup-recovery.cjs`
- Direct source paths needed to follow the callers and recovery cleanup: `launcher/electron/browser-host.cjs` and `launcher/electron/main.cjs`

I followed normal, alternate, error, cancellation/shutdown, direct-caller, partial-startup-cleanup, helper-ownership, and primary-versus-cleanup-error paths by manual source review only. I did not read other mixed-model-experiment reports or historical findings. No tests, typechecks, scripts, runtime checks, commits, delegation, or source edits were performed.

## Findings

### 1. Timed-out startup cleanup continues after recovery launches or exits

- **Trigger:** `cleanup` takes longer than `timeoutMs` (the production caller supplies 3,000 ms), then the interactive user chooses Restart, or the noninteractive path returns.
- **Exact location:** `settleWithin()` at `launcher/electron/startup-recovery.cjs:21-29`; its use in `recoverStartupFailure()` at `:45-47`, `:65-77`.
- **Defect:** `Promise.race()` returns `false` at the deadline, but the promise created by `Promise.resolve().then(action)` is not cancelled. Recovery proceeds to show the dialog or relaunch and finally calls `app.exit()` while the original cleanup action can still be executing. `cleaned: false` records only that the deadline elapsed; it does not prevent the restart boundary from being crossed.
- **Consequence:** A fresh launcher can start while the old process is still closing browser control, removing descriptors, closing windows, or releasing another owned resource. Late cleanup can race the new process and can leave ownership state unknown even though recovery reports a restart action.
- **Counterevidence:** The code deliberately documents a fresh process as the retry boundary at `:43-44`, and `settleWithin()` prevents cleanup from holding the single-instance lock indefinitely. That bounds the wait, but does not establish that cleanup has stopped or that its resources are safe for the next process.
- **Smallest fix:** Make the cleanup contract cancellation-aware and await/confirm cancellation before relaunch; if cancellation cannot be confirmed, keep the result as a failed/unsafe recovery and do not start the replacement process. At minimum, preserve the in-flight cleanup/ownership state as a blocking result instead of treating the timeout as a completed boundary.
- **Confidence:** High.

### 2. Startup recovery suppresses a browser-host cleanup failure and can report cleanup as successful

- **Trigger:** Startup fails after `browserHost` exists, and `browserHost.destroy()` throws before completing its cleanup. `browserControl.close()` then succeeds.
- **Exact location:** The production cleanup callback passed to `recoverStartupFailure()` at `launcher/electron/main.cjs:1603-1613`, especially the empty catch at `:1609`; the uncaught portions of `BrowserHost.destroy()` begin at `launcher/electron/browser-host.cjs:3241-3273`. The resulting cleanup status is consumed by `recoverStartupFailure()` at `launcher/electron/startup-recovery.cjs:45-46`.
- **Defect:** The caller catches and discards `browserHost.destroy()` errors, so the cleanup callback can resolve normally after only the later control-service close. `settleWithin()` therefore returns `true`, and recovery may show Restart or return `{ action: "quit", cleaned: true }` even though browser-host teardown stopped partway through.
- **Consequence:** Recovery loses cleanup error precedence and can relaunch after a partially destroyed browser host. Descriptor removal, views, event bindings, timers, or helper-related ownership may remain unresolved, while the caller has no failure signal to prevent or qualify the restart.
- **Counterevidence:** `BrowserHost.destroy()` itself has several local best-effort catches, including descriptor parsing/removal and view removal. Those catches cover expected teardown failures, but the uncaught operations around listener removal, `closeAuthView`, and `webContents.close` still make the outer `try { ... } catch {}` materially hide a possible partial cleanup failure.
- **Smallest fix:** Collect the browser-host error, continue the independent cleanup steps, and reject or return a structured failed cleanup result after all steps have been attempted so `recoverStartupFailure()` retains `cleaned: false` and the cleanup detail.
- **Confidence:** High.

### 3. Helper ownership is released on `exit` before stdio `close` has settled

- **Trigger:** A helper process emits `exit` and its stdout/stderr streams emit `close` later, which is a normal possible child-process event ordering.
- **Exact location:** `waitForExit()` at `launcher/electron/browser-helper-verifier.cjs:40-56`; `stopChild()` returns from that result at `:71-75`; the operation then closes readline interfaces and releases the per-descriptor scope in `runBrowserHelperOperationOnce()`/`runBrowserHelperOperation()` at `:205-218` and `:239-243`.
- **Defect:** `waitForExit()` attaches the same resolver to both `exit` and `close`, so the first `exit` event is treated as fully settled. The scope is then eligible for release even though the child stdio handles have not reached `close`, contrary to the ownership invariant that process cleanup is settled only after exit and stream/close settlement are observed.
- **Consequence:** A queued operation for the same descriptor can start while the prior helper's streams are still draining or closing. The process is gone, so this is not a PID-targeting defect, but it can retain stream resources past the ownership handoff and make partial cleanup/recovery observability inaccurate.
- **Counterevidence:** `readline.Interface.close()` is called in the operation `finally`, and the child process has already exited when `exit` wins. The current code also retains handles when SIGKILL does not produce an observed exit. Those measures reduce the impact, but neither waits for the normal close events before releasing the scope.
- **Smallest fix:** Track exit and close independently and resolve `waitForExit()` only after both have been observed, with the existing timeout/error path retaining the child handle if close settlement is not observed.
- **Confidence:** Medium.
