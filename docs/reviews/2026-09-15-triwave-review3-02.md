# Triwave review 3, lane 2 — services

Baseline: `3740505b0107af9a83053fd523ae1ad30be36465` (`HEAD`). Final adversarial, read-only review of the services scope: `src/service.ts`, `src/tunnel-service.ts`, `src/setup.ts`, `src/cli.ts`, and their direct service callers. Read `docs/reviews/2026-09-15-triwave-review1-02.md` and `docs/reviews/2026-09-15-triwave-review2-02.md`. No tests, typechecks, scripts, runtime/account actions, production actions, code edits, or commit were performed. Native4, Native4DEV, ZeroRisk4, their identities, and public ABI pins remain preserved.

## Final disposition

**No new `T3-2-n` finding IDs.**

### Confirmed existing root: T2-2-1 / P2

The wave2 candidate remains concrete and present at the frozen HEAD.

Trigger: a macOS terminal service is already loaded, and the saved service definition differs from the current `runtimeCommand`. The direct CLI path `src/cli.ts:381-396` calls `installService(config)` for `service install`. `src/service.ts:116-129` writes the new plist before the loaded-state probe; `src/service.ts:130-132` sees the label loaded and skips bootstrap. The returned status therefore reports `loaded: true` while the live launchd job can still run the old `ProgramArguments`. `getServiceStatus()` only checks label presence and plist existence/status (`src/service.ts:103-113`); it cannot prove that the loaded job uses the new disk definition.

This root is separate from D01/D02, which concern write ownership and rollback around setup failures. The setup route has its own guard and explicit restart path (`src/setup.ts:727-757`), so it does not invalidate the direct CLI finding.

## Cross-scope interaction checked

The stale loaded-service state has a direct service-lifecycle amplification. After `service install` saves a new config/plist while the old daemon remains loaded, a later `service restart`, `service stop`, or `uninstall` uses the current saved config to call `/admin/drain` (`src/service.ts:274-276, 279-328`). If the saved host, port, or control token changed with the plist, the drain request addresses the new configuration while the old daemon still owns the running endpoint. The operation can refuse to proceed before `launchctl bootout`, leaving the stale daemon and new disk definition in place. This is a consequence and refinement of T2-2-1, not an independent T3 root; it needs the same correction at direct `service install`.

The analogous tunnel path does not reproduce this root: `installTunnelService` reads the current launchd state and refuses a changed definition while loaded (`src/tunnel-service.ts:112-125`). Tunnel restart/stop also establishes service idleness before mutation through the direct CLI path (`src/cli.ts:437-445`). Setup’s tunnel migration and rollback paths retain the ownership checkpoints and loaded-state comparisons (`src/setup.ts:789-818, 896-945`).

## Rejected or non-new candidates

- **D01/D02 write-before-checkpoint and rollback:** repeat of the adjudicated roots. Current callbacks checkpoint owned bytes synchronously, and setup retains the guarded compensation path. No new ID.
- **Unload/bootstrap failure and bounded launchd observation:** known manual-recovery boundary already documented in wave1. The service and tunnel paths propagate failures and setup refuses to guess when status is unknown.
- **Ordinary nonzero `launchctl print` interpreted as unloaded:** retained known limit. This review found no concrete current trigger that distinguishes a missing target from an actionable print failure without live evidence.
- **Service/tunnel status timing and independent teardown ordering:** bounded/known behavior or existing D01/D02/D12/D19 coverage; no distinct trigger-and-consequence pair was found.
- **Native4 / Native4DEV / ZeroRisk4 identity, schema, or ABI concern:** no source path in this scope changes those contracts.

## Counts and handoff

- New concrete bugs: **0**
- New finding IDs (`T3-2-n`): **0**
- Confirmed prior root: **T2-2-1 / P2**
- Cross-scope refinements: **1**, attached to T2-2-1
- Repeats/known limits: **4**
- Optional improvements: **0**
- Source edits/tests/typechecks/scripts/production actions/commit: **0**

Parent final focus remains within the requested **60 seconds and at most 10 scenarios**. This report used manual source review only; no verification scenarios were run.
