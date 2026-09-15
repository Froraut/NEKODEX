# NEKODEX mixed-model experiment review wave 1, lane 9 (gateway)

- Baseline: `9925453`
- Review mode: manual source review only
- UTC start: `2026-09-15T20:24:00Z`
- UTC end: `2026-09-15T20:32:25Z`
- Result: 2 concrete bugs; 1 related gateway limitation recorded separately

## Inspected scope

Reviewed `src/adapters/chatgpt-web/mcp-server.ts`, with `src/adapters/chatgpt-web/index.ts` and the imported `BrokerToolResult` contract in `src/adapters/chatgpt-web/turn-broker.ts` as direct-call context. The review covered MCP result conversion, nested exec-gateway result handling, claimed-turn activity cleanup, and the inventory schema returned for gateway-discovered tools. No other wave reports were read. No source edits, tests, typechecks, scripts, live actions, commits, or delegation were performed.

## Findings

### 1. High: claimed-turn cleanup can replace the primary action error

- Exact location: `src/adapters/chatgpt-web/mcp-server.ts:543-557`, `withClaimedTurn()`; cleanup implementation at `:523-541`, `settleTurnActivity()`.
- Trigger: invoke any registered tool that uses `withClaimedTurn()` (for example `codex_tool_inventory` or `codex_tool_call`) and make its `action(claimed)` reject while both `activity_complete` attempts in `settleTurnActivity()` reject. The `finally` executes `await settleTurnActivity(...)` after the action rejection.
- Impact: JavaScript replaces the action rejection with the cleanup rejection from the `finally`. The caller loses the original tool or transport failure and receives only `Codex Native broker activity cleanup failed after an idempotent retry` (whose `AggregateError` also retains only `firstError`). This violates the transport contract that cleanup failure must remain secondary to the primary failure and can hide the actionable nested error/classification.
- Smallest fix: retain the action exception, run `settleTurnActivity()` in a separate cleanup path, and if both fail throw an `AggregateError` containing the action error first and cleanup error second; otherwise rethrow the action error unchanged. Keep cleanup primary only when the action completed successfully.
- Confidence: High.
- Classification: Bug.

### 2. High: nested gateway results with structured content lose the original text content and change the structured schema

- Exact location: `src/adapters/chatgpt-web/mcp-server.ts:334-375`, `execGatewayResultProgram()`; the resulting text is interpreted by `src/adapters/chatgpt-web/index.ts:246-257`, `brokerResult()`.
- Trigger: call a gateway-discovered nested tool through `codex_tool_call` so it runs through `execGatewayProgram()`, and have the nested tool return an MCP result such as `{ content: [{ type: "text", text: "hello" }], structuredContent: { answer: 1 } }` (or `_meta`). The generated program detects `structuredContent`/`_meta`, calls `emitMedia(content)` (which deliberately skips text blocks), then emits one text block containing `JSON.stringify({ content, structuredContent, _meta })`.
- Impact: the outer Codex result contains the serialized envelope as its text content instead of the nested text block `hello`. `brokerResult()` then parses that serialized envelope as the outer `structuredContent`, producing `{ content: [...], structuredContent: { answer: 1 } }` rather than the nested `{ answer: 1 }`, and it does not restore `_meta` because `brokerResult()` only maps content, parsed structured text, and `isError`. Media may survive, but ordinary text consumers and callers expecting the declared MCP envelope see altered or effectively lost result content and schema.
- Smallest fix: make the gateway envelope explicit and unwrap it at the broker boundary into the original `content`, `structuredContent`, and `_meta` fields before `BrokerToolResult` is published. The unwrap must be tagged or otherwise unambiguous so ordinary JSON text is not reinterpreted. Preserve text content as text blocks while retaining media parts.
- Confidence: High.
- Classification: Bug.

## Related limitation, not counted as a bug

`codex_tool_inventory(include_schema=true)` cannot preserve the native schema for gateway-discovered tools with the current gateway catalog program. `gatewayToolCatalogProgram()` (`mcp-server.ts:274-285`) exports only `name` and `description`; the inventory maps those entries to a generic `object` with `additionalProperties: true` (`mcp-server.ts:913-925`). This is an observable schema limitation: callers must use the description and the gateway performs the actual argument handling. It becomes a bug only if the contract promises exact schemas for nested gateway tools; the current source describes them as description-driven and does not expose a native nested schema from `ALL_TOOLS`.

## Zero-findings note

Not applicable: the two findings above are concrete current failure paths at the requested baseline. The review did not infer historical regressions or speculative hardening items.
