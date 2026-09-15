# Four-wave review 2, Sol lane 1 — approval argument validation

Frozen source `3a66157a8943a80bbbe299699cc96bec82721ba1`. Manual, read-only review of `src/adapters/chatgpt-web/command-escalation.ts`, its direct caller in `mcp-server.ts`, and the immediate broker/emission path. Challenged wave 1 lane 1 and the adjacent lane 2 report where they share the command route. No runtime check, test, typecheck, script, source edit, identity or public schema change.

## New concrete defects

**0.** No new demonstrated defect of the frozen command route. The turn's actual native command card and a live approval outcome were not established by these source reports; hypothetical card shapes cannot establish a current runtime failure.

## Repeated candidate and challenged claim

**R2-1-1 — repeated R1 lane 1 conditional schema-checker gap, not a new finding.** Trigger: an advertised structured `exec_command` has `prefix_rule: {"type":"array","items":{"type":"string"},"contains":{"const":"git"}}` and the user supplies `["curl"]`. At `command-escalation.ts:21-45`, `contains` is not evaluated, so `:66-71` accepts that field; `mcp-server.ts:673-682` dispatches it. Consequence: the local pre-dispatch claim of compatibility with the *exact* native schema is false; the native validator can still reject the arguments, so this does **not** prove approval or execution of an invalid command. Counterevidence: R1 lane 1 already gave this exact trigger at `review1-01.md:11`; no such current native card was shown. `mcp-server.ts:688-689` rejects approval fields on the schema-less gateway, and `:673-677` rejects an ambiguous direct card. This is the same optional/conditional candidate, not an independent R2 defect.

**Rejected part of R1 lane 1's wording:** `review1-01.md:7` calls the declared property/value rejection exact, while its own `:11` concedes the checker ignores legal JSON Schema constraints. A valid schema with `prefix_rule: {"type":"array","minItems":1}` (unconstrained items) is also rejected by `command-escalation.ts:44-45` because `items` is absent: a conditional false rejection in the opposite direction, still the same narrow-checker root. Counterevidence: no present native card of either form was established, and the common `items: {"type":"string"}` form is handled. The accurate source claim is that the helper checks its supported subset against the selected card, not complete schema compatibility.

## Direct-call and settlement boundaries

- `mcp-server.ts:649-682` forwards supplied fields without defaulting omitted fields; `:566-573` sends the structured arguments through the broker, and `index.ts:259-268` emits them to the native tool call. `mcp-server.ts:229-239` preserves a native `isError` result. Native approval remains the outer runtime's decision.
- A local schema exception occurs inside `withClaimedTurn` (`mcp-server.ts:514-528`), whose `finally` settles the activity lease. Missing a direct native IPC invocation on rejection is expected and does not imply an unsettled turn. Wave 1 lane 2's `R1-2-1` concerns a *different*, schema-less gateway result-emission path (`mcp-server.ts:334-351,437-453,691-693`); it is neither an approval argument failure nor a duplicate of R2-1-1.
- The generation-4 results distinguish synthetic forwarding from account approval; absent live evidence is a known proof limit. No change to Native4 / Native4 DEV / Zero Risk4 or the public tool schema is indicated.

Counts: **0 new concrete defects; 1 repeated conditional candidate (R2-1-1 ↔ R1 lane 1); 1 challenged first-wave wording claim; 1 known live-proof limitation.**
