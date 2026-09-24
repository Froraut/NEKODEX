# Lane 05 — browser worker / model selection

Baseline: `53d17361f3e9c81910055a7e2c18759ffce458bc`, confirmed in `/Users/alex/Dev/nekodex-refactor-20260922`.

Read-only source review. No tests, builds, applications, real accounts/providers, or agents were run. Only this report was written. Verification proposals follow `right-size-test-runs`; parent owns integrated checks, Git and publication.

Reviewed the relevant completed-work sections in `docs/reviews/app-improvements-20260922.md:59–88`, `app-improvements-wave3-20260922.md:55–86`, and `app-improvements-waves4-5-20260922.md:71–105`. Attachment naming/bytes, multipart receipt monotonicity, and final Luna/Think drift rejection are existing fixes, not new findings. Source is authoritative. Findings below concern bounded architecture improvement and one additional source-confirmed failure; neither requires a product decision.

## 05-browser-worker-F1 — Extract the model-selection transaction and its pre-send proof

**Priority:** worthwhile architecture improvement; no newly claimed model-selection defect.

**Evidence / extension cost.** `src/adapters/chatgpt-web/browser-worker.ts` is 6,163 lines. One coherent model policy is distributed across error/version helpers at **219–301**, Luna/Think mutation at **1506–1584**, three per-page maps and associated methods at **2369–2395**, selection at **2704–2900**, final proof at **3946–4010**, and accepted-usage projection at **5070–5088**. A new supported picker mode requires understanding both selection and a second interpretation of that mode embedded inside submission. The worker simultaneously owns page acquisition, leases, prompt/file mutation, connector consent, response streaming and usage notification.

`src/adapters/chatgpt-web/model.ts:32–96` already provides a useful pure capability-to-mode resolver. Preserve that separation. The missing boundary is the stateful UI transaction around its result, not another generic model registry.

**Callers inspected.** Initial and retained turns select at worker **5389–5403**; multipart stages repeat selection at **5420–5437**, return to final effort at **5533–5550**, and connector-catalog recovery selects again at **5604–5613**. Think activation deliberately occurs after connector attachment at **3825** and **3842**. All final checks run through `sendAttachedPrompt`; its durable activation callback and actual Enter remain at **4012–4021**. The helper forwards `onSendActivated` through acknowledged IPC, and `launcher-helper-client.ts:589–603` waits for the daemon callback before acknowledging. Do not move this ownership into the picker module.

**Concrete change.** Introduce `src/adapters/chatgpt-web/browser-model-selection.ts` containing one page-scoped selection controller with explicit operations for selecting a resolved mode, setting Think at the existing attachment point, and read-only verification before send. Keep the maps private to that controller and expose a narrow usage observation projection for the worker (observed versus validated pinned version). Move model-specific error/version helpers with it. Supply only narrow existing composer/dialog/observation dependencies where needed; the module must not import the worker at runtime or receive the whole worker as an untyped context. Keep `model.ts` pure, existing semantic selectors in `chatgpt-session.ts`, and slider stabilization in its existing module.

Use compatibility exports from the worker where existing consumers import its exported helpers. Retain thin private delegates initially where focused fixtures invoke the actual worker methods; do not require a broad fixture migration just to move code.

**Preserve.** No fallback model, no relaxed family proof, per-page/URL receipt identity, cancellation and existing stage deadlines, cleanup-error precedence, Pro-unavailable classification, and read-only final Luna/Think checks. Selection and verification are distinct operations: verification must never clear or repair the prepared draft. Connector selection and consent stay in the worker. The timing of durable send activation and submission evidence stays unchanged. Benefit: subsequent model/effort additions have one UI-policy owner without touching lease or streaming orchestration.

**Write set.** Worker plus new `browser-model-selection.ts`; narrowly affected existing model fixtures only if required. No helper/client protocol, `model.ts`, `ui-labels.ts`, `markdown.ts`, host or UI edits required.

**Smallest verification proposed.** Reuse the real imported worker boundary fixtures in `tests/browser-worker-final-mode.test.ts` and select the existing Pro cases for version drift after attachment, cleanup-error precedence, a successful pinned send, and pinned lower-effort staging from `tests/pro-model-selection.test.ts`. Inspect any moved cancellation boundary with one aborted selection fixture if current selected cases do not cover it. Assert rejection before activation/Enter and unchanged draft, not source layout. Maximum **30 seconds per focused command**, no live provider or package suite. Parent chooses one shared run plan and any necessary build check.

## 05-browser-worker-F2 — Unify response-health suspension and fix stale terminal timers

**Priority:** P2 correctness defect plus coherent extraction; source-confirmed, not runtime-reproduced.

**Exact defect.** `ChatGptTurnDomHealthTracker` at worker **1691–1767** stores three grace windows. Its `update(...externalProgressLive: true)` correctly resets all three at **1722–1729** while retaining `sawResponse`. However, the main response loop at **5854–5860** and multipart acknowledgement loop at **4100–4105** bypass `update` when DOM is absent but MCP progress is live. They call `clearMissingResponse()` (**1710–1712**), which leaves `emptyCompletionSince` and `missingCompletionAction` intact.

**Trigger / deterministic reasoning.** First observe a present, non-running answer with text but no completion action: **1755–1762** starts the 60-second window. Next, DOM disappears and recent MCP activity remains live for more than 60 seconds; both callers repeatedly take the early-continue branch. When DOM returns with the same text and no completion action after liveness subsides, **1763–1764** immediately reports failure using the old timestamp. The interval explicitly treated as active work was charged against a terminal grace window. The analogous empty-answer sequence incorrectly consumes the 10-second window at **1742–1751**. Neither requires an explicit turn timeout or a stale/future progress timestamp.

Existing fixtures at `tests/browser-worker-contract.test.ts:3548–3585` cover clearing only the missing-response window; **3611–3665** exercise all-window reset by calling `update` directly. They do not cover the early-continue path after a different grace timer has already started.

**Concrete change.** Extract the existing completion/DOM-health policy into `src/adapters/chatgpt-web/browser-response-policy.ts`: completion predicate (**1468–1479**), completion tracker (**1622–1689**), health tracker (**1691–1767**), and bounded external-liveness predicate (**1787–1805**) with their policy constants. Add one explicitly named live-progress suspension operation that clears all terminal grace windows while preserving response history, and use it in both early-continue branches. Share that reset with `update` to avoid two definitions. Do not silently broaden the semantics of a method named `clearMissingResponse`.

Keep Playwright observation, acknowledgement side effects and scheduling in the worker. This is not a generalized async state-machine framework. Preserve the exact pre-tool text capture before `acknowledgeToolBatch`, post-tool answer requirement, multipart acknowledgement equality, and the broker completion fence at **5901–5948**. A policy completion candidate must not become authority to publish a response or download an artifact. Preserve the 180-second multipart DOM grace and existing progress age/clock-skew limits. Re-export existing public policy names from the worker to avoid unrelated consumer churn.

**Write set.** Worker, new `browser-response-policy.ts`, a small dedicated response-policy regression file, and the directly affected assertions in `tests/browser-worker-contract.test.ts`. Its exact count of `clearMissingResponse()` calls is implementation-coupled; replace only that affected assertion with the missing behavioral boundary evidence rather than updating a string-count expectation.

**Smallest verification proposed.** Fake-clock cases: start each affected grace window, suspend during absent DOM/live progress, restore the same stalled state, and show a fresh full grace interval before failure. Add one control preserving `sawResponse` and eventual failure after liveness expires. Prove both worker callers reach the shared suspension operation with a bounded fixture; a tracker-only test would miss today's wiring defect. Include one existing tool-batch completion control after extraction. Maximum **30 seconds per focused command**, no real waiting, browser launch or provider access.

## Ownership and exclusions

Assign F1 and F2 to **one lane-05 implementation owner**, sequentially: both edit `browser-worker.ts`. Their new modules are disjoint, but the shared worker is not. Parent must reserve worker edits from other implementation lanes; compaction/transport/artifact owners should hand over any necessary wiring rather than concurrently editing it. Existing externally visible contracts remain unchanged.

No additional changes proposed for `browser-helper-main.ts`, its small one-shot prompt-selection module, pure `model.ts`, locale labels or Markdown serialization. Helper protocol lifecycle work would overlap transport ownership and is not needed for these findings. Markdown already has a separate buffer/consistency boundary; no speculative rewrite or new link/file authority is justified here.
