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


## Follow-up: account and settings workflows

A second pass inspected the connected account forms and keyboard interactions.
Account creation was below every full account card, sign-in actions followed long
setup explanations, and an unavailable session check produced contradictory
sign-in instructions in tools onboarding. The Settings logout confirmation did
not respond to Escape and returned focus to the document body after cancellation.

Changes:

- Move the existing Add account form above the directory and account actions
  directly below identity/status. After a successful creation receipt, reveal and
  focus the new selected account heading. Failed creation retains the entered name.
- Distinguish checking, verification unavailable, and signed out in tools setup.
  Only verified session evidence can advance to automatic connector setup.
- Show unsaved, saving and failure indicators in pacing/proxy disclosure summaries.
  Existing save, restore and account ownership contracts are unchanged.
- Bind logout confirmation to the displayed account identity, show its name,
  dismiss with Escape and restore focus after cancellation.
- Reserve the fixed title bar in page scroll padding. The first real DEV creation
  exposed a clipped account heading; the corrected creation kept the full heading
  below the bar. Correct a Russian relative-time phrase in allowance freshness copy.

Focused evidence:

| Scenario | Result |
| --- | --- |
| Renderer build and fixture syntax | TypeScript/Vite and `node --check` passed. |
| Create failure then retry | Synthetic first attempt fails before mutation; the entered name remains. Retry adds one selected account, clears the error and focuses its heading. |
| Proxy editing | Unsaved indicator survives collapse; failed save retains the URL; retry receives a saved receipt and removes the indicator. |
| Pacing editing | Restore returns the prior interval; failed save retains the edit; retry persists it, and revisiting Accounts shows the saved value with Save disabled. |
| Session unavailable | Both English and Russian onboarding ask for verification; a synthetic successful retry advances to the runtime setup step. No provider sign-in is inferred. |
| Logout cancellation | Escape and Keep signed in both close confirmation and return focus to Log out. No logout was submitted. |
| Real source Electron | Added credential-free local DEV profiles; the final creation selected its new card and displayed the full heading below the title bar. The real unknown state shows Checking saved session. |
| Compact Russian, 760×680 | Long account name is focused at y≈76 below the 52px title bar; content scroll/client widths both equal 760px. Compact navigation remains usable. |

New replay fixtures: `accounts-ui-ready`, `accounts-ui-error`. Errors are synthetic
and scoped to the first create/proxy/pacing attempt; successful fixture receipts
update their exact account. Real proxy changes, pacing enforcement, provider
credentials and actual logout were not exercised. This follow-up changes renderer
presentation only and reuses the earlier evidence for unchanged Browser and main
screen behavior. The installed application remains unchanged.
