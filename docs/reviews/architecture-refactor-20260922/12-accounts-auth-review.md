# Lane 12 — accounts, authentication and identity lifecycle

Baseline: `53d17361f3e9c81910055a7e2c18759ffce458bc` (HEAD confirmed). Read-only source review; no tests/builds, applications, providers, real accounts or subagents were run. Only this report was written. Verification proposals follow `right-size-test-runs`; parent owns the integrated plan, Git and publication.

Reviewed the account/Chrome/login modules and relevant consumers in setup, browser-host, browser-worker and codex-account-tools. Compared the account/authentication sections of `app-improvements-20260922.md`, `app-improvements-wave3-20260922.md` and `app-improvements-waves4-5-20260922.md`. Existing restored-session evidence, safe error guidance, post-await cancellation checks, verifier teardown and exact unsent-reservation rollback are already implemented; they are not new findings here.

## 12-accounts-auth-F1 — bind verification to the inspected storage snapshot

**P1, conditional identity/evidence defect plus bounded extraction.**

**Evidence:** `src/browser-login.ts:67-88,176-188,191-225,568-604`. `inspectBrowserLoginCapabilities` first checks saved state, then passes its *path* to an asynchronous browser inspection. After that inspection it calls `writeBrowserLoginVerificationMarker`, which rereads the path and calculates the digest from whatever bytes exist now. It does not retain the bytes used to construct the inspected context.

**Trigger:** storage state A is loaded by the verifier; another process replaces the file with B while navigation/capability inspection is awaiting; the marker writer hashes B and combines that digest with A's authenticated result/capabilities. `browserLoginStateExists` subsequently accepts that pair. This is a source-established race, not a claim that a live account was misidentified. A long provider inspection gives a real asynchronous replacement window; same-process synchronous writes are not the required trigger.

**Callers inspected:** `src/setup.ts:663-695` invokes this for capability refresh and legacy-marker reverification. Its service-idle preflight does not lock storage across the inspection. The managed worker is another writer (`src/adapters/chatgpt-web/browser-worker.ts:6093-6104`). `loginToChatGpt` already inspects an in-memory state (`src/browser-login.ts:518-525`), demonstrating the available safer boundary, although its marker writer still derives evidence from a path.

**Change:** extract the saved-state/marker contract to `src/browser-login-state.ts`. Read and validate one bounded text snapshot, derive its digest, and pass its parsed state to the verifier. Publish a marker whose hash comes from that verified snapshot; reject a changed file before publication. A replacement after the comparison must produce a digest mismatch, never a marker attesting replacement bytes. Keep capture-only v1 markers distinct from authenticated markers and preserve live-only v1 authentication upgrades. Keep compatibility exports in browser-login so unrelated callers need no import churn. Give the verification path an explicit evidence-bearing API rather than silently rereading the destination. Do not describe the comparison as a portable atomic compare-and-swap.

**Benefit:** fixes evidence misattribution and moves marker migration, size limits, digest checks and capability parsing out of the browser/process orchestration module. New capture sources can reuse a precise persistence contract without copying authentication rules.

**Write set:** `src/browser-login.ts`, new `src/browser-login-state.ts`, focused `tests/browser-login.test.ts` additions (or one dedicated state-contract test). Browser-worker/setup are read-only dependencies for this proposal. Parent should coordinate any future migration of the worker's writer API with its lane; it is not required to fix this asynchronous verification path.

**Smallest verification:** temporary files and a deferred injected verifier: replace A with B after proving the verifier received A, then assert refusal and no newly trusted marker for B; unchanged snapshot succeeds; retain the existing capture-marker rejection/legacy reverification cases. No browser/provider. One focused command, **30-second maximum**.

## 12-accounts-auth-F2 — extract the account operation lease registry

**P2, architecture improvement; no new functional failure claimed.**

**Evidence:** the 1,500-line `launcher/electron/account-pool.cjs` combines routing/admission, persistence, workspace ownership, authentication orchestration and operation storage. The cohesive lease subsystem spans constructor fields `47-49`, label/conflict/read-write acquisition `233-321`, and cancellation/drain/destruction `1457-1493`. Read leases already have opaque tokens, idempotent release, cancellation callbacks and settlement promises; exclusive leases duplicate label validation and token release semantics. These are useful existing contracts buried inside the routing owner.

**Consumers inspected:** quota reads and Codex login call the public pool acquisition methods in `codex-account-tools.cjs`; authentication retry does so at `account-pool.cjs:625-673`; embedded/passkey/Chrome wrappers at `739-777,823-868` depend on the exact ownership distinction. Workspace mutation and admission also consult blockers (`135-174` and turn admission). This is not an invitation to unify every operation under a generic mutex.

**Change:** introduce `account-operation-leases.cjs` owning only the read/exclusive maps, printable label validation, exact-token release, read cancellation and bounded settlement. Keep public pool acquisition methods as façades. The pool must retain account existence checks, task/reservation/workspace blockers, destroyed/restart state, and explicit embedded-to-passkey handoff policy; run all those checks before registration with no intervening await. Expose narrow `readLabel`, `exclusiveLabel`, acquire/release and drain operations instead of mutable maps. Update internal map inspections to those methods. Preserve the current 10-second drain timeout and all existing error/selection behavior.

**Benefit:** new account reads and mutations get one lifecycle contract, while routing and workspace policy stay with their current owner. The extraction removes state management from a high-conflict file without shifting consent or task-admission authority into a generic abstraction.

**Write set:** `launcher/electron/account-pool.cjs`, new `launcher/electron/account-operation-leases.cjs`, one focused lease contract test. This lane must be the **sole account-pool writer**; other lanes touching admission/workspaces provide patch requirements to the parent/owner, not concurrent edits. No browser-host or codex-account-tools edits required.

**Smallest verification:** exact-token/idempotent release; multiple reads reject a mutation until all settle; cancellation awaits the captured read owners and times out without claiming settlement. Reuse the existing account-passkey-handoff cases to preserve owned-versus-foreign handoff. Fake owners/timers, **30-second maximum per focused command**; no queue/backend suite.

## 12-accounts-auth-F3 — fail closed when the owned Codex child does not stop

**P2, confirmed teardown-result defect.**

**Evidence:** `launcher/electron/codex-login.cjs:140-164` returns a boolean from each close wait, but discards the final wait result after SIGKILL. Consequently `stopOwnedChild` resolves successfully even if the exact child still has no terminal exit signal. `start` at `536-558` awaits that helper before replacing `flow` and spawning another app-server against the same `codexHome`. The wrapper's `starting` guard prevents ordinary concurrent starts (`codex-account-tools.cjs:260-280`), but does not repair this false successful-stop receipt. `destroy` also relies on the helper (`codex-login.cjs:658-662`).

**Trigger:** an owned child remains unconfirmed after all bounded stop attempts. The previous flow can be terminal while its process still exists; the next start then creates another shared-auth-store owner. No such OS failure was induced in this review.

**Change:** make final unconfirmed termination reject with a fixed safe cleanup error. Retain the old flow/child reference and block replacement until its exit is established. Deduplicate overlapping stop calls per child so failure/cancel/reconcile/start join one teardown operation. Preserve reconciliation outcomes separately from cleanup: never turn uncertain/committed auth into “not completed” merely because stopping failed. Audit the existing swallowed cleanup catches at `282-291,398-399` so they cannot authorize replacement; start/destroy must consume the actual stop result. This can remain inside codex-login; no new cross-application process framework is needed.

**Write set:** `launcher/electron/codex-login.cjs`, a dedicated mocked-child teardown regression file. Parent coordinates wrapper changes only if necessary to expose cleanup status; that neighboring file is not claimed here.

**Smallest verification:** mocked owned child and controlled timers: final stop timeout forbids a second spawn and causes destroy to reject; observed exit permits retry; overlapping stop requests share teardown. Preserve existing cancellation/committed-identity reconciliation assertions. **30-second maximum**, no real process termination or authentication.

## Implementation handoff

The three write sets are disjoint within this lane. Implement snapshot-bound evidence first, then lease extraction and Codex teardown. Reserve account-pool exclusively for this owner and integrate neighboring changes serially. No UI change is proposed: this lane's benefits are accurate readiness evidence, preserved account ownership and a smaller extension surface. Runtime/UI verification remains the parent's plan; these findings establish source behavior only.
