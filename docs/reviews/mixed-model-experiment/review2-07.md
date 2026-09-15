# Independent blind review wave 2, lane 7

- Repository: `/Users/alex/Dev/nekodex`
- Baseline: `9925453bd51e61c7b398abec12ec0da3aca3d3af`
- Source status: unchanged; no source edits
- UTC review start: `2026-09-15T20:30:00Z`
- UTC review end: `2026-09-15T20:38:00Z`
- Required regression-prevention skill: `/Users/alex/Dev/nekodex/skills/nekodex-regression-prevention/SKILL.md`
- Verification policy applied: `/Users/alex/.codex/skills/right-size-test-runs/SKILL.md`

## Inspected scope

Primary source: `launcher/electron/runtime-supervisor.cjs`.

Focused review covered:

- launcher-owned daemon and tunnel identity/state transitions;
- tunnel control queue creation, predecessor release, queued cancellation, child ownership tracking, timeout, error, exit, and close paths;
- tunnel startup adoption, pre-start stop, connect, readiness polling, monitor recovery, graceful stop, stale-owner recovery, and forced shutdown;
- startup aborts, recovery aborts, shutdown cancellation, compensation/error paths, and the `cancelActiveTurns` and `cancelBrowserTurn` direct callers;
- direct supervisor callers in `launcher/electron/runtime.cjs` and `launcher/electron/main.cjs`, including quit with `{ cancelActiveTurns: true, force: true }`.

No tests, typechecks, scripts, runtime actions, commits, delegation, or source edits were performed.

The regression-prevention review invariants were applied manually: identity-bound async proof, ownership checkpoints through process and stream settlement, invalidate-before-start/currentness-after-await, serialized transport ownership, bounded failure classification, and fail-closed parsing/diagnostics. The focused review was manual, which is within the fast-verification policy.

## Findings

**Zero findings.**

I did not find a concrete, currently reachable defect in the requested runtime/tunnel child ownership, cancellation, or control-queue scope that satisfies the review criteria.

### Counterevidence considered

- A queued recovery command that is aborted while waiting on a predecessor leaves its queue slot chained to that predecessor at lines 1809–1823; this prevents a later command from overlapping the unresolved child. The outer error path releases the slot if cancellation wins after the predecessor has settled at lines 1830–1832 and 1961–1964.
- A spawned tunnel control child is retained in `tunnelControlChildren` until its `close` event at lines 1847–1853 and 1932. Its `exit` path settles the command, while the later `close` path releases queue ownership, so exit-before-close does not open the queue early.
- Recovery and initial-start cancellation abort their controllers at lines 1444–1453. A running control child observes that signal and enters bounded termination at lines 1908–1915; shutdown waits for the owning startup/recovery promise before proceeding at lines 1474–1487 and 1459–1472.
- Stop and recovery paths serialize tunnel commands through the same queue and retain the tunnel alias-live marker until stop confirmation at lines 1055–1089, 1727–1758, and 2334–2348. Failed stop confirmation restarts monitoring rather than clearing ownership.
- Direct quit first requests active-turn cancellation and then invokes the supervisor shutdown path at `launcher/electron/main.cjs:1104`; the supervisor validates the daemon’s cancellation response before stopping at lines 2108–2129 and 2390–2400.

These paths provide counterevidence against treating the apparent queue/cancellation edge cases as current bugs. No smallest fix or confidence ranking is applicable because no qualifying finding was established.
