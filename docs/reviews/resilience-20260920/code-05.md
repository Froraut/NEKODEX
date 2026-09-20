# Code review 05 — browser transport recovery

Manual review only. Scope: `src/adapters/chatgpt-web/browser-worker.ts`,
`src/adapters/chatgpt-web/launcher-helper-client.ts`, and
`src/launcher-browser-host.ts`, with launcher control handlers read only to confirm ownership
semantics. No tests, builds, app/UI driving, account access, network calls, or source edits were
performed.

## Findings

### 1. High — a real CDP disconnect bypasses the same-page rebind path after submission

- **Exact code:** `src/adapters/chatgpt-web/browser-worker.ts`,
  `waitForSubmissionAcceptedWithRecovery` at lines 3694–3734,
  `waitForNewAssistantTurn` at lines 3078–3152, and the final response observation loop at
  lines 5440–5485 and 5674–5685. The recovery callback ultimately reaches
  `rebindLauncherPage` at lines 4990–5050.
- **Observed:** all three recovery gates require
  `ChatGptBrowserObservationTimeoutError`. Playwright operations that reject immediately because
  the CDP transport, browser, context, page, or target closed do not have that type. Before the
  assistant is bound they are rethrown at lines 3145 and 3718. During final observation they skip
  the timeout-only catch at line 5444, then skip the TypeError-only retry at line 5680. The existing
  rebind implementation is therefore reachable for an unresponsive live CDP session, but not for
  an actual disconnected session.
- **Failure trigger:** after ChatGPT accepts a prompt, the launcher-owned page remains alive but
  Playwright's `connectOverCDP` transport drops (for example, a transient debugger WebSocket
  disconnect). The next DOM read rejects immediately with a closed-target/browser error. The turn
  is reported failed and `/v1/turn/end` releases the exact tab even though the model may still be
  running and the same launcher surface can be reacquired. This can discard a successful long-turn
  result and, for tool-bearing turns, separates browser observation from the still-owned tool work.
- **Proposed fix and ownership:** make `browser-worker.ts` own one narrow
  `isRecoverableLauncherTransportDisconnect(error)` classifier. At the three post-acceptance
  observation boundaries, route only proven Playwright transport-disconnect/closed-session errors
  through the existing `recoverObservation`/`rebindLauncherPage` budget. Preserve the exact
  `(traceId, helperPid, surfaceId)` lease, close any still-addressable old Playwright connection,
  reacquire that same `surfaceId`, revalidate the operational viewport and current ChatGPT
  document, then rebuild locators from stable turn IDs. Do not retry provider errors, user tab
  closure/cancellation, navigation to an unauthenticated or different conversation, or errors after
  the launcher no longer confirms the exact owner.
- **Inference:** the launcher surface survives an isolated Playwright transport loss because it is
  Electron-owned and selected by stable target ownership. That is the design expressed by the
  current rebind code; this review did not inject a live disconnect.

### 2. High — Automatic-mode control mutations have no ambiguous-ack reconciliation

- **Exact code:** `src/launcher-browser-host.ts`, `notifyLauncherTurn` at lines 704–780; direct
  callers are `BrowserWorker.runExclusive` start/heartbeat/end at
  `src/adapters/chatgpt-web/browser-worker.ts` lines 4719–4822 and viewport-refresh rebind at lines
  5019–5028. The same file already supplies the intended ownership pattern for Manual mode in
  `reconcileLauncherManualMutation` at lines 545–565.
- **Observed:** `notifyLauncherTurn` sends each `start`, `heartbeat`, or `end` mutation exactly once.
  A timeout, reset, or malformed/missing response is converted to a generic control-channel error;
  it never distinguishes "request was not applied" from "launcher committed it but the reply was
  lost." The launcher handler is owner-keyed: repeating `start` for the same live
  `(traceId, helperPid)` returns the existing tab, heartbeat validates that exact owner, and `end`
  has a closed-owner acknowledgement path. Manual-mode mutations already retry the identical
  owner-keyed request once for this reason.
- **Failure trigger:** the control server commits `start` but its response is lost. `runExclusive`
  never receives `surfaceId`, never starts heartbeats, and cannot enter its release `finally`; the
  launcher owns a running tab until bootstrap/lease expiry cancels it. A lost viewport-refresh
  heartbeat reply aborts rebind after the old CDP connection has already been closed. A lost `end`
  reply can turn an otherwise completed result into a control error (`!originalError` at line 4818)
  even though the launcher already retained or released the conversation.
- **Proposed fix and ownership:** let `src/launcher-browser-host.ts` own an Automatic mutation
  reconciler, parallel to the Manual one, that retries the exact same payload once only after an
  ambiguous transport/ack failure. Validate the full expected acknowledgement on both attempts.
  Keep the launcher authoritative for idempotency and exact-owner checks: `start` must return the
  existing lease only when conversation metadata also matches; heartbeat must confirm the same
  owner; `end` must return a stable terminal receipt without consuming its closed-owner evidence on
  the first replay. `browser-worker.ts` should consume the reconciled result and must not allocate a
  new trace or surface as recovery.
- **Inference:** the retry is safe only if the launcher's closed-owner/end receipt remains replayable
  for the bounded reconciliation window. The current handler deletes that receipt when serving the
  first duplicate end, so the parent lifecycle owner must coordinate both client retry and launcher
  receipt retention rather than adding an unconditional client loop.

No third actionable finding met the evidence bar in this lane.
