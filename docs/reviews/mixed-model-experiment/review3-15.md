# NEKODEX mixed-model experiment review wave 3, lane 15 (downloads)

- Baseline: `9925453`
- Review type: manual source review only
- Scope: `src/tunnel.ts`; `launcher/electron/update.cjs`; `launcher/electron/update-worker.cjs`; `launcher/electron/update-validation.cjs`; direct callers and the authenticated download helper needed to establish the contracts.
- Source state: unchanged; no code edits, tests, typechecks, scripts, runtime actions, commits, or delegation.

## Result

The five numbered claims in review1/review2 reduce to three unique actionable roots. Four claim instances are accepted, one is rejected, and the duplicate accepted instance is merged under the same updater root. No additional defect met the requested evidence bar.

## Claim adjudication

### review1 claim 1 — accepted — `L15-updater-cancel-join`

`launcher/electron/main.cjs` calls `cancelInstall()` when `requestQuit()` returns `{ ok: false }`. `beginInstall()` starts a detached worker, returns its child and `tempRoot`, and `cancelInstall()` calls `child.kill()` followed immediately by recursive deletion of `tempRoot`. There is no exit/close settlement or worker acknowledgement between the signal and deletion. The worker can still be waiting for the parent or can have crossed into transaction preparation, so this is an updater ownership and cleanup race with an actionable lifecycle gap. The worker's durable recovery transaction helps after a transaction is established, but it does not prove that the temporary inputs are safe to delete before worker exit.

### review1 claim 2 — accepted — `L15-tunnel-install-CAS`

`installTunnelClient()` performs a final `sameInstallation(snapshotTunnelClientInstallation(), beforeInstall)` check and then separately writes the executable and manifest with `atomicWriteFile()`. A concurrent process can change either managed file after the snapshot and before the first write, so the installer can overwrite a concurrent edit and can publish a mixed binary/manifest pair. The existing rollback checkpoint only protects failures after the installer has written its own bytes; it does not restore a concurrent edit that was overwritten. An interprocess lock or ownership-aware compare-and-swap covering the final check and replacement is an actionable fix.

### review1 claim 3 — rejected — no accepted root

The claim assumes that a failed `runtimes connect` may have started a managed runtime and that skipping `stopTunnel()` therefore strands it. The current source does not establish that contract: `connectTunnel()` is documented and used as returning only after managed startup is healthy, while `bootstrapTunnelProfile()` calls `stopTunnel()` only after that successful return. When connect fails before return, setup explicitly marks `failedConnectMayHaveWrittenProfile` and preserves the possibly written profile for manual recovery instead of treating it as cleanly owned runtime state. The downstream guard is deliberate and fail-closed; a hypothetical tunnel-client partial-start behavior without a source-level proof is insufficient for an accepted defect.

### review2 claim 1 — accepted — `L15-auth-download-limits`

`downloadFile()` exposes `maxBytes` and `timeoutMs`, but its `expectedSha256` branch forwards only `expectedBytes`, `expectedSha256`, `onProgress`, and `requestDownload` to `downloadAuthenticatedAsset()`. The authenticated helper consequently uses its own `expectedBytes <= 1 GiB` check and default `totalTimeoutMs` of 60 minutes. The normal production path proves the release size and checksum, which supplies an independent hard cap, but it does not preserve a tighter caller-supplied limit. A direct caller using the exported helper contract can therefore request smaller limits that are silently ignored. Forward equivalent limits or make the authenticated helper enforce the same option contract while retaining its hard cap and idle timeout.

### review2 claim 2 — accepted — `L15-updater-cancel-join`

This is the same root as review1 claim 1. The direct `main.cjs` caller, detached worker launch, `child.kill()`, and immediate `rmSync(tempRoot)` are all present. The recovery journal does not provide exit settlement for the still-running worker, so the duplicate claim is accepted under the merged updater cancellation root.

## Accepted roots and essential fixes

1. **`L15-updater-cancel-join` (P2)** — Make cancellation an acknowledged lifecycle operation. Wait for worker exit/close with a bounded policy before deleting `tempRoot`; if settlement cannot be proved, preserve the owned temporary root and recovery information. Do not let cancellation delete inputs after the worker has entered durable replacement without handing ownership to the transaction/recovery path.
2. **`L15-tunnel-install-CAS` (P2)** — Protect the final tunnel-client ownership check and both managed-file replacements with an interprocess lock or ownership-aware compare-and-swap. Keep the existing post-write rollback guard, but never overwrite a changed concurrent installation.
3. **`L15-auth-download-limits` (P2)** — Carry the caller's byte and total-time limits into the authenticated resumable path, with validation that the requested values remain within the helper's hard maximum. Preserve the existing checksum, signed-size, idle-timeout, and partial-download identity checks.

Counts: **5 claims adjudicated; 4 accepted claim instances, 1 rejected; 3 unique accepted roots; 0 additional defects.**
