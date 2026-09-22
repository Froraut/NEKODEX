# Lane 04 — turn broker, delegation, environment authority

Baseline inspected: `53d17361f3e9c81910055a7e2c18759ffce458bc`, in `/Users/alex/Dev/nekodex-refactor-20260922`.

Read-only source review. **No tests, builds, providers, accounts, apps or agents were run.** Only this report was written. Three bounded architectural improvements are recommended; none is presented as a newly reproduced functional defect. Parent owns acceptance, integration, build/UI planning, Git and publication.

Reviewed the delivered-change and resolution sections of `docs/reviews/app-improvements-20260922.md`, `app-improvements-wave3-20260922.md`, and `app-improvements-waves4-5-20260922.md`. Already completed compaction instruction preservation, current-input retention, cancellation-consumer checks and checkpoint ancestry fixes are not new findings here. Proposals preserve those semantics. `right-size-test-runs/SKILL.md` was read before the verification proposals below.

## 04-turn-broker-F1 — separate the broker protocol/client from turn state

**Priority:** medium; implementable maintainability improvement.

**Evidence / locations:** `src/adapters/chatgpt-web/turn-broker.ts:145-202` defines a single request interface with almost all fields optional; `1075-1083` independently repeats every allowed method; `1085-1471` combines decoding, authorization and mutation; `1734-2039` implements the socket client and remote owner alongside the server/state machine. Protocol version `5` appears separately in the status dispatcher and remote compatibility check (`1116-1117`, `1849-1854`). Adding an owner method currently requires coordinated edits across all these sections without a method-specific compile-time request contract.

**Caller inspection:** `src/adapters/chatgpt-web/mcp-server.ts:1215-1225` sends exact operation identities through `callTurnBroker`; the poll/cancel consumers at `1248-1254` and `1275-1280` share it. `src/dev-chat/driver.ts:423-424` constructs `RemoteTurnBroker`; `src/adapters/chatgpt-web/index.ts:381-383` distinguishes the concrete local broker with `instanceof TurnBroker`. Therefore keep the same class identity and public import surface.

**Concrete change:** extract `turn-broker-protocol.ts` for request/response types, a method-keyed request union, shared protocol version and framing limits; extract `turn-broker-client.ts` for `callTurnBroker`, its timeout error class and `RemoteTurnBroker`. Keep compatibility re-exports from `turn-broker.ts`. Make the allowed-method guard derive from the protocol's explicit method list, and narrow decoded requests before dispatch. Leave capability checks and state transitions in the broker; a typed packet is not an authority grant. Initially preserve the existing generic call helper API so MCP callers need no simultaneous rewrite.

This removes approximately 300 lines of transport/client concerns and makes the protocol's extension points visible. Preserve ordinary-call physical-close settlement, null-timeout response-frame settlement, cancellation cleanup, request identity checks, response bounds and named-pipe behavior. Do not introduce retries, change version 5 or turn validation failures into a fallback.

**Owned write set:** existing `src/adapters/chatgpt-web/turn-broker.ts`; new `src/adapters/chatgpt-web/turn-broker-protocol.ts`, `turn-broker-client.ts`; lane-owned focused test file. Existing callers should remain unchanged through re-exports.

**Smallest verification:** isolated loopback broker fixture covering one remote-owner registration/invocation/completion, one malformed method rejection, and cancellation/close of an unbounded call. Reuse the existing lifecycle close scenario instead of running the whole file (which includes a deliberately long wait). Maximum **30 seconds per selected command**, at most 5 seconds per new asynchronous case. Parent performs integrated typing once.

## 04-turn-broker-F2 — encapsulate owned-operation retention and acknowledgement

**Priority:** medium; strongest lifecycle refactor in this lane. Assign to the same implementation owner as F1 because both modify `turn-broker.ts`.

**Evidence / locations:** operation records live at `turn-broker.ts:38-63`, maps at `366-367`, status projection at `1303-1336`, deduplication/admission at `1381-1425`, registration at `1460-1470`, terminalization/poll/ack/cancel at `1473-1626`, and expiry/guard cleanup at `1679-1716`. Completion fencing (`555-592`), revoke (`740-758`) and close (`857-865`) all consult or retire that state. Adding an operation outcome or retention rule requires following these scattered sections. Both live result payloads and acknowledged replay guards are held here, but have intentionally different lifetimes.

**Caller inspection:** MCP start derives a stable operation ID from token plus operation key (`mcp-server.ts:1207-1209`), resolves the declared tool first and sends the exact invocation. Poll acknowledges only with the delivery identity. The adapter completes delivered call IDs (`index.ts:1340-1355`); it does not own asynchronous result retention. That makes retention a useful module boundary, whereas moving all invocation delivery would couple this change to adapter orchestration.

**Concrete change:** extract an internal `OwnedToolOperationStore` into `turn-broker-owned-operations.ts`. It owns fingerprints, live records, terminal snapshots, retention accounting, bounded status projection, delivery acknowledgements, expiry and replay guards. Expose narrow operations for lookup/start, finish, poll, acknowledge, status, fence counts and token retirement. Keep binding authorization, queue/delivered/detached call IDs and actual cancellation effects in `TurnBroker`; pass only the resulting cancellation scope into the store. Notify the broker synchronously when a transition changes its activity revision. Avoid giving the store unrestricted channel-map access.

Preserve exact token/binding/fingerprint comparisons, acknowledge-after-result semantics, 64 live/unacknowledged operations, 4096 identity guards, 30-minute payload expiry, transport and byte budgets. Expiry must retain the identity guard; observation cancellation must not claim to stop dispatched external work. Completion must still reject running or unacknowledged operations, including the microtask interval between invocation removal and terminal recording. This is state encapsulation, not a new job service or persistence layer.

**Owned write set:** `turn-broker.ts`, new `turn-broker-owned-operations.ts`, and lane-owned focused tests. F1/F2 must be implemented sequentially by one owner. No MCP or adapter rewrite is needed.

**Smallest verification:** select/add three compact behavioral scenarios: exact-key retry returns the original operation and mismatched invocation rejects; queued versus dispatched cancellation plus late completion; terminal result blocks completion until exact acknowledgement, with fake-clock expiry retaining replay protection. Each selected command has a **30-second maximum**, with no real 30-minute wait. Share fixtures/coverage with F1 rather than duplicating transport checks.

## 04-turn-broker-F3 — separate authority resolution from environment persistence

**Priority:** medium; independent write set from F1/F2, but can remain with the lane owner.

**Evidence / locations:** `src/adapters/chatgpt-web/thread-environment.ts:270-397` interleaves Hermes handling, direct trusted extraction, trailing deltas, compaction projection, rollout verification, same-thread cache and parent inheritance in one exception handler. It repeatedly builds rollout options (`290-296`, `313-319`, `343-351`) and persists accepted decisions inline. The same module owns validation/authority comparison (`156-243`) and lock/merge/persistence (`399-475`). A new supported native context shape must be added without accidentally allowing cache fallback after an invalid current claim.

**Concrete change:** extract `thread-environment-resolver.ts`, taking narrow cache read and rollout-resolution dependencies and returning `{ environment, persistForThreadId? }`. Keep an explicit ordered decision flow: Hermes; direct envelope; recognized current-claim recovery; eligible cache/inheritance. Distinguish “not applicable” from “invalid” using typed results where useful; never catch arbitrary errors to advance to another candidate. Store resolution applies persistence once when requested. Preserve exact cache refresh behavior, TTL and merge/locking algorithms in the existing store. Preserve current-request tools on every branch and never persist them or Hermes authority.

Keep `codex-rollout-environment.ts:641-701` as the native evidence verifier: canonical path/session identity, latest turn and ambiguity rejection remain unchanged. `native-delegation.ts:12-60`, `verified-parent-message.ts:1-10`, and `server.ts:546-548` show why normalization must retain object identity across reparsing; do not clone/serialize verified messages or replace WeakSet provenance with a wire flag. `index.ts:931-941` remains the single consumer and propagates failures.

**Owned write set:** `thread-environment.ts`, new `thread-environment-resolver.ts`, focused authority tests. No writes to parser, `environment.ts`, compaction or server; coordinate any requested caller change with their owners.

**Smallest verification:** temporary-journal fixtures proving invalid current authority cannot fall back to cached/parent authority; valid current rollout recovery preserves request tools; Hermes neither reads nor writes the native cache. Reuse one existing parent-history acceptance case. **30-second maximum per selected command**; no broad environment corpus.

## Explicit no-change / coordination notes

No separate change recommended for the compact delegation normalizer, WeakSet marker or collaboration policy module. Parser-wide collaboration filtering (`responses/parser.ts:638`) and narrower spawn-family gateway blocking (`collaboration-tools.ts:22-56`) have distinct purposes; unifying them by set equality would change behavior. Do not create a generic authority framework, broaden rollout recovery or remove conservative rejection to simplify these refactors. This lane has no UI ownership. Parent should reserve the broker files to one writer and coordinate only cross-lane API wiring, if compatibility re-exports prove insufficient.
