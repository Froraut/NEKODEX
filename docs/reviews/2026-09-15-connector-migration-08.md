# Connector migration lane 8 — architecture documentation

Scope: documentation for the coordinated #487 connector identity migration at baseline
`d880b12`. Changed only `docs/architecture.md` and the new
`docs/connector-identity-migration.md`.

- Defined the public generation-4 names `Codex Native4`, `Codex Native4 DEV`, and `Codex Zero Risk4`.
  Marked `Codex Native3`, `Codex Native3 DEV`, and `Codex Zero Risk2` as legacy alongside older
  aliases. `Codex Zero Risk3` is recognized defensively as a local alias; it was not published
  here. The earlier MCP migration document remains a record of its prior contract.
- Specified a **new ChatGPT plugin App ID** per mode and its tunnel. Renaming or refreshing a
  legacy App ID is not the migration; cached `tools/list` schemas and live account selection
  require separate evidence.
- Documented #487 optional outer native command fields and preserved Codex ownership of
  sandbox and approval decisions. The exact active outer schema governs forwarding; unsupported
  fields must fail explicitly rather than disappear. Generic exact tool invocation remains an
  available path when its live schema supports additional arguments.

Manual review covered the changed documentation, `src/config.ts`,
`launcher/electron/connector-identity.cjs`, the current `codex_exec` and generic-tool handlers,
the prior MCP migration document, the upstream lane 1 review, and the live #487 issue body.
No tests, typechecks, builds, benchmarks, connectors, account changes, commits, or releases were
performed in this lane. The parent implementation and any end-to-end approval outcome remain
separate and unverified here.
