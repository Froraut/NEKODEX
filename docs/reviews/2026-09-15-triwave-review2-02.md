# Triwave review 2, lane 2 — services

Baseline: `3740505b0107af9a83053fd523ae1ad30be36465` (HEAD). Independent manual source review of `src/service.ts`, `src/tunnel-service.ts`, `src/setup.ts`, `src/cli.ts`, and the direct launchd/status callers. I read `2026-09-15-triwave-review1-02.md` and the adjudicated four-wave ledger before assigning IDs. No tests, typechecks, scripts, broad audits, runtime/account calls, production actions, source edits, or commits were performed. Native4 / Native4 DEV / ZeroRisk4 connector identities, App IDs, and tool ABI are unchanged.

## New concrete finding

**T2-2-1 / P2 — direct `service install` can publish a new plist while leaving the old loaded daemon in place.**

Trigger: on macOS, the terminal service is already loaded and its plist differs from the current saved `runtimeCommand` (for example, the saved runtime executable path changed). `src/cli.ts:381-396` loads that config for `service install` and calls `installService(config)` directly. `src/service.ts:59-62` generates the `ProgramArguments` from `config.runtimeCommand`; `:126-129` overwrites an unlike plist; `:130-132` checks only whether the label is loaded and skips bootstrap when it is. It returns a status with `loaded: true`, even though the loaded job was never restarted with the new definition. `getServiceStatus()` (`:103-113`) proves label/path presence, not which definition launchd has loaded or which executable is running. Thus the command reports a successful install while disk definition and live daemon can disagree. On a later restart the new plist may take effect; the immediate command result is misleading and a subsequent doctor/service-status check cannot detect the stale live command from this helper.

This is a direct CLI path, separate from D01/D02's failed-setup write/rollback ownership root. `setup()` has a distinct `changedWhileLoaded` and `--restart-service` path (`src/setup.ts:727-757`), but the direct `service install` caller does not use it. The tunnel installer already refuses a mismatching loaded definition before writing (`src/tunnel-service.ts:121-125`), which shows the required terminal-service guard can be added without changing connector ABI. Minimum correction: refuse to replace a loaded mismatching terminal definition through direct install, or perform a verified idle drain and restart with exact ownership checks; report the live state only after that transition succeeds.

## Challenge to wave 1

Wave1 lane 2 correctly verifies that the new synchronous callbacks checkpoint plist writes before a throwing bootstrap (`src/service.ts:126-129`, `src/tunnel-service.ts:128-133`, `src/setup.ts:661-668`). It does not inspect the direct loaded-service `install` outcome. Its statement of **0 new concrete bugs** is therefore too broad for the same service scope: `T2-2-1` is a new current-HEAD source path. The D01/D02 ownership correction remains valid; this report does not reopen those defects.

## Repeats, qualified limits, and optional work

- **Repeats excluded:** D01/D02 write-before-checkpoint and failed-bootstrap rollback cases are already corrected. D12 post-commit cleanup warning is present at `src/setup.ts:983-999`. D19's launcher-owned `tunnel status` exit rule is corrected at `src/cli.ts:453-455`. I issue no new IDs for those paths.
- **Known limit:** `getServiceStatus()` and `getTunnelServiceStatus()` still map an ordinary nonzero `launchctl print` to unloaded (`src/service.ts:103-113`, `src/tunnel-service.ts:88-104`). A missing target uses that result. This read did not establish a distinct actionable print failure that must be classified differently. Thrown/timed-out probes are treated as unknown by setup (`src/setup.ts:639-659`).
- **Qualified concurrency limit, not another defect ID:** both installers can race with a second actor between a status probe and a plist write/bootstrap. Tunnel install has an initial loaded-definition guard (`src/tunnel-service.ts:121-125`); terminal install probes after writing (`src/service.ts:126-132`). The direct loaded mismatch in `T2-2-1` needs no concurrent actor, so it is the stronger finding. I do not claim that the current setup lock or external launchd ownership permits a particular concurrent takeover without further evidence.
- **Optional improvements:** none in this lane. Unload waits and failed launchd observation remain bounded/manual-recovery limits already recorded in the first wave and ledger. No ABI/schema/name change is warranted.

## Counts and handoff

New concrete bugs: **1** (`T2-2-1`). Repeats of adjudicated roots: **D01/D02/D12/D19**, excluded. Known/qualified limits: **2**. Optional improvements: **0**. Source edits/commits: **0**; this review document is the sole saved artifact. Parent owns final focused verification under the shared **<=60 seconds / max 10 scenarios** budget.
