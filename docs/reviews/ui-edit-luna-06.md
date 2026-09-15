# NEKODEX UI edit — Luna medium, lane 6

## Scope

Requested ownership was limited to `launcher/src/Settings.tsx` and the two lane reports. The current shared tree does not contain `launcher/src/Settings.tsx`; settings and MCP surfaces are implemented inline in `launcher/src/App.tsx`, while account cards are implemented in `launcher/src/AccountSettings.tsx`.

The existing working tree already contains changes from other lanes in `App.tsx`, `AccountSettings.tsx`, `i18n.ts`, and `README.md`. Those files were inspected only to avoid overlapping writes. No source file outside the requested ownership was edited.

## Fixed roots observed in the current tree

- `AccountSettings.tsx` currently derives a fully verified state from authenticated, checked, and connector-ready evidence, disables the enabled checkbox and both check actions for that state, and labels the primary action `Replace credentials`.
- `App.tsx` currently exposes `aria-current="step"` on the active MCP stepper item and keeps saved MCP credentials behind an explicit replacement action.
- `README.md` and the visible English/Chinese/Japanese copy in `launcher/src/i18n.ts` contain the current NEKODEX branding corrections already present in the shared tree.

These are observed existing changes, not changes made by this lane.

## Partial

- Account selection is gated by `authenticated && checked` in the current `AccountSettings.tsx`. This prevents obviously incomplete accounts from being selected, but it still permits selection before `connectorReady` is true. The requested fully verified selection rule therefore remains partial.
- The verified account primary action is labelled `Replace credentials`, but it still runs the same account selection/open-login path as the normal sign-in action. The explicit replacement affordance is visible, while a distinct replacement transition is not established in this owned lane.
- The active MCP step is announced with `aria-current`, but the stepper does not yet expose completed state in an accessible name and the content transition does not move focus to the new step.

## Unfixed roots

- `launcher/src/Settings.tsx` is absent, so no owned source path existed in which to implement the requested settings fixes.
- MCP radio groups still expose custom `role="radio"` buttons without roving tab stops or Arrow/Home/End handling in `launcher/src/App.tsx`.
- The custom language listbox still lacks option keyboard navigation and reliable trigger focus restoration in `launcher/src/App.tsx`.
- Whitespace-only tunnel/API-key values still pass the MCP submit predicate; field-level invalid state and descriptions remain absent in `launcher/src/App.tsx`.
- MCP guide dialog and step transitions still have incomplete focus containment/restoration in `launcher/src/App.tsx`.
- Loading/error/retry behavior outside the already-present account loading retry path was not changed because its callers are outside the owned file.

## Rejected roots

- Editing `launcher/src/App.tsx`, `launcher/src/AccountSettings.tsx`, `launcher/src/i18n.ts`, or `README.md` was rejected for this lane because those files are outside the explicit ownership boundary and already contain shared-tree changes.
- Renaming package names, environment variables, service labels, route IDs, imports, filesystem paths, compatibility identifiers, or historical URLs was rejected as explicitly forbidden.
- A forced aesthetic pass was rejected; no visual-only change had a concrete interaction or accessibility basis within the owned path.
- Creating a new unmounted `Settings.tsx` shim was rejected because it would not change the live settings surface and would create an unsupported duplicate implementation.

## Changed files

- `docs/reviews/ui-edit-luna-06.md`
- `docs/reviews/ui-edit-luna-06.json`

## Verification and limits

Manual source review only. No tests, typechecks, scripts, runtime/app starts, screenshots were generated, commits, pushes, or delegation were performed. The report records source-level state only; it does not establish installed-app, live account, screen-reader, or runtime behavior.
