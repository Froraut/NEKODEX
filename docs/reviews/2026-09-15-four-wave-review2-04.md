# Wave 2, fresh lane 4 — production setup and direct rollback

Frozen source baseline: `3a66157a8943a80bbbe299699cc96bec82721ba1`. Read-only manual trace of `src/setup.ts`, its direct CLI and launcher callers, and service, tunnel-service, config, tunnel-client/key and snapshot helpers. Compared `review1-04.md` and the adjacent DEV setup / launcher runtime reports where the recovery root overlaps. No execution, typecheck, scripts, production operation, commit or source change.

## New concrete finding (1)

### R2-4-1 — post-commit cleanup failure reports setup failure after route publication

Trigger: `installCodexIntegration(config)` completes, then removing a legacy wrapper or vendor directory fails (for example, filesystem permission or an undeletable entry). `src/setup.ts:772-774` commits the route inside the transaction, but `src/setup.ts:898` calls `removeLegacyRuntimeArtifacts` *after* its rollback catch. The helper's refusal guard and recursive removal can throw (`src/service.ts:287-295`). The exception propagates through `src/cli.ts:303-314` before its “Setup complete” and new connector guidance. Consequence: the caller receives a failed setup despite the already saved config, service/tunnel transition and Codex integration; this failure has no setup rollback or clear partial-success message. A retry may now operate against the newly committed route, while the user was told setup failed.

Counterevidence/limit: normal successful cleanup reaches the result (`src/setup.ts:900-908`). Cleanup is intentionally skipped during terminal-to-launcher migration (`src/setup.ts:646-648,898`), so this applies to other production setups. `removeLegacyRuntimeArtifacts` is guarded against deleting a path referenced by the new runtime command; no real cleanup failure was reproduced. The issue is commit/error ordering, not evidence that the legacy files are normally inaccessible.

## Repeated first-wave candidates (2), no new IDs

- **R1-4-1 confirmed as a source-level candidate:** an unloaded terminal service may write its new plist in `installService` before `launchctl bootstrap` fails (`src/service.ts:116-126`); the checkpoint follows only on return (`src/setup.ts:699-701`). Rollback detects the mismatch and refuses recovery (`src/setup.ts:796-812`). This is conditional on a real failure after the write. An already loaded service does not take this bootstrap path; successful installation checkpoints. The first-wave consequence is plausible but does not prove that a particular retry launches that definition without another setup step.
- **R1-4-2 confirmed as a source-level candidate:** terminal Full migration stops the old tunnel service, writes a new definition, then can fail before checkpoint (`src/setup.ts:735-743`; `src/tunnel-service.ts:118-127`). The mismatch at `src/setup.ts:823-826` prevents the later prior-state recovery at `:851-866`. A stop/uninstall operation can likewise change loaded state before its next checkpoint (`src/setup.ts:710-711,720-721,735-736`), which is the same uncheckpointed service-state root, not a separately counted defect. Autonomous runtime recovery by an external owner was not established by this direct rollback path.

## Challenge and limits

No first-wave claim was wholly rejected by this trace. The two reports are conditional candidates, not observed launchd failures. The conservative profile guard after a failed `connectTunnel` (`src/setup.ts:447-449,828-832`) preserves unknown writes for manual recovery; it is not counted as a separate bug. The launcher caller also has an outer checkpoint and previous-runtime recovery (`launcher/electron/runtime.cjs:1502-1588`), so a launcher setup failure alone cannot establish permanent runtime loss. Capability flags set false in manual mode (`src/setup.ts:296-316,602-604`) do not establish a failed turn or an absent completion signal. Account-side connector/schema readiness and live approval remain unverified delivery limits, with no identity or public schema change proposed.

Counts: **1 new concrete finding, 2 repeated R1 candidates, 0 rejected claims, 0 optional improvements; known recovery/live-account limits not counted.**
