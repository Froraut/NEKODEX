# Connector migration lane 5 — browser selector

Baseline: `d880b12`. Scope: `src/adapters/chatgpt-web/browser-worker.ts` only; parent owns canonical names and legacy mappings in `src/config.ts`.

The selector already requires one exact connector menu row for `this.config.appName` and verifies the selected composer pill's exact `data-keyword`. The `@codex` mention query is a search trigger, not an identity. No Native3, Native3 DEV, or Zero Risk2 literal was hardcoded in this worker.

Changed the missing-row path to recognize a legacy menu row only when `currentChatGptConnectorName(legacyName)` maps it to the configured identity. This now reports the migration message for old Native3 in Native4 mode, Native3 DEV in Native4 DEV mode, and Zero Risk2 in Zero Risk4 mode, plus the older mode-matched aliases. The parent mapping also recognizes Zero Risk3 defensively as an alias for Zero Risk4; Zero Risk3 was never published here. The worker rejects these known mismatches before the optional catalog refresh. A visible DEV connector still gets the separate production-versus-DEV diagnostic when production Native4 is missing. Exact row selection and selected-pill verification remain unchanged; old connectors are never renamed or refreshed by this path.

Manual review: inspected config mapping, menu lookup, mismatch branch, optional refresh, and selected-pill proof. No tests, typechecks, suites, benchmarks, real-account operations, commits, or dependency changes were run in this lane, per parent instruction. Parent integration should retain `src/config.ts` mapping of `Codex Zero Risk2` and defensive alias `Codex Zero Risk3` to `Codex Zero Risk4`; the worker relies on that function for mode-specific rejection.
