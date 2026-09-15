# NEKODEX mixed-model experiment review wave 1, lane 3

- Review: `review1-03` (integration)
- Baseline: `9925453bd51e61c7b398abec12ec0da3aca3d3af`
- UTC start: 2026-09-15T20:28:00Z
- UTC end: 2026-09-15T20:32:58Z
- Review mode: manual source review only; no source edits, tests, typechecks, scripts, live actions, commits, or delegation

## Inspected scope

Primary files:

- `src/codex-integration.ts`
- `src/codex-integration-shared.ts`
- `src/codex-integration-journal.ts`

Direct callers inspected only as needed to establish ownership and read behavior:

- `src/route-diagnostics.ts` (`readJournalSnapshot`)
- `src/cli.ts` (uninstall command)
- `src/setup.ts` (setup/preflight call sites identified)

I did not read other wave reports. The review was limited to source at the stated baseline and direct call relationships. No runtime or filesystem behavior was exercised.

## Findings

### 1. High — uninstall can overwrite a concurrent config or hooks edit

- Location: `src/codex-integration.ts`, `uninstallCodexIntegration`, the `writeFileSnapshot` calls at lines 708 and 711; helper: `src/codex-integration-shared.ts`, `writeFileSnapshot`.
- Trigger: Start `uninstallCodexIntegration()` after it has captured `configSnapshot` and, for JSON hooks, `hooksSnapshot` at lines 691–692. Before line 708 or 711 executes, another process edits the config or hooks file while preserving the same symlink identity. `writeFileSnapshot` checks only the symlink identity and then atomically writes the restored bytes; it does not compare the current file bytes with the captured snapshot.
- Impact: The uninstall replaces the intervening external edit with the old snapshot-derived restored content. The later rollback guard cannot identify this as a pre-write conflict because the overwrite already happened. A user or another process can lose a config or hook change during uninstall.
- Smallest fix: Add a compare-before-write variant/parameter to `writeFileSnapshot` that requires the current target bytes to equal the captured snapshot bytes immediately before the atomic write, and use it for the uninstall config and hooks writes. Preserve the existing symlink identity check as part of that guard.
- Confidence: High. The race is directly visible from the snapshot capture, the unconditional write, and the absence of an expected-byte check.

### 2. High — uninstall deletes a replacement catalog or models cache without ownership comparison

- Location: `src/codex-integration.ts`, `uninstallCodexIntegration`, lines 713–718.
- Trigger: After `catalogSnapshot` and `modelsCacheSnapshot` are captured at lines 693–694, another process recreates or replaces either file before the corresponding `rmSync` call. The catalog is removed unconditionally when its original snapshot existed; the models cache is always removed with `{ force: true }`, without checking that the current bytes still equal the snapshot.
- Impact: Uninstall can delete a file written after the operation took ownership, including a newly generated cache or a replacement legacy catalog. The rollback path can also restore the old snapshot over a concurrent replacement if a later uninstall step fails.
- Smallest fix: Use a guarded removal helper that re-snapshots immediately before deletion and removes only when existence, bytes, and relevant symlink identity still match the captured snapshot. On mismatch, preserve the file and report the ownership conflict as the primary uninstall failure.
- Confidence: High. Both deletion sites lack the compare that `removeJournalCopy` performs for the journal copies.

### 3. Medium — normal integration writes snapshot files but do not compare them before committing

- Location: `src/codex-integration-shared.ts`, `writeFilesWithCompensation`, lines 365–382; called by `writeIntegrationState` at lines 425–430 without `expectedData` on any write.
- Trigger: During setup, activation, deactivation, or protocol replacement, `writeFilesWithCompensation` snapshots the journal/config/hooks files, then another process edits one of those files before that file's turn in the write loop. Because the writes supplied by `writeIntegrationState` have no `expectedData`, the guard at lines 372–379 is skipped and `writeFileSnapshot` commits the new managed bytes over the intervening edit.
- Impact: A concurrent user/configuration change can be silently lost. In particular, the journal can then describe a managed state that was committed over an external edit, weakening the journal's ownership evidence and making later restoration operate on an obsolete baseline.
- Smallest fix: Have `writeIntegrationState` populate each write's `expectedData` from the snapshot taken for that path, or make `writeFilesWithCompensation` require and enforce an expected snapshot for every managed write. Keep the existing symlink identity check and compensation behavior.
- Confidence: High. The helper already contains an opt-in byte comparison, while its central caller omits the opt-in for every managed write.

## Design limitations / non-findings

- `readJournalSnapshot` intentionally reports a primary/recovery divergence as `recoveryPending` without repairing either copy. That is an observational diagnostic contract, not a bug in this review.
- `readJournal` may repair journal copies when called with its default `repair: true`; inspection callers in the reviewed integration path explicitly pass `repair: false`. The distinction is easy to misuse, but the reviewed call sites do not establish a current concrete failure, so I am not counting it as a finding.
- No additional concrete current bugs were established within the requested files and direct callers.
