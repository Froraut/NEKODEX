# Submission evidence and the no-replay contract

Nekodex observes delivery boundaries; it does not prove model understanding. Keep the existing browser lifecycle, execution journal, launcher handshake, and broker operation acknowledgements. There is no second outbox and no model acknowledgement on every turn.

## Evidence levels

| Boundary | What it establishes | What it does not establish |
| --- | --- | --- |
| `prepared` | Local prompt construction / attachment is ready for the send path. | Provider receipt, generation, or understanding. |
| `send_activated` | The owner has crossed the conservative no-replay fence immediately before Enter. The callback is awaited before browser activation. | That Enter reached the provider. Persistence/IPC or browser activation may fail. Delivery remains **uncertain**. |
| `submitted` callback (`accepted` in execution state) | The owned submission observer found new conversation/generation evidence or current-turn MCP activity after its pre-Enter revision boundary. | Successful completion, reading every attachment, or understanding instructions. This is **observed receipt/activity**, not a semantic acknowledgement. |
| Exact operation acknowledgement | The existing broker protocol accepted an acknowledgement for its own operation, or a staged context transaction matched its exact expected acknowledgement. | Receipt of another operation or universal understanding of the conversation. |
| Completion | The existing response-scoped completion / broker fence passed. | Success of unrelated external effects. |

Do not present `send_activated` as “received.” Conversely, a stopped/failed response after observed acceptance is not an unsent prompt. Retain the distinction in error codes: `chatgpt_submission_ambiguous` versus `chatgpt_submitted_turn_failed`; known terminal provider errors retain their existing classification.

## Causality and identity

- DOM evidence uses stable logical turn identities, not message counts or display indices. Virtualized/remounted history remains in the captured baseline. Multiple new candidates fail closed rather than selecting the latest one.
- Staged acknowledgement remounts are historical only when their entire text matches an already acknowledged transaction token. A different transaction or duplicate exact matches cannot silently establish that history.
- A Stop control already present in the captured baseline is not evidence for a new submission. A newly observed generation control is weaker surface-level activity evidence; it is not an exact operation acknowledgement.
- The MCP baseline revision is sampled **after** awaiting activation persistence and immediately before Enter. Activity arriving while persistence/IPC is pending cannot have been caused by this send. The progress reader is supplied by the existing current-turn broker binding; a revision alone is not a cross-session identity credential.
- Observation recovery preserves the original baseline and rebinds the exact owned surface. It does not resend the prompt. Browser evidence assumes exclusive ownership of that surface; it is not a cryptographic provider receipt.

## Cancellation, failure, and replay

1. Cancellation before activation must not publish activation or press Enter.
2. Cancellation while the awaited activation callback is pending must prevent Enter. The conservative fence is not rolled back: persistence may already have recorded it.
3. Evidence settling after cancellation must not publish `submitted` or revive the cancelled turn.
4. Failure of activation persistence prevents Enter. A dispatched Enter with missing acceptance remains uncertain; observation failure cannot prove non-delivery.
5. Once an ordinary task reaches activation or acceptance, **no automatic prompt replay** is permitted. Even a structured error marked `retryable: true` must not bypass this boundary. Native reconnect observes/replays the existing execution journal, not the browser send.
6. Prepared-turn error policy remains unchanged. Dedicated read-only compaction recovery has its own owner and policy; it is not permission to replay ordinary task prompts. Existing broker acknowledgements and compaction handoff validation remain authoritative in their respective domains.

This contract does not add crash durability to the in-memory ordinary-turn journal. Launcher persistence and compaction persistence have separate lifetimes; do not claim process-restart exactly-once delivery from these tests.

## Verification

`tests/submission-evidence-faults.test.ts` invokes the real browser send method with browser I/O fault injection, the real baseline/evidence helpers, and the real adapter reconnect path. It covers cancellation at asynchronous boundaries, late acceptance, activation-persistence failure, pre-Enter MCP revisions, pre-existing generation, identity ambiguity, exact staged tokens, ordered successful activation, and non-replay for both uncertain and accepted structured transport failures.

`tests/browser-submitted-provider-error.test.ts` exercises the real browser-turn error fence for retained responses and multipart context stages. Its browser fixture includes the current page/usage-observation contracts; no live provider is used.
