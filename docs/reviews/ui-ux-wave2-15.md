# NEKODEX full UI/UX review wave 2 — lane 15

Commit reviewed: `540180047f8a6bee4b735d62a89d3eb64dc428a7`

Scope: manual source review of `launcher/src`, direct UI callers in `launcher/electron`, and the launcher state transitions reachable from the UI. No app start, runtime, scripts, tests, typechecks, commits, pushes, or delegation were used.

## Findings

### P1 — Browser tabs use an interactive close button inside a `role="tab"`

- Component/lines: `launcher/src/App.tsx:1124-1171`, `BrowserSurface` tab strip.
- Trigger: open Browser with a closable tab, then navigate the tablist by keyboard or use Tab to reach the close control.
- Actual: each tab is a `div role="tab"` with its own keyboard handler and `tabIndex`, while the close control is a nested `<button>`. This creates an interactive descendant inside another interactive widget. The tab handler also treats Space/Enter on the tab container as selection, while focus can move to the nested button. Screen readers and keyboard users can receive conflicting tab/close semantics, and the close action is not represented as a sibling control in the tablist model.
- Expected: a tab is a single tab-stop with `aria-selected`, and its close action is a separate, clearly labelled sibling control, or the tab is represented by a real tab button with a separate close button outside the tab element. The selected tab should expose a matching tabpanel relationship if the browser surface is treated as a tab interface.
- Smallest fix: keep the existing visual layout but split each item into a `role="tab"` button and a sibling close button outside that tab element; preserve the existing arrow/Home/End movement on the tab buttons and add `aria-controls`/tabpanel only if the tablist is retained as the semantic model.
- Confidence: high.

### P1 — Custom radio groups do not implement keyboard selection semantics

- Component/lines: `launcher/src/App.tsx:375-398` and `2643-2668` (`Onboarding` language picker and `WelcomeOption`); `launcher/src/App.tsx:2522-2558` (`InteractionModePicker`); `launcher/src/App.tsx:2327-2378` (`ZeroRiskModelMenu`).
- Trigger: reach one of these `role="radiogroup"` controls with a keyboard and use Arrow Left/Right/Up/Down, or enter the group with Tab.
- Actual: every option is a separate native button with `role="radio"` and `aria-checked`, but the groups do not implement roving `tabIndex` or arrow-key movement. All options can become separate Tab stops, and arrow keys do nothing. This is especially disruptive in onboarding because the language choice is the first required decision and the next step depends on it.
- Expected: a radio group has one tab stop, the selected option is the roving-tabindex target, and arrow keys change the selection while Space/Enter activates it. Native radio inputs would provide the same behavior with less custom code.
- Smallest fix: replace each custom radio option with visually styled native radio inputs, or add a shared radio-group implementation with one `tabIndex=0`, `tabIndex=-1` on the other options, arrow-key selection, and focus movement after selection.
- Confidence: high.

### P1 — The Bigger Context modal is not keyboard-contained

- Component/lines: `launcher/src/App.tsx:2917-2945`, `BiggerContextRecommendation`.
- Trigger: activate the Bigger Context details action from Settings, then continue with Tab or press Escape.
- Actual: the overlay advertises `role="dialog"` and `aria-modal="true"`, but it does not move focus into the dialog, trap focus within it, close on Escape, or restore focus to the invoking Details control. Keyboard focus can remain behind the overlay or move to background controls that are visually blocked. Escape is also handled only by the surrounding custom menu components, not by this dialog.
- Expected: opening the dialog places focus on its heading or first actionable control; Tab cycles through dialog controls; Escape closes it; focus returns to the Details button. `aria-modal` must match that actual interaction boundary.
- Smallest fix: add a dialog ref and open/close focus management, an Escape listener, and a two-control focus loop for the switch and Close button; restore focus to the Details button on close. A small existing dialog utility would be preferable if one is already available.
- Confidence: high.

### P2 — “Source & credits” is a direct repository link with no credits or attribution surface

- Component/lines: `launcher/src/App.tsx:816-823`, sidebar footer; `launcher/src/i18n.ts:86` (`sourceCode: "Source & credits"`).
- Trigger: activate the visible sidebar item labelled “Source & credits”.
- Actual: the item immediately calls `openExternal(snapshot.urls.github)`. The user is taken to the repository, with no in-app source/credits explanation, attribution, license information, asset credit, or clear distinction between source code and credits. The label promises a combined destination that the action does not provide.
- Expected: either label the action “Source code” when it opens the repository, or open a small credits/source view that includes the repository link and the relevant attribution/license information.
- Smallest fix: change the user-facing label to “Source code” if the intended scope is only the repository; if credits are required, add a lightweight credits surface and keep the repository as an explicit secondary link.
- Confidence: high.

## Rejected observations

- `codex-web-gpt-*` bundle names, Electron class names, browser partitions, diagnostic filenames, and IPC/runtime identifiers were not counted as branding defects. They are technical compatibility identifiers and are not directly visible in the normal launcher UI.
- The migration text naming Codex Native, Native2, Native3, Native4, Codex Zero Risk, Zero Risk2, and Zero Risk4 was not counted as a branding defect. It is conditional connector migration guidance and the text explicitly explains which old identities must remain untouched.
- MCP credentials are correctly rendered as a saved read-only state in `launcher/src/App.tsx:1748-1803`; editing is exposed through the explicit “Replace credentials” action. The wizard’s completed verification state likewise exposes explicit Verify/Done actions rather than silently reopening credential fields.
- Setup rows use the `complete` state to disable their normal action unless the row is explicitly repeatable (`launcher/src/App.tsx:2286-2303`). This satisfies the requested completed/read-only transition rule for those rows.

## Clean areas

- Branding is consistently NEKODEX in the normal launcher shell, onboarding header, title bar, fatal state, and the cat mark components.
- Brand marks are hidden from assistive technology when decorative and have a label when used as the standalone cat image.
- Passkey and existing-Chrome flows expose terminal error/retry paths, guard duplicate actions while pending, and use live status/error regions.
- Browser surface controls expose labels, disabled states, and visible focus styles; manual turn actions disable Copy/Send according to the tab proof fields.
- MCP guide media is selected per wizard step, pauses when its details element closes, and remains constrained by the responsive guide-media rules.
- The launcher uses explicit state fields for core setup, catalog verification, picker confirmation, MCP installation, and MCP verification instead of presenting a single undifferentiated “ready” flag.

## Notes and limits

- This is a source-only review. Visual pixel behavior, actual screen-reader output, native focus behavior, and screenshot rendering were not runtime-verified because the request prohibited app starts and tests.
- The findings are limited to reachable interaction defects, user-facing source/credits copy, keyboard/focus semantics, migration wording, and completed-state transitions in the requested launcher scope.
