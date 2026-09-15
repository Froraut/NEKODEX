# Four-wave review 1, lane 1 — command approval arguments

Baseline `3a66157`; manual source review only. Scope: `src/adapters/chatgpt-web/command-escalation.ts`, the direct `codex_exec` caller and immediate broker/emission path. Consulted `2026-09-15-connector-generation4-results.md` and `2026-09-15-tunnel-upstream-results.md`. No tests, typechecks, scripts, code edits, release or live approval attempt.

## Potential findings

**0**. No R1-1-n ID assigned. The supported direct path retains each supplied approval field (`mcp-server.ts:649-682`), rejects a duplicate bare command card and a missing/ambiguous property (`:673-689`; `command-escalation.ts:53-72`), then carries the same structured arguments via broker and native event (`mcp-server.ts:566-572`; `index.ts:259-268`). The gateway without an exact nested command schema explicitly refuses these fields. The outer Codex runtime still decides approval; successful local forwarding does not establish a live approval outcome.

## Optional improvement / conditional limitation

`command-escalation.ts:21-45` handles a narrow subset of JSON Schema keywords. A future native card with, for example, `prefix_rule: {type: "array", items: {type: "string"}, contains: {const: "git"}}` would let `["curl"]` through the local checker, although the full schema would reject it later. The current code only prechecks the new fields and the outer runtime remains the final validator. No such command card was established in this review, so this is a conditional validation gap, not a demonstrated generation4 defect. If exact pre-dispatch schema compatibility becomes a requirement, fail closed on unknown assertion keywords or use a complete validator after confirming the native card shape.

## Known boundaries / counterevidence

- `codex_exec` prefers the exact bare `exec_command` over `shell_command` (`mcp-server.ts:671`). This retains the existing command mapping; it does not silently substitute a different tool when the preferred card disallows a requested approval value. The explicit error is preferable to claiming that an unselected tool ran.
- `shell_command` rejects unmappable `tty` and `max_output_tokens` before dispatch (`mcp-server.ts:678-680`). Missing schema evidence on a nested `exec` gateway is reported as unavailable, not approval denial.
- Generation4 names and ABI pins belong to the coordinated migration report. This lane found no reason to alter Native4 / Native4 DEV / Zero Risk4 identity or public schema. The prior results explicitly leave ChatGPT-loaded schema and real account approval unproven; that absence is not counted as a source bug.

Counts: **0 potential defects; 1 optional conditional improvement; 3 boundary/counterevidence notes**.
