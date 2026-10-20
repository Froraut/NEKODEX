# Real explicit Native close and Resume across restart

Observed 18 October 2026 in the macOS development GUI, source
`6.1.32-nekodex.9`, with real GPT-6.1-Sol. The installed application remains
`.8`. This extends the earlier [owned context/fork result](2026-10-18-real-persistent-native-conversations.md)
with explicit idle close, same-server Resume and Resume after a complete
application restart.

| Boundary | Actual observation |
| --- | --- |
| Initial context | Newly created, explicitly retained v2 owned conversation |
| Idle close | Explicit Close connection completed while preserving the retained conversation |
| Same-server Resume | Explicit action reopened the same Native thread with a new binding and no model offer |
| First recall | A separate explicit follow-up recalled the marker absent from that canonical input |
| Full restart | First core and GUI exited0; the new app used a new admitted account-server generation |
| Restart Resume | Explicit Resume reopened that same Native thread; Resume itself sent no model message |
| Second recall | Another separate explicit follow-up recalled the marker, again absent from its canonical input |
| Counts | One Native thread, three distinct bindings, two server generations, three completed model offers, seven completed actions |
| Scope | Same qualified account identity; fresh admission after restart; no foreign thread adoption |
| Cleanup | Native process absent, final core/GUI exit0, registry owner lock absent and registry retained at 22:16:54 UTC |

The private evidence contains eleven checked properties, all true. Canonical
inputs and actual receipts distinguish context recall from a host that repeats
the marker in each message. Explicit close/Resume do not replay a previous
turn and do not imply consent to send another one.

Resume uses a new owned worker binding, current admission and separate journal,
with the recorded Native thread ID validated by the public `thread/resume`
response. Active, unknown, unproven or foreign sources are refused. Old v1
prototype records without the required history/account identity remain
unavailable intentionally; their thread IDs are not promoted into authority.

The pinned upstream paginated model-context reader reconstructs context from
durable JSONL/lineage in the same CODEX_HOME. The new account-server generation
keeps its own SQLite directory. This actual restart result required no database
copy, credential copy, raw rollout replay or change to Native permissions.

Focused development checks recorded separately: persistent core 10 passed /
91 assertions; root affected batch 12 passed / one phase-2 skip / 233 assertions;
both TypeScript targets, the rendered UI's six explicit mutation flow and
renderer build (200 modules) passed. These fixtures do not replace the actual
three-offer result or its cleanup receipts.

This establishes the stated owned text-context Resume path. Attachment parity,
external CLI/client handoff, arbitrary foreign-thread continuation, general
business verification and installed `.9` delivery remain separate. No tools
were executed; monetary spend is unknown. Retention remains explicit and is
separate from background history/export consent.

Private workspace evidence: `reviews/evidence/full-adoption/native-resume-real-20261018.json`.
It retains phase receipts, source hashes, restart and cleanup observations;
account identifiers and credential contents are omitted here.
