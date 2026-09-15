# Wave 1, lane 4 — production setup rollback

Baseline: `3a66157`. Manual source review only. Scope: `src/setup.ts`, direct service/tunnel rollback helpers, config migration, CLI caller, and the two requested boundary reports. No tests, typechecks, scripts, production changes, installation, or commits.

## Potential findings (2)

### R1-4-1 — failed service bootstrap leaves setup-written definition behind

Trigger: terminal-managed production setup changes the service definition, and `launchctl bootstrap` fails after `installService(config)` writes its plist. `src/service.ts:116-126` writes the definition before bootstrapping; `src/setup.ts:699-701` checkpoints the definition only after `installService` returns. The catch at `src/setup.ts:796-806` sees current plist bytes differing from the stale `serviceAfterRoute` snapshot and classifies them as a concurrent service edit, so it refuses to restore the previous plist. It restores the config at `src/setup.ts:781-794`, but leaves the new service definition, making a retry/restart use a definition from the failed setup while the config is old. The reported error includes a rollback failure, but the state is not rolled back.

Counterevidence/limit: `installService` does a final status check and successful returns do reach `checkpointService`; the path requires a failure after the atomic plist write and before that return. A real launchd failure was not reproduced. Concurrent edits must still be preserved; the defect is the uncheckpointed setup-owned write, not the conservative rule itself.

### R1-4-2 — failed tunnel-service bootstrap can strand its old launchd state

Trigger: terminal-managed Full setup must replace an installed tunnel service; `installTunnelService(config)` writes the new plist, then `launchctl bootstrap` fails. `src/tunnel-service.ts:118-127` writes before bootstrap, and `src/setup.ts:742-743` checkpoints only after the call returns. In rollback, `src/setup.ts:823-826` compares the new plist against the stale pre-install `tunnelDefinitionAfterRoute`, treats it as a concurrent edit, and exits the tunnel recovery block before restoring the prior service/profile or reconnecting the old runtime (`src/setup.ts:841-866`). The previous loaded service may already have been stopped at `src/setup.ts:735-736`; setup can fail with the old config restored but the old tunnel no longer running and the new plist left behind.

Counterevidence/limit: successful bootstrap checkpoints and can roll back later failure. The installed tunnel-service definition is checked against current configuration before setup, and real launchd failure was not reproduced. This is a distinct service transaction from R1-4-1, though both share the write-before-checkpoint mechanism.

## Boundaries and no defect

- Active persisted legacy `appName` is read before tunnel reuse (`src/setup.ts:131-140,531-534`); Full setup refreshes on Native3/Zero Risk2 identity migration. Inactive names alone do not refresh the active tunnel. `loadConfigForSetup` migrates names while preserving the tunnel objects (`src/config.ts:361-399`). No contrary trigger found in this lane.
- Tunnel `connect` may write a profile before returning a failure; setup records the possibility and explicitly preserves uncheckpointed bytes for manual recovery (`src/setup.ts:447-449,828-832`). This is a documented recovery boundary, not an independently counted bug here.
- Neither local source review nor the generation4 and tunnel-upstream result documents proves a live ChatGPT connector schema load, an approval turn, or account-side readiness. Their absence is not a defect. Automatic custom cached connector names require a distinct new App ID/name by documented contract.

Counts: 2 potential findings; 0 optional improvements; 0 additional defects from known limitations. No code changes.
