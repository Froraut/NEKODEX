# NEKODEX tri-wave review 1, lane 03 — runtime readiness

Baseline reviewed: `3740505b0107af9a83053fd523ae1ad30be36465` (HEAD). Scope: runtime readiness, current source and direct callers. Read-only review; no tests, typechecks, scripts, broad audits, account actions, production actions, or code edits. Canonical Native4 / Native4 DEV / ZeroRisk4 connector ABI and public names are unchanged.

Compared with `docs/reviews/2026-09-15-four-wave-results.md` and `docs/reviews/2026-09-15-four-wave-adjudication.md`: the prior D03/D04 monitor race and foreign-health/PID candidates are present as corrected behavior, and D05/D06/D13 are not repeated below. This report contains one new residual runtime-readiness finding.

## Counts

- New concrete findings: **1**
- Repeats of prior accepted/rejected candidates: **0**
- Known limits/boundaries: **2**
- Optional improvements: **0**

## T1-3-1 — persisted catalog readiness survives a launcher/daemon restart without current-daemon proof

**Trigger**

A production Full runtime was previously verified, so the persisted launcher state contains `coreSetupComplete: true` and `codexCatalogVerified: true`. The launcher process is restarted, or the supervised Responses daemon is replaced during startup, while the configuration remains semantically unchanged and the bridge route does not report `changed: true`. The new daemon is healthy but has served zero model-catalog requests since this boot.

**Exact source path**

- `launcher/electron/state.cjs:126-143` initializes the state store from the persisted state file and preserves `codexCatalogVerified`; there is no daemon-boot identity or catalog proof epoch in this state.
- In the production startup success path, `launcher/electron/main.cjs:1389-1393` starts the configured runtime and connects the bridge route. At `1397-1418`, the ready patch leaves the prior `codexCatalogVerified` value untouched unless `runtime.bridgeRouteChanged` is true at `1405-1408`.
- `launcher/electron/main.cjs:151-161` starts a new monitor but immediately stops it when the persisted value is already true: `current.codexCatalogVerified === true`.
- The monitor's current-daemon proof at `launcher/electron/main.cjs:166-176` and `launcher/electron/runtime-supervisor.cjs:608-634` is therefore never reached in this trigger. Those checks correctly bind a positive counter to the current config, launcher owner, current daemon PID, readiness state, version, mode and `accepting_turns`, but only if monitoring remains active.

**Consequence**

The UI can continue to expose catalog readiness from the previous daemon. `launcher/src/App.tsx:1343-1353` treats `codexCatalogVerified` as current catalog progress and allows the setup flow to reach picker confirmation; `launcher/src/Overview.tsx:16-23` presents model connection readiness from the same persisted flag. A new daemon with no catalog request can therefore inherit a positive proof that was produced by a prior process. This weakens the corrected D03/D04 contract: positive catalog readiness should be established by the known current launcher-owned daemon, not merely by a prior persisted boolean.

**Minimum correction**

At every startup that creates/replaces the supervised daemon, invalidate `codexCatalogVerified` (and its dependent picker confirmation) before starting the monitor, or persist and compare a current daemon boot/PID identity with the catalog proof. Then keep the existing epoch/config/PID/health checks and wait for a positive catalog counter from that current daemon. Do not change connector names, tool schemas, or the Native4 / Native4 DEV / ZeroRisk4 ABI.

**Counterevidence and limits**

- If the launcher intentionally defines catalog verification as a durable installation fact across daemon restarts, this behavior is a product decision; the current adjudication, however, defines the required proof in terms of the current launcher-owned daemon and PID, and the monitor implementation already enforces that identity for new checks.
- A bridge route change does invalidate the flag at `main.cjs:1405-1408`, and failed/non-ready startup branches clear it at `main.cjs:1422-1469`. The finding is the successful unchanged-config restart/replacement path.
- This is a source-level interleaving/state-lifetime finding. No live account, installed-app, or ChatGPT-side catalog load is claimed.

## Repeated and excluded paths

- The former in-flight monitor race (D03 / `R1-7-1`) is not repeated: the current epoch, supervisor identity, current state, config snapshot and current-health checks at `main.cjs:145-198` address that path.
- The foreign/stale endpoint counter (D04 / `R2-7-1`) is not repeated: `runtime-supervisor.cjs:608-634` now checks current launcher ownership, daemon PID, service, status, version, mode and accepting state.
- Pinned fresh-turn admission (D05), stale smoke evidence (D06), and failed-start MCP presentation (D13) are prior adjudicated paths and were not counted here. The selected-mode primary-account leniency remains a documented scope/semantics boundary from the earlier review, not a new finding in this lane.

## Runtime-readiness boundaries

- A healthy local daemon, current health payload, or persisted state does not prove ChatGPT account-side connector creation, native approval, or a live model picker load. Those remain evidence boundaries from the prior results.
- This review did not run tests, typechecks, scripts, broad audits, or production actions. Parent-owned final verification remains the single bounded pass described in the results document.
