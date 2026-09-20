# Runtime lifecycle review — code lane 01

Scope: manual review of `launcher/electron/runtime.cjs`, `runtime-supervisor.cjs`, and the startup/shutdown seams in `main.cjs` at `e10c52acb23da1c05d401faaa49d0b34c912e830` (`5.6.0-nekodex.3`). No source edits, automated checks, builds, CI, app driving, account access, or network actions were performed.

Observed release history is kept separate from source inference. `5.6.0-nekodex.1` failed during account-capability inspection; `.2` repaired the closed reasoning-menu activation; `.3` repaired the hidden primary browser viewport. Those browser fixes are already present and are not repeated here as findings. The lifecycle below made either browser defect capable of failing an otherwise locally usable replacement.

## 1. P1 — A release/account migration is a mandatory predecessor of local runtime availability

**Location:** `RuntimeHost.upgradeManagedRuntime()` in `launcher/electron/runtime.cjs:1466-1515`; `RuntimeHost.runSetup()` in `launcher/electron/runtime.cjs:1678-1708`; production startup in `launcher/electron/main.cjs:1681-1745`; local start ownership in `RuntimeSupervisor.startIfConfigured()` / `startConfigured()` in `launcher/electron/runtime-supervisor.cjs:1289-1445`.

**Observed trigger:** after installing `.1`, the startup upgrade refreshed account capabilities and failed at the reasoning control. `.2` reached the same startup dependency with an unusable hidden viewport, which `.3` then fixed. In current source, every launcher-version mismatch still makes `upgradeManagedRuntime()` pass `--refresh-account-capabilities` (`runtime.cjs:1501-1505`). `runSetup()` stops the prior runtime before executing that setup (`:1698-1703`), and `main.start()` awaits the upgrade before calling `runtimeSupervisor.startIfConfigured()` (`main.cjs:1683-1687, 1741`). Thus any future browser DOM, login, viewport, account, or capability-probe failure can again prevent local daemon/tunnel availability even when the saved runtime configuration and credentials remain usable.

**Concrete fix and ownership:** make `main.start()` own two independent tracks. The **local runtime track** should read the saved configuration, start/adopt the compatible daemon and tunnel through `RuntimeSupervisor`, and connect the saved bridge route without waiting for account refresh. The **browser/account track** may refresh authentication and capabilities concurrently and publish `unknown`, `signed-out`, `probe-failed`, or `ready` without changing local runtime readiness. Move release migration out of startup's prerequisite chain: `RuntimeHost` should prepare a candidate configuration, but only a dedicated lifecycle coordinator in `main.cjs` should drain/switch the running runtime after local availability is established and the browser-dependent candidate is validated. `RuntimeSupervisor` remains sole owner of process start/stop/drain; `RuntimeHost` owns configuration preparation and rollback, not process ordering.

## 2. P1 — Updater readiness proves only version executability, before the replacement runtime starts

**Location:** update handoff in `main.start()` at `launcher/electron/main.cjs:1587-1594`; the actual production runtime sequence at `main.cjs:1681-1774`; `RuntimeSupervisor.startConfigured()` readiness at `launcher/electron/runtime-supervisor.cjs:1405-1424`.

**Observed fact:** the current handoff is acknowledged immediately after renderer/browser bootstrap. The supplied proof runs only `runtime --version`; the managed upgrade, daemon/tunnel start, route connection, and resulting lifecycle publication all happen later in a detached async chain. The updater therefore may commit and delete its previous application after a matching version string while the candidate is about to fail the exact startup path that failed in `.1` and `.2`.

**Inferred failure trigger:** a candidate can pass `--version`, write `ready.json`, and remain alive for the updater grace interval, then fail capability migration, local runtime start, or bridge-route connection. At that point updater rollback is no longer available even though `main.cjs` reports `runtime-start: failed` and may restore the prior Codex route. This source review did not execute an update transaction, so the post-commit failure is inferred from ordering rather than reproduced.

**Concrete fix and ownership:** replace the current version-only acknowledgement with one coordinator-owned **candidate acceptance gate**. For a configured installation, acknowledge only after: (1) the candidate runtime/config pair is compatibility-validated, (2) daemon/tunnel report owned `ready`, (3) the saved bridge route is connected or explicitly proven unchanged, and (4) startup has reached a stable state with no migration rollback in progress. For an unconfigured installation, use an explicit `not-configured` terminal state rather than requiring account readiness. The readiness payload should include a small lifecycle/schema generation and terminal state in addition to app version; the update worker should commit only accepted generations. Keep the previous app and previous configuration checkpoint until that gate. `main.cjs` owns acceptance, `RuntimeSupervisor` supplies owned-process evidence, `RuntimeHost` supplies config compatibility/migration status, and the updater owns app rollback.

## 3. P2 — A recovered previous runtime is still globally invalidated as a startup failure

**Location:** rollback in `RuntimeHost.runSetup()` at `launcher/electron/runtime.cjs:1723-1751`; startup rejection handling in `launcher/electron/main.cjs:1821-1837`; quit/start exclusion in `main.cjs:1334-1383` and `RuntimeSupervisor.shutdown()` at `launcher/electron/runtime-supervisor.cjs:2468-2477`.

**Observed source behavior:** when a configured migration fails, `runSetup()` restores its checkpoint and calls `restorePreviousRuntime()` before rethrowing. The outer startup catch then unconditionally retires account proof, writes `coreSetupComplete: false` / `mcpSetupComplete: false`, and invokes `restoreCodexRouteAfterRuntimeFailure()`. This discards the distinction between “candidate/account migration failed but previous runtime was restored” and “no usable local runtime exists.” Shutdown has a clearer single owner and bounded start settlement, but startup does not expose an equivalent transactional outcome to its caller.

**Inferred failure trigger and impact:** after a browser-only migration failure with successful previous-runtime recovery, NEKODEX can take a healthy restored runtime out of service semantically, mark setup incomplete, and redirect Codex away from it. This amplifies a recoverable account-readiness issue into a native availability interruption. The exact restored-runtime/route outcome was not live-tested in this lane.

**Concrete fix and ownership:** return a typed lifecycle result from `runSetup()` instead of flattening recovery into a thrown string, for example `{ candidate: "failed", previousRuntime: "ready", account: "probe-failed" }`. `main.cjs` should preserve `coreSetupComplete` and the bridge route when `previousRuntime === "ready"`, publish the migration/account problem separately, and clear runtime state or restore the external route only when the supervisor proves `unavailable`, `external`, or `needs-setup`. Use the same lifecycle coordinator for startup and quit admission so migration cannot begin after shutdown is requested and shutdown can cancel candidate work without changing the last committed runtime generation.

## Minimal lifecycle shape

The three findings converge on one small state model rather than three local patches:

1. **Committed runtime generation:** last known compatible config, route, and owned process identity; independently bootable without a browser/account probe.
2. **Browser/account readiness:** asynchronous evidence attached to that generation, allowed to be unknown or degraded while native/local service remains available.
3. **Candidate generation:** staged config/runtime changes with an explicit checkpoint. Validate browser-dependent changes, drain and switch once, then atomically promote; otherwise keep or restore the committed generation.
4. **Updater acceptance:** emitted only after the candidate reaches a terminal local lifecycle state. Account readiness is required only for migrations that change account-derived capability/configuration, not for opening the app or serving the already committed native runtime.

This preserves Native4/5 rollback compatibility and Native6 connector identity: an application update may boot the committed connector/runtime first, while a Native6 migration remains a separate candidate until its new connector and account capability evidence are ready.
