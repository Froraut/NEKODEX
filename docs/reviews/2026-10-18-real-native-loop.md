# Real Native mailbox Loop: two cycles and explicit pause

Observed 18 October 2026, 21:49 UTC, in the macOS development target
`6.1.32-nekodex.9`. This used the already qualified own-profile Native account
and real GPT-6.1-Sol, with no Web-provider fallback or synthetic model adapter.
The installed application remains `.8`; no replacement or release is claimed.

| Boundary | Actual observation |
| --- | --- |
| Start | Explicit Loop authorization and Run for one bounded task |
| Cycle 1 | Canonical final `NEKODEX_NATIVE_LOOP_CYCLE_1` |
| New work | One substantive mailbox item with a stable source work key |
| Cycle 2 | Automatically started from that item; canonical final `NEKODEX_NATIVE_LOOP_CYCLE_2` |
| Duplicate | Same work key/text did not create another packet or model dispatch |
| Counts | Two dispatches, two Native offers, one claimed mailbox packet, cycle 2/generation 2 |
| Bound | `maxTurns: 3`; one offer remained available, so the absent third dispatch was not explained by exhausting the bound |
| Waiting | `review_required` with no further substantive work; no empty Continue dispatch |
| Pause | Actual UI Pause produced generation 3, `paused`, and removed `loopRun`; dispatch count stayed two |
| Effects/evidence | No tools invoked, no task outcome evidence recorded |
| Usage | Two unpriced offers; monetary spend remains unknown |

The new item's instruction replaced the initial stage for its cycle. The
different canonical summaries establish that the second offer followed the
new item rather than replaying the original instruction. Exact Native and core
receipts retain each cycle's task scope and terminal result. The duplicate check
ran while the original offer bound still permitted another dispatch.

This proves bounded real-model mailbox scheduling, changed input, duplicate
suppression and explicit pause. It does not establish a general business outcome
or `verified_complete`: both cycles only returned requested test summaries, and
no independent property observer was attached. The earlier file-based Native
Goal has separate [MCP and outcome evidence](2026-10-18-native-mcp-runtime.md).

`externalWatchers` remains false. Mailbox input is explicit; no continuous
external watcher, remote event source or timer was introduced. Long multi-stage
business tasks, broader recurring sources, semantic acceptance, client reuse/
fork/exclusive handoff and installed `.9` acceptance remain open.

Private workspace evidence: `native-loop-cycle1-20261018.json`,
`native-loop-two-cycles-20261018.json` and `native-loop-paused-20261018.json`
under `reviews/evidence/full-adoption/`. The paused receipt was recorded at
21:49:47 UTC; retained history and terminal receipts were preserved.
