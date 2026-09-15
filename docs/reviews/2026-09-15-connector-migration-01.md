# Connector migration lane 1 — #487 command escalation

Baseline `d880b12`. The [live #487 issue](https://github.com/miuuyy/codex-chatgpt-web/issues/487) and [upstream 01 triage](2026-09-15-upstream-01.md) identify a missing convenience-wrapper ABI: `codex_exec` did not advertise or forward the native command escalation fields. This lane changes only that wrapper. Connector names, old aliases, ABI pins and release integration belong to the parent.

## Implementation

- `src/adapters/chatgpt-web/mcp-server.ts`: public `codex_exec` adds optional `sandbox_permissions` (`use_default` or `require_escalated`), nonempty `justification`, and nonempty string-array `prefix_rule`. The handler forwards supplied fields unchanged to a directly advertised structured `exec_command` or `shell_command`.
- `src/adapters/chatgpt-web/command-escalation.ts`: before forwarding any of these fields, require the exact current outer command JSON schema to declare each field and its requested value. Missing properties, mismatched types/enums/limits, complex unresolved schema constraints, and freeform/tool-search cards fail closed. The native exec gateway lacks an exact nested command schema, so escalation there is rejected with guidance to use the inventory and generic exact-tool path. An active `shell_command` also rejects `tty`/`max_output_tokens`, which its existing mapper would otherwise discard.
- The command remains marked mutating/destructive/open-world. The outer Codex runtime retains sandbox and approval authority; this adapter makes no approval decision and adds no retry or policy relaxation.

## ABI handoff

Both native and safe `codex_exec` contracts now advertise the three optional fields. Complete-schema pins for the new **Codex Native4** and **Codex Zero Risk4** identities need to include them; the old Native3/Zero Risk2 pins and aliases remain historical. **Codex Zero Risk3** was never published here; the parent's defensive alias for that name does not make it a published connector. The parent owns `src/config.ts`, `launcher/electron/connector-identity.cjs`, and any pin updates. The DEV identity should use **Codex Native4 DEV**. No legacy reports or releases were rewritten.

Manual review covered the changed wrapper, direct command selection, gateway fallback, and current `CodexTool.parameters` shape. No tests, typechecks, suites, benchmarks, build, account calls, commits, or version changes were run in this lane; coordinated parent verification remains pending.
