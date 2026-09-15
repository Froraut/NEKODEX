# NEKODEX triwave review 1, lane 1 — setup/rollback

HEAD reviewed: `3740505b0107af9a83053fd523ae1ad30be36465` (`3740505`).

Scope: `src/setup.ts`, its direct setup callers, and the directly coordinated service/tunnel helpers used for setup compensation and rollback. Compared against `docs/reviews/2026-09-15-four-wave-results.md`, `docs/reviews/2026-09-15-four-wave-adjudication.md`, the prior setup/rollback review lanes, and their correction reports. Read-only manual source review only. No tests, typechecks, scripts, broad audits, runtime or production actions were run. No code or ABI edits were made.

## Counts

- New concrete defects: **0**.
- Finding IDs assigned: **none**; therefore there are no `T1-1-n` findings.
- Repeated adjudicated defects: **D01, D02, D10, D11, D12**; no new IDs assigned.
- Rejected or overstated prior claims: **none reopened** in this scope.
- Optional improvements: **0**.
- Known limitations recorded: **1**.

## Source review result

No new independent setup or rollback root was found at this HEAD.

1. The service definition write-before-bootstrap transition is now checkpointed through `installService(config, onServiceDefinitionWritten)` in `src/setup.ts:749-753`, with the callback implemented in `src/setup.ts:661-664`. The rollback path checks the owned bytes and loaded state before uninstalling/restoring at `src/setup.ts:873-889`. This is the D01 path from the adjudication, not a residual defect.

2. The tunnel definition write-before-bootstrap transition is now checkpointed through `installTunnelService(config, onTunnelDefinitionWritten)` in `src/setup.ts:803-813`, with the helper callback after the atomic write in `src/tunnel-service.ts:112-127`. Rollback checks the captured definition and loaded state before restoring at `src/setup.ts:896-945`. This is the D02 path, not a new finding.

3. Direct DEV setup now performs a fail-closed status check before `configureTunnel` can write the managed key or install the client: `src/setup.ts:1032-1057`, followed by the mutation transaction and compensation at `src/setup.ts:1074-1150`. This closes the previously adjudicated D10/D11 trigger for an already running or indeterminate existing Full alias. The direct caller awaits this result before printing success at `src/dev-chat/cli.ts:345-383`.

4. Post-commit legacy cleanup is now warning-producing rather than converting a committed setup into a reported failure: `src/setup.ts:983-999`. The direct CLI consumes the warning while retaining successful setup output and exit behavior, as described in the correction report. This is D12 and is not repeated.

## Known limitation / counterevidence

The DEV pre-mutation status observation at `src/setup.ts:1041-1057` and the first mutation at `src/setup.ts:1075` are separate operations. A cooperating or external launcher could theoretically restart the old alias between the successful stopped observation and the subsequent key/client/profile mutation. The direct CLI has no atomic owner/idle-drain handshake; the correction reports and adjudication explicitly retain this distributed ownership boundary. The launcher may also already have stopped the runtime as part of its own setup workflow. Source inspection therefore supports recording this as a known race limitation, but it does not establish a new independently adjudicated defect for this lane.

## Contract boundary

The inspected setup and rollback paths do not require or justify any change to the canonical connector identities `Native4`, `Native4 DEV`, or `ZeroRisk4`, and do not alter the public generation-4 tool schemas or ABI pins.

