# Simplified Chinese stopped-thinking detection

This fork incorporates the focused correction from
[upstream PR #450](https://github.com/miuuyy/codex-chatgpt-web/pull/450),
authored by [Dongfang Liu (`liu-dongfang`)](https://github.com/liu-dongfang).
The reviewed source is commit
[`9eda72fd100b2b992b5075f3a3324e656d4d5cf3`](https://github.com/liu-dongfang/codex-chatgpt-web/commit/9eda72fd100b2b992b5075f3a3324e656d4d5cf3),
based on upstream `e85e3693fdb4e3e033348c08df0298c20fcdb612`.

## Corrected behavior

The bound-response detector previously recognized only `Stopped thinking`.
It now also recognizes the exact observed Simplified Chinese label
`已停止思考`, either as visible text or an accessibility label. The existing
visibility and response boundaries remain in place: answer content,
commentary, code, quotations, hidden elements, and old turns do not establish
this terminal status.

The existing error remains HTTP 502, `server_error`,
`chatgpt_stopped_thinking`, and `retryable: false`. The message now explains
that the status does not identify the cause and that the turn will not be
automatically sent again. It no longer suggests a usage limit without
evidence. Replaying the same failed request returns the failure without
starting another browser turn.

## Evidence and limits

The author reported the Chinese status in an installed macOS Full Harness /
ChatGPT Pro session. In the reported patched probe, a synthetic local file
read succeeded before ChatGPT later displayed the stopped status. See the
[related observations in issue #446](https://github.com/miuuyy/codex-chatgpt-web/issues/446#issuecomment-5644369585).
Those probes used an installation with other local patches; they do not
isolate the reason ChatGPT stopped.

The DOM test reconstructs the reported status button and executes the
production detection predicate with a synthetic visibility helper. It is
not a captured browser DOM or live account acceptance. During fork review,
the unchanged predicate passed 10 of 12 focused DOM cases and missed both
Chinese-label cases; the reviewed predicate passed all 12. The committed
regression also checks the exclusions above, and the harness regression
checks that a repeated failed request cannot trigger a resend.

This correction detects a stopped response and returns its existing typed
failure. It does not establish or resolve an upstream safety rejection,
account limit, network problem, or the absence of a final answer. No tool
annotations, permissions, approval checks, connector contract, model or
effort selection, retry policy, or fallback behavior is changed. The
separate transport-diagnostics proposal in PR #451 is not part of this
integration.

## Validation

The fork's focused stopped-thinking tests passed: 5 tests, 34 assertions,
across `browser-worker-contract.test.ts` and `chatgpt-web-harness.test.ts`.
Both complete test files also passed: 215 tests, 1,225 assertions. Root
TypeScript checking and the scoped whitespace check passed. These checks
use local synthetic state and do not send a prompt to ChatGPT.
Installed-account acceptance remains separate from these results.
