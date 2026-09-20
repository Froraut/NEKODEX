# Architecture boundaries review — code lane 11

Scope: bounded manual review of `launcher/electron/main.cjs`, `runtime.cjs`,
`runtime-supervisor.cjs`, `account-pool.cjs`, `control-server.cjs`, and
`launcher/src/App.tsx`, with direct callers only. Source reviewed at
`e10c52acb23da1c05d401faaa49d0b34c912e830` (`5.6.0-nekodex.3`). No source edits,
automated checks, builds, CI, live-account work, network/authentication actions,
child agents, or UI driving were performed.

Release history was used only to set the architecture boundary. `.1` introduced
Native6, `.2` repaired capability discovery when the reasoning menu was closed,
and `.3` repaired capability discovery while the primary browser was hidden
(`docs/releases/5.6.0-nekodex.1.md:1-8`, `.2.md:1-7`, `.3.md:1-7`). Update commit
timing and startup migration rollback are already owned by code lanes 01/02 and
are not repeated here.

## 1. P1 — A child command publishes a terminal operation while its parent setup transaction is still active

**Location:** `RuntimeHost.runSetup()` in `launcher/electron/runtime.cjs:1678-1708`
and `:1760-1767`; `RuntimeHost.run()` at `runtime.cjs:680-697` and `:830-847`;
renderer operation consumption in `launcher/src/App.tsx:255-263` and Settings
busy derivation at `App.tsx:2142-2148`.

**Observed:** `runSetup()` sets `lifecycleOperation` for the whole setup transaction,
but delegates preflight and setup commands to `run()`. In production the preflight
command publishes `completed` from `run()` before `runSetup()` stops/drains the old
runtime, runs the mutating setup command, starts the new runtime, and invokes the
post-ready callback. `lifecycleOperation` remains active throughout, but the only
renderer-visible slot is now terminal. The renderer treats that terminal event as
completion, refreshes metadata, and removes `operation.status === "running"` from
its busy gates while the parent transaction is still executing.

**Failure trigger and inferred impact:** any production setup whose preflight
finishes quickly but whose runtime drain/stop or restart takes time creates this
false-idle interval. Runtime mutations usually fail closed because
`RuntimeHost.currentOperation()` still sees `lifecycleOperation`, but controls can
be re-enabled, produce avoidable busy errors, or start account/browser mutations
whose IPC handlers do not share the runtime lifecycle lock. A later child phase or
supervisor recovery can also overwrite the same global operation slot. The false
idle interval is source-observed; no interactive race was exercised in this lane.

**Concrete fix and ownership:** introduce one small `LauncherLifecycleCoordinator`
owned by the sequential lifecycle writer. It should issue an operation ID and own
the parent transaction from admission through its single terminal event. `run()`
should report child phases (`preflight`, `draining`, `configuring`, `starting`,
`verifying`, `rolling-back`) to that operation rather than publish independent
terminal states. `RuntimeSupervisor` remains the sole owner of process/tunnel
start, stop, drain, and recovery; `RuntimeHost` owns config commands and rollback;
`main.cjs` owns admission and final state publication. Acceptance: a production
setup exposes exactly one operation ID, never appears idle between phases, rejects
or queues every conflicting runtime/account mutation under one reason, and emits
one terminal outcome only after commit or rollback has settled.

## 2. P1 — Runtime identity changes can leave the renderer showing the previous connector indefinitely

**Location:** authoritative snapshot construction in `launcher/electron/main.cjs:637-668`;
Native6 mutation publication at `main.cjs:1062-1088`; renderer metadata refresh in
`launcher/src/App.tsx:182-215`; Native6 action at `App.tsx:2355-2371`.

**Observed:** the full main-process snapshot contains `connectorName`, runtime-derived
capabilities, credentials, model selections, browser state, and persisted launcher
state. After a completed operation, however, `refreshMetadata()` copies only
`state`, `mcpCredentialsConfigured`, and `contextCapabilities` into the existing
snapshot. The Native6 IPC path updates persisted state and browser state but emits
no connector-identity event. Its renderer caller updates only `LauncherState`.
The action label and behavior then continue branching on the stale
`snapshot.connectorName`.

**Failure trigger and inferred impact:** upgrade an existing automatic Full setup
from a synchronous Native identity to Native6 without remounting the renderer. The
runtime config can contain `Codex Native6` while the current renderer snapshot still
contains the old connector, so Settings can continue offering the upgrade path
instead of the verification path until a full snapshot/remount happens. The stale
projection follows directly from the copied fields; it was not reproduced in the
live app during this lane.

**Concrete fix and ownership:** add a main-process `LauncherProjectionStore` as the
single publisher of a revisioned view model. A committed lifecycle transition should
recompute and emit the complete runtime projection (`runtime`, `browser`, `tunnel`,
`route`, connector identity, capabilities, and persisted preferences) with one
monotonic revision. `App.tsx` should apply a full projection or a typed domain patch
only when its revision is newer, instead of maintaining separate state/operation/
browser revisions and a hand-picked metadata merge. This can be incremental: first
centralize the current `launcher:snapshot` builder and emit it on setup completion;
then replace the five renderer merge paths with a reducer. Acceptance: after a
Native4/5-to-Native6 change, the same renderer session shows the new connector and
verification action; a delayed older snapshot/event cannot revert any field; one
captured projection describes mutually consistent runtime/browser/tunnel/route
generations.

## 3. P2 — `AccountBrowserPool` exposes an unbounded, selection-dependent API through `Proxy`

**Location:** `AccountBrowserPool` constructor proxy in
`launcher/electron/account-pool.cjs:10-62`; explicit pool operation tracking at
`account-pool.cjs:92-120`; implicit selected-host calls from `main.cjs`, including
`probeAuthentication()` at `main.cjs:935-960`, `smokeTest()` at `:781-791`,
`reveal()` at `:1007`, and `returnToIdle()` at `:977-981`; control-server mode reads
at `launcher/electron/control-server.cjs:142-150`, `:200-215`, and `:320-332`.

**Observed:** any property absent from `AccountBrowserPool` is dynamically read from
the currently selected `BrowserHost` and rebound. This makes the pool's real module
contract larger than its class, lets callers bypass pool-level account leases and
evidence/admission rules, and makes ownership depend on UI selection at property
lookup time. Several important setup and control operations use this implicit path.
The pool can track explicit login/add/network work, but it cannot uniformly track
or describe every selected-host method admitted by the proxy.

**Failure trigger and inferred impact:** add an account, rename/collide a host method,
or allow selection to change while an implicitly forwarded operation that does not
register `manualOperation` is awaiting browser work. The caller can complete against
an account different from the one represented by the later UI/config step, while
the lifecycle coordinator has no explicit lease to validate. More immediately,
future maintenance can introduce a pool method with the same name and silently
change routing semantics for all callers. These are inferred failure modes from the
dynamic boundary; no live account transition was attempted.

**Concrete fix and ownership:** remove the generic proxy in stages. Give
`AccountBrowserPool` explicit façades: `AccountAdmin` for add/select/login/proxy and
evidence, `TurnRouter` for trace/affinity/capacity, and `SelectedBrowserSurface` for
navigation/zoom/reveal. Browser-dependent setup must acquire a selected-account
lease `{ accountId, selectionRevision, evidenceEpoch }` and validate it before
committing runtime/account proof. `BrowserControlServer` should depend only on the
turn/session interface it uses, never the whole pool. Acceptance: every call in
`main.cjs` and `control-server.cjs` resolves to a declared pool/interface method;
account selection cannot change beneath a leased setup probe; adding a same-named
`BrowserHost` method cannot alter pool behavior; and per-account browser state is
available without overloading one global selected-browser snapshot.

## Incremental target shape

These findings do not justify a cosmetic rewrite of the large files. Introduce the
new boundaries around existing behavior in this order:

1. Add the coordinator and model explicit terminal states for **runtime**
   (`unconfigured`, `starting`, `ready`, `degraded`, `recovering`, `failed`,
   `stopping`), **browser/account** (`unknown`, `signed-out`, `probing`, `ready`,
   `busy`, `failed`), **tunnel** (`absent`, `starting`, `ready`, `degraded`,
   `recovering`, `failed`, `stopping`), and **route** (`direct`, `switching`,
   `managed`, `restoring`, `failed`). Keep process mechanics in the current
   supervisor.
2. Publish that coordinator's revisioned projection through the existing preload
   channel and migrate `App.tsx` to one reducer. Preserve current component props
   during the migration so the next full UI review can assess behavior without a
   simultaneous visual rewrite.
3. Replace proxy forwarding call by call with explicit account/surface/turn
   interfaces and leases. Remove the proxy only after direct callers are explicit.

This gives the parent one sequential owner for the coupled lifecycle while allowing
later UI work to consume stable states. It avoids a high-risk rewrite of runtime,
browser automation, and renderer presentation at the same time.
