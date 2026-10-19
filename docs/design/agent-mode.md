# Standalone Agent mode

Agent mode owns explicitly created NEKODEX tasks. Existing Codex/client tasks keep
their client scheduler, approvals, workspace and transcript owner. Observing a
client task never creates an Agent task or a second executor. `ownerMode: "agent"`
is mandatory at the creation boundary.

## Implemented composition

`src/agent-mode/types.ts` defines the internal task, worker, message, execution
and observed-evidence contracts. `store.ts` is the transaction owner for a private
SQLite database; `runner.ts` prepares and executes one stage through an injected
port. `runtime.ts` owns the local action lifecycle and finite-plan scheduling.
`provider.ts` posts real Responses requests to the configured loopback service;
it reuses that service's model/account/browser admission rather than acquiring
accounts or creating a parallel browser registry. `http.ts` supplies the bounded
authenticated admin handler. `src/server.ts` composes these lazily at
`POST /admin/agent-mode` after its existing local host/origin and control-token
checks. Opening an ordinary inference listener does not create the Agent store.

The selected model is persisted in each task as
`execution: { provider: "local-responses", model }`. The server offers automatic
Web routes from its current supported model map. Native models need an explicit
native credential owner; a control token is never forwarded as provider OAuth.
Existing Native inference remains independent of Agent/Web readiness. The
provider uses the actual bound listener port, disables redirects and does not
derive URLs, tool permissions, shell commands or workspace paths from prompts.

The default configuration is text only: it advertises no tools and attaches
no filesystem environment. Explicitly configured MCP servers can expose supported
schemas through `src/agent-tools`; schemas alone do not authorize invocation.
A tool call returned without a configured tool owner waits for
human/configuration input; it is not executed. A model's completed response
completes a *claimed stage report*, not the requested business outcome.
Bounded prior worker reports and explicit history incompleteness accompany later
stages, allowing reuse without pretending to restore an unavailable provider
conversation. Synthetic fixtures run a local inert Responses adapter and an
isolated SDK MCP process, without contacting a real provider/account.

The internal loopback request carries an exact dispatch ID and service control
authority. Ingress validates the current owner/generation and persisted selected
Web model, consumes a durable transport claim once, then constructs an in-process
`producer: "agent"` context. Replaying that header cannot start another request.
Its broker root is virtual, read only and network disabled; the prompt cannot
turn it into a filesystem grant. The service control token never becomes Native
OAuth or a provider credential. Ordinary client traffic has no such producer
authority.

When the model returns an advertised function call, the dispatch persists its
response ID, exact canonical input/output items, schema/name mapping and pending
call/arguments. The Tools surface obtains that exact owned call from the runtime;
the UI cannot replace its arguments. Explicit approval binds task, generation,
call, server/tool, arguments and discovered schema. The host writes its durable
invocation receipt before execution. Its terminal result is copied into the
Agent result ledger; a missing copy after a crash is reconciled by reading the
existing host receipt, without invoking the tool. Unknown tool outcomes block
continuation and are never retried silently.

An explicit `reconcile-tool` action may ask that same tool host to inspect an
existing retained provider receipt. The core derives the original scope, tool,
arguments and receipt key from its immutable model dispatch; the caller supplies
neither arguments nor an outcome. The shared ToolJournal checks the exact
request fingerprint. Reconciliation cannot discover, authorize, start or execute
a tool. A missing or still-unknown receipt leaves the task blocked.

When a terminal receipt exists, the core appends an `agent_tool_reconciliations`
fact containing its source dispatch, original scope, request fingerprint,
terminal digest, observation generation/revision and late flag. The original
unknown row remains unchanged. Task details expose both histories and a separate
effective-outcome projection for continuations. A matching current-generation
paused continuation can become ready; a late old-generation fact cannot revive
the task or worker. It requires a separate current-scope user action to adopt a
known historical continuation. Action receipts deduplicate transport retries.

Committed generation changes notify a generic trusted tool-invalidation hook
before any replacement launch. The hook aborts only already-owned queued or
in-flight input and does not start a browser/native host. Duplicate action
receipts do not invalidate the same scope twice. A late effect remains uncertain
until an exact retained terminal receipt resolves it; cancellation is never
treated as proof that no effect occurred.

A subsequent explicit Run/Step appends the exact `function_call_output` to the
canonical Responses history, preserving the same logical model turn while
admitting/counting a separate model request. There is no hidden model/tool loop
inside a single budget charge. On service restart, stale tool grants expire with
the generation. `resume-continuation` can explicitly adopt only fully known
terminal outputs from an unchanged task revision; it invokes neither model nor
tool. The next Run/Step can continue from those exact outputs. Missing/unknown
outputs remain blocked. This transition does not revive a previous approval.

Standard MCP image content is projected into Responses tool-result content, not
JSON base64 text and not a newly authored user instruction. The function output
keeps its exact call ID and turn binding; an `input_text` block carries receipt
and non-image metadata, and `input_image` blocks carry validated inline PNG/JPEG
data. The original retained ToolOutcome is immutable. Canonical base64, image
signature/dimension headers, at most two images and 160 KiB of combined image
bytes are checked before sending. The request projection keeps the current
batch's images and every human or unrecognized image mandatory. Only historical
host-built tool images may lose their pixel bytes: the oldest yield first to the
two-image/160 KiB budget and, if needed, the 512 KiB serialized continuation
budget. Their same function output retains receipt, call/turn identity, dimensions
and SHA256, sets attachmentIndex to null, and explicitly says that historical
pixels were omitted and are not a fresh observation. Included image indices are
recomputed for the actual request. The original outcomes and all previously
saved canonical records remain immutable; later canonical inputs retain the
explicit request projection. No new message, observation, permission or evidence
is invented.

Historical omission requires the host's outer metadata envelope, a matching
preceding function call and turn, and image summary metadata matching the actual
MIME/hash/size/dimensions. Nested tool annotations cannot establish that origin.
Only prior host inputs may supply historical tool outputs. A provider response
that returns a client-owned function_call_output or a non-assistant message is
acknowledged as received and held for human review without retaining a
continuation; it is never classified as not-sent after fetch. The projector also
refuses such model output in an older saved continuation before any new fetch,
even when it copies an otherwise exact host envelope, receipt, hash and turn.
The original host envelope without the newer projection marker is recognized
with the same checks, so existing saved image history can continue. Human images
and unrecognized tool images are never silently removed. Base64 inside diagnostic
text remains text and counts toward the serialized payload; it is neither decoded
as an image nor truncated to fit. Unsupported/malformed images, a current batch
that alone exceeds the limits, or mandatory content that still cannot fit produce
a confirmed not-sent outcome before fetch. The 256 KiB tool-result, two-image/
160 KiB request and 512 KiB continuation caps are unchanged. Projection does not
certify screenshot contents as a verified business result.

## Durable schema and owner

Schema version 1 uses `agent_tasks`, `agent_workers`, `agent_dispatches`,
`agent_mail`, `agent_work`, `agent_tool_outcomes`, `agent_tool_reconciliations`
and `agent_receipts`. Each row has its own immutable identity;
coupled updates run in an immediate SQLite transaction with full synchronous
durability and SQLite rollback journalling. The directory is owner only and the
database is a private regular file. A newer schema is refused. Storage quotas
stop writes explicitly instead of deleting active instructions or receipts.

Task IDs, family IDs and worker IDs are separate. Worker names are scoped to the
task family/task and never serve as global identities. A completed worker sleeps
and can accept another stage. Closing a UI surface does not complete a worker.
The database permits multiple connections, but a transaction may claim only one
top-level execution owner for a task generation. An existing owner is never
stolen using a timer. The owner token in the service includes its PID and runtime
instance; only an absent PID (`ESRCH`) establishes stopped-process recovery.
Live, reused or inaccessible PIDs remain unresolved. This conservative rule can
require operator reconciliation; PID liveness alone never authorizes a send.

Stages have explicit requirement IDs and dependencies. A stage can be admitted
only once while pending and its dependencies must be completed. Duplicate finish
receipts cannot advance it twice. A user correction records the correction text,
increments task revision/generation and replaces the plan. Completed stages with
the same instructions, dependencies and unchanged requirements are retained;
changed stages and their dependent checks are pending. Old outcome evidence
remains visible but cannot certify the new task revision without a current
observed binding.

For a task with a claimed packet in its current cycle, correction restores that
packet's text as data-only `userInput` on every corrected stage, including new
stage IDs and changed requirement associations. It resolves this input from the
durable claimed work row, checks uniqueness, current `lastWorkKey` and enqueue
generation, and refuses ambiguous state. Caller-supplied runtime fields cannot
replace that provenance. Historical data is not a continuation, tool approval or
new Run grant. A later claimed packet supersedes the current input normally.

## Delivery and recovery

The execution outbox records `admitted → offered → acked → settled`. `offered`
is committed **before** invoking the port. An offer without a confirmed terminal
receipt can become `unknown`, whether or not an ACK was observed. Exceptions,
socket loss, request aborts and HTTP errors do not establish that no external
effect occurred. There is no automatic retry of an unknown send and no claim of
exactly-once external effects.

Each dispatch records an immutable mailbox packet of exact message IDs and
revisions. Only the latest unread revision of an ID enters a new packet. Offering
and acknowledging the packet happen with its dispatch transaction. All revisions
and unread state remain inspectable. An instruction edited after admission is a
new revision, not a silent mutation of an offered packet.

Recovery needs a host stopped-owner receipt. Never-offered admitted work can be
cancelled and its reservation released. Offered/ACKed work becomes unknown and
retains its reservation. Opening the store alone makes no recovery decisions and
never invokes the model. The server may supply a stopped-owner receipt only
after its exact lifecycle/PID check; that transition starts no work.

Pause, stop, correction and mode changes invalidate the generation before the
local port is aborted. The physical port can still return late: its receipt is
retained under its original dispatch, cost and worker identity. It cannot advance
the replacement generation. A paused/recovered stage whose previous instruction
was offered remains blocked, rather than being made pending and sent twice.
`adoptLateResult` can explicitly adopt a matching current-revision terminal
success after host/human review, without sending anything. Unknown outcomes
require a trusted external terminal or confirmed-not-sent receipt; a new action
ID or renewed consent is not such a receipt.

Graceful service shutdown closes admission, prevents further automatic stages,
aborts owned requests and waits for their promises before closing SQLite. The
owned-resource finalizer is shared across concurrent and repeated stop calls;
runtime settlement and database closure each happen once. Every stop request
still reaches Bun, allowing a force stop to escalate an earlier graceful drain.
The listener shutdown wait is bounded. If a port ignores abort, its database stays
open until that owner settles, preserving late receipts; an actual process loss
leaves its durable offer for recovery. Shutdown never changes an uncertain send
into a successful cancellation.

## Finite Goal, explicit Loop and limits

Manual mode needs a user action for each stage. `step` admits exactly one stage.
`run` is an explicit action for a Goal/Loop task and follows only its finite,
substantive persisted stages. It uses completion events, not a polling or empty
Continue loop. It stops on failed, uncertain, waiting, exhausted-budget or
review-required state. Draining the service prevents another stage. No run starts
on task creation, metadata read or process reopen.

Goal means a finite deliverable. Loop creation/mode switching additionally needs
`recurringAuthorized: true`; mode changes invalidate the prior generation. A Loop
does not call itself complete. The implemented recurring source is an event-driven
durable work mailbox: an explicit `enqueue-work` action supplies a stable
`workId`, source `workKey` and substantive instruction text. Its queue survives
in-flight cycles and process reopen. Duplicate IDs/keys cannot enqueue or execute
the same source twice; conflicting text under an identity is refused. Bare
Continue/Proceed instructions are rejected. No timer or model-ready claim creates
new work.

Explicit Run records consent for this Loop owner/generation. After its finite
cycle settles, another cycle begins only if that consent is still active and a
pending new packet exists. Otherwise it waits for the mailbox without sending a
model request. Enqueueing while that same owner waits can wake exactly that new
packet. Turn/spend limits remain cumulative. Pause, stop, correction and mode
changes revoke the run consent; correction/mode changes retain older queued
instructions as held, for explicit review. `cycle` can explicitly load a selected
pending/held packet without sending, followed by a separate Run. A cycle with an
opted-in workspace snapshot pauses for an explicitly renewed generation-bound
grant before it may offer a model turn. Opening the page or restarting the process
never resumes old run consent. File/HTTP/remote watchers are not advertised; they
need their own real source identity and authorization port.

Concurrency and total turns are user bounds. Admitted, never-offered work reserves
turn capacity without consuming a model turn. Offers consume capacity
conservatively until a terminal receipt proves they were not sent; that proof
refunds the turn. Unknown sends retain their charge. Monetary amounts are integer units
defined by a host price/receipt port. A bounded-money task requires a real maximum
cost quote before admission. Unknown cost retains the reservation and pauses
that task; an independent idempotent usage receipt can reconcile it later.
`maxSpend: null` explicitly selects no monetary budget while keeping a finite
turn bound, useful when a subscription Responses route supplies no price. Such
turns increment `unpricedTurns`; `spent` is only the known subtotal, never an
invented zero total. Tokens are not converted to guessed money.

## Outcome review before completion

The manual helper receives the original request, corrections, current
requirements/plan and selected observed evidence. Its local coverage review
returns findings, evidence links and an editable recommendation. It sends no
follow-up, spends no unmetered model request and never treats model text as an
outcome certificate. A separate model helper may be injected at the runner port,
but its invocation must have its own durable admission and budget owner before
being exposed as automatic work.

An observed evidence record names a source event, exact subject revision/hash,
property, outcome and trusted observer. HTTP callers may request a reference;
they cannot supply a fabricated observer or `passed` value. The host resolver
must retrieve and scope the real source. Without a resolver, evidence attachment
is visibly unavailable. A successful tool receipt can prove only the property it
actually observed; a shell exit or model answer does not prove publication,
installation, release or another business result.

Workspace artifact observation is an implemented outcome source. The main process
maps an explicitly selected picker-owned root, relative file, requirement and
expected existence/SHA-256 condition to a namespace-separated signed observation.
`workspace-evidence` accepts that proof only; the Bun observer authenticates it,
re-captures the actual file and journals its reference/outcome before the Agent
owner records the fact. Caller/model `passed` values cannot enter this boundary.
References expose observation time, actual hash and existence, without file
contents or the signing key. Reopening a task projects those retained references.

Final verification invokes the trusted file observer synchronously inside its
commit transaction. It rechecks the currently selected active file facts; a
changed revision refuses verification even if an earlier observation passed.
Fresh inspection after a repair can supersede a prior fact only for the exact
same task revision, requirement, subject, observer and expected property. The
expected SHA is part of that property, so choosing a different desired hash cannot
hide a contradictory condition. Supersession is explicit, references existing
facts and cannot mutate their history. Review, verification and freshness checks
use the active projection; failed facts for another file/condition remain active.
The mapping proves the selected property of that artifact, rather than every
semantic business meaning of a free-text requirement.

Reviews bind generation, task revision and evidence revision. Unchanged evidence
is not repeatedly reviewed. Corrections invalidate older recommendations. Final
verification requires a current complete review, all required observed
properties passed, no failed/unknown coverage, no unsettled dispatch or held
reservation, and a finite Goal/manual task. The API exposes the recommendation
separately from the explicit `verify` transition.

## Admin surface and integration ports

`POST /admin/agent-mode` accepts `status`, `list`, `get`, `create`, `control`,
`step`, `run`, `review`, `evidence`, `verify`, `workspace-grant`,
`resume-continuation`, `reconcile-tool`, `enqueue-work`, `cycle` and `workspace-evidence`.
Successful payloads use
`{ ok: true, value }`; failures are sanitized `{ ok: false, error, message? }`.
Reads and mutations both require the service control authority. Envelopes and
content are size bounded. Detail lists include totals/truncation coverage rather
than claiming full history. Create and action IDs are stable; command receipts
ensure an HTTP/UI retry cannot admit a second turn. A conflicting reuse of an ID
is refused. The external scoped action adapter uses
`executeScopedAction({taskId,actionId,familyId,generation,revision,operation})`,
which checks an existing action receipt before rejecting a stale current scope.
It shares this runtime owner, never creates another sender.

Companion, standalone Tools and the read-only local control API use their own
lazy composition factories under the same local listener. Their admin routes
retain the control guard; the public versioned read surface uses a separate
hashed read credential and whitelisted metadata projection. Reading their status
does not start a browser companion listener or MCP process. A read credential
cannot access admin/model routes or become an action credential.

The remaining concrete boundaries are explicit:

- The tool port owns configured MCP processes, schema discovery, exact scoped
  grants, invocation/terminal receipts and uncertain-tool reconciliation. Tool
  schemas are not authority. Model-supplied names or grant IDs cannot authorize
  invocation. Any further model turn after a tool result needs a separate
  persisted admission. This boundary is implemented for explicitly configured
  SDK stdio servers; Native sandbox execution remains unavailable without a real
  execution backend. The host is an OS user process, not a sandbox.
- A workspace port owns the exact selected local root, path/symlink safety,
  branch/worktree isolation and user edits. Task text cannot grant filesystem
  access. A workspace lease must be acquired by that owner before tools see it.
- Client history/fork uses its supported client capability. An Agent family ID
  or provider conversation is not a Git branch or a supported client fork.
  Branch seeding needs immutable selected message/checkpoint identities and
  declared attachment/history coverage; replaying a whole request is not fork.
- Manual snapshots/restore use the workspace owner, exact base/hash/path
  receipts and conflict preview. Per-turn checkpoints additionally need a real
  pre-write hook. A post-turn diff cannot promise a complete rollback, and a
  failed check never triggers an automatic reset/restore. The opt-in Agent
  pre-offer hook consumes a main-process-signed snapshot-only grant for exact
  task/family/generation and picker-selected paths. It commits the snapshot
  before offering the model dispatch. An invalid/revoked/failed grant cancels
  never-offered work and holds the task; it cannot grant tool filesystem access.
  Repeating a dispatch cannot capture a different before-image. Receipt metadata
  is visible in task details, while stored file bytes stay private. A new task
  generation needs a renewed explicit grant. The hook is a pre-model snapshot,
  not proof that all writes by every external tool are covered by a pre-write
  checkpoint.
- Any additional recurring source/watcher must supply a real new-work identity and its own
  authorization/lifecycle. It cannot reset turn/cost bounds silently or revive
  a stopped generation.

## Focused verification

`tests/agent-mode.test.ts` exercises real SQLite reopen, mailbox revisions,
sleeping worker reuse, one-owner/generation conflicts, crash before offer,
offer-before-ACK, lost finish, late correction results, stable receipts, unknown
usage and Goal/Loop limits. `tests/agent-mode-http.test.ts` exercises the real
adapter/request shape using injected fetch fixtures, authentication, bounded
schemas, no fake monetary price, action replay, unsupported tools and unknown
transport outcomes, scoped action replay and two fixture model cycles driven by
a new mailbox packet (queued during an in-flight cycle, with duplicate/empty
Continue suppression and pause). `tests/agent-mode-server.test.ts` exercises the actual local
listener/admin mount and loopback Responses route with an inert adapter; it
checks no unauthenticated store creation, origin rejection, selected route,
durable result, drain and close/reopen. The connected local MCP fixture additionally
checks no effect before exact approval, no duplicate effect on approval retry,
service stop/reopen between tool and continuation, known-output adoption without
a send, the same logical Responses turn and two separately counted model
requests. Its owned SDK process is closed with the service. These fixtures do not establish a real
provider run, live account/tool authority, app installation or release.

`tests/agent-mode-workspace-evidence.test.ts` connects the real local listener,
main HMAC signer, actual selected fixture files, outcome journal and final verify
owner. It checks wrong hash and missing-file failures, exact-condition
supersession without hiding an unrelated failure, drift after passing review,
fresh proof after restoring bytes, retained history/active projection and a
verified result without an additional model request. No live workspace/account
or provider is used by that fixture.

`tests/agent-mode-tool-reconciliation.test.ts` connects the core admin actions,
the shared tool host/ToolJournal and an isolated builtin fixture. It proves an
actual fixture effect before uncertainty, no transition on a missing receipt,
exact-fingerprint refusal, a separately retained terminal fact, current-scope
continuation, correction while a receipt read is in flight, one scope invalidation
for a committed correction, late-result retention without reactivation, immutable
unknown rows across reopen and no effect replay. It uses no real provider, app
window or browser input.

`tests/agent-mode-tool-images.test.ts` exercises the canonical projection and
production Responses parser without any real model request. Its connected injected
Responses flow completes four successive synthetic observations and a terminal
report, keeping the newest bounded tool images and explicit omission metadata
for older pixels. It checks exact call/order/turn/receipt identity, immutable
original outcomes and canonical records, reindexed attachments, preserved human
images and diagnostic base64 text, recognition of the original host envelope, and
refusal before fetch when mandatory/unsupported content cannot fit. The same
focused check covers decoded-image and serialized-payload pressure, mismatched
host summaries, nested annotation spoofing, malformed images and oversized
current batches. Adversarial provider outputs cannot manufacture tool-result or
human provenance; copied legacy model outputs are refused before another fetch,
while a newly fetched/acknowledged counterfeit is held without a continuation.
It uses no real desktop, tool execution, account or model.
