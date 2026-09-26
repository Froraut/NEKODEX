# Browser workflow correction — 2026-09-26

## Reproduction and outcome

The installed 6.1.0-nekodex.1 Browser screen displayed two adjacent pairs of
`New browser window` / `New browser tab` actions. The parent surface retained
its original actions after adding a workspace manager containing the same actions.
Its embedded home/task tabs, separate native windows and sign-in placeholder
appeared together without explaining their different scopes. Installed bundle
inspection and the live accessibility tree confirmed the reported duplication.

| Reported problem | Final behavior |
| --- | --- |
| Duplicate window/tab actions | One action pair lives in the collapsed-by-default separate-windows directory. |
| A new tab unexpectedly opens another window | The action is named `Add tab to window` and is available only after this account has an open window. |
| `Get started` alongside a `0 / 16` counter | The embedded home is labelled ChatGPT; the directory reports selected-account open/saved windows and explicitly labels the global window capacity. |
| Duplicate sign-in actions and navigation for a hidden page | One primary sign-in action; location/history/zoom controls render only with the visible embedded page. The location label has no editable-input styling. |
| Two independent account contexts | One controlled account selector calls the account pool. Both the embedded page and separate-window manager consume its selection. |

Related corrections found during the review:

- Home-page loading no longer counts as an active task in Browser or Overview.
- The account-specific open/restore IPC preserves the account label in native window titles.
- External sign-in guides own their continue/cancel/retry actions. Terminal failures retain
  embedded sign-in recovery, and completed guides no longer hide the ready-state action.
- Connections uses embedded sign-in as its primary action and follows Browser's account
  eligibility for the existing-Chrome alternative.
- A collapsed window directory still exposes a pending error indicator. Retrying successfully
  clears the previous error. Removing a saved entry is labelled separately from closing an open window.
- Empty-state actions wrap, and longer sign-in guidance can scroll in compact windows.

## Observed verification

Verification used the built renderer fixture and the real source Electron application
with a separate, credential-free DEV profile. No production profile was reused.

| Boundary | Observed result |
| --- | --- |
| Renderer build | `bun run --cwd launcher build` passed, including TypeScript checking and Vite bundling. |
| Changed CommonJS | `node --check` passed for account-pool and ui-preview. |
| Signed-out renderer | One `Sign in to ChatGPT`, one `Use passkey`, no location/history/zoom controls while hidden. |
| Account selection | Fixture window titles/list entries followed Secondary; returning to Primary showed zero Primary windows and retained the labelled global total. Real DEV selection switched between Primary account and a new local secondary profile. |
| Window/tab lifecycle | Real DEV opened a separate window, enabled adding a window tab, and showed a native macOS tab bar with two tabs. Closing both returned the directory count to zero. |
| Embedded view placement | Real ChatGPT login form appeared after the primary action. Expanding/collapsing the directory moved the native view below the controls without overlap. Hiding it restored the single sign-in state. |
| Window error recovery | The fixture's first open failed visibly; the next open succeeded, updated the count and removed the old alert. |
| External sign-in states | Fixture cancel exposed Retry and embedded sign-in; retry restored exactly one import action; completion removed the guide and exposed `Open ChatGPT`. Account selection was locked only during the active flow. |
| Home loading | The dedicated fixture showed zero active browser runs and a sign-in state while only home was loading. |
| Localization and compact layout | English desktop and Russian 760×680 Browser layouts were inspected. Account controls, window actions and sign-in buttons remained reachable. Compact navigation opened and closed with Escape. |
| Other screens | Overview, Accounts, Activity, Task center, Connections (both route and tools views), Settings and Updates were inspected. Task-center filtering changed three records to the single record needing attention. |

The UI fixture now projects workspace actions and account selection, and settles its
sign-in flows with the actual non-null operation-event contract. An initial fixture-only
null completion event was corrected before the final cancellation/completion check.

## Boundaries

The native window and embedded-page observations were real Electron behavior on macOS.
Passkey cancellation/completion used synthetic state transitions; no real credentials,
connector grants or model requests were submitted. Windows/Linux packaging and a release
build were not run. The installed application was not replaced.

The source change preserves existing account/session ownership, the native window manager,
task execution, persistence format, and model/connector routing. No dependencies or version
markers changed. The requested UI checks did not require the repository-wide verify suite.

Useful replay scenarios in `launcher/scripts/ui-preview.cjs`: `browser-ui-signed-out`,
`browser-ui-error`, `browser-ui-home-loading`, and `benefits-astra`; add `language=ru`
for longer localized labels. Fixture state is not provider authentication evidence.
