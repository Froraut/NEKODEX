# NEKODEX mixed-model experiment review wave 1, lane 14

- Baseline: `9925453bd51e61c7b398abec12ec0da3aca3d3af`
- Review type: manual source review only
- UTC start: `2026-09-15T20:29:01Z`
- UTC end: `2026-09-15T20:31:44Z`

## Inspected scope

Primary source reviewed:

- `launcher/electron/browser-host.cjs`, with emphasis on `BrowserHost.selectTab`, `activeView`, `selectedTurnTab`, `closeTab`, `removeTurnTab`, `cancelManualTurn`, `beginTurn`, `endTurn`, and the turn ownership maps.

Direct callers inspected only as needed:

- `launcher/electron/account-pool.cjs` for account and tab ownership routing.
- `launcher/electron/control-server.cjs` for the authenticated manual cancellation endpoint and turn control dispatch.
- `launcher/electron/main.cjs` for the production `cancelTurn` wiring and browser tab IPC handlers.
- `src/launcher-browser-host.ts` and the directly related manual-turn adapter path for the endpoint contract.

`launcher/electron/browser-control-server.cjs` is absent at this baseline; the repository uses `launcher/electron/control-server.cjs`. No source edits, tests, typechecks, scripts, live actions, commits, or delegation were performed. Other wave reports were not read.

## Findings

### 1. High — manual tab close destroys a running turn after cancellation failure

- **Exact location:** `launcher/electron/browser-host.cjs:1656-1674`, `BrowserHost.closeTab`.
- **Trigger:** In Manual mode, start a turn, reach `tab.status === "running"`, then close its browser tab while the production `cancelTurn` callback rejects or times out. The callback is wired in `launcher/electron/main.cjs:1294` to `runtimeSupervisor.cancelBrowserTurn(traceId)`, so a stopped/unavailable launcher-owned runtime is an executable trigger.
- **Current behavior:** `closeTab` catches and only logs the cancellation error at lines 1663-1671, then unconditionally calls `removeTurnTab(tab, true)` at line 1673. The tab is therefore removed even though the runtime never acknowledged cancellation.
- **Impact:** The exact browser document owned by the still-running manual turn is destroyed. The runtime/helper can continue or remain active without its browser surface, while the launcher has already published a terminal cancellation to manual waiters. This breaks exact turn/session ownership and can leave an orphaned active request that cannot be resumed or observed through its original tab.
- **Smallest fix:** Match the automatic branch’s failure boundary: if `cancelTurn` rejects, retain the running tab and rethrow/report the cancellation failure; remove it only after cancellation is acknowledged or the normal `/manual/end` handshake releases that exact owner. Do not signal terminal cancellation before the cancellation outcome is known unless a separate pending-cancellation state is retained.
- **Confidence:** High. The failure path is unconditional and directly visible in the reviewed source; no timing assumption is required.

### 2. High — authenticated `/v1/manual/cancel` removes the browser owner without cancelling the runtime turn

- **Exact location:** `launcher/electron/browser-host.cjs:2312-2319`, `BrowserHost.cancelManualTurn`, dispatched by `launcher/electron/control-server.cjs:101-107,262-265`.
- **Trigger:** With a Manual mode turn in `running` state, send an authenticated `POST /v1/manual/cancel` containing that turn’s `traceId` and `helperPid`. The endpoint calls `host.cancelManualTurn(...)` directly.
- **Current behavior:** `cancelManualTurn` signals the launcher-side terminal state and removes the tab, but never invokes the host’s `cancelTurn` callback. The production callback exists on the host (`main.cjs:1294`) and is used by `closeTab`, but this control endpoint bypasses it.
- **Impact:** The control request reports `{ ok: true, cancelledByUser: true }` while the runtime/browser turn may still be active. Its exact browser surface has already been closed, so subsequent runtime work can continue without the owned tab and the cancellation contract is false at the runtime layer.
- **Smallest fix:** Make `cancelManualTurn` asynchronous and await the same targeted runtime cancellation callback before removing a running tab; update the control-server dispatch to await it. Preserve the owner on callback failure, as in finding 1. If this endpoint is intentionally restricted to a pre-runtime handoff phase, reject it once the tab is running instead of returning successful cancellation.
- **Confidence:** High for the launcher contract. The endpoint is explicitly named and returns success, while the method has no runtime-cancellation call. Whether an external caller currently exercises this endpoint in every deployment is a usage question, not needed for the state inconsistency.

## Design limitation / non-finding

The account pool deliberately separates visible selection from turn ownership: `AccountBrowserPool.ownerForTab` and `ownerForTrace` resolve the exact account host, while `selectTab` changes the selected account before presenting that host’s tab. A stale renderer tab ID is rejected if the tab no longer exists, and a concurrent selection change is guarded by `selectionRevision`. I found no concrete current bug in exact tab/account selection in the inspected path.
