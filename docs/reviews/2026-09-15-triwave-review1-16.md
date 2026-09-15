# NEKODEX triwave review 1 lane 16 — cross-cutting callers

Baseline: `3740505b0107af9a83053fd523ae1ad30be36465` (HEAD). Read-only manual review of current source, direct launcher callers, `docs/reviews/2026-09-15-four-wave-results.md`, and `docs/reviews/2026-09-15-four-wave-adjudication.md`. No tests, typechecks, scripts, broad audits, runtime/account inspection, production actions, code edits, or connector changes were performed.

Scope: cross-cutting callers around launcher state, snapshot/state events, setup gates, migration invalidation, and the Native4 / Native4 DEV / ZeroRisk4 public contract.

## New finding

### T1-16-1 — In-flight setup-core uses a stale smoke gate after asynchronous state invalidation

**Priority:** P1 conditional source defect  
**Trigger:** An automatic production launcher has a current-version smoke pass, so Setup enables Core installation. The renderer invokes `setupCore` through `App.tsx:1391-1394`. The IPC handler snapshots `setupState = stateStore.read()` at `launcher/electron/main.cjs:758-760`, then awaits `browserHost.probeAuthentication({ forSetup: true })` at `main.cjs:761-769`. Only after that await does it evaluate the required smoke condition, but it evaluates the earlier `setupState` object at `main.cjs:770-777`.

While the authentication probe is pending, the startup runtime upgrade path can finish a managed connector migration and clear `browserSmokePassed` and `browserSmokeVersion` in `main.cjs:1344-1357`, then publish the invalidated state at `main.cjs:1357`. The renderer is allowed to interact while this startup work continues: IPC is registered before the renderer is loaded at `main.cjs:1244-1257`, while the runtime upgrade starts in the following startup path at `main.cjs:1332-1349`. If the setup request captured a passing `setupState` before that invalidation, the condition at `main.cjs:770-772` still succeeds and `runtimeHost.setupCore()` runs at `main.cjs:779`, despite current persisted evidence no longer satisfying the mandatory pre-core smoke requirement.

**Consequence:** A setup operation already in flight can install/configure the core route after the current connector migration has invalidated its browser smoke evidence. This is a cross-caller state consistency defect at the asynchronous IPC boundary. It differs from adjudicated D06: D06 was a stale UI/snapshot claim after invalidation; this path can use stale evidence to pass the mandatory `setup-core` gate.

**Minimal correction direction:** After the awaited authentication probe, re-read `stateStore.read()` and validate the current mode and current-version smoke evidence immediately before `runtimeHost.setupCore()`; alternatively serialize setup against migration/state invalidation with an operation epoch. Preserve the existing Native4 / Native4 DEV / ZeroRisk4 identities and ABI pins.

**Counterevidence and limits:** The renderer's `run` helper prevents ordinary duplicate actions from the same UI while one action is busy (`launcher/src/App.tsx:1363-1374`), but it does not make the main-process startup migration and the already-running IPC handler atomic. The path requires a narrow overlap between the authentication await and the managed-runtime upgrade, and this review did not reproduce it. If migration completes before the request's initial read, the current gate rejects correctly; if it completes after `runtimeHost.setupCore()` starts, this specific stale-read window has already closed. No claim is made that every setup call is affected.

## Repeats, adjudicated paths, and known limits

- **D06 / R1-16-1 / R2-16-1:** no longer reported as a current defect in this lane. Current `main.cjs:468-470,478-506` derives snapshot smoke from persisted current-version state, and current `App.tsx:44-45,88-100,132-141,172-181,215-223` replaces smoke state from each fresh state rather than retaining a monotonic session flag. The historical reports remain the same-root adjudicated record; they are not counted again.
- **D03/D13 state publication:** current `state.cjs:96-100,132-140` still clears current catalog/picker/MCP proof when core setup is false or catalog proof is explicitly false. No new state-store defect found.
- **ABI and connector identity:** current direct surfaces retain the canonical Native4, Native4 DEV, and ZeroRisk4 names and the existing public pins. No schema, tool-list, App ID, or display-identity finding is proposed.
- **Known boundaries:** source review cannot establish overlap frequency, live account behavior, or actual setup result. The finding is accepted as a conditional source-path candidate for parent adjudication because both asynchronous operations and the stale object are explicit in current callers.

## Optional improvement

A future API cleanup could have `launcher:setup-core` return the committed `LauncherState` instead of requiring the renderer to issue a second `launcher:snapshot` call (`App.tsx:1391-1394`, `types.ts:235`). Current callers do perform that refresh, so this is an observability/atomicity improvement rather than an independent bug and is not counted.

## Counts

- New concrete conditional findings: **1** — `T1-16-1`
- Repeats of prior findings proposed: **0**
- Known/qualified boundaries recorded: **4**
- Optional improvements: **1**
- ABI/identity defects: **0**
- Code changes: **0**
- Verification runs: **0**

