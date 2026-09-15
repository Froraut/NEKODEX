# NEKODEX adjudication review3, lane 14

- Repository: `/Users/alex/Dev/nekodex`
- Baseline: `9925453bd51e61c7b398abec12ec0da3aca3d3af`
- Review type: manual source adjudication only
- Scope: `launcher/electron/browser-host.cjs`, direct cancellation and ownership callers, exact tab selection and downstream guards
- Source reports adjudicated: `review1-14.md`, `review2-14.md`
- Source edits, tests, typechecks, automated audits, runtime actions, commits, and delegation: none

## Adjudication

### Review1 claim 1 — accepted

**Claim:** Manual `closeTab` can destroy a running turn after launcher-owned runtime cancellation fails.

**Verdict:** **accepted**. This is a concrete failure path at baseline.

Evidence:

- `launcher/electron/browser-host.cjs:1656-1674` enters the Manual branch, calls `signalManualTerminal(tab, "cancelled")`, and awaits `this.cancelTurn(tab.traceId)`.
- The `catch` at `1665-1671` only logs the rejection. It does not preserve a pending-cancellation state, rethrow, or retain the exact tab.
- Execution then reaches `removeTurnTab(tab, true)` at `1673`. `removeTurnTab` records `closedTurnOwners` and marks the tab aborted, while the runtime cancellation was not acknowledged.
- Production wires `cancelTurn` to `runtimeSupervisor.cancelBrowserTurn(traceId)` in `launcher/electron/main.cjs:1294`; that callback can reject when the launcher-owned runtime is unavailable or fails to acknowledge the targeted cancellation.
- The later `endManualTurn` path only classifies the stored local terminal signal. It cannot prove that the runtime stopped after the callback failed.

Review2's successful close case does not refute this claim: its fixture makes `cancelTurn` resolve. The defect is specifically the rejected-cancellation branch.

### Review1 claim 2 — accepted

**Claim:** Authenticated `/v1/manual/cancel` removes a running browser owner without cancelling the runtime turn.

**Verdict:** **accepted**. This is a separate entry point into the same ownership/cancellation root.

Evidence:

- `launcher/electron/control-server.cjs:106-107,262-265` dispatches authenticated `POST /v1/manual/cancel` directly to `host.cancelManualTurn(body.traceId, body.helperPid)` and returns HTTP 200 from its result.
- `launcher/electron/browser-host.cjs:2312-2319` validates the exact `traceId` and `helperPid`, signals the local Manual terminal state, calls `removeTurnTab(tab, true)`, and returns `{ cancelledByUser: true }`. It does not call `this.cancelTurn`.
- The production runtime cancellation callback exists on the host and is used by the automatic `closeTab` path, but this Manual control path bypasses it.
- The direct adapter surface confirms that `cancelLauncherManualTurn` is the caller-facing cancellation operation. The `ChatGptZeroRiskManualControl.cancel` member is defined and wired, but no production call to `zeroRiskManualControl.cancel` or `manualControl.cancel` was found in the adapter path. A later `finishLauncher("aborted")` releases the local Manual lease; it does not retroactively stop a runtime that the endpoint never targeted.
- The exact-owner checks prevent cross-turn cancellation, but they do not establish that the owned runtime stopped. Returning success while releasing the tab can therefore leave the runtime/helper working without its browser surface.

This is reachable through the authenticated local control ABI; it is not an invented contract or a hypothetical UI state.

### Review2

Review2 reports no numbered defects. Its evidence establishes the success path and exact-owner guards, including the successful `closeTab` cancellation callback case. It does not cover either rejection handling in Manual `closeTab` or the direct `/v1/manual/cancel` dispatch, so it does not change the verdicts above.

## Exact selection and retained ownership

No additional defect was found in the requested selection path.

- `AccountBrowserPool.ownerForTab` and `ownerForTrace` resolve the host that owns the exact tab/trace.
- `AccountBrowserPool.selectTab` captures the tab object, awaits `host.ready()`, revalidates that the same tab still exists, checks `selectionRevision`, and compensates only its own selection publication.
- `BrowserHost.selectTab` rejects a missing tab before publishing and synchronizes visibility from the selected tab registry.
- Automatic retained reuse requires the exact conversation key, connector identity, ready status, and connector binding where applicable.
- These guards do not repair the Manual cancellation root because cancellation is already scoped to the exact owner; the missing step is runtime cancellation acknowledgement before owner release.

## Rejected categories and review limits

No gateway envelope contract was inferred: the gateway's freeform envelope was outside these claims and was not treated as a schema defect. No imported-CSS conclusion was invented; CSS can be sourced from `nekodex.css`, but no CSS claim was made by either lane report. No hypothetical hardening, impossible UI state, or unavoidable non-atomic race was promoted to a defect. No more than two additional defects were searched for, and none met the direct-evidence threshold.

## Merged actionable root

Both accepted claims merge into one root: Manual cancellation can publish a terminal local state and release the exact browser tab without a confirmed runtime cancellation. The fix must preserve the exact owner while cancellation is pending or failed, and make the explicit Manual cancellation endpoint use the same targeted runtime cancellation path before releasing the tab. The public connector ABI and names remain unchanged.
