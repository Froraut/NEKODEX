# NEKODEX mixed-model experiment review wave 1, lane 11

- Baseline: `9925453`
- Review type: manual source review only
- UTC start: `2026-09-15T20:28:38Z`
- UTC end: `2026-09-15T20:31:31Z`

## Inspected scope

Primary file:

- `src/adapters/chatgpt-web/browser-worker.ts`
  - `submissionDomState`
  - `waitForNewAssistantTurn`
  - `waitForSubmissionAcceptedWithRecovery`
  - `sendAttachedPrompt`
  - `responseDomSnapshot`
  - the main response observation loop in `runBrowserTurn`

Direct callers and contracts read only as needed to establish trigger and impact:

- `src/chatgpt-session.ts` for the user and assistant turn selectors
- `src/adapters/chatgpt-web/adapter-error.ts` for post-submission error classification
- `src/adapters/chatgpt-web/index.ts` for `submissionLifecycle` and retry handling
- `src/adapters/chatgpt-web/browser-helper-main.ts` and `src/adapters/chatgpt-web/launcher-helper-client.ts` for the Send activation/submitted boundary

No other wave report was read. No source edits, tests, typechecks, scripts, live actions, commits, or delegation were performed.

## Findings

### 1. High: response observation failures are silently converted into an absent response

- Exact location: `src/adapters/chatgpt-web/browser-worker.ts:3969`, `ChatGptBrowserWorker.responseDomSnapshot`; especially lines 4410–4415.
- Executable trigger: bind an assistant turn, then make the `page.evaluate` used by `responseDomSnapshot` reject or exceed its two-second observation timeout while the response is still present. This includes a transient renderer/Playwright evaluation failure. The catch converts every failure to `undefined`, and the function returns `absentResponseDomSnapshot()` unless the page is closed.
- Impact: the main response loop receives `responsePresent: false` and does not enter its internal observation-fault retry path at lines 5325–5346. A transient observation failure can therefore be treated as a missing response, causing DOM-health expiry or an incorrect stopped/missing-response outcome. A genuine evaluation error also loses its failure class and diagnostic cause. This is especially misleading after a submission because the accepted turn can be reported as absent even though the worker failed to read it.
- Smallest fix: preserve the failure from the `page.evaluate` wrapper. Re-throw observation-timeout/transport failures so the existing observation recovery or bounded internal-fault path handles them; only return an absent snapshot for an explicitly proven detached/missing response, and retain the original error as the cause when downgrading is intentional.
- Severity: high for accepted turns because it can terminate a valid response and misclassify the failure; it does not itself replay the submitted prompt.
- Confidence: high. The unconditional `.catch(() => undefined)` is on the exact observation operation, while the caller’s retry logic depends on that operation rejecting.

### 2. Medium: response DOM visibility is scoped to the candidate node, so hidden descendants can be emitted

- Exact location: `src/adapters/chatgpt-web/browser-worker.ts:3969`, `ChatGptBrowserWorker.responseDomSnapshot`; the local `renderedInDom` predicate around lines 4018–4024 is used to build `allMarkdownRoots`.
- Executable trigger: within the bound assistant turn, leave a `.markdown` node connected with non-hidden computed style, but place it under an ancestor marked `hidden`, `aria-hidden="true"`, `inert`, or otherwise visually suppressed by an ancestor. The predicate checks only the candidate’s own `display`, `visibility`, `opacity`, and `isConnected`, so the candidate can enter `allMarkdownRoots` and then `visibleText`, `fullHtml`, and `markdownSegments`.
- Impact: stale/collapsed accessibility or renderer projections inside the same assistant turn can be treated as answer content. That can duplicate or leak text into the emitted response, perturb Markdown consistency, and affect completion/action association. The separate stopped-thinking predicate walks ancestors, which makes the narrower response filter an inconsistent DOM-scope boundary.
- Smallest fix: make `renderedInDom` reject a candidate when any ancestor through the bound root is `hidden`, `aria-hidden="true"`, `inert`, `display:none`, `visibility:hidden/collapse`, or fully transparent according to the existing hidden-element rules; keep the check bounded to the bound assistant root.
- Severity: medium. It requires a hidden projection to coexist inside the current assistant turn, but when it occurs the returned answer can be wrong rather than merely delayed.
- Confidence: high for the code path; live ChatGPT DOM frequency was not tested by instruction.

## Design limitation, not a bug

`sendAttachedPrompt` invokes `onSendActivated` before pressing Enter and only invokes `onSubmitted` after semantic submission evidence is observed (`src/adapters/chatgpt-web/browser-worker.ts:3631–3651`). If the activation acknowledgement or the Enter action fails after the activation boundary, the caller classifies the turn as ambiguous/submitted and disables automatic replay. This can leave a user-visible failed turn even when the browser may not have accepted the message, but it is a deliberate fail-closed protection against duplicating an already submitted prompt and tool actions. I found no concrete basis in this file for calling that policy a current bug.

## Zero-findings note

The review produced two concrete current bugs above. No third finding met the requested bar of an executable, non-speculative defect in the inspected scope.
