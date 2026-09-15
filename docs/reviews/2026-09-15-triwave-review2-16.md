# NEKODEX triwave review 2 lane 16 — cross-cutting callers

Baseline: `3740505b0107af9a83053fd523ae1ad30be36465` (`3740505`, HEAD). Read-only independent review of current source, direct launcher callers, `docs/reviews/2026-09-15-triwave-review1-16.md`, `docs/reviews/2026-09-15-four-wave-results.md`, and `docs/reviews/2026-09-15-four-wave-adjudication.md`. No tests, typechecks, scripts, broad audits, runtime/account inspection, production actions, code edits, commits, or connector changes were performed.

Scope: cross-cutting launcher IPC/state callers around setup, asynchronous verification, startup invalidation, migration, renderer state, and the Native4 / Native4 DEV / ZeroRisk4 public contract.

## New finding

### T2-16-1 — late MCP verification can resurrect a cleared positive proof after runtime invalidation

**Priority:** P1 conditional source defect

**Trigger:** An automatic production launcher has an existing MCP configuration and starts `launcher:mcp-verify`. The handler checks the active trace, awaits `runtimeHost.doctor()` at `launcher/electron/main.cjs:628-652`, then awaits `browserHost.verifyConnector(runtimeHost.mcpConnectorName())` at `:682-684`. Only after both awaits does it write `mcpSetupComplete: true`, the current setup contract, timestamp, and identity hash at `:685-687`.

While either awaited operation is in flight, the independent startup/recovery path can detect a failed, external, or unavailable production runtime. Its failure branches stop the catalog monitor, write `coreSetupComplete: false`, `codexCatalogVerified: false`, and `mcpSetupComplete: false` and publish that state at `main.cjs:1421-1430`, `:1442-1447`, or `:1464-1472`. The same process therefore has a current invalidation event, but the already-running verifier has no state epoch, runtime identity, or operation ownership check before its final positive write.

**Consequence:** The late verifier can overwrite the current false proof with `mcpSetupComplete: true` after the runtime has failed or lost ownership. The UI and subsequent callers can treat the old doctor/connector result as current MCP readiness. This is a late-writer state consistency defect distinct from D13: D13 covered clearing/presenting stale proof on startup failure; this path can republish positive proof after that clearing has already happened.

**Minimal correction direction:** Capture a verification epoch or setup/runtime identity before the first await and compare it with current state/configuration and runtime ownership immediately before setting `mcpSetupComplete: true`. A failure/invalidation epoch should reject or discard the late success. Preserve the current Manual-mode semantics, connector names, and ABI pins.

**Counterevidence and limits:** The renderer's `localBusy` prevents an ordinary same-surface duplicate action, and runtime setup methods reject some overlapping runtime operations through `currentOperation()`. Those guards do not serialize an already-running verification against startup recovery, an external runtime transition, or another direct IPC caller. The path is conditional on overlap between the verification await and invalidation; no live reproduction was performed or claimed.

## Repeat/refinement of wave1

### T2-16-R1 — stale setup-core smoke gate repeats T1-16-1

`launcher/electron/main.cjs:758-779` still reads `setupState` before awaiting `browserHost.probeAuthentication({ forSetup: true })` and then evaluates that old object at `:770-772`. Startup managed-runtime upgrade can still invalidate `browserSmokePassed/browserSmokeVersion` at `:1344-1357` during the await. The renderer busy guard does not make the main-process startup task and IPC handler atomic. This repeats/refines `T1-16-1`; it is not assigned a new concrete ID and is not counted as a second root.

## Other reviewed paths

- **D03/D04 catalog readiness:** `startCatalogVerificationMonitor` now uses an epoch, rechecks state/config, and calls `catalogHealthIsCurrent` before publishing positive proof (`main.cjs:151-180`; `runtime-supervisor.cjs:608-635`). No new finding.
- **D06 smoke presentation:** current renderer and snapshot paths derive smoke from current persisted versioned evidence (`App.tsx:44-45,88-100,132-141,172-181,215-223`; `main.cjs:468-505`). No repeat beyond T2-16-R1's separate setup gate.
- **D13 failure invalidation:** state-store clearing remains correct for the failure writer (`state.cjs:132-143`); T2-16-1 is the late positive writer that can follow it.
- **Setup-core state publication:** the direct renderer caller awaits setup and then requests a fresh snapshot (`App.tsx:1391-1394`). Missing immediate event publication remains optional, not a defect.
- **Account selection, browser tabs, and retained turns:** current revision/ownership checks in `account-pool.cjs` were reviewed as existing D05/D17 behavior. No separate cross-cutting defect was established.
- **Native4 / Native4 DEV / ZeroRisk4:** no connector identity, App ID, public tool schema, tool count, or generation-4 ABI change is proposed.

## Known limits

Source review cannot establish overlap frequency, actual account behavior, runtime recovery timing, browser DOM behavior, native approval, or installed-app behavior. The late-writer finding is accepted as a conditional source-path candidate because the invalidating writers and the asynchronous positive writer are explicit in the current source. A future caller that guarantees exclusive verification ownership could narrow the trigger, but no such process-wide epoch/lock is visible in the reviewed paths.

## Optional improvement

The IPC handlers for `launcher:mcp-verify` and `launcher:setup-core` could return/publish a committed state object as part of the operation result, reducing the renderer's follow-up snapshot round trip. Existing callers already refresh appropriately, so this is an API/observability improvement and not a new bug.

## Counts

- New concrete conditional findings: **1** — `T2-16-1`
- Repeats/refinements: **1** — `T2-16-R1` (repeat of `T1-16-1`)
- Optional improvements: **1**
- Known/qualified limits: **1**
- ABI/identity defects: **0**
- Code changes: **0**
- Verification runs: **0**

Parent owns the final focused verification pass, limited to at most 60 seconds and 10 scenarios. This report authorizes no tests, typechecks, broad audits, scripts, production actions, or ABI changes.

