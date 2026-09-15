# Independent blind review wave2 lane14

- Repository: `/Users/alex/Dev/nekodex`
- Baseline: `9925453`
- Review scope: unchanged source; browser tab and session ownership, exact selection, alternate/error paths, and cancellation.
- UTC start: `2026-09-15T20:35:23Z`
- UTC end: `2026-09-15T20:37:22Z`

## Inspected scope

- `launcher/electron/browser-host.cjs`
  - tab creation and initialization: `createTurnTab`, `createManualTurnTab`, `initializeManualTurnTab`
  - exact selection and presentation: `selectedTurnTab`, `selectTab`, `activateHomeSurface`, `syncViewVisibility`, `presentTurnView`, `presentPrimaryView`
  - ownership and cancellation: `heartbeatTurn`, `removeTurnTab`, `rememberUserCancelledTurn`, `closeTab`, `beginTurn`, `endTurn`, `beginManualTurn`, `cancelManualTurn`, `endManualTurn`
  - retained-tab matching: `exactRetainedTurnTab`, `precheckRetainedTurn`, `assertLiveConversationOwner`
  - cleanup and alternate browser surfaces: `createAuthView`, `closeAuthView`, `destroy`
- Direct callers checked for selection and cancellation routing:
  - `launcher/electron/account-pool.cjs`: `ownerForTab`, `selectTab`, `closeTab`, `beginTurn`, `endTurn`
  - `launcher/electron/control-server.cjs`: automatic and Manual turn start/end/cancel routes
  - `launcher/electron/main.cjs`: renderer IPC selection and close handlers

## Findings

None. Zero concrete reachable current defects met the requested threshold.

The reviewed paths preserve the relevant identity at the point where it matters:

- automatic retained reuse requires an exact conversation key, connector identity, ready status, and connector binding when applicable;
- turn heartbeats and end/cancel operations require the exact trace and helper PID;
- closing a running tab records the user cancellation before awaiting runtime cancellation, and late end delivery is handled through the closed-owner record;
- removing the selected tab chooses an existing tab from the same host registry and synchronizes visibility and the published snapshot;
- account-pool selection revalidates the captured tab after readiness and guards the account/revision transition before committing selection;
- Manual cancellation signals the exact trace/helper owner before releasing the tab, and later terminal delivery is classified through the manual terminal record.

No speculative future-only hardening, style issue, or known fail-closed limitation is reported as a bug. No source edits, tests, typechecks, scripts, runtime checks, commits, or delegation were performed.
