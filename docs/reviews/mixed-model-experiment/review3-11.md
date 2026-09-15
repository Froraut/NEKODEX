# NEKODEX adjudication review3, lane 11

- Baseline: `9925453bd51e61c7b398abec12ec0da3aca3d3af`
- Scope: `src/adapters/chatgpt-web/browser-worker.ts`, direct callers needed to establish the behavior
- Method: manual source adjudication only; no source edits, tests, typechecks, automated audits, runtime actions, commits, or delegation

## Adjudication

### 1. Review1 claim 1 — accepted

**Verdict:** accepted as one actionable root, `L11-response-observation-failure` (`P1`).

`responseDomSnapshot` wraps the bounded `responseTurn.evaluate(...)` in `.catch(() => undefined)` at `browser-worker.ts:3973-4410`. For every failure other than a closed page, the next branch returns `absentResponseDomSnapshot()` at 4411-4415. The main post-submission loop calls this function at 5132, then treats `responsePresent: false` as an ordinary observation: it attempts turn rebinding and eventually passes `responsePresent: false` into `domHealthTracker.update` at 5315-5322. The intended internal observation-fault handler at 5325-5346 only sees errors that escape the snapshot call; this catch prevents evaluation timeout, detached-node, protocol, and other observation errors from reaching it.

The direct caller path confirms the impact. `runBrowserTurn` binds the assistant turn only after submission evidence and then observes the accepted turn through this snapshot. `index.ts` classifies failures after the submission phase as submitted-turn failures and disables automatic replay, so a response observation failure must retain its failure class and be recoverable or reported as an observation failure rather than being silently downgraded to ordinary DOM absence. The same snapshot is also used by multipart acknowledgement observation at 3685, so the defect is not limited to the final answer loop.

**Essential fix:** preserve the `evaluate` failure and route it through the existing bounded observation recovery/fault path, or return an explicit observation-failure result that callers cannot treat as `responsePresent: false`. Keep the closed-page classification separate. Do not change public connector names or ABI.

### 2. Review1 claim 2 — rejected

**Verdict:** rejected as a current defect; this is hypothetical hardening rather than an evidenced actionable root.

The predicate at 4010-4015 deliberately checks the candidate root's connected/rendered state and intentionally ignores layout width because the browser view may be hidden while the ChatGPT DOM remains readable. The claim supplies no captured or source-established ChatGPT DOM shape in which a current assistant response contains a usable `.markdown` answer root under an ancestor hidden by `hidden`, `aria-hidden`, `inert`, or ancestor-only CSS while the assistant turn remains the valid current response. Adding an ancestor walk would change the established DOM-scope contract and could discard content during renderer virtualization or hidden Electron view states.

The hidden-label cleanup at 4065-4087 already walks ancestors for the specific detached projection labels where that rule is required. That does not establish that answer roots need the same rule. `launcher/src/nekodex.css` is application UI CSS and cannot serve as counterevidence or evidence for ChatGPT page DOM behavior; it is not imported into the remote ChatGPT document. No current source path proves the claimed hidden response projection, so the requested review boundary excludes it.

### 3. Review2 claim 1 — design-limit for the stale-cache subclaim; accepted only as the merged observation-failure root

**Verdict:** design-limit for the claim as written, with its actionable observation-failure portion merged into `L11-response-observation-failure`.

Review2 correctly identifies the same swallowed observation failure and its bypass of the TypeError retry budget. Its specific assertion that an `evaluate` failure returns `responseDomCache.snapshot` as stale successful state is contradicted by the actual order of operations: when `observed` is undefined, 4411-4415 returns `absentResponseDomSnapshot()` before line 4417 can select `cache?.snapshot`. The cache fallback is reachable only when the evaluate call returns an object without `snapshot`, such as a known observer revision; it is not the fallback for a rejected or timed-out evaluate call.

That correction does not eliminate the shared defect. The returned absent snapshot still sets `observedThisIteration = true` at 5191, resets `internalObservationFaults` at 5190, skips the observation-fault retry path, and can drive the ordinary missing-response health decision. The direct rebinding logic at 5134-5172 helps only after an absent snapshot has already been produced and does not preserve the original evaluation failure.

## Merged actionable root

### `L11-response-observation-failure` — P1

- **Files:** `src/adapters/chatgpt-web/browser-worker.ts`
- **Trigger:** After an accepted submission has been bound to an assistant turn, the `responseTurn.evaluate` used by `responseDomSnapshot` times out, rejects, encounters a detached/unresponsive node, or otherwise fails while the turn is still active. The page is open, so the closed-page branch does not apply.
- **Observed behavior:** The failure is collapsed to an ordinary absent response. The main loop can mark the iteration as successfully observed, reset its internal observation-fault budget, and run DOM-health/missing-response handling. The original failure class is lost.
- **Fix direction:** Preserve the observation failure through the existing bounded observation recovery path (including same-page or launcher rebind where applicable), or make the result explicitly non-observed and prevent callers from applying missing-response logic or resetting the fault budget. Keep cache use restricted to a known-valid observation revision and retain the original error as the cause.
- **Sources:** review1 claim 1 and review2 claim 1's observation-failure portion.

## Counts

- Accepted: 1 claim as an actionable root, after merging duplicate reports
- Rejected: 1 claim
- Design-limit / partially corrected: 1 claim
- Unique accepted roots: 1

No additional defect met the requested evidence threshold. Public connector ABI and names remain unchanged.
