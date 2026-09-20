# Code review lane 04: account and browser ownership

Scope: bounded manual review of `launcher/electron/account-pool.cjs`,
`account-registry.cjs`, and `browser-host.cjs`, limited to account/auth/evidence
epochs, multi-tab admission, and ownership lifecycle. Direct callers were read only
to establish triggers. No source edits, automated checks, builds, CI, live-account
work, network authentication, child agents, or UI driving were performed.

## Findings

### 1. High — capability and connector evidence survives an authenticated principal change inside the same saved profile

**Observed.** `BrowserHost.probeAuthentication()` accepts any nonempty session user and
returns only a display label derived from `user.email` or `user.name`
(`browser-host.cjs:3039-3061`). A successful probe then overwrites
`state.accountLabel` while keeping `authenticated: true` (`:3123-3134`). The pool's
`publish()` invalidates capability and connector evidence only when a host publishes
`authenticated === false` (`account-pool.cjs:209-214`). Positive evidence is stored
only by local registry ID in `capabilities` and `connectors` (`:320-355`), and fresh
turn eligibility consumes those maps plus the authentication bit (`:521-532`). No
stable ChatGPT principal identifier or auth-session generation is attached to the
evidence. The registry explicitly contains metadata rather than auth claims
(`account-registry.cjs:61-70`).

**Failure trigger and inferred impact.** ChatGPT changes the signed-in user within an
existing Electron partition without an observed signed-out publication—for example,
an account switch completes as one authenticated session replaces another. A later
probe can move directly from principal A to principal B. Capabilities and connector
verification established for A remain eligible for B, so balanced routing can admit
a model or connector that B has not proved available. A missing label, duplicate
name, or reused display email also cannot serve as a safe identity boundary. This is
a source-derived failure path; no live account switch was performed.

**Proposed fix and ownership.** The account/auth lifecycle owner should derive a
privacy-preserving stable principal fingerprint from the trusted session payload and
maintain an `authIdentityEpoch` per `BrowserHost`. On every successful probe, compare
the fingerprint with the last accepted principal before publishing authenticated
state. A change must advance the epoch and synchronously notify the pool to clear
capabilities/connectors and reject in-flight evidence publication; fresh admission
must require evidence stamped with both the Electron session/partition owner and that
epoch. Do not clear cookies or active turns merely because identity drift is detected:
freeze fresh admission, let already-owned turns retain their exact account/tab owner,
and require an explicit account check before new work.

### 2. High — a pre-tab readiness failure can durably strand conversation affinity on an account that never owned a browser surface

**Observed.** For a fresh trace, `AccountBrowserPool.beginTurn()` writes every
conversation/task routing key to `account-affinity.json` before the safety check,
reservation, `host.ready()`, capacity check, or `host.beginTurn()`
(`account-pool.cjs:589-618`). If any of those later steps fail before a tab exists,
the catch deletes only `traceOwners`; it never removes the already persisted affinity
(`:652-659`). On retry, `chooseAccount()` treats that affinity as authoritative
`pinned` ownership (`:507-520`) and either returns the same account or rejects it as
not ready (`:536-546`). There is no registry/API operation in these files that removes
an individual affinity binding.

**Failure trigger and inferred impact.** A new task is balanced or selected to account
A, then `host.ready()` rejects, admission closes while readiness is pending, global
tab capacity is unavailable, or tab initialization fails before an owned tab is
created. The first attempt has no browser conversation to preserve, but its routing
key remains durably bound to A. Selecting healthy account B or retrying after A is
disabled cannot recover that new task through ordinary routing; it remains pinned to
the failed account and can repeatedly fail after restart. This can make a fresh task
look like retained ownership even though no account ever acquired its browser
surface.

**Proposed fix and ownership.** The account-pool ownership transaction owner should
separate tentative reservation from durable affinity. Keep keys in
`pendingAffinity` while readiness, current admission epoch, safety, capacity, and tab
creation are unresolved; commit them atomically only after `host.beginTurn()` returns
an exact owned tab. If the safety policy deliberately requires a rejected attempt to
stay pinned, persist a distinct bounded safety pin with an explicit reason/expiry,
rather than converting every infrastructure/admission failure into permanent
conversation ownership. In the catch path, retain durable affinity only when an exact
tab exists or the explicit safety-pin contract applies. This change should preserve
running and retained tabs and must not migrate their existing affinity.

### 3. Medium — concurrent probes share one generation, so an older auth result can overwrite a newer result

**Observed.** `probeAuthentication()` snapshots `authGeneration` but does not advance
a per-probe revision (`browser-host.cjs:2958-2974`). Every probe on the same primary
view/auth popup therefore remains current until a larger login/session operation
changes that generation. The primary `did-finish-load` handler launches an untracked
probe (`:1091-1115`), while `refreshAuthentication()` loads the same page and then
explicitly launches another probe (`:2936-2955`). Auth-popup load completion can also
launch a probe (`:1800-1808`). Each surviving probe independently writes either
authenticated state with a label or unauthenticated/error state (`:3123-3152`).

**Failure trigger and inferred impact.** A refresh navigation schedules its
load-event probe, then the explicit refresh probe runs before the first one settles;
or two quick same-surface navigations produce overlapping probes. If the session,
page readiness, or endpoint result changes between their fetches, the older probe can
finish last because both pass the same `isCurrent()` test. It can replace a newer
authenticated principal with signed-out/error state, unnecessarily invalidating
account evidence, or restore older authenticated/label state after a newer rejection.
Combined with finding 1, the latter can allow fresh eligibility to observe the wrong
principal/evidence pairing.

**Proposed fix and ownership.** The same account/auth lifecycle owner as finding 1
should serialize probes per host or add a monotonically increasing `authProbeRevision`
captured by each invocation and checked immediately before every state commit and
auth-view close. Keep `authGeneration` for destructive session/login replacement, but
make only the newest probe within that generation publish. Explicit callers that lose
the revision race should receive the current snapshot or a typed stale-probe result,
not publish failure state. This must remain independent of turn-tab ownership so a
probe retry cannot close, reassign, or clear active turns.

## Review boundary

The exact account partition construction, helper/tab ownership checks, retained-tab
connector identity checks, enabled-account filter, evidence epoch recheck during
fresh automatic acquisition, and global tab-capacity accounting were inspected. I
found no additional important independent defect in those paths. The failure impacts
above are inferred from the cited source transitions; browser/account behavior was
not exercised.
