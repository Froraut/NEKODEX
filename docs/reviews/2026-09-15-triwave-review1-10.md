# Triwave review 1, lane 10 — codex integration journal

Baseline: NEKODEX `3740505b0107af9a83053fd523ae1ad30be36465` (`HEAD`). Read-only manual source review of `src/codex-integration-journal.ts`, its direct callers in `src/codex-integration.ts`, and the JSON hook helper. Compared against `docs/reviews/2026-09-15-four-wave-results.md`, `docs/reviews/2026-09-15-four-wave-adjudication.md`, and the prior D07 implementation handoffs. No tests, typechecks, scripts, broad audits, runtime, production actions, code edits, or commit were performed.

## Finding

### T1-10-1 — explicit pending-disconnect recovery is blocked when the exact managed hook is still present

**Classification:** concrete residual/repeat of adjudicated D07; not a new independent defect. The prior D07 correction correctly removed destructive reconciliation from ordinary reads, but this recovery branch remains internally inconsistent.

**Trigger:** A v11 JSON-hook disconnect reaches the journal transition and crashes or is interrupted before the hook write completes: the primary journal remains active and the recovery journal is the same journal with `active: false`, while `hooks.json` still contains the exact recorded managed entry at its recorded group/index and with its recorded hash. An explicit disconnect or uninstall then calls `readJournal({ reconcileInactiveHook: true })`.

**Source path and exact evidence:**

- `src/codex-integration.ts:520-525` and `:650-654` deliberately enable the explicit recovery mode for disconnect and uninstall.
- `src/codex-integration-journal.ts:339-346` recognizes the active-primary/inactive-recovery pair as `pendingInactiveDisconnect` and allows recovery only when the explicit option is true.
- `src/codex-integration-journal.ts:256-271` is supposed to complete that recovery. However, line `261` first evaluates `journalConfigMatches(recovery)`. That function at `:220-221` combines `journalConfigMatches` with `journalExternalHooksMatch`. For an inactive v11 JSON journal, `journalExternalHooksMatch` at `:196-213` returns `restoredInactiveJsonHook(journal) === undefined`; when the exact recorded hook is still present, `restoredInactiveJsonHook` at `:224-238` returns a removal object, so the hook predicate is false. The `journalConfigMatches(recovery)` call therefore returns false and line `261` returns before reaching `:262-279`, where the byte-guarded removal and journal commit would occur.
- The fallback matching at `src/codex-integration-journal.ts:359-366` also cannot select a repair: the restored config matches the inactive recovery journal, but its hook predicate is false; the active primary does not match the restored config. The caller receives the mismatch error and the exact hook plus both journal copies remain stranded.

**Consequence:** The only caller authorized to recover a proven interrupted disconnect/uninstall cannot finish the transition in the exact crash window that the active-primary/inactive-recovery pair is intended to cover. The user is left with an inactive journal and the managed interrupt hook still installed; repeated explicit disconnect/uninstall continues to fail until manual reconciliation. This is a lifecycle recovery failure, not ordinary-read deletion.

**Counterevidence and qualification:**

- Ordinary readers pass `reconcileInactiveHook: false` (`src/codex-integration.ts:233`, `:292`, `:380`, `:573`, `:762`), and `readJournal()` no longer performs the former implicit removal for equal inactive copies. That part of D07 is satisfied.
- A changed command, occupied recorded slot, duplicate command, or changed hash is rejected by `restoredInactiveJsonHook` (`src/codex-integration-journal.ts:239-250`), preserving external edits. The correction should retain those guards while separating restored-config proof from the hook-state predicate for the already-proven pending pair.
- The byte-level `expectedData` guard at `:262-279` is present once the recovery function is reached, but it does not help because the current predicate exits first.
- The prior `four-wave-fix1-11.md` handoff explicitly identified this same residual, while `four-wave-fix1-10.md` and `four-wave-fix2-10.md` state that the predicate is already separated. The current source at `:220-221` and `:261` does not implement that claimed separation. This is therefore a residual/repeat to adjudicate, not evidence of a new D08-style root.

## Reviewed paths with no additional finding

- `readJournalSnapshot()` at `src/codex-integration-journal.ts:283-295` is documented and implemented as non-writing inspection; it does not authorize hook removal.
- `assertInactiveJsonHookAbsent()` and its setup/activate/uninstall callers (`src/codex-integration.ts:172-177, 298-300, 386-388, 578-580, 653-656, 771-773`) preserve a reappeared inactive hook instead of silently deleting it. The remaining issue is the explicit pending pair above.
- `src/codex-interrupt-hook-json.ts:120-140, 184-208` verifies the recorded slot, hash, and unique occurrence before removal. No separate ownership defect was established there.
- The canonical connector ABI and names remain outside this journal path and unchanged: `Codex Native4`, `Codex Native4 DEV`, and `Codex Zero Risk4` remain the required identities. No connector rename, schema, tunnel, or public tool change is proposed.

## Known limits and optional improvements

- Known limit, not counted: source review cannot prove live filesystem interleavings, cross-process scheduling, or whether an external actor writes identical hook bytes during the final uninstall check. The prior results document already records that cross-file race boundary.
- Known limit, not counted: no live ChatGPT account schema load, approval, or retained task was established by this lane; that is outside journal ownership and the documented generation-4 evidence boundary.
- Optional improvements: 0. The needed action is a focused residual correction to the existing D07 recovery predicate, not an optional simplification and not an ABI change.

## Counts

- Potential/concrete findings: **1** (`T1-10-1`)
- New independent roots: **0**
- Repeats/residuals: **1** (D07)
- Known limits: **2**
- Optional improvements: **0**
- Files changed: **1 review file only**
