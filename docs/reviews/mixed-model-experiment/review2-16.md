# Independent blind review wave2 lane16 identity

- Repository: `/Users/alex/Dev/nekodex`
- Baseline: `9925453bd51e61c7b398abec12ec0da3aca3d3af`
- Source status: unchanged; no source edits made
- UTC review start: `2026-09-15T20:29:00Z`
- UTC review end: `2026-09-15T20:37:34Z`
- Result: **0 concrete reachable current defects**

## Inspected scope

- `src/config.ts`, with emphasis on:
  - generation-4 connector constants and legacy-name mapping;
  - `loadConfig`, `loadConfigForSetup`, and `parseConfig`;
  - automatic/manual active-name consistency checks;
  - automatic/manual tunnel selection and invalid-state rejection;
  - provider identity projection.
- `launcher/electron/connector-identity.cjs`, including setup, DEV setup, current-runtime validation, and cancellation-safe caller behavior.
- Direct identity and lifecycle callers needed to trace reachable paths:
  - `launcher/electron/runtime.cjs`;
  - `launcher/electron/runtime-supervisor.cjs`;
  - `launcher/electron/main.cjs`;
  - `launcher/electron/browser-helper-verifier.cjs`;
  - `src/setup.ts`.
- Paths followed: normal setup, legacy migration, DEV setup, automatic and Manual mode selection, direct connector verification, startup/recovery loading, cancellation/error cleanup, and stale-operation rejection.

The requested absolute `.codex` path for `nekodex-regression-prevention` was absent. The repository copy at `skills/nekodex-regression-prevention/SKILL.md` was read and applied. `/Users/alex/.codex/skills/right-size-test-runs/SKILL.md` was read and applied.

## Findings

None.

The strongest apparent risks were closed by current source evidence:

1. Setup migration is isolated to `loadConfigForSetup` (`src/config.ts:361-399`), while strict runtime loading rejects a retired active identity with an explicit migration message (`src/config.ts:443-467`). The migration rewrites local names but does not claim that the new ChatGPT connector exists.
2. The active connector identity is checked against the selected interaction mode and the automatic/manual names must differ (`src/config.ts:447-467`). Full-mode tunnel selection independently requires the active mode to have a matching tunnel (`src/config.ts:507-520`); the corresponding launcher validation repeats this boundary (`launcher/electron/runtime-supervisor.cjs:316-332`).
3. Direct verification rejects a legacy runtime name before spawning the browser helper (`launcher/electron/browser-helper-verifier.cjs:99-120`). The caller uses that fail-closed method for automatic verification and clears positive setup state on failure (`launcher/electron/main.cjs:729-760`). Manual mode records operator connector selection as a warning rather than falsely treating it as automatic connector proof (`launcher/electron/main.cjs:708-727`).

The launcher’s setup transaction also preserves the primary setup error while attaching cleanup failure (`launcher/electron/runtime.cjs:1502-1589`), and temporary runtime-key cleanup is in a `finally` path (`launcher/electron/runtime.cjs:1386-1404`, `1438-1448`). I found no reachable current trigger in the requested scope that produces a concrete incorrect result after accounting for these guards.

## Verification boundary

This was a manual source review only. No tests, typechecks, scripts, runtime execution, commits, delegation, or source edits were performed. Conclusions establish source-level behavior only; they do not prove ChatGPT-side connector creation, approval, cache state, live DOM selection, or production deployment behavior.
