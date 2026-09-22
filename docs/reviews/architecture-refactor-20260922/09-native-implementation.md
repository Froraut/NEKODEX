# Lane 09-native implementation — wave 2

Baseline and final checked HEAD: `53d17361f3e9c81910055a7e2c18759ffce458bc`; branch `codex/architecture-refactor-20260922`. Shared worktree `/Users/alex/Dev/nekodex-refactor-20260922`. Read the complete lane review and `right-size-test-runs` before implementation. Independently checked the relevant source and consumers. All findings accepted; no cross-lane writes required.

## Finding disposition

- **F1 implemented.** The original forwarding function combined body/history adaptation, HTTP orchestration and two stream inspectors. `native-request-preparation.ts` now owns body preparation and local continuation/artifact adaptation. Its discriminated result distinguishes original bytes, rewritten JSON and local rejection. Decoded local metadata does not force reserialization. `native-response-body.ts` owns byte-preserving stream wrapping and a bounded internal terminal inspector whose inputs are chunks/end-of-input, independent of delivery, wall-clock timing and stream ownership. Exact `[DONE]` detection still authorizes only unclean-close tolerance; Responses terminals authorize usage outcomes separately. `native-passthrough.ts` remains the 162-line HTTP orchestration facade, with the original exported functions/types preserved through re-exports.
- **F2 implemented.** Previously, a cold caller awaited `routes.resolve()` before checking cancellation. A local `waitForRoute` now checks the caller signal first, rejects with its reason promptly, and removes its abort listener on abort/resolution/rejection. Shared cache refresh retains its independent two-second control deadline. Caller cancellation does not poison the route cache or cancel the launcher request. The final pre-dispatch signal check remains.
- **F3 implemented.** `usage/native-contract.ts` is a runtime leaf module with event types, receipt validation, normalized token constraints and separately named strict provider-model sanitization. Provider snake_case mapping uses the same normalized validator as persistence. Delivery re-exports existing public types; outbox depends directly on the contract instead of delivery. Receipt UUID-v4 acceptance, token limits/relationships, own required fields, terminal-state rules and stricter provider model acceptance are preserved. Outbox filename validation, 23-hour pruning, capacity, atomic writes and acknowledgements remain storage-owned. The Electron validator remains independently implemented.

No bridge rewrite, launcher proxy changes, retries, server/Responses signature changes or receipt-schema migration were introduced.

## Focused verification and results

Commands below were invoked from the shared worktree through Python `subprocess.run([...], timeout=N, check=True)`; command-level bounds were 10 seconds for cancellation and 30 seconds for other invocations. Bun cases used the explicit timeouts shown. No full test suite, typecheck or build was run.

1. `bun test tests/native-network-cancellation.test.ts --timeout 2000` — **2 passed**, 21 assertions, 136 ms on the corrected fixture. Both cases establish exactly one pending launcher control request before aborting A. A settles before the deferred control response; the control signal remains live. Success dispatches only B. Rejection makes B and a subsequent caller fail closed, with no provider dispatch. Listener removal is observed on abort and both settlement paths.
   - Initial fixture run: 1 passed / 1 failed because the second case reused the first case's now-warm URL cache; the expected cold control boundary was not reached. Changed fixture URLs to unique exact URLs for the two cases, then reran this file. This was test isolation, not a production behavior workaround.
2. `bun test tests/native-request-preparation.test.ts tests/native-transport-terminal-contract.test.ts tests/native-wave3-receipts.test.ts tests/native-usage-delivery.test.ts tests/native-transport-response-encoding.test.ts --timeout 5000` — **10 passed**, 107 assertions, 2.13 s. At this point preparation had two cases. Covered original gzip bytes despite decoded ownership metadata, opaque image bytes, terminal/byte identity, missing terminal, invalid historical receipt removal, producer/outbox/real receiver compatibility, terminal-before-cancel with invalid usage, durable replay/duplicate acknowledgement, and real loopback automatic decompression/downstream headers. The existing delivery test uses temporary child Bun processes and loopback only.
3. `bun test tests/native-passthrough.test.ts tests/backend-review-regressions.test.ts --test-name-pattern 'forwards native Codex requests verbatim|removes ChatGPT Web item identities|keeps native encrypted reasoning|upstream reset|native continuation expands|chunk-split oversized native terminal' --timeout 5000` — **8 passed**, 14 filtered out, 31 assertions, 216 ms. Covers facade compatibility, local replay, artifact identity removal, native encrypted body identity, bounded oversized terminal observation, post-DONE reset tolerance, pre-DONE failure and a `[DONE]` substring without terminal authority.
4. After adding the third preparation contract: `bun test tests/native-request-preparation.test.ts --test-name-pattern 'retained local owner mismatch' --timeout 5000` — **1 passed**, 2 filtered out, 7 assertions, 172 ms. Verifies a real locally retained state and owner scope before checking 409 owner mismatch and zero dispatch; unknown native IDs retain original bytes.
5. After restoring the validator's explicit own-required-field guard during diff review: `bun test tests/native-wave3-receipts.test.ts --test-name-pattern 'replay discards receiver-invalid' --timeout 5000` — **1 passed**, 1 filtered out, 15 assertions, 146 ms. Focused receipt-path follow-up only.
6. `git diff --check -- src/native-network.ts src/native-passthrough.ts src/native-usage-outbox.ts src/native-usage-telemetry.ts` — passed. Reviewed the new modules and the final facade against the original implementation for extraction boundaries and retained exports.

**21 unique behavioral tests passed**, plus one targeted follow-up rerun. Expected `native_usage_telemetry_dropped reason=storage` warnings occur in forwarding fixtures without a configured durable receiver; receiver persistence is covered separately by the temporary outbox/delivery tests. These are source/local fixture results, not live provider evidence.

## Exact changed paths owned by this lane

- `src/native-network.ts`
- `src/native-passthrough.ts`
- `src/native-request-preparation.ts` (new)
- `src/native-response-body.ts` (new)
- `src/native-usage-outbox.ts`
- `src/native-usage-telemetry.ts`
- `src/usage/native-contract.ts` (new)
- `tests/native-network-cancellation.test.ts` (new)
- `tests/native-request-preparation.test.ts` (new)
- `docs/reviews/architecture-refactor-20260922/09-native-implementation.md` (new)

## Integration constraints

Parent retains integrated typechecking/build/UI ownership. Existing imports from `native-passthrough` and telemetry event-type imports need no migration. No known cross-lane source changes are required. Related Responses, launcher-host and usage-store files changed concurrently by their owners; this lane preserved their public boundaries and did not edit them. The independent receiver compatibility tests passed against the receiver available at test time; subsequent cross-lane receiver changes remain part of parent integration.

No commits, pushes, branch switches, app launches, live accounts/providers, installations/releases or additional agents were used.

## Parent integration follow-up: Bun fetch mock type

Parent's integrated core tsc found that the cancellation fixture's bare async fetch implementation lacked Bun's required `fetch.preconnect` property. Updated only `tests/native-network-cancellation.test.ts`: a `typeof fetch` mock uses `Parameters<typeof fetch>` for its call arguments and `Object.assign` to preserve the original `preconnect` property. No `any` or assertion casts were added.

Focused rerun: `bun test tests/native-network-cancellation.test.ts --timeout 2000`, bounded by Python `subprocess.run(..., timeout=10, check=True)` — 2 passed, 0 failed, 21 assertions, 132 ms. No global tsc was run; parent owns confirmation in the integrated typecheck.
