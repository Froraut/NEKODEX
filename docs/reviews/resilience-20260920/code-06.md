# Native6 operation lifecycle manual counter-review

Scope: `src/adapters/chatgpt-web/turn-broker.ts`, `mcp-server.ts`, and
`turn-execution.ts`, limited to Native6 start/status/poll/ack, cancellation,
compaction, guard capacity, long-running operations, and result retention.
This was a bounded manual review only; no source edits, tests, builds, CI,
live-account work, network authorization, child agents, or UI driving were used.

## Findings

### 1. High — retention admits results that the broker protocol cannot deliver, and one turn can consume the shared budget

**Observed.** `TurnBroker.finishOwnedOperation` measures the retained JSON payload and
accepts it while the sum across every turn in the broker is at most 128 MiB
(`turn-broker.ts:1435-1454`, especially 1442-1447). The broker later serializes the
whole poll snapshot, but `TurnBroker.writeSocketResponse` rejects any line above
67,108,864 characters (`turn-broker.ts:1042-1048`). The retention calculation is
process-wide rather than scoped to `operation.token` (`turn-broker.ts:1443`).

**Failure trigger.** A completed async tool returns a payload whose retained JSON fits
the 128 MiB retention budget but whose poll response exceeds the approximately 64 MiB
wire limit (JSON escaping can cross the wire limit even when the source payload is
smaller). Every poll then receives only `turn broker response exceeds size limit`, so
the caller never receives the result or its hidden `delivery_id` and cannot
acknowledge it. The completion fence remains blocked until the 30-minute expiry makes
the poll response small. Separately, retained results from one turn can push a small
result in another turn over the shared 128 MiB limit after that second external tool
has already executed; that result is replaced with a failure and cannot safely be
re-run.

**Proposed fix and ownership.** The turn-broker lifecycle owner should admit terminal
results using the exact serialized poll-envelope size, with a limit below
`MAX_BROKER_LINE_CHARS`, and reject/replace an oversized payload immediately with a
small terminal error carrying a deliverable `delivery_id`. Account retention per turn
first, plus a separate broker-wide ceiling, so one turn cannot consume another turn's
result allowance. Preserve the operation guard and require acknowledgement of the
small terminal record; never authorize replay of the external call.

### 2. High — observation-only cancellation can leave the turn completion fence blocked forever

**Observed.** After dispatch, `TurnBroker.cancelOwnedOperation` marks the operation
`cancelled` with `cancellationScope = "observation_only"`, but deliberately leaves its
entry in `channel.invocations` (`turn-broker.ts:1533-1562`).
`TurnBroker.beginCompletionFence` counts every remaining invocation as active work
(`turn-broker.ts:537-550`), and `commitCompletionFence` also rejects while any remain
(`turn-broker.ts:555-566`). Only a later owner completion removes that invocation in
`completeTool` (`turn-broker.ts:522-535`). Acknowledging the cancelled operation removes
the owned-operation record but does not remove the underlying invocation
(`turn-broker.ts:1491-1505`).

**Failure trigger.** A dispatched external tool hangs, waits indefinitely, or loses
its completion delivery. Native6 cancellation returns a terminal cancelled operation,
and the caller can acknowledge it, but the turn can never pass its completion fence
because the abandoned invocation remains active. This turns the advertised
observation cancellation into an unbounded turn-liveness dependency.

**Proposed fix and ownership.** The coupled turn-broker/turn-execution lifecycle owner
should move an observation-cancelled invocation into a detached completion sink that
is excluded from the turn completion fence. A late `owner_complete` must still be
accepted and discarded/recorded idempotently, while the operation-key guard remains
until acknowledgement and then as a compact tombstone until token retirement. Turn
retirement must invalidate the token before releasing those guards. This allows the
turn to finish without cancelling the external side effect and without permitting a
retry.

### 3. Medium — acknowledged tombstones permanently consume the 64-operation admission quota

**Observed.** Starting an async operation counts both live `ownedOperations` and
already acknowledged `acknowledgedOperations` against
`MAX_OWNED_TOOL_OPERATIONS = 64` (`turn-broker.ts:211`, `1387-1393`). Acknowledgement
moves the record into `acknowledgedOperations` (`turn-broker.ts:1491-1505`), and those
tombstones are removed only when the whole token is revoked
(`turn-broker.ts:1643-1651`). Native6 status also returns all acknowledged records and
declares `truncated: false` (`turn-broker.ts:1277-1303`).

**Failure trigger.** A legitimate long-running turn starts and acknowledges 64 unique
operations sequentially. The 65th start is rejected even though no operation is
running and no result payload is retained. Compaction does not reset this because
existing operation identities intentionally survive compaction. Reusing a prior key
cannot help: it correctly returns `acknowledged`, and evicting that tombstone would
permit side-effect replay.

**Proposed fix and ownership.** The Native6 protocol/turn-broker owner should split the
64-entry discoverable live/unacknowledged set from a compact acknowledged guard ledger.
Keep every acknowledged key plus its request fingerprint until token retirement, but
bound that ledger by retained bytes rather than the live-operation count. Status can
return the newest bounded page with an explicit `truncated`/cursor contract in Native6
only. Do not change Native4 or Native5 public schemas, and never evict a guard in a way
that allows an acknowledged operation key to execute again.

## Compatibility and review boundary

Native6 adds `codex_tool_status` only under `options.native6`, while Native5 continues
to share the existing start/poll/cancel schema and Native4 does not enable async owned
operations (`mcp-server.ts:1158-1275`). The proposed ownership stays with the parent
one-writer lifecycle integration because cancellation, completion fencing, retention,
and compaction are coupled. No additional findings were added outside direct lifecycle
callers, and inferred failure consequences above are explicitly separated from the
observed code paths.
