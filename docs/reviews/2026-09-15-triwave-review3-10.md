# Triwave review 3, lane 10 — codex integration journal

Baseline: NEKODEX `3740505b0107af9a83053fd523ae1ad30be36465` (`HEAD`, HEAD3740505). Read-only adversarial source review after wave 1 and wave 2. Read current `src/codex-integration-journal.ts`, `src/codex-integration-shared.ts`, direct callers in `src/codex-integration.ts`, `src/codex-interrupt-hook-json.ts`, the connector boundary in `src/config.ts`, and `docs/reviews/2026-09-15-triwave-review1-10.md` plus `docs/reviews/2026-09-15-triwave-review2-10.md`.

No code edits, tests, typecheck, scripts, runtime, production, commit, or broad audit were performed.

## Final disposition

### Confirmed existing root: `T2-10-2` remains valid

**Classification:** confirmed repeat of the accepted wave-2 root; no new T3 ID.

`writeFilesWithCompensation` still snapshots every path before the write loop (`src/codex-integration-shared.ts:361-369`). Its rollback visits every snapshot and, for an unguarded write, calls `restoreFileSnapshot(snapshot)` without requiring that this operation started writing that path or that current bytes equal this operation's result (`:384-400`).

The concrete trigger remains in `recoverPendingJsonHookWrite` (`src/codex-integration-journal.ts:275-279`): the helper guards `hooks.json`, then schedules an unguarded primary journal write. If another writer edits the primary journal after snapshots but before the hook guard runs, the guard fails before `startedWrites.add` for the hook. Rollback then restores the old primary journal even though this operation never wrote it, potentially losing the other writer's edit.

The same helper-level ownership condition also covers the unguarded journal repair writes in `readJournal` (`:329-332`, `:370-373`) and the unguarded config/journal/additional-write sequence in `writeIntegrationState` (`src/codex-integration-shared.ts:416-430`). These are refinements of the same root, not separate T3 findings. The guarded hook path retains its current `startedWrites` and intended-bytes checks.

**Disposition:** confirmed existing wave-2 root. Parent may retain one focused scenario for an external edit between snapshot and the first guarded write. No source change was made.

## Wave-1 candidate challenge

### `T1-10-1` / pending disconnect recovery: rejected

Wave 2's rejection remains correct. `journalConfigMatches` (`src/codex-integration-journal.ts:182-194`) checks target/config state only; the hook predicate is separate. For an active-primary/inactive-recovery v11 pair with the exact recorded hook still present, `pendingInactiveDisconnect` is recognized (`:339-346`), config matching can succeed against the restored config, the external-hook predicate is false, and `recoverPendingJsonHookWrite` reaches the byte-guarded hook removal and journal commit (`:262-279`). Explicit opt-in remains limited to disconnect and uninstall (`src/codex-integration.ts:524,653`); ordinary readers pass `reconcileInactiveHook: false`. Changed slot, duplicate command, changed hash, and occupied recorded slot still fail closed through `restoredInactiveJsonHook` and `verifyCodexInterruptHookJson`.

## Cross-scope interactions checked

### Journal repair versus lifecycle callers — no new root

Setup, activate, inspect, and ordinary subagent-protocol reads use `reconcileInactiveHook: false` and apply the inactive-hook guard where lifecycle action requires it (`src/codex-integration.ts:233,292,298-300,380,386-387,573-579,762-773`). Disconnect and uninstall alone opt into the proven active-primary/inactive-recovery transition. `assertJournalTargetsConfig` is checked before config/cache/journal mutation in disconnect and uninstall (`:529,655-656`). No missed caller creates a new destructive ordinary-read path.

### Journal recovery versus JSON hook ownership — no new root

`restoredInactiveJsonHook` still validates recorded path, slot, entry hash, unique occurrence, and command before producing a removal (`src/codex-integration-journal.ts:224-253`; `src/codex-interrupt-hook-json.ts:120-140`). A missing, foreign, or changed hook does not authorize silent removal. The remaining conditional ownership defect is the confirmed compensation root above.

### Uninstall versus reappeared inactive hooks — candidate rejected

Uninstall checks the inactive hook before either journal removal, keeps recovery until after primary removal, checks again, and compares each journal's latest bytes with its snapshot before `rmSync` (`src/codex-integration.ts:697-724`). Its rollback is separately keyed by `expected` and only touches paths whose operation recorded an intended result (`:725-749`). No additional concrete uninstall root was established.

### Connector identities and ABI — preserved

Current source retains `Codex Native4`, `Codex Native4 DEV`, and `Codex Zero Risk4` at `src/config.ts:20-39`. The journal changes reviewed here do not rename these identities, alter connector schemas/tool names, change tunnel contracts, or change the public ABI. The generation-4 split remains intact.

## Candidate ledger

- **Confirmed existing:** `T2-10-2`, compensation can restore an untouched unguarded journal/config path after a guarded write aborts.
- **Rejected:** `T1-10-1`, because config and external-hook predicates are separate at HEAD.
- **Repeat/refinement:** the same `T2-10-2` ownership condition appears through `readJournal` repair and `writeIntegrationState`; no new `T3-10-n` ID.
- **Known limits:** no live filesystem interleaving or crash scheduling was exercised; identical external bytes cannot establish writer provenance; account-side connector/schema resolution and runtime ABI behavior are outside this source-only journal pass.
- **Optional:** 0.
- **New independent roots:** 0.

## Parent final focus

The three waves leave one focused verification question, within the requested maximum: when a guarded `hooks.json` write aborts before the first unguarded journal write, does compensation preserve a concurrent journal edit rather than restoring the pre-operation snapshot? One scenario is sufficient. No more than 10 scenarios are suggested.
