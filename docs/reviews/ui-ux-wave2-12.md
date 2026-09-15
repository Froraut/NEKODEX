# UI/UX review — wave 2, lane 12 (motion)

Scope: manual static review of `launcher/src` and its direct UI callers at baseline `5401800`. Focused on motion, hover/focus/transition behavior, reduced motion, state-change feedback, completed-state locking, MCP wizard behavior, keyboard/focus/ARIA semantics, error/retry/re-entry states, responsive layout, copy, and reachable interaction defects. No tests, typechecks, scripts, runtime, app starts, commits, pushes, or delegation were used.

## Findings

### P1 — Global motion guard disables the loading and state feedback animations it is supposed to preserve

- Component/lines: `launcher/src/nekodex.css:382-391`; affected callers include `launcher/src/styles.css:495-498`, `527-539`, `645-659`, and `767-774`.
- Trigger/state sequence: a browser tab is loading, a browser navigation is in progress, a tab is busy, or a state/action dot is marked busy in the normal motion preference.
- Expected: the tab spinner, browser loading line, and busy state dots provide visible ongoing-progress feedback; only the decorative cat motion is suppressed by the scoped motion rule, while `prefers-reduced-motion` removes the remaining motion.
- Actual: the broad `.app-root *:not(...), .app-root *::before, .app-root *::after` rule sets `animation: none !important` and `transition: none !important` on every non-whitelisted element and every pseudo-element. `.tab-spinner`, `.browser-loading-line::after`, `.state-dot.is-busy`, and `.action-dot.is-pulse` are not whitelisted, so their keyframes never run in the normal UI. Users see a static spinner/progress line/dot even while the underlying operation remains active.
- Accessibility impact: the loss of animation itself is safe, but the affected controls lose a key visual indication that work is still progressing. Users can interpret a long-running operation as stalled and re-enter or retry it.
- Smallest fix: scope the rule to the decorative illustration subtree, or explicitly exempt functional progress indicators (`.tab-spinner`, `.browser-loading-line::after`, `.state-dot.is-busy`, `.action-dot.is-pulse`) and retain their reduced-motion overrides under the existing media query.
- Confidence: high.

### P1 — Expanded guide-video dialog does not trap or restore focus

- Component/lines: `launcher/src/App.tsx:2407-2477`, especially `2421-2428` and `2447-2474`.
- Trigger/state sequence: a keyboard user activates the MCP guide video expand button; the portal dialog opens; the user tabs, presses Escape, or closes the dialog.
- Expected: focus moves into the modal, remains within it while open, Escape closes it, and focus returns to the expand button that opened it.
- Actual: `autoFocus` puts focus on the close button only once. There is no focus trap, no `aria-labelledby`/dialog title relationship beyond the generic `aria-label`, and Escape calls `closeExpanded()` without restoring focus. Tabbing can move into the background launcher, and after Escape/close the browser focus can be left on a detached portal control or an unrelated background target.
- Accessibility impact: keyboard and screen-reader users can lose their place and interact with background controls while the modal is visually covering them.
- Smallest fix: retain a ref to the opener, add a modal focus boundary/trap, mark the dialog with a stable labelled heading or `aria-labelledby`, and focus the opener after both button-close and Escape-close.
- Confidence: high.

### P1 — Bigger-context recommendation dialog has no initial focus, Escape handling, focus trap, or focus restoration

- Component/lines: `launcher/src/App.tsx:707-716`, `906-914`, and `2903-2945`.
- Trigger/state sequence: the settings recommendation opens through `setBiggerContextRecommendationOpen(true)`; the user is navigating with the keyboard or a screen reader.
- Expected: the dialog receives focus, exposes a complete modal name/description, keeps focus inside while open, supports Escape, and returns focus to the settings trigger when dismissed.
- Actual: the dialog has `role="dialog"` and `aria-modal`, but no focus management at all. The first focusable element remains in the background, no Escape handler is present, and closing only changes React state. The trigger is an inline text button at `2149`, but no opener ref or restoration path exists.
- Accessibility impact: keyboard focus can remain behind the modal and tab into obscured settings controls. There is no keyboard dismissal path, so a user can be forced to find the Close button visually or tab through the overlay.
- Smallest fix: add a dialog ref and opener ref, move focus to the heading or first actionable control, trap Tab, close on Escape, and restore focus to the recommendation trigger.
- Confidence: high.

### P2 — MCP step changes replace content without announcing or moving focus to the new step

- Component/lines: `launcher/src/App.tsx:1625-1637`, `1691-1729`, and `1847-1878`.
- Trigger/state sequence: the user activates Next, Previous, or a stepper button in the MCP wizard; `step` changes and the keyed `.wizard-content` subtree is remounted.
- Expected: the newly selected step is announced to assistive technology and keyboard focus lands on the new step heading or its first actionable control, while the stepper exposes a coherent current state.
- Actual: `key={step}` remounts the content, but no heading is focusable, no `tabIndex`/focus effect is present, and the new content is not an `aria-live` region. Focus stays on the old footer/stepper control, so a keyboard user can activate Next and continue tabbing without an immediate indication that the step content changed. The stepper is only a labelled `div`, not a named group with an explicit current step relationship.
- Accessibility impact: state changes are easy to miss for keyboard and screen-reader users, especially when the next step contains required credentials or the final verification state.
- Smallest fix: give the current step heading a stable focus target and focus it after a successful move, or expose the step body through a narrowly scoped polite live region; add an explicit current-step/state relationship to the stepper.
- Confidence: high.

### P2 — Custom radio groups are clickable and tabbable but do not implement expected arrow-key selection

- Component/lines: `launcher/src/App.tsx:376-398`, `2521-2559`, and `2643-2669`.
- Trigger/state sequence: the user reaches language selection, interaction-mode selection, or zero-risk model selection with the keyboard.
- Expected: a radio group has one tab stop for the selected option and Arrow keys move/select within the group; Home/End are supported where appropriate.
- Actual: each option is a separate native `button` with `role="radio"`; the groups do not manage roving `tabIndex`, Arrow keys, or Home/End. Every option enters the normal tab order, and pressing Arrow keys does nothing. The browser's native button behavior does not supply radio-group keyboard semantics after the role is overridden.
- Accessibility impact: keyboard users must tab through every option and cannot use the standard radio interaction pattern; this is especially disruptive in the three-step first-run flow.
- Smallest fix: use native radio inputs where possible, or implement roving `tabIndex`, `aria-activedescendant`/selection updates, and Arrow/Home/End handling for each custom group.
- Confidence: high.

### P2 — Language and model popovers expose listbox/radiogroup roles without their required keyboard and focus behavior

- Component/lines: `launcher/src/App.tsx:2326-2403` and `2759-2814`.
- Trigger/state sequence: the user opens the settings language menu or zero-risk model menu and navigates with the keyboard.
- Expected: opening moves focus into the popup; Escape closes and returns focus to the trigger; listbox options or radio choices support the corresponding arrow-key pattern; the popup is correctly labelled and background content is inert while it is open.
- Actual: the menus use `role="listbox"`/`role="radiogroup"` and `role="option"`/`role="radio"`, but provide no focus transfer, focus restoration, roving tab index, or arrow-key handling. The transparent scrim is a separate button in the tab order and does not make the underlying content inert. Escape only changes state and does not restore the trigger focus.
- Accessibility impact: keyboard users can tab through an unexpected sequence, lose their place on close, and reach background controls while the popup is open.
- Smallest fix: implement the matching popup pattern with opener refs, focus restoration, keyboard navigation, and a modal/inert boundary; alternatively use a native `select` for the language menu.
- Confidence: high.

## Rejected / out of scope

- Existing account completion/selection findings from `docs/reviews/ui-ux-inventory-07`: rejected as duplicates for this wave; the current lane review does not repeat them.
- Branding changes based on `codex`, MCP, connector, route, package, or other technical identifiers: rejected. These are compatibility or product-state identifiers, not branding defects.
- Pure visual preference claims about colors, spacing, illustration style, or animation taste: rejected unless tied to the reachable state-feedback or interaction defects above.

## Clean areas

- `launcher/src/CatTail.tsx:12-51` checks `prefers-reduced-motion`, pauses while the document is hidden, cancels its animation frame on cleanup, and reacts to runtime preference changes.
- `launcher/src/nekodex.css:390-393` and `launcher/src/styles.css:2807-2815` provide reduced-motion fallbacks that disable animation, transitions, and smooth scrolling.
- `launcher/src/App.tsx:1749-1804` keeps saved MCP credentials out of the form until the explicit `Replace credentials` action is activated; the normal completed view is read-only.
- `launcher/src/App.tsx:1702-1709` prevents jumping forward into future MCP steps while busy or before the current step is reached.
- `launcher/src/PasskeyLoginGuide.tsx`, `launcher/src/ExistingChromeLoginGuide.tsx`, and `launcher/src/RouteDiagnostics.tsx` expose live progress and alert regions for their visible retry/error states.
- `launcher/src/AccountSettings.tsx:70` exposes `aria-busy` for account operations, and its loading state has a reachable retry button.

## Notes

- Review was limited to source inspection at `5401800`; no runtime screenshot or MCP execution was performed.
- The strongest motion defect is functional feedback suppression caused by the global CSS selector, not a preference about decorative animation.
