# Wave 1, lane 14 — tunnel resource lifecycle

Baseline requested: `3a66157`. Manual source review of `src/tunnel.ts`, `src/tunnel-service.ts`, and direct setup/CLI failure paths. No tests, typechecks, scripts, runtime probes, or code edits.

## Potential finding (1)

### R1-14-1 — Existing terminal-owned tunnel profile remains on the retired connector during generation-4 migration

**Trigger:** A Full, terminal-owned macOS installation has an existing profile and a loaded launchd tunnel service whose plist still matches the proposed config; its persisted active `appName` is Native3/Native3 DEV/ZeroRisk2. Run setup with the required service-restart authorization, while the tunnel configuration and profile path stay the same.

**Source:** `src/setup.ts:131-139` recognizes the persisted legacy active name, and `:531-534` sets `refreshTunnelWorker`. Yet `:731-749` calls `bootstrapTunnelProfile` (and thus `connectTunnel` in `src/tunnel.ts:405-429`, which writes the native profile with `mcpCommand(config)` at `:384-398`) only when the plist ownership or profile existence changes. With an existing matching plist/profile, the `refreshTunnelWorker` branch merely calls `restartTunnelService` (`src/tunnel-service.ts:158-160`). `tunnelServiceDefinition` at `:52-85` contains binary/profile paths, not the connector name or MCP command. Consequently the restart reads the pre-migration YAML; `waitForTunnelReady` can report process/health/readiness without proving that YAML now carries the generation-4 command. The saved config and connector target can be generation 4 while the tunnel still runs its old profile.

**Counterevidence and boundary:** Launcher-owned Full explicitly bootstraps an existing profile on `refreshTunnelWorker` at `src/setup.ts:719-729`; DEV does likewise at `:962-972`. A missing profile or changed plist in terminal-owned Full also takes the bootstrap branch. If an independent external actor has already rewritten the YAML, the scenario does not apply. This is a source path finding, not a live ChatGPT connector failure reproduction. Preserve Native4/Native4 DEV/ZeroRisk4 identity and public schema; the issue is refreshing the existing terminal-owned profile.

## Other reviewed paths

- No further demonstrated defect: `connectTunnel` diagnoses nonzero and immediately unhealthy launch output; setup separately polls readiness and stops a successful temporary validation runtime. Non-JSON success becomes a launch error. A failed connect may leave uncheckpointed profile bytes and setup explicitly preserves them for manual recovery (`src/setup.ts:447-464`, `:827-832`).
- No further demonstrated defect: install validates pinned version/checksums, selectively expands the executable, snapshots owned bytes, and refuses concurrent-edit rollback. The existing upstream T01/T02/T03 corrections and their bounded guarantees are already recorded in `2026-09-15-tunnel-upstream-results.md`.
- Known limitation, not counted: the 20-second unload deadline governs the polling portion, not every `bootout`/status operation (`src/tunnel-service.ts:137-155`). Unavailable live tunnel/ChatGPT proof and unreleased generation-4 distribution are delivery boundaries recorded in `2026-09-15-connector-generation4-results.md`, not source defects.

Counts: **1 potential finding; 0 optional improvements; 2 reviewed no-defect paths; 1 known timing limitation**.
