# Review wave 1, lane 7 — startup readiness invalidation

Baseline `3a66157`; manual source review only. Scope: `launcher/electron/main.cjs`, its immediate state/runtime callers, and the two generation4/tunnel boundary reports. No runtime or test execution.

## Potential findings (3)

### R1-7-1 — stale catalog probe can reassert readiness after configuration changes

- Trigger: the catalog monitor reads config and awaits `proxyHealthPayload` (`main.cjs:162-165`). During that await, setup/mode/context change invalidates `codexCatalogVerified` and starts a replacement monitor (`main.cjs:816-829`, `917-927`, `1185-1189`). The original check then receives an old daemon's successful catalog count.
- Consequence: it writes `codexCatalogVerified: true` without rechecking the current config, state, or monitor generation (`main.cjs:166-174`). `confirm-codex-models` can then accept that old proof for the new configuration (`main.cjs:866-875`). `stopCatalogVerificationMonitor` clears the timer, but does not cancel an in-flight check; the shared `catalogVerificationInFlight` also prevents the new check while the old one awaits (`main.cjs:146-160`).
- Counterevidence/limit: startup generation4 migration runs before the production monitor starts (`main.cjs:1333-1406`), so this does not show a race in the ordinary migration sequence. It requires a concurrent later configuration change and an old positive health response. It is a source-proven interleaving, not a live reproduction.

### R1-7-2 — failed production runtime leaves prior MCP readiness displayed

- Trigger: a previously verified Full installation has `mcpSetupComplete: true`; on a later startup, `startIfConfigured` returns `external`/`needs-setup` or the upgrade/start/route chain rejects (`main.cjs:1336-1381`).
- Consequence: the failure branches clear `coreSetupComplete` and `codexCatalogVerified`, but do not clear `mcpSetupComplete` (`main.cjs:1432-1435`, `1452-1465`). The launcher overview independently renders its tool connection as ready from that stale flag (`launcher/src/Overview.tsx:16-23`), and setup passes it as `toolsVerified` (`launcher/src/App.tsx:1335-1339`). This misreports the tool readiness during a known startup failure.
- Counterevidence/limit: the `not-configured` branch clears all three flags (`main.cjs:1413-1421`), and successful generation4 upgrade explicitly invalidates MCP readiness when `preserveSetup` is false (`main.cjs:1338-1355`). The finding concerns failed/external startup with retained saved state, not those paths; it does not prove the ChatGPT account-side connector is unavailable.

### R1-7-3 — failed DEV tunnel start leaves core readiness asserted

- Trigger: a valid generation4 DEV Full config passes the initial `readConfig` and state update, but `startIfConfigured` later rejects (for example, tunnel startup failure) (`main.cjs:1291-1324`).
- Consequence: the catch only sets `mcpSetupComplete: false` (`main.cjs:1324-1330`); `coreSetupComplete` and `codexCatalogVerified` remain true from the pre-start update (`main.cjs:1301-1313`). The DEV setup considers core installed on that flag (`launcher/src/App.tsx:1331-1339`), even though the configured tunnel did not start. A non-ready returned status also has no corresponding invalidation in this callback.
- Counterevidence/limit: legacy names are detected before DEV launch, clear readiness/smoke evidence, and gate startup (`main.cjs:1299-1320`); invalid config catches set core false. This finding is restricted to valid new-name Full config with failed or non-ready runtime startup. The DEV profile intentionally does not run a Responses listener (`runtime.cjs:918-921`); this is about tunnel readiness, not listener readiness.

## Boundaries, no additional defect counted

- Generation4's unreleased source, missing live ChatGPT schema load, approval, long-running turn, installed-app and account transition proof are documented delivery limits in `2026-09-15-connector-generation4-results.md`, not startup bugs.
- The tunnel report's bounded stop/download behavior and its withdrawn #487 Native3 schema proposal predate the coordinated generation4 migration. Neither implies a new launcher startup defect.
- Optional improvement: represent runtime and connector verification with separate current-config evidence so UI can distinguish saved prior verification from present health. No identity or public schema change is justified by this review.

Counts: 3 potential findings; 1 optional improvement; 2 documented boundary groups; no code change or automated verification.
