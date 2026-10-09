# NEKODEX admission and Web recovery — 10 October 2026

## Result

The installed app and active runtime are **6.1.22-nekodex.1**, built from
`c9514dfa6232fec730a65c3fdaa2b136c1845d9c`. The selected Primary account is
verified for models and local tools. Its own tunnel is running under a
profile-scoped SDK alias. The user-approved **Codex Native6** connector was
created and connected in the same ChatGPT account.

A real `chatgpt-web/gpt-5.6-sol-instant` request through Codex CLI invoked
`cat proof.txt` in a disposable read-only workspace. The command exited 0 and
returned the file's random marker; ChatGPT returned the same visible text.
The raw answer escapes underscores for Markdown, so raw-string equality is
false while visible-text equality is true. This is recorded explicitly in
[the structured proof](2026-10-10-live-proof.json). The CLI exited 0; no Web
HTTP request or browser turn remained active after it finished. This was a
real provider/tool operation, not a simulated tool fixture.

The local app is signed with the existing Developer ID; its embedded Bun
retains its publisher signature. Runtime integrity validation passed. No public
release assets or release tag were produced, and no new notarization was
submitted for this local update. Account data and the working native route
were preserved through the application's idle-drained lifecycle.

## Review provenance

PR #73 was merged as `2faaf385515fd97c51d83977afe6ae56d6fef514`; its tree matches
`fc460c11ad0f0b658fa12e905728a326dd63326e`. The interrupted review journal
`wf_3786155c-800` contained all 18 original-finding checks and the runtime/UI/copy
hunt. The queue/pool and evidence-restore hunts had no final result, and the
three-lens voting phase never started. The coordinator completed the missing
scoped review against final code. No new independent votes are claimed.

The four completed-hunt findings (retained conversation, dollar labels, API
status documentation and global-pause documentation) had already been corrected
by `fc460c11`. A focused regression now confirms that an unsent failed round is
forgotten without releasing the earlier retained conversation.

## Reconciliation of the 18 original findings

| # | Area | Final disposition |
| --- | --- | --- |
| 1 | Transient startup/account holds | Fixed; transient holds do not start the 45-second readiness deadline. |
| 2 | Rollback journal compatibility | Fixed; final tree immediately rewrites legacy failed readiness rows. |
| 3 | Pinned-account diagnosis | Fixed; selection and diagnosis share `pinnedAccount`. |
| 4 | Dispatch-time tunnel cause | Fixed; audited cause and grace survive dispatch rejection. |
| 5 | Retry after repair | Fixed; queue rechecks after reporting the cause; the server consumes one automatic replay. Retained-conversation fix verified separately below. |
| 6 | Missed owner polls | Live-owner gap fixed. Restart-restored rows deliberately require explicit Resume, per design; this is not automatic restart recovery. |
| 7 | Chat Completions failure | Plain path was fixed in the merged tree. Tool bridge still returned 502; corrected in this follow-up. |
| 8 | Missing capability evidence | Final merged copy names Check account when no tunnel is available. |
| 9 | Connector-check remedy | Corrected remedy avoids the old check/connector loop. A manual plain account check still deliberately retires connector evidence. |
| 10 | Tunnel-ready evidence | Core path existed; late tunnel startup could outlive the restore. Fixed in this follow-up. |
| 11 | Stale readiness timer after Resume | Fixed, including global pause in final tree. |
| 12 | Capacity resetting the timer | Fixed; capacity, runtime transition and previous submission are neutral holds. |
| 13 | Ownerless retained conversation | Fixed; immediate typed predispatch failure preserves compaction fallback. |
| 14 | Throwing diagnostic disabling queue | Fixed; diagnosis is guarded. |
| 15 | Verification missing real boundaries | Existing tests exercise the real pool and HTTP control server. Added retained-session and API tool-bridge regressions; browser/provider acceptance remains a distinct live check. |
| 16 | Task Center failure/cause | Basic cause and deadline are present. Cosmetic limitation: during a neutral capacity hold the running deadline is hidden; a non-readiness retained failure has a generic label. |
| 17 | Restore after sign-in | Core path existed; long operations and coalesced receipts could lose the restore. Fixed in this follow-up. |
| 18 | Localized remedies | Final copy covers six languages. Literal dollar-sign interpolation is fixed in `fc460c11` and covered by the existing focused test. |

## Follow-up changes

- Preserve HTTP 400 and the actionable account cause in the Local API tool bridge.
- Retain scheduled account/connector checks through long user operations and
  tunnel startup; distinguish a pending wait from an active inspection.
- Coalesce new receipts; explicit tunnel setup cancels and joins only its own
  automatic check before taking the normal mutation lease. Active tasks and
  unrelated user operations still veto setup.
- Limit repeated auth flips from a failing probe to one follow-up check.
- Preserve the evidence epoch through transient unknown/unavailable observations
  while still blocking admission. Confirmed logout and identity changes retire it.
- Accept the current visible ChatGPT model toggle when `aria-hidden` is omitted,
  continuing to exclude explicitly hidden or ambiguous controls.
- Derive new/reconfigured SDK aliases from canonical app home, account and mode.
  The stopped DEV alias that collided with production was preserved untouched.

## Verification

- 18 queue/admission cases plus 8 follow-up cases passed on the final behavioral
  change. The unchanged server-replay case had passed earlier and was reused.
- Both isolated real-browser picker variants passed and restored the selected
  model, effort, menu and unsent draft.
- Account-tunnel store and admission smokes passed, including cross-profile alias
  separation and preservation of other accounts' active work.
- Source typechecks, version synchronization, CJS syntax, architecture-map/path
  validation and diff whitespace checks passed where applicable.
- A source-built helper successfully read capabilities from the actual Primary
  ChatGPT page; the installed app later displayed Models checked: Verified and
  Local tools: Verified.
- The final live Codex request used the installed 6.1.22 route, the real ChatGPT
  connector, and a read-only local command. Broker and tunnel remained ready.

## Account setup and cleanup

Google rejected the embedded OpenAI API login. Normal Chrome reached the
account's passkey flow; the user completed Touch ID. The existing tunnel was
reused. The user approved a Restricted key with only Tunnels Read + Use, then
approved creating Codex Native6. The key was copied directly into NEKODEX's
secure field, stored with mode 0600, and never included in source or reports.
No other account's key or tunnel was borrowed.

Superseded task-owned app copies/build outputs were moved to Trash with a path
manifest; an archive of the prior installed 6.1.19 and config backup remain
outside app discovery. The installed app and user profiles remain in place.

The focused review's small Task Center presentation limitation in row 16 remains
recorded. It does not affect scheduling, delivery, saved conversations or the
verified provider/tool flow. No broad repository suite or unrelated plugin
maintenance was run.
