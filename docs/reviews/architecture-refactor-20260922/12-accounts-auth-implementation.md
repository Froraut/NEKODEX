# Lane 12 — accounts/auth implementation

Worktree: `/Users/alex/Dev/nekodex-refactor-20260922`.
Reviewed baseline: `53d17361f3e9c81910055a7e2c18759ffce458bc`.
All F1–F3 findings independently confirmed and implemented. No application, account/provider, release, installation, commit, push or additional agent was used. Integrated types/build/rendered UI remain the parent's coverage.

## Finding disposition

### F1 — implemented

The original asynchronous verifier received a storage path, then the marker writer reread and hashed the destination. This could bind inspected A's capabilities to replacement B's digest.

`browser-login-state.ts` now owns bounded state/marker reads, digest validation, capability parsing and authenticated-v1 migration eligibility. `verifyBrowserLoginSnapshot` reads one validated text snapshot, checks its marker, and passes parsed snapshot data to its narrow injected verifier. Publication requires the explicitly supplied verified text, checks the destination still matches, and derives evidence only from that text. A replacement after comparison can only yield a digest mismatch for replacement bytes; this is not atomic compare-and-swap. The interactive login path likewise supplies its inspected state's serialized text.

Existing public exports remain available from `browser-login.ts`. The two-argument compatibility writer remains for existing synchronous callers (including the worker); the asynchronous path uses the separate required-evidence API. Capture-only v1 markers remain ineligible; authenticated v1 markers upgrade only after successful inspection. No worker/setup edits. Capability reads now validate the same marker instance from which they extract capabilities.

### F2 — implemented

`AccountOperationLeases` owns private exclusive/read maps, printable labels, exact-owner/idempotent release, read cancellation and bounded settlement (default remains 10 seconds). Pool public acquisition methods remain facades. Account existence, destroyed/paused checks, account/workspace/task conflicts and embedded/passkey policy remain in the pool; registration follows those checks synchronously. No other production `launcher/electron/*.cjs` references to the removed maps were found.

The lease API exposes labels and acquisition/drain/destruction, not mutable maps. A timed-out read remains a mutation blocker. Destroy preserves prior synchronous cancel-and-clear behavior without claiming settled reads.

### F3 — implemented

The last close wait really was discarded. Teardown now has one cached promise per exact child, including a failed receipt until that child has observable termination. Failure raises fixed `codex_cleanup_failed`, retains the flow/child, and prevents start from spawning a replacement. Destroy consumes the failure. Close observation or terminal exit/signal permits retry.

Cleanup status is additive and separate (`cleanupError`) from `error`, phase and `authOutcome`. Reconciliation's background cleanup catch retains the cleanup failure for start/destroy and status, without changing committed or uncertain auth to not-completed. Background timeout/ownership cancellation catches avoid newly unhandled cleanup rejections. No process framework or wrapper edits.

## Focused checks and outcomes

All invocations completed in under one second; all test invocations used a 30-second test timeout. No package/repository suite, typecheck or build was run.

1. `node --test --test-timeout=30000 launcher/tests/account-operation-leases-contract.test.cjs launcher/tests/account-passkey-handoff.test.cjs`
   - New lease contracts: **3 passed** (multiple reads/exact release, cancellation awaits release, timeout retains owner).
   - Existing handoff file: **1 passed, 3 failed**. Its manually constructed pool omits `pendingAffinity` (and subsequent required maps). Failure occurs before handoff; it is not valid evidence against the lease extraction.
2. `bun test tests/browser-login-state-contract.test.ts tests/browser-login.test.ts --test-name-pattern 'deferred verifier|unchanged snapshot|capture-only marker|legacy login evidence|stored login capabilities' --timeout 30000`
   - **5 passed**, 4 unrelated browser-launch cases filtered out, 27 assertions. Repeated only after changing the snapshot eligibility/capability helpers; final result stayed 5/5.
   - Deferred verifier asserts it received A before replacement B is written; rejection leaves the prior marker unchanged and B untrusted. Unchanged state succeeds. Capture-only markers never reach the injected verifier; authenticated legacy markers upgrade only after it runs.
3. `node --test --test-timeout=30000 launcher/tests/codex-login-teardown-contract.test.cjs launcher/tests/account-pool-leases-handoff-contract.test.cjs`
   - **5 passed** at this point: 3 handoff scenarios and 2 teardown scenarios.
   - Dedicated handoff fixture supplies all required maps and the new registry; it exercises the original three useful behavioral scenarios without editing shared tests. Owned successor protection and foreign-operation rejection are preserved.
4. `node --test --test-timeout=30000 launcher/tests/codex-login-teardown-contract.test.cjs`
   - **3 passed** after adding the uncertain-cancellation case. Fake-child/controlled-timer tests assert each stop-wait boundary and the exact signalled child. They prove one teardown for overlapping fail/start/destroy; no second spawn on failure; destroy rejection; observed exit permits retry; confirmed cancellation, committed identity and uncertain cancellation keep their respective outcomes.
   - Filesystem/process boundaries are mocked: no real Codex child, auth store or process signalling.
5. `node /tmp/lane12-baseline.cjs`
   - **Passed**, printed `BASELINE_CONFIRMED: existing handoff fixture omits required pendingAffinity`.
   - This temporary focused probe loaded `git show 53d17361f3e9c81910055a7e2c18759ffce458bc:launcher/electron/account-pool.cjs` through VM with its local require resolver, constructed the old fixture's maps/host/registry, and asserted `acquireAccountOperation('default', 'login')` throws `this.pendingAffinity is not iterable`. No baseline source was written into the worktree.
6. `git diff --check -- src/browser-login.ts src/browser-login-state.ts launcher/electron/account-pool.cjs launcher/electron/account-operation-leases.cjs launcher/electron/codex-login.cjs`
   - Passed. Manual review confirmed preserved exports, synchronous admission checks, unchanged handoff methods and retained teardown identity.

7. Authorized fixture-maintenance follow-up:
   `node --test --test-timeout=30000 --test-name-pattern='secondary account owns passkey|owned embedded login hands off|unrelated account operation|workspace identity mutation' launcher/tests/account-passkey-handoff.test.cjs launcher/tests/browser-workspace-account-gate.test.cjs`
   - **5 passed**, zero failures, approximately 53 ms. Only the three affected handoff and two account-gate cases were selected; the unchanged browser-host case was not rerun.
   - Repaired the existing handoff fixture's missing maps and replaced private-map assertions with public lease admission/status behavior. Removed the duplicate new handoff file.
   - Migrated workspace gate fixtures to pool prototypes and public lease acquisition. Exclusive and read owners are acquired sequentially, respecting their mutual exclusion, then independent task/login/network owners are added for blocker enumeration. The test checks the exclusive blocker explicitly and the exact quota-read blocker without invoking cancellation.

Final focused passing coverage: **16 cases** (5 state/marker, 3 leases, 3 handoff, 2 workspace account gate, 3 Codex teardown). Earlier baseline fixture failures are repaired in the final tree; duplicate handoff tests have been removed. Counts do not include reruns twice.

## Exact changed files (lane-owned only)

- `src/browser-login.ts`
- `src/browser-login-state.ts` (new)
- `launcher/electron/account-pool.cjs`
- `launcher/electron/account-operation-leases.cjs` (new)
- `launcher/electron/codex-login.cjs`
- `tests/browser-login-state-contract.test.ts` (new)
- `launcher/tests/account-operation-leases-contract.test.cjs` (new)
- `launcher/tests/account-passkey-handoff.test.cjs` (existing fixture repaired with parent authorization)
- `launcher/tests/browser-workspace-account-gate.test.cjs` (existing private-map fixture migrated with parent authorization)
- `launcher/tests/codex-login-teardown-contract.test.cjs` (new)
- `docs/reviews/architecture-refactor-20260922/12-accounts-auth-implementation.md` (new)

## Integration constraints for parent

- The two parent-selected legacy fixtures are now migrated and passing. Other legacy prototype fixtures that directly populate `accountOperations`/`accountReadOperations`, if selected later, should seed leases through public acquisition APIs. They were not part of this follow-up.
- The temporary `launcher/tests/account-pool-leases-handoff-contract.test.cjs` was removed after consolidating its useful coverage into the existing handoff fixture. Earlier command results above document the original sequence, not outstanding failures.
- `cleanupError` is an additive controller status property. Renderer typing/presentation, if desired, belongs to its owner; prevention of replacement and destroy rejection are effective without UI consumption.
- Existing worker marker persistence retains its compatibility writer. A broader writer migration is outside this lane and not required for the fixed asynchronous verification race.
- Source and controlled fixtures only. No installed/released/live-provider or UI claim.
