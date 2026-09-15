# NEKODEX triwave review 1, lane 9 — MCP gateway

Baseline: `3740505b0107af9a83053fd523ae1ad30be36465` (HEAD). Read-only source review of the MCP gateway and direct callers. Scope covered `src/adapters/chatgpt-web/mcp-server.ts`, its `turn-broker.ts` and `index.ts` call paths, `mcp-main.ts`, and the adjudicated four-wave records. No tests, typechecks, scripts, broad audits, runtime calls, production actions, source edits, or commits were performed. The public connector ABI and identities `Native4`, `Native4 DEV`, and `ZeroRisk4` remain unchanged.

## Findings

**0 concrete new defects; no T1-9-n IDs assigned.**

The D08/D09 behavior from the prior adjudication is present at the current HEAD:

- A nested gateway result with `isError === true` is converted into a thrown gateway error before content emission at [`mcp-server.ts:334-357`](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/mcp-server.ts:334). The generated path is used by [`mcp-server.ts:374-383`](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/mcp-server.ts:374) and [`mcp-server.ts:451-463`](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/mcp-server.ts:451). The direct structured path independently preserves the broker result’s `isError`, `structuredContent`, and `_meta` through [`mcp-server.ts:225-239`](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/mcp-server.ts:225).
- The command gateway selects exactly one nested `exec_command` or `shell_command` from `ALL_TOOLS` and rejects `tty` or `max_output_tokens` before invoking a nested `shell_command` at [`mcp-server.ts:451-463`](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/mcp-server.ts:451). The direct command path retains the corresponding rejection and escalation-schema checks at [`mcp-server.ts:681-692`](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/mcp-server.ts:681).
- The broker carries the selected wire name, freeform marker, arguments/input, and returned error flag through [`turn-broker.ts:16-29`](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/turn-broker.ts:16) and [`index.ts:246-256`](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/index.ts:246). The gateway’s invocation is bound to the current turn and settled in the existing `withClaimedTurn` finally path at [`mcp-server.ts:524-538`](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/mcp-server.ts:524).

## Candidate classification

### Repeats of already adjudicated or corrected behavior

- The old D08/R1-2-1 candidate (“a nested returned `isError` becomes successful text”) is a repeat. The current generated gateway checks the flag and throws at [`mcp-server.ts:337-342`](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/mcp-server.ts:337). Its remaining boundary is the exact outer runtime behavior for a nested command that returns an error-valued result rather than throwing; that was already recorded as a focused verification boundary in [`2026-09-15-four-wave-review2-02.md`](/Users/alex/Dev/nekodex/docs/reviews/2026-09-15-four-wave-review2-02.md:11), not a new source defect.
- The old D09/R2-2-1 candidate (“gateway-only `shell_command` silently loses `tty`/`max_output_tokens`”) is a repeat of a corrected path. The generated program computes the requested unmappable options and throws before native dispatch at [`mcp-server.ts:449-463`](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/mcp-server.ts:449). The public `codex_exec` schema and all three generation-4 connector identities are unchanged.

### Known limits, not counted as defects

- Gateway inventory exposes only nested names and descriptions. It deliberately marks the returned schema as open-ended at [`mcp-server.ts:894-905`](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/mcp-server.ts:894), because the outer freeform gateway does not provide an exact nested JSON Schema. Explicit approval fields therefore fail closed in `codex_exec` at [`mcp-server.ts:694-703`](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/mcp-server.ts:694); callers can use `codex_tool_inventory` and exact `codex_tool_call` when a structured outer command card is available. This is the documented contract boundary, not an approval bypass.
- A caller that supplies `arguments` for a gateway-discovered freeform tool can receive a native rejection because the catalog instructs callers to use `input`; the generic route intentionally preserves the caller’s selected form at [`mcp-server.ts:966-978`](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/mcp-server.ts:966). The current catalog does not claim to expose a complete nested freeform schema, and the source does not establish a wrongly typed successful side effect. This remains an input-contract limitation, not a confirmed bug.
- `exactTool` selects the first matching unnamespaced tool at [`mcp-server.ts:120-123`](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/mcp-server.ts:120). Duplicate bare command cards are rejected only when escalation fields are present at [`mcp-server.ts:681-687`](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/mcp-server.ts:681). Broadening that duplicate-schema guard for every command call is an optional hardening change; no current duplicate-card environment or wrong dispatch was demonstrated here.
- The broker retains completed activity tombstones until the turn is revoked. The existing report [`2026-09-15-sol-backend-reports.md`](/Users/alex/Dev/nekodex/docs/reviews/2026-09-15-sol-backend-reports.md:31) records this as a bounded-scope memory improvement candidate. It is a broker lifecycle concern, not a new MCP gateway defect, and changing it would need to preserve delayed-claim rejection.

## Counterevidence and boundary

The gateway’s generated programs validate the runtime registry before lookup, reject invalid or excluded names, require exactly one native command candidate, and invoke only the selected current-turn function at [`mcp-server.ts:374-383`](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/mcp-server.ts:374) and [`mcp-server.ts:451-463`](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/mcp-server.ts:451). Direct calls retain the native tool’s structured result and the broker releases a failed binding at [`mcp-server.ts:567-617`](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/mcp-server.ts:567). The remaining uncertainties are the live outer runtime’s nested result shape, account-side tool registry variants, and real connector loading; none is source evidence of a new defect in this lane.

## Counts

- New concrete defects: **0**
- Repeats: **2** (old D08 and D09 paths)
- Known limits/deferred boundaries: **4**
- Optional improvements: **1**
- New finding IDs: **none** (`T1-9-n` unused)
