# NEKODEX mixed-model experiment review wave 1, lane 16 (identity)

- Baseline: `9925453`
- Review type: manual source review only
- UTC start: `2026-09-15T20:28:40Z`
- UTC end: `2026-09-15T20:31:12Z`

## Inspected scope

- `src/config.ts`: connector constants, legacy-name migration, `loadConfigForSetup`, `parseConfig`, interaction identity resolution, tunnel selection, and provider config projection.
- `launcher/electron/connector-identity.cjs`: connector validation, legacy detection, setup mapping, and strict runtime-name validation.
- Direct identity callers in `launcher/electron/runtime.cjs`, including `runtimeConfigSnapshot`, `mcpConnectorName`, and `browserConnectorName`.
- Required guidance: `skills/nekodex-regression-prevention/SKILL.md` and `/Users/alex/.codex/skills/right-size-test-runs/SKILL.md`.

No other wave reports were read. No source edits, tests, typechecks, scripts, live actions, commits, or delegation were performed.

## Finding 1 — whitespace-padded connector identities bypass config migration checks

- Severity: Medium
- Classification: Bug
- Confidence: High
- Exact locations: `src/config.ts:443-467` (`parseConfig`), `src/config.ts:373-392` (`loadConfigForSetup`); differing behavior is exposed by `launcher/electron/connector-identity.cjs:14-18,40-49` (`validateConnectorName`, `requireCurrentRuntimeConnectorName`) and `launcher/electron/runtime.cjs:1023-1045`.
- Executable trigger: persist an otherwise valid v3 automatic config with `appName` and `automaticAppName` set to `"Codex Native3 "` (or another retired name with a trailing space), then load it through the TypeScript runtime path. `parseConfig` checks the raw strings against the exact legacy list, so the padded value is accepted and projected to `chatgptWeb.appName` at `src/config.ts:623`. In the launcher path, the same value is trimmed by `validateConnectorName`; `runtimeConfigSnapshot` also detects it with `name.trim()` and `mcpConnectorName` rejects it as legacy.
- Impact: the persisted identity has no single meaning across layers. A non-launcher/runtime consumer can attempt to find the literal connector name with the whitespace and fail to match the actual retired connector, while the Electron launcher treats the same bytes as a retired identity and blocks MCP verification. The setup migration branch also misses the padded value because `loadConfigForSetup` calls `isLegacyChatGptConnectorName` before trimming. This can leave an invalid or stranded configuration instead of deterministically migrating or rejecting it.
- Smallest fix: canonicalize connector fields at the config boundary before all legacy and equality checks (`appName`, `automaticAppName`, and `manualAppName`), or reject any non-canonical value where `value !== value.trim()`. Use the same canonicalized value in the returned `AppConfig` and migration path so the TypeScript and Electron identity helpers receive identical strings. Do not broaden the fix to arbitrary connector renaming.

## Design boundary

The ability to carry a non-reserved custom automatic connector name is intentional in the reviewed code: `parseConfig` permits names other than the reserved current, manual, and legacy names, and the launcher preserves such names after validation. I did not classify that as a bug. The review found no second independent concrete bug within the requested identity migration/config-invalid-state scope.

## Verification limits

This is a manual source review. Per the requested scope, no focused test or executable check was run. Parent handles adjudication and any focused test.
