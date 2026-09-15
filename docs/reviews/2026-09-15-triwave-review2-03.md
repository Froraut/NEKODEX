# NEKODEX tri-wave review 2, lane 03 — runtime readiness

Baseline: `3740505b0107af9a83053fd523ae1ad30be36465` (HEAD). Independent manual source review of launcher startup, supervised daemon/catalog proof, browser smoke publication and direct setup/UI callers. Read `2026-09-15-triwave-review1-03.md`, the adjudicated four-wave ledger and results. No tests, typechecks, scripts, broad audits, runtime/account actions, production actions, code edits or commit. Native4 / Native4 DEV / ZeroRisk4 identities, distinct App IDs and public ABI pins remain untouched.

## Counts and disposition

- New conditional source-path defect: **1** (`T2-3-2`).
- First-wave finding upheld/refined, **not** counted again: **1** (`T1-3-1`, discussed as `T2-3-1`).
- Adjudicated repeats: **D03/D04/D06**, excluded from the new count.
- Optional improvements: **0**. Known evidence boundaries: source review does not establish interleaving frequency, installed-app behavior, ChatGPT account connector creation, approval or live picker load.

## T2-3-1 — challenge to `T1-3-1`: stale catalog proof also spans automatic daemon recovery (repeat/refinement)

**Disposition:** uphold the first-wave root; no second defect ID/count. Its trigger should be limited to production successful startup with unchanged route, or supervised daemon recovery, rather than all restarts or a generic healthy endpoint.

**Source path and trigger:** `launcher/electron/state.cjs:35-43,86-100,126-143` persists and reloads `codexCatalogVerified`/`codexPickerConfirmed` without a daemon proof identity. A successful startup actually starts a daemon (`launcher/electron/runtime-supervisor.cjs:1386-1399`) and `main.cjs:1397-1418` invalidates catalog only when `bridgeRouteChanged` is true. `startCatalogVerificationMonitor()` exits on the already-true flag at `main.cjs:151-161`, so its current-PID test at `:166-176` is skipped. The same lifetime problem exists after an unexpected daemon exit: `runtime-supervisor.cjs:540-570` writes degraded ownership and schedules recovery; `:1519-1557` starts a replacement daemon and writes ready ownership, while the only main-process publication callback is `publishOperation` (`main.cjs:140-143`), which does not invalidate catalog state or restart its stopped monitor. A previous positive proof can therefore survive into a daemon whose `successful_model_catalog_requests` counter has not yet become positive.

**Consequence:** `main.cjs:878-885` can confirm the Codex picker from the persisted flag without checking current daemon identity. `launcher/src/App.tsx:1343-1353,1479-1485` and `Overview.tsx:16-23,44-45` present that flag as current catalog readiness. The first-wave correction direction should cover both initial daemon replacement and automatic recovery: invalidate catalog/picker proof when the supervised daemon identity changes, then let the existing epoch/config/ownership/PID/health monitor establish a fresh positive counter. Do not change connector names or public tools.

**Counterevidence and limits:** `runtime-supervisor.cjs:608-634` rejects foreign, stale, failed and non-accepting health payloads when it is called; `main.cjs:145-198` protects a running monitor against retired asynchronous probes. A changed bridge route and failed/non-ready startup already clear the flag (`main.cjs:1405-1408,1421-1469`). Neither D03 nor D04 has regressed on its original in-flight/foreign-endpoint path. If the product intentionally treats a catalog success as durable across daemon boots, this is a readiness-contract decision; the four-wave adjudication/results describe the required positive proof as coming from the current launcher-owned PID. No daemon crash or restart was reproduced here.

## T2-3-2 — an old browser smoke result can republish proof after connector migration clears it (new)

**Priority:** P2 conditional runtime-readiness/state-lifetime defect.

**Trigger:** In the automatic production launcher, `launcher:browser-smoke` starts before a managed Native4 connector migration finishes. `browser-host.cjs:3071-3084` captures the connector name and awaits a browser-helper smoke operation. The helper remains pending while the startup upgrade path completes a connector migration and clears `browserSmokePassed`/`browserSmokeVersion` at `main.cjs:1344-1369`. The earlier helper then returns valid smoke response evidence and the IPC handler at `main.cjs:620-626` unconditionally writes `browserSmokePassed: true` for the current app version. The handler never compares current connector/setup identity, migration epoch, or the state invalidation made while it awaited the helper.

**Consequence:** an old-identity smoke success can restore the current-version smoke flag after migration deliberately invalidated it. `main.cjs:468-470,478-506` and `App.tsx:44-46,1467-1483` derive and display smoke readiness from that flag; if current `coreSetupComplete` is false, `main.cjs:758-779` can subsequently satisfy the mandatory pre-core smoke gate with this stale proof. This is a late **write** after invalidation, distinct from `T1-16-1`'s already-reported stale **read** during `setup-core` authentication. It is also distinct from adjudicated D06, which concerned UI/snapshot retention of a flag after migration; current UI state replacement does not prevent the main process from republishing a stale success.

**Minimum correction:** capture the connector/setup identity and a smoke-evidence generation before starting the helper. Before persisting its result, compare the current identity/generation and current automatic mode; discard a result whose proof was invalidated or whose connector changed. A newly initiated smoke after migration may establish fresh evidence. Preserve Native4 / Native4 DEV / ZeroRisk4 names, App IDs and ABI.

**Counterevidence and limits:** `browser-host.cjs:3085-3094` requires an exact smoke response, and its manual-operation lock prevents simultaneous browser-host manual actions (`:3059-3062,3168-3175`). The managed runtime upgrade is a separate `RuntimeHost.runSetup()` operation (`runtime.cjs:1297-1355,1502-1532`); it is not serialized by that browser-host lock. The overlap requires migration to succeed while the smoke helper is pending; a conflicting browser/capability probe may instead make either operation fail. If the smoke starts after migration, it captures the new connector and this exact path does not apply. Source inspection proves the missing post-await identity check and possible order of state writes, but does not prove the overlap occurred in a live account or quantify its likelihood.

## Excluded paths and ABI boundary

- D03's old-monitor epoch race and D04's foreign/stale health counter remain addressed by `main.cjs:145-198` and `runtime-supervisor.cjs:608-634`; `T2-3-1` concerns a stopped monitor after an identity change.
- D06's monotonic smoke UI/snapshot retention is corrected in current `main.cjs:468-506` and `launcher/src/App.tsx:44-46,88-100,132-141,172-181,215-223`; `T2-3-2` concerns the main-process write after an asynchronous helper result.
- DEV's `coreSetupComplete` is installed configuration without a Responses daemon, per the adjudicated rejection of `R1-7-3`; neither finding redefines DEV readiness.
- Health, catalog counters and source gates are local evidence. ChatGPT-side connector creation, native approval and picker appearance need separate live proof. The parent owns the single focused verification pass, at most 60 seconds and ten expanded scenarios; this lane used none of that automated budget.
