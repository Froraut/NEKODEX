# Triwave review 2, lane 4 — catalog monitor

Baseline: `3740505b0107af9a83053fd523ae1ad30be36465` (`3740505`). Read-only source review of the catalog verification monitor, its direct callers, state publication, runtime health identity helper, and the catalog augmentation boundary. Compared with `docs/reviews/2026-09-15-triwave-review1-04.md`. No tests, typechecks, scripts, audits, launches, production actions, code edits or commits were performed.

## Result

- **New concrete bugs:** 0
- **New finding IDs:** none (`T2-4-n` unused)
- **Repeats checked:** 2, both already adjudicated/repaired: D03 / former `R1-7-1`, and D04 / former `R2-7-1`
- **Known limits:** 3
- **Optional improvements:** 1
- **ABI/public contract changes:** 0

## Repeat / repaired paths

### D03 / former `R1-7-1` — stale asynchronous probe

The monitor still captures an epoch and the current `runtimeSupervisor` identity before starting a probe at `launcher/electron/main.cjs:151-168`. After `await proxyHealthPayload()`, it rejects a retired epoch or replaced supervisor at `:170`, then re-reads state and rejects changed configuration, pending context state, or already-verified state at `:171-175`. A late response therefore cannot publish readiness for a retired setup. This is a repeat of D03, not a new finding.

### D04 / former `R2-7-1` — unbound positive health counter

The monitor still requires a positive integer `successful_model_catalog_requests`, but it also passes the same health payload through `catalogHealthIsCurrent()` at `launcher/electron/main.cjs:176`. The helper binds the payload to equal current config, non-stopping supervisor state, current launcher ownership, current daemon PID and liveness, `ready` status, service identity, version, mode, accepting turns, and matching payload PID at `launcher/electron/runtime-supervisor.cjs:608-637`. This remains the repaired D04 path, not a new bug.

## Current source review

The state store continues to clear catalog and picker readiness when core setup is false, and clears picker confirmation when catalog readiness is explicitly revoked (`launcher/electron/state.cjs:132-140`). The monitor is restarted after the relevant setup/context/profile transitions and stopped on failure/shutdown paths. The catalog builder in `src/model-catalog.ts` filters native rows, selects a list-visible template with reasoning metadata, constructs routed Web rows, and applies context overrides; no new monitor-state or readiness publication path was found there.

## Known limits, not new findings

1. `catalogHealthIsCurrent()` proves the launcher-owned daemon and health identity fields. This source review does not prove account-side picker rendering, approval state, or completion of a real model turn.
2. The positive catalog counter is cumulative. The current source binds it to the current daemon/config/PID and requires accepting turns, but does not prove that the increment occurred after this monitor began. No new defect follows without a concrete runtime/configuration path where that distinction changes readiness.
3. The final synchronous identity check and atomic state write do not form a cross-process transaction. A hostile external process could change the daemon or state immediately afterward. This is the same documented race boundary and outside the monitor's claimed guarantee.

## Optional improvement

- **O1 — preserve a bounded health failure reason.** `proxyHealthPayload()` returns `null` for HTTP, JSON, timeout, and abort failures at `launcher/electron/runtime-supervisor.cjs:594-605`; the monitor then logs only a generic pending condition at `launcher/electron/main.cjs:186-191`. A bounded reason would improve diagnostics, but the current fail-closed decision remains correct and this is not a bug finding.

## Final assessment

No new `T2-4-n` finding is supported at `3740505`. The two relevant earlier defects remain repaired. The catalog construction code and monitor publication path show no new concrete bug or regression within this lane's scope.

