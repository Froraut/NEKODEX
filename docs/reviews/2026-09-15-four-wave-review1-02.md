# Review wave 1, lane 2 — native command dispatch

Baseline `3a66157`. Manual source review only: `src/adapters/chatgpt-web/mcp-server.ts`, its direct schema helper `command-escalation.ts`, broker result contract, and the two requested migration/upstream results. No tests, scripts, typechecks, runtime/account calls, or code changes. Canonical identities: Native4 / Native4 DEV / Zero Risk4.

## Potential finding (1)

**R1-2-1 — nested command error loses its MCP error flag in the gateway fallback (pre-existing, not a generation-4 regression).** Trigger: a turn advertises freeform `exec` but no directly structured `exec_command` or `shell_command`; `codex_exec` has no escalation fields and finds exactly one nested native command. That command returns a result with `isError: true` and ordinary text content rather than throwing. `mcp-server.ts:691-693` invokes the generated gateway program; `:437-453` calls the nested tool; `:334-351` emits only its content, discarding `isError` and `structuredContent`. Consequently the outer `exec` result can be a successful MCP result containing the command's error text, and `:229-239, :566-573` relay that success status to the connector. A caller interpreting `isError` may treat a failed command as successful. Counterevidence/boundary: the direct structured command path (`:671-682`) relays native `isError` through `asMcpResult`; a nested command that throws instead of returning `isError` fails through the gateway. The exact gateway branch and error shape have not been exercised live here. Keep this classification conditional; investigate only if this fallback supports error-valued nested command results in the intended harness.

## Reviewed without a migration defect (0)

- `:632-681` exposes and forwards supplied approval fields without inventing omitted values. `command-escalation.ts:49-73` requires the selected direct command's declared property/value; duplicate same-name command cards with escalation fail closed. `shell_command` rejects unsupported TTY/output choices. The caller still relies on native Codex for actual approval.
- `:684-693` rejects escalation when only the freeform gateway is available, because there is no exact nested command schema. This is an intentional limitation, not a failed approval. Gateway dispatch also rejects zero or two listed nested command names (`:444-450`).
- The generation-4 report explicitly distinguishes protocol/schema checks from live account approval or retained-task survival. The tunnel/upstream report's earlier #487 deferral was superseded by the coordinated identity migration. Neither missing live proof nor the old alias is a source defect here.

Counts: **1 conditional potential finding (R1-2-1), 0 proven generation-4 regressions, 0 code changes**. No identity/schema modification recommended in this lane.
