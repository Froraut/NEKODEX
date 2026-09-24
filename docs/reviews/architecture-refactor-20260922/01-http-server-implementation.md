# Lane 01 — HTTP server implementation

Baseline reviewed: `53d17361f3e9c81910055a7e2c18759ffce458bc`. Work performed directly in the shared `codex/architecture-refactor-20260922` worktree. No commits, pushes, application launches, real providers/accounts, installs, releases, or additional agents. Only isolated in-process/loopback fixtures and fake adapters/upstreams were used.

## Finding disposition

- **F1 implemented.** Independently confirmed that compact decoded the request and then rebuilt plain JSON with the original compressed representation headers before a second decode. `createInternalJsonRequest` preserves semantic headers and the abort signal, deletes content-encoding/content-length, and sets JSON content type. Only the Web compact-to-response boundary uses it. The native branch remains opaque: the test observes identical compressed bytes and zstd encoding at the fake upstream. Identity-encoded and zstd Web cases each reach the adapter exactly once, retain canonical header identity, and return the expected compact summary. The helper separately checks removal of both stale headers and abort propagation.
- **F2 implemented.** Independently confirmed the unconditional resume assignment and the gap before scheduled shutdown. `ServerAdmission` owns running, reversible draining, and irreversible shutting-down states. Idle admin shutdown commits synchronously before scheduling cleanup; the signal handler commits on entry. Native/Web readiness and external broker acceptance use this state. Resume returns HTTP 409 after shutdown is committed. Existing cleanup ordering and settlement remain intact. A held physical compaction cleanup proves that the real shutdown handler aborts its owner, leaves the listener available for control inspection, rejects resume/new native work with zero upstream calls, and stops only after cleanup is released. Same-timer direct server dispatch proves the admin acknowledgement window is closed. Ordinary drain/resume is verified with a real fake-upstream native request after resume.
- **F3 implemented.** Moved the complete transport ownership implementation, identity/evidence types, and diagnostic isolation into `http-turn-lifecycle.ts`. Existing server exports remain compatible. Source comparison against baseline confirmed that the extracted block is unchanged except for exporting its endpoint type and adding its type-only native endpoint import. `server-route-policy.ts` defines exact public inference method/path, JSON requirement, endpoint identity, and admission category. JSON policy and tracked endpoint labels derive from these descriptors; a narrow `trackInference` function centralizes initial admission and transport tracking. Responses/compact share option wiring and retain their Web admission callback after body decoding. Host/origin checks and Hermes/control authorization stay explicit. Native image media-type behavior remains compatible, including multipart edits; this extraction deliberately does not introduce a new JSON restriction for image generation.

No findings were rejected. No service, supervisor, event-queue, adapter, or native transport changes were needed. A follow-up explicitly assigned this lane the single stale model-catalog drain test in `tests/server-lifecycle.test.ts`; only that named test was updated.

## Focused verification and outcomes

All test cases use a 5-second timeout. Every invocation completed in under one second; no full test/typecheck/build pipeline was run.

1. `bun test tests/server-compaction-http-body.test.ts tests/server-shutdown-admission.test.ts --timeout 5000`
   - Initial fixture run: 4 pass, 2 fail. Both shutdown cases passed, as did native compressed passthrough and helper cancellation/header checks. Web fixtures failed before adapter dispatch because their user-message source revision was incomplete.
2. `bun test tests/server-compaction-http-body.test.ts --timeout 5000`
   - Fixture refinement: 2 pass, 2 fail. Adding turn metadata alone was insufficient: the input also needed explicit `type: message` and structured input text, matching the production parser contract. No source behavior was changed to accommodate the fixture.
3. `bun test tests/server-compaction-http-body.test.ts tests/server-route-policy.test.ts --timeout 5000`
   - **5 pass, 0 fail**, 27 assertions. Both corrected Web fixtures now assert adapter entry and identity, then verify compact output. Also verifies compressed native bytes, helper cancellation, native Responses availability while the Web tunnel is unavailable, rejection of Web work before adapter creation, and multipart image edits reaching fake upstream.
4. `bun test tests/server-lifecycle.test.ts tests/server-http-security.test.ts tests/backend-review-regressions.test.ts --test-name-pattern "HTTP turn tracking follows the response stream|HTTP turn cancellation aborts the tracked request|Windows-shaped delivery stays bounded|rejects rebinding Host values|rejects browser-safelisted body types|a drained runtime rejects new model-catalog" --timeout 5000`
   - **5 pass, 1 fail**, 46 filtered out. EOF ownership, cancellation settlement, Windows demand/backpressure, exact Host rejection, and JSON media-type boundary passed.
   - Existing `a drained runtime rejects new model-catalog work before shutdown` reached and passed its HTTP 503 assertion, then failed on an obsolete expected error string (`codex-chatgpt-web is draining for a requested service operation`). Baseline already contains the current string (`NEKODEX is restarting; retry after it is ready.`). At this initial run the shared test was outside lane ownership. The follow-up below resolves it under explicit ownership; the runtime error wording was not changed.
5. `bun test tests/server-shutdown-admission.test.ts --test-name-pattern 'ordinary drain resumes' --timeout 5000`
   - **1 pass, 0 fail**, 9 assertions, after strengthening this fixture with rejection during ordinary drain, zero upstream calls while drained, and actual successful native work after resume. The unchanged signal-cleanup case retains its successful evidence from invocation 1.
6. Source review/checks:
   - Python comparison of the extracted lifecycle block with `git show 53d17361f3e9c81910055a7e2c18759ffce458bc:src/server.ts`: identical after the stated type export/import adjustment.
   - Same baseline read confirms the drain error text already used the current wording.
   - `git diff --check -- src/server.ts src/http-body.ts`: clean.

7. Authorized follow-up: `bun test tests/server-lifecycle.test.ts --test-name-pattern '^a drained runtime rejects new model-catalog work before shutdown$' --timeout 5000`
   - **1 pass, 0 fail**, 40 filtered out, 8 assertions; 298 ms total.
   - Re-read the baseline admission response and current `formatErrorResponse`/`classifyError` contract: HTTP 503 maps to structured `server_error` / `server_is_overloaded`, independently of message wording.
   - Replaced only the named test's prose assertion. It now checks drain response admission flags; HTTP 503 and machine-readable error type/code; zero fake upstream calls despite supplying valid fixture authorization; health proving zero model-catalog requests/active HTTP turns with native/Web admission closed; and reopened admission after ordinary resume.
   - No source edits or unrelated test runs were made in this follow-up.

Final focused evidence: all **7 new behavioral cases** passed, plus **6 selected existing cases**. The selected stale test is resolved; no known selected-test failure remains. Native fake-upstream fixtures emitted storage-drop telemetry diagnostics; these were not real provider/account calls or a telemetry persistence check. Windows behavior was exercised through the existing platform-injected stream fixture, not a Windows OS runtime.

## Exact changed paths

- `src/server.ts`
- `src/http-body.ts`
- `src/http-turn-lifecycle.ts` (new)
- `src/server-admission.ts` (new)
- `src/server-route-policy.ts` (new)
- `tests/server-compaction-http-body.test.ts` (new)
- `tests/server-shutdown-admission.test.ts` (new)
- `tests/server-route-policy.test.ts` (new)
- `tests/server-lifecycle.test.ts` (only `a drained runtime rejects new model-catalog work before shutdown`, explicitly assigned follow-up)
- `docs/reviews/architecture-refactor-20260922/01-http-server-implementation.md` (this report)

## Integration constraints

- Parent owns integrated core/renderer types, builds and UI verification. None are claimed here.
- `responseRequest`, `compactRequest`, `HttpTurnCounter`, `NativeCodexTurnIdentity`, and `HttpStreamFailureEvidence` remain exported through `server.ts`; neighboring lanes need no synchronized import changes.
- No caller changes are required for the new HTTP 409: the reviewed service control helper already rejects non-OK responses. Parent/supervisor lane owns any optional user-facing compensation messaging. This lane did not test the supervisor.
- Shared `tests/server-lifecycle.test.ts` was changed only within the explicitly assigned drain/model-catalog test. Its stale wording assertion is resolved with structured/status/admission evidence; all other tests remain untouched by this lane.
- All fixture listeners and the fixture broker are stopped by their cleanup paths. No task-owned app/server remains running.
