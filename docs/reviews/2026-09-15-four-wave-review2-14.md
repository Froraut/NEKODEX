# Review wave 2, fresh Sol lane 14 — tunnel resource lifecycle

Frozen source baseline: `3a66157a8943a80bbbe299699cc96bec82721ba1`. Manual review of `src/tunnel.ts`, `src/tunnel-service.ts`, direct setup/CLI/doctor paths, then wave-1 lane 14 and adjacent lane 4. Source remained read only. No tests, typechecks, script audits, runtime/production actions, commit, or schema/identity edits.

## New concrete finding (1)

### R2-14-1 — launcher-owned healthy tunnel gets a failing CLI status exit

**Trigger:** A Full config with `browserHost === "launcher"` has a healthy launcher-supervised tunnel and no installed/loaded launchd tunnel service. Run the CLI `tunnel status` command.

**File/line and consequence:** `src/cli.ts:447-452` obtains `tunnelStatus(config)` and `getTunnelServiceStatus()`, then sets `process.exitCode = 1` whenever `!service.running || !status.ok`. `src/tunnel-service.ts:88-104` reports `running: false` for absent launchd service (and every non-macOS launcher config). Thus the command prints an `ok` runtime but exits unsuccessfully, misleading a caller using the status exit code into diagnosing tunnel failure. This is a reporting/exit-status defect, **not evidence that the runtime failed**. The check also affects the `start`/`restart` branch if invoked in launcher ownership, but their service-control semantics are separate and not counted here.

**Counterevidence/boundary:** Terminal-managed Full does require the service and runtime to be ready, so its exit rule is correct. `src/doctor.ts:193-211` explicitly treats absence of an OS tunnel service as normal under launcher ownership and checks the runtime independently. `src/setup.ts:719-753` likewise uninstalls the legacy service for launcher ownership, while terminal ownership installs/restarts it and waits for runtime readiness. No actual CLI invocation or live tunnel state was exercised.

## Challenge of wave 1

**R1-14-1 rejected as stated (not a new R2 finding).** Its exact trigger assumes an unchanged tunnel configuration, existing matching plist/profile, and an app-name-only generation-4 migration. The terminal path does restart without reconnecting the existing profile (`src/setup.ts:731-749`), but the alleged consequence that the YAML keeps a *retired connector name* lacks a data path: `src/tunnel.ts:384-398` builds the profile MCP command from `runtimeCommand`, the mode contract and `brokerSocketPath`, without `appName`; `connectTunnel` supplies tunnel ID, key, alias and profile, not the ChatGPT connector name (`:405-418`). `tunnelServiceDefinition` similarly supplies only binary and profile paths (`src/tunnel-service.ts:52-85`). The name belongs to config/account-side connector selection (`src/config.ts:24-39,361-399`), not the profile command in this inspected path. `refreshTunnelWorker` also covers actual worker changes (`src/setup.ts:202-209,531-534`); a changed/missing profile takes bootstrap, and launcher/DEV paths explicitly bootstrap on migration (`:719-729,962-972`). An independently demonstrated generation-dependent profile field could reopen the candidate, but wave 1 did not identify one. Healthy/ready flags prove only runtime readiness, not ChatGPT connector attachment; equally, they do not prove the claimed stale-name failure.

**Repeated candidate R1-4-2, excluded from new count.** A changed tunnel plist can be written by `installTunnelService` before `launchctl bootstrap` fails (`src/tunnel-service.ts:118-127`); `src/setup.ts:742-743` checkpoints only on return and rollback sees the uncheckpointed write at `:823-826`. This is the same failure and consequence already reported by lane 4. Successful installation checkpoints, and failed-connect profile bytes are deliberately preserved for manual recovery (`src/setup.ts:827-832`); neither makes a second finding.

## Limitations and optional items

No optional improvement is proposed. The unload loop bounds its own poll to 20 seconds, while initial status, bootout, and final status are outside it (`src/tunnel-service.ts:137-155`); this known timing limitation is not counted. `parseTunnelStatus` maps a failed/non-JSON status probe to `ok: false` (`src/tunnel.ts:521-566`); that alone is not proof of an absent process. A healthy tunnel/CLI report does not establish live ChatGPT schema load or approval.

Counts: **1 new concrete reporting defect (R2-14-1); 1 rejected wave-1 claim (R1-14-1); 1 duplicate excluded (R1-4-2); 0 optional improvements; 1 known timing limitation.**
