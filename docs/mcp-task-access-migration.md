# MCP task access and connector migration

This release adds `codex_read_thread`, a dedicated read-only action for reading a referenced
Codex task. It accepts the task ID and the existing read options (`cursor`, `hostId`,
`includeOutputs`, `maxOutputCharsPerItem`, and `turnLimit`). Its public MCP annotations declare
read-only, non-destructive, idempotent, closed-world behavior. It can invoke only the single,
structured `mcp__codex_app__read_thread` tool advertised by the current outer Codex turn.
A missing tool, a different namespace, ambiguous duplicate entries, or a freeform replacement
returns an explicit error. The action does not continue, rename, archive, or send messages to tasks.

Automatic Full mode requires the current `turn_token` on every call. Manual mode requires the
current `request_id` after `codex_turn_start`; completed, revoked, or unstarted requests cannot
read a task. Browser-only mode receives no broker capability and no connector. The generic
write-capable tools keep their existing annotations, sandbox boundary, and approval behavior.

## Required connector identities

ChatGPT caches the complete public `tools/list` schema under a connector identity. Adding this
action changes the schema for both Automatic and Manual mode. This fork follows its existing
identity-migration policy rather than relying on an in-place refresh of a cached connector.

| Mode | Retired identity | Current identity |
| --- | --- | --- |
| Automatic Full | `Codex Native`, `Codex Native2` | `Codex Native3` |
| Repository DEV | `Codex Native DEV`, `Codex Native2 DEV` | `Codex Native3 DEV` |
| Manual | `Codex Zero Risk` | `Codex Zero Risk2` |

1. Install the new runtime and use **MCP → Connect harness** to apply its setup. Setup changes the
   local target identity; it does not create or verify a ChatGPT connector. The migration preserves
   each mode's tunnel and credentials, keeps Automatic and Manual tunnels distinct, and retains
   the current approval setting.
2. In ChatGPT's connector settings, create a **new** connector with the exact current name for
   that mode and the tunnel shown by its setup. Use **Authentication: None**. Keep workspace action
   permissions aligned with the tools you intend to allow. Leave retired connectors unchanged;
   renaming an old connector does not prove that its cached schema was replaced.
3. For Automatic mode, run **Verify runtime** to verify selection of the current connector.
   For Manual mode, select `Codex Zero Risk2` yourself before sending the prepared prompt.
4. In a real installed Codex task, ask to read one turn from another task you can access, with
   `includeOutputs: false`. Confirm that ChatGPT invokes `codex_read_thread` and that the outer
   `mcp__codex_app__read_thread` returns that task's result. Connector visibility or a passing local
   test alone is not evidence that ChatGPT has loaded the new public action.

A runtime still configured with a retired identity fails before opening a turn. Its error names
the correct current connector, including DEV and Manual targets. Setup loads a migrated copy
without rewriting the saved file until the normal setup flow persists it. An old connector is
never silently selected as fallback. Account-bound creation and invocation remain explicit
release-validation steps.

The Automatic `tools/list` ABI digest is
`1cb13b0e64755256391e91c109f35917bd6dbc9c48f8668ff803f91af4d6ecd8`;
the stdio contract test pins it. The Manual `tools/list` digest is
`e05351002a367d8891dbeb9f314779378a0a59853a62b1fc3f7115b2e6496911`.
Any future public schema change must update its fixture and introduce another deliberate connector
migration.

## Upstream provenance and replay hygiene

The read-only action and initial Full/Manual stdio tests come from
[PR #430](https://github.com/miuuyy/codex-chatgpt-web/pull/430), by
[oenderg (Önder)](https://github.com/oenderg), commit
`bbdb4077a9ca488c2b6c41162234c228da696f22`. This fork adds explicit identity migration,
mode-specific errors, prompt guidance, and regressions for malformed registries and retired tokens.

The retired-handle scrubber comes from
[PR #442](https://github.com/miuuyy/codex-chatgpt-web/pull/442), by
[zm2231 (Lil Z)](https://github.com/zm2231), commit
`cf75a3162ee28621dcb0beef730c01443a3a1fdb`. It covers all six minted kinds (`turn`, `binding`,
`call`, `request`, `control`, `handoff`), exact 32-character bodies, and JSON-escaped control
boundaries. The current turn's token is supplied separately in the active contract and retained.
Fork regressions cover all JSON control characters, embedded and wrong-length near-misses,
ordinary and multipart replay, and valid JSON after scrubbing.
