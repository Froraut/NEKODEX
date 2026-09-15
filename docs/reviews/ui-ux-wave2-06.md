# UI/UX review — wave 2, Luna medium, lane 6

Baseline: `5401800` (`540180047f8a6bee4b735d62a89d3eb64dc428a7`). Manual source review only. The requested `launcher/src/Settings.tsx` does not exist at this baseline; the settings surface is implemented in `launcher/src/App.tsx`, with direct settings/account callers in `AccountSettings.tsx`, `RouteDiagnostics.tsx`, and the setup/MCP components in `App.tsx`. No tests, typechecks, scripts, runtime or app starts, commits, pushes, or delegation were performed.

## Findings

### P2 — Whitespace-only MCP credentials pass the form gate

- Component/lines: `launcher/src/App.tsx:1767-1787,1853-1862` (`McpSurface`, step two).
- Trigger: open MCP setup, enter only spaces in Tunnel ID and/or API key, then activate Connect harness.
- Actual: the button gate checks `!tunnelId || !runtimeKey`, so whitespace strings are treated as present. The raw values are passed to `setupMcp` and the user receives a general error path rather than field-level invalid feedback.
- Expected: trim or reject whitespace-only values before submission, mark the affected field invalid, and explain the required value adjacent to it. A saved/verified form should remain locked until an explicit Replace credentials action, while the replacement form should validate its new values before attempting the operation.
- Smallest fix: use trimmed values in the submit predicate and payload, add `aria-invalid`/`aria-describedby` for each field, and render a short inline error when a non-empty raw value trims to empty.
- Confidence: high.

### P2 — Settings radio groups are not keyboard-operable as radio groups

- Component/lines: `launcher/src/App.tsx:2508-2558` (`InteractionModePicker`); `2333-2400` (`ZeroRiskModelMenu` radio options).
- Trigger: navigate to Settings or the Manual setup model menu with a keyboard or screen reader and focus one radio option.
- Actual: the controls expose `role="radiogroup"`/`role="radio"` and `aria-checked`, but each radio is a normal button with no roving `tabIndex` and no Arrow/Home/End handling. Keyboard users must tab through every option and the standard radio-group navigation contract is absent.
- Expected: one selected radio is in the tab order, Arrow keys move the selection/focus within the group, and Home/End reach the first/last option. The accessible state should follow the focused option while the operation is pending.
- Smallest fix: implement roving tab stops and the APG radio-key handlers, or use a native grouped control whose keyboard behavior is provided by the browser.
- Confidence: high.

### P2 — Custom language listbox loses focus and has no listbox keyboard navigation

- Component/lines: `launcher/src/App.tsx:2759-2815` (`LanguageMenu`).
- Trigger: open Language in Settings with the keyboard, then press Arrow keys, Escape, or choose an option.
- Actual: the popup declares `role="listbox"` and its children `role="option"`, but the options are buttons without Arrow/Home/End handling or `aria-activedescendant`. Escape only closes the popup; focus is not returned to the trigger. Selecting an option closes the popup and starts an async language update without a focus target for the result.
- Expected: the popup behaves as a listbox for keyboard users, Escape returns focus to the trigger, and selection returns focus predictably while the language update/error is announced.
- Smallest fix: either use a native `<select>` or implement listbox focus management and keyboard handling, including trigger restoration on close and an `aria-live` status for save failure.
- Confidence: high.

## Rejected / out of scope

- `launcher/src/Settings.tsx`: rejected as an absent path at baseline `5401800`; the actual settings implementation is `SettingsSurface` in `launcher/src/App.tsx`.
- Existing account-card findings from `AccountSettings.tsx`: rejected as duplicate lane scope because the same baseline is already covered by `docs/reviews/ui-ux-inventory-07.md`; no new account-state claim is added here.
- Connector names, route names, package names, MCP/API identifiers, and technical compatibility labels: rejected as branding findings. They are functional identifiers and were not treated as copy defects.
- Visual preferences without a reachable interaction consequence: rejected. The review flags only validation, state, keyboard, focus, ARIA, retry/re-entry, and responsive interaction behavior.

## Clean areas

- `App.tsx:1749-1804`: saved MCP credentials are replaced by a success notice; the credential inputs reappear only through the explicit `Replace credentials` action, with `Keep saved credentials` available to cancel re-entry.
- `App.tsx:1864-1880`: a verified MCP state exposes an explicit Verify runtime action and a separate Done action; the verification predicate also accounts for a failed production runtime-start operation.
- `App.tsx:1972-2113`: browser-capacity validation has a bounded numeric range, disabled save state, `aria-invalid`, `aria-describedby`, and visible saved/unsaved/error status text.
- `App.tsx:1610-1687,1847-1883`: MCP busy guards, retry through the same verification action, error-to-toast handling, and metadata refresh after committed setup are present in the source path.
- `nekodex.css:327-380` and `styles.css:1765-1787`: setup and MCP controls wrap at narrow content widths; wizard footer buttons permit multiline labels and the field layout collapses to one column.
- `App.tsx:2413-2477`: expanded tutorial media has a labelled modal, Escape close behavior, an explicit close control, and video time preservation; the inline guide remains available in the MCP wizard.

## Notes

- Source review did not run the application or inspect a live account-side ChatGPT wizard. The MCP screenshot/video behavior was reviewed through the launcher’s rendered tutorial and state transitions; live connector loading and approval remain outside this read-only lane.
- The requested output intentionally preserves the lane’s `Luna medium` label and reports only source-observable UI/UX behavior.
