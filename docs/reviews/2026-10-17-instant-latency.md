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

Installed comparison and a real read-only tool/context check are pending.
