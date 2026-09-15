# Triwave review 3 — lane 12 — launcher state

Baseline: `3740505b0107af9a83053fd523ae1ad30be36465` (`HEAD`). Scope: final adversarial, read-only review of launcher state and cross-scope interactions around account identity, connector proof, browser interaction mode, catalog readiness, and startup/runtime state. Read `docs/reviews/2026-09-15-triwave-review1-12.md`, `docs/reviews/2026-09-15-triwave-review2-12.md`, and the current launcher source in `launcher/electron/main.cjs`, `state.cjs`, `account-pool.cjs`, `browser-host.cjs`, `runtime.cjs`, `upgrade-readiness.cjs`, `launcher/src/App.tsx`, and `launcher/src/Overview.tsx`. Manual source review only. No tests, typechecks, scripts, runtime/browser actions, production actions, code edits, commits, or publication were performed.

Native4, Native4DEV, ZeroRisk4, their connector identities and public ABI pins were not changed or implicated.

## Result

**2 new concrete launcher-state defects: T3-12-1 and T3-12-2.**

Both are cross-scope invalidation omissions with a direct user-visible stale-proof consequence. They are distinct from T2-12-1 account selection and T2-12-2 logout: T3-12-1 is an interaction-mode transition, while T3-12-2 is an explicit per-account connector check failure.

## T3-12-1 — Manual proof survives the transition to Automatic mode

- **Classification:** new concrete defect; distinct transition and caller from the account-selection and logout roots.
- **Trigger:** Manual mode has `mcpSetupComplete === true` after `launcher:mcp-verify`. In Manual mode that flag records local runtime health while the returned check explicitly says connector selection remains a manual step (`launcher/electron/main.cjs:664-679`). The user then switches the interaction mode to Automatic through `launcher:browser-interaction-mode` (`:908-940`). The runtime configuration is changed and the state patch changes `browserInteractionMode`, but does not clear `mcpSetupComplete`, `setupVerifiedAt`, or `setupIdentityHash` (`:925-936`).
- **Consequence:** after the transition, `App.tsx:48-53` treats the old Manual-mode flag as current automatic tool proof, and `Overview.tsx:15-23` can mark the tool connection ready. Automatic connector verification has not run for the automatic route. The setup identity hash includes `browserInteractionMode` (`upgrade-readiness.cjs:6-12`), which shows that the mode is identity-sensitive, but the hash is not used by the current UI proof predicate.
- **Minimum correction:** invalidate or qualify MCP proof when changing interaction mode, especially when entering Automatic mode; require a fresh automatic connector verification before `currentToolProof`/Overview readiness becomes true. Preserve the existing Manual-mode wording and zero-risk behavior.

## T3-12-2 — Failed selected-account connector check leaves global proof ready

- **Classification:** new concrete defect; distinct direct path from selecting an account and from logout.
- **Trigger:** Automatic mode has `mcpSetupComplete === true` for the selected account. The user explicitly runs `launcher:account-check(id, true)` for that selected account. `AccountBrowserPool.checkAccount` first removes the account’s capability and connector cache, then on verification failure deletes the connector entry and rethrows (`launcher/electron/account-pool.cjs:216-233`). The IPC handler at `main.cjs:948` returns that operation without updating launcher state.
- **Consequence:** the selected account’s `connectorReady` becomes false in the account snapshot (`account-pool.cjs:88-97`), but the global persisted `mcpSetupComplete` remains true. `Overview.tsx:17-23` and `App.tsx:48-53` read the global flag and can continue to display the MCP/tool connection as verified. The next automatic turn’s account eligibility can reject the account because its connector cache is absent (`account-pool.cjs:356-367`), yet the launcher proof surface says ready.
- **Minimum correction:** when a connector check for the currently selected account fails, clear or qualify the global account-bound MCP proof and publish the resulting launcher state. A failed check for a non-selected account should remain per-account and must not invalidate a valid proof for the selected account without an explicit policy change.

## Bounded adversarial scenarios reviewed

1. Automatic proof → select another account: **repeat T2-12-1**, no T3 ID.
2. Automatic proof → logout: **repeat T2-12-2**, no T3 ID.
3. Manual proof → Automatic mode: **T3-12-1**, new.
4. Automatic proof → Manual mode: same mode-transition root as T3-12-1; refinement, no extra ID.
5. Selected-account connector check fails: **T3-12-2**, new.
6. Non-selected-account connector check fails: per-account cache is cleared without changing selected global proof; **rejected as no new defect**.
7. Bigger Context changes: catalog/picker proof is explicitly invalidated by `main.cjs:1196-1201`; MCP proof is not directly changed, but the inspected path does not establish a new connector/account consequence. **Known/optional boundary, no T3 ID.**
8. ZeroRisk Pro change: catalog readiness is reset in `main.cjs:898-905`; Manual-mode connector-selection semantics remain explicit. **No new launcher-state root.**
9. Runtime startup failure/not-configured: state invalidation remains covered by D13 and the first-wave review; **corrected repeat**.
10. Setup-core/setup-MCP publication: synchronous store update plus the existing snapshot/event callers remain the prior optional publication boundary; **optional, no new ID**.

## Repeats, rejected candidates, and limits

- Corrected/repeated roots: D03, D04, D06, D13, T2-12-1, and T2-12-2.
- Rejected/narrowed candidates: non-selected-account connector failure; Automatic→Manual as a separate ID; Bigger Context and ZeroRisk Pro as independent new MCP-proof defects.
- Optional improvement retained from earlier waves: publish the returned `setup-core` state immediately for every future direct caller, even though the current UI caller requests a fresh snapshot.
- Source review cannot prove live ChatGPT account identity, connector availability, native approval, schema loading, retained continuation, or every IPC timing interleaving. The findings are limited to the explicit source transitions above.

## Counts

- New concrete defects: **2** — T3-12-1, T3-12-2
- New finding IDs: **T3-12-1, T3-12-2 only**
- Repeats/corrected roots: **6**
- Rejected/narrowed candidates: **3**
- Optional improvements: **1**
- Known proof limits: **4**
- ABI/identity preservation findings: **0**
