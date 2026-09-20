# Post-5.7 architecture review: ownership and lifecycle boundaries

Scope: bounded manual review of the current checkout at `715fcfe`, limited to the composition and ownership seams among `main.cjs`, `runtime-supervisor.cjs`, `runtime.cjs` / the runtime-generation journal, `lifecycle-projection.cjs`, `account-pool.cjs`, and `codex-account-tools.cjs`. I did not review updater-worker/window-start behavior or renderer presentation, which belong to the other requested lanes. No tests, builds, scripts, network requests, live application actions, or nested agents were run.

## Current architecture assessment

The post-5.7 structure is materially safer than the earlier single-health-state design:

- `RuntimeSupervisor` owns daemon/tunnel processes and computes separate native and Web availability (`runtime-supervisor.cjs:413-439`). A tunnel failure can therefore leave native admission usable instead of collapsing the whole runtime.
- `RuntimeHost` owns configuration transitions. `RuntimeGenerationStore` journals exact before/candidate bytes and hashes, while `RuntimeHost` stops the prior owner, stages the candidate, and either commits it or stops the candidate before restoring the previous generation (`runtime-generation.cjs:31-127`, `runtime.cjs:1527-1658`). That is an appropriate transaction boundary; it should remain separate from updater/UI concerns.
- `AccountBrowserPool` owns account sessions, capability/connector evidence epochs, turn admission, and per-account operation leases (`account-pool.cjs:103-165,170-188,247-260`). `codex-account-tools.cjs` correctly borrows those leases and account-bound Electron sessions rather than creating a second account registry (`codex-account-tools.cjs:33-50,102-145,167-190`).
- `LauncherLifecycleProjection` is an aggregate read model for runtime capability, route, catalog, and current operation. `main.cjs` remains the composition root and is the correct place to coordinate cross-service startup and shutdown.

I found two cross-component coupling failures worth addressing and one candidate that was rejected after ownership semantics were clarified. None calls for a broad rewrite before the working app continues shipping.

## 1. Tunnel adoption publishes the prior owner

**Decision: accepted and implemented. Severity: medium.**

When the tunnel monitor observes a healthy tunnel whose PID differs from the supervisor's current handle, it first reports tunnel readiness and may call `updateCapabilities()` (`runtime-supervisor.cjs:1314-1321`). Only afterward does it replace `this.tunnel` with the observed PID and persist ownership (`runtime-supervisor.cjs:1324-1331`). `updateCapabilities()` snapshots `this.tunnel` immediately and sends that value to the lifecycle projection (`runtime-supervisor.cjs:413-448`; `main.cjs:1556-1567`). There is no second capability publication after the new owner is installed.

The direct consequence is a stale ownership projection: lifecycle subscribers can receive `ready` with the previous `tunnelPid`. If the readiness booleans do not change on the next monitor pass, `reportTunnelStatus()` reports no capability change and the corrected PID is never emitted. A later pull snapshot can independently read the new supervisor PID, so the push projection and pull projection can disagree about the same runtime generation.

The implemented correction adopts and persists the observed tunnel owner before the capability update. The asynchronous status completion now also requires the same monitor generation and exact observed PID before it can mutate readiness fields or publish. An ownership change forces a coherent capability publication even when the readiness booleans themselves did not change. This does not change admission policy, process startup, or the journal format.

Do not respond by adding another renderer-side merge rule. The supervisor has the authoritative process owner; it should publish one coherent snapshot. A larger unification of every runtime/route/catalog field into one event store can wait.

## 2. Rejected: invalidate durable setup proof when the runtime PID changes

**Decision: not accepted. PID changes intentionally do not invalidate durable setup proof.**

Successful connector verification and picker confirmation persist `setupRuntimeIdentity` from `currentRuntimeIdentity()` (`main.cjs:883-913,1177-1186`). The state layer validates the field as an owner/daemon/tunnel PID tuple (`state.cjs:142-157`). However, `setupProofCurrent()` checks the setup contract, account/config identity hash, connector name, and timestamp only; it never compares `setupRuntimeIdentity` (`upgrade-readiness.cjs:18-25`). `ensureRuntimeProofCurrent()` delegates to that predicate and likewise omits the saved runtime identity (`main.cjs:227-238`).

That separation is intentional. Durable configuration/connector proof is owned by `setupIdentityHash`, the connector-name guard, setup contract, and verification timestamp. Live usability is independently gated by current tunnel readiness in the renderer (`launcher/src/App.tsx:94-104`), while in-flight checks use the captured runtime identity token in `captureAccountProofContext()` / `accountProofContextIsCurrent()` (`main.cjs:186-210`). A daemon or tunnel PID change by itself therefore must not erase durable proof on every cold start or ordinary recovery.

No proof-invalidation change should be made for this candidate. In particular, `ensureRuntimeProofCurrent()` should continue to invalidate on durable setup identity or connector mismatch, not process identity alone.

`setupRuntimeIdentity` is consequently unused as persisted authority. A separate low-risk cleanup may remove that stored field and its state validation after confirming it has no diagnostics or migration consumer. That cleanup should be described as removing misleading dead state, not as changing proof semantics.

## 3. Failed quit can revive a dismantled service graph

**Severity: high for recoverability, low-frequency trigger. Low-risk ordering correction now.**

`requestQuit()` closes admission and checks operations/turns, then shuts down the runtime (`main.cjs:1412-1428`). After that irreversible step it persists browser sessions and calls `closeBrowserResources()` (`main.cjs:1438-1445`). That cleanup destroys lifecycle participants such as `accountToolsService`, destroys `browserHost`, and only then closes browser control; it aggregates an error from any stage and throws after the destructive work (`main.cjs:652-674`).

If session persistence, account-tools cleanup, browser destruction, or browser-control shutdown fails after the runtime has stopped, the catch path treats Quit as cancelled: it calls `allowRestartAfterQuitFailure()`, reopens browser admission, shows the window, and reports failure (`main.cjs:1449-1459`). It does not restart the runtime or reconstruct the destroyed account tools/browser pool. The user can be returned to a visible app whose service graph is partially or completely closed; IPC remains registered against those closed objects.

Make the shutdown point of no return explicit. Keep all user-veto and recoverable preflight checks before `runtimeSupervisor.shutdown()`. Once runtime shutdown succeeds, continue app exit while logging bounded cleanup failures; do not reopen admission or show the window after any resource teardown has begun. If browser session persistence must be allowed to veto Quit, move it before runtime shutdown and ensure it is read-only with respect to service ownership.

Reconstructing `RuntimeSupervisor`, `AccountBrowserPool`, browser control, account tools, subscriptions, and IPC after partial teardown would be a much larger lifecycle refactor and is unnecessary for current stability. A committed-exit phase is smaller and easier to reason about.

## Recommended sequence

1. Keep the implemented tunnel adoption order and stale-owner guard so one supervisor snapshot contains the current PID and readiness.
2. Add a shutdown commit point: failures before runtime shutdown may keep the app open; failures after it must finish exit and remain diagnostic only. Backend Descartes owns this `main.cjs` work together with window reveal and renderer recovery; this lane has no `main.cjs` source changes.
3. Optionally remove the unused persisted `setupRuntimeIdentity` field in a separate cleanup without changing durable proof behavior.

Retain the current component split. The runtime-generation journal, native/Web admission separation, account evidence epochs, and account-tools lease are sound boundaries. The larger event-store, durable generation-ID, or restartable dependency-container refactors would touch working recovery paths without being necessary to close these three concrete gaps.

## Follow-up: tunnel/native request seam

Scope was limited to `server.ts` admission plus `RuntimeSupervisor.reportTunnelStatus()` and tunnel recovery after the PID-projection correction. The supplied live 5.7.0-nekodex.2 health observation (`native_accepting_turns=true`, `web_accepting_turns=true`, `tunnel_ready=true`, six active HTTP requests) was preserved as external evidence; no live recheck or request was made.

### 4. Out-of-order tunnel-status writes can close recovered Web admission

**Decision: accepted; supervisor mitigation implemented. Server contract remains parent-owned.**

On tunnel loss, both the child-exit path and monitor-failure path start `reportTunnelStatus(config, false)` without awaiting it (`runtime-supervisor.cjs:612-620,1279-1290`). Recovery later performs an awaited `false`, restarts the tunnel, and performs an awaited `true` (`runtime-supervisor.cjs:1692-1704`). These calls previously had no shared ordering boundary. The server's `/admin/tunnel-status` handler accepts a bare boolean and immediately assigns `tunnelReady`; it has no owner or revision check (`server.ts:1100-1113`). A delayed older `false` could therefore complete after recovery's `true`, leaving Web admission closed while native admission remains available.

The supervisor now serializes every tunnel-status control write. A monitor-specific current-owner predicate is evaluated after waiting for the queue, before sending the request, and again before accepting the response. This preserves native work, orders loss/recovery transitions, and prevents a stale monitor observation from mutating readiness or publishing capability state.

The client side of the parent-owned server contract is now implemented. The supervisor seeds its local counter from `tunnel_status_revision` only when health matches the exact managed daemon PID, reserves a new positive safe-integer revision before every serialized status request, sends `{ ready, revision }`, and verifies the echoed revision before accepting capability fields. An echo greater than the request proves that the response is stale relative to newer daemon state, so it advances the local counter but does not alter the capability projection. A missing echo is accepted only while `config.releaseVersion !== app.getVersion()`, allowing the first app upgrade to control an older committed core that ignores the additional request field; a same-release core must echo the revision.

The parent-owned server correction should extend the authenticated body from `{ ready }` to `{ ready, revision }`, retain the highest accepted revision for the daemon lifetime (initially `0`), and return `tunnel_status_revision` from both `/admin/tunnel-status` and `/healthz`. A lower revision, or an equal revision with conflicting `ready`, must return HTTP 200 with `status: "ok"`, `applied: false`, the accepted revision, and the current `tunnel_ready` without mutation. Equal matching input is idempotent. A strictly higher revision applies the transition. Keep `native_accepting_turns` derived only from `draining`; the revision gates `tunnelReady` / Web admission only.

No second concrete race met the requested threshold. `/v1/responses` and `/v1/responses/compact` admit the HTTP request through `acceptingNative()` and then recheck `acceptingTurns()` after parsing the requested model before starting a Web route (`server.ts:1308-1338`, `server.ts:486-526`, `server.ts:816-873`). Native routes therefore remain available during tunnel loss, while new Web routes are rejected once the tunnel transition is observed.
