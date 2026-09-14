# Instant transport check and resumed Pro observations — 2026-09-14

Installed bridge: **5.1.0-froraut.14**. The operator chose Instant for faster model-independent
checks. This note supplements the [signed release receipt](2026-09-14-signed-release.md).

## Confirmed small Instant round trip

One private generated marker file was used for two bounded attempts. Its random contents were
not included in the model prompt. The task required one native file/command read and a final
answer containing that file's contents. Both clients selected `chatgpt-web/light` with low
reasoning effort, a read-only sandbox and ephemeral persistence.

| Client invocation | Observation |
| --- | --- |
| Existing user configuration | No final answer before the 25-second deadline; interrupted and exited after 26.85 seconds including cleanup. Startup logged failures for optional event-stream and computer-history MCP components. |
| Temporary minimal configuration, same file and prompt | Completed in 20.51 seconds with CLI exit 0. The native `cat marker.txt` command exited 0 and the model produced its final answer. |

The minimal client used the existing local bridge and account with per-process
`--ignore-user-config` and the loopback `openai_base_url` override. No global application,
account, plugin or Codex configuration was changed. Authentication remained in the normal
Codex credential store.

The final answer's displayed Markdown text matched the file. Its raw string escaped the
underscores, so this is not a claim of raw byte-for-byte equality. The recorded request usage
was 44,960 input tokens and 122 output tokens, with zero reported reasoning output tokens.

The pair is one input, not a general speed benchmark. Configuration, process startup and warm
state can affect the timings. The first timeout does not show that Instant itself failed, and
the successful small case does not establish large-context compaction or every model/tool path.
No further repeated smoke runs were added after this pass.

## Resumed Pro task

An existing desktop Pro task resumed through an ordinary user message on
`chatgpt-web/pro`, ultra effort. The bridge received the staging acknowledgement for a two-part
context submission, selected Pro and accepted the final part. The native task completed eight
task-reader calls and three local read-only commands, each command with exit 0.

The overall turn nevertheless failed after 379.851 seconds because ChatGPT displayed
Stopped thinking and supplied no final answer. The failure snapshot contained no visible
explanatory modal. This status does not identify quota, policy, context length or another cause.
It is not a successful completed Pro review and did not include a new compaction operation.

The original history was about 76% full after those tool results. The user then selected Instant
in the existing desktop task. Shared window focus initially prevented reliable UI control;
the temporary Instant check itself did not change the desktop model selection.

## Large Instant continuation and native compaction

The same existing task subsequently ran on `chatgpt-web/light`, low effort. Its ordinary
`continue` instruction used a three-part history submission, completed a native read-only
command with exit 0 and produced the final review. This completed turn took about 223 seconds;
it was not a stalled request and was not the compaction operation.

A separate native Compact operation then ran for 152.216 seconds. The primary retained-tab
handoff failed at browser-page acquisition after a 10-second operational-viewport timeout. That
produced the generic handoff error shown in Codex. The recovery used a new tab and three-part
history. Both staging acknowledgements and the final submission were accepted; a stalled DOM
observation was rebound to the same page, and the fallback completed with 9,517 Markdown chars.

Crucially, the native task persisted a `compacted` record at 2026-09-14T18:19:27.131Z with six
replacement-history items and response ID `resp_c47b1decf95d418d87c8f9f16af35d1d`. Its Compact
operation ended successfully, with no final error. The recorded bridge estimates were 248,492
input tokens and 2,468 output tokens; these are not provider billing or capacity measurements.

The subsequent code repair marks a reused completed tab, or a tab transferred to a different
helper, as needing viewport reapplication before presentation. The existing owned-tab path then
restores emulation even when its cached dimensions match. The focused regression confirms that a
collapsed renderer regains the expected dimensions while conversation/connector ownership stays
unchanged. This repair is being shipped as pre15; the pre14 fallback success is not mislabeled
as a live test of the new primary retained-tab path.

## Coordination limitations observed separately

- `send_message_to_thread` delivered a current-turn native `function_call_output`, with namespace
  `codex_app`, name `send_message_to_thread` and a `codex_delegation` envelope. The bridge's user
  revision resolver did not recognize that as a new instruction and rejected the stale user-turn
  mismatch before any browser request. A normal user message was accepted. This forwarded-message
  compatibility issue remains unresolved; no provenance check was weakened.
- `codex exec resume` could not acquire a second writer for the desktop-owned task. Its
  thread-store conflict was respected; no lock or session file was removed.

Native acceptance of the large Instant compaction is now established. Its first-attempt viewport
failure, continuation after that checkpoint and Pro-specific completion remain distinct evidence
boundaries. A successful small Instant check is not substituted for any of those results.
