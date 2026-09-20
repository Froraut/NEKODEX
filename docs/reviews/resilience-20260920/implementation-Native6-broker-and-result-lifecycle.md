# Native6 broker and result lifecycle implementation

Implemented the accepted code lane 06 lifecycle corrections and the code lane 15
output-schema delimiter correction. This worker made no test, build, CI, live-account,
network, or UI run; the parent owns focused verification and full UI review.

## Changed behavior

- Terminal async results are admitted only when the complete broker poll response,
  including a worst-case accepted request ID, fits the existing 67,108,864-character
  socket envelope. An oversized result becomes a small acknowledgeable failure that
  states the external tool may already have completed or caused side effects.
- Retained result bytes are budgeted per turn (128 MiB), so another turn cannot make a
  completed result fail by consuming a process-global result allowance.
- Cancelling a dispatched operation remains observation-only. It removes the call from
  at-least-once redelivery and the completion fence, rejects the local observation
  promise, and records a late-completion tombstone. A later owner completion is
  accepted and ignored; no UI or protocol text promises that the external action was
  undone.
- The active/unacknowledged async-operation limit remains 64. Acknowledgement now
  releases that active budget while retaining the operation ID, invocation fingerprint,
  binding, and delivery ID as a compact replay guard until turn retirement.
- Replay guards never evict and redispatch. A turn may own at most 4,096 unique async
  operation guards; after that, new unique starts fail explicitly while retries of
  existing keys continue to recover their existing state. Compaction still recovers
  existing operation identities before returning control for a new key.
- Native6 `codex_tool_status` returns all live/unacknowledged records and fills the
  remaining portion of its existing 64-record view with the newest acknowledged
  guards. When older acknowledged guards are omitted it returns `truncated: true` and
  optional `omitted`; those omitted identities remain protected from replay.
- Output-schema JSON escapes `<`, `>`, and `&` as standard JSON Unicode escapes before
  interpolation into the prompt delimiter. Parsing yields the original schema while a
  schema string cannot terminate the transport delimiter.

## Contract boundaries

- No Native4, Native5, or Native6 public tool input schema changed, and no Native7
  identity was introduced.
- Native5 keeps the existing start/poll/cancel surface. Native6 keeps the same
  `codex_tool_status({ turn_token })` input and gains only honest optional output
  metadata when its bounded view omits acknowledged guards.
- Acknowledged and omitted guards remain valid through compaction and are removed only
  after the turn token is invalidated during retirement.
- Cancellation settles broker observation and turn liveness only. It never claims to
  cancel, reverse, or approve an external side effect.
- Native Codex validation and approval decisions remain authoritative. Generic
  JSON-Schema enforcement and registry pinning from code lane 15 were not added in this
  patch because they require a separate compatibility design for trusted native
  validation and dynamic tool discovery.

## Files

- `src/adapters/chatgpt-web/turn-broker.ts`
- `src/adapters/chatgpt-web/mcp-server.ts`
- `src/adapters/chatgpt-web/prompt.ts`
- `docs/reviews/resilience-20260920/implementation-Native6-broker-and-result-lifecycle.md`

`src/adapters/chatgpt-web/turn-execution.ts` was manually reviewed as the direct
session/fence caller and required no source change for this broker-owned correction.
