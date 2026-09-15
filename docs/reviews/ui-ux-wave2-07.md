# NEKODEX full UI/UX review wave 2 — Luna medium, lane 7 accounts

Baseline: `540180047f8a6bee4b735d62a89d3eb64dc428a7` (`5401800`). Read-only source and screenshot review. Inspected `launcher/src/AccountSettings.tsx`, its direct caller in `launcher/src/App.tsx`, the MCP wizard and its direct UI helpers, the related CSS, and the MCP/settings screenshots. No tests, typechecks, scripts, runtime/app starts, commits, pushes, or delegation were performed.

`launcher/src/Accounts.tsx` is absent at this baseline. The account surface is implemented by `AccountSettings.tsx` and mounted by `App.tsx:834-836`.

## Findings

### UIUX-W2-07-01 — Verified account cards stay editable and continue to invite sign-in

- **Severity:** P1
- **Exact component/lines:** `launcher/src/AccountSettings.tsx:91-103`.
- **Trigger:** An account has `authenticated === true`, `checked === true`, and `connectorReady === true`; the user returns to the Accounts surface and reaches the card with a mouse or keyboard.
- **Actual:** The card always exposes an enabled `Sign in / Open` button, the `Check account` and `Check connector` actions remain enabled outside manual mode, and the enable checkbox remains mutable. The only lock is the unrelated page-wide `busy` flag. No explicit Replace/Edit/Upgrade action establishes a transition back into an editable state.
- **Expected:** A completed account should present a read-only verified state. Only an explicit Replace credentials/Edit or permitted Upgrade action should unlock the relevant account operation. The primary affordance should describe management of a completed account instead of inviting another sign-in.
- **Smallest fix:** Derive locked predicates from the account snapshot, disable or replace post-success actions by state, and add one explicit Replace/Edit/Upgrade action that owns the unlock transition. Give any disabled control a state-specific accessible explanation.
- **Confidence:** High; the control predicates and labels are directly visible in the component.

### UIUX-W2-07-02 — Incomplete accounts can be marked as the current account

- **Severity:** P1
- **Exact component/lines:** `launcher/src/AccountSettings.tsx:80-101`.
- **Trigger:** A loaded or newly added account has `authenticated === false`, `checked === false`, or `connectorReady === false`; the user activates `Select` on that non-current account.
- **Actual:** `Select` is disabled only for the current account or while `busy`. It does not consult any readiness flag and calls `api.selectAccount(account.id)`, after which the incomplete card receives the current/selected badge while its status facts still show pending.
- **Expected:** Selection should be gated by the minimum verified state required by the active routing mode, or the action should become `Continue setup` and leave the current account unchanged. The required next step should be exposed beside the action.
- **Smallest fix:** Add a mode-aware readiness predicate to the selection control; for an ineligible account, replace it with a setup action or disabled control with an associated explanation.
- **Confidence:** High for the UI state mismatch; the exact minimum readiness policy for each routing mode still belongs to the account-pool contract.

### UIUX-W2-07-03 — MCP wizard stepper does not expose the current step to assistive technology

- **Severity:** P2
- **Exact component/lines:** `launcher/src/App.tsx:1700-1713`.
- **Trigger:** A keyboard or screen-reader user opens Codex tools (MCP) and moves between the three wizard steps.
- **Actual:** The stepper is a plain `div` with an `aria-label` such as `2 / 3`; the buttons expose only an ordinal and title. The current step is conveyed visually by `is-active`, but no step button has `aria-current="step"`, and the container has no step-list semantics. A user can focus completed steps without a programmatic current/completed relationship.
- **Expected:** The current step, completed steps, and available previous steps should be announced as a coherent wizard progression. The focused/current step should be identifiable independently of the visual class and the `1 / 3` text.
- **Smallest fix:** Give the stepper an appropriate grouping/label, add `aria-current="step"` to the active step, and expose completion in the button name or state. Keep the existing disabled future-step rule.
- **Confidence:** High; this is determined from the rendered attributes and CSS class usage, without requiring live account behavior.

### UIUX-W2-07-04 — Closing the expanded MCP guide video loses keyboard context

- **Severity:** P2
- **Exact component/lines:** `launcher/src/App.tsx:2413-2428` and `2447-2477`.
- **Trigger:** A keyboard user activates `Expand guide video`, watches or pauses the modal video, then presses Escape or activates Close.
- **Actual:** The close button receives `autoFocus`, but after `setExpanded(false)` focus is not returned to the original expand button. The dialog also has no focus containment; background controls remain in the document's tab order while the portal is open. After closing, focus can land on the document body or an unrelated control, so the user loses their place in the wizard.
- **Expected:** Opening should move focus into the dialog, keep keyboard focus within it while open, and closing by Escape or Close should restore focus to the exact launch control.
- **Smallest fix:** Keep a ref to the expand button, add a dialog focus boundary appropriate to the existing modal implementation, and restore that ref on every close path. Preserve the current-time handoff.
- **Confidence:** High for lost focus restoration; the missing focus boundary is also directly visible in the portal structure.

## Rejected / out of scope

- `launcher/src/Accounts.tsx`: rejected as a separate component because it does not exist at baseline `5401800`; the available account surface is `AccountSettings.tsx`.
- Account snapshot freshness: not a new finding in this wave. `AccountSettings.tsx:16-59` subscribes to browser and operation events, coalesces refreshes, and invalidates stale replies by revision.
- Login selection race: not reported as a new UI finding here. The current pool path has selection revision checks and a pool-owned login operation at `launcher/electron/account-pool.cjs:298-318`; the renderer's duplicate selection is redundant but does not by itself establish a current source defect.
- MCP credentials fields after setup: not reported as a defect. `App.tsx:1749-1802` replaces the fields with a saved-credentials notice and exposes an explicit `Replace credentials` action before fields return.
- Branding and technical identifiers: no finding. Connector, route, package, filesystem, and service identifiers were treated as compatibility data, not branding problems.

## Clean areas

- `AccountSettings.tsx:67-70` provides a loading status and retry action, and the loaded section exposes `aria-busy` during account mutations.
- `AccountSettings.tsx:45-59` has event-driven refresh, request coalescing, disposal cleanup, and revision-based stale-response protection.
- `App.tsx:1749-1802` implements the requested read-only saved-credentials state with an explicit Replace and Keep credentials path.
- The inspected MCP screenshot shows one clear forward action on the initial step and a responsive stacked field layout is defined at `launcher/src/styles.css:2752-2805`; no additional reachable responsive defect was established from the static evidence.

## Review boundary

This is a manual source/screenshot review. It does not establish live ChatGPT account authentication, connector approval, actual browser focus behavior, or runtime rendering at every window size.
