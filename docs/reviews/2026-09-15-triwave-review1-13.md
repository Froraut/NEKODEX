# Triwave review 1, lane 13 — renderer App

HEAD: `3740505b0107af9a83053fd523ae1ad30be36465` (`3740505`)
Scope: `launcher/src/App.tsx` and its direct renderer IPC/state callers. Read-only source review. No tests, typechecks, scripts, broad audits, runtime/account checks, production actions, or code edits were run. The requested Native4 / Native4 DEV / ZeroRisk4 connector ABI and identity were not changed.

## New concrete findings

### T1-13-1 — MCP wizard advances local step before persistence succeeds (P2)

**Trigger.** While the MCP wizard is open, the user changes steps and the `launcher:set-mcp-step` IPC/state write rejects, for example because the state file cannot be written or the main process has become unavailable. The same ordering also applies to the Previous button and the stepper buttons.

**Source evidence.** `McpSurface.move()` calls `setStep(next)` before awaiting `api!.setMcpStep(next)` at `launcher/src/App.tsx:1598-1601`. The failure handler in `safeMove()` only displays the error and does not restore the prior local step at `:1602-1609`. The direct preload method invokes the main-process handler at `launcher/electron/preload.cjs:48-49`; that handler validates and persists through `stateStore.update({ mcpGuideStep: step })` at `launcher/electron/main.cjs:844-847`, so the IPC can fail before the requested step is committed.

**Consequence.** The mounted renderer can show the next wizard page and its associated controls/media even though the persisted `mcpGuideStep` remains on the previous page. A retry, navigation away and back, or renderer refresh can then jump back to the saved step, making the UI claim a transition that did not complete. Since `move()` is also used by the stepper and footer navigation (`App.tsx:1672-1675,1814-1817`), the error path is shared across all step changes.

**Minimal correction.** Keep the previous step until `setMcpStep(next)` resolves, or restore it in the catch path. If preserving optimistic UI is preferred, capture `previousStep` and call `setStep(previousStep)` when persistence rejects. The state returned by `setMcpStep` should remain the source for `updateState` after success.

**Counterevidence and limit.** Normal writes return the updated state and keep the local and persisted steps aligned. `busy` prevents step changes while another operation is running, but `safeMove()` does not mark a step transition busy itself; this finding does not depend on a concurrent click. The failure trigger is source-derived and was not live-reproduced, per the task restriction. This is a renderer consistency defect, not a connector ABI or identity issue.

## Repeats and known adjudicated paths

- **D06 / prior smoke-evidence finding:** fixed in the current source. `smokePassedForState()` derives the renderer flag from current-version state at `App.tsx:44-46`; state events, explicit state updates, initial hydration, and metadata refresh all replace the value rather than OR-ing an older true value (`:91-100,132-140,172-180,215-223`). The current main snapshot also derives smoke status from persisted current-version evidence (`launcher/electron/main.cjs:468-470,505`). No new D06 defect is counted.
- **D13 / prior historical MCP proof finding:** fixed for the current startup-failure path. `currentToolProof()` rejects automatic production tool proof while the current `runtime-start` operation is failed (`App.tsx:48-53`), and current state invalidation clears `mcpSetupComplete` on failed/external startup through the main/state callers documented by the adjudication. The historical `setupVerifiedAt` timestamp remains visible by design (`App.tsx:1505-1507`); it is presented as a timestamp rather than current proof. No new D13 defect is counted.
- The earlier renderer refresh observation that full completion snapshots are larger than the fields applied remains an optional efficiency improvement, not a correctness defect. The current refresh path preserves state revisions and operation generations (`App.tsx:74-107`) and completion/verification callers use it to obtain credential and capability metadata (`:1624-1650`).
- Inactive-mode credential selection remains a known clean path: Settings asks the main process whether the target mode has credentials before opening the MCP wizard, and the wizard passes the selected mode into `setupMcp` (`App.tsx:2014-2021,841-851,1624-1629`; `main.cjs:908-940,797-828`). No wrong-mode finding is counted.

## Counts

- New concrete defects: **1** — `T1-13-1`.
- Repeats of adjudicated/fixed defects: **0 counted as new** — D06 and D13 were inspected and remain addressed on the current paths.
- Rejected/unsupported candidates: **0**.
- Optional improvements: **1** — completion snapshot payload/filtering remains a performance refinement only.
- Known limitations: **1** — the persistence-failure branch was source-traced but not runtime-reproduced, as required by the task.

Only `docs/reviews/2026-09-15-triwave-review1-13.md` was written. No source file, connector identity, ABI pin, commit, or production state was changed.
