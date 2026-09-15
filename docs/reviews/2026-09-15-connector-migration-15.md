# Connector identity migration lane 15 — remaining active references

Scope: bounded `rg` of active `src`, `launcher`, `scripts`, and tests, excluding historical reports, release archives, built output, and dependencies. Baseline `d880b12`; this scan happened while other lanes were editing the shared tree. User steering sets synchronized generation 4: `Codex Native4`, `Codex Native4 DEV`, and `Codex Zero Risk4`. Lane 15 subsequently received write ownership of remaining test fixtures and `scripts/smoke-release.ts`. No tests were executed in this lane.

## Active replacements for parent integration

- `launcher/src/i18n.ts`: English, Chinese, and Japanese user-facing setup and Manual-mode copy still names `Codex Native3` or `Codex Zero Risk2` at lines 164, 337-339, 371, 375; 566, 739-741, 773, 777; 968, 1141-1143, 1175, 1179. Replace current identity instructions with Native4 / Zero Risk4. Keep the previous names only where describing explicitly retired connectors; migration copy should explain Native3, Native3 DEV, and Zero Risk2 as legacy too.
- `src/adapters/chatgpt-web/index.ts`: Manual-mode task cards at lines 578, 596, 618 direct the user to or report connection with `Codex Zero Risk2`; current cards need Zero Risk4.
- `src/setup.ts:294`, `launcher/electron/control-server.cjs:246`, `launcher/electron/main.cjs:483`: current Manual-mode error and snapshot literals need Zero Risk4. The snapshot should preferably use the canonical identity constant already owned by parent rather than another hardcoded value.
- `scripts/smoke-release.ts:72`: synthetic active release-smoke config currently uses Native3; migrate to Native4 if this smoke path is intended to exercise the current connector.

## Tests and fixtures that need coordinated update

- Full public ABI pin comments and digests: `tests/chatgpt-web-harness.test.ts:2738-2740` and `tests/zero-risk-mcp-lifecycle.test.ts:294-300`. These must identify the new Native4 / Zero Risk4 public contracts and receive focused digest updates after the #487 schema patch. During the initial scan, the Zero Risk comment had been edited by another lane toward Zero Risk3 while its old digest remained; that intermediate name must be corrected to Zero Risk4.
- Current identity assertions and fixtures appear in `tests/browser-worker-contract.test.ts`, `tests/runtime-layout.test.ts`, `tests/zero-risk-adapter.test.ts`, `tests/launcher-browser-host.test.ts`, `tests/launcher-helper-client.test.ts`, `tests/cli.test.ts`, `tests/retained-compaction.test.ts`, and `launcher/tests/runtime-host.test.cjs`, `browser-host.test.cjs`, `control-server.test.cjs`, `browser-helper-verifier.test.cjs`, `localization.test.cjs`, `logging.test.cjs`, `retained-visible-focused.test.cjs`, `runtime-supervisor.test.cjs`, `upgrade-download-focused.test.cjs`. Their old current-name expectations should follow the new identity where they assert selection, setup, runtime, or visible copy. Purely local log/compaction or generic string-handling fixtures may keep an arbitrary old string only if the case intentionally tests opaque user data rather than canonical identity.
- Other fixtures with old names but no apparent identity assertion: `tests/backend-review-regressions.test.ts`, `tests/compaction-browser-recovery.test.ts`, `launcher/tests/runtime-supervisor.test.cjs`. Review them as fixtures; prefer new canonical names when they model a current runtime.

## Intentionally legacy

- `src/config.ts` and `launcher/electron/connector-identity.cjs` are parent-owned. Their retired-name lists must retain Native3, Native3 DEV, and Zero Risk2 along with earlier aliases so old cached connector schemas are rejected or mapped with migration guidance. Include Zero Risk3 defensively as an unpublished intermediate alias; do not describe it as a connector published here. The source showed parent changes in progress during the initial scan.
- The retired input columns of mapping/rejection tables in `tests/browser-worker-contract.test.ts:198-202` and `launcher/tests/runtime-host.test.cjs:849-856` are deliberate legacy cases. Keep old strings in the legacy column while updating their expected current targets to Native4 / Native4 DEV / Zero Risk4. A Zero Risk3 input can be added defensively, labeled unpublished here. Older `Codex Native`, `Native2`, and unnumbered `Zero Risk` remain legacy evidence, not mass-replacement targets.
- `src/adapters/chatgpt-web/turn-execution.ts:179` says unnumbered “Codex Zero Risk MCP contract”; it is a mode description rather than an exact connector identity and needs no change.

## Lane 15 edits after write authorization

Current identity fixture strings were updated to Native4 / Native4 DEV / Zero Risk4 in these owned paths:

- `scripts/smoke-release.ts`
- `tests/cli.test.ts`, `zero-risk-adapter.test.ts`, `backend-review-regressions.test.ts`, `launcher-browser-host.test.ts`, `launcher-helper-client.test.ts`, `compaction-browser-recovery.test.ts`, `browser-worker-contract.test.ts`, `retained-compaction.test.ts`
- `launcher/tests/control-server.test.cjs`, `localization.test.cjs`, `logging.test.cjs`, `upgrade-download-focused.test.cjs`, `retained-visible-focused.test.cjs`, `browser-helper-verifier.test.cjs`, `runtime-supervisor.test.cjs`, `browser-host.test.cjs`

The mapping tables in `tests/browser-worker-contract.test.ts` retain older aliases in their input columns; only expected current targets changed. The malformed-control-request fixture in `launcher/tests/control-server.test.cjs` now uses Native4 as opaque malformed data. A bounded manual diff review found only these identity-string substitutions in lane-owned paths, and a read-only search found no remaining Native3, Zero Risk2, or Zero Risk3 strings in them. Excluded tests and runtime source remain with their assigned lanes or parent. No historical report, archived release, or real ChatGPT connector was modified.
