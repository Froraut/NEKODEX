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
