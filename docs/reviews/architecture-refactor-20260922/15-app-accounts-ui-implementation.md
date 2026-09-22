# Lane 15 — App/accounts implementation

Baseline: `53d17361f3e9c81910055a7e2c18759ffce458bc`. Shared checkout `/Users/alex/Dev/nekodex-refactor-20260922`, branch left unchanged. Source changes only; no commit, push, application launch, provider/account activity, installation, release, or additional agents. Read the complete lane-15 review and applied `right-size-test-runs`.

## Finding disposition

| Finding | Disposition and independently checked evidence |
| --- | --- |
| F1 | Implemented. Baseline App contained all three feature screens alongside browser/native ownership and runtime event reconciliation. Extracted their existing typed props and screen logic. Kept navigation, account return target, keyed surface ownership, event reconciliation, browser visibility queue and updater handlers in App. No new routing framework/context. |
| F2 | Implemented. Both account consumers independently had debounce/in-flight/revision lifecycles. Shared the account-pool contract while retaining scheduled Accounts reads versus immediate identity-bound handoff reads and distinct failure presentation. Extracted login snapshot/polling/actions separately from quota epochs. |
| F3 | Implemented. Baseline safety effect reset drafts on changed serialized saved policy for the same account. It now reconciles clean/dirty/submitted draft ownership, retains invalid window text, and restores newest saved policy locally using the parent-supplied `copy.accountSafetyRestore`. |

No finding was rejected. Architectural F1/F2 are not represented as previously reproduced runtime defects. F3's trigger is changed saved policy, not every host event.

## Main changes and preserved boundaries

- `SetupSurface`, `McpSurface`, `SettingsSurface` are named feature modules. `launcher-ui` supplies the presentation/focus primitives actually used by these screens; it does not import App. `launcher-readiness` owns connector/runtime proof helpers without importing App. MCP media URLs remain relative to the same source directory. App is reduced from roughly 3,946 to 2,040 lines.
- Settings uses a component-local guarded action runner with a synchronous in-flight ref. Capacity draft reconciliation, Doctor clearing before read, pre-IPC mode diagnostic invalidation, cancellation-aware removal receipts, and the distinction between committed MCP setup and a failed metadata refresh remain explicit. Cancellation of context changes uses the same preference guard.
- `useAccountPoolSnapshot` takes a narrow `Pick` API plus initial-read, identity and retain-on-failure options. It returns snapshot/loading/failed, retry/invalidate, and `applyReceipt`. Events invalidate older reads, coalesce one replacement, and never overlap reads within an owner. Mutation receipts retire old reads before publication. Accounts retains stale cards while its existing failure guards disable mutations; handoff hides failed evidence. Account selection during browser login also applies a receipt through this contract.
- `useAccountCodexLogin` takes only login API methods, transition/load locks, a quota-busy query and error sink. It preserves bounded polling (105 settling polls; otherwise remaining deadline plus 45, capped at 660), three consecutive failures, recovery after failed start, original account/flow IDs for actions, and cancellation during transition. Unmount disposes local observation without cancelling host login. Account quota/evidence ownership remains in AccountSettings.
- Per-account tools checks remain `checkAccount(account.id, true)`; the handoff still uses `accountToolsHandoffAccount` and its exact browser/selected/verified identity checks.
- Safety keeps a coherent draft object containing the policy, window toggle and raw window strings. Clean forms adopt new saved policy; dirty/invalid same-account edits survive; matching submitted values are acknowledged; account identity change resets the form. Restore has no IPC and does not resume pacing. Existing disabled, pending-save, range and unstopped session-limit Resume behavior is retained.

## Focused verification

No renderer build, repository/package suite, integrated typecheck or rendered application run was performed. All invocations below finished in well under 30 seconds. Tests execute source components/hooks with deferred promises and fake host APIs, not live providers.

1. `node --test launcher/tests/lane15-account-controllers.test.cjs launcher/tests/lane15-safety-draft.test.cjs`
   - Initial result: 8 passed, 1 fixture failure. The failed-start fixture changed its error callback between renders, legitimately causing an extra recovery snapshot effect. Corrected the fixture to use a stable callback; no production behavior was altered to satisfy it.
2. `node --test --test-name-pattern='failed start' launcher/tests/lane15-account-controllers.test.cjs`
   - 1 passed. Asserts start IPC reached once, recovery snapshot read and original actionable error.
3. `node --test launcher/tests/lane15-settings-surface.test.cjs`
   - 4 passed: pristine capacity refresh, dirty capacity/limits/save receipt, Doctor failure clears prior healthy evidence, mode change retires diagnostics before IPC and preserves same-mode evidence. These reuse the meaningful existing Settings scenarios against the extracted component.
4. `node --test --test-name-pattern='Accounts keeps' launcher/tests/lane15-account-controllers.test.cjs`
   - 1 passed. Refresh failure boundary reached; account card remains visible; checkbox disabled and directly invoking its handler makes zero mutation calls.
5. `node --test --test-name-pattern='guarded actions' launcher/tests/lane15-settings-surface.test.cjs`
   - 1 passed. Same-tick duplicate uninstall blocked; cancelled receipt retains diagnostics; successful removal invalidates them.

Across the selected invocations, all 15 final cases have passing evidence (7 account/controller, 3 safety, 5 Settings); unchanged passing cases were not rerun.

Controller cases also cover an event overtaking initial pool read with exactly one replacement, mutation receipt rejecting an old read, retained failure guard, old handoff identity rejection and failed handoff hiding, transition-time cancellation using original flow/account, and three-failure polling. Failure cases assert the intended IPC/read boundary was reached. Safety cases include invalid dirty-window preservation across changed policy, latest-policy restore with zero save/resume calls, identity reset, submitted-value acknowledgement/next clean update, and the existing pending-save/unstopped Resume gates.

`node /tmp/lane15-clean-imports.cjs` performed import cleanup and TypeScript syntax transpilation of the six shell modules. A one-off `node` heredoc using `typescript.transpileModule` checked the five account modules. Both passed syntax diagnostics; neither was a semantic typecheck or renderer/helper build. `git diff --check -- launcher/src/App.tsx launcher/src/AccountSettings.tsx launcher/src/AccountSafetySettings.tsx launcher/src/AccountToolsOnboarding.tsx` passed.

## Exact changed paths

- `launcher/src/App.tsx`
- `launcher/src/AccountSettings.tsx`
- `launcher/src/AccountToolsOnboarding.tsx`
- `launcher/src/AccountSafetySettings.tsx`
- `launcher/src/SetupSurface.tsx` (new)
- `launcher/src/McpSurface.tsx` (new)
- `launcher/src/SettingsSurface.tsx` (new)
- `launcher/src/launcher-ui.tsx` (new)
- `launcher/src/launcher-readiness.ts` (new)
- `launcher/src/useAccountPoolSnapshot.ts` (new)
- `launcher/src/useAccountCodexLogin.ts` (new)
- `launcher/tests/lane15-account-controllers.test.cjs` (new)
- `launcher/tests/lane15-safety-draft.test.cjs` (new)
- `launcher/tests/lane15-settings-surface.test.cjs` (new)
- `docs/reviews/architecture-refactor-20260922/15-app-accounts-ui-implementation.md` (this report)

Initial implementation did not edit shared `types.ts`, i18n resources, existing test files, or fixture server. The parent subsequently authorized the three existing-fixture migrations documented below; renderer source remains settled.

## Parent integration / rendered flow handoff

Parent owns semantic core/renderer types, renderer/helper build and actual rendered fixture coverage. Existing source-extraction tests that seek a Settings function declaration inside App must load `SettingsSurface.tsx`; imported top-level helper bindings are no longer declarations in App. Existing AccountSettings harnesses must load both hook modules with their injected React implementation and run effects by lifecycle/dependency semantics rather than old numeric effect positions. `workspaces-handoff-ui` needs `useRef` in its injected React hooks after the extraction. The three specifically reassigned existing harnesses are now migrated as documented below. Other shared tests remain untouched; behavioral assertions were retained.

Suggested fixture flow: account A → shared tools setup → return to account A; confirm focus stays on A, no implicit per-account verification or credential replacement, and explicit Verify targets A even if selection differs. Setup/MCP/Settings keep existing class names and actions. Relevant selectors: `.account-tools-handoff`, `.account-tools-onboarding h3`, `.account-safety`, `.account-new-session-window-fields`, `.account-safety button` by localized `accountSafetyRestore`, `.settings-select`, capacity input by localized `browserCapacity`, and Doctor/removal diagnostic buttons. Safety keyboard flow: expand details, edit window limit to empty, publish changed same-account saved policy, verify edit remains, Tab to Restore, activate and confirm latest saved values with zero save/resume calls. Existing pending/transition locks should disable restore.

No installed/released/live-account result is claimed.


## Parent-authorized existing-fixture maintenance

Renderer source was confirmed settled before this follow-up and **no renderer source changed during it**. Parent may run integrated types/build independently.

Additional exact changed paths:

- `launcher/tests/settings-snapshot-focused.test.cjs`
- `launcher/tests/account-settings-ui.test.cjs`
- `launcher/tests/workspaces-handoff-ui.test.cjs`

Settings now extracts the exported component from `SettingsSurface.tsx` instead of App, stripping the export modifier for its existing isolated-function harness. AccountSettings loads both extracted hooks using the same injected React implementation, uses a stable error callback, tracks effect dependencies/cleanup, and exposes `flushEffects()` in place of positional `effects()[n]()` calls. Existing effect invocations were mechanically migrated; semantic assertions were not weakened or duplicated. Handoff gained the missing injected `useRef` implementation.

Focused commands/results (each completed under one second, explicit 30-second test timeout):

- `node --test --test-timeout=30000 --test-name-pattern='doctor refresh|mode transition' launcher/tests/settings-snapshot-focused.test.cjs` — 2 passed.
- `node --test --test-timeout=30000 --test-name-pattern='same-identity|in-flight events|identity changes' launcher/tests/workspaces-handoff-ui.test.cjs` — 3 passed; workspace restore cases excluded.
- `node --test --test-timeout=30000 --test-name-pattern='rejected hydration|account tools check' launcher/tests/account-settings-ui.test.cjs` — 2 passed; other account cases not run.
- `node --test --test-timeout=30000 --test-name-pattern='guarded actions' launcher/tests/lane15-settings-surface.test.cjs` — 1 passed; reused existing lane removal coverage, no duplicate case added.
- `node --test --test-timeout=30000 --test-name-pattern='Accounts keeps' launcher/tests/lane15-account-controllers.test.cjs` — 1 passed; reused existing lane failed account-pool snapshot coverage, no duplicate case added.
- `git diff --check -- launcher/tests/settings-snapshot-focused.test.cjs launcher/tests/account-settings-ui.test.cjs launcher/tests/workspaces-handoff-ui.test.cjs` — passed.

The original assigned Settings file has no removal case, and the original account file has quota-hydration failure coverage rather than the failed account-pool refresh case. Those two requested contracts were therefore selected from their existing lane tests rather than copied into the migrated fixtures. This follow-up ran nine selected cases, not an all-UI suite. Remaining old source-text assertions outside these three files (for example App-location assertions in `renderer-wiring.test.cjs`) are outside ownership and were not run or broadly redesigned. Actual rendered integration remains parent-owned.
