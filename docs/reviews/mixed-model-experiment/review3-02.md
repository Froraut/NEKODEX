# NEKODEX adjudication review3 — lane 2 (setup)

- Baseline: 9925453bd51e61c7b398abec12ec0da3aca3d3af
- Scope: src/setup.ts, direct callers in src/cli.ts and src/dev-chat/cli.ts, and direct downstream transaction helpers needed to verify ownership, rollback, migration, and integration commit.
- Inputs: review1-02.md, review2-02.md
- Review mode: manual source review only. No source edits, tests, typechecks, automated audit, runtime actions, commits, or delegation.

## Adjudication

The input reports do not contain explicitly numbered findings. For the required claim ledger, the substantive conclusions are numbered below. Verdicts describe whether each conclusion survives comparison with the baseline source; confidence labels were not treated as evidence.

### 1. review1: zero concrete current bugs were established

Verdict: accepted.

The setup transaction captures the persisted config, service definition and loaded state, tunnel service definition and loaded state, managed runtime key, tunnel client installation, and profile snapshots before mutation. Positive ownership checkpoints are updated after tunnel client/key writes and service-definition writes (src/setup.ts:667-732). Config and service writes are guarded against concurrent edits before mutation (src/setup.ts:748-764, 831-843). Rollback checks current bytes and loaded state against attempt-owned after checkpoints before restoring (src/setup.ts:856-989). Independent Codex integration writes occur last (src/setup.ts:846-850) and their own multi-file writer compensates partial writes (src/codex-integration-shared.ts:361-409).

No current reachable defect was found in the requested setup ownership, rollback, or migration scope.

### 2. review1: failed connect may leave a profile, but this is a design limitation rather than a bug

Verdict: design-limit.

bootstrapTunnelProfile marks the profile as owned only after connectTunnel returns (src/setup.ts:381-398). If connect throws before that checkpoint, setup records failedConnectMayHaveWrittenProfile and rollback preserves changed profile bytes while reporting manual recovery (src/setup.ts:911-915). DEV setup applies the same fail-closed behavior (src/setup.ts:1139-1154). The source cannot safely attribute such bytes to this attempt, so deleting them would risk destroying an external or concurrently written profile. The remaining partial state is explicit recovery information, not an unreported success state.

### 3. review2: no concrete reachable current defects were found

Verdict: accepted.

The second report is supported by the same ownership path. Terminal setup checks config/service snapshots before installation, records service state around install/restart, and refuses rollback when status is unknown or bytes changed (src/setup.ts:748-764, 879-895). Full-mode tunnel migration checks the old definition before stop/removal, records the replacement definition, and refuses to overwrite a changed definition (src/setup.ts:795-827, 906-947). Direct DEV setup rejects an existing Full tunnel unless its stopped state is explicitly observed before any mutation (src/setup.ts:1040-1065).

### 4. review2: migration handling supplies counterevidence to a partial-state defect

Verdict: accepted.

Setup compares the persisted connector name before deciding whether the migrated in-memory config requires a tunnel worker refresh (src/setup.ts:134-143, 534-542). The config loader performs migration in memory, while setup remains the positive writer of the migrated config (src/config.ts:361-400, src/setup.ts:836-843). Terminal-to-launcher migration removes the legacy service only after launcher-owned config is written and state is rechecked (src/setup.ts:831-847). If a later commit step fails, setup preserves concurrent edits and restores only matching attempt-owned snapshots (src/setup.ts:864-947). No actionable migration partial-state defect is evidenced.

### 5. review2: the final Codex integration mutation does not create an unhandled post-commit rollback gap

Verdict: accepted.

installCodexIntegration is called after setup has completed the tunnel/service/config transition (src/setup.ts:831-850). Its internal writeFilesWithCompensation snapshots all participating files and restores them on a partial write while retaining the primary error (src/codex-integration-shared.ts:361-409). The outer setup transaction has no subsequent fallible setup mutation after this call, so the reviewed source does not establish a later setup failure that would require rolling back a successfully committed route.

## Additional defects

None. The review found no second independent actionable root directly evidenced by source. Hypothetical hardening, known unavoidable compare/write races without a concrete actionable gap, invented gateway contracts, and UI states already invalidated by backend guards were not promoted to findings. No gateway claim was used; the public connector ABI and names remain unchanged.

## Counts

- Accepted: 4
- Rejected: 0
- Design-limit: 1
- Additional actionable roots: 0
- Unique accepted roots: 0
