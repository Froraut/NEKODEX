# Real retained Native context, continuation and fork

Observed 18 October 2026, 22:03 UTC, through the actual macOS development GUI,
real GPT-6.1-Sol and the already qualified own-profile Native account. Source
is `6.1.32-nekodex.9`; the installed application remains `.8`. The new
[persistent conversation contract](../design/persistent-native-conversations.md)
is separate from ephemeral Agent tasks and opt-in history/export.

| Boundary | Actual observation |
| --- | --- |
| Create | Explicit local-context retention consent and a direct user message containing test marker `NEKODEX_CONTEXT_BLUE_628` |
| Parent follow-up | Separate explicit send recalled the marker in the same Native thread; that follow-up's canonical input did not contain the marker |
| Fork | Explicit action created a distinct Native thread, linked to its registered parent; fork itself did not send a model turn |
| Fork follow-up | Separate explicit send recalled the same marker; its canonical input also omitted the marker |
| Counts | Two retained conversations, four completed actions (create/send/fork/send), three completed model offers |
| Authorship | Canonical sent messages were `direct-user`; automatic Agent host input was not relabelled |
| Immediate UI | Final successful flow advanced through all four actions without requiring Refresh to release a stale busy state |
| Restart boundary | Before the final run, an earlier retained record appeared unavailable after restart, with no automatic send or resume |
| Permissions | Existing Native tools remained disabled, read-only sandbox and approval policy `never` unchanged |

The test marker was intentionally inert. Private evidence cross-checks canonical
Native inputs, completed receipts, unchanged parent thread identity, distinct
fork identity and exact source hashes. The follow-ups therefore demonstrate
retained context and a real Native fork, rather than resending the marker in
each new request. These were newly created conversations owned by NEKODEX; no
third-party or historical thread was adopted as a live execution owner.

An earlier attempt exposed a completed-action response that left the UI busy.
That original observation is preserved separately. The corrected fresh GUI run
completed all three real offers; it did not replay the old attempt as recovery.
Focused checks also cover expected account/model/generation, retention consent,
lost replies, exact receipts, late results, failed-before-offer classification,
registered fork ownership and coordinated account/conversation shutdown.

Recorded development checks: pinned Bun focused batch 18 passed / one phase-2
skip / 299 assertions, then the changed persistent tests 5 passed / 51 assertions;
both TypeScript targets and renderer build (200 modules) passed. The actual
three-offer result is independent of those fixtures. After the actual UI account
close, the exact Native process was absent. Core and GUI then exited with code 0,
the conversation owner lock was absent, and the registry remained retained.
Those cleanup observations were recorded separately at 22:04 UTC.

This proves the stated text-context create/continue/fork flow. Restart Resume,
attachment parity, cooperative exclusive handoff to another client, general
semantic/business completion and installed `.9` delivery remain open. Monetary
cost is not established; local retention consent does not enable background
history capture or export.

Private workspace evidence: `reviews/evidence/full-adoption/native-persistent-real-20261018.json`.
It retains actual identities and source hashes; account identifiers and credential
contents are not reproduced in this public report.

Subsequent work added and verified explicit idle-close and Resume, including
context recall after a full application restart. See the separate
[Resume acceptance](2026-10-18-real-native-resume.md) for that expanded scope.
