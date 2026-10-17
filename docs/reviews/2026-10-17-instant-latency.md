# Instant reply overhead

## Baseline

A pass-through measurement of the installed 6.1.32-nekodex.3 route kept the
original compressed request, headers, model, full instructions and tool setup.
The client sent 158,134 decoded bytes, nine input items and 32,371 input tokens.
The first request reached the gateway at 3.329 seconds; the first text reached
Codex at 16.071 seconds and completion at 16.187 seconds. CLI exit at 18.581
seconds included shutdown after the answer was already delivered.

## Changes

- Keep initial exact model/effort selection and the independent pre-send check,
  including account availability. Remove the intermediate reopen that checked
  the same state before prompt/tool attachment had changed anything.
- Observe the menu's actual closed/editable state and the Send button's enabled
  state immediately, instead of first sleeping 250 ms. Retain bounded readiness
  retries and the slider's stabilization window.
- Permit the final Markdown paragraph to stream after its ordinary stability
  window when the owned response stream has closed, generation stopped and
  completed-turn controls are present, with no external call in flight. Keep the
  independent completion tracker and broker fence unchanged. This improves time
  to visible text without retiring active tools or declaring completion early.
- Preserve full input, tool setup, model identity, Markdown consistency checks,
  file-reference barriers, and atomic compaction delivery.

## Development checks

Four focused Markdown/compaction cases passed, including stable-tail delivery,
rewrites/resumed generation and the tool-completion barrier. The existing real
headless picker case passed with retained selection, a live pre-send check and
rejection of a changed visible selection. Root/launcher typechecking and the
development renderer/helper builds passed. The architecture map stayed current.

## Installed comparison and preserved tools

The first request immediately after runtime replacement included roughly ten
seconds of account/connector initialization before browser acquisition. It is
recorded separately as a cold start; it is not comparable to the baseline's
already-running account.

With accounts ready, the same full input (32,371 input tokens) produced:

| Boundary | Baseline 6.1.32.3 | Final 6.1.32.5 |
| --- | ---: | ---: |
| Gateway request to first text | 12.742 s | 10.889 s |
| Fresh CLI start to first text | 16.071 s | 13.566 s |
| Fresh CLI start to completion | 16.187 s | 14.302 s |

These are observed individual runs, not a latency percentile or a provider speed
guarantee. All three successful comparison runs used 32,371 input tokens; the
final decoded request was 158,173 bytes. An intermediate warm 6.1.32.4 run took
10.941 s from gateway request to first text, consistent with the final result.

An ordinary user follow-up in the same retained conversation reached first text
7.198 s after the gateway request and 10.052 s after starting a fresh CLI. It
correctly repeated the earlier response; the canonical follow-up request still
contained the preceding conversation. A separate real terminal-tool request read
a generated file and returned its exact random value plus the context sentinel.
The observed tool event was `command_execution`; no tool or instruction was
disabled. Its tool-result continuation produced first text 3.950 s after that
continuation request.

The startup trace also showed the selected account waiting behind another
account's sequential initialization. Version 6.1.32-nekodex.5 prioritizes the
selected account while preserving sequential ownership and all remaining
account checks. A focused owner-level test verifies that its model/tool readiness
is available while the background account is still pending.

## Activation and cleanup

Both the installed app and active core were verified on 6.1.32-nekodex.5, with
native/Web admission, broker and both account tunnels ready. The installed UI
showed the final successful response. One verified 6.1.32-nekodex.4 rollback
archive is retained; older task backup bundles, generated app stages and build
intermediates were removed. The temporary retained-conversation test was archived.
