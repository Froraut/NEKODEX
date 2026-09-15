# NEKODEX triwave review 3 lane 16 — cross-cutting callers

Baseline: `3740505b0107af9a83053fd523ae1ad30be36465` (`3740505`, HEAD). Read-only final adversarial review of current source, `docs/reviews/2026-09-15-triwave-review1-16.md`, and `docs/reviews/2026-09-15-triwave-review2-16.md`. No tests, typechecks, scripts, broad audits, runtime/account inspection, production actions, code edits, commits, or connector changes were performed.

Scope: final wave for cross-cutting callers around browser smoke evidence, setup and verification IPC, startup runtime migration/invalidation, catalog readiness, interaction-mode transitions, and the Native4 / Native4 DEV / ZeroRisk4 public contract.

## New finding

### T3-16-1 — late browser-smoke completion can resurrect invalidated current-version smoke proof

**Priority:** P1 conditional source defect

**Trigger:** An automatic production launcher starts `launcher:browser-smoke`. The handler checks the current mode at `launcher/electron/main.cjs:620-623`, awaits `browserHost.smokeTest()` at `:624`, and then unconditionally writes `browserSmokePassed: true` and `browserSmokeVersion: app.getVersion()` at `:625`.

While the browser smoke operation is awaiting the browser helper, the independent startup path can finish a managed runtime upgrade. When the upgrade migrates the connector, it explicitly clears `browserSmokePassed` and `browserSmokeVersion` at `launcher/electron/main.cjs:1351-1357` and publishes the invalidation at `:1368-1369`. The already-running smoke handler has no epoch, connector identity, or current runtime/configuration check before its final positive write. It can therefore publish the old smoke result as current after the migration has cleared it.

**Consequence:** `smokePassedForCurrentVersion(state)` and the renderer's equivalent can become true for a browser smoke run that completed against the pre-migration connector/runtime state. A later `launcher:setup-core` call can accept that stale proof at `main.cjs:770-772`, because its own stale-read problem (T1-16-1) is separate from this late positive writer. This creates a cross-caller chain in which migration invalidates smoke evidence, then the old smoke operation resurrects it, and setup consumes it.

**Minimal correction direction:** Capture a smoke/invalidation epoch or the relevant connector/runtime identity before `browserHost.smokeTest()`; immediately before writing positive smoke evidence, re-read current state/configuration and reject/discard the result if startup migration or connector ownership changed. Preserve the current automatic/manual distinction, Native4 / Native4 DEV / ZeroRisk4 names, and ABI pins.

**Counterevidence and limits:** The renderer's `localBusy` prevents the ordinary same-surface UI from starting another action concurrently, and `browserHost.withManualOperation()` prevents a second browser operation on the same host. Those guards do not serialize the smoke handler against the independent startup migration, which runs in the main process after renderer/IPC registration. The path requires a narrow overlap between the browser helper await and the migration completion; this review did not reproduce it and makes no frequency claim.

## Candidate-root adjudication

- **T1-16-1 / T2-16-R1 — stale setup-core smoke gate:** **Confirmed as a repeat/refinement, not a new root.** `main.cjs:758-779` still captures `setupState` before `probeAuthentication()` and evaluates that object after the await. T3-16-1 can feed this gate with resurrected proof, but the two missing currentness checks are separate defects.
- **T2-16-1 — late MCP verification positive writer:** **Confirmed, repeat/refinement only.** `main.cjs:652-687` can write positive MCP proof after doctor/connector awaits without an invalidation epoch. The Manual-mode doctor path at `:664-666` has the same class but is already included in T2's late verification root; no second ID is assigned.
- **Catalog verification monitor:** **Rejected as a new root.** `main.cjs:153-197` captures an epoch, rechecks the supervisor and persisted state after its health await, compares the runtime configuration snapshot, and requires current catalog health before setting `codexCatalogVerified`. Startup failure stops the monitor before clearing readiness.
- **Interaction-mode transitions:** **Rejected as a new root.** `browser-host.cjs:526-562` owns the temporary mode override and operation marker, blocks existing browser operations/active turn tabs, requires the runtime callback commit, and restores the prior override on failure. The main IPC caller also checks active browser operations.
- **Bigger Context / ZeroRisk4 callers:** **Rejected as a new cross-scope state root in this pass.** Their runtime operations are protected by the runtime operation boundary, and their state writers explicitly invalidate catalog proof in production before the monitor can re-establish it. ZeroRisk4 also blocks active browser turns/operations before changing the profile.
- **Native4 / Native4 DEV / ZeroRisk4 public contract:** **Rejected as a defect.** No new connector identity, App ID, public tool schema, tool count, generation-4 ABI, or manual-profile identity change was found in the reviewed callers.

## Final parent scenarios

The parent final focused verification pass should be limited to at most these 7 scenarios, within the requested 60-second cap:

1. Automatic browser smoke is awaiting its helper while connector migration clears smoke proof; late smoke completion must not restore positive proof.
2. The resurrected or stale smoke proof is immediately consumed by setup-core; setup must require current evidence.
3. MCP verification completes after runtime invalidation; late positive MCP proof must be rejected.
4. Catalog monitor completion races runtime failure/config change; epoch/config/health guards must prevent positive catalog proof.
5. Interaction-mode change races login, a browser operation, or a running turn; ownership and rollback must remain intact.
6. Bigger Context or ZeroRisk4 changes race catalog readiness; stale picker/catalog proof must not survive.
7. Native4, Native4 DEV, ZeroRisk4 names and public ABI remain unchanged across the above paths.

## Counts

- New concrete conditional findings: **1** — `T3-16-1`
- Repeats/refinements: **2** — T1-16-1 and T2-16-1 roots, with the Manual-mode T2 path included in the same root
- Rejected candidate roots recorded: **5** — catalog monitor, interaction mode, Bigger Context/ZeroRisk4, public ABI, and no separate Manual-mode MCP root
- Optional improvements: **0** — no additional optional path needed for this final adversarial pass
- ABI/identity defects: **0**
- Code changes: **0**
- Verification runs: **0**

This is the final lane report. Parent owns any focused verification and must keep it within the requested maximum of 60 seconds and 10 scenarios. This report authorizes no tests, typechecks, broad audits, scripts, production actions, or ABI changes.

