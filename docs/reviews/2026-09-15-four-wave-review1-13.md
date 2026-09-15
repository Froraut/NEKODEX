# Review wave 1, lane 13 — launcher helper cancellation

Baseline: `3a66157`. Scope: manual source review of `launcher-helper-client.ts` and `browser-helper-main.ts`, with direct caller/failure-path excerpts in `browser-worker.ts`, `browser-helper-prompt-selection.ts`, and `process-line-writer.ts`. No tests, typechecks, scripts, or code edits.

## Potential defects: 0

No R1-13-n finding met the trigger/consequence/counterevidence threshold. In particular:

- Abort before dispatch rejects locally; after dispatch the client sends an ordered Abort frame and reserves the trace ID if delivery fails (`launcher-helper-client.ts:260-333,809-820`). `run` calls `sendTo` synchronously before yielding, so setting `sent` immediately before it does not let the Abort frame overtake the Run frame. A local frame/queue rejection sends no bytes (`:857-899`).
- Helper Abort cancels the controller, prompt selection, and Send/completion-fence waiters (`browser-helper-main.ts:487-500`). Its final `turn_settled` follows per-turn cleanup (`:328-344`); the client releases unresolved IDs on that event or exact child exit (`launcher-helper-client.ts:459-469,724-760`). A rejected Abort write therefore does not silently free a helper-owned ID.
- Caller holds active trace IDs through the turn promise (`browser-worker.ts:2214-2234`); its launcher path reports a terminal release in `finally` after its worker run (`:4429-4509`). Pre-run cancellation and worker-stage cancellation are explicit (`:4430,4533,4560`). These paths counter a speculative claim that the helper's final frame alone is treated as tab-release proof.

## Optional improvement: 1 (no defect)

- The progress mirror currently logs and returns if a negotiated helper lacks `progress`, or logs later send failures (`launcher-helper-client.ts:667-695`), while the current helper advertises it together with tool-boundary and completion-fence features (`browser-helper-main.ts:541-542`). A future mixed-version contract could require `progress` for external-progress turns and make later transport loss terminal; this needs an actual mixed-version failure trace and a lifecycle decision. Do not change Native4/Native4 DEV/Zero Risk4 identity or public schema on this basis.

## Known limitations / evidence boundary

- A congested input pipe has a five-second Abort-delivery window; rejection keeps the ID unresolved until helper cleanup or child exit (`launcher-helper-client.ts:814-820,823-877`). This is an intentional bounded failure path, not proof that the browser stopped immediately.
- The generation-4 connector report records new identities and protocol checks, while explicitly leaving account-side schema load and live long-running turns unproven. The tunnel/upstream report similarly distinguishes source assessment from platform reproduction. Neither missing live proof is counted here as a bug.

Counts: **0 potential defects, 1 optional improvement, 1 intentional cancellation limitation**. Review is manual and scoped; no runtime behavior was exercised.
