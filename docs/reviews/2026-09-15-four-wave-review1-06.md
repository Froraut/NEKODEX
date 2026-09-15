# Review wave 1, lane 6 — launcher runtime migration

Baseline: `3a66157`. Scope: manual source review of `launcher/electron/runtime.cjs`, direct startup/setup callers, and the two requested generation-4/tunnel boundary reports. No execution, tests, typechecks, audits, installation, or implementation changes.

## Potential defects

**0 findings.** No `R1-6-n` ID assigned without a concrete failing path.

## Source observations and counterevidence

- `runtimeConfigSnapshot()` reads the persisted setup config, detects retired `appName`, `automaticAppName`, and `manualAppName` for launcher-owned configs, and avoids strict `readConfig()` while those names remain (`runtime.cjs:486-520`; `runtime-supervisor.cjs:393-420`). `upgradeManagedRuntime()` triggers setup even at the same release version and preserves the saved Full/Browser-only mode (`runtime.cjs:1297-1355`). Production startup calls it before starting the supervisor (`main.cjs:1332-1377`). This counters the same-version and Browser-only migration concern.
- The setup path compares the persisted active old name with the migrated in-memory name and refreshes the active tunnel worker accordingly; inactive names alone do not refresh that tunnel (`src/setup.ts:131-139, 526-534`). `runSetup()` takes a checkpoint, performs preflight before stopping the previous runtime, and restores the checkpoint on failure (`runtime.cjs:1502-1588`). This counters silent active-profile reuse and unguarded partial config writes.
- MCP verification refuses a persisted retired name instead of claiming that the old cached ChatGPT plugin is Native4/Native4 DEV/Zero Risk4 (`runtime.cjs:1023-1035`; `connector-identity.cjs:40-49`). Browser selection maps old aliases for setup guidance (`runtime.cjs:1038-1049`). DEV startup does not start a rejected legacy config (`main.cjs:1290-1331`).

## Known boundaries / optional follow-up, not defects

- A failed migration after stopping the old runtime can restore the old files yet leave the generation-4 supervisor unable to start a retired identity (`runtime.cjs:1547-1575`; `runtime-supervisor.cjs:1258-1267`). The error is surfaced, and the documented account transition retains the former build/config for rollback. This is a recovery limit to explain to users, not evidence of silent success or a new schema/identity requirement.
- Source setup and synthetic protocol checks do not prove account-side connector creation, live ChatGPT schema loading, approval success, or retained-task continuity. Those delivery boundaries are explicitly stated in `docs/reviews/2026-09-15-connector-generation4-results.md:52-56`. The tunnel report likewise distinguishes bounded source checks from live browser/platform proof (`docs/reviews/2026-09-15-tunnel-upstream-results.md:61-71`). Absence of live proof is not counted as a bug.

Counts: **0 potential defects; 0 optional code changes; 1 documented recovery boundary; 1 live-proof boundary.**
