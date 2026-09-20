# Continuation ownership and bounded restart snapshot

Implemented in the response-state layer and native passthrough. The parent-owned server was not edited in this lane.

## What changed

- Local continuation state can now carry a hashed owner scope: stable provider/cache namespace and strongest available native identity (`threadId`, then `promptCacheKey`, then `turnId`). The low-level API supports an account-routing key when every caller has it; the shared server/native body helper deliberately omits it because native passthrough cannot derive it authoritatively. Raw native IDs are not persisted.
- `resolvePreviousResponseInput()` performs owner-aware lookup and returns the original request unchanged with a precise reason on failure. `owner-mismatch` and `owner-unavailable` never materialize cached history. The existing `expandPreviousResponseInput()` remains as a backward-compatible projection.
- `rememberResponseState()` accepts the same optional scope and refuses to retain a descendant when its expanded parent and completion scope disagree. It reports whether a retained response is snapshot-eligible or memory-only because of `snapshot-capacity`.
- Snapshot version 2 stores local delta nodes once and maps active response IDs to shared nodes. It does not materialize every full continuation chain. Local node size is checked with already-known serialized item bytes before candidate node serialization.
- Version 1 snapshots remain readable as ownerless legacy state. Unscoped ordinary OpenAI-compatible callers can continue those entries; a scoped native caller receives `owner-unavailable`, so legacy history is never silently adopted by a new account.
- The snapshot remains bounded to 24 MiB, 1,000 active response IDs, delta depth 7, and the existing one-hour TTL. Compact rejection tombstones preserve explicit capacity/ownership reasons when they fit. Atomic writes remain in use, so serialization or write failure leaves the prior snapshot untouched; a valid rejection-only snapshot may replace stale roots when no current continuation fits.

## Parent wiring contract

Derive the scope from the **unexpanded** request body, then use the same scope for lookup and completion retention. Native passthrough cannot authoritatively recover the launcher account-routing key, so the shared local-response scope deliberately does not fabricate or include one:

```ts
const scope = createResponseContinuationScopeFromBody(rawBody);

const resolution = resolvePreviousResponseInput(rawBody, { scope });
if (resolution.status === "unavailable") {
  // Return an explicit 409. Do not forward the naked delta and do not retry under another account.
  // Distinguish owner-mismatch, owner-unavailable, snapshot-capacity, and ordinary unavailable.
}

// Parse/run resolution.body. At authoritative completed/max-output retention:
const retention = rememberResponseState(parsedRawBody, response, { force: true, scope });
```

`createResponseContinuationScopeFromBody()` uses the canonical pre-parse extractor from `browser-request-contract.ts`, adds top-level `prompt_cache_key`, and uses the constant `nekodex-local-responses-v1`. Use it unchanged for both Web response handling and native passthrough expansion. This preserves the intentional Web-to-native continuation bridge and keeps provider/model/mode transitions out of the owner namespace. Existing launcher affinity continues to route the same thread/session; the continuation layer does not guess that account key at a layer where it is unavailable. If the raw request has no stable native owner, the helper returns `undefined`; this preserves ordinary unscoped OpenAI-compatible behavior, but such a caller cannot consume a scoped entry.

The preferred caller API is `resolvePreviousResponseInput()`. If existing code temporarily keeps `expandPreviousResponseInput()` plus `previousResponseStateStatus()`, pass the same `{ scope }` to both. Wire lookup and remember together in one parent change; wiring only one side intentionally fails closed with `owner-unavailable`. Do not call the lower-level `createResponseContinuationScope()` with `accountRoutingKey` in only the server path, because native transition would then correctly reject the asymmetric scope.

## Explicit status handling

- `owner-mismatch`: known response belongs to a different owner or local-response namespace. Return terminal 409; never materialize or forward it.
- `owner-unavailable`: one side is scoped and the other is legacy/unscoped. Return terminal 409 for native scoped flows. Do not assign legacy state to the current account.
- `not-retained-snapshot-capacity`: continuation was available only in memory and is unavailable after restart. Return a specific compact/start-new-task recovery message.
- `not-retained-too-large`, `not-retained-unserializable`, `not-retained-capacity`, `unavailable`: retain the existing fail-closed partial-context behavior with reason-specific text where available.
- `restartPersistence: "eligible"` means the graph fits the snapshot budget and a debounced write was scheduled; it is not an I/O receipt. `"memory-only"` is explicit and should be logged/surfaced without claiming restart durability.

## Limits and verification

The in-memory reachable-history cap remains 64 MiB; the restart snapshot remains 24 MiB. Snapshot v2 avoids repeated full-chain materialization, but request expansion still materializes the one requested chain because the downstream parser requires a complete input array. Persistence remains best-effort and private; atomic-write failure preserves the prior file.

Per parent instruction, this worker ran no tests, typecheck, build, benchmark, live UI, account, authentication, or network operation. Parent owns the focused checks and server caller integration.
