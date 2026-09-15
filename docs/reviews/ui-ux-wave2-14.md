# UI/UX review wave 2 — lane 14 runtime-activity

Scope: manual review of baseline `5401800`, focused on the runtime activity surface, its Overview entry point, MCP wizard loading/error/empty/completed transitions, keyboard/focus/ARIA semantics, responsive behavior, copy, and reachable interaction defects. The requested `launcher/src/Activity.tsx` does not exist at this baseline; the activity surface is implemented inline as `ActivitySurface` in `launcher/src/App.tsx:1888-1940`. Direct activity callers reviewed include `launcher/src/Overview.tsx:49-52`.

No tests, typechecks, scripts, runtime/app starts, commits, pushes, or delegation were performed. The only written changes are this review and its JSON companion.

## Findings

### P2 — Interaction-mode radio buttons do not implement keyboard radio behavior

- Component/lines: `launcher/src/App.tsx:2522-2558`, `InteractionModePicker`.
- Trigger: focus either Automatic or Manual with the keyboard and press ArrowLeft/ArrowRight/ArrowUp/ArrowDown, or move through the group with Tab.
- Actual: the container exposes `role="radiogroup"` and each button exposes `role="radio"`/`aria-checked`, but both buttons remain in the normal tab order and there is no arrow-key handler or roving `tabIndex`. Arrow keys scroll or do nothing, and keyboard users must tab through both options instead of using radio-group navigation.
- Expected: follow the radio pattern: one selected radio is tabbable, arrow keys move selection and focus within the group, and the selected state is announced consistently.
- Smallest fix: add a roving `tabIndex` (`0` for the selected option, `-1` for the other) and a shared Arrow-key handler that calls `onChange` and focuses the target; preserve the existing `aria-checked` values.
- Confidence: high.

### P2 — Expanded MCP guide video is a modal without focus containment or focus restoration

- Component/lines: `launcher/src/App.tsx:2421-2428` and `2447-2475`, `TutorialVideo`.
- Trigger: activate the guide-video expand button, then tab through the expanded video dialog or close it with Escape.
- Actual: the portal declares `role="dialog"` and `aria-modal="true"`, but focus is only moved to the close button via `autoFocus`; Tab can move to browser/document controls outside the modal, and closing by Escape or the close button does not restore focus to the expand button. This can strand keyboard and screen-reader users in the page after the dialog disappears.
- Expected: while open, focus stays within the dialog; Escape and Close return focus to the control that opened it.
- Smallest fix: retain a ref to the expand button, add a small focus trap or use the project’s existing dialog primitive if available, and restore focus after `setExpanded(false)`; give the dialog a stable accessible name/labelled heading if the video label is not exposed as a title.
- Confidence: high.

### P2 — Activity export has no pending state or duplicate-action guard

- Component/lines: `launcher/src/App.tsx:1905-1912`, `ActivitySurface`.
- Trigger: activate “Export safe log” repeatedly before the first `api.exportLogs()` promise settles, or activate it while an export is slow.
- Actual: the button has no `disabled`/busy predicate and the handler starts a new export on every activation. A failure is sent to the global toast, but there is no local progress or completion feedback tied to the export control.
- Expected: one export operation at a time, with the control disabled and an announced loading/completed/error state until the promise settles.
- Smallest fix: add local `exporting` state, disable the button while true, set it around the promise with `try/finally`, and expose a short `role="status"` message or change the button label while exporting; keep the existing global error toast for failure.
- Confidence: medium-high.

### P2 — MCP stepper exposes active/completed styling without an equivalent current-step semantic

- Component/lines: `launcher/src/App.tsx:1700-1714`, MCP wizard stepper.
- Trigger: navigate the MCP wizard with a screen reader or inspect the stepper after moving to step 2/3 and after verification completes.
- Actual: the active and completed states exist only in CSS classes (`is-active`, `is-complete`) and visual icon replacement. The step buttons have labels and disabled guards, but no `aria-current="step"` for the active step and no announced completion state for completed steps. The visible `aria-label="N / 3"` describes position but not which step is current or finished.
- Expected: assistive technology should receive the same current/completed state conveyed visually, while preserving the existing ability to go back to earlier steps.
- Smallest fix: add `aria-current={index === step ? "step" : undefined}` and include a localized completion phrase in the accessible name or description for completed steps; keep future steps disabled as they are now.
- Confidence: medium-high.

## Rejected / out of scope

- `launcher/src/Activity.tsx`: rejected as a literal component target because it is absent at baseline `5401800`; the available implementation is the inline `ActivitySurface` in `launcher/src/App.tsx`.
- Generic visual preferences: rejected unless tied to a reachable interaction or state-transition problem.
- Technical compatibility identifiers and connector names: rejected from branding/UI findings by request; no rename is proposed.
- MCP completed credentials: no finding. `McpSurface` shows a saved-credentials success state at `launcher/src/App.tsx:1748-1765`, hides the inputs, and exposes `Replace credentials` as the explicit unlock; `SetupRow` also blocks completed non-repeatable actions at `launcher/src/App.tsx:2297-2302`.

## Clean areas

- `launcher/src/App.tsx:1901-1925`: activity search and level filtering have accessible labels and a distinct no-log/no-match empty state; the empty state is reachable without an invalid control assumption.
- `launcher/src/Overview.tsx:49-52`: the recent-activity list has a clear “View all” navigation control and a dedicated empty state; the direct caller does not expose raw log details as an editable form.
- `launcher/src/App.tsx:1647-1689`: MCP install and verify operations guard against re-entry with `busy`, clear stale errors before starting, and preserve the committed setup when a post-install metadata refresh fails.
- `launcher/src/ExistingChromeLoginGuide.tsx:69-93` and `PasskeyLoginGuide.tsx:37-54`: loading/terminal/error states use live status and alert regions and expose retry only after terminal failure/cancellation.
- `launcher/src/nekodex.css:356-370` and `styles.css:1765-1797`: the wizard footer wraps at narrow widths, MCP fields collapse to one column, and the screenshot’s narrow wizard layout is consistent with the responsive rules reviewed.

## Notes

- The MCP screenshot reviewed was `docs/design/screenshots/mcp-responsive.png`; it shows the stepper, guide disclosure, step content, and footer controls in the narrow layout. The source guards and responsive CSS support that flow, with the ARIA and modal-focus gaps above remaining.
- Review is source/screenshot based only. No runtime behavior, browser accessibility tree, automated check, or generated artifact was executed.
