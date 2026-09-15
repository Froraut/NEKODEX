# Connector migration lane 10 — native ABI fixtures

Baseline `d880b12`. Assigned edit: `tests/chatgpt-web-harness.test.ts` only. This lane read the #487 triage in `2026-09-15-upstream-01.md` and the new `codex_exec` implementation supplied by lane 1. No tests, typechecks, schema-hash calculation, native commands, account operation, or commit were performed.

## Change

- The complete `tools/list` ABI fixture now identifies **Codex Native4** and keeps the former Native3 SHA-256 value in a historical comment. Its expected digest is an explicit `PENDING_CODEX_NATIVE4_ABI_SHA256` placeholder for the parent to replace after all schema edits settle. The fixture also requires `sandbox_permissions`, `justification`, and `prefix_rule` on public `codex_exec`.
- One named focused case, **`Codex Native4 forwards supported approval arguments and rejects an unsupported native schema`**, has exactly two synthetic scenarios. It checks that a structured outer `exec_command` advertising all three fields receives the fields unchanged through the broker; an older structured card missing them returns a schema error before native dispatch. The broker is completed with mock output; the command string is synthetic and never executed.
- Existing older-alias and legacy behavior cases are left as they were. This file owns the Automatic Native ABI. The separately owned Manual ABI pin should identify **Codex Zero Risk4**. `Codex Zero Risk3` is a defensive alias only and was never published here. DEV remains **Codex Native4 DEV**.

## Parent pin recipe and focused check

After the coordinated source and connector identity migration is stable, obtain the final native `client.listTools().tools` from the fixture's MCP stdio server. Map every tool to `{ name, title: title ?? null, description: description ?? null, inputSchema, outputSchema: outputSchema ?? null, annotations: annotations ?? null }` in listed order. Compute SHA-256 of `canonicalJson(publicConnectorAbi)` using the existing helper at `tests/chatgpt-web-harness.test.ts:277`; replace only `PENDING_CODEX_NATIVE4_ABI_SHA256` with the 64-character lowercase digest. Retain the old Native3 digest as historical evidence. Use the same complete-schema recipe for the separately owned Zero Risk4 pin, whose Manual `tools/list` contract has its own descriptions.

For the shared short verification budget, select by exact name: `Codex Native4 forwards supported approval arguments and rejects an unsupported native schema` (two synthetic scenarios), then the complete-schema pin case `serves the complete outer-native bridge contract over MCP stdio` if it fits the parent's remaining focused-test budget. The parent owns test selection, digest calculation, and any correction. The new focused case proves broker forwarding and rejection, not real Codex approval or ChatGPT connector publication.
