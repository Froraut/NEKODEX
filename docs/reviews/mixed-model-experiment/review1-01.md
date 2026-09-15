# NEKODEX mixed-model experiment review wave 1, lane 1

- Repository: `/Users/alex/Dev/nekodex`
- Baseline: `9925453`
- Review type: manual source review only
- UTC start: `2026-09-15T20:29:47Z`
- UTC end: `2026-09-15T20:31:52Z`

## Inspected scope

Primary review:

- `src/service.ts`: service status, install/start, drain, restart, stop, uninstall, and launchd polling.

Narrow supporting review:

- `src/tunnel-service.ts`: corresponding launchd status and lifecycle behavior, to compare deadline and unknown-state handling.
- Direct callers in `src/cli.ts` and the service-transition portions of `src/setup.ts`, only to establish impact and reachable triggers.
- `src/process.ts`, to verify the actual `spawnSync` timeout behavior used by the service code.

I did not read other mixed-model experiment review reports. I made no source edits and ran no tests, typechecks, scripts, live actions, or delegated work.

## Findings

### 1. Launchd probe failures are reported as `loaded: false` and can drive destructive lifecycle decisions

- Severity: High (P1)
- Exact locations: `src/service.ts:getServiceStatus` (lines 103-114); `src/tunnel-service.ts:getTunnelServiceStatus` (lines 94-115).
- Executable trigger: On macOS, make `launchctl print gui/<uid>/<label>` return a nonzero result for a permission, launchd communication, malformed-state, or other error that is not a confirmed “service not found” result. Both functions return `loaded: false`; the tunnel function explicitly documents that any ordinary nonzero result means unloaded.
- Impact: Callers cannot distinguish “unloaded” from “state unknown.” `stopService` and `uninstallService` can skip `bootout` and `uninstallService` can then remove the plist at `service.ts:331`. `restartService` can take the `!loaded` branch and call `startService`, potentially attempting to bootstrap while the existing job state is unknown. The same error class affects `stopTunnelService`/`uninstallTunnelService`, which can skip bootout and remove the tunnel plist. Setup and CLI status output can consequently report a clean absent state or continue a transition after losing proof of ownership.
- Smallest fix: Represent the print result as a tri-state or throw a classified unknown-state error for every nonzero result except the exact, recognized launchd “service not found” condition. Make stop, restart, uninstall, and setup abort closed on unknown; only the recognized not-found result may map to `loaded: false`. Preserve the existing installed-file check separately.
- Confidence: High. The status objects have only a boolean, and the direct callers branch on that boolean. This is a current reachable behavior, not a historical claim.

### 2. `getServiceStatus` has no per-probe deadline, so the advertised lifecycle timeout can be bypassed

- Severity: High (P1)
- Exact locations: `src/service.ts:getServiceStatus` (lines 103-114); `src/service.ts:waitForServiceUnloaded` (lines 51-57); `src/process.ts:runCommand` (lines 24-35).
- Executable trigger: On macOS, cause the `launchctl print` child process to stall or stop responding. `getServiceStatus` calls `runCommand` without a `timeout` option. `runCommand` delegates to synchronous `spawnSync`, so the call blocks before `waitForServiceUnloaded` can re-check its `Date.now()` deadline. The same unbounded probe is used by service status, install, start, restart, stop, uninstall, and drain acquisition.
- Impact: `waitForServiceUnloaded(20_000)` is not a real 20-second upper bound. A stalled status probe can freeze the CLI and setup transition indefinitely, including after a service has been booted out. The operation cannot classify the result as unknown or release/retain lifecycle ownership deliberately.
- Smallest fix: Pass a bounded `timeout` to every service `launchctl print`, with polling calls using the remaining enclosing deadline. Convert the timeout exception into the same explicit unknown-state result used by finding 1; do not convert it to unloaded. The tunnel implementation already has a bounded print probe, but its nonzero-state classification still needs finding 1’s correction.
- Confidence: High. `spawnSync` is synchronous and the service path supplies no timeout at all; the only deadline is checked outside the blocking call.

### 3. Service launchd mutations are also unbounded, and restart’s 20-second bootstrap loop does not bound each attempt

- Severity: High (P1)
- Exact locations: `src/service.ts:installService` (line 134), `src/service.ts:startService` (line 143), `src/service.ts:restartService` (lines 282-293), `src/service.ts:bootstrapService` (lines 39-49), and `src/service.ts:stopService`/`uninstallService` (lines 306-332).
- Executable trigger: On macOS, make a `launchctl bootstrap` or `launchctl bootout` invocation hang. The service calls `runChecked` without a timeout for install/start/bootout. `restartService` also calls `bootstrapService`, whose loop checks a 20-second deadline only before calling unbounded `runCommand("launchctl", ["bootstrap", ...])`.
- Impact: Install, start, stop, and uninstall can remain stuck indefinitely. During restart, the service has already acquired a drain lease; a hung bootout or bootstrap prevents the catch block from running and therefore prevents the compensating resume path from executing. The caller can be left waiting with the daemon stopped or drained and without a bounded error.
- Smallest fix: Give each mutating `launchctl` call a timeout bounded by the operation deadline. In `bootstrapService`, pass `Math.max(1, deadline - Date.now())` to `runCommand` and classify timeout as a failed/unknown mutation with the existing cleanup path. Apply the same bounded option to bootout and the one-shot bootstrap calls, retaining the primary mutation error and any resume error.
- Confidence: High for the unbounded child calls; high for the restart consequence because the drain lease is released only in the `catch` path after the synchronous call returns or throws.

## Design limitation, not a finding

`ServiceStatus.loaded` is a launchd registration state, not proof that the service process is currently executing. A loaded job whose process is stopped or repeatedly crashing is still a valid launchd state; treating that as equivalent to `running` would require a separate process-health probe and would change the API contract. The concrete bugs above concern loss of state certainty and missing deadlines, rather than that distinction.

## Review conclusion

Three current bugs meet the requested threshold. No additional finding is included for stylistic hardening, speculative races, or behavior that was not executable from the inspected path.
