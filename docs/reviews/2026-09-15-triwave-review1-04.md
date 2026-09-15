# Triwave review 1, lane 4 — catalog monitor

Baseline: `3740505b0107af9a83053fd523ae1ad30be36465` (`3740505`). Read-only source review of the catalog monitor, its direct callers, state publication and health identity helper. Compared with `docs/reviews/2026-09-15-four-wave-results.md` and `docs/reviews/2026-09-15-four-wave-adjudication.md`. No tests, typechecks, scripts, broad audits, launches, production actions, code edits or commits.

## Result

- **New concrete bugs:** 0
- **New finding IDs:** none (`T1-4-n` is therefore unused)
- **Repeats checked:** 2, both already adjudicated and repaired: D03 / former `R1-7-1` and D04 / former `R2-7-1`
- **Known limits:** 3
- **Optional improvements:** 1
- **ABI/public contract changes:** 0; Native4, Native4 DEV and ZeroRisk4 remain untouched.

## Repeat / repaired paths

### D03 / former `R1-7-1` — stale asynchronous probe

The former trigger was an in-flight `proxyHealthPayload` resolving after a setup, context or mode change had replaced the monitor. The current monitor takes an epoch at `launcher/electron/main.cjs:151-154`, retires the prior epoch in `:145-149`, and rejects a retired probe both before and after the await at `:157` and `:168-173`. It also requires the current state and serialized config to remain compatible before publication at `:171-176`. Only then can `:177-185` publish `codexCatalogVerified: true` and stop the monitor.

This is a repeat of D03, not a new finding. The current source supplies the missing generation/configuration guards described by the adjudication. `stopCatalogVerificationMonitor()` still cannot cancel an HTTP request, but a late response is now ignored by epoch and supervisor identity checks.

### D04 / former `R2-7-1` — unbound positive health counter

The former trigger was a different or stale local service returning a positive `successful_model_catalog_requests` count on the configured host and port. The current monitor still reads the payload at `launcher/electron/main.cjs:166-168`, but it now requires the same fetched payload to pass `runtimeSupervisor.catalogHealthIsCurrent(config, health)` at `:174-176`. The helper at `launcher/electron/runtime-supervisor.cjs:608-637` binds the proof to equal current config, non-stopping supervisor state, current launcher ownership, current daemon PID and process liveness, `ready` status, service name, release version, mode, accepting-turns state and matching payload PID.

This is a repeat of D04, not a new finding. The helper is synchronous and consumes the already-fetched payload; there is no second fetch or alternate counter path in this monitor.

## Direct caller review and counterevidence

The monitor is started after successful production setup at `launcher/electron/main.cjs:779-801`, after MCP setup at `:825-842`, after context application at `:1196-1202`, after successful production startup at `:1397-1419`, and after configured profile changes at `:925-940`. These callers clear or reset catalog readiness before starting a replacement monitor where the operation changes the relevant configuration. The context queue explicitly clears both catalog and picker confirmation at `:1198-1200`; state storage also clears picker confirmation whenever `codexCatalogVerified` is set false at `launcher/electron/state.cjs:132-140`.

Unsuccessful production startup now calls `stopCatalogVerificationMonitor()` and publishes `coreSetupComplete: false`, `codexCatalogVerified: false` and `mcpSetupComplete: false` at `launcher/electron/main.cjs:1442-1445` and `:1464-1470`, before awaiting route recovery. The unconfigured branch performs the same invalidation at `:1421-1430`. This matches the four-wave result's D13 correction and prevents route-recovery latency from leaving a retired catalog probe authoritative.

The current state reader/store also conservatively clears catalog, picker and MCP readiness whenever core setup is false at `launcher/electron/state.cjs:96-100` and `:133-140`. The confirmation handler still requires current core and catalog flags at `launcher/electron/main.cjs:878-887`.

## Known limits, not new findings

1. `catalogHealthIsCurrent()` proves the current launcher-owned daemon and its identity fields, but this review does not prove a real ChatGPT account-side model-picker display, approval state or completed turn. The four-wave results explicitly retain that boundary.
2. The monitor uses the daemon's reported cumulative positive request counter. The source binds the response to the current daemon/config/PID and requires `accepting_turns`, but the review does not establish a server-side request epoch or prove that the counter increment occurred after this monitor started. No independent current defect follows without a demonstrated runtime/config path where that distinction matters.
3. A hostile external process could still change state after the final synchronous identity check and before or during persistence. The source-level monitor has no cross-process transaction; this is the same general race boundary documented by the adjudication and is outside the monitor's claimed guarantee.

## Optional improvement

- **O1 — clearer monitor diagnostics.** `proxyHealthPayload()` returns `null` for HTTP failures, JSON failures and timeout/abort at `launcher/electron/runtime-supervisor.cjs:594-605`; the monitor logs the resulting condition as a generic pending check at `launcher/electron/main.cjs:186-191`. Preserving a bounded reason could make route diagnostics more useful, but it does not affect the fail-closed readiness decision and is not a bug finding.

## Final assessment

No new `T1-4-n` finding is supported in the catalog-monitor scope at `3740505`. The two relevant earlier defects are repeats of repaired D03/D04. Native4 / Native4 DEV / ZeroRisk4 connector ABI and public tool schemas were not changed or inspected as mutable targets.
