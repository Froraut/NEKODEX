# Independent blind review wave 2, lane 3 — Codex integration

- Repository: `/Users/alex/Dev/nekodex`
- Baseline: `9925453`
- Source state: unchanged; no source edits were made.
- UTC review start: `2026-09-15T20:37:51Z`
- UTC review end: `2026-09-15T20:38:08Z`
- Verification: manual source review only. No tests, typechecks, scripts, runtime, commits, delegation, or release actions.

## Inspected scope

Read the repository-local regression-prevention skill at `/Users/alex/Dev/nekodex/skills/nekodex-regression-prevention/SKILL.md` and `/Users/alex/.codex/skills/right-size-test-runs/SKILL.md`.

Inspected:

- `src/codex-integration.ts`
- `src/codex-integration-shared.ts`
- `src/codex-integration-journal.ts`
- Direct callers in `src/cli.ts` for route connect/disconnect, subagent status, and uninstall.
- The direct diagnostic caller in `src/route-diagnostics.ts` for the non-repairing journal snapshot path.

The review followed active and inactive v11 TOML and JSON paths; journal-copy equality and divergence; primary-only and recovery-only reads; malformed-copy and config-mismatch errors; interrupted JSON-hook writes; interrupted disconnect recovery; explicit disconnect; reconnect; uninstall and rollback; concurrent-byte guards; foreign or changed hook entries; and CLI cancellation before uninstall mutation. No `AbortSignal` or cancellation path is present in these three integration modules; the CLI uninstall confirmation is evaluated before service or integration mutation.

## Findings

**Zero concrete reachable current defects.**

The examined compare/delete and journal ownership paths retain the relevant evidence before mutation and fail closed when ownership is uncertain:

- `readJournal()` compares serialized primary and recovery records, validates the active configuration before choosing among divergent copies, and uses the recovery record only for the explicitly proven interrupted inactive transition (`src/codex-integration-journal.ts:311-395`).
- JSON hook removal is limited to the recorded group/index and entry hash. A changed occupied slot, duplicate command, malformed document, or concurrent byte change raises an error and retains the journal (`src/codex-integration-journal.ts:232-261`; `src/codex-integration-shared.ts:361-409`).
- Disconnect does not treat an ordinary inactive journal as proof that a reappeared JSON hook belongs to the integration. It refuses the operation when the exact managed entry is present and permits the inactive state to remain owned when the entry is changed or absent (`src/codex-integration.ts:520-569`).
- Uninstall makes the disconnected journal durable before deleting journal copies, keeps the recovery copy until the final ownership check, and compensates only files that still match the operation's expected state (`src/codex-integration.ts:650-751`).
- Inspection callers use `repair: false`, while `route-diagnostics.ts` uses `readJournalSnapshot()`, whose implementation performs no recovery writes (`src/codex-integration.ts:230-236,754-806`; `src/codex-integration-journal.ts:292-314`; `src/route-diagnostics.ts:97-123`).

The remaining race between a byte comparison and a filesystem replacement is an explicit known boundary of this file-level approach and is not counted as a new finding here. The conclusions are source-level only; no local runtime, installed app, or live Codex/account behavior was established.
