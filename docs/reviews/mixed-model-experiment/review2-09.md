# Independent blind review wave2 lane9 gateway

- Repository: `/Users/alex/Dev/nekodex`
- Baseline: `9925453`
- Source state: unchanged; source inspection only
- UTC start: `2026-09-15T20:34:00Z`
- UTC end: `2026-09-15T20:36:53Z`
- Inspected scope: `src/adapters/chatgpt-web/mcp-server.ts` and `src/adapters/chatgpt-web/index.ts`
- Review focus: MCP result loss, primary versus cleanup errors, schema preservation, alternate/gateway paths, error paths, cancellation paths, and direct-caller paths
- Verification: none run, per request; no tests, typechecks, scripts, runtime actions, commits, or delegation

## Findings

### 1. Cleanup failure replaces the primary MCP action failure

- Trigger: any registered MCP tool enters `withClaimedTurn`, its `action` rejects, and both attempts in `settleTurnActivity` reject (for example, broker disconnect or activity cleanup failure after a native invocation error).
- Exact location: `src/adapters/chatgpt-web/mcp-server.ts:543-557`, especially the `finally` at lines 552-556.
- Consequence: the `finally` rejection from `await settleTurnActivity(...)` replaces the action's rejection. The caller receives only `Codex Native broker activity cleanup failed after an idempotent retry`; the original tool/broker error is no longer the primary error or attached cause.
- Counterevidence: `claimTurn` explicitly combines claim and cleanup failures in an `AggregateError` at lines 510-519, and `invoke` combines invocation and release failures at lines 610-619. Those protections do not cover the later `withClaimedTurn` action/finally path.
- Smallest fix: preserve the action rejection while still settling the activity; if settlement also fails, throw an `AggregateError` ordered as `[actionError, cleanupError]` (or attach cleanup as `cause`), and retain the cleanup error as the sole failure only when the action succeeded.
- Confidence: high; direct control-flow defect reachable from every claimed tool registration.

### 2. Browser outcome errors can be hidden by broker cleanup failure

- Trigger: `finishBrowserOutcome` receives an error outcome and `broker.revoke(turnToken)` rejects.
- Exact location: `src/adapters/chatgpt-web/index.ts:1317-1327`; the revoke at line 1325 runs before the `completedOutcome.type === "error"` check at line 1326.
- Consequence: the broker revoke/cleanup error becomes the thrown error, hiding the actual browser/ChatGPT failure and its classification. The outer error handling then classifies and reports the cleanup failure instead of the primary browser outcome.
- Counterevidence: the Manual-mode `runManual` path preserves its normalized primary error while treating launcher cleanup failures as logged cleanup failures at lines 640-652. The same primary-versus-cleanup rule is not applied in `finishBrowserOutcome`.
- Smallest fix: catch the revoke failure and, when the outcome is already an error, throw an aggregate with the browser outcome first and revoke failure second; only allow revoke failure to be primary when the browser outcome succeeded.
- Confidence: high; the path is used for both tool-capable and read-only browser turns whenever a turn token exists.

### 3. Gateway calls serialize structured results into text instead of preserving MCP fields

- Trigger: `codex_tool_call` uses the native freeform exec gateway for a nested tool whose result has `structuredContent` or `_meta` (the nested tool is not directly advertised in `bound.tools`).
- Exact location: `src/adapters/chatgpt-web/mcp-server.ts:334-376`, especially lines 366-372, together with `invoke`/`asMcpResult` at lines 586-602 and 229-239.
- Consequence: the generated gateway program emits media separately but sends `{ content, structuredContent, _meta }` as `text(JSON.stringify(envelope))`. The outer broker response is then passed through `asMcpResult` without parsing that envelope, so the MCP caller receives the structured data and metadata only as a text payload; the top-level `structuredContent` and `_meta` fields are lost. Directly advertised tools preserve those fields through `asMcpResult`.
- Counterevidence: `asMcpResult` does preserve object-shaped `structuredContent`, `_meta`, `content`, and `isError` when those fields arrive in the `BrokerToolResult`. The loss is specific to the gateway's freeform text boundary, not the direct invocation path.
- Smallest fix: define an explicit gateway envelope decode at the outer boundary (or extend the gateway transport so the envelope arrives as a real `BrokerToolResult`) and map its `content`, `structuredContent`, and `_meta` fields through the same preservation path before returning the MCP result.
- Confidence: high; the generated program and the outer response adapter are both in the reviewed source path, and no later decode is present there.

No additional current reachable defects met the requested evidence threshold. Known fail-closed limitations and future-only hardening were excluded.
