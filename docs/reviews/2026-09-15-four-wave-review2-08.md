# Four-wave review, wave 2 lane 8 — account identity and allocation

Frozen source `3a66157a8943a80bbbe299699cc96bec82721ba1`. Manual read-only trace of `account-pool.cjs`, direct control-server/browser-host calls, adapter identity propagation, and R1 lane 8. No tests, typechecks, scripts, account actions, source edits, installation, or publication. This report is the only saved artifact.

## New potential defect (1)

### R2-8-2 — Closing a tab during cross-account selection leaves a changed home after navigation fails

- **Trigger:** The UI selects a tab owned by B while A is selected; the tab closes or is released after `ownerForTab` resolves it but before `selectAccount(B)` finishes awaiting B's readiness (`account-pool.cjs:281-290,181-195`). A completed/reclaimable tab can be removed by `browser-host.cjs:2484-2486` or `:1656-1687` in that interval.
- **Path and consequence:** `selectAccount` persists B and writes its home descriptor before `selectTab` checks that the target tab still exists (`account-pool.cjs:186-195,287-290`; `browser-host.cjs:1594-1602`). The latter throws “Browser tab does not exist,” but selection is not rolled back: a failed tab click switches the selected account/home identity. `main.cjs:542` and `launcher/src/App.tsx:1084-1103` expose this route to the tab strip.
- **Counterevidence/limit:** A stable tab selects normally. `selectAccount` rolls back its own descriptor-write failure (`:188-193`), but that rollback ends before the later tab selection. This is a narrow asynchronous interleaving, not a demonstrated frequent UI failure or a turn-owner migration; exact running turn ownership remains in the original host.

## Optional / intended-mode boundary (1)

### R2-8-1 — Manual model switch can bind a task's new conversation to another account

- **Trigger:** An automatic turn for task T has persisted `account-thread:T` affinity to account A. With no retained tab for the next Manual conversation, the user selects account B and switches to Manual ZeroRisk4 (which requires the selected visible profile). The Manual conversation key changes with model/reasoning and execution namespace (`src/adapters/chatgpt-web/conversation-key.ts:29-42`, `index.ts:206-211,433-437`), so its key has no existing A affinity.
- **Path and consequence:** The automatic adapter passes the stable task routing key (`index.ts:691,762`), but Manual `zeroRiskManualControl.start` passes only the conversation key (`index.ts:581-587`; `control-server.cjs:194-201`). `account-pool.cjs:413-426` resolves the new Manual turn from B's selection, without consulting T's task affinity, and `:433-442` persists its conversation key under B. The task's automatic affinity remains A, so the same task now has Manual history on B and automatic history on A; returning to automatic routing uses A. The Manual turn itself can work on B. This is split task/account continuity, not an assertion that readiness flags imply a failed turn.
- **Counterevidence/disposition:** If the Manual conversation key is already bound to A, `:419-426` enforces it; if A remains selected, the new key binds to A. Manual mode deliberately operates on the visible profile (`:411-412,423`), and active turns block interaction-mode changes (`:296-298`). Changing interaction mode can itself change the execution namespace (`index.ts:198-211`), so a later automatic key generally differs: no unconditional ownership-conflict error is claimed. The split follows explicit selection of B; treat it as an optional continuity/UX concern, not a new runtime defect. No live transition was reproduced. Preserve exact ownership and Native4/ZeroRisk4 identities; no public schema proposal follows from this concern.

## R1 challenge and boundaries

- **Repeated candidate, not new:** R1-8-1 correctly identifies `account-pool.cjs:327-328` bypassing unpinned eligibility (`:314-325`) for a task-pinned *new* automatic turn. `:389` and `browser-host.cjs:2322-2343` separately guard exact retained conversations. Keep R1-8-1 as the single first-wave candidate, with the pinned continuation exception explicit.
- **Rejected extension of R1-8-1:** Its suggested downstream browser/model/connector failure is conditional, not established merely by absent/false pool readiness flags. The lease creates a fresh tab (`browser-host.cjs:2424-2436`); selected primary leniency (`account-pool.cjs:317`) and capability evidence rules mean a pool filter result alone cannot prove runtime rejection. The source does prove skipped *early* eligibility and different account admission; it does not prove a live generation-4 failure or the precise later error.
- **Known limitation:** Live plugin creation/schema load, native approval, and a real retained-account transition remain outside the frozen source review. `endTurn` is directly called by `control-server.cjs:303-315`, routes through `account-pool.cjs:407-409`, and releases or retains via `browser-host.cjs:2448-2489`; absence of an additional direct IPC listener is no missing-settlement finding.

Counts: **1 new potential defect (R2-8-2); 1 optional concern (R2-8-1); 1 repeated R1 candidate; 1 rejected unconditional R1 consequence; 1 known live-proof limitation.** Source unchanged.
