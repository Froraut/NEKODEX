# Independent blind review wave2 lane15: downloads

- Repository: `/Users/alex/Dev/nekodex`
- Baseline requested: `9925453` (the repository currently resolves `HEAD` as `9925453bd51e61c7b398abec12ec0da3aca3d3af`)
- Source state: unchanged; no source edits
- UTC review start: `2026-09-15T20:31:00Z`
- UTC review end: `2026-09-15T20:40:00Z`
- Required skills: read `/Users/alex/Dev/nekodex/skills/nekodex-regression-prevention/SKILL.md` and `/Users/alex/.codex/skills/right-size-test-runs/SKILL.md`
- Missing-path note: the first inherited-path lookup for `nekodex-regression-prevention` failed; the repository-local path above was then read as instructed.

## Inspected scope and method

Inspected only the requested source paths, plus the direct Electron caller needed to trace updater cancellation:

- `src/tunnel.ts`
- `launcher/electron/update.cjs`
- `launcher/electron/update-worker.cjs`
- `launcher/electron/update-validation.cjs`
- `launcher/electron/main.cjs` lines 1066–1078 and 1093–1139 for the direct `beginInstall`/`cancelInstall` path
- `launcher/electron/resumable-download.cjs`, which is the direct callee of the authenticated download branch

The review followed normal, alternate, error, cancellation, and direct-caller paths for download bounds, temporary and cache paths, archive extraction, staged validation, worker launch, replacement readiness, rollback, recovery, and cleanup. No tests, typechecks, scripts, runtime checks, commits, or delegation were run. No other mixed-model-experiment reports or historical findings were read.

## Findings

### 1. Authenticated `downloadFile` silently drops its caller-supplied resource limits

- **Trigger:** A direct caller invokes the exported `downloadFile()` with `expectedSha256` and a deliberately smaller `maxBytes` or `timeoutMs`, expecting those options to bound the authenticated resumable download. The normal update path also enters this branch whenever it supplies the expected checksum.
- **Exact location:** `launcher/electron/update.cjs:186–196`, especially line 194’s `if (expectedSha256)` branch. The branch forwards only `expectedBytes`, `expectedSha256`, `onProgress`, and `requestDownload` to `downloadAuthenticatedAsset()`; it does not forward `maxBytes` or `timeoutMs`.
- **Consequence:** The caller’s requested limits are ignored. The authenticated implementation instead uses its own `expectedBytes <= 1 GiB` guard and default `totalTimeoutMs = 60 minutes` (`launcher/electron/resumable-download.cjs:7–12`). A caller cannot reduce those limits through the public `downloadFile` options, so a stalled or large authenticated transfer can consume the authenticated helper’s larger resource budget even when the caller requested a tighter one.
- **Counterevidence:** The authenticated helper still has independent hard caps: `expectedBytes` must be a positive safe integer no larger than `1024 ** 3`, and it has idle and total timers. The production controller also authenticates the release size before calling the function (`launcher/electron/update.cjs:489–508`). Those safeguards prevent an unbounded transfer, but they do not preserve the caller’s explicit `maxBytes` and `timeoutMs` contract.
- **Smallest fix:** In the authenticated branch, pass the caller’s limits into the helper as `maxBytes`-derived `expectedBytes` validation and `timeoutMs`-derived `totalTimeoutMs` (or have `downloadAuthenticatedAsset` accept the same option names and enforce `expectedBytes <= maxBytes`). Preserve the helper’s existing hard maximum and idle timeout.
- **Confidence:** High. This is a direct, reachable option-forwarding defect with a deterministic consequence.

### 2. `cancelInstall` deletes updater inputs before proving the detached worker has exited

- **Trigger:** `launcher:update-install` calls `beginInstall()`, then `requestQuit()` fails, for example because an active operation refuses shutdown. The direct caller then invokes `updateController.cancelInstall(launch)` (`launcher/electron/main.cjs:1070–1076`). The returned worker is detached (`launcher/electron/update.cjs:359–366`), and cancellation immediately calls `child.kill()` followed by recursive deletion of `launch.tempRoot` (`launcher/electron/update.cjs:566–570`).
- **Exact location:** `launcher/electron/update.cjs:566–570`; the worker is spawned at `launcher/electron/update.cjs:544–549`. The worker may still be in `main()` waiting for the parent (`launcher/electron/update-worker.cjs:394–406`) or may already be preparing/copying from the temporary root (`launcher/electron/update-worker.cjs:103–161`).
- **Consequence:** `kill()` is only a signal request; no `close`/exit settlement or ownership recheck occurs before `rmSync(tempRoot, { recursive: true, force: true })`. If the detached worker is delayed, non-cooperating, or has crossed into preparation, it can observe missing `job.json`, worker modules, archive/stage files, or runner files. This creates a cancellation race that can turn a user-visible failed quit into an updater failure with incomplete cleanup or recovery journal state. It also violates the lifecycle invariant that a process remains owned until exit and stream settlement is observed.
- **Counterevidence:** The worker has a durable transaction root and recovery guard (`launcher/electron/update-worker.cjs:83–100`, `350–378`), so many mid-update failures can later recover the installed application. `child.kill()` will normally terminate a waiting worker quickly. That does not establish that it has terminated before the temporary files are removed, and the detached guard/worker arrangement makes the race reachable under scheduling or process termination delay.
- **Smallest fix:** Make cancellation asynchronous and wait for the worker’s `close`/`exit` event, with a bounded fallback that records the worker as still owned and leaves its temporary root for recovery. Remove `tempRoot` only after exit is observed, or have the worker own and durably clean that root after it has settled.
- **Confidence:** High. The failing-quit caller and detached worker path are present in current source; the missing exit settlement is explicit.

No third defect met the requested bar for a current, concrete, reachable bug. The remaining examined paths had explicit size, checksum, path-containment, timeout, rollback, or recovery checks, or represented known fail-closed boundaries rather than defects.
