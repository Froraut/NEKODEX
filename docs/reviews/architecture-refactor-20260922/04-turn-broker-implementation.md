# Lane 04 implementation — broker and environment authority

All three source-grounded architectural findings are implemented. The review was read in full, then its ownership/lifecycle/authority claims were checked against the actual source before extraction. These were maintainability findings, not newly reproduced functional defects. Existing public imports, constructors and function signatures remain compatible; the local `TurnBroker` class retains its identity.

## Finding disposition

| Finding | Disposition | Implementation and evidence |
| --- | --- | --- |
| F1: protocol/client separation | Implemented | `turn-broker-protocol.ts` owns shared types, a single method-to-fields table deriving the decoded request union and method guard, protocol version 5, frame/request-ID limits and response-envelope accounting. `turn-broker-client.ts` owns the generic helper, timeout class and remote owner. The old facade re-exports public types and client values. Decoding now checks recognized field shapes before method-specific dispatch; required-field and capability authorization remain in the broker. Rejected packets preserve valid request IDs. Local socket scenarios cover remote registration/invocation, malformed method, cancellation after server receipt and close without response. |
| F2: owned operation retention | Implemented | `OwnedToolOperationStore` owns records, fingerprints, result snapshots, delivery acknowledgement, status projection, retention limits, expiry, replay guards and poll waiters. The broker retains binding authorization and all queue/delivery/detached-call effects. The store receives a synchronous revision callback and a narrow invocation-membership predicate for completion fencing, never channel objects. Behavioral tests cover exact and mismatched retries, the completion microtask interval, terminal acknowledgement, queued/dispatched cancellation, late owner completion and fake-clock expiry. |
| F3: authority/persistence separation | Implemented | `resolveThreadEnvironment` accepts only cache-read and rollout-resolution dependencies and returns an environment plus optional persistence thread ID. The store applies persistence once, outside the resolution exception handler. Resolution order remains Hermes, direct trusted envelope, recognized current-claim recovery, eligible same-thread cache and parent inheritance. Only the recognized missing-trusted-environment error permits recovery; current invalid claims remain fail-closed. Selected existing temporary-state/rollout tests and the new Hermes dependency-boundary test pass. |

No finding was rejected. No caller edits were necessary.

## Preserved boundaries

- Protocol version remains 5. The client transport implementation retains physical-close settlement for ordinary calls, complete-frame settlement for null-timeout calls, abort listener/socket cleanup, response ID checks and size bounds. Windows pipe behavior was preserved by source extraction, not tested on Windows.
- Broker authorization remains independent of packet decoding. The permissive generic call input remains compatible; decoded server requests are method-keyed. Malformed recognized field types now fail at the protocol boundary rather than flowing into mutation code.
- Retention constants remain 64 live/unacknowledged operations, 4096 identity guards per turn, 30 minutes for terminal payloads and 128 MiB per-turn retained payload budget. Transport-envelope checks remain in terminalization. These constants and code paths were inspected; no large-payload or 4096-operation stress run was performed.
- Expiry retains the operation identity and delivery ID. Terminal results continue blocking completion until exact acknowledgement. Synchronous completion still sees a running operation between invocation removal and its promise reaction.
- Cancellation before dispatch removes queued work; cancellation after dispatch only ends observation and records detached-call identity so late completion is accepted and ignored.
- Environment persistence retains its original cache refresh, TTL, merge and lock algorithms. Tools are taken from the current request and are never persisted. Hermes returns no persistence request and never consults native cache or rollout dependencies.
- Native rollout verification and WeakSet message provenance were not changed. Request/message object identity is preserved by the moved projection code. Lane 06's `environment.ts` facade remains the import boundary, including the same `MissingTrustedCodexEnvironmentError` constructor.

## Focused verification

All invocations completed well below 30 seconds; asynchronous test timeout was 5000 ms. No package/repository suite, typecheck, build, app launch, provider/account call or release operation was run.

1. `bun test tests/turn-broker-lifecycle.test.ts -t 'an unbounded broker call fails when the broker closes without answering' --timeout 5000`
   - **1 pass**, 12 filtered, 0 failures; 18 ms reported.
2. `bun test tests/lane04-turn-contracts.test.ts --timeout 5000`
   - Initial focused pass: **5 pass**, 0 failures, 40 ms.
   - After protocol ID preservation and narrower store waiter/membership contracts: **6 pass**, 0 failures, 30 assertions, 99 ms.
   - Cancellation explicitly awaits server receipt before aborting, then observes server-side physical socket destruction. This establishes the injected cancellation boundary rather than merely testing pre-abort rejection.
3. `bun test tests/environment.test.ts tests/subagent-environment-history.test.ts -t 'does not borrow authority across threads or hide an invalid trusted update|recovers the exact current child rollout before stale cache using custom state storage|fork-context child accepts its inherited parent visualization root|persists the trusted first-turn authority' --timeout 5000`
   - **4 pass**, 54 filtered, 0 failures, 10 assertions, 41 ms.
   - Covers invalid current authority, current rollout recovery with current tools, parent-history acceptance and persistence without tool declarations.
4. `bun test tests/lane04-turn-contracts.test.ts -t 'cancellation closes an unbounded call' --timeout 5000`
   - **1 pass**, 5 filtered, 0 failures, 139 ms, after replacing the fixture's Promise.withResolvers usage with ES2023-compatible deferred promises.

A scoped diff-whitespace check during implementation identified an extra EOF blank line in `turn-broker.ts`; it was normalized as requested by the parent. Final global diff hygiene and integrated typing remain parent-owned. Existing shared tests were not edited or replaced with source-text assertions.

## Exact changed paths

- `src/adapters/chatgpt-web/turn-broker.ts`
- `src/adapters/chatgpt-web/turn-broker-protocol.ts` (new)
- `src/adapters/chatgpt-web/turn-broker-client.ts` (new)
- `src/adapters/chatgpt-web/turn-broker-owned-operations.ts` (new)
- `src/adapters/chatgpt-web/thread-environment.ts`
- `src/adapters/chatgpt-web/thread-environment-resolver.ts` (new)
- `tests/lane04-turn-contracts.test.ts` (new, lane-owned)
- `docs/reviews/architecture-refactor-20260922/04-turn-broker-implementation.md` (new)

## Integration constraints

No cross-lane API change is required. Parent must include the new modules in its integrated type/build checks and preserve the facade exports. Remaining platform validation is parent-owned; loopback tests ran on this macOS host, not Windows. No changes were made to other owners' files or shared tests. No commit, push, branch switch, app launch, install, release or additional agent dispatch occurred.

## Parent integrated-typecheck follow-up

The parent's core TypeScript check found a retained local socket-ownership probe still using `createConnection`, whose import had moved out with the client extraction. Restored that import in `turn-broker.ts`; its typed socket also restores inference for the downstream error callback. The parent also identified Bun matcher inference failures for unspecified generic call results in the lane-owned tests. Those calls now explicitly request `BrokerOwnedOperationSnapshot`, including both sides of retry/late-result comparisons, without result casts or weakened assertions.

After correction: `bun test tests/lane04-turn-contracts.test.ts --timeout 5000` — **6 pass, 0 fail, 30 assertions, 35 ms**. No global typecheck was rerun. Source is settled again for parent integration; the reported TypeScript corrections await the parent's integrated confirmation.
