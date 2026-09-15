# NEKODEX mixed-model experiment review wave 1, lane 15 (downloads)

- Baseline: `9925453`
- Review type: manual source review only
- UTC start: `2026-09-15T20:28:45Z`
- UTC end: `2026-09-15T20:32:24Z`

## Inspected scope

- `src/tunnel.ts`
- `launcher/electron/update.cjs`
- `launcher/electron/update-worker.cjs`
- `launcher/electron/update-validation.cjs`
- Direct callers needed to establish lifecycle behavior: `launcher/electron/main.cjs`, `src/setup.ts`, and `src/process.ts`
- Repository regression guidance and the standing right-size verification guidance were read before review.

No other wave report was read. No source edits, tests, typechecks, scripts, live actions, commits, or delegation were performed.

## Findings

### 1. High — updater cancellation does not cancel or join the detached worker before deleting its inputs

- **Exact location:** `launcher/electron/update.cjs`, `cancelInstall()`; called by the `launcher:update-install` handler in `launcher/electron/main.cjs` after `requestQuit()` returns `{ ok: false }`.
- **Executable trigger:** Start an update so `beginInstall()` has spawned the worker and returned its `{ child, tempRoot }`, then make the quit request fail or be canceled. `cancelInstall()` calls `launch.child.kill()` and immediately recursively removes `launch.tempRoot`. The worker was spawned detached and there is no wait for its exit, acknowledgement, or transaction phase.
- **Impact:** The worker can continue after the UI reports cancellation. It can observe partially deleted `job.json`, staged files, or copied worker/runtime inputs and fail unpredictably; if it has already prepared its durable transaction, it can continue replacing and launching the application despite the cancellation request. The cleanup can also race worker reads and writes, leaving recovery state or an incomplete update.
- **Smallest fix:** Make cancellation an acknowledged worker operation: send a cancellation signal/marker through the job or IPC, wait for the worker process to exit (with a bounded timeout), and only then remove `tempRoot`. If the worker has entered replacement, let its transaction owner finish or recover it rather than deleting its inputs. Do not treat `child.kill()` as proof that the process has exited.
- **Classification:** Bug in updater lifecycle ownership, not a design preference.
- **Confidence:** High; the detached spawn, non-awaited `kill()`, and immediate recursive removal are all in the inspected path.

### 2. High — tunnel-client installation has a check-then-write race that can overwrite a concurrent edit

- **Exact location:** `src/tunnel.ts`, `installTunnelClient()` around the final `sameInstallation(snapshotTunnelClientInstallation(), beforeInstall)` check and the subsequent `atomicWriteFile(executable, binary)` / `atomicWriteFile(manifestFile, manifestBytes)` writes.
- **Executable trigger:** During an upgrade or first install, after the final installation snapshot passes but before either atomic write, another setup/process changes the managed binary or manifest. The installer then writes the new binary and manifest without rechecking the current bytes. Its later rollback checkpoint only runs if a later write fails; it cannot undo the successful overwrite while preserving the concurrent editor's bytes.
- **Impact:** A concurrent tunnel-client update or operator repair can be silently lost. The resulting binary/manifest pair may also be mixed with the concurrent writer's intended state, causing an integrity or version failure on the next setup/launch and making the ownership checkpoint inaccurate.
- **Smallest fix:** Use an ownership-aware compare-and-swap for each destination immediately before replacement, or hold an interprocess lock covering the final comparison and both writes. On a mismatch, abort before writing and preserve the concurrent files; keep the existing post-write rollback guard for failures after ownership is acquired.
- **Classification:** Current concurrency bug. The serial happy path is a valid design; the missing atomic ownership check is the defect.
- **Confidence:** High for the race window; it follows directly from the final snapshot being separate from the writes. The exact interleaving is timing-dependent.

### 3. Medium — failed tunnel connect can strand the managed runtime

- **Exact location:** `src/tunnel.ts`, `connectTunnel()`; lifecycle gate in `src/setup.ts`, `bootstrapTunnelProfile()`.
- **Executable trigger:** `connectTunnel()` invokes `runCommand()` with a 120-second timeout. If `runtimes connect` has already created or started the managed runtime but then times out, is aborted, exits nonzero, or otherwise throws before returning, `connectReturned` in `bootstrapTunnelProfile()` remains `false`. The catch path invokes only `onConnectFailed()` and skips `stopTunnel(config)` because cleanup is conditional on `connectReturned`.
- **Impact:** A tunnel process/runtime and its profile can remain active after setup reports failure. Repeated setup attempts can encounter an occupied alias, stale process, or resource consumption, while the UI/rollback path has no proof that the failed attempt was fully cleaned up.
- **Smallest fix:** Track whether the connect attempt may have started external state, independently of whether the command returned successfully. On timeout, abort, launch-shaped output, or nonzero completion, perform an ownership-checked `stopTunnel()`/status recovery for the configured alias; preserve the original connect error and attach cleanup failure as secondary detail. Keep the existing profile-preservation behavior when the state is unknown.
- **Classification:** Bug in failure cleanup. Whether a remote/runtime operation persists beyond the CLI process is an external lifecycle fact, so cleanup cannot be gated solely on synchronous command return.
- **Confidence:** Medium-high; the code explicitly treats failed connect as capable of writing a profile, but the same failure branch does not attempt runtime cleanup. The exact stranded-runtime outcome depends on tunnel-client behavior for the failure mode.

## Zero-findings note

This lane is not zero-findings: the three findings above are concrete source-level failure paths. Other observations were omitted when they required speculative platform behavior, broad hardening, stylistic changes, or claims about already-fixed history.
