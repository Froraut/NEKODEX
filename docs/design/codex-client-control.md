# Codex client control

`launcher/electron/codex-client-control.cjs` is a main-process port to the official
Codex app-server v2 JSON RPC protocol. Its narrow public contract is declared in
`codex-client-control.d.cts`. It reads native thread metadata and creates a fork
only after an explicit user action. Codex keeps thread execution, sandbox and
approval authority. This port has no turn start, steer, interrupt, approval,
login, arbitrary RPC or arbitrary executable renderer API.

`launcher/electron/codex-thread-handoff.cjs` (contract in
`codex-thread-handoff.d.cts`) is the only module that continues an external
client's thread. It is a separate service with its own owned process per explicit
action; see [Exclusive cooperative handoff](#exclusive-cooperative-handoff). Both
use the shared transport `codex-app-server-connection.cjs`, which owns exactly one
child process and refuses every server request.

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

On 2026-10-21 the same installed binary was rechecked with
`codex app-server generate-ts` (with and without `--experimental`) and against the
official source and tests at tag `rust-v0.163.0` (commit `129b8ec7`):
`codex-rs/rollout/src/writer_lock.rs`, `codex-rs/app-server/src/request_processors/
{thread_processor,thread_lifecycle}.rs`, `outgoing_message.rs`,
`bespoke_event_handling.rs`, the app-server `README.md` and the suites
`tests/suite/v2/{thread_resume,thread_unsubscribe,thread_unload}.rs`.

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

## Canonical selected-thread history

The main-only `readThreadConversation(threadId, {cursor?, limit?, signal?})`
method supplies the opt-in history recorder with real app-server canonical
message text. The recorder must obtain an explicit selected-thread recording
lease before calling it and revalidate that lease before persistence. This
method is not exposed by the generic native-thread renderer IPC and has no
automatic callback, watcher, capture policy, or secondary transport.

The installed 0.163.0 public schema deprecates full `thread/read` hydration in
favor of `thread/turns/list` and `thread/items/list`. This producer first binds
the exact thread through metadata-only `thread/read`, then reads one bounded
`thread/items/list` page, newest first, and returns retained messages in
chronological order. It projects only `userMessage.content` text parts and
`agentMessage.text`, retaining native message/turn IDs and recorded item times.
It does not pass raw Responses, tool/command output, reasoning, hooks, plans,
citations, attachments, or arbitrary nested metadata to the recorder. User-role
does not establish human authorship or secret-free text. The trusted recorder
owns sensitivity checks, opaque configured-source identity, author labels,
revision storage, opt-in and revocation.

Each read is limited to 100 native entries, 128 KiB per text message and
384 KiB of projected output including envelope reserve. The recorder's explicit
`backfill` action (IPC `canonical-backfill`) walks pages newest to oldest, at most
100 per action (40 from the UI): each page takes and revalidates its own lease,
so revoke, global disable or quota stops it between pages. It reports
`reachedStart` only when Codex returns no further cursor, and stops on a repeated
cursor. This is the full supported canonical text transcript; tool output,
reasoning, hooks and attachments remain excluded by policy. Whole messages are
omitted rather than truncated when a bound is reached. Missing completion
times and excluded nontext parts remain explicit partial coverage. Compaction
identity is `null` because these public message entries provide none.
`excludedItems`, `nextCursor` and `complete` describe this bounded page;
they do not claim complete recorded history. There is no automatic page crawl.

## Exclusive cooperative handoff

DW2 decision: **feasible and supported.** The supported contract is Codex's own
writer ownership, not metadata status:

- Every local thread writer holds a per-thread lock file in
  `$CODEX_HOME/thread-writer-locks/<thread>.lock` (`WriterLockCoordinator`:
  "shared cross-process ownership for local thread writers"). `acquire` uses an
  exclusive non-blocking file lock and fails with `thread <id> already has an
  active writer`.
- The official test `thread_resume_rejects_{legacy,paginated}_writer_owned_by_another_process`
  shows a second app-server process receiving JSON-RPC `-32600` with that exact
  message for `thread/resume` while the first process owns the thread, and the
  same resume succeeding after the first process shuts down.
- The owner releases by unloading: `thread/unsubscribe` (or disconnect) leaves
  the thread loaded until the configured idle unload delay, then shuts it down,
  emits `thread/closed` and drops the writer (`thread_unsubscribe` and
  `thread_unload` suites). Process exit also releases the OS file lock.

Codex Desktop runs its own private `codex app-server --listen stdio://`; no
control socket is shared with NEKODEX, so a rejoin of Desktop's in-memory thread
is not available. Handoff therefore means: the external client releases the
thread (close it or switch away so Codex unloads it), NEKODEX acquires it, then
NEKODEX releases it again.

`continueThread({ threadId, text, userInitiated: true })` performs one explicit
user action in a dedicated `codex app-server --stdio` child for the configured
Codex home (never `proxy`, never the metadata connection):

1. Journal `pending/acquiring` in `coreHome/native-thread-control/handoffs.json`
   before any mutation. One handoff runs at a time; an unknown earlier handoff
   blocks until acknowledged.
2. `thread/read` (`includeTurns: false`) binds the exact thread. Subagent and
   ephemeral threads are refused: their parent owns them.
3. `thread/resume { threadId, excludeTurns: true }` with no overrides, so the
   thread keeps its persisted model, approval policy and sandbox. The writer-lock
   refusal becomes the known `handoff_owner_active` (journal `refused`), with
   nothing sent. The response must report the thread `idle`: `turn/start` on an
   active thread would steer someone else's turn.
4. Journal `dispatching` durably, then send the only mutation: `turn/start` with
   one text input. An authoritative rejection is a known failure; a lost or
   invalid receipt is `unknown` and is never replayed.
5. Await this turn's `turn/completed`; the last `agentMessage` of that turn is
   returned (bounded to 128 KiB, marked truncated). On the turn timeout the owner
   interrupts only its own turn (`turn/interrupt`) and waits briefly; an
   unsettled turn is `unknown`.
6. Close the child, which releases the writer. A close that does not settle is
   `release_unconfirmed` (unknown).

Server requests (command/file/permission approvals, user input, elicitations,
token refresh) receive method-not-found. Codex settles a client error as a
denied/failed request (`on_command_execution_request_approval_response`), so
commands that need approval do not run; the receipt counts refused requests.
The journal stores identities, phases, turn ID/status and counts only, never
prompt or reply text. A restart turns `acquiring`/`held` records into `failed`
(`process_restarted_before_send`) and later phases into `unknown`. Quitting during
a handoff is covered by the lifecycle participant `native-thread-control`;
destroying the service closes its child, which stops the turn and releases the
writer.

## Background subscription boundary

DW5 decision for a live/background feed of an external client's thread:
**declared boundary.** Reasons from the inspected contract:

- App-server event delivery is per connection subscription created by
  `thread/start`, `thread/resume` or `thread/fork` on the server that owns the
  loaded thread. Desktop's server is a private stdio child, so no NEKODEX
  connection can subscribe to it.
- `thread/resume` from another process either fails with the writer-lock refusal
  (thread loaded by its client) or, if the thread is unloaded, loads it and takes
  the writer away from the external client. Neither is passive observation.
- Inside one shared server, server requests are fanned out to all subscribed
  connections and the first response or error resolves them
  (`send_request_to_connections`, `notify_client_response/error`). A passive
  subscriber that answers would decide another client's approvals; one that never
  answers is not a documented observer mode. Subscribers also keep the thread
  loaded, which delays its unload and writer release.

The supported transcript paths are: an explicit page walk of canonical text
(`canonical-backfill`, below) and the handoff's own turn, whose events the owning
connection receives directly.

## Forks and failures


`forkThread({ threadId, lastTurnId?, userInitiated: true })` sends only the thread
ID, optional turn boundary, and `excludeTurns: true`. It does not override model,
instructions, sandbox, approval policy, reviewer, working directory or auth.
An actual guarded user action must supply `userInitiated`; the boolean itself
is not a renderer authorization mechanism. The receipt must identify a new
thread and the exact requested `forkedFromId`.

Codex stored thread attachments (`thread/attachment/*`) are durable resource
references beside history. Per the 0.163 README, a non-ephemeral fork copies the
source's current attachments before publishing the fork, best effort: a copy
failure is logged and the fork still succeeds. The port therefore lists source
attachments before the fork and source plus fork attachments after it (one page
of at most 100, the per-thread maximum) and returns counts-only parity:
`matched`, `missing`, `partial`, `unavailable` or `unsupported`. Payloads are
never projected, and a parity failure never changes the fork receipt. Images and
other input content are part of the forked history itself. Owned persistent
Native conversations are text-only (their send intent has no attachment field),
so they have no attachment set to carry across a fork.

A fork creates history; it does not send a new user message or start a model
turn. An empty new thread without a persisted rollout cannot be forked: the
tested installed API rejects it with `-32600` and `no rollout found`. Native
thread deletion, handoff, message delivery and execution scheduling remain
outside this port; handoff belongs to `codex-thread-handoff.cjs`.

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
bun test tests/codex-thread-handoff.test.ts
bun test tests/conversation-history-canonical.test.ts
node tests/fixtures/codex-client-control-offline.cjs /Users/alex/.local/bin/codex
node tests/fixtures/codex-client-control-offline.cjs /Users/alex/.local/bin/codex --canonical-only
node tests/fixtures/codex-client-control-offline.cjs /Users/alex/.local/bin/codex --handoff
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

The handoff suite drives fake official children: success with resume/turn payloads
exactly as above, a refused approval, last-message selection and child close;
the exact writer-lock refusal with no `turn/start`; non-idle and subagent refusals;
a lost `turn/start` receipt that stays unknown, blocks that thread and other
handoffs until acknowledged, and is never resent; own-turn interruption and an
unsettled turn; restart recovery of a `dispatching` record; and IPC intent and
error sanitization. The canonical suite covers the bounded page walk with a fresh
lease per page, stop on disable, repeated cursor and page limit. The fork suite
covers counts-only attachment parity and an unsupported attachment method.
These are protocol fixtures, not installed-app acceptance.

The opt-in installed fixture uses a disposable HOME/CODEX_HOME, no credentials,
a dummy provider at an unreachable loopback endpoint, and no `turn/start` except in the `--handoff` route below.
It first confirms the empty-thread fork rejection, then uses supported
`thread/inject_items` to materialize inert synthetic history. The port performs
a real metadata read and returns a real fork receipt. Both owned clients close
and the exact temporary state is removed. On 0.163.0 the synthetic no-turn
fixture's list page is empty; populated listing/tree projection is established
by the RPC fixture, not claimed as real account-history evidence. No actual
user thread or installed application is changed by these checks.

On 2026-10-21 the default route also added one stored `pull_request` attachment
before the fork; the real fork receipt reported parity `matched` (source 1, fork 1).

The `--handoff` route uses the same disposable profile, with provider retries set
to zero and the provider at unreachable `127.0.0.1:9`. While the creator process
still owned the materialized thread, the real handoff service received
`handoff_owner_active` and sent nothing. After the creator closed, the handoff
acquired the thread, sent one turn, interrupted its own unsettled turn at the
20-second bound (`interrupted`), and closed its child. A fresh official process
then resumed the thread successfully, proving the writer was released; no
handoff stayed uncertain. No credentials, real account history or installed app
were involved.

The separate `--canonical-only` route does not repeat the fork flow. It starts
one disposable empty thread, injects inert synthetic user/assistant Responses
items through the supported app-server method, closes that creator, then calls
the actual owned `readThreadConversation`. On installed 0.163.0 the metadata
read and `thread/items/list` both succeeded, but the canonical page was empty:
`thread/inject_items` materializes model-visible history without creating
canonical visible thread items. This route therefore exits with code 2 and an
explicit `unavailable-from-injected-history` receipt. It does not claim real text,
message-ID or timestamp projection evidence, and does not fall back to reading
raw Responses, rollout files, or starting a model turn. The public empty-page
response shape is verified; canonical projection remains established by the
focused schema/RPC fixture until a separately authorized canonical producer is
available. Both creator/client processes closed and the exact temporary profile
was removed in the observed installed-protocol check.

The standalone headless browser fixture builds only this surface, using inert
metadata and no Electron/provider bridge. It confirms no initial requests,
explicit load/read/fork, native approval-wait details, fork receipt selection,
unknown-fork blocking, explicit inspection acknowledgement, unsupported-version
errors, and no horizontal overflow
at a 640-pixel viewport. Its dedicated browser and loopback server close, and
the generated bundle directory is removed. A screenshot supports layout review;
this does not establish integrated app, Desktop worker or installed-app state.
