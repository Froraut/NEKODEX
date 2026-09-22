# Architecture refactor follow-up — September 22, 2026

Reviewed the completed `a7b272b` refactor for remaining feature coupling and adjacent failure paths. This follow-up uses the existing branch and PR; it does not repeat the completed 16+16 agent waves.

## Findings and changes

| Finding | Applied change | Evidence |
| --- | --- | --- |
| `App.tsx` still owned the complete browser toolbar, tabs, sign-in controls and Manual prompt countdown. | Extracted `BrowserSurface.tsx` and `ManualTurnGuide.tsx`; shared `IconButton` moved to `launcher-ui.tsx`. The shell retains native-view placement and navigation. Both Chrome import buttons and their handler now explicitly honor lifecycle transitions. | Renderer types/build, keyboard tab selection/close, passkey recovery, account-scoped workspace failure and Manual prompt scenarios. |
| An old login cancellation receipt could replace a newer flow; old action failures could similarly surface against the new flow. | Login actions capture the observation revision and discard obsolete success/error results. | Deferred cancellation success and failure against a newer flow. The success case failed on the original revision. |
| A cancellation receipt with unchanged phase/identity fields retired polling without restarting it. | An explicit polling attempt changes when accepting a cancellation receipt; older reads are retired before accepting it. | A stale status read is ignored, then a fresh poll observes settlement. Failed on the original revision. |
| Start failure followed by snapshot failure left the UI ready to start another login despite unknown host ownership. | Mark status unavailable until the user successfully refreshes the host snapshot, preserving the original actionable error. | Controller regression failed on the original revision. Mounted Accounts confirms disabled start, one submitted start, and successful snapshot recovery. |
| The status-retry control could be above the visible portion of a long Accounts page. | Reuse the same recovery callback directly in the affected account cards with existing localized copy. | Observed at 1280px; keyboard retry returns the card to ready without starting another login. |
| Native terminal interpretation remained coupled to stream forwarding and could interpret frames after `[DONE]`. | Extracted the bounded SSE/JSON inspector into `native-terminal-inspector.ts`; terminator ends interpretation while all original bytes still pass through. | Split terminator/CRLF regression failed before the change; exact-byte forwarding, valid earlier terminal and missing-terminal behavior pass. |
| A throwing unclean-close diagnostic callback could break an otherwise completed response. | Isolate diagnostic exceptions from stream closure. | Real ReadableStream reset after `[DONE]`, callback throws, consumer still receives complete original bytes. Pre-terminal reset controls still reject. |

`App.tsx`: 2,040 → 1,490 lines. `native-response-body.ts`: 361 → 184 lines. These measure separated responsibilities, not reduced total code or an application performance improvement. The extension guide documents the new boundaries.

## Focused verification

- `node --test --test-name-pattern='login|failed start|same-state' launcher/tests/lane15-account-controllers.test.cjs`: 7 cases passed, including existing cancellation, polling failure and recovered-start behavior.
- `bun test tests/native-stream-inspection.test.ts tests/native-transport-terminal-contract.test.ts tests/native-wave3-receipts.test.ts --test-name-pattern='telemetry stops|terminal before|diagnostic callback|clean SSE EOF|missing terminal EOF|oversized usage'`: 6 cases passed, 37 assertions.
- `bun test tests/native-passthrough.test.ts --test-name-pattern='an upstream reset'`: 3 cases passed, including failure before completion and a literal marker embedded in JSON. Its disabled telemetry storage produced the expected dropped-storage diagnostics; this is transport proof, not durable telemetry proof.
- `node --test --test-name-pattern='refactor follow-up|refactor workspace error' launcher/tests/architecture-refactor-ui-preview.cjs`: 3 mounted scenarios passed. The login scenario was rerun after adding the inline retry button and passed using keyboard activation.
- `node --test --test-name-pattern='tab selector uses roving arrows|passkey terminal error' launcher/tests/two-wave-ui-preview.cjs`: 2 mounted scenarios passed.
- Core and renderer TypeScript checks passed. The renderer check caught missing presentation/type imports during extraction; those were corrected before the successful build and UI runs. Final renderer bundle: `index-C5P8VCA9.js`, 103 modules. Existing bundle-size advisory remains.
- Inspected 760px Manual confirmation and 1280px Accounts recovery captures; no horizontal overflow or page errors in these scenarios. Task fixture browsers and ephemeral HTTP servers close after each run. No Electron/production restart was needed for these renderer changes.

New regression cases exercise real production hooks through the existing focused harness or real stream functions; mounted tests use synthetic IPC and a fresh compiled renderer. Four new failure assertions were observed on the starting code before fixes. Existing source-layout assertions were retargeted only for moved BrowserSurface statements; unrelated baseline-stale assertions were not used as proof or broadly rewritten. No full suites were run.

## Delivery boundary

Source branch: `codex/architecture-refactor-20260922`, draft PR #20, stacked on `codex/app-improvements-20260922`. Version remains `5.9.0-nekodex.5`. No installed-app replacement, packaging, release publication, account mutation or live provider submission is part of this follow-up.
