# Independent blind review wave2 lane1: services

- Repository: `/Users/alex/Dev/nekodex`
- Baseline inspected: `9925453` (working tree source files unchanged; existing unrelated untracked paths were left untouched)
- UTC start: `2026-09-15T20:35:25Z`
- UTC end: `2026-09-15T20:36:59Z`
- Review type: source-only manual review; no tests, typechecks, scripts, runtime checks, commits, edits to source, or delegation

## Inspected scope

Primary files:

- `src/service.ts`
- `src/tunnel-service.ts`

Reachability and error-path context inspected:

- `src/process.ts` (`runCommand`/`runChecked` and synchronous `spawnSync` behavior)
- Direct service and tunnel callers in `src/setup.ts`, `src/cli.ts`, and `src/doctor.ts`

The review followed normal, alternate, error, cancellation, and direct-caller paths for launchd status probes, install/start, stop/restart, uninstall, drain compensation, and tunnel status polling. No prior mixed-model review or historical finding was read.

## Findings

### 1. launchctl print failures are treated as proof that the service is unloaded

- **Trigger:** On macOS, `launchctl print gui/<uid>/<label>` returns any ordinary nonzero status other than the expected “service is absent” case: for example, a permission failure, malformed launchd state, or another launchctl/transport error. `runCommand` returns the nonzero result, rather than throwing, for these cases.
- **Exact locations:**
  - `src/service.ts:103-113`, especially line 110: `loaded: result.status === 0`.
  - `src/tunnel-service.ts:94-115`, especially lines 111-112: `loaded` and `running` are derived solely from `result.status === 0`.
- **Reachable consequence:** The callers receive `{ loaded: false }` even though the launchd state is unknown. `installService` can then write a new plist and bootstrap over an unverifiable service (`src/service.ts:123-135`); `startService` and tunnel start can attempt bootstrap (`src/service.ts:142-144`, `src/tunnel-service.ts:158-162`); stop/uninstall can skip bootout and remove the plist while a service may still be loaded (`src/service.ts:306-332`, `src/tunnel-service.ts:192-212`). Setup and doctor also make ownership and health decisions from that false unloaded result (`src/setup.ts:544-558`, `src/setup.ts:770-803`, `src/doctor.ts:164-180`, `src/doctor.ts:201-218`). This defeats the source’s intended “unknown state” handling: the setup catch paths only preserve state when the status probe actually throws (`src/setup.ts:645-665`, `src/setup.ts:879-909`).
- **Counterevidence:** A `spawnSync` timeout or spawn error does throw through `runCommand`, and tunnel status has a five-second print timeout (`src/tunnel-service.ts:9`, `src/tunnel-service.ts:103-107`). Those paths are therefore surfaced as unknown. The ordinary nonzero-result path remains incorrectly classified.
- **Smallest fix:** Make launchctl status tri-state or throw for every nonzero result except a narrowly classified, documented “service not found” response. Propagate that unknown state to all install/start/stop/uninstall decisions; do not use `loaded: false` as the fallback for permission, malformed-state, timeout, or transport failures. Apply the same classification to both service modules.
- **Confidence:** High. The misclassification is explicit in both status functions and is consumed by reachable lifecycle mutations.

### 2. Service launchctl probes have no effective per-probe deadline, and the unload deadline can be bypassed

- **Trigger:** A `launchctl print`, `bootstrap`, or `bootout` invocation used by the managed daemon service stalls or waits indefinitely. The service module calls `runCommand`/`runChecked` without a timeout (`src/service.ts:106`, `src/service.ts:134`, `src/service.ts:143`, `src/service.ts:287`, `src/service.ts:311`, `src/service.ts:325`). `runCommand` passes options directly to synchronous `spawnSync` (`src/process.ts:24-35`).
- **Exact locations:**
  - `src/service.ts:51-57`: `waitForServiceUnloaded` checks `Date.now()` only before and after a synchronous `getServiceStatus()` call. A blocked status probe prevents both the loop deadline and the final error from being reached.
  - `src/service.ts:103-114`: `getServiceStatus` has no timeout parameter and performs the unbounded `launchctl print`.
  - Lifecycle callers at `src/service.ts:116-145` and `src/service.ts:282-332` invoke launchctl mutation probes without bounded timeouts as well.
- **Reachable consequence:** `stopService` and `restartService` advertise a 20-second unload wait but can hang beyond it, and install/start/stop/restart/uninstall can block the CLI or setup indefinitely on a stalled launchctl call. The same unbounded status path is used by direct status and doctor callers, so a status command can also hang.
- **Counterevidence:** `tunnel-service.ts:165-189` bounds each tunnel status probe by the remaining unload deadline, and tunnel print calls have a five-second default (`src/tunnel-service.ts:9`, `src/tunnel-service.ts:94-107`). That bounds tunnel polling, but tunnel bootstrap/bootout still pass no timeout to `runChecked` (`src/tunnel-service.ts:149-160`, `src/tunnel-service.ts:192-199`), and it does not fix the daemon service’s unbounded probes.
- **Smallest fix:** Give every launchctl invocation an explicit deadline. Add a timeout-aware status probe in `service.ts`; pass the remaining enclosing deadline to each unload poll; and bound bootstrap/bootout calls in both modules. Treat timeout as unknown/failed state and retain the primary lifecycle error while reporting any compensation failure.
- **Confidence:** High. The synchronous call is directly inside the deadline loop, so the loop’s elapsed-time check cannot constrain a blocked probe.

## Review conclusion

Two concrete reachable defects were found. Both concern current launchd service state and lifecycle behavior; neither relies on style preferences, future-only hardening, or a known fail-closed limitation.
