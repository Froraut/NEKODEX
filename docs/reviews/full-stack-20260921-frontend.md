# Frontend source review — 2026-09-21

Base inspected: `d6f8733` on the shared checkout. This lane read the current launcher source rather than relying on historical reports. The source pass covered Overview; Accounts, routing, Codex login, proxy and safety controls; Browser wiring in `App.tsx`; Activity and Usage; model and tool Connections; Updates; Settings and setup; the owned component helpers; and the loaded CSS layers. `App.tsx`, `types.ts`, `i18n*` and `main.tsx` were read only. The earlier `ui-polish-restart-5.8.0-nekodex.3.md` rendered evidence remains applicable to unchanged layout, responsive and reduced-motion behavior.

## Implemented in owned files

1. **Manual Overview readiness was internally contradictory.** Trigger: Manual interaction mode with no automated browser authentication. Impact: the Overview hero treated Manual as ready, while the Account connection row showed an idle dot and “Connect” semantics beside a “Manual” status. Fix: `Overview.tsx` now treats Manual as a ready Account connection, matching the existing hero and setup readiness rules.
2. **Initial Accounts load failure had no explanation.** Trigger: the first `accounts()` read rejects before any snapshot exists. Impact: the page rendered only a Retry button, with no failure text, despite the stale-snapshot path already explaining the failure. Fix: `AccountSettings.tsx` now renders the localized refresh-failure message, alert semantics, focused Retry control and a compact error layout.
3. **Terminal sign-in retry could be submitted more than once.** Trigger: rapid activation of Retry after passkey or existing-Chrome login failure. Impact: the Retry buttons were styled from `pending` but called `onRetry` outside the guarded action wrapper, and passkey actions used render state rather than a synchronous ownership ref. Fix: both guides route Retry through the guarded action; passkey actions now use an in-flight ref. Existing-Chrome “Copied” feedback also resets when a new `startedAt` identifies a new attempt.
4. **Usage failures had no immediate recovery action.** Trigger: a usage read returns unavailable or throws. Impact: the user had to wait for the 30-second poll or change window focus; stale cached figures remained visible but could not be retried directly. Fix: `UsageDashboard.tsx` now offers a localized Retry action for empty and stale failures, disables it while the exact query is refreshing, and retains the existing per-filter cache behavior.
5. **Thrown update checks used normal action copy.** Trigger: `recheckUpdate()` throws while the last updater state remains idle, current or available. Impact: the panel announced failure but labeled the recovery action as a normal check instead of Retry. Fix: `Updates.tsx` derives retry copy from either updater-state failure or the renderer error.
6. **Visible image labels were English-only on localized screens.** Trigger: a screen reader encounters the large brand or Overview illustration in a non-English locale. Impact: it announced “cat” / “coding cat” in English. Fix: the non-small brand and illustration now use the language-neutral product name `NEKODEX`; small decorative marks remain excluded as before.

CSS changes are limited to the new Accounts failure block and Usage retry placement. Existing focus-visible rules, responsive container rules and global reduced-motion handling were preserved.

## Exact parent-owned deltas

These are current-source findings in `App.tsx`; this lane did not edit shared files.

1. **Finish the Zero Risk menu busy transition.** The current shared edit correctly gates `choose(busy)` and disables both radios. Add an effect that performs only `setOpen(false)` when `busy && open`. Do not call `closeMenu()` from that effect because it schedules focus onto the now-disabled trigger.
2. **Own update-check admission synchronously.** Add `const updateCheckPendingRef = useRef(false)`. At the start of `recheckUpdate`, return when the ref, cooldown or busy flag is set; set the ref before state updates and clear it in `finally`. This covers a native update-panel request racing a renderer click before the busy render commits, without changing shared types.
3. **Own Manual sent-confirmation per tab.** Add a ref-backed set (or exact-tab ref) and rendered pending state around `confirmManualSent(tabId)`. Pass `confirmPending` to `ManualTurnGuide` and use `disabled={confirmPending || !tab.canConfirmSent}`. The host-projected `canConfirmSent` remains true until the confirmation result arrives, so the renderer currently permits duplicate consequential confirmations.
4. **Localize and validate the connector verification timestamp.** Replace the hardcoded `Last connector verification: ${new Date(...).toLocaleString()}` with a `Copy` key containing `{time}` and `toLocaleString(language)`, rendered only when the parsed timestamp is finite. Suggested strings: English `Last connector verification: {time}`; Russian `Последняя проверка подключения: {time}`; Simplified Chinese `最近一次连接器验证：{time}`; Traditional Chinese `最近一次連接器驗證：{time}`; Japanese `前回のコネクター検証: {time}`; Korean `마지막 커넥터 확인: {time}`.

The parent’s lifecycle-admission gate and context-queue deferral are deliberately outside this lane. No other App-specific defect was strong enough to expand that transition scope.

## Parent verification targets and limits

The focused integrated UI pass should exercise: Manual Overview connection semantics; initial Accounts load failure and Retry focus; one passkey and one existing-Chrome terminal retry with repeated activation blocked; Usage error Retry both with and without cached data; and an updater exception whose action says Retry. For shared deltas, cover a Zero Risk menu that is open when busy begins, a delayed Manual sent-confirmation, competing native/renderer update checks, and an invalid plus localized connector timestamp.

Per lane instruction, no tests, builds, verification scripts, screenshots, live app, provider account, secret, or network operation were run. No regression files were added. This is source-review and implementation evidence; the parent owns rendered and integrated confirmation.
