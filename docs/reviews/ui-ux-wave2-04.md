# UI/UX review wave 2 — lane 4: form accessibility

Scope: read-only manual review of `launcher/src` and its direct UI callers at baseline `5401800`, with emphasis on labels, disabled/read-only state, keyboard focus and tab order, error announcements, MCP wizard behavior, responsive layout, copy, and reachable state-transition defects. No tests, typechecks, scripts, runtime, app starts, commits, pushes, or delegation were used.

## Findings

### P1 — Browser tabs contain a second interactive control inside the `role="tab"` element

- Component/lines: `launcher/src/App.tsx:1124-1171`, especially `1126-1152` and `1159-1169`.
- Trigger: the browser has a closable tab; a keyboard user enters the tablist and tabs through the active tab and its close button, or a screen reader exposes the tab and nested button.
- Expected: each tab has one coherent tab interaction, with a separately reachable close action that does not violate tab semantics; roving focus and arrow navigation should move between tabs predictably.
- Actual: the tab is a focusable `div role="tab"` with `Enter`/Space and arrow handling, and it contains a native close `<button>`. This nests an interactive button inside another interactive tab widget. The close button participates in the tab sequence inside the tab, while the parent’s roving `tabIndex` logic and `event.target !== event.currentTarget` guard exclude it from the intended tab keyboard model.
- Smallest fix: render the tab and close action as sibling controls in a tab item, or make the tab a wrapper with a separately owned close button outside the `role="tab"`; keep one roving tab stop for tabs and give the close action its own explicit accessible name and focus behavior.
- Confidence: high.

### P2 — Custom radio groups are tab-order driven and do not implement radio keyboard navigation

- Component/lines: `launcher/src/App.tsx:376-398` and `2657-2668` (`WelcomeOption`); `2508-2558` (`InteractionModePicker`); `2353-2400` (`ZeroRiskModelMenu`).
- Trigger: a keyboard user focuses one of the language, interaction-mode, or zero-risk model choices and presses ArrowLeft/ArrowRight/ArrowUp/ArrowDown, as expected for a radio group.
- Expected: the selected radio is the single tab stop; arrow keys move the selection and focus within the group, while Tab leaves the group. The selected state should remain synchronized with focus.
- Actual: each custom `role="radio"` is a native button with default tab participation, but none implements arrow-key movement or roving `tabIndex`. Users must Tab through every option, and arrow keys do nothing. The same pattern is repeated in three user-facing choice groups.
- Smallest fix: use native `<input type="radio">` controls with visible labels, or implement the APG radio pattern with one `tabIndex=0`, remaining options `tabIndex=-1`, and arrow/Home/End handling that moves focus and updates the value.
- Confidence: high.

### P1 — Expanded MCP tutorial video is a modal dialog without focus containment or focus restoration

- Component/lines: `launcher/src/App.tsx:2407-2477`, especially `2447-2475`.
- Trigger: the user activates “expand guide video” from the MCP wizard, then presses Tab repeatedly or closes the dialog with Escape.
- Expected: focus moves into the dialog, remains within the modal while it is open, Escape closes it, and focus returns to the expand button that opened it. Background controls must not remain reachable while `aria-modal="true"` is active.
- Actual: the close button receives `autoFocus`, but the dialog has no focus trap/inert background handling and the video’s native controls are not contained by a modal focus model. Escape changes React state but does not restore focus to the opener. Focus can therefore escape into the underlying wizard and, after Escape, may be left at an unrelated document position.
- Smallest fix: retain a ref to the expand button, move focus into the dialog, trap Tab within dialog controls, restore focus to the opener on close, and ensure the dialog’s accessible name is exposed through an actual heading or `aria-labelledby`.
- Confidence: high.

### P1 — Verified account cards keep sign-in and successful-check actions active

- Component/lines: `launcher/src/AccountSettings.tsx:80-103`, especially `94-103`.
- Trigger: an account is authenticated and its account/connector checks are complete; the user returns to the account card and navigates it by keyboard.
- Expected: completed credential and verification controls are read-only/disabled. Only an explicit Replace/Edit/Upgrade action should unlock the completed form or re-entry flow, and the primary action should describe management of the completed account.
- Actual: the card always exposes an enabled `Sign in` action outside the global busy state. `Check` and `Check connector` remain enabled whenever the mode is not manual, even when `account.authenticated`, `account.checked`, and `account.connectorReady` are already true. There is no explicit locked completed state or Replace/Edit/Upgrade unlock in this direct caller.
- Smallest fix: derive a completed/locked card state from the account snapshot, disable or replace the completed actions, and add one explicit Replace/Edit/Upgrade action that is the only transition back into credential entry or re-verification.
- Confidence: high.

## Rejected / out of scope

- Branding changes: rejected. Technical compatibility identifiers, connector names, route names, package imports, and filesystem/runtime identifiers were not treated as branding problems.
- Generic visual preferences: rejected. No finding is based only on color, spacing, illustration style, or personal copy preference; each listed issue has a reachable keyboard, screen-reader, form-state, or state-transition impact.
- MCP credentials read-only behavior: rejected as a defect. `McpSurface` renders the saved credential state without inputs at `App.tsx:1749-1765`; `Replace` is the explicit unlock at `1757-1764`, and `Keep credentials` exits the replacement state at `1789-1801`.
- Global error announcements: no finding. The app-level error toast uses `role="alert"` at `App.tsx:2854-2866`, and the login/diagnostic failure paths also expose `role="alert"` content in their direct callers.

## Clean areas

- `launcher/src/App.tsx:1749-1801`: completed MCP credentials are represented as a saved state; raw credential inputs are not rendered until the user explicitly chooses Replace.
- `launcher/src/App.tsx:1847-1882`: wizard actions are native buttons with disabled busy/invalid predicates, and the credentials step blocks Connect until required values exist.
- `launcher/src/App.tsx:2103-2113`: the capacity input has a label, `aria-invalid`, `aria-describedby`, and a status message for invalid/unsaved/saved state.
- `launcher/src/RouteDiagnostics.tsx:113-150`, `PasskeyLoginGuide.tsx:38-46`, and `ExistingChromeLoginGuide.tsx:70-80`: result, retry, and failure paths provide live/status or alert semantics.
- `launcher/src/nekodex.css:354-380,395-430`: the MCP wizard footer and fields have responsive wrapping, visible focus outlines, readable control sizing, and error styling; no additional reachable responsive defect was established by code review.

## Notes

- Review target is source at `5401800`; no runtime screenshot or MCP app session was started under the user’s read-only constraint. Screenshot-relevant conclusions are therefore derived from the implemented wizard and direct callers, with confidence stated per finding.
- The review used the fast-verification policy from `right-size-test-runs/SKILL.md`: manual code review only, with no automated verification.
