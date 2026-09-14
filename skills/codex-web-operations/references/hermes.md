# Hermes through Codex Web GPT

The user may choose between two non-equivalent runtimes. Explain the capability difference and
honor an explicit choice. The public runbook is `docs/hermes-integration.md` in the fork.

## Codex runtime

After the user selects this route, use **Setup → Hermes → Use Codex runtime in Hermes**. It adds
`codex-web-native`, selects Web High for new sessions, and preserves other providers/settings
with a backup. Restart Hermes to load compatibility code and use a new session.

The inspected Hermes implementation did not forward its selected model to `turn/start`. The
fork's checked compatibility patch forwards `agent.model`; never assume the model shown by the
Hermes picker was used without this boundary. The installer checks patch compatibility, saves
source backups and refuses mismatching versions. After a Hermes update, review/reapply through
setup. Keep unrelated local source edits. The patch is versioned in this fork, not merged upstream.

Commands, files, patches and permissions are owned by Codex. Hermes' in-loop memory, delegation,
session-search and todo tools are not available in the same form. This installer does not migrate
all Hermes MCP servers or change global Codex permissions. Auxiliary providers, scheduled jobs
and other profiles retain their configuration. Avoid requiring a tool literally named `read_file`:
use the file or command tool actually supplied by this runtime.

A dated real test completed the native runtime's file read, emitted tool callbacks in Hermes,
and returned the independently prepared marker. Markdown escaped the marker's underscores;
distinguish rendered equality from byte equality. This is a scoped pass, not every model/tool.

## Experimental direct runtime

The secondary setup action adds `codex-web` with `codex_responses` and preserves the selected
model. Its path is Hermes → `/hermes/v1/responses` → ChatGPT → MCP → structured function call →
Hermes tool/approval → result → final reply. It keeps Hermes' own loop.

A local contract probe using real Hermes and a synthetic model completed a deferred arithmetic
tool cycle. Follow the tools actually advertised: Hermes can expose `tool_search`, `tool_describe`
and `tool_call` instead of a deferred tool directly. Live direct-mode file-read attempts in pre9
still stopped after successful inventory; do not claim that local contract proof repaired them.

## Shared boundaries

Require actual tool execution and a returned answer before claiming complete integration. Keep
account tokens, private config, request handles and raw logs out of Git, screenshots and this
skill. Do not reuse an OpenAI/admin key as the local provider token. Use the effective Hermes
home and preserve source, settings, profiles and existing sessions.

Hermes requires at least 64k context. Use the live per-mode catalog and omit smaller browser
modes; never inflate their advertised window to pass initialization. A model's final refusal is
not completion of a requested file operation. Do not relabel or reroute denied actions to bypass
safeguards. Refresh dated evidence and retain all previous explicit setup/permission decisions.

Hermes Desktop updates can park local compatibility changes using `--keep-stash`. After an
update, inspect the source and use the checked provider setup again; never restore unrelated
stashes wholesale. API 403 during Hermes update discovery is a separate failure from model
routing. The fork's `integrations/hermes/README.md` documents the scoped manual-check repair.
Do not claim local patches survive arbitrary future upstream updates or call a successful
version check proof that another update has installed.
