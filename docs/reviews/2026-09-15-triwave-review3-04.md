# Triwave review 3, lane 4 — catalog monitor

Baseline: `3740505b0107af9a83053fd523ae1ad30be36465` (`3740505`). Final read-only adversarial review of the catalog monitor, catalog-health identity helper, direct state publishers, startup/quit transitions, and the native catalog augmentation boundary. Read `docs/reviews/2026-09-15-triwave-review1-04.md` and `docs/reviews/2026-09-15-triwave-review2-04.md` first. No tests, typechecks, scripts, broad audits, launches, production actions, code edits or commits were performed.

## Result

- **New concrete bugs:** 0
- **New finding IDs:** none (`T3-4-n` is unused)
- **Candidate roots confirmed:** none
- **Repeats/refinements/known boundaries:** D03 and D04 remain repaired; the cumulative-counter, account-side picker, cross-process transaction and failure-diagnostics limits remain known/optional boundaries.
- **Cross-scope interactions newly missed:** none found in the inspected paths.
- **ABI/public contract changes:** 0; `Codex Native4`, `Codex Native4 DEV`, `ZeroRisk4` and the existing connector/tool ABI were not changed.

## Candidate disposition and final adversarial scenarios

### 1. Retired asynchronous probe after setup, context or mode replacement — repeat of D03, reject as new

`startCatalogVerificationMonitor()` captures both the epoch and the supervisor identity at `launcher/electron/main.cjs:151-155`. `stopCatalogVerificationMonitor()` increments the epoch before clearing the timer at `:145-149`. The response path rejects a retired epoch or replaced supervisor at `:169`, then re-reads state and config and rejects a changed pending-context/configuration state at `:170-176` before publication. A late response cannot mark a replacement setup verified or stop its monitor. This is the repaired D03 root already recorded by waves 1 and 2.

### 2. Foreign or stale positive `/healthz` catalog counter — repeat of D04, reject as new

The monitor requires the fetched payload's positive integer counter and `catalogHealthIsCurrent(config, health)` at `launcher/electron/main.cjs:174-176`. The helper at `launcher/electron/runtime-supervisor.cjs:608-637` binds the same payload to the current config, launcher ownership, current daemon PID and liveness, ready state, service/version/mode, accepting-turns state and matching payload PID. No second fetch or alternate unbound counter path exists in this monitor. This is the repaired D04 root.

### 3. MCP setup crossing automatic/manual mode — no new root

`launcher/electron/main.cjs:809-842` writes the selected interaction mode and starts a fresh production monitor after successful setup. Manual mode is constrained by config validation and provider configuration; its catalog remains a local `/v1/models` route backed by the selected manual provider. The monitor's proof is local daemon/catalog evidence and does not claim account-side automatic picker evidence. The transition path does not leave the previous monitor authoritative because `startCatalogVerificationMonitor()` retires the prior epoch before checking the new state.

### 4. ZeroRisk4 toggle crossing the catalog monitor — no new root

`launcher/electron/main.cjs:898-906` invalidates production catalog readiness when the ZeroRisk setting changes and starts a replacement monitor. `stateStore.update()` clears `codexPickerConfirmed` whenever `codexCatalogVerified` is set false at `launcher/electron/state.cjs:131-140`. The monitor then binds the positive response to the current config and daemon identity. The ZeroRisk4 provider rows and connector identity are outside this readiness publication path and remain unchanged.

### 5. Bigger Context apply racing catalog verification — repeat/refinement of D03, reject as new

The context queue clears catalog and picker readiness before starting a replacement monitor at `launcher/electron/main.cjs:1196-1202`. The monitor rejects a response while `pendingBiggerContext` is still present at `:171-173`, and compares the serialized runtime config captured before the request with the current config. The path therefore cannot publish the old context's health response as current. No additional T3 root is supported.

### 6. Production startup failure or route recovery — repaired D13 interaction, no new root

For `not-configured`, external, needs-setup and thrown startup failures, `launcher/electron/main.cjs:1421-1470` stops the monitor and publishes `coreSetupComplete: false`, `codexCatalogVerified: false` and `mcpSetupComplete: false` before awaiting route recovery. The state store also conservatively clears catalog, picker and MCP readiness whenever core setup is false. A route-recovery delay therefore cannot preserve an old catalog/MCP proof in the current UI state. This confirms the earlier D13 correction rather than adding a catalog defect.

### 7. Quit, forced runtime shutdown, or startup cleanup — no new root

Normal quit stops the monitor at `launcher/electron/main.cjs:1015-1044` after runtime shutdown begins and before committing exit. Fatal-startup cleanup also stops it at `:1520-1529`. A pending HTTP health request may finish, but the epoch/supervisor checks prevent its result from publishing after retirement. The monitor does not introduce a quit/recovery cross-scope interaction.

### 8. `/v1/models` success counter semantics — known cumulative-counter boundary, no concrete new root

`src/server.ts:1092-1125` increments the counter only after a successful `/v1/models` response, while `/healthz` exposes the cumulative value at `:951-965`. The monitor also requires accepting turns and current daemon identity. The source does not establish a per-monitor request epoch, so a current daemon with a pre-existing successful catalog request can satisfy the count. Waves 1 and 2 already recorded this as a known semantic boundary; without a concrete configuration path where that distinction causes a false current proof, it is not a new T3 finding.

### 9. Catalog augmentation and protected native rows — no new monitor interaction

`src/model-catalog.ts:153-197` removes prior routed rows, preserves cloned native rows, selects a list-visible native template, applies the explicit context override, and appends the current routed Web rows. The monitor only observes the server's successful catalog request and does not mutate this builder. The inspected path does not alter native template selection, `Native4`/`Native4 DEV`, `ZeroRisk4`, or the public connector/tool schemas.

### 10. Account-side picker display, approval and completed turn — known scope boundary

The monitor and `catalogHealthIsCurrent()` establish local launcher-owned daemon/catalog evidence. They do not establish ChatGPT account-side picker rendering, connector approval, or a completed native/browser turn. This remains the documented acceptance boundary, not a source-provable monitor defect and not grounds for an ABI or connector identity change.

## Final assessment

The final three-wave lane review supports **0 new T3-4-n findings**. The only candidate roots in this scope are the already repaired D03/D04 paths and their previously documented lifecycle interactions. The additional setup, mode, ZeroRisk4, Bigger Context, startup-failure, quit, server-counter and catalog-builder checks found no missed cross-scope interaction. Native4, Native4 DEV, ZeroRisk4 and ABI boundaries remain preserved.
