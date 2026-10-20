# Agent remote tools

This source batch connects the existing main-owned SSH/SFTP workspace service to
standalone Agent mode through the existing ToolJournal and exact approval owner.
It adds three builtin tools: `remote/list`, `remote/read`, and a literal
`remote/command`. There is no second SSH sender, approval registry or task owner.

A human explicitly attaches an already-connected saved SSH host/canonical root to
an actual task/family/generation/revision. Attachment binds main instance,
connection ID and saved configuration fingerprint across both asynchronous
validation boundaries; reconnect/root/config drift is rejected, not rebound. That fingerprint is not an SSH
host-key fingerprint. System OpenSSH still owns authentication and host-key checks.
No discovery autoconnects a host, adopts another connection or restores grants on
restart. Schemas pin the full main-owned destination binding with const values.
Hostnames, names, files and command output remain untrusted source material.

The private `launcher-agent-remote.json` descriptor uses the existing main
listener, exact profile/instance and bearer. Fixed early routes precede Web lookup.
Before an effect, main calls the actual core: current owned Agent task, exact
pending tool call/arguments/idempotency key and an already-begun durable ToolJournal
intent must all match. The callback only validates; it cannot grant or execute.
Binding/grant and ordinary approval require owned Agent runtime identity
independently of Web health. Passive remote status and privacy revoke use guarded
main IPC directly on the same remote service, including when the core is absent;
these aliases cannot attach, read core state or grant execution. Commands retain
the private HTTP/core-intent validation path.
Every list/read/command still requires that exact call's existing human approval.

Main serializes operations through its existing per-host exclusive SSH owner.
The same private signed registry retains at most48 Agent intents and full encoded
ToolOutcomes up to180 KiB. Relevant receipts are pinned and terminal-storage
capacity is reserved before execution. Active duplicates coalesce; settled
duplicates return the same signed receipt. Restarted started intents become
unknown without replay. Lost HTTP responses permit only exact pure receipt lookup,
including a retained old-main-instance receipt after restart; they never resubmit
execution. Append-only ToolJournal reconciliation preserves the original unknown
and can feed a current-generation continuation without another effect.

Bounded list/read projection exposes truncation, returned counts/bytes and, where
available, full size/hash with `contentComplete:false`; a short projection is not
complete file content. Commands run literally using the selected root as cwd,
with the SSH user's full permissions. That cwd is not an OS sandbox and does not
restrict arbitrary shell access to the root. Receipts prove execution/exit/output,
not an application business outcome or completion of a task requirement.

Revoke and generation invalidation retire future attachment authority without
cancelling accepted commands or losing their owners/receipts. Provider close first
settles issued attach observations, then revokes retained exact scopes, preventing
a delayed attach after final privacy retirement. Failed close promises can be
retried only for retained cleanup; composition also clears a rejected close
promise. Dedicated revoke and passive remote-status channels remain reachable
during drain. No MCP-enabled setting is required to discover this separate builtin.

See [focused evidence](../reviews/2026-10-18-agent-remote-tools.md). Actual SSH
login/host/root/mutation and real Agent UI/provider outcomes are not proved by the
fake-SFTP/runner integration. P03/P06 real remote proof remains open.

Final remote source gates passed: both TypeScript projects19:04, renderer196
modules19:05–19:06, plain CLI643/exact `6.1.32-nekodex.9`19:06 and
module-map730/final check/documented paths. Source commit/new CI remain pending.

Status 2026-10-21: the source was committed as `bbf9108` and reached `main` with the
adoption stack (`296addd`, CI passed). Real remote proof has since passed separately:
real SSH/SFTP read/write/command and worktree create/Open/archive
([receipt](../reviews/2026-10-18-real-remote-workspace.md)), and a real Native Goal
that used `remote/read` and `remote/command` on an actual SSH host
([review](../reviews/2026-10-19-real-native-remote-agent.md)).
