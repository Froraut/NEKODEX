# Four-wave review 1, lane 03 — core connector identity migration

Baseline: `3a66157a8943a80bbbe299699cc96bec82721ba1`. Scope: `src/config.ts`, its direct setup/runtime callers, and the two required result documents. Manual source review only; no code changes or automated verification.

## Potential findings: 0

No `R1-3-n` finding is justified for the canonical Native4, Native4 DEV, and Zero Risk4 identities on the inspected paths. `src/config.ts:24-39` recognizes the older exact names and maps the three modes to the generation-4 targets. Runtime `loadConfig` rejects retired names through `parseConfig` (`src/config.ts:355-358, 444-467`); only `loadConfigForSetup` migrates a persisted copy (`src/config.ts:361-399`). The active tunnel identity is compared with the raw persisted `appName` before reuse (`src/setup.ts:131-140, 531-534, 966-969`), so migrating a loaded copy does not silently skip that refresh. Inactive identities alone do not refresh the active tunnel, as documented. Setup writes the active tunnel and identity in the same transaction with rollback (`src/setup.ts:670-775, 957-980`).

## Optional improvement / boundary, not counted as a defect

- Trigger: a user has an Automatic custom connector name in a saved config and reruns the normal `setup` flow. `loadConfigForSetup` leaves a nonlegacy custom name intact (`src/config.ts:373-393`), but `baseConfig` unconditionally selects the profile's canonical identities (`src/setup.ts:258-269, 467-476`). Consequence: that setup targets Native4 rather than retaining the custom name. Counterevidence: generation-4 schema cannot safely reuse an existing custom ChatGPT App ID; the connector-generation4 result explicitly requires a distinct new App ID/name for custom cached connectors, and the task asks to retain the canonical three identities. If a supported custom-name setup workflow is desired, it needs its own explicit new-identity input and documentation, not a silent reuse of the old cached connector. This review does not claim a canonical migration defect from this behavior.
- Known evidence boundary: source-level migration and the existing bounded checks in `2026-09-15-connector-generation4-results.md` do not prove ChatGPT loaded the new schema or that a live native approval succeeded. The tunnel-upstream report also limits its checks to local/synthetic paths; unavailable account-side proof is not a code finding.

Reviewed files: `src/config.ts`, relevant sections of `src/setup.ts`, direct caller locations (including `src/cli.ts`), and `docs/reviews/2026-09-15-connector-generation4-results.md` / `docs/reviews/2026-09-15-tunnel-upstream-results.md`. No entire-repository audit was performed.
