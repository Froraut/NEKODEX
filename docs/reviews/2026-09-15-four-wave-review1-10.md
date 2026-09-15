# Review wave 1, lane 10 — helper connector verification

Baseline: `3a66157`. Scope: `launcher/electron/browser-helper-verifier.cjs`, `connector-identity.cjs`, direct launcher callers and the helper's verify response. Manual source review only; no tests, typechecks, scripts, runtime or installation checks.

## Potential defects

None established (**0**, no `R1-10-n` IDs). The reviewed failure paths do not supply a concrete trigger that produces false generation-4 acceptance or a wrong mode identity.

## Counterevidence and boundaries

- `connector-identity.cjs:1-11,25-49` maps known Native/Native2/Native3 and Zero Risk aliases to the appropriate generation-4 name and rejects retired runtime names. Custom names are retained, as required by the migration contract. The runtime caller rejects persisted legacy fields before verifying (`runtime.cjs:1023-1035`); the helper separately rejects a retired requested name (`browser-helper-verifier.cjs:64-66`).
- `browser-helper-verifier.cjs:104-149,177-194` requires a correlated helper result and exact returned `text === appName`, with a specific legacy-mismatch failure. The helper returns that text only after `selectConnector` completes (`src/adapters/chatgpt-web/browser-worker.ts:3824-3837`); its protocol sends the selected value under the request ID (`browser-helper-main.ts:348-359`). Main marks MCP verification complete after this call succeeds and clears it on failure (`main.cjs:670-702`). Account inspection deletes an older connector claim on failed inspection (`account-pool.cjs:216-226`).
- Manual MCP verification does not claim a browser selection: it reports local runtime health and a per-turn selection warning (`main.cjs:652-668`). The backend requires the active Manual `appName` to match `manualAppName` (`src/config.ts:447-468`), so the warning's `mcpConnectorName()` resolves to Zero Risk4 for a valid Manual config. DEV caller normalizes the current automatic name to Native4 DEV while preserving the Manual name (`runtime.cjs:1023-1044`, `connector-identity.cjs:30-37`).
- `inspect` and `smoke` share the helper operation transport but do not certify a connector identity (`browser-helper-verifier.cjs:61-66`; `browser-host.cjs:3071-3094,3136-3165`). Their lack of the `verify` name gate is not a demonstrated connector verification defect.

Known limitation, not a finding: source selection and local protocol checks cannot prove that ChatGPT has loaded the new public schema or that a live task succeeds. This boundary is already documented in `2026-09-15-connector-generation4-results.md`; `2026-09-15-tunnel-upstream-results.md` likewise distinguishes focused stubs from live browser/account evidence. No identity or schema change is justified by this lane.

Optional improvements: **0**. Known limitations: **1** (live account/schema/task evidence). Potential defects: **0**.
