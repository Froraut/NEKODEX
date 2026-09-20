# Development verification and release readiness

Version: 5.5.0-nekodex.1. Parent integrated four completed Daybreak implementation/review lanes.
An isolated source snapshot, private Electron profile, synthetic usage history and authenticated
local collector were used. Production accounts, installed application and live routes were untouched.

## Passing behavioral scope (10 cases)

1. External-link gesture consumption and rejection of local destinations.
2. Usage v3 migration, account aggregation, durations, failures, runs and zero-day calendar.
3. Legacy browser login evidence requires live reverification without deleting stored state.
4. Chunk-split oversized Native terminal stays completed after early delivery cancellation.
5. Owned build output retains the last good bundle and refuses source/unowned paths.
6. Browser state merges parallel records and preserves legacy thread affinity.
7. Real MCP stdio Native5 owned operation start/poll/cancel/ack and terminal-delivery fence.
8. Actual Electron statistics Web/Native filters, measured zero vs unknown tokens, aggregate CSV.
9. Actual Electron modal keyboard containment and focus restoration.
10. Actual Electron statistics viewport layout and screenshot, without horizontal overflow.

The seven unit cases were selected by exact names. Three UI scenarios used the actual development
renderer and Electron IPC. Native fixtures were posted to the private authenticated local endpoint.
No real account requests, external tool side effects, long-duration load or broker-crash durability
were claimed by these observations. Browser tests do not establish every possible filesystem race.

## Build and correction evidence

Root and renderer TypeScript checks passed. Development browser helper and final Vite renderer
build passed; version markers passed at 5.5.0-nekodex.1 with Bun 1.4.0. Vite emitted an advisory
about the main chunk exceeding 500 kB; no measured performance improvement is claimed.

Initial failures exposed a stream-read typing issue, outdated fixture shapes, incorrect UI window
selection and ambiguous accessible filter names. Corrections were applied and only failed cases
retried. The development host now reports its actual owned listener via private IPC; it cannot attach
the app to an unrelated service at a fixed port. Later locale wording changes were manually reviewed.

Total automated verification including failed attempts and compilation: 33.708 seconds.
No full suite, mass replay or repeated successful behavioral checks. All four workers ran no tests
or builds. Temporary Electron and Vite processes were closed after observation.

## Material limits

Native telemetry is best effort, with bounded queues and reported/unreported token coverage; it is
not an official quota ledger. Native5 is explicit opt-in with a separately verified connector and
process-local operation ownership; post-dispatch cancellation cannot undo external side effects.
The installed production application has not been replaced. Platform packaging/publication is a
separate delivery step; Windows remains an unsigned preview without Authenticode credentials.
