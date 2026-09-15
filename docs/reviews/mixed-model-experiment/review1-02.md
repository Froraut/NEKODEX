# NEKODEX mixed-model experiment — review 1, lane 2 (setup)

- Baseline: `9925453bd51e61c7b398abec12ec0da3aca3d3af`
- UTC start: `2026-09-15T20:28:20Z`
- UTC end: `2026-09-15T20:31:58Z`
- Review mode: manual source review only
- Verification performed: none; no tests, typechecks, scripts, live actions, commits, or delegation

## Inspected scope

- `src/setup.ts`, with focus on `setup`, `setupDevProfile`, `configureTunnel`, and `bootstrapTunnelProfile`.
- Direct setup callers in `src/cli.ts` and `src/dev-chat/cli.ts`, only to establish option and transaction entry behavior.
- Direct mutation helpers needed to verify ownership and rollback evidence: `src/service.ts`, `src/tunnel-service.ts`, `src/tunnel.ts`, `src/config.ts`, `src/codex-integration.ts`, and `src/codex-integration-shared.ts`.
- Repository guidance: `skills/nekodex-regression-prevention/SKILL.md` and `/Users/alex/.codex/skills/right-size-test-runs/SKILL.md`.

Other wave reports were not read. No source edits were made.

## Findings

### Zero concrete current bugs established

I found no executable, source-supported bug in the requested areas that clears the bar of being a current defect rather than speculative hardening, a stylistic preference, or a historical already-fixed issue.

The reviewed transaction has the following relevant behavior:

- `setup` snapshots the persisted config, service definition and loaded state, tunnel service definition and loaded state, managed runtime key, tunnel client installation, and the selected tunnel profile before the commit-sensitive phase.
- Runtime-key and tunnel-client writers update the corresponding owned snapshots immediately after their writes. Service and tunnel-service installers report the written definition through callbacks, and setup observes loaded state in `finally` blocks around service mutations.
- Rollback compares the live resource with the attempt-owned checkpoint before restoring it. If bytes, loaded state, or a status probe are unknown, rollback preserves the resource and reports recovery failure instead of overwriting it.
- The config write is tracked through `savedConfigBytes`, and rollback distinguishes the exact setup bytes from a concurrent edit. The primary setup error is retained when compensation also fails.
- `setupDevProfile` applies the same ownership checks to the DEV config, profile, tunnel client, and runtime key, and refuses to mutate an existing Full tunnel unless its old alias is explicitly observed stopped.

## Design limitation distinguished from a bug

`bootstrapTunnelProfile` deliberately preserves a tunnel profile when `connectTunnel` may have written it before failing and the profile cannot be safely attributed to a completed setup checkpoint. The caller reports that condition as manual recovery information (`failedConnectMayHaveWrittenProfile`) rather than deleting the bytes. This can leave partial state after a failed setup, but it is the fail-closed ownership policy required by the regression-prevention guidance; the inspected code does not provide evidence that this is an unintended bug.

## Handoff

Parent adjudication and any focused tests remain pending outside this lane. The source-level conclusion is zero findings.
