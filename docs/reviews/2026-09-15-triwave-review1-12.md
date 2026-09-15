# Triwave review 1, lane 12 — launcher state

Baseline: `3740505b0107af9a83053fd523ae1ad30be36465d` (`HEAD`). Scope: read-only review of launcher state publication, catalog readiness, smoke evidence, startup failure invalidation, and direct callers in `launcher/electron/main.cjs`, `launcher/electron/state.cjs`, `launcher/electron/runtime-supervisor.cjs`, `launcher/src/App.tsx`, and `launcher/src/Overview.tsx`. Compared with `docs/reviews/2026-09-15-four-wave-results.md`, `docs/reviews/2026-09-15-four-wave-adjudication.md`, and the prior lane/fix reports. No tests, typechecks, scripts, broad audits, runtime actions, production actions, code edits, commit, or publication.

## Result

**New concrete defects: 0. No `T1-12-n` finding IDs assigned.**

The current launcher-state paths do not establish a new trigger/consequence pair beyond the adjudicated D01–D19 set. Native4, Native4 DEV, ZeroRisk4, their identities, and their public ABI pins were not changed or implicated.

## Reviewed paths and counterevidence

### Catalog monitor: D03 and D04 are repeats already corrected

The old-probe race from D03 is guarded by the monitor epoch and supervisor identity at `launcher/electron/main.cjs:145-173`. A probe must still belong to the current monitor epoch and current `runtimeSupervisor`; after its await, the code rereads state and rejects a changed config snapshot before publishing `codexCatalogVerified` at `:169-185`.

The foreign/stale health-counter path from D04 is guarded by `runtime-supervisor.cjs:608-635`. `catalogHealthIsCurrent()` requires the current config, non-stopping supervisor, current launcher-owned state, owner PID, daemon PID, ready status, live daemon, service identity, status, release version, mode, accepting-turns flag, and matching health PID. The monitor also requires a positive integer counter and this identity check at `main.cjs:174-176`. These are corrected repeats of R1/R2 candidates, not T1-12 findings.

### Smoke evidence: D06 is closed in the reviewed callers

`App.tsx:44-52` derives smoke status from the current persisted state and current snapshot version. State events, initial hydration, metadata refresh, explicit state updates, and snapshot refresh replace the displayed state at `App.tsx:88-101`, `:132-141`, `:172-181`, and `:215-223`; no prior renderer-side `true` is ORed into later evidence. The backend snapshot uses the same current-version predicate at `main.cjs:468-505`. Migration clears persisted smoke fields at `main.cjs:1313-1318` and `:1351-1357`, and the previously reported same-main-process session latch is absent from the current source. D06/R2-16-1 is therefore a corrected repeat.

The smoke test is optional after core setup (`main.cjs:770-778`, `App.tsx:1468-1471`). That is a documented product boundary and does not prove a setup-gate bypass or create a new defect.

### Startup failure and MCP proof: D13 is closed on the current state contract

`state.cjs:132-143` makes `coreSetupComplete: false` clear `codexCatalogVerified`, `codexPickerConfirmed`, and `mcpSetupComplete` in the state returned by the store. Production startup failure branches stop the catalog monitor, apply that invalidating patch, and send the returned state at `main.cjs:1421-1430`, `:1442-1447`, and `:1464-1472`. `Overview.tsx:16-23,29-45` derives the tool badge only from the current `mcpSetupComplete` field. `App.tsx:48-53` additionally suppresses automatic tool proof while a production `runtime-start` operation is failed. The stale historical-proof candidate is a corrected D13 repeat; external runtime ownership and Manual mode semantics remain separate documented boundaries.

### State publication around setup-core: optional only

`main.cjs:779-800` calls `stateStore.update(...)` after `setup-core` but does not immediately send that returned state. The direct UI caller in `App.tsx:1391-1394` awaits the IPC result and immediately requests `api.snapshot()`, so the current caller obtains the committed state before updating the renderer. The state store itself persists the update synchronously at `state.cjs:132-143`. A future direct caller that relied only on the asynchronous `launcher:state-changed` event could observe no event for this transition, so emitting the returned state would improve IPC consistency. The current source provides no second direct caller or user-visible failure that makes this an independent bug; classify as **1 optional improvement**, not a finding.

## Known limits

- Source review cannot prove live ChatGPT account readiness, native approval, connector schema loading, retained-task continuation, or every renderer/IPC timing interleaving.
- The catalog identity checks prove the launcher-owned daemon/health relationship represented by current source state; they do not prove a foreign actor cannot replace state after the final check. These are the same documented concurrency and live-proof boundaries in the adjudication.
- The workspace had pre-existing untracked `launcher/node_modules` and `node_modules`; they were not read or changed. No source files other than this report were written.

## Counts

- New concrete defects: **0**
- New finding IDs: **none**
- Repeats/corrected adjudicated roots: **4** — D03, D04, D06, and D13; no new IDs.
- Rejected or narrowed candidates: **0 new**
- Known proof limits: **3**
- Optional improvements: **1** (`setup-core` could publish its returned state immediately)
- ABI/identity findings: **0**
