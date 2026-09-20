# Native route continuity review — code lane 03

Scope: bounded manual review of `src/server.ts`, `src/native-passthrough.ts`, Codex route/diagnostic sources, launcher runtime supervision, and direct callers. No source edits, agents, automated checks, builds, CI, UI driving, live accounts, network requests, or authentication were used.

## Findings

### 1. High — Full broker failure disables native passthrough that does not require the broker

**Observed.** `startServer()` defines one global admission predicate as `!draining && brokerReady()` (`src/server.ts:981-995`). Every public route uses it, including `/v1/models`, native `/v1/responses` requests, native compaction, search, and images (`src/server.ts:1221-1317`). The native implementations forward directly through `forwardNativeCodexRequest()` (`src/native-passthrough.ts:510-660`) and do not use `TurnBroker`. `responseRequest()` also has an explicit native branch that forwards before browser work (`src/server.ts:488-520`).

**Failure trigger.** In Full mode, `TurnBroker.listen()` rejects or the broker enters `failed`. `brokerReady()` becomes false, so the listener returns the local-tool-broker 503 for native model catalog and native request traffic even when the HTTP listener, bearer token, and first-party native upstream path remain usable.

**Proposed fix and ownership.** The server lifecycle owner should replace the global predicate with capability-specific admission: a base/native predicate (`!draining`) and a Full browser/tool predicate (`!draining && brokerReady()`, plus any browser capability required by that selected route). Move `/v1/responses` admission until after the model/interaction route is classified, or perform a bounded request classification before choosing the predicate. Keep broker failure explicit in health and reject only requests whose selected route needs it. Coordinate this with the route lifecycle owner because drain/shutdown must continue to close every capability atomically.

### 2. High — Full startup makes tunnel readiness a prerequisite for starting the native daemon and connecting the Codex route

**Observed.** Production startup awaits `startTunnel()` before `startDaemon()` (`launcher/electron/runtime-supervisor.cjs:1405-1424`). If tunnel startup fails, failed-start cleanup runs and the supervisor reports failure (`launcher/electron/runtime-supervisor.cjs:1425-1444`). The launcher connects the Codex bridge only after the aggregate runtime reports `ready` (`launcher/electron/main.cjs:1741-1745`); non-ready startup restores the previous Codex route (`launcher/electron/main.cjs:1798-1804`). By contrast, tunnel loss after startup is recovered independently while the daemon is retained (`launcher/electron/runtime-supervisor.cjs:1168-1188`, `1554-1574`).

**Failure trigger.** On app launch, tunnel inventory, credentials, MCP readiness, or tunnel networking is unavailable while native ChatGPT Codex requests would otherwise work. The daemon is never started and the managed route is not connected (or is restored), so native catalog and native responses lose continuity because an unrelated Full-only capability failed during startup.

**Proposed fix and ownership.** The launcher/runtime lifecycle owner should introduce explicit capability states such as `native-ready` and `full-ready`. Start and prove the daemon first, connect the managed Codex route once native readiness is durable, then start/recover tunnel capability independently. A tunnel startup failure should leave the process and route in a degraded native-only state, publish a Full-capability repair action, and continue bounded tunnel recovery. Keep this as one lifecycle change with finding 1 so server admission, supervisor state, route fail-safe behavior, and shutdown compensation use the same capability model.

### 3. Medium — Route diagnostics can display active/observed while the current runtime rejects every request

**Observed.** `withCatalogObservation()` considers health current from service/version/mode/PID identity and derives catalog state from historical success count plus the latest receipt (`launcher/electron/route-diagnostics.cjs:13-58`). It does not consume `accepting_turns`, `broker_ready`, or `broker_state`, although the server exposes them (`src/server.ts:1055-1073`). The rendered report separately presents the configured route and catalog observation (`launcher/src/RouteDiagnostics.tsx:102-142`).

**Failure trigger.** The current daemon previously served a catalog, then becomes drained or its Full broker fails without the process exiting. PID/version/mode still match, route configuration remains active, and the historical catalog receipt remains successful. Diagnostics therefore show an active route and observed catalog even though the server's global admission gate returns 503 for native and Full requests.

**Proposed fix and ownership.** The route-diagnostics owner should version the report schema and add current capability fields sourced from the same health snapshot: at minimum `nativeAccepting`, `fullBrokerReady`, `draining`, and a tunnel state supplied by the supervisor rather than inferred from HTTP health. Render historical catalog evidence as historical evidence, alongside a separate current availability row and broker/tunnel-specific repair guidance. Do not erase a valid catalog receipt when capability is degraded; preserving both facts makes recovery visible without turning an old success into a current availability claim.

## Catalog 502 receipt review

**Observed, no additional finding.** `/v1/models` records a bounded latest completion receipt with request identity, timestamp, status, and sanitized failure stage/code (`src/server.ts:1221-1257`; `launcher/electron/catalog-receipt.cjs:1-15`). While catalog verification is pending, a 502 publishes one failure per receipt; a later successful receipt marks verification complete and clears that failed operation (`launcher/electron/main.cjs:220-293`). The request-number guard prevents an older, slower completion from replacing a newer receipt (`src/server.ts:1224-1229`). Within the reviewed direct callers, this supports transient-502 recovery as intended. This is a code-path conclusion only; no network behavior was exercised.

## Review limits

The findings above distinguish direct code observations from the stated failure consequences, which are inferred from those control-flow paths. Browser authentication, tunnel services, live Codex accounts, installed-app state, and runtime recovery were not exercised. No quota-filling findings were added.
