# NEKODEX triwave review 3, lane 9 — MCP gateway

Baseline: `3740505b0107af9a83053fd523ae1ad30be36465` (`HEAD`). Final adversarial, read-only source review of the MCP gateway and its direct broker/result callers. Read `2026-09-15-triwave-review1-09.md`, `2026-09-15-triwave-review2-09.md`, the current `mcp-server.ts`, `turn-broker.ts`, `index.ts`, `mcp-main.ts`, the generation-4 adjudication/fix records, and the relevant result types. No tests, typechecks, scripts, runtime/account calls, production actions, source edits, or commits were performed. Native4 / Native4DEV / ZeroRisk4 identities, public ABI, and tool registrations remain unchanged.

## Disposition

**One previously reported candidate is confirmed conditionally: `T2-9-1`. No new `T3-9-n` IDs are assigned.**

The candidate root is still present at the current HEAD. `execGatewayResultProgram` checks `isError` and then emits only the nested result's content/media at [`mcp-server.ts:334-357`](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/mcp-server.ts:334). It does not serialize successful `structuredContent` or `_meta`. Both gateway callers use that emitter: the generic nested route at [`mcp-server.ts:374-383`](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/mcp-server.ts:374) and the command fallback at [`mcp-server.ts:451-463`](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/mcp-server.ts:451).

The concrete conditional trigger is a nested tool that returns distinct structured data, for example `content: [{type: "text", text: "created"}]` together with `structuredContent: {id: "abc"}` or `_meta: {receipt: "..."}`. The generated program emits `created` and drops the distinct fields. With empty content and nonempty structured content, it emits no result content. The outer `invoke` path can only relay the result returned by the outer freeform `exec` at [`mcp-server.ts:576-583`](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/mcp-server.ts:576); `asMcpResult` cannot recover fields that the generated program did not encode at [`mcp-server.ts:229-239`](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/mcp-server.ts:229).

This is distinct from the corrected D08 error flag path. The current code throws before emission when a nested result has `isError === true` and includes bounded text/structured error detail at [`mcp-server.ts:337-342`](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/mcp-server.ts:337). It is also distinct from D09: the command gateway still rejects `tty` and `max_output_tokens` before selecting `shell_command` at [`mcp-server.ts:449-463`](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/mcp-server.ts:449).

## Cross-scope interaction check

- `codex_tool_call` reaches the same generated success emitter when the requested `wire_name` is present only in the nested `ALL_TOOLS` registry ([`mcp-server.ts:956-978`](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/mcp-server.ts:956)). `codex_exec` reaches it through `invokeNestedNative` ([`mcp-server.ts:619-634`](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/mcp-server.ts:619)). Therefore the wave-2 root is shared across both public gateway operations; it is one root, not two findings.
- Direct structured calls still preserve `structuredContent`, `isError`, and `_meta` fields that actually reach the broker result at [`mcp-server.ts:229-239`](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/mcp-server.ts:229). The broker's ordinary outer result conversion reconstructs structured content only from JSON text and forwards `isError` at [`index.ts:246-256`](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/index.ts:246). `CodexToolResultMessage` itself has only `content` and `isError` ([`types.ts:72-82`](/Users/alex/Dev/nekodex/src/types.ts:72)), so this is an external result-contract limitation and a review boundary. It does not establish a second current MCP gateway defect or justify ABI changes.
- The inventory path intentionally exposes nested entries with an open-ended placeholder schema ([`mcp-server.ts:894-905`](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/mcp-server.ts:894)). Its fail-closed handling of approval fields and the `arguments` versus `input` distinction remain known contract limits, not new roots.
- `exactTool` still selects the first matching bare outer tool, while duplicate command schemas with approval fields are guarded separately ([`mcp-server.ts:120-123`](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/mcp-server.ts:120), [`:681-687`](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/mcp-server.ts:681)). No current duplicate-card environment or wrong dispatch was demonstrated, so this remains optional hardening.
- Broker activity settlement remains in the existing `withClaimedTurn` path and is independent of the successful nested result-shape loss. No new cross-scope lifecycle interaction was found.

## Candidate classification

### Confirmed from source, conditional on nested result shape

- **`T2-9-1` / P2 — successful nested gateway result loses distinct structured data.** Confirmed as a concrete source path; no live incident claimed. Minimum correction would preserve content/media and encode successful structured data through a transport surface understood by the outer `exec` result, while retaining Native4 / Native4DEV / ZeroRisk4 and ABI.

### Repeats or already corrected

- D08 / the earlier nested `isError` loss: corrected and still guarded.
- D09 / nested `shell_command` loss of `tty` or `max_output_tokens`: corrected and still guarded.
- Duplicate bare command selection, bounded broker tombstones, open-ended nested schemas, and approval-field fail-closed behavior: previously recorded optional or known boundaries.

### Rejected as new findings

- No separate finding for `codex_tool_call` versus `codex_exec`: they converge on the same `execGatewayResultProgram` root.
- No separate `_meta` finding for the direct broker path: the currently typed outer Codex result message does not expose a separate metadata field, and source review alone does not show a supported direct result contract that is silently discarded by this gateway.
- No identity, ABI, Native4, Native4DEV, or ZeroRisk4 regression was found.

## Parent final focused pass (at most three scenarios, within the shared <=60 second budget)

1. Synthetic nested success with text plus distinct `structuredContent` and `_meta`: verify whether the outer freeform `exec` response exposes only text/media.
2. Synthetic nested success with empty `content` and nonempty `structuredContent`: verify the empty-emission boundary.
3. One returned nested `isError === true` case and one `shell_command` case with `tty` or `max_output_tokens`: confirm the already-corrected D08/D09 guards remain reachable.

## Counts

- New concrete defects: **0**
- Previously reported candidate confirmed: **1** (`T2-9-1`, conditional)
- New `T3-9-n` IDs: **none**
- Corrected repeats: **2** (D08, D09)
- Known/optional/rejected boundaries: **5**
- Live incidents claimed: **0**
