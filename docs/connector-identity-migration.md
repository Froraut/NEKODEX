# Native6 migration in 5.6

New Automatic Full setup selects `Codex Native6` (`Codex Native6 DEV` in an isolated DEV profile).
This identity includes the Native5 asynchronous operation tools and the Native6 metadata-only
`codex_tool_status` recovery tool. Native4 and Native5 configurations remain readable and keep
their existing public schemas during ordinary runtime upgrades.

To migrate, choose the visible Native6 upgrade action while idle, create a new ChatGPT connector
with its own App ID, exact displayed name and existing mode tunnel, then run Verify. Never rename
or refresh a cached Native4/5 connector to claim Native6. A local migration invalidates the old
verification proof; it does not prove that ChatGPT has loaded the new schema.

Native6 is the default for new setups, not an automatic replacement of an active user's connection.
The synchronous Native4 compatibility mode and Manual Zero Risk4 remain available.

## Published ABI snapshots (6.1.12)

`docs/connector-abi/` holds the exact public `tools/list` (and server instructions) of every published
identity: Native4, Native5, Native6 and Zero Risk4. `bun run connector-abi:check` compares the live
MCP server against them; CI runs it on every push and pull request. A difference means the change
needs a new identity. Run `bun run connector-abi:write` only for an identity that has not shipped.

The snapshots were introduced after two in-place changes to Native6:

- 2026-09-20 (5.6 follow-up): the `codex_tool_status` description gained the truncation wording.
- 2026-09-27 (6.1.1 adaptation): the `codex_tool_call` description gained the reserved
  `codex.control.compaction_handoff` operation text. Native4 and Native5 changed the same way.

A Codex Native6 app created before 2026-09-27 therefore holds the older descriptions in ChatGPT. It
keeps working, because the compaction request itself carries the complete handoff instructions, but
the model does not see the reserved operation in the tool description. To load the current Native6
schema, delete that app in ChatGPT and create it again with the same name and tunnel. The snapshots
freeze the current Native6 schema from 6.1.12 onward.

## Planning a future Native7

6.1.12 fixed the Native6 reliability problems without a schema change: slow calls become owned
operations, the completion fence acknowledges results a finished response left behind, and stale
leases expire. A Native7 is warranted only for a deliberate public contract change. Candidates
collected in the 2026-09-29 review:

- drop the "Native5 only." / "Native6 only." prefixes and describe the ~90-second window, approval
  waits, running handles and one-batch-at-a-time execution in the `codex_exec`, `codex_tool_call`
  and `codex_tool_start` descriptions;
- describe `turn_token` (copy exactly) and `operation_key` (new key per execution) in their schemas;
- cap `codex_write_stdin.yield_time_ms` at the 60,000 ms actually forwarded, and give `shell_command`
  harnesses a separate `timeout_ms` instead of reusing `yield_time_ms`;
- an `outputSchema` for `codex_tool_status` only.

A bump must touch every place that hard-codes the async identities: `src/config-policy.ts`,
`src/config.ts`, `src/setup-policy.ts` (the `Native5|Native6` pattern), `src/tunnel.ts` and
`launcher/electron/runtime-supervisor.cjs` (both MCP command builders),
`src/adapters/chatgpt-web/mcp-main.ts` and `mcp-server.ts` (keep the Native6 branch byte-identical),
`launcher/electron/connector-identity.cjs`, `launcher/electron/runtime.cjs` (upgrade action),
`launcher/src/McpSurface.tsx` and `launcher/src/i18n.ts` (six languages), `src/cli.ts`,
`src/dev-chat/cli.ts`, the READMEs and troubleshooting guide, and a new snapshot in
`scripts/connector-abi.ts`. Retain Native4, Native5 and Native6 as supported saved identities;
ordinary updates must not move a saved identity.

## Historical Native4 migration reference

# Connector identity migration for native command fields

[#487](https://github.com/miuuyy/codex-chatgpt-web/issues/487) reports that the Full-mode
`codex_exec` convenience action omits the outer Codex command tool's sandbox-escalation fields.
The previous public `tools/list` schema for `Codex Native3` and `Codex Zero Risk2` has no
`sandbox_permissions`, `justification`, or `prefix_rule` inputs. Adding optional fields changes
the public schema for both Automatic and Manual contracts, which ChatGPT may cache under a
connector's App ID. This migration gives that schema a new identity instead of modifying an old
one in place. The earlier [upstream review](reviews/2026-09-15-upstream-01.md#integration-decision-for-487)
records the deferred source-level finding and the existing generic-tool workaround.

| Mode | New public identity | Legacy identities kept for migration recognition |
| --- | --- | --- |
| Automatic Full | `Codex Native4` | `Codex Native3`, `Codex Native2`, `Codex Native` |
| Repository DEV | `Codex Native4 DEV` | `Codex Native3 DEV`, `Codex Native2 DEV`, `Codex Native DEV` |
| Manual | `Codex Zero Risk4` | `Codex Zero Risk2`, `Codex Zero Risk`; `Codex Zero Risk3` recognized defensively |

These names are exact public MCP ABI identities. The DEV connector belongs to its isolated
development tunnel and profile; it is distinct from the normal Automatic connector. Legacy names
remain recognizable local aliases so setup can identify the required target and report a specific
migration error. `Codex Zero Risk3` is a defensive local alias; it was not published as a connector
identity here. These aliases are not current connector targets or a fallback for a new turn. Historical
reports, published releases, and old ChatGPT plugin App IDs retain their original names.

## Command and approval contract

The new `codex_exec` public schema specifies optional escalation arguments.
The bridge forwards each supplied field only when the exact active outer native command schema
supports it; it must reject an unsupported field rather than silently discard it or infer an
approval. The command, working directory, timing, output, and TTY inputs keep their existing
meaning. `codex_tool_inventory` and exact `codex_tool_call` remain available for a structured
outer command tool whose live schema supports additional arguments.

An escalation request is just an argument to the native Codex command tool. Codex applies the
current sandbox and approval policy, presents any required approval UI or auto-review, and returns
the native result. The MCP bridge does not grant permissions, approve on the user's behalf, or
reinterpret a denial as success. This also means that a sandbox without escalation support cannot
be made permissive by selecting the new connector. Conservative mutating annotations for
`codex_exec` remain appropriate for arbitrary shell commands.

## Installation and evidence boundary

1. Update the local runtime and reconnect the harness for the chosen mode. Setup selects the new
   local target and retains that mode's tunnel and credentials. A migrated local config or healthy
   tunnel alone does not prove ChatGPT has accepted the new schema.
2. In ChatGPT connector settings, **create a new plugin App ID** with the exact new name for that
   mode, pointing at its tunnel. Use the documented authentication and workspace permissions for
   that mode. Do not rename or refresh the old App ID to try to replace its cached `tools/list`.
3. Verify that the active account selects the exact new connector and exposes the new
   `codex_exec` argument schema. A visible connector name or local schema fixture is only
   configuration evidence.
4. If an operation actually requires escalation, observe the native Codex approval decision and
   resulting command status in a real authorized task. A successful setup wizard, cached tool
   listing, or source change cannot establish this end-to-end outcome.

No real ChatGPT connector was created and no sandbox escalation or approval was exercised by this
documentation change. Those account and runtime outcomes must be reported from their own live
evidence after the coordinated implementation is installed.
