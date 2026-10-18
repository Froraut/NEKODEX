# Explicit persistent Native conversations

This mode gives a newly created Native conversation retained context for an
explicit follow-up or fork. It is separate from the existing ephemeral Agent
worker lifetime. Creating one requires the retention acknowledgement next to
the first message; loading the page or refreshing metadata cannot create a
conversation or send a turn.

The account, model and server generation shown when composing the request are
part of its expected context. Main and the account owner must reject a changed
context before admitting a mutation. Changing the account, model or generation
clears the UI acknowledgement. Renderer input contains only this context,
opaque conversation/action IDs, revision, selected model and bounded text. It
cannot choose an executable, profile path, credential, RPC method or permission.

The persistent service shares the already qualified account's Native server,
profile lease, request sender and receipt handling. No second app-server is
launched against the same account. Its exclusive operation gate also covers
Agent worker creation and turns. Read-only sandbox, approval policy `never`
and empty Native tools still apply; this is a text conversation facility.

Only conversations created by this owner are selectable for continuation and
fork. A continuation checks the exact revision and an idle, settled preceding
turn. A fork creates a separate retained context without sending a new message;
the new conversation is selected after its receipt. An unsent composer draft
must be sent or cleared before that fork action. Metadata from a separate
legacy configured Codex profile remains in its existing, separately labelled
view and does not become execution authority.

Mutation identity is retained before dispatch. The existing Native turn journal
owns the actual offer; the conversation registry associates that receipt with
the conversation and its revision. Lost responses are reconciled by reading
the original action receipt. The UI never resends the request as a recovery
step. Unknown, active or unavailable owners block a new continuation. Errors
known to precede action recording are distinguished from uncertain delivery.

The context and explicit user messages remain local in the retained Native
conversation and private owner records. The panel projects only conversation
metadata and its latest final summary, not raw protocol data, account secrets,
tool payloads or reasoning. This local retention choice is separate from the
opt-in history/export feature and its consent rules.

Closing the account or application stops new admission and starts conversation
draining together with shutdown of the exact shared account server. Both must
settle before completion; a missing creation acknowledgement cannot prevent the
transport shutdown needed to resolve it. The account owner releases its profile
lease only after its physical process closes.
An explicit idle Close connection retires its loaded binding while retaining
context. Explicit Resume uses the public `thread/resume` route for a proven v2
owned record: exact account/history identity, current revision, settled prior
actions and no existing live subscription are required. The new binding uses
the current admission and a new journal; its response must confirm the original
Native thread and permissions. Resume itself sends no message. Only a later
explicit Send starts another model turn.

Restart never automatically resumes or sends. A retained v2 record can become
explicitly resumable after the same account is qualified again. Legacy v1
prototype records without proven history identity, unknown outcomes and foreign
threads remain unavailable. A thread ID alone is not execution authority.
Closing and resuming do not discard an unsent draft; the UI provides a separate
local Clear draft action. Cooperative external-client handoff and attachment
parity remain separate work.

Actual macOS development GUI acceptance on 18 October 2026 completed a first
turn, a follow-up recalling context absent from its canonical input, an explicit
distinct fork and a separate fork follow-up also omitting that context marker.
Four completed actions produced three real model offers with direct-user
authorship. An earlier retained record was unavailable after restart without
automatic sending. See the [real acceptance report](../reviews/2026-10-18-real-persistent-native-conversations.md)
for source-bound receipts, checks and remaining limits. The exact Native process,
core and GUI were subsequently confirmed closed, with the registry retained and
its owner lock released.

The subsequent [real Resume acceptance](../reviews/2026-10-18-real-native-resume.md)
passed idle Close→Resume→recall and full application restart→Resume→recall:
one Native thread, three bindings, two admitted server generations, three model
offers and seven completed actions. Both follow-up inputs omitted the recalled
marker; Resume itself made no model offer. Final core/GUI exit0, physical Native
absence and released registry lock were independently recorded. This remains
development evidence, not installed `.9` delivery, external-client handoff or
general business outcome verification.
