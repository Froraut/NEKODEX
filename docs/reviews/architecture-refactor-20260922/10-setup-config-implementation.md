# Lane 10 — setup/config implementation

Implemented in the shared worktree `/Users/alex/Dev/nekodex-refactor-20260922`. No branch changes, commits, pushes, apps, provider/account operations, installation, release, or additional agents. Other owners' files were not edited.

## Finding disposition and independent validation

- **F1 implemented.** Source inspection confirmed both production and DEV derived candidates before awaited launcher inspection and captured their write baselines afterward. `readConfigForSetup()` now returns the parsed/migrated config, original snapshot (including absence), and persisted active identity from the same bytes. Production preparation carries that read through orchestration; DEV captures it at entry. Both reject a conflict immediately after inspection and preserve the original snapshot for final guarded publication and compensation. Production also checks again after its awaited idle boundary before preparing mutations. Active identity migration no longer rereads an unrelated observation. `loadConfigWithSnapshot()` supplies the original runtime read to both explicitly assigned model-settings commands across their awaited idle check.
- **F2 implemented.** Independently confirmed the config → integration-shared → config runtime cycle. Atomic staging/publication, snapshots, identity comparison, guarded restore, and multi-file compensation now live in `file-transactions.ts`, importing only Node filesystem/crypto/path primitives. Config no longer imports integration-shared. Existing `atomicWriteFile` and integration-shared exports remain facades for tunnel/auth/response-state consumers. `CommittedFileReceipt` documents successful publication ownership; it is a compatibility alias, not a nominal type or a post-error observation. Snapshot comparison is centralized; ordinary setup snapshots and explicitly followed integration symlinks retain their distinct shapes. Windows retry guards, staging-inode receipts, link/target identity and mode checks, 0600 regular publication, and successful-removal checkpoints remain intact. BOM handling stays in config serialization; journal formats and route policy remain in integration-shared.
- **F3 implemented.** Source inspection confirmed duplicated restart projections and a single side-effect-free transition buried inside orchestration. `setup-policy.ts` owns `SetupOptions`, pure `transitionSetupConfig`, and one runtime projection used for both before/after comparison. Environment inputs are explicit: defaults, profile, version, runtime command, broker endpoint and acknowledgement time. The orchestrator obtains those inputs and retains probes, credentials, services and transaction ordering. `config-policy.ts` owns connector names/identity resolution and strict runtime connector-feature validation; setup uses the shared identity resolver with its explicit transition normalization. Runtime parsing and setup migration remain separate loading entry points. Public setup types and config identity exports remain compatible. Dynamic Pro/compaction preferences remain excluded from restart comparison. No CLI syntax or UI behavior was changed.

No finding was rejected. These are source/fixture results, not evidence of installed application or live provider behavior.

## Focused verification

All Bun invocations used `--timeout 15000`; all completed in less than one second. Commands after the initial existing-case invocation were additionally run using Python `subprocess.run(..., timeout=30)` for an overall wall-clock bound. No repository/package typecheck, build, suite, or rendered UI run was started.

1. `bun test tests/setup-transaction-ownership.test.ts --test-name-pattern 'actual production setup final-commit|writer receipts' --timeout 15000` — **2 passed**, 32 assertions. Reused actual caller final-commit compensation and BOM/key/client receipt ownership evidence. The final-commit fixture asserts candidate bytes were installed before injecting failure.
2. `bun test tests/setup-transaction-ownership.test.ts --test-name-pattern 'original config read' --timeout 15000` — production and absent-to-created **passed**; initial DEV fixture failed before inspection because it used a production identity with DEV purpose. Corrected only that fixture to Native4 DEV.
3. `bun test tests/setup-transaction-ownership.test.ts --test-name-pattern 'original config read.*development' --timeout 15000` — **1 passed**, 3 assertions. Together with #2, all three new setup concurrency scenarios pass. Each asserts inspection was reached and exact external bytes remain.
4. `bun test tests/setup-policy-focused.test.ts --timeout 15000` — **4 passed**, 15 assertions: Native5 Automatic → Manual → Automatic and input immutability; explicit incompatible async rejection versus inherited normalization; fresh delegation opt-in versus legacy missing-value retention plus runtime retired-identity rejection/setup migration; dynamic preference versus routed-behavior restart classification.
5. `bun test tests/codex-integration-wave3-focused.test.ts --test-name-pattern 'symlink target permission' --timeout 15000` — **2 passed**, 8 assertions: permission edits survive guarded write and rollback.
6. `bun test tests/settings-snapshot-focused.test.ts --timeout 15000` — **2 passed**, 6 assertions: both actual authorized Pro/compaction commands reach the mocked idle boundary, then reject stale saves and preserve external bytes.
7. `git diff --check -- src/config.ts src/setup.ts src/codex-integration-shared.ts src/pro-model-config.ts src/compaction-model-config.ts tests/setup-transaction-ownership.test.ts` — passed.

Total distinct passing cases: **13**. Mock-bearing test files must run in separate Bun processes; do not merge them into a shared mock namespace.

## Exact changed paths

- `src/config.ts`
- `src/setup.ts`
- `src/codex-integration-shared.ts`
- `src/pro-model-config.ts`
- `src/compaction-model-config.ts`
- `src/file-transactions.ts` (new)
- `src/config-policy.ts` (new)
- `src/setup-policy.ts` (new)
- `tests/setup-transaction-ownership.test.ts`
- `tests/setup-policy-focused.test.ts` (new)
- `tests/settings-snapshot-focused.test.ts` (new)
- `docs/reviews/architecture-refactor-20260922/10-setup-config-implementation.md` (this report)

## Integration constraints

Parent owns integrated core/renderer types, helper/renderer builds and rendered UI verification. No consumer import rewrite is required; keep the facades during other concurrent extractions. Existing tests that inspect moved implementation text may need behavioral replacements by their owners; none were rewritten merely to satisfy string assertions here. No cross-lane source edits are requested.

The filesystem guard remains process-local optimistic concurrency, not OS-level compare-and-swap or durable crash recovery. There is no automatic merge/retry of external config edits or provider work. Windows backoff behavior is preserved by extraction but was not executed on Windows. Full tunnel/service recovery scenarios beyond the selected existing compensation cases were not rerun.
