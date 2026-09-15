# Independent blind review wave2 lane11

- Repository: `/Users/alex/Dev/nekodex`
- Baseline: `992545b3`
- Inspected file: `src/adapters/chatgpt-web/browser-worker.ts`
- UTC review start: `2026-09-15T20:37:22Z`
- UTC review end: `2026-09-15T20:40:12Z`
- Verification: manual source review only, as requested; no tests, typechecks, scripts, runtime actions, edits outside this file, commits, or delegation.

## Inspected scope

Reviewed the response DOM projection and selector scope (`responseDomSnapshot`, lines 3969-4429), submission identity baselines and acceptance (`submissionDomState`, `waitForSubmissionAccepted`, `waitForNewAssistantTurn`, lines 2725-3034), assistant rebinding and launcher recovery (lines 3036-3066 and 4730-5173), compaction and multipart retry paths (lines 3654-3837), the main post-submission observation loop and internal observation-fault handling (lines 5096-5347), cancellation and terminal-error checks, and the direct managed-browser, launcher-helper, acceptance, and retained compaction callers.

No source changes were made. No historical or mixed-model review reports were read before source inspection.

## Finding

### [P1] Response observation failures can be returned as stale successful DOM state

- **Trigger:** A response snapshot has already populated `responseDomCache`, then the bound response locator's `evaluate` operation times out, is rejected because the response node is detached/unresponsive, or otherwise throws while the turn is still active. This is reachable during ordinary streaming, after a submitted turn, and on either managed-browser or launcher-helper execution.
- **Exact location:** `responseDomSnapshot`, lines 3973-4415, especially line 4410 (`.catch(() => undefined)`) and lines 4417-4423. The main consumer is lines 5132-5191.
- **Consequence:** The broad catch converts every evaluation failure into `observed === undefined`. When a cache exists, line 4417 returns `cache.snapshot` as though it were a valid observation. The main loop then sets `observedThisIteration = true` at line 5191 and resets `internalObservationFaults` at line 5190. This bypasses the intended observation-fault retry budget (lines 5325-5346), the launcher page-rebind path (lines 5134-5172), and the DOM-health missing-response decision. If the cached snapshot was a completed or stable response, `ChatGptCompletionTracker.update` can receive the same stale text/HTML and completion flags and eventually return the prior projection as the current turn's final answer; if it was an incomplete projection, the loop can continue using stale state while the live DOM is unreadable.
- **Counterevidence considered:** The explicit page-closed check at lines 4411-4414 only preserves the closed-tab error; it does not preserve timeout, detached-node, protocol, or evaluation failures. The caller's TypeError retry logic at lines 5325-5333 is sound for errors that reach it, but this catch prevents response observation errors from reaching that logic. Cache invalidation at lines 5145-5147 and 5263-5268 helps after a positively detected rebind or completion-fence retry, but cannot run when the failed read is silently converted into a cached snapshot.
- **Smallest fix:** Do not collapse an `evaluate` failure into the ordinary absent-response result. Preserve the failure class and let `ChatGptBrowserObservationTimeoutError` reach the existing same-page recovery path; for other observation failures, either propagate them to the existing bounded observation-fault handler or return an explicit non-observation result that the caller cannot treat as a valid snapshot. In particular, cached data must never be selected solely because the current DOM read failed.
- **Confidence:** High. The failure-to-cache fallback and its consumer are directly reachable in the inspected source, and the stale snapshot is explicitly treated as a successful iteration by the surrounding loop.

## Review conclusion

One current reachable defect is reported above. I found no additional concrete defect in DOM selector scope, retry-after-submission identity handling, cancellation, alternate launcher recovery, or direct caller routing that met the requested evidence threshold; those paths contain explicit identity/count checks, baseline preservation, abort checks, and bounded recovery. Known fail-closed limitations and speculative future DOM changes were excluded.
