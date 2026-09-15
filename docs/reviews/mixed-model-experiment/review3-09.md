# NEKODEX adjudication review3, lane 9 (gateway)

- Baseline: `9925453` (`9925453bd51e61c7b398abec12ec0da3aca3d3af`)
- Source scope: `src/adapters/chatgpt-web/mcp-server.ts`, `src/adapters/chatgpt-web/index.ts`, and direct broker/result callers
- Method: manual source adjudication only; no source edits, tests, typechecks, automated audits, runtime actions, commits, or delegation
- Skills applied: [`skills/nekodex-regression-prevention/SKILL.md`](/Users/alex/Dev/nekodex/skills/nekodex-regression-prevention/SKILL.md) and [`right-size-test-runs/SKILL.md`](/Users/alex/.codex/skills/right-size-test-runs/SKILL.md)

## Adjudication

### Review1 claim 1 — accepted

`withClaimedTurn()` awaits `settleTurnActivity()` in `finally` (`mcp-server.ts:543-557`). If the action rejects and both cleanup attempts reject, the cleanup rejection replaces the action rejection. The earlier `claimTurn()` and `invoke()` paths do preserve primary and cleanup failures with `AggregateError` (`mcp-server.ts:510-519`, `610-619`), but that protection does not cover this later `finally` path. The failure is reachable for every registered tool using `withClaimedTurn`, including `codex_tool_call` and `codex_tool_inventory`.

Verdict: **accepted**. This is merged with review2 claim 1 as root `L09-primary-cleanup`.

### Review1 claim 2 — design-limit

The generated nested gateway program intentionally crosses the native `exec` tool’s freeform boundary (`mcp-server.ts:334-376`, `462-480`). When a nested result has `structuredContent` or `_meta`, it emits media separately and sends a JSON envelope as freeform text. `brokerResult()` then treats text JSON as a possible `structuredContent` value (`index.ts:246-256`). That changes the representation seen by the outer MCP caller and does not reconstruct `_meta`, but the source exposes the gateway as a freeform execution surface and does not promise that nested MCP fields remain native fields across it. The gateway catalog also explicitly supplies only `name` and `description`, with a generic open object schema (`mcp-server.ts:274-285`, `913-925`).

Verdict: **design-limit**. The report’s observed representation loss is real at the boundary, but its proposed native-envelope preservation contract is invented for this explicitly freeform gateway. No root is created.

### Review2 claim 1 — accepted

This is the same control-flow defect as review1 claim 1: `withClaimedTurn()` lets a rejected `settleTurnActivity()` from `finally` replace a rejected action. The source counterevidence cited by the report is correct but limited to `claimTurn()` and `invoke()`; it does not protect the action/finally path.

Verdict: **accepted**. Merged into `L09-primary-cleanup`.

### Review2 claim 2 — accepted

`finishBrowserOutcome()` calls `await broker.revoke(turnToken)` before checking `completedOutcome.type === "error"` (`index.ts:1317-1328`). `broker` is a `TurnBrokerOwner` (`index.ts:353-362`), and the owner interface permits an asynchronous `revoke`; the `DevTurnBrokerOwner` implementation performs an awaited broker request (`turn-broker.ts:1511-1513`). Therefore a revoke failure can replace the already available browser outcome error. The local in-process `TurnBroker.revoke()` is synchronous (`turn-broker.ts:612-630`), but that does not invalidate the injected owner path.

Verdict: **accepted**. This is a separate root, `L09-browser-outcome-cleanup`.

### Review2 claim 3 — design-limit

This restates review1 claim 2 at the same gateway boundary. The native `exec` gateway deliberately returns a freeform text envelope when structured data or metadata must cross the generated program (`mcp-server.ts:366-375`). The outer `brokerResult()` preserves the envelope as content and may parse its JSON text as `structuredContent`, but it has no source-level promise to unwrap that envelope into the nested tool’s native MCP result. Directly advertised tools do use `asMcpResult()` to preserve broker fields (`mcp-server.ts:229-240`, `595-602`); that is a different transport path.

Verdict: **design-limit**. The boundary is lossy relative to a hypothetical nested MCP ABI, but the reviewed gateway contract is freeform. No root is created.

## Additional defects

No additional real defects met the requested evidence threshold. The gateway schema limitation is already explicit in the inventory response, and the known cleanup/representation boundaries above do not justify hypothetical hardening or an invented public ABI.

## Counts and essential fixes

- Prior numbered claims adjudicated: **5**
- Accepted claim instances: **3**
- Rejected claim instances: **0**
- Design-limit claim instances: **2**
- Unique accepted actionable roots: **2**

Essential fixes:

1. Preserve the `withClaimedTurn()` action error as primary while settling activity; attach cleanup failure as secondary, and make cleanup primary only when the action succeeded.
2. In `finishBrowserOutcome()`, preserve an existing browser outcome error when broker revocation fails; attach the revoke failure as cleanup detail and keep revoke primary only for an otherwise successful outcome.

The public connector ABI and names remain unchanged.
