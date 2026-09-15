# NEKODEX UI/UX review — wave 2, lane 8

Scope: manual review at baseline `5401800` of the browser controls, narrow layout, loading/unavailable/disabled actions, login and manual-turn transitions, MCP wizard behavior, tutorial media, keyboard/focus/ARIA semantics, and direct callers. The requested `launcher/src/Browser.tsx` is absent at this baseline; the browser UI is implemented by `BrowserSurface` in `launcher/src/App.tsx`, with `launcher/src/browser-controls.ts` and `launcher/src/nekodex.css` as supporting files. No tests, typechecks, scripts, runtime, app start, commit, push, or delegation were used.

## Findings

### P1 — Zoom controls remain enabled while browser interaction is locked

- Component/lines: `launcher/src/App.tsx:1037-1050,1175-1206`; lock predicate in `launcher/src/browser-controls.ts:15-27`.
- Trigger/state sequence: a login, passkey/existing-Chrome import, or active browser turn sets `navigationLocked=true` (or the browser is hidden); the user focuses the browser toolbar and activates Zoom out, the percentage reset, or Zoom in.
- Expected: all browser-mutating controls that depend on the same browser surface are disabled while navigation is locked or unavailable. The disabled state should match Back, Forward, and Reload, and zoom should be re-enabled only after the active operation ends.
- Actual: Back, Forward, and Reload use `navigationLocked` and visibility guards, but all three zoom controls omit both guards. Their handlers also call `api.zoomBrowser` without checking `navigationLocked`. During sign-in or a running turn, the UI therefore exposes an enabled action that can mutate the active browser surface while the surrounding navigation is intentionally frozen; when the browser is hidden, zoom remains exposed as well.
- Accessibility impact: keyboard and assistive-technology users receive an enabled control in a state where related browser actions are explicitly unavailable. The toolbar presents an inconsistent state model and can move focus into an operation that should be inert.
- Smallest fix: derive one `browserControlsDisabled = navigationLocked || !visible` predicate for zoom, pass it to the minus/reset/plus controls, and retain the handler guard as a defensive no-op.
- Confidence: high.

### P1 — Browser navigation stays actionable during MCP verification

- Component/lines: `launcher/src/App.tsx:1175-1189`; `launcher/src/browser-controls.ts:15-27`.
- Trigger/state sequence: the user opens the MCP wizard and starts `Verify runtime`; `operation.name` becomes `mcp-verification` with `status="running"`, while there is no active browser turn and the browser itself is not in `testing`/`running` state; the user activates Back, Forward, or Reload in the browser toolbar.
- Expected: navigation is unavailable for the duration of connector verification because the verification flow owns the ChatGPT/browser session. The UI should show the same disabled state used for other in-flight browser operations and re-enable navigation after the operation completes or fails.
- Actual: `browserControls()` computes `unrelatedOperation`, but `navigationLocked` does not include a running unrelated operation. The value is only used to block passkey login. The three navigation buttons therefore remain enabled during `mcp-verification`, and `navigate()` only checks `navigationLocked` before calling `api.navigateBrowser`.
- Accessibility impact: the UI does not communicate that verification is using the browser session. A keyboard user can navigate away while the verification status is still running, causing an unexpected loss of context or a failed verification without an immediate local explanation.
- Smallest fix: include the relevant browser-owning operations, at minimum running `mcp-verification` (and any equivalent connector/browser inspection operation), in `navigationLocked`; keep the guard in `navigate()` so the same rule applies to keyboard and programmatic activation.
- Confidence: medium-high. The missing renderer guard is explicit; the exact browser ownership policy is corroborated by the verification IPC path, which performs connector checks through the browser host.

### P2 — Expanded MCP tutorial is declared modal without modal focus management

- Component/lines: `launcher/src/App.tsx:2413-2428,2447-2476`; expanded media styles in `launcher/src/styles.css:1564-1607`.
- Trigger/state sequence: the user opens the MCP guide video with the keyboard or pointer, then tabs through the expanded video dialog or closes it with Escape.
- Expected: a modal dialog traps focus inside the dialog while open, has a labelled dialog, and returns focus to the expand control when closed. Escape and the close button should provide equivalent, predictable exits.
- Actual: the portal sets `role="dialog"` and `aria-modal="true"`, and autofocuses the close button, but it does not trap Tab/Shift+Tab and does not save or restore focus to the expand button. Tabbing can move focus into the underlying wizard even though the underlying page is marked unavailable by `aria-modal`; after Escape or Close, focus is not returned to the control that opened the dialog.
- Accessibility impact: keyboard and screen-reader users can lose the active context, interact with background controls behind a modal overlay, or land at an unrelated browser focus position after closing the video.
- Smallest fix: retain a ref to the expand button, add a small focus trap for the dialog’s video/close controls, and restore focus to that ref in `closeExpanded`; keep the existing Escape listener and `aria-label`.
- Confidence: high.

### P2 — ARIA tabs contain nested close buttons and do not expose a separate tab-close interaction model

- Component/lines: `launcher/src/App.tsx:1124-1171`.
- Trigger/state sequence: the user navigates the browser tab strip with a keyboard, reaches a closable tab, and then attempts to move among tabs with Arrow/Home/End or activate the tab with Enter/Space.
- Expected: the tablist should follow one coherent keyboard model: tab elements are the roving-focus items, and closing a tab is exposed as a separately named control without making the tab’s interactive descendants ambiguous to assistive technology.
- Actual: each `role="tab"` is a clickable `div` that contains a nested native close `button`. The tab handler intentionally ignores key events whose target is the close button, so focus can move into a second interactive descendant that is outside the tab’s roving-focus behavior. There is also no `aria-controls` relationship for the selected tab and its browser panel. The visual close affordance is hidden until hover/focus, which makes the nested control especially easy to miss for keyboard users.
- Accessibility impact: screen readers can announce a tab containing another interactive control, and keyboard users can get stranded on the close button or lose the expected Arrow-key tab navigation. Closing a tab also has no state-specific disabled/busy guard.
- Smallest fix: use a button-like tab item with a separate close control that is excluded from the tab’s roving-focus sequence, or implement a documented tablist pattern with explicit tab/close focus handling; add `aria-controls` for the selected tab and keep the close control separately labelled.
- Confidence: medium-high. The nested interactive structure and divergent event handling are directly visible; the exact announcement varies by platform and screen reader.

## Rejected / out of scope

- `launcher/src/Browser.tsx`: rejected as a file-specific inspection target because it does not exist at baseline `5401800`; the available browser caller is `BrowserSurface` in `launcher/src/App.tsx`.
- Branding or naming changes: rejected. Connector names, route names, model names, technical identifiers, and service identifiers were treated as compatibility or configuration data, not branding problems.
- Generic visual preferences: rejected. No spacing, color, animation, or copy item is recorded without a reachable interaction, state, responsive, or accessibility consequence.

## Clean areas

- `launcher/src/browser-controls.ts:9-35`: passkey and existing-Chrome availability correctly exclude authenticated sessions and cross-block the two login flows while a turn or the other login flow is active.
- `launcher/src/App.tsx:1749-1803`: saved MCP credentials are rendered as a non-editable success notice; entering credential fields requires the explicit `Replace credentials` action, and `Keep saved credentials` exits replacement mode.
- `launcher/src/ExistingChromeLoginGuide.tsx:59-93` and `launcher/src/PasskeyLoginGuide.tsx:21-53`: terminal failure/cancel/timeout states expose retry or re-entry actions while pending actions are disabled, and error messages use `role="alert"`.
- `launcher/src/nekodex.css:351-380`: tab-strip overflow is horizontally scrollable and the wizard step labels collapse at narrow widths; the review did not find a standalone overflow defect in those rules.

## Notes

- Review method: manual source review of the requested files plus direct UI callers and the relevant browser-host verification path.
- Verification policy applied from `skills/right-size-test-runs/SKILL.md`: manual review only; no automated checks were run.
