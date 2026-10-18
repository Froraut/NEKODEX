# Codex client control

`launcher/electron/codex-client-control.cjs` is a main-process port to the official
Codex app-server v2 JSON RPC protocol. Its narrow public contract is declared in
`codex-client-control.d.cts`. It reads native thread metadata and creates a fork
only after an explicit user action. Codex keeps thread execution, sandbox and
approval authority. This port has no turn start, steer, interrupt, approval,
login, arbitrary RPC or arbitrary executable renderer API.

## Protocol evidence

The implementation was checked on 2026-10-18 against the installed
`codex-cli 0.163.0` at `/Users/alex/.local/bin/codex`, using offline outputs of:

```sh
codex --version
codex app-server --help
codex app-server proxy --help
codex app-server generate-ts --out /temporary/types
codex app-server generate-json-schema --out /temporary/schema
```

The generated public types confirm `initialize`, `thread/list`, `thread/read`
with `includeTurns: false`, and `thread/fork` with `excludeTurns: true`.
`Thread` includes `sessionId`, `parentThreadId`, `forkedFromId`, agent role and
nickname, and native status. This is installed-protocol evidence, not a guess
about Desktop UI internals or a promise of compatibility with older binaries.
The handshake confirms the exact configured Codex home and records the server
user agent. Each method remains `unverified` until it returns successfully;
an RPC method-not-found response marks it `unsupported`.

## Main-process composition and ownership

Construct with absolute `executable`, `codexHome` and `journalPath` from trusted
main-process configuration. Main places the journal under its private
`coreHome/native-thread-control/forks.json`. Optional `cwd`, environment and
`controlSocket` have the same
authority. Do not accept these through renderer request parameters. The port
does not discover, copy, replace or rewrite authentication or configuration.

Without a socket the port spawns the exact executable with
`app-server --stdio`. With an explicitly configured existing socket it spawns
`app-server proxy --sock <socket>`. The proxy attaches to that server; this port
never invokes daemon start, stop, restart, bootstrap or remote-control enablement.
It validates the initialized server home before making metadata requests.

The port owns only its child app-server or proxy process. Call `destroy()` when
its main-process owner is disposed. Shutdown closes stdin, waits for close,
then signals only that owned process group if necessary and awaits settlement.
A proxy shutdown does not stop the existing daemon. A failed shutdown reports
`process_not_settled`; a returned shutdown promise is the cleanup evidence.
Renderer unmounts do not own the client or its mutations.

`currentOperation()` reports a pending fork from its validated user action
through initialization, dispatch and terminal receipt/failure. Main's existing
lifecycle admission/quit guard consumes that signal. An unknown outcome is a
terminal observation that the UI must retain for inspection; it does not leave
a permanently busy operation or invent a new native execution owner. The
private journal keeps it visible across navigation and process restart.

`codex-fork-journal.cjs` is the single main-process fork receipt writer. Each
action has a generated UUID and exact source thread, optional last-turn boundary,
request timestamp, Codex home/executable/socket provenance and terminal fork ID
when observed. The pending record is written atomically with mode `0600` and
file/directory synchronization before dispatch. Without working private receipt
storage, no fork is sent. Reads remain available without a journal. Completed,
failed and inspected-unknown records are retained, not silently purged; a bounded
four-MiB journal fails closed if full or invalid. A captured-bytes comparison
preserves an unexpected external writer instead of overwriting its state.

After restart, a pending record becomes unknown without replay. Snapshot
`uncertainForks` exposes bounded action metadata and any actually observed fork
ID, without private source paths. A fresh parent match from `thread/list` never
proves which action created a fork: multiple forks may share the same parent.
The user inspects native history and explicitly acknowledges the exact action
and source thread with `nativeThreadAcknowledgeFork`. That durable acknowledgement
does not claim the earlier fork succeeded or failed; a new fork requires its own
later explicit user action. Unacknowledged uncertainty blocks another fork of
that exact source, but does not keep application Quit busy forever.

`ipc/codex-client-control.cjs` registers through main's sender-authorized
`handle` wrapper and resolves a cached client through trusted `getClient`.
It allowlists list/read/fork payloads and returns a discriminated success/error
envelope. Error strings are selected locally; Electron rejection exceptions and
raw provider messages never become renderer text. The renderer bridge exposes
`nativeThreadsSnapshot`, `nativeThreadsList`, `nativeThreadRead` and
`nativeThreadFork` and `nativeThreadAcknowledgeFork`, with types in
`launcher/src/native-threads-types.ts`.

`NativeThreadsSurface.tsx` loads pages, reads details and forks only from user
actions. It has no mount-triggered provider read, subscription or polling. Its
tree uses only native `parentThreadId`; session membership and fork provenance
stay separately labelled. Cycles and missing parents do not discard rows.
Metadata dates use the selected locale. English is the fallback, with Russian
copy supplied. The surface leaves a pending host operation with its owner after
unmount and never cancels a host mutation. A passive local snapshot on mount
shows retained uncertainty without starting a provider connection. Unknown fork
outcomes retain a warning and disable another fork of that exact source until
the user explicitly records inspection. Native provider list/read/fork actions
still require user clicks.

## Metadata and runtime status

`listThreads` is paginated, bounded to 100 rows per page, and includes interactive
and subagent source kinds. Pagination remains with its caller; the port does
not crawl all history or build a second thread registry. Standard app-server
listing may scan persisted rollouts and repair its own metadata index. In
particular, the API's `useStateDbOnly` shortcut is not enabled because a missing
index entry must not silently become missing history.

`readThread` requests metadata only. Projection excludes turns, previews,
rollout paths, arbitrary source payloads and instruction sources. Parent IDs
come from Codex. Missing IDs remain missing; matching titles or a historical
Web task worker request never invent a parent or live worker.

Native status is `notLoaded`, `idle`, `systemError`, or `active`, with
`waitingOnApproval` and `waitingOnUserInput` active flags. Status has an explicit
scope on every response and client snapshot:

| Scope | Meaning |
| --- | --- |
| `connection` | Status observed by the separately owned stdio app-server. Persisted threads owned by another process can be `notLoaded` here while running elsewhere. |
| `configured-server` | Status reported by the explicitly configured existing server reached through its control socket. It describes that server's ownership, not every Codex process. |

Neither scope proves an application-wide Desktop worker inventory. A caller
must carry the scope into UI copy and keep external Native execution separate
from NEKODEX Web scheduling. No background polling or subscription is started
by this module. A main-process UI controller can refresh metadata in response
to explicit user navigation without acquiring native execution ownership.

## Forks and failures

`forkThread({ threadId, lastTurnId?, userInitiated: true })` sends only the thread
ID, optional turn boundary, and `excludeTurns: true`. It does not override model,
instructions, sandbox, approval policy, reviewer, working directory or auth.
An actual guarded user action must supply `userInitiated`; the boolean itself
is not a renderer authorization mechanism. The receipt must identify a new
thread and the exact requested `forkedFromId`.

A fork creates history; it does not send a new user message or start a model
turn. An empty new thread without a persisted rollout cannot be forked: the
tested installed API rejects it with `-32600` and `no rollout found`. Native
thread deletion, handoff, message delivery and execution scheduling remain
outside this port.

Metadata reads accept AbortSignal. Cancellation stops the local wait, ignores
the eventual response by its retired request ID, and never interrupts a native
turn. The tested public protocol has no generic request-cancel method, so the
port does not invent one. Forks do not accept cancellation: a lost response,
timeout or invalid receipt returns `fork_outcome_unknown`. Never automatically
retry that result; inspect native metadata for a committed fork first. Explicit
RPC rejections are known failures and expose a numeric code without provider
messages or private error data. No mutation is replayed.

Transport lines, concurrent requests and request duration are bounded. Responses
are correlated by unique IDs and can arrive out of order. Stderr and unrelated
notifications are drained without logging their content. Server requests receive
method-not-found; this metadata client cannot grant native permissions or
provide authentication refresh tokens.

## Focused verification

```sh
bun test tests/codex-client-control.test.ts
node tests/fixtures/codex-client-control-offline.cjs /Users/alex/.local/bin/codex
node tests/fixtures/native-threads-ui.cjs
```

The RPC fixture covers out-of-order replies, subagent parent/status metadata,
projection, guarded fork payload and receipt, native approval refusal, cancelled
reads and late replies, close/timeout settlement, uncertain fork outcomes,
unsupported method reporting, private error redaction, home mismatch and bounded
split output. It checks the boundary after the request is actually dispatched.
The same focused test file covers IPC configuration-injection rejection,
sanitized failures, native-parent/fork distinction, orphan/cycle handling and
metadata merge by identity. Targeted journal cases establish pending persistence
before RPC dispatch, restart recovery without replay, source-bound inspection,
durable exact fork receipts, pre-dispatch storage refusal, and retention of an
actually observed provider ID when a post-response storage write fails.

The opt-in installed fixture uses a disposable HOME/CODEX_HOME, no credentials,
a dummy provider at an unreachable loopback endpoint, and no `turn/start`.
It first confirms the empty-thread fork rejection, then uses supported
`thread/inject_items` to materialize inert synthetic history. The port performs
a real metadata read and returns a real fork receipt. Both owned clients close
and the exact temporary state is removed. On 0.163.0 the synthetic no-turn
fixture's list page is empty; populated listing/tree projection is established
by the RPC fixture, not claimed as real account-history evidence. No actual
user thread or installed application is changed by these checks.

The standalone headless browser fixture builds only this surface, using inert
metadata and no Electron/provider bridge. It confirms no initial requests,
explicit load/read/fork, native approval-wait details, fork receipt selection,
unknown-fork blocking, explicit inspection acknowledgement, unsupported-version
errors, and no horizontal overflow
at a 640-pixel viewport. Its dedicated browser and loopback server close, and
the generated bundle directory is removed. A screenshot supports layout review;
this does not establish integrated app, Desktop worker or installed-app state.
