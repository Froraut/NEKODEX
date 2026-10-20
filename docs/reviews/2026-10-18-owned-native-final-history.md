# Owned Native final-summary history — 18 October 2026

This source batch connects validated owned Native final summaries to the existing
conversation-history owner, with separate future-content consent and actual Native
provenance. It follows published `641f277`, whose four exact
[CI jobs passed](https://github.com/Froraut/NEKODEX/actions/runs/39150687127).
That baseline also passed both TypeScript projects at 17:30 UTC, renderer build
(194 modules), plain development CLI (634 modules/exact `.9`) and module map
(717 source modules). These earlier results are not final verification of the
subsequent history changes. Source/development remains `6.1.32-nekodex.9`;
installed D01 remains `.8`, with no new installation or release claimed.

## Result and boundaries

`ConversationHistoryStore.ownedNative` shares the existing single Bun SQLite/FTS
writer, revisions, quota, search, Markdown export and explicit deletion. It adds
no database, transcript discovery, background subscription or model lifecycle.
The separate `owned-native-final-summary-v1` policy defaults off. Global recording,
exact future task-generation consent and acknowledgement that unfamiliar secrets
may remain are all required. Existing manually selected text and explicitly
refreshed canonical thread pages retain their own policies and evidence.

Trusted main admission supplies source/profile/backend-account/auth-epoch identity.
The renderer supplies task identity and its current family/generation/revision,
which the root validates against the actual task; it cannot submit account/source
claims or captured text. Before the one Native offer, the provider obtains a
private lease binding dispatch, source scope, consent revision and global recording
epoch. Enabling while an offer runs cannot capture it retroactively. Leases are
released in `finally` after terminal processing, including failed, aborted and
tool-request offers; restart cannot restore an old lease.

After receipt ownership and protocol validation, capture accepts only parsed
`final.summary` with actual Native message/turn/thread IDs, Native timestamp,
worker binding/generation, dispatch and NativeTurnReceipt identity. A matching
raw-result digest binds the canonical receipt to the parsed final. There are no
invented IDs or observed-time fallback. Missing or changed provenance yields no
content. The existing Responses capture adapter does not interpret this JSON
protocol. Raw JSON, automatic-host context, tool requests/arguments/results,
schemas and reasoning are outside the retained projection.

At write, the trusted resolver checks current authoritative task generation and
admitted source again. Scope/source/epoch/generation/consent/global off-on changes
invalidate old leases; global and consent checks run in the same SQLite
transaction. Safe summaries are assistant/agent/native with partial coverage,
explicit projection reason and bounded provenance. Existing known-pattern filtering
excludes unsafe bodies without storing or hashing them; unfamiliar secrets may
remain. Reobservation deduplicates by safe projection/provenance revision identity.
Search/export share the partial corpus and do not establish a complete transcript
or verified task outcome. Capture failure preserves Native success/receipt and
never retries the offer.

Revocation stops future writes and retains saved history until explicit deletion.
Every explicit task-history revoke disables every source scope for the actual
task generation, including alternate sources while the current source is available.
It also works when the source is unavailable: after validating the actual
task/family/generation/revision, the root durably revokes every consent scope for
that task generation and invalidates its leases. Other tasks/generations remain
unchanged. Source return cannot restore consent. Passive unavailable status does
not assert `enabled:false`; only actual successful revoke reports that result.
A revoke-only IPC channel remains reachable during drain. Canonical history
requests reach their dedicated owner before generic runtime readiness, without
an unrelated Web gate.

## Focused evidence

| Boundary | Observed result | Evidence limit |
| --- | --- | --- |
| Owned history SQLite policy/provenance/filter/dedup/search/export | 1 case / 44 assertions passed | Synthetic admitted source and Native final |
| Source-unavailable persisted task-generation revoke | 1 / 12 passed | Synthetic source loss/return; other scopes retained |
| Actual private Node HTTP + Bun history integration | 1 / 24 passed | Fake leaf/account/model, actual HTTP/SQLite |
| HTTP task authority/status/revocation boundary | 1 / 14 passed (52 ms) | Includes alternate source: both scopes revoked; no live account |
| New revoke/drain IPC boundary | 1 / 5 passed | Injected ready/draining owner |
| Provider history failure isolation and lease release | 1 / 5 passed | Synthetic receipt; no real inference |
| Existing history IPC | 1 / 8 retained passing | Unchanged focused evidence reused |

Both TypeScript projects passed at 18:16 UTC; the changed HTTP root passed again at 18:20; renderer (195 modules) passed at
18:17. Plain development CLI (635 modules/exact `.9`) passed, with temporary output
removed. Module-map write, final check and documented-path checks passed at 18:20 UTC. No full suite,
GUI/auth action, packaging, installation, release or later source/CI publication
is claimed by these fixtures.

The failed real device-login epoch remains retained. A later DEV GUI is running
with the existing private core; human login has not completed, and there are no
actual admitted models or real Native history records proved. No live history UI
flow is claimed. The next required evidence is actual consent/revoke UI behavior
and a qualified real account/model final with canonical provenance. The full
N01–N08 plus 36-area program remains macOS first, then Windows/Linux, including
actual-provider Goal/outcome, full supported transcript/subscription work and the
other open areas. See the [design](../design/owned-native-final-history.md) and
[full program](../design/full-adoption-program.md).
