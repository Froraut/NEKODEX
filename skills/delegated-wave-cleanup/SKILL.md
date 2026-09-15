---
name: delegated-wave-cleanup
description: Keep NEKODEX multi-agent review and editing waves within the available thread limit by collecting final payloads and closing completed, errored, interrupted, timed-out, or superseded agents before dispatching the next wave.
---

# Delegated wave cleanup

Use this skill whenever a NEKODEX task dispatches multiple agents in waves. A visible subagent is a reserved thread slot even after it has finished. Dispatching the next wave before closing old agents can produce `agent thread limit reached`, partial waves, and misleading “no findings” results.

## Wave lifecycle

1. Record every dispatched agent ID, lane, model, dispatch time, and intended report path.
2. Wait for a final payload with a bounded timeout. A timeout is an unresolved status, never a clean review.
3. Collect the final text/report before closing the agent.
4. Mark the lane as `completed`, `errored`, `interrupted`, `timed_out`, or `create_failed`. Preserve the error or missing-result reason.
5. Close every agent that is completed, errored, interrupted, timed out, superseded, or otherwise no longer needed.
6. Recount open agents and available slots before dispatching the next wave.
7. Dispatch the next wave only after cleanup. If a lane is retried, link it to the original lane and do not count the original failure as a finding.

## Failure semantics

- `Selected model is at capacity` is a model-service availability failure.
- `agent thread limit reached` is an orchestration cleanup failure.
- A pending agent stopped after a bounded wait is unavailable/inconclusive, not a zero-finding review.
- A failed create must be recorded with its lane and error, then retried only after a slot is confirmed free.
- Never claim a wave was `16/16` unless 16 final payloads were collected. Report partial dispatch and the exact unavailable lanes.
- Do not repeatedly retry a capacity failure without a bounded retry policy. Keep one same-model retry and a declared fallback if the user authorized one.

## Shared-tree editing

For edit waves, assign disjoint write scopes and close the previous wave before another model edits the same tree. After each wave, capture changed paths and require the next wave to distinguish its new changes from inherited edits. Never force a no-op edit to fill a lane.

## Final handoff

Report:

- requested lanes versus dispatched lanes;
- completed, failed, timed-out, and closed agent counts;
- model capacity or thread-limit failures;
- source changes and reports actually produced;
- focused verification results and unverified runtime/UI boundaries.

Do not infer token usage, cost, or model quality from wall-clock time unless the host provides usage telemetry. Keep agent availability, code correctness, and product/runtime evidence as separate claims.
