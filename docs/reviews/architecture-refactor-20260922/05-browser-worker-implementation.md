# Lane 05 implementation — browser worker

Baseline reviewed: `53d17361f3e9c81910055a7e2c18759ffce458bc`. Shared worktree retained; no branch switch, commit, push, app launch, live provider, installation, release or extra agent.

## Finding dispositions

- **05-browser-worker-F1 — implemented.** Independently confirmed selection, three page-scoped maps, final model proof and usage projection were distributed through the worker. `browser-model-selection.ts` now owns a typed controller with resolved-mode selection, Think mutation, read-only pre-send verification and accepted-usage projection. It owns the maps and model-specific error/version helpers. Composer acquisition, dialog checks and bounded observation are narrow injected functions; the controller has no runtime worker import. The pure mode resolver, semantic selectors and effort stabilizer retain their existing owners.
- **05-browser-worker-F2 — implemented.** Independently confirmed both absent-DOM/live-progress early branches called `clearMissingResponse()`, leaving empty-answer and missing-action timestamps intact. Both now call `suspendForLiveProgress()`, which resets all three grace windows and preserves response history. `update(externalProgressLive)` shares that reset. Completion predicate/tracker, DOM-health tracker and bounded external-progress policy now live in `browser-response-policy.ts`. The old public `clearMissingResponse()` retains its narrow behavior.
- **Lane07 attachment integration — implemented.** After lane07 published `attachment-payloads.ts`, removed the four worker implementations and imported `assertChatGptPromptAttachments` and `chatGptPromptFilePayloads`; re-exported the original three public helpers. Lane07 owns the shared implementation and its payload verification; no duplicate implementation or tests added here.

## Changes and preserved boundaries

`browser-operation-support.ts` contains the existing cancellation helpers and composer keyboard constants used by worker and model selection, preventing a circular runtime import or copied primitives. Existing public worker exports remain facades. Private selection/send delegates remain callable by focused fixtures; controller creation is lazy and selection remains scoped to its owning worker and Page.

Think mutation stays at the original post-connector attachment points. Final Luna/Think verification only reads prepared state. Model family/effort proof, pinned staging, Pro-unavailable classification, menu-cleanup error precedence, page/URL receipts and observed-versus-pinned usage precedence remain intact. Cancellation is additionally checked before selection acquires the composer, and the existing abort signal is now forwarded when ordinary Luna clears Think.

Durable send activation, Enter, submission evidence and helper/host protocol are unchanged. Tool-batch pre-answer capture/acknowledgement order, post-tool completion requirement, multipart acknowledgement equality and broker completion fence remain in the worker. Multipart DOM grace remains 180 seconds, and external progress retains its age and clock-skew bounds.

## Focused verification

Applied `/Users/alex/.codex/skills/right-size-test-runs/SKILL.md`. No package/repository suite, typecheck, build or UI launch. Parent owns integrated types/build/UI checks.

Commands were run from `/Users/alex/Dev/nekodex-refactor-20260922`:

1. `bun test tests/browser-worker-final-mode.test.ts` — **3 passed**, 166 assertions, 2.45 seconds. Existing real send-boundary fixtures reject Luna/Think drift before activation while preserving the prepared draft, and accept valid modes.
2. `bun test tests/browser-model-selection-controller.test.ts` — **4 passed**, 14 assertions, 5.33 seconds before consolidation into the parent-authorized existing fixture. The unchanged cancellation case remains in this file; the other three cases were removed after migration. Executed under Python `subprocess.run(..., timeout=30)`. Covers pinned version drift reached after send readiness (with cleanup fault), successful activated send, pinned lower-effort staging and pre-aborted selection before composer acquisition. The three initial passing cases were rerun only after the delegate/cancellation changes; the later six-case existing-file run verifies the consolidated final fixture. Initial fixture authoring had an invalid Reflect assignment; it was corrected before the passing runs and was not a product failure.
3. `bun test tests/browser-response-policy.test.ts` — **6 passed**, 28 assertions, 0.146 seconds. Executed under Python `subprocess.run(..., timeout=30)`. Fake-clock empty-answer and missing-action cases execute each shipped worker early-continue branch and assert the suspension operation was reached, then require a fresh full grace before failure. Additional controls preserve saw-response history and post-tool changed-answer settling.
4. `bun test tests/pro-model-selection.test.ts --test-name-pattern 'version reset during|menu cleanup failure|verified 5.6 Pro|effort reset to non-Pro|preparatory low-effort'` — **6 passed**, 14 filtered out, 34 assertions, 11.91 seconds. Executed under Python `subprocess.run(..., timeout=30)` after the parent-authorized fixture migration; no selected failure remains.
5. `git diff --check -- src/adapters/chatgpt-web/browser-worker.ts tests/pro-model-selection.test.ts tests/browser-worker-contract.test.ts` — passed. Reviewed affected source diff and new modules for moved ownership, retained exports and unchanged send/protocol ordering.

The branch-execution fixtures parse the real worker with TypeScript and execute only the two suspension branches. They establish wiring and timer behavior, **not** complete browser-turn execution or live provider behavior. The model fixture uses the actual worker prototype and lazy controller, with browser boundaries simulated from the existing sanitized picker fixture.

## Exact lane-owned changed paths

- `src/adapters/chatgpt-web/browser-worker.ts`
- `src/adapters/chatgpt-web/browser-model-selection.ts` (new)
- `src/adapters/chatgpt-web/browser-response-policy.ts` (new)
- `src/adapters/chatgpt-web/browser-operation-support.ts` (new)
- `tests/browser-model-selection-controller.test.ts` (new)
- `tests/browser-response-policy.test.ts` (new)
- `tests/pro-model-selection.test.ts` (parent-authorized fixture migration)
- `tests/browser-worker-contract.test.ts` (parent-authorized removal of exact suspension-call count assertion)
- `docs/reviews/architecture-refactor-20260922/05-browser-worker-implementation.md` (new)

`src/adapters/chatgpt-web/attachment-payloads.ts` is a lane07 dependency, not a lane05 edit. `browser-helper-main.ts` was not edited. Only the subsequently parent-authorized portions of shared tests were changed.

## Integration constraints / stale fixtures

Parent subsequently assigned the exact suspension-count assertion and the existing Pro fixture migration to this lane. The brittle `clearMissingResponse()` call-count assertion has been removed; `browser-response-policy.test.ts` provides behavior and wiring evidence instead. The rest of the named Stopped-thinking test is independently source-layout-coupled: it searches a one-line throw in both loops, while the main loop already used a diagnostic block at baseline. It was not run as meaningful evidence or modified beyond the specifically authorized count assertion; parent was notified of this separate stale expectation.

The existing `tests/pro-model-selection.test.ts` fixture now retains one real worker prototype/controller state, simulates closed/open picker semantics and editable composer, and supplies expected mode in its correct send argument slot. Drift is injected after a valid selection; rejection cases assert readiness was reached and activation/Enter were blocked. The duplicate new Pro cases were consolidated into this existing file. The new controller test file retains only cancellation-before-acquisition coverage.

The exact six selected existing Pro cases are:

- `a version reset during connector or file attachment prevents the send activation`
- `menu cleanup failure cannot mask a pre-send model mismatch`
- `menu cleanup failure still blocks a send after successful verification`
- `a verified 5.6 Pro selection permits one send` (also retains same-family re-selection check)
- `an effort reset to non-Pro prevents the send even when the version still matches`
- `preparatory low-effort stages of pinned Pro stay on that version`

These are executed directly after fixture migration rather than substituted by duplicate tests. Integrated compiler/build checks remain parent-owned.

## Integrated-check follow-up: retained liveness consumer

Parent's integrated core check found a missing `chatGptExternalProgressIsLive` binding in `waitForNewAssistantTurn`. The worker still uses this leaf helper when an ordinary DOM observation fault occurs after submission; extraction had incorrectly removed its import while moving the other policy consumer. Restored the direct import from `turn-progress.ts`, preserving the existing per-stage grace semantics.

Added two focused cases to `tests/browser-response-policy.test.ts` that invoke the real worker method, inject an ordinary observation error, and assert that the intended catch boundary was reached. Active MCP work causes one progress wait and a successful second observation; absent liveness preserves the exact original fault without waiting. Command: `bun test tests/browser-response-policy.test.ts --test-name-pattern 'accepted-turn observation fault'`, under Python `subprocess.run(..., timeout=30)` — **2 passed**, 6 filtered out, 6 assertions, 0.251 seconds. No global types/build rerun.
