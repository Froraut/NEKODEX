# Independent blind review wave2 lane2

- Repository: `/Users/alex/Dev/nekodex`
- Baseline: `9925453`
- Reviewed source: `src/setup.ts` (unchanged)
- UTC review start: `2026-09-15T20:37:42Z`
- UTC review end: `2026-09-15T20:38:22Z`
- Review mode: manual source review only; no tests, typechecks, scripts, runtime actions, commits, delegation, or source edits
- Historical review reports/findings were not read before source inspection

## Inspected scope

I read the repository-local `skills/nekodex-regression-prevention/SKILL.md` and
`/Users/alex/.codex/skills/right-size-test-runs/SKILL.md`, then inspected `src/setup.ts`
from source before looking at any related callers. I traced:

- `setup()` from `src/cli.ts:214-303`, including acknowledgement cancellation before setup,
  preflight, credential prompting, automatic, manual, launcher, and managed-Chrome paths.
- `setupDevProfile()` from `src/dev-chat/cli.ts:478-501`, including DEV browser-only and
  Full setup paths and the direct stopped-tunnel ownership gate.
- Setup transaction preparation, config migration, connector identity migration detection,
  runtime-key/client installation, tunnel profile bootstrap, service and tunnel-service
  ownership transitions, final Codex integration commit, and rollback.
- Failure paths for failed connect, failed readiness, failed stop, status-probe uncertainty,
  concurrent config/service/profile/key edits, terminal-to-launcher migration, and DEV
  rollback.

## Findings

No concrete reachable current defects found.

This is a valid zero-finding result. The reviewed paths consistently retain before/after
snapshots and ownership checkpoints: service and tunnel definition checkpoints are updated
around removal/install transitions (`src/setup.ts:667-699`, `748-835`); config writes are
guarded against concurrent edits and are restored only when the current bytes still match
the setup-owned planned bytes (`src/setup.ts:711-724`, `836-847`, `856-877`); tunnel
profile, runtime-key, and client rollback is similarly guarded, with unknown service state
left for manual recovery (`src/setup.ts:897-985`). The failed-connect case explicitly
preserves an uncheckpointed profile rather than deleting it (`src/setup.ts:909-915`).

Migration review also found counterevidence to a partial-state defect: setup compares the
persisted connector name with the migrated in-memory target before forcing the tunnel worker
refresh (`src/setup.ts:134-143`, `534-542`), and terminal-to-launcher migration defers removal
of the legacy service until the launcher-owned config baseline is written
(`src/setup.ts:831-847`). The loader performs connector/version migration in memory and
setup remains the positive writer of the migrated config (`src/config.ts:361-400`).

The direct caller's acknowledgement cancellation returns before `setup()` and therefore
cannot leave setup-owned state partially mutated (`src/cli.ts:265-277`). The DEV caller has
no separate mid-transaction cancellation signal; the reachable direct path instead uses the
explicit stopped-existing-tunnel gate and the DEV rollback transaction
(`src/setup.ts:1040-1065`, `1082-1158`). That boundary is a capability limitation, but no
current reachable inconsistent-state defect was established from `src/setup.ts`.

The final Codex integration mutation is last in the setup transaction
(`src/setup.ts:846-849`); its own write path uses compensation for multi-file writes, so no
post-commit setup failure was found that could leave a newly committed route partially
rolled back by `setup()`.

No speculative hardening, style issue, future-only case, or known fail-closed limitation is
reported as a bug.
