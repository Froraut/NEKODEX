# Lane 10 — setup, configuration and integration

Baseline: `53d17361f3e9c81910055a7e2c18759ffce458bc` (HEAD verified). Read-only source review; **no tests, builds, apps, accounts or providers run; no agents spawned**. Only this report was written. Paths below are relative to `/Users/alex/Dev/nekodex-refactor-20260922`.

Read the relevant setup/integration sections of `app-improvements-20260922.md`, `app-improvements-wave3-20260922.md`, and `app-improvements-waves4-5-20260922.md`. The final report supersedes wave 3's open broader-rollback caveat: committed-write receipts, inode/mode protection, BOM preservation, and failed-connect dependency retention are already implemented. Findings below do not re-propose those fixes. Verification proposals follow `right-size-test-runs`; parent owns the combined plan, build/UI checks, git and publication.

## 10-setup-config-F1 — P1: bind configuration reads to their original file snapshot

**Evidence / exact locations:** `src/setup.ts:138-150,551-568,615-660,701-718,788-791,912-915,1096-1123,1156-1184`; `src/config.ts:394-444,691-696`.

**Trigger:** another writer updates `config.json` while setup awaits launcher capability inspection (or managed-browser login/probing). Production reads `existing` in `prepareSetup`, clones it in `baseConfig`, then awaits capability inspection at line 653. Only at line 718 does it capture `configBeforeRoute`. DEV repeats the ordering: load at 1097, await at 1113, snapshot at 1156. The later `configUnchanged`/`sameSnapshot` guards compare against this newer snapshot, although the candidate was derived from older contents. Consequently a successful save can overwrite the concurrent settings without rejecting. First setup has the analogous absent-to-created race.

Example: candidate starts with `proModelVersion: "5.5"`; an external edit changes it to `"6"` during inspection; the late snapshot contains `"6"`, but `saveConfig(candidate, lateSnapshot)` safely publishes the stale `"5.5"`. The guarded writer is functioning correctly; its caller supplied the wrong baseline. `activeConnectorIdentityMigrationRequired` separately rereads the persisted file, so the decision can also mix different observations.

**Concrete change:** introduce a config read result carrying `{ config, snapshot, persistedIdentity }`. Parse/migrate the bytes from that same snapshot, including absence, rather than independently reading the file and then snapshotting. Capture it before any awaited work in both setup entry points. Use that snapshot for all later guards and publication; derive identity migration from its raw bytes. Recheck after inspection and before setup mutations so a known conflict can fail early; keep the final guarded write because an early check does not provide OS-level compare-and-swap. Do not merge unknown external edits or automatically retry provider work.

**Benefit:** makes user-config preservation cover the entire setup transaction, not only the interval after probing. This is a source-confirmed lost-update path, not a claim of live reproduction.

**Owned write set:** `src/config.ts`, `src/setup.ts`, `tests/setup-transaction-ownership.test.ts`; optionally the new config-read module described in F3. Caller inspection: production CLI invokes setup at `src/cli.ts:345`; DEV CLI invokes `setupDevProfile` at `src/dev-chat/cli.ts:506-524`. No caller API break is needed. Related authorized settings writers in `src/pro-model-config.ts:58-69` and `src/compaction-model-config.ts:30-42` also load before an await and save without the read snapshot; flag this wiring to their owner/parent, rather than silently expanding this lane's write set.

**Smallest verification:** extend the isolated actual-caller fixture to change config inside the mocked launcher inspection, prove that boundary was reached, and assert rejection plus exact preservation of external bytes for production and DEV; include one absent-to-created case. Run only those named cases in their own Bun process, **30-second maximum command timeout**. Existing tests edit at final route commit and therefore do not cover this earlier window.

## 10-setup-config-F2 — extract the filesystem receipt layer from configuration and route policy

**Evidence / exact locations:** `src/config.ts:1,191-234,691-696`; `src/codex-integration-shared.ts:1-6,261-268,320-564`; `src/setup.ts:407-415,924-953,1186-1208`.

`config.ts` imports snapshots/writes from integration-shared, while integration-shared imports `atomicWriteFile`, path expansion and config-home lookup from config. Thus saving application JSON loads a module also owning route journals, feature assignments and multi-file compensation, and the two modules form a runtime import cycle. The journal/config initialization was already reviewed in the previous wave; this is maintainability work, **not a claim that the current cycle crashes**. Atomic persistence is also used by browser-login, DEV sessions and response state, as well as tunnel installation. Adding another safe settings file should not require understanding Codex TOML policy.

**Concrete change:** extract `src/file-transactions.ts` with `FileSnapshot`, atomic staging/publication, snapshot/assert/restore, and multi-file compensation. It must depend on filesystem/crypto/path primitives only. Keep config-home and Codex-route/journal helpers in their current policy modules. Re-export the existing public symbols from `config.ts` and integration-shared so external consumers, especially lane06, need no import rewrite. Preserve current exported signatures and behavior.

Make the difference between an observed before-image and a returned committed write receipt explicit with a small receipt alias/record and documentation. Consolidate snapshot identity comparison there, retaining the distinction between ordinary-file setup comparison and explicit symlink-following integration operations. A post-error read is never a write receipt. Keep guarded Windows retries, staging-inode receipts, link identity/target checks, BOM handling, current 0600 regular-file publication and process-local successful-removal checkpoints. Do not turn this into a generic saga engine or durable crash-recovery mechanism.

**Benefit:** removes the persistence/configuration dependency cycle and gives future integrations one ownership contract without weakening the recently fixed rollback boundaries.

**Owned write set:** new `src/file-transactions.ts`, `src/config.ts`, `src/codex-integration-shared.ts`, `src/setup.ts`, focused existing receipt tests. One lane10 owner must perform this sequentially with F1. `src/tunnel.ts` and tunnel-service implementation remain lane06-owned; compatibility re-exports avoid cross-lane churn. Route document/journal formats stay unchanged.

**Smallest verification:** reuse the existing named writer-receipt/BOM and final-commit compensation cases from `tests/setup-transaction-ownership.test.ts`, plus the existing focused symlink case from `tests/codex-integration-wave3-focused.test.ts`. Parent should select exact names after reviewing the final extraction; each isolated command gets **30 seconds maximum**, no whole integration suite. Include import initialization in the focused fixture rather than starting an app.

## 10-setup-config-F3 — extract a pure setup transition policy with explicit loading contexts

**Evidence / exact locations:** `src/setup.ts:152-217,279-380`; `src/config.ts:71-92,244-275,400-444,474-530,610-688,698-755`; `src/cli.ts:246-305`.

Adding a setting currently requires reasoning across persisted migration/validation, setup transition defaults, provider projection and two hand-maintained before/after runtime objects. Important rules are intentionally different: new Web-subagent configurations default off but legacy missing values retain on; runtime loading rejects retired identities while setup may migrate; inactive Automatic Native5/6 identities survive Manual mode; explicit incompatible requests reject whereas some inherited values normalize during a mode switch. Flattening these into one generic default-merging schema would lose behavior.

**Concrete change:** extract `src/setup-policy.ts` containing a pure transition function from existing configuration plus `SetupOptions` and explicit environment inputs (profile, version, runtime command, acknowledgement time). Keep probes, credentials, filesystem writes and services in setup. Extract connector identity/feature compatibility helpers into a narrow config-policy module shared with runtime parsing, with clearly separate runtime-validation and setup-transition entry points. Replace the duplicated before/after literals with one runtime projection used twice. Classify new runtime settings at that boundary; do not infer that currently omitted Pro/compaction preferences require restart—the server reads them dynamically.

**Benefit:** feature additions get a discoverable policy location; production and DEV keep one transition implementation, while the orchestration retains visible side-effect/rollback ordering. Preserve the CLI's tri-state option semantics and all existing consent/auto-approval rules. No UI/product change is required or proposed in this backend lane.

**Owned write set:** `src/setup.ts`, `src/config.ts`, new `src/setup-policy.ts` and `src/config-policy.ts`, one small policy regression file. Same lane10 owner as F1/F2; keep public setup results and CLI syntax stable. No edits to renderer, tunnel implementation, model catalogs or Hermes lifecycle are necessary.

**Smallest verification:** a few boundary cases: retained Native5 Automatic → Manual → Automatic; explicit async in browser-only rejected; fresh versus legacy missing Web-subagent setting; runtime rejects retired connector while setup migration remains possible. Assert resulting configuration/rejection and input immutability, not implementation structure; **30-second maximum** focused command.

## Disposition and ownership

Implement F1 first, then F2/F3 as one sequential lane10 ownership area, not three competing writers. Read model catalog, ChatGPT model policy and Hermes integration and traced the authenticated server caller; no additional confirmed defect worth expanding this batch was established there. Preserve Hermes's independent authorization/continuation boundaries and intentional 64k catalog filter. Leave Codex document/journal migration and route restoration behavior intact. Parent coordinates any settings-writer wiring and all cross-lane verification. **No tests were run in this review.**
