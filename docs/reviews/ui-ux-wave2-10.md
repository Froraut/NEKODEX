# NEKODEX UI/UX review wave 2 — lane 10 (`mcp-ipc`)

- Reviewed commit: `5401800`
- Scope: `launcher/src/App.tsx`, `launcher/electron/main.cjs`, preload/direct UI callers, MCP wizard, renderer state transitions, keyboard/focus/ARIA, errors/retry/re-entry, responsive layout and copy.
- Method: manual focused source review only. No app start, scripts, tests, typechecks, delegation, commit or push.

## Findings

### P2 — Step 3 shows the Step 2 MCP tutorial video

- **Exact component/line:** `launcher/src/App.tsx:38-42`, `McpSurface` at `launcher/src/App.tsx:1623-1624`.
- **Trigger:** Open Local Tools, advance from step 1 to step 2, then open “Guide video”. `MCP_GUIDE_MEDIA[1]` and `MCP_GUIDE_MEDIA[2]` both resolve to `mcp-connect-connector.mp4`.
- **Actual:** The “Attach the ChatGPT connector” step presents the same “connect local harness” video as the preceding step; there is no connector-specific third asset in the snapshot (the asset tree contains only `mcp-create-tunnel.*` and `mcp-connect-connector.*`).
- **Expected:** Step 3 either presents a video that demonstrates adding/attaching the ChatGPT connector and returning to verify, or hides the guide-video affordance for that step when no such asset exists.
- **Smallest fix:** Add a third connector-attachment asset and use it at index 2, or make `MCP_GUIDE_MEDIA[2]` `null` and render no video summary for step 3 until the correct asset exists.
- **Confidence:** High.

### P2 — Changing an MCP step does not move keyboard focus to the new step content

- **Exact component/line:** `McpSurface` at `launcher/src/App.tsx:1625-1629`, content remount at `launcher/src/App.tsx:1726-1729`.
- **Trigger:** Use keyboard navigation to activate Next, Previous, or a completed step in the wizard.
- **Actual:** `setStep(next)` remounts `.wizard-content` through `key={step}`, but no heading or first actionable control receives focus. The activation button is removed or remains outside the new content, so keyboard users can lose their place and screen-reader users are not informed that the step changed.
- **Expected:** After a successful transition, focus should land on the new step heading (or the first invalid/input control when entering the credential step), with the step change announced without requiring a second Tab search.
- **Smallest fix:** Give the step heading a stable `tabIndex={-1}` and focus it in an effect keyed by `step` after `setStep`; preserve the existing video focus behavior separately.
- **Confidence:** High.

### P2 — The expanded tutorial is announced as a dialog but has no dialog focus containment or focus restoration

- **Exact component/line:** `TutorialVideo` at `launcher/src/App.tsx:2421-2428` and `launcher/src/App.tsx:2447-2475`.
- **Trigger:** Focus the video expand button, activate it, then tab through the expanded video or close it with Escape.
- **Actual:** The overlay declares `role="dialog"` and `aria-modal="true"`, but focus is only placed on the close button via `autoFocus`; Tab can leave the overlay, and closing it does not restore focus to the expand button. Escape removes the portal while leaving focus without a deterministic destination.
- **Expected:** Keyboard focus remains within the modal while open and returns to the invoking expand control after close, including the Escape path.
- **Smallest fix:** Store the invoking button ref, restore it in `closeExpanded`, and add a small Tab-cycle/focus-scope around the dialog (or use the project’s existing focus-scope primitive if one exists).
- **Confidence:** High.

### P2 — MCP stepper exposes a wizard-like control without current-step semantics

- **Exact component/line:** `McpSurface` at `launcher/src/App.tsx:1700-1714`.
- **Trigger:** Navigate the MCP wizard with a screen reader or inspect the accessibility tree while step 2 or step 3 is active.
- **Actual:** The container has only `aria-label="N / 3"`; it has no wizard/list semantics and the active step button has no `aria-current` or equivalent current-state announcement. The check icon communicates completion visually, but the accessible name remains only “N. title”.
- **Expected:** Assistive technology should identify the control as a step navigation, expose which step is current, and distinguish completed steps from the current step.
- **Smallest fix:** Add an accessible stepper label/region, set `aria-current="step"` on `index === step`, and include localized completion/current status in each button’s accessible name or visible status text.
- **Confidence:** Medium-high.

## Rejected

- **MCP credentials are not directly editable after completion:** rejected as a finding. `launcher/src/App.tsx:1749-1765` replaces the fields with a saved-credentials notice and exposes `Replace credentials` as the explicit unlock action; `launcher/src/App.tsx:1789-1801` provides the explicit keep-credentials re-entry path.
- **Reconnect bypasses the completed proof lock:** rejected as a finding. `launcher/src/App.tsx:1852-1862` labels the action `Reconnect harness` and keeps the credential fields locked; it does not silently unlock them. The main process receives `replace: false` at `launcher/src/App.tsx:1652-1656`.
- **Technical identifiers as branding defects:** rejected by scope. Connector names, MCP, Tunnel, API key and runtime identifiers are functional compatibility strings, not branding findings.
- **Backend proof publication ordering:** rejected as a finding for this lane. `launcher/electron/main.cjs:764-777` checks connector health and current proof context before committing `mcpSetupComplete`, while failures clear the proof at `launcher/electron/main.cjs:788-800`.

## Clean areas

- Completed MCP credentials are read-only until the explicit `Replace credentials` action; the saved secret is not rendered back into the form.
- The renderer derives the verified state from committed backend state through `currentToolProof` (`launcher/src/App.tsx:48-53`), and the runtime-start failure exception prevents a stale “verified” presentation.
- `setupMcp` completion is followed by a fresh snapshot read and then a transition to step 3 (`launcher/src/App.tsx:1647-1674`); a stale metadata refresh does not relabel the already-committed setup as an installation failure.
- Failed MCP verification clears the committed proof and leaves a retryable Verify Runtime action (`launcher/electron/main.cjs:731-740`, `launcher/src/App.tsx:1864-1880`).
- Credential replacement has a recoverable keep-credentials path, and the credential inputs use password masking for the runtime key (`launcher/src/App.tsx:1766-1801`).
- The browser tab strip has roving `tabIndex`, Enter/Space activation, and Arrow/Home/End navigation (`launcher/src/App.tsx:1124-1152`).
- The expanded video close control has a localized accessible label and Escape handling; the finding is limited to focus containment/restoration, not discoverability.
- The CSS provides a compact stepper treatment below 900px and stacks field rows below 760px (`launcher/src/styles.css:2741-2805`), with no source-level evidence here of a definite overflow defect.

## Notes

- Review is source-based against commit `5401800`; no runtime screenshots or live interaction were performed per the read-only/no-start instruction.
- The repository snapshot has only two MCP tutorial video assets, which is the evidence for the duplicate step-2/step-3 mapping.
- Severity is P2 because each issue is reachable and degrades guidance or keyboard/assistive navigation, while the core setup/verification state machine remains usable.
