# Lane 15 — App shell, account settings and onboarding renderer

Baseline inspected: `53d17361f3e9c81910055a7e2c18759ffce458bc` in `/Users/alex/Dev/nekodex-refactor-20260922`. Read-only source review; **no tests/builds run**, no apps launched, no real accounts/providers used, no agents spawned. Only this report was written. References below are baseline line numbers, relative to this checkout.

Read the account, shell, overview and onboarding sections of `docs/reviews/app-improvements-20260922.md`, `app-improvements-wave3-20260922.md`, and `app-improvements-waves4-5-20260922.md`. Existing quota deadline handling, proxy draft recovery, expired-session resume, diagnostic invalidation, readiness priority and same-identity handoff refresh are retained, not reported as new fixes. The verification proposals follow `right-size-test-runs`; parent owns integrated builds/UI, Git and publication.

## 15-app-accounts-ui-F1 — Extract connection/settings feature boundaries from App

**Priority: worthwhile architecture improvement; not a claimed runtime failure.**

**Evidence:** `launcher/src/App.tsx:1950–2230` contains model setup, `2232–2715` the tunnel wizard, and `2775–3179` Settings. These coexist with startup event ordering (`194–583`), shell/browser-surface ownership (`730–1356`), browser actions and updater coordination in a 3,946-line module. Adding an ordinary setting currently requires editing the same module that serializes native browser visibility and receives authoritative runtime snapshots. Settings alone repeats local-busy/error/finally handling at `2821–2829` and `2844–2957`, while several actions have materially different receipts. This is a concrete extension cost, not a request for a new routing framework.

**Concrete change:** Move `SetupSurface`, `McpSurface` and `SettingsSurface` into named feature modules with their existing typed props. Keep navigation, account return target, snapshot/event reconciliation, updater handlers and native browser visibility queue in App. Move only the shared presentation helpers those screens actually use to `launcher-ui.tsx`; move `currentToolProof` and its runtime/connector helpers (`App.tsx:71–98`) to `launcher-readiness.ts` so extracted features do not import App. Move the MCP media constant with its wizard, preserving relative asset resolution. Avoid a barrel that re-exports App or a new global context/store.

Within Settings, replace repeated preference busy/error plumbing with a local guarded action runner. Preserve action-specific preparation and receipt handling: retire route diagnostics before a mode transition, only retire removal evidence after non-cancelled uninstall, clear Doctor evidence on a new read, preserve dirty capacity input, and distinguish an already-committed MCP setup from a failed metadata refresh (`2371–2399`). Do not generalize these into one success boolean. Keep component identity and keyed surface unmount behavior (`1209–1213`) unchanged.

**Benefit:** Feature additions become local to a screen; the top-level module retains the ownership-sensitive orchestration. Screen actions remain readable rather than disappearing into a generic command dispatcher.

**Disjoint write set:** `launcher/src/App.tsx`; new `launcher/src/SetupSurface.tsx`, `McpSurface.tsx`, `SettingsSurface.tsx`, `launcher-ui.tsx`, `launcher-readiness.ts`. One lane-15 implementation owner must own this entire coupled extraction. No edits to `types.ts`, i18n, updater or Electron/backend files. Other lanes needing App props send wiring requirements to that owner/parent; they must not also edit App.

**Smallest verification:** Parent reuses existing named Settings mode/removal/Doctor cases and one fixture-only account→shared-tools→return flow; verify target account focus and no implicit account verification or credential replacement. Maximum 30 seconds per focused command, 10 seconds per UI case. Parent performs the single integrated typecheck/build after all owners settle. No renderer-wide or backend suite is requested.

## 15-app-accounts-ui-F2 — Account snapshot and login controllers with explicit ownership

**Priority: worthwhile reusable contract; behavior-preserving refactor.**

**Evidence:** `AccountSettings.tsx:90–131` and `AccountToolsOnboarding.tsx:65–105` independently implement `accounts()` reads, 150 ms event coalescing, in-flight exclusion, revision rejection, event subscriptions and cleanup. They intentionally differ in initial-load timing and failure presentation, which should be explicit options rather than duplicated lifecycle code. AccountSettings also owns login snapshot/polling (`192–253`) and start/action/cancellation (`379–435`) alongside quota hydration and a large account-card render. A new login action must understand refs, maximum poll count, settling state, account locks and renderer presentation in the same component.

**Concrete change:** Introduce a domain-specific `useAccountPoolSnapshot` returning snapshot, loading/stale-failure state, retry/invalidate and a mutation-receipt application operation. Parameterize immediate versus scheduled initial read and identity reset. Retained stale data remains visible but mutation-disabled in Accounts; the handoff continues hiding unavailable evidence. Events arriving during a read must invalidate it and schedule exactly one replacement. Applying a mutation receipt must retire older reads before accepting the next one.

Introduce `useAccountCodexLogin` for snapshot recovery, bounded polling and account/flow-bound start/open/copy/cancel. Return a small view model and typed actions, retaining current polling limits, three-failure behavior, deadline/settling distinction, start-error recovery read, and cancellation permission during lifecycle transitions. Keep account quota/evidence epochs separate; these are not interchangeable async requests. Pass the current account/transition lock inputs explicitly. Do not reset host login flows when the renderer unmounts or infer cancellation from a dropped local callback.

Inspecting callers confirms per-account tools verification remains `checkAccount(account.id, true)` (`AccountSettings.tsx:574–579`), while `account-tools-onboarding.ts:12–20` requires browser ID, selected ID and verified account agreement. Preserve those contracts; a shared pool hook must not substitute the globally selected account for an action's captured ID.

**Benefit:** New account actions can reuse snapshot invalidation and login lifecycle without duplicating polling or weakening exact-account semantics. AccountSettings becomes smaller while keeping quota concurrency visible and independently reviewable.

**Disjoint write set:** `launcher/src/AccountSettings.tsx`, `AccountToolsOnboarding.tsx`; new `useAccountPoolSnapshot.ts`, `useAccountCodexLogin.ts`. The same lane owner handles these together. No changes to AccountCodexControls props are necessary. Backend account/auth lanes retain their own IPC implementation; coordinate only if they change the existing contract.

**Smallest verification:** Deferred-promise component cases: browser event overtakes an initial read; failed refresh retains Accounts data but disables mutations; browser/account identity switch rejects the old handoff; login cancellation uses original flow/account during a transition. Reuse applicable cases in `account-settings-ui.test.cjs` and `workspaces-handoff-ui.test.cjs`, adapting their module harness where extraction requires it. Maximum 30 seconds per focused command; no live login.

## 15-app-accounts-ui-F3 — Safety draft reconciliation and local restore

**Priority: bounded UI improvement plus source-confirmed draft-loss condition.**

**Trigger/evidence:** A safety form has unsaved edits and receives a changed saved policy for the same account. `AccountSafetySettings.tsx:23–31` unconditionally replaces every draft field whenever serialized policy changes. The form then loses the unfinished edit. Ordinary snapshots with identical policy do not trigger this; this is specifically changed saved evidence, not a claim that every host event loses edits. AccountSettings subscribes to host changes (`90–131`) and mounts forms under account-ID keys (`507`, `632–640`); the backend safety setter publishes the updated pool (`launcher/electron/account-pool.cjs:420–424`). The corresponding proxy form already preserves dirty input (`AccountProxySettings.tsx:30–43`) and offers a no-IPC restore (`56–59`, `78–79`). Safety has only Save and Resume (`107–111`), forcing users to reconstruct saved values or leave the screen to abandon invalid edits.

**Concrete change:** Give safety a coherent raw draft object including the enabled flag and textual window inputs, with conversion/validation kept separate. Reconcile host updates using previous saved policy, account identity and a matching submitted-value acknowledgement. Adopt new policy for a clean draft; preserve dirty/invalid input for the same account; reset on account change. Add “Restore saved policy” using the newest saved prop, disabled during pending save or existing account/transition locks. Restoration must issue zero IPC and must not resume pacing. Keep existing range validation and unstopped session-limit Resume behavior. Parent supplies localized copy; do not hard-code English or edit shared i18n from this lane. No generic forms framework is warranted.

**Disjoint write set:** `launcher/src/AccountSafetySettings.tsx` only, plus a focused test addition in `launcher/tests/account-form-recovery-ui.test.cjs` assigned to this owner. Proxy remains an unchanged reference. Parent owns the new copy key/translations.

**Smallest verification:** One component scenario preserving an invalid dirty window input across saved-policy change, restoring the latest policy with zero save/resume calls, then resetting for a different account. Reuse existing pending-save/Resume gate evidence; rerun its selected case only if touched. Maximum 30 seconds for the command; parent may include one keyboard restore interaction in its existing Accounts UI flow.

## Ownership and limits

The three write sets are disjoint, but one of the requested implementation agents can own this lane sequentially. No additional agents are requested. Shared i18n, integration and build/UI coverage remain parent-owned. Existing `workspace-readiness.ts`, `RouteDiagnostics.tsx`, `Overview.tsx`, `AccountReadiness.tsx` and the Chrome/passkey guides do not require independent changes from this review. Their small duplicated presentation fragments do not justify another framework or refactor in this batch. All findings above are source-grounded proposals; no runtime reproduction or completion claim is made.
