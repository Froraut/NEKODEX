# Review wave 2, lane 7 — startup readiness invalidation

Frozen baseline `3a66157`. Manual read-only source review of `launcher/electron/main.cjs`, direct state/runtime/UI consumers, and first-wave lanes 6–8 where the startup root overlaps. No runtime execution or code changes.

## New concrete defect (1)

### R2-7-1 — catalog monitor accepts an unbound health counter

- Trigger: while a production catalog monitor is pending, a different local HTTP service occupies the configured host/port and returns a 200 `/healthz` JSON with an integer `successful_model_catalog_requests` greater than zero. This includes a stale NEKODEX daemon from another config with that counter. `main.cjs:161-165` calls `proxyHealthPayload`, which only fetches/parses the endpoint (`runtime-supervisor.cjs:593-605`).
- Consequence: `main.cjs:166-175` persists `codexCatalogVerified: true` and stops monitoring without checking service, status, release version, mode or launcher-owned PID. `confirm-codex-models` then permits picker confirmation and saves an identity hash for the *current* config (`main.cjs:866-875`), though the positive response did not establish its catalog. The same supervisor has an identity-aware `proxyHealth` comparison (`runtime-supervisor.cjs:607-614`); route diagnostics additionally require the expected PID before calling a counter current (`route-diagnostics.cjs:25-30`).
- Counterevidence/limit: normal `src/server.ts:951-965` health includes identity fields, and startup normally awaits `startIfConfigured`/route connection before starting this monitor (`main.cjs:1377-1406`). The alternative endpoint and count are a required trigger, not an observed incident. This is distinct from R1-7-1's *in-flight config-change* race: no config update needs to occur during this check.

## Repeated candidate (1)

### R2-7-2 — old asynchronous probe may complete after readiness invalidation (R1-7-1)

- Trigger: a probe already awaits `proxyHealthPayload` (`main.cjs:162-163`); a later successful setup or context change clears catalog verification and restarts the monitor (`main.cjs:816-829`, `context-change-queue.cjs:25-28`, `main.cjs:1185-1189`).
- Consequence: the previous check can persist true and stop the replacement timer without comparing the new state/config or a probe generation (`main.cjs:146-175`); a user can then confirm models against that old proof (`main.cjs:866-875`). `state.cjs:127-132` only invalidates picker confirmation when the flag is explicitly set false and does not guard a later true update.
- Counterevidence/limit: setup awaits a ready runtime before updating state (`runtime.cjs:1525-1532`), so failed setup alone does not create this invalidation; ordinary startup migration completes before monitor registration. This repeats R1-7-1, rather than adding another independent issue. The endpoint identity check in R2-7-1 would not by itself cure this interleaving.

## First-wave challenges and boundaries

- **R1-7-2 narrowed, no new ID:** failed/external production startup clears core and catalog but retains `mcpSetupComplete` (`main.cjs:1432-1435,1452-1465`; `state.cjs:127-132`); `Overview.tsx:16-23,44-45` still marks the tool connection verified and `App.tsx:1335-1339,1490-1504` shows prior tool verification. This is a stale *presentation of historical verification* under a known failure. It does **not** establish that ChatGPT's connector or an external runtime is unavailable: `external` can mean another process owns the runtime, and Manual verification explicitly records healthy local runtime with manual connector selection (`main.cjs:652-668`). The first-wave claim is too strong if read as present connector failure. The `not-configured` path clears MCP state (`main.cjs:1413-1421`), and `mcp-verify` performs a fresh doctor/connector check before setting true (`main.cjs:639-693`). Optional presentation improvement: show verification time and startup failure together; no public schema or identity change.
- **R1-7-3 rejected as stated:** DEV startup derives `coreSetupComplete` and `codexCatalogVerified` from a valid nonlegacy config *before* starting the optional Full tunnel (`main.cjs:1299-1323`); a rejected tunnel start clears `mcpSetupComplete` (`main.cjs:1324-1330`). The core flag denotes an installed configuration, and DEV deliberately has no Responses daemon (`runtime-supervisor.cjs:1282-1293`; `runtime.cjs:1175-1199`). Thus these true flags do not claim that the tunnel started. A resolved non-ready status currently has no failure callback, but absent evidence of a meaningful status reachable for this valid DEV Full config, it remains an unproven candidate, not an additional finding. The setup consumer also requires MCP verification separately (`App.tsx:1335-1339`).
- Lanes R1-6 and R1-8 address migration and account affinity, respectively, without this monitor's shared root. Native4 and Zero Risk4 identities remain untouched. Live account/schema/approval and installed-app proof remain documented delivery boundaries, not source defects.

Counts: **1 new concrete defect; 1 repeated candidate (R1-7-1); 1 narrowed first-wave claim (R1-7-2); 1 rejected first-wave claim (R1-7-3); 1 optional presentation improvement; no execution or source change.**
