# ChatGPT Web browser hardening

## Scope and ownership

This pass implements the browser-adapter findings in `src/adapters/chatgpt-web` without changing the
Native4 or Zero Risk4 cached connector contracts. Native5 is an explicit opt-in owned by
`experimentalAsyncToolOperations`; connector identity, setup, Doctor/readiness, launcher preference,
and usage-store integration are coordinated with their separate owners.

No test, build, runtime launch, account mutation, route change, or commit was performed in this pass.

## Implemented findings

### Shared state without stale whole-file overwrite

- Thread environments and Luna checkpoints now use process-wide backends keyed by a canonical state
  path. A missing state path uses a process-memory key so per-request adapters retain state.
- Writes acquire a bounded cross-process ownership lock, reload the latest atomic file, merge by
  logical record key and `updatedAt`, prune under the existing limits, then atomically replace the
  file. Parallel records are not replaced by a stale adapter snapshot.
- Stale-lock removal has a separate exclusive reaper owner and rechecks the ordinary lock after the
  reaper is acquired. Lock release checks PID/token and inode. A failed owner-record write closes the
  descriptor and removes only its owned inode.
- Canonical keys resolve an existing state file physically; for a new file they resolve the nearest
  existing parent physically while preserving the declared leaf. Dangling leaf symlinks and live or
  unprovable locks fail closed.

### Stable account affinity and revision-scoped retries

- Existing `thread_id` owners preserve the exact historical routing key
  `SHA256("account-thread:" + threadId)`, so an upgrade does not move a persisted thread to another
  account.
- Previously unbound `prompt_cache_key` and `turn_id` fallbacks receive typed, namespaced routing
  keys and remain stable across browser reacquisition.
- Retry budgets include the current canonical instruction digest. Failures from an obsolete steering
  revision no longer exhaust a newer instruction under the same native turn.

### Provenance-aware statistics

- Usage receipts add optional `modelVersionSource: "observed" | "pinned" | "unknown"` and
  `messageKind: "task" | "context_stage" | "compaction"`.
- Family evidence is selected in this order: live observed family, family successfully revalidated
  immediately before Send, unknown. Requested/configured family alone is never recorded as measured.
- Normalized failure codes are limited to the agreed enum. Adapter error text is not used as a
  statistics category.
- A successful managed-Chrome storage-state refresh immediately rewrites the core version-2
  verification marker from the exact saved bytes and the verified account capabilities. A marker
  failure is reported with the storage refresh instead of leaving stale integrity evidence.

### Native5 owned asynchronous tool operations

Native5 adds three opt-in MCP tools. Native4 remains unchanged; Manual/Zero Risk and Hermes-origin
turns cannot start these operations.

The MCP entrypoint accepts mutually exclusive `--async-tool-operations` and
`--synchronous-tool-operations`; omission remains synchronous for Native4 compatibility.

- `codex_tool_start(turn_token, operation_key, wire_name, arguments?|input?)`
  starts one invocation. `operation_key` is scoped by the turn capability. Repeating the same key and
  semantically identical JSON arguments returns the existing operation; different payloads fail.
- `codex_tool_poll(turn_token, operation_id, wait_ms?, ack_delivery_id?)`
  waits for at most 30 seconds. Poll timeout or transport disconnect leaves the operation owned and
  does not replay or retire it. Terminal results carry an immutable `delivery_id` and their payloads
  remain replayable for 30 minutes. After payload expiry the same operation returns explicit
  `expired`; it never returns to `running` and never redispatches. Explicit acknowledgement changes
  the guard to `acknowledged`.
- `codex_tool_cancel(turn_token, operation_id)` removes a queued invocation before dispatch. After
  dispatch it returns `cancellation_scope: "observation_only"`; the external tool and side effects
  may continue. Its late completion is consumed by the exact broker call owner and cannot overwrite
  cancelled state. Sibling calls and the owning turn are preserved.

Operation and delivery capabilities are token-scoped and scrubbed from replayed history together with
the older turn/binding/call capabilities. JSON request fingerprints recursively sort object keys and
preserve array order; freeform input remains byte-exact.

Expired and acknowledged idempotency guards are retained for the complete lifetime of the owning turn
capability. They are not evicted by TTL or LRU. A per-turn limit rejects a new unique operation key
before dispatch once its live guard capacity is full. Guards are released only when that turn token is
retired.

The browser completion fence treats every unacknowledged owned operation as live turn state. Running
operations remain ordinary active work. Once the underlying native call has settled, a terminal,
cancelled, or expired result blocks final commit until its delivery is acknowledged. Start, terminal
transition, cancellation, expiry, and acknowledgement advance the fence revision. Poll and cancel
requests use ordinary activity leases and settle those leases before replying.

If ChatGPT's DOM is stably final while only terminal owned results remain unacknowledged, the worker
waits the existing bounded completion grace and then returns nonretryable
`unacknowledged_async_result` with only the result count. It never exposes operation IDs, auto-acks,
submits a new prompt, or redispatches the tool. An actually running native call continues to wait for
its real completion and does not enter this diagnostic path.

Owned operations are process-local. A daemon/broker restart loses pending results and acknowledgement
tombstones. This implementation does not claim cross-process operation recovery or reattachment to a
native tool that was already dispatched.

## Bounded regression cases for the parent to run

Both runnable cases are implemented in `tests/browser-product-hardening.test.ts`. Run at most these two
focused cases; they are not run by this pass.

1. **`chatgpt browser state merge preserves parallel records and legacy thread affinity`.** Interleave two independently constructed
   environment stores and two Luna stores against the same files, then assert both distinct records
   remain after fresh reloads. Also assert that a request with `thread_id = T` produces exactly
   `sha256("account-thread:" + T)` and that prompt-cache/turn fallbacks are stable but use the new
   typed namespace.
2. **`Native5 owned MCP operations fence terminal delivery until exact acknowledgement`.** Reuse the
   existing local MCP SDK transport fixture and exercise the public `tools/list` and `tools/call`
   route through `runChatGptMcpServer`; direct private broker calls are fixture control only. Assert a
   Native4 server does not list `codex_tool_start`, `codex_tool_poll`, or `codex_tool_cancel`, while an
   opted-in Native5 server lists and invokes them. Keep a fake native call pending without a real
   external action or 90-second wait. Retry the same `operation_key` with recursively reordered JSON
   object keys; assert one native dispatch and the same `operation_id`. Complete the fixture call,
   poll twice for the same terminal `delivery_id`, acknowledge it, and retry start once more; assert
   the acknowledgement guard prevents redispatch.
   Advance the simulated clock past payload expiry and assert the same operation key returns
   `expired` (or `acknowledged` after acknowledgement), never a new `running` operation, with dispatch
   count still one. In the same public MCP fixture, observation-only cancellation of a delivered
   operation must leave a sibling invocation usable. Assert completion fence begin is blocked before
   terminal acknowledgement, an earlier fence revision cannot commit across start/terminal/ack
   transitions, and a fresh fence succeeds after acknowledgement.

## Adapter coverage

Changed and manually reviewed: `index.ts`, `environment.ts`, `thread-environment.ts`,
`rolling-checkpoint.ts`, `state-file-lock.ts`, `turn-execution.ts`, `turn-broker.ts`, `compaction-handoff.ts`, `mcp-main.ts`,
`mcp-server.ts`, `prompt.ts`, `usage.ts`, `browser-worker.ts`, `browser-helper-main.ts`,
`launcher-helper-client.ts`, `src/launcher-browser-host.ts`, and
`tests/browser-product-hardening.test.ts`. Existing direct completion-fence expectations were updated
in `tests/chatgpt-web-harness.test.ts` for the structured ready/blocked result without weakening their
revision and activity assertions.

The original survey also covered browser/helper lifecycle, compaction handoff/transactions, rollout
environment recovery, MCP diagnostics, replay feeds, markdown buffering, input limits, model selection,
and helper IPC. Unrelated dependency upgrades and launcher/core implementation outside the coordinated
fields were not assessed here.
