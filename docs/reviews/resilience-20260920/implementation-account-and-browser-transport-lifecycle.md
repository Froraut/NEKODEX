# Account and browser transport lifecycle implementation

Implemented manually on `codex/account-limits-login` from the
`5.6.0-nekodex.3` / `e10c52a` source baseline. No tests, builds, live Electron UI,
real accounts, network authentication, or child agents were run. Parent owns all
focused and full-UI verification.

## Completed behavior

- Browser authentication probes are serialized per account host. Only ordered probes
  for the current auth generation/view can publish state, so an older response cannot
  overwrite a newer session result.
- The trusted ChatGPT session document hashes its stable principal and, only when the
  endpoint supplies one, an authoritative stable session ID with SHA-256 before
  returning evidence to Electron. Access tokens, expiry, plan and mutable user
  metadata do not participate in the identity lease. Raw principal/session IDs are
  not stored, logged, placed in descriptors, or returned by account snapshots.
- Each host maintains an internal `authIdentityEpoch`. It changes only when a verified
  principal/session fingerprint changes, when a verified identity is explicitly
  cleared, or when a new verified identity is established. Ordinary account checks
  do not advance it.
- Principal/session changes synchronously invalidate capability and connector evidence
  for that account while preserving exact running and retained turn owners.
- Fresh automatic acquisition keeps account affinity tentative through readiness,
  admission, safety, capacity, and browser-tab creation. Durable affinity is committed
  only after an exact owned tab exists. A failure before tab ownership no longer
  strands a new task on that account.
- Retained-conversation release is now an explicit `AccountBrowserPool` operation. It
  resolves the owning host, rejects multiple account owners, removes only confirmed
  ready tabs, and counts only tabs actually removed. It no longer falls through the
  pool Proxy to whichever account is selected.
- Automatic start, heartbeat, and end mutations carry one UUID `mutationId` per
  logical notification. The client retries the exact payload once after an ambiguous
  transport or acknowledgement failure. The control server keeps a bounded hash-only
  receipt cache, coalesces in-flight duplicates, replays completed acknowledgements,
  and rejects changed payloads for the same receipt. HTTP rejection is not retried.
  Timeout constants were not increased.
- Heartbeats can bind `(traceId, helperPid)` to the exact `surfaceId`. Normal and
  viewport-refresh heartbeats now send that identity. CDP transport recovery first
  confirms the exact live launcher owner, then reacquires only that same surface.
- A launcher page is rebound for a closed Playwright page only when its owning CDP
  `Browser` is confirmed disconnected and the turn is not aborted/cancelled. Closing
  an individual page/target while the browser transport remains connected still fails
  normally and is not treated as recoverable.
- A normalized proxy value equal to the saved value returns the current account
  snapshot without recycling connections or invalidating evidence.
- Enabling/disabling an account is no-op-safe and does not invalidate unchanged
  authentication/capability evidence. It controls only fresh unbound admission.
  Running and exact retained owners continue on their original account. A fresh task
  with existing affinity to a disabled account fails with an explicit re-enable
  message and is never silently rerouted.
- `AccountSnapshot` runtime account entries now include `evidenceEpoch`; the parent can
  add the field as optional in renderer-owned types without changing this lifecycle.

## Parent API contracts

### Per-account operation lease

`AccountBrowserPool.acquireAccountOperation(accountId, label)` is synchronous and
returns an idempotent release function:

```ts
type ReleaseAccountOperation = () => void;

acquireAccountOperation(accountId: string, label: string): ReleaseAccountOperation;
```

The acquisition validates the saved account, rejects a duplicate lease, a running
turn, an in-flight turn reservation, account proxy/login work, or another conflicting
host operation, then reserves only that account. `label` must contain 1–80 printable
characters and is used verbatim in turn-admission/readiness errors and by
`currentOperation()` for updater/quit protection. The returned release is safe to call
more than once and can remove only the exact lease that created it.

While held, fresh automatic and Manual turns for that account fail with the operation
label. Balanced routing may choose another eligible account. Selected routing and
pinned/retained continuations fail explicitly and are never silently rerouted. An
already running exact turn retains ownership and can complete its heartbeat/end
lifecycle. Account selection/tab activation for other account IDs remains available.

Pool-owned login, logout, proxy change, passkey import, existing-Chrome import, and
Chrome-file recovery now acquire the same internal lease. External services that hold
the lease must operate directly on `getHost(accountId)`; calling these guarded pool
wrappers while holding the external lease correctly rejects as a conflict.
An Existing Chrome continuation reuses the exact pool-owned import lease when that
operation is still pending; a later file-access recovery after the failed import has
settled acquires a new lease. A foreign external lease never receives this reuse path.

Recommended service structure:

```ts
const release = browserHost.acquireAccountOperation(accountId, "Codex account login");
try {
  const host = browserHost.getHost(accountId);
  // Open the official auth window with host.view.webContents.session.
  // Do not call selectAccount() and do not route through pool login wrappers.
} finally {
  release();
}
```

### Dedicated Codex login identity lease

`AccountBrowserPool.accountIdentityLease(accountId)` returns:

```ts
{
  accountId: string;
  identityEpoch: number;
  principalFingerprint: string | null; // SHA-256 hex only
}
```

The parent should obtain the exact host with `getHost(accountId)` and use
`host.state.authenticated` plus this lease before and after the dedicated official
auth flow. It must not use `evidenceEpoch(accountId)` as the login lease: checks,
connector verification, proxy changes, and other readiness invalidations legitimately
advance the evidence epoch without changing the authenticated principal/session.

The dedicated login flow can operate on `getHost(accountId).view.webContents.session`
without calling `selectAccount`; therefore it need not change Web routing `selectedId`.
The parent `main` owner should hold an account-specific mutation lock for that clicked
ID while the auth flow is active. Selection and safe operations for unrelated accounts
may continue. Start the auth mutation only while that account has no active turn,
reservation, or conflicting host operation; changing the shared session beneath a
running tab would violate the preserved-owner contract. After the official window closes, run the host's ordered authentication
probe, require `state.authenticated === true`, and compare the identity lease. Never
expose the principal hash to renderer UI, logs, diagnostics, or persisted metadata.

### Automatic control channel

- Current clients add `mutationId` to automatic `start`, `heartbeat`, and `end` JSON.
  It is a canonical lower-case UUID and remains identical across the single internal
  reconciliation retry. Legacy callers without it remain accepted but do not receive
  replay protection.
- `heartbeat` accepts optional `surfaceId`. When present, the launcher verifies it
  against the exact running tab after checking `traceId` and `helperPid`. Exact-surface
  CDP recovery requires this field.
- Start/end/heartbeat acknowledgements include `ok: true`; start additionally returns
  `surfaceId`, `reused`, and `connectorBound`; end returns `cancelledByUser`.
- The receipt cache is bounded to 4096 settled/in-flight mutation receipts. Settled
  entries are evicted oldest-first. A cache containing only in-flight entries fails
  closed instead of executing an untracked mutation.

### Routing and evidence

- `evidenceEpoch(accountId)` remains available and unchanged as the readiness-evidence
  invalidation API.
- `accountSnapshot().accounts[].evidenceEpoch` is additive runtime data. The parent UI
  type should mark it optional during integration if old fixture snapshots remain.
- `setAccountEnabled(id, enabled)` preserves auth/capability/connector evidence and
  exact turn ownership. Disabled accounts are excluded only from fresh unbound
  selection; pinned continuations are not migrated.
- `setAccountProxy(id, value)` treats the normalized saved value as a no-op before any
  session recycle or evidence invalidation.

## Modified files

- `launcher/electron/account-pool.cjs`
- `launcher/electron/browser-host.cjs`
- `launcher/electron/control-server.cjs`
- `src/launcher-browser-host.ts`
- `src/adapters/chatgpt-web/browser-worker.ts`
- `docs/reviews/resilience-20260920/implementation-account-and-browser-transport-lifecycle.md`

`src/adapters/chatgpt-web/launcher-helper-client.ts` required no direct edit: its
automatic helper-exit release already calls the centralized `notifyLauncherTurn`, so
it inherits mutation reconciliation without a second retry loop.

## Verification limits and parent checks

No automated check was run in this worker. Parent verification should cover the exact
named regressions for account routing/ownership and launcher browser control transport,
then the parent-owned full UI pass. Material unverified boundaries are live ChatGPT
session payload shape, Electron/Web Crypto availability in the real authenticated
document, official auth-window cookie propagation, CDP disconnect classification in a
real launcher process, and response-loss replay across the loopback channel. The
existing hidden-primary-viewport path remains in place; no viewport constants or
timeouts were increased.
