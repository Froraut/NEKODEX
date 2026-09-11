# Upstream Pro feature attribution and fork validation

The optional automatic Pro model preference is adapted from
[PR #439](https://github.com/miuuyy/codex-chatgpt-web/pull/439) by
**JulianZJN (Julian)**, commit `039c385f09ba43eac398259eb6360ffe02ede75e`
(authored 2026-09-11). Contributor identity from the upstream commit:
`Julian <148066842+JulianZJN@users.noreply.github.com>`.

The Pro retry-date diagnostic is informed by
[PR #432](https://github.com/miuuyy/codex-chatgpt-web/pull/432) by **gmoroz**,
commit `5b8face7b97f066da8e5fe40fbfcc4d7c0e0a3c8` (authored 2026-09-11).
Contributor identity from the upstream commit: `gmoroz <12345hasek@gmail.com>`.
The fork's tooltip extraction is independently narrowed to a tooltip explicitly associated
with the exact Pro control, so unrelated chat text cannot become a quota diagnostic.

Both current PR descriptions and diffs were retrieved and reviewed during integration.
The PR #439 config, launcher, browser verification, and test changes were applied as scoped
patches; incompatible hunks were adapted around the fork's independent `extraHighAvailable`
and startup/login error handling. The selection defaults to Follow ChatGPT, accepts only
`5.6`, `5.5`, and `6`, freezes the preference per automatic Pro request, and preserves separate
retained conversation identities for each pin. Native, manual, and non-Pro requests retain
their previous routing. No context-limit or local-tool capability increase is introduced.

Independent fork review corrected additional edge cases in the submitted PR: changing a pin
must not reset logical cancellation, replay, or retry identity. Only retained browser history
uses the pin. Switching away releases the former history while retaining completed logical
responses; switching back therefore starts with full canonical history. Concurrent requests
still share the same owner gate. DEV preference saves do not inspect the production launchd
service, and malformed or unreadable preferences fail before adapter creation.

The Pro-limit fixture distinguishes the author's observed retry wording from synthetic
accessibility linkage. The extractor accepts only a unique visible Pro row's explicitly linked,
visible tooltip, returns the date sentence alone, and keeps the original terminal error when
attribution is unproven. See [tooltip fixture evidence](../tests/fixtures/pro-retry-tooltip.md)
for headless Chrome fixture checks and the unverified live-account boundary.

Browser evidence and its author-reported live-test boundary are documented in
[Pro model selection](pro-model-selection.md). All fixtures are sanitized. New fork tests
run without connecting to a live ChatGPT account, and passing them does not claim account,
installed Codex, or MCP acceptance.

## Reproduction

```bash
bun test tests/pro-model-selection.test.ts tests/pro-model-identity.test.ts tests/model-contract.test.ts tests/pro-retry-hint.test.ts tests/pro-retry-hint-worker.test.ts tests/runtime-layout.test.ts tests/cli.test.ts tests/server-lifecycle.test.ts
bun run typecheck
cd launcher
bun test tests/localization.test.cjs tests/renderer-wiring.test.cjs tests/runtime-host.test.cjs tests/runtime-supervisor.test.cjs
bun run typecheck
```

Before implementation the focused model/selection suite had **21 failures** (6 passes): pins
were ignored and a changed version or effort did not block send. Integration makes these
regressions pass. Final combined gate results are recorded in the release review.
