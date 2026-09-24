# Lane 09-native — architecture review, wave 1

Baseline: `53d17361f3e9c81910055a7e2c18759ffce458bc`, confirmed at review start. Read-only source review; only this report was written. **No tests, builds, apps, accounts, provider calls or subagents were run.** Proposed verification follows `right-size-test-runs`; integration, builds/UI checks, Git and publication belong to the parent.

## Existing fixes and scope

Read the native sections of `docs/reviews/app-improvements-20260922.md`, `app-improvements-wave3-20260922.md`, and `app-improvements-waves4-5-20260922.md`, then checked implementation and callers. Already fixed: successful SSE receipts no longer acquire a protocol failure; invalid historical receipts and invalid token relationships are discarded; decoded response headers lose content-encoding; detached fallback is exact-URL, lease-bounded and preserves rejection; bootstrap/PAC leases do not authorize indefinite background operation. These are regression constraints, not new findings.

Three worthwhile changes follow: two architecture improvements and one source-confirmed cancellation-latency defect. No claim of a newly discovered unauthorized dispatch, duplicate provider work or current usage loss.

## 09-native-F1 — Separate request preparation, byte-stream handling and usage observation

**Priority/type:** P2, bounded architectural improvement.

**Evidence:** `src/native-passthrough.ts:48-167` implements local continuation/artifact policy; `:184-460` interprets usage and terminal states; `:472-536` tolerates unclean SSE closure; `:538-709` additionally owns authentication, body reading, endpoint-specific preparation, transport dispatch and response wrapping. The 709-line file therefore couples adding an endpoint to provider-history compatibility and two independent stream inspectors. This is a concrete extension-cost problem even where current behavior is correct.

Callers establish important differences: `src/server.ts:498-537` already parses Responses JSON and passes both a retained encoded request and decoded body; the compact caller `:843-881` additionally injects header-derived local ownership metadata into decoded JSON. Search calls forwarding directly (`:452-461`), while images have their own opaque-body path (`:465-478`). A refactor must not assume decoded JSON is always an exact representation to serialize back upstream.

**Change:** Extract `src/native-request-preparation.ts` for endpoint/body preparation and continuation adaptation, retaining an explicit result distinguishing original encoded bytes, rewritten JSON and local rejection. Extract `src/native-response-body.ts` for unclean-close tolerance and telemetry observation, with a small internal pure terminal inspector fed chunks/end-of-input. Keep `native-passthrough.ts` as orchestration and retain its exported entry points/re-exports so server callers and existing focused tests need no API migration. Keep transport ownership in `native-network.ts`; do not introduce native POST retries.

The two response inspectors must retain separate authority: an exact `[DONE]` line permits unclean-close tolerance, while a Responses terminal determines usage outcome. Do not replace these with one generic “finished” flag. Preserve byte identity, bounded inspection, telemetry failure isolation, terminal-before-cancel authority, manual redirects, decoded response headers, opaque image handling and unknown native continuation IDs.

**Benefit:** New endpoint handling can change independently of usage parsing; terminal interpretation can evolve without editing request replay/ownership logic. This is responsibility extraction, not an endpoint plugin framework.

**Owned writes:** `src/native-passthrough.ts`, new `src/native-request-preparation.ts`, new `src/native-response-body.ts`; existing native passthrough/terminal/encoding tests only if their behavioral coverage needs adjustment. No `server.ts`, continuation-state or compaction implementation edits. Cross-lane: Responses/compaction owner retains those algorithms and `bridge.ts`; preserve their exported contracts.

**Smallest verification:** Selected existing passthrough cases for unchanged encoded body, local replay rejection/rewriting and opaque images; selected terminal/encoding cases for exact bytes, terminal-before-cancel, pre/post-DONE reset and decoded headers. Reuse existing fixtures rather than asserting new file structure. Per-case timeout 5 seconds, one focused command maximum 30 seconds; parent chooses the combined coverage selection.

## 09-native-F2 — Cancel a caller's cold-route wait without canceling shared resolution

**Priority/type:** P2, source-confirmed cancellation latency; not a route bypass.

**Trigger/evidence:** A request without a usable route starts or joins a pending launcher resolution, then its incoming signal aborts. `src/native-network.ts:122-149` awaits `routes.resolve()` before checking the request signal; its control fetch uses only the independent two-second timeout (`:124-129`). `src/native-route-cache.ts:27-46` deliberately shares the refresh promise. Consequently cancellation cannot settle this request until that unrelated shared operation resolves/rejects, potentially the remainder of two seconds. If resolution succeeds, the final signal check prevents upstream dispatch; that protection is already correct.

**Change:** Add a narrow abort-aware wait around the caller-facing route promise, with an initial signal check, listener cleanup on either settlement, and rejection using the caller's abort reason. Keep the shared refresh running under its own existing deadline so another waiter and cache maintenance remain valid. Do **not** combine the first caller's signal into the shared control fetch, record caller cancellation as route rejection, or invalidate a warm lease. Retain the final pre-dispatch abort check.

**Benefit:** Cancellation becomes prompt while shared route ownership, refresh coalescing and fail-closed policy remain intact. No launcher IPC changes are needed.

**Owned writes:** `src/native-network.ts` and new `tests/native-network-cancellation.test.ts`. Prefer a local helper; do not turn this into a repository-wide asynchronous-operation abstraction. `native-route-cache.ts` behavior can remain unchanged. No overlap with F1/F3 source files.

**Smallest verification:** One controlled two-waiter scenario: establish a cold shared control request, abort waiter A before resolving it, observe A reject before resolution, then resolve for B and assert exactly one control call and only B's provider dispatch. Add rejection cleanup assertion if needed. Use a deferred fake transport, no real accounts or network; 2-second case timeout and 10-second command cap. The test must reach the shared wait before cancellation.

## 09-native-F3 — Give runtime usage receipts a standalone contract module

**Priority/type:** P2, maintainability and future schema changes.

**Evidence:** Runtime event types live in the delivery implementation (`src/native-usage-telemetry.ts:6-33`); the durable outbox imports those types back from its consumer (`src/native-usage-outbox.ts:3`). Persistence also owns receipt schema, terminal-state and token validation (`:7-40`), while provider usage normalization repeats numeric/relationship policy in `src/native-passthrough.ts:184-224`. The launcher independently validates the actual boundary in `launcher/electron/usage-store.cjs:104-155`, followed by its delivery-window check at `:555-562`. Recent documented receipt repairs already required keeping these surfaces aligned.

**Change:** Introduce `src/usage/native-contract.ts` containing runtime event types, receipt validation and normalized token constraints. Have outbox and delivery depend on this leaf module; F1's response observer uses the same normalized token validation after mapping provider snake_case fields. Keep provider model sanitization separately named and preserve its current stricter acceptance; do not silently broaden identifiers or UUID versions. Outbox-specific filename UUID policy, 23-hour pruning, capacity, atomic persistence and acknowledgements remain in the outbox.

Do not make Electron import Bun/TypeScript runtime modules. Preserve the independent launcher validator and the existing producer/outbox/receiver compatibility fixture (`tests/native-transport-terminal-contract.test.ts`). The invariant is that producer-emitted, persisted receipts are receiver-acceptable, not that both validators accept identical historical input domains. A cross-runtime schema packaging project is unnecessary for this change.

**Benefit:** Schema changes have one runtime home; storage no longer depends on delivery-layer types, and parsing shares token constraints without sharing persistence or retry machinery.

**Owned writes:** `src/native-usage-outbox.ts`, `src/native-usage-telemetry.ts`, new `src/usage/native-contract.ts`, plus the F1-owned response observer import wiring under the **same lane implementation owner**. Preserve type re-exports for external imports. No launcher store/control-server or `src/usage/totals.ts` edits. Cross-lane usage/UI owner retains receiver aggregation and display policy.

**Smallest verification:** Reuse selected existing terminal-contract and wave3-receipt cases proving invalid usage preserves terminal outcome, incompatible replay records are removed, and emitted receipts pass the real receiver validator; retain the existing durable replay/duplicate-ack case. No new broad schema matrix. Five-second cases, focused command cap 30 seconds, shared with F1 so passing checks are not duplicated.

## Ownership and deliberate non-changes

Assign all three findings to **one 09-native implementation owner**; F1 and F3 intentionally compose through the new response observer and must not be parallel-written. Their union is disjoint from server routing, launcher usage/UI and Responses/compaction ownership. Reviewed `src/bridge.ts` cancellation/terminal paths and `src/usage/totals.ts`: keep the existing post-await cancellation protection, Windows-specific stream driving and display-total semantics. No additional bridge rewrite is proposed here. `launcher/electron/native-proxy.cjs` already separates PAC interpretation, exact first-party resolution and launcher-child environment policy; no change justified in this lane.
