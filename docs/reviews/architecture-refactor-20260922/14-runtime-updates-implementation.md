# Lane 14 implementation — runtime configuration and authenticated update staging

Source implementation only in the shared `codex/architecture-refactor-20260922` worktree, reviewed against baseline `53d17361f3e9c81910055a7e2c18759ffce458bc`. No branches changed, commits, pushes, app launches, live providers/accounts, packaging, restart, installation, release, or additional agents. Other owners' files and shared tests were not edited.

## Finding disposition

| Finding | Disposition | Independently confirmed evidence and result |
| --- | --- | --- |
| F1 | Implemented | The supervisor contained strict config policy and a separate permissive setup loader. Extracted their existing semantics into `runtime-config-contract.cjs`; filesystem reads remain in the supervisor. Its `validateConfig` export remains the same function facade. Setup still alone accepts `pro-only`; strict version/profile/descriptor/endpoint/model/tunnel validation, return identity/default behavior, and JSON-string active-tunnel comparison are preserved. `absolutePath` remains explicitly imported for non-config health-file validation. |
| F2 | Implemented | `beginInstall` mixed metadata authentication, cached/staged verification, extraction, helper copying and job validation with cancellation settlement and worker launch. `stageAuthenticatedUpdate` now owns preparation and its temporary root until returning only `{ tempRoot, workerPath, jobPath }` after validation and job serialization. Before return it cleans failures or preserves staging when extractor exit is unproven; after return the controller owns cleanup and handoff. Cleanup failures propagate separately from the primary failure to preserve failed-cancellation classification. |
| F3 | Implemented | Production `sha256` used blocking `readSync` at both cached and copied asset checks. Both now await the same streaming helper with the preparation signal. The resumable downloader shares that helper while keeping its overall deadline, network-idle separation, exact-byte check, mismatch removal and promotion ordering. Controlled streams prove cancellation happens before supplying remaining bytes. |

No findings rejected. F1/F2 are architectural improvements, not newly claimed runtime defects. F3 cancellation responsiveness is proven with controlled fixtures, not a large-file UI timing measurement.

## Boundaries retained

- Controller still owns discovery/check state, final `setImmediate` cancellation opportunity, `handoffCommitted`, worker launch, status publication, cancellation settlement and failed-Quit compensation.
- Staging explicitly destructures only its preparation dependencies. It has no runtime import of the controller, process supervisor or worker. Existing injected dependency names are unchanged; `sha256(file, { signal })` accepts synchronous or asynchronous injected return values through `await`.
- Cache and staged-copy verification both remain mandatory. Cancellation retains valid cache bytes; a mismatched cache is removed, while a mismatched staged copy fails before extraction.
- The copied-worker helper list is unchanged: `update-worker.cjs`, `update-validation.cjs`, `update-recovery.cjs`, `update-launcher.cjs`. The new modules run in the launcher and are not worker dependencies.
- An unproven extractor exit retains staging and reports failed cancellation; a cleanup failure is attempted by its current owner exactly once and cannot report successful cancellation.

## Focused verification

All commands ran from `/Users/alex/Dev/nekodex-refactor-20260922`. Each test invocation used a 25-second test timeout and completed in less than one second. No repository/package suites, builds or typechecks ran.

1. `node --test --test-timeout=25000 launcher/tests/runtime-config-contract-focused.test.cjs launcher/tests/update-staging-focused.test.cjs`
   - **8 passed** at this point (two config cases and six staging cases).
   - Setup compatibility/rejection and facade identity; strict object identity and active-tunnel mismatch.
   - Matching cache/copy hashes reach validation and mocked worker handoff exactly once.
   - Cancellation independently inside cached and copied hashing: first stream read observed, cancellation scheduled on a later event-loop turn, stream destroyed without EOF/remaining bytes, no extraction/handoff, owned staging removed, cache bytes retained.
   - Actual damaged cache and damaged copy are rejected before extraction, with the intended hash call count established.
   - Extractor fixture creates staging and signals entry before rejecting on cancellation with `preserveStaging`; retained staging and failed cancellation/cause are asserted.
2. `node --test --test-timeout=25000 --test-name-pattern='launcher runtime ownership|launcher runtime validation' launcher/tests/runtime-supervisor.test.cjs`
   - **4 passed**: descriptor ownership, production/DEV refusal, relative tunnel executable rejection, native Windows paths/pipe.
3. `node --test --test-timeout=25000 --test-name-pattern='a selected platform release with an invalid signature|verified update is handed' launcher/tests/update.test.cjs`
   - **2 passed**: authentication fails closed and existing successful Linux handoff fixture. Existing synchronous injected hash remains compatible.
4. `node --test --test-timeout=25000 --test-name-pattern='signed partial resumes exact range|wrong signed download bytes|network idle deadline stops' launcher/tests/upgrade-download-focused.test.cjs`
   - **3 passed**: authenticated resumption/promotion, mismatching bytes never promoted, network-idle separation and hashing cancellation.
5. After adding the cleanup-denial case: `node --test --test-timeout=25000 --test-name-pattern='cleanup failure after hashing' launcher/tests/update-staging-focused.test.cjs`
   - **1 passed**: hashing boundary reached before injecting `EACCES` into owned-root deletion; exactly one deletion attempt, failed cancellation with correct cause, no extraction/handoff, root preserved for diagnosis.

Total: **18 selected behavioral cases passed**, without rerunning unchanged passing cases. Existing shared test files were not modified. Final nonbehavioral formatting/dependency-destructuring edits received syntax inspection. `node --check` passed for `update.cjs`, `update-staging.cjs`, `runtime-config-contract.cjs`, and `update-asset-hash.cjs`. Scoped `git diff --check` passed for the three modified tracked source files.

## Exact changed paths

- `launcher/electron/runtime-supervisor.cjs`
- `launcher/electron/runtime-config-contract.cjs` (new)
- `launcher/electron/update.cjs`
- `launcher/electron/update-staging.cjs` (new)
- `launcher/electron/update-asset-hash.cjs` (new)
- `launcher/electron/resumable-download.cjs`
- `launcher/tests/runtime-config-contract-focused.test.cjs` (new)
- `launcher/tests/update-staging-focused.test.cjs` (new)
- `docs/reviews/architecture-refactor-20260922/14-runtime-updates-implementation.md` (new)

## Integration constraints and limits

No cross-lane source edits needed. Parent owns integrated types/build/UI checks and inclusion of the new launcher modules in the eventual source integration. No new manual helper-manifest entry was found necessary in inspected launcher scripts/package configuration. Do not describe mocked handoff or extractor failure fixtures as an actual OS update/restart or real extractor termination proof. No installed application behavior was exercised. Existing synchronous extraction preparation/validation and filesystem cleanup remain outside the hashing-responsiveness claim.
