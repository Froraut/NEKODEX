# Real local API consumer and selected Codex usage import

Observed on macOS on 18 October 2026, using source/development version
`6.1.32-nekodex.9`. The installed application remains
`6.1.32-nekodex.8`; this evidence is not a new installation or release.

## Named external consumer

The bundled `codex-chatgpt-web local-api` CLI called the actual development
server on its current numeric loopback port. The API was initially disabled.
The probe created one isolated manual task, enabled a read credential, then
supplied credentials to child CLI processes only through stdin. Neither secret
was included in argv, environment, output, or saved proof.

The actual server/CLI flow passed eleven properties:

- Status, Agent task metadata, and history coverage reads succeeded.
- The absent generic task source returned `503 source_unavailable`.
- A read credential could neither perform an administrative action nor read
  saved history content without the separate content permission.
- An explicit administrative Pause returned the supplied stable action ID and
  changed the task to paused.
- After that confirmed response, explicitly repeating the identical command
  returned a duplicate receipt without another generation transition.
- The task had zero dispatches and zero turns.
- Disabling the API restored its initial disabled state and revoked the read
  credential.

The CLI has no new queue or scheduler. It uses the existing scoped Agent owner.
An unavailable or ambiguous POST response retains an unknown outcome and the
same action ID; it is never automatically resent. A separate focused transport
check found that inherited proxy variables can affect ordinary Bun fetch even
for loopback. The client therefore uses a private direct TCP HTTP agent and
rejects redirects. Synthetic checks established one destination request and no
proxy request, bounded input/output, secret-safe projection, response identity,
and safe handling of empty `204`/`205` action responses.

Focused development validation: pinned Bun 1.4.0, eight tests and 92 assertions;
root TypeScript check; bundled CLI/help; static peer review with no remaining
substantive finding. No unchanged Native/provider test was repeated.

## Selected real usage journal

Through the actual macOS directory picker, the development UI received one
private task-owned Codex `0.163.0` rollout copied from the already completed
Native Resume proof. The selected directory contained exactly that one JSONL.
The source was explicitly marked `may-overlap-nekodex`.

The first manual import produced three known records for `gpt-6.1-sol`:

| Recorded component | Tokens |
| --- | ---: |
| Input | 15,487 |
| Cached input, included in input | 4,864 |
| Output | 152 |
| Input plus output | 15,639 |

These values matched the three existing canonical Native usage receipts and the
rollout's cumulative total. A second explicit import left three records and all
totals unchanged. The source was then paused through the UI. Reloading its
private metadata registry confirmed the paused source, allowlisted record
fields, hashed session identities, no persisted conversation/tool fields, and
private file permissions. The UI and saved projection excluded it from the
external-only aggregate. Imported records never enter Native/Web totals.

There was no configured price catalog: all 15,639 tokens remained unpriced and
the API-equivalent amount was `null`, visibly unknown. No public price mapping
was invented for this exact model. This is real Codex parser/deduplication
evidence, not a Claude log, provider invoice, subscription cost, or savings proof.

## Cleanup and remaining scope

The read API is disabled, the fixture task is paused with no model offer, and
the imported source is paused. The development core stopped successfully before
the GUI; both terminal owners exited zero and their processes disappeared.
The core recorded zero Web requests. Private task receipts and sanitized usage
metadata remain available for review; raw journals and credentials are not
published in this repository.

Remaining work includes an explicitly chosen real pricing catalog, additional
client/provider integrations and installed macOS acceptance. This slice does
not close the full 44-item adoption program.
