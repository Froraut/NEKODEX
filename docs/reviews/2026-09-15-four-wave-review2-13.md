# Review wave 2, lane 13 — launcher helper cancellation

Frozen source: `3a66157a8943a80bbbe299699cc96bec82721ba1`. Read-only manual review of `launcher-helper-client.ts`, `browser-helper-main.ts`, and the direct `browser-worker.ts` / `index.ts` callers. Compared with R1 lane 13 and adjacent R1 reports for this exact root. No tests, typechecks, scripts, source edits, or runtime claims.

## Counts

- New concrete defects: **0**.
- Repeated candidate: **0** (R1-13 reported no defect).
- Rejected first-wave claim: **1 qualified assertion**.
- Known limitation / optional robustness improvement: **1** (plus the existing R1-13 progress-mirror optional improvement, unchanged).

## R2-13-1 — preflight rejection has no post-cleanup event (optional protocol robustness)

**Trigger.** A dispatched Run reaches the helper but is rejected during validation before controller registration, while the caller aborts and its Abort write is rejected after the bounded input-drain wait. Examples of preflight rejection include an invalid trace ID, a duplicate active ID, or malformed optional key/flag in the helper's input frame (`browser-helper-main.ts:157-189`). This is a conjunction of two failures, not an observed ordinary request.

**Lines and consequence.** The helper's outer `run(message).catch(...)` writes an error at `browser-helper-main.ts:516-521`; its `turn_settled` is only in the later `try/finally` at `:312-345`. After a failed Abort write, the client reserves the ID and rejects the caller (`launcher-helper-client.ts:276-287,717-721,809-820`). With the current helper advertising `turn-settled` (`browser-helper-main.ts:541-542`), a later error for an already rejected pending turn does not clear the reservation (`launcher-helper-client.ts:459-470`). The deterministic ID cannot be reused until that exact child exits (`:261-263,724-731`). R1-13's assertion that the helper's *final* `turn_settled` always follows cleanup is therefore too broad for preflight failures; it applies to turns that entered the worker `try/finally`.

**Counterevidence / classification.** The normal direct caller creates a 12-character SHA-256 trace (`index.ts:214-225,1151`); its account-routing key is a SHA-256 hex string (`index.ts:691,762`), and the client checks that key before dispatch (`launcher-helper-client.ts:237-244`). The client emits optional booleans as `true` only when present (`:313-325`); absence or `false` is not a helper validation failure. Duplicate IDs are gated by the worker's active-run map and client's pending/unresolved maps (`browser-worker.ts:2214-2234`; `launcher-helper-client.ts:260-266`). Thus the preflight half is not demonstrated for an ordinary current-build direct call. A malformed/mismatched helper frame or competing protocol producer would be required. Treat this as optional hardening of the error/settlement contract, **not a proven runtime defect**. No public schema or Native4 / Zero Risk4 identity changes follow from it.

## Challenged and retained R1-13 conclusions

- The ordinary cancellation chain is intact: Abort is queued after Run (`launcher-helper-client.ts:267-333`); helper Abort cancels the controller, prompt selection, Send and completion-fence waiters (`browser-helper-main.ts:487-500`); worker completion still releases the launcher lease in `finally` (`browser-worker.ts:4429-4513`). No direct Abort IPC response is required to settle the turn promise: the helper sends a result/error and then `turn_settled` after worker cleanup (`browser-helper-main.ts:312-345`; `launcher-helper-client.ts:625-642`). This rejects any candidate based solely on absent direct IPC settlement.
- The congested-pipe five-second bound and reservation until helper cleanup/child exit remain the known R1-13 limitation (`launcher-helper-client.ts:809-877,717-731`). The R1-13 optional progress-mirror negotiation/transport-loss concern (`:667-695`) remains optional; the current helper advertises `progress` (`browser-helper-main.ts:541-542`). No new shared-root adjacent R1 finding was found.

Evidence boundary: manual source trace only; the conjunctive preflight/Abort failure was not reproduced. No verification commands were run.
