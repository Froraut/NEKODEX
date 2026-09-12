# Upstream review — 2026-09-12

Initial inventory captured **2026-09-12 09:56 UTC**, with unchanged counts, update timestamps,
and open PR heads confirmed again at **10:06 UTC**, from the official
[issues](https://github.com/miuuyy/codex-chatgpt-web/issues) and
[pull requests](https://github.com/miuuyy/codex-chatgpt-web/pulls) using the GitHub API.
The comparison cutoff is the previous review at **2026-09-11 19:35 UTC**.
The complete current inventory contains **31 open issues and 11 open PRs**, up from 24 and 8.
There are seven new issues, three new open PRs, four newly created and closed PRs, and four
meaningfully updated older issues. No issue was newly closed in the updated-issue result.
Upstream `main` remains `e85e3693fdb4e3e033348c08df0298c20fcdb612`.

The published fork baseline is **`72ff04ac31acbd5885eed2de76aa96bccd6cb429`**,
version **5.1.0-froraut.2**. Its successful CI is recorded separately in
[run 34645507128](https://github.com/Froraut/codex-chatgpt-web/actions/runs/34645507128).
The existing-Chrome import/error/progress work was a separate scope during this comparison; it is not
credited as an upstream issue fix merely because similar login symptoms were reported.
No account state, browser cookies, credentials, or raw attachments are included in this report.
No upstream issue, review, comment, or PR was modified.

The review retrieved both complete inventories, issue bodies/comments, and PR descriptions,
and examined new or meaningfully updated discussions, reviews and referenced patches in detail. Unchanged older items retain
the evidence boundaries of the [September 11 completion review](2026-09-11-completion-review.md).
Author-reported tests and live observations are distinguished from local source/fixture evidence.

## Selected corrections

Three narrowly confirmed corrections were implemented for **5.1.0-froraut.3** and published in
[`f4f79a0`](https://github.com/Froraut/codex-chatgpt-web/commit/f4f79a065a0b42d9ee1761ccf2f58ea519866757).
The [validation checkpoint](2026-09-12-validation.md) records its installation and local checks;
[CI 34688359018](https://github.com/Froraut/codex-chatgpt-web/actions/runs/34688359018) passed on
macOS, Windows and Linux. These results do not prove the original reporters' account outcomes.

| Report / patch | Source-confirmed defect and correction |
| --- | --- |
| [Issue #447](https://github.com/miuuyy/codex-chatgpt-web/issues/447) / [PR #448](https://github.com/miuuyy/codex-chatgpt-web/pull/448) | Fallback compaction can remove the cumulative checkpoint as the oldest history record while retaining a large later tool result, then describe the remaining history as complete. A pure compilation fixture on the published fork reproduced missing checkpoint, retained old tool output and a misleading completeness claim. Preserve the newest readable checkpoint and current instruction within the unchanged size limit. See [PR #448 integration](../upstream-pr-448-integration.md). |
| [Issue #431 follow-up](https://github.com/miuuyy/codex-chatgpt-web/issues/431#issuecomment-5642829351) | A foreign TOML table inserted between the managed Interrupt hook fields and its trailing `hooks.state` table defeats the legacy exact-prefix locator. Current-fork LF/CRLF and journal v10/v11 fixtures reproduce rejection; moving only that table preserves TOML semantics and restores lookup. Add narrowly validated tolerance while preserving foreign tables and refusing modified owned hook data. See [hook interleaving review](../upstream-issue-431-hook-interleaving.md). |
| [PR #450](https://github.com/miuuyy/codex-chatgpt-web/pull/450) | The exact author-observed Simplified Chinese stopped-thinking label `已停止思考` is absent from the English-only terminal-status recognition. Add that exact label and replace speculative quota wording with a neutral stopped-thinking explanation. Preserve current-turn attribution and the existing non-retryable terminal error. See [PR #450 integration](../upstream-pr-450-integration.md). |

## New issues and meaningful updates

| Issue | New evidence and disposition against the fork |
| --- | --- |
| [#452 — Windows installation / missing models / 503](https://github.com/miuuyy/codex-chatgpt-web/issues/452) | New, detailed Windows 11 report on Codex 0.153.4 and 0.154.0. Setup and Doctor reportedly pass, while forced Web requests return 503 before a browser trace appears. The body claims an attached safe log but supplies no attachment link or HTTP response body. This is stronger symptom evidence than a failed picker alone, but does not establish why the route refuses requests. The fork already provides installed/waiting status, saved-route diagnostics, catalog counters, and drained-runtime checks. See the diagnostic boundary below. |
| [#449 — substantive apply_patch blocked](https://github.com/miuuyy/codex-chatgpt-web/issues/449) | New report distinguishes a trivial successful patch from a substantive rejected call. The supplied observations do not establish a local tool-schema bug or prove that connector metadata causes the external safety decision. Preserve the actual failure and approval/safety boundaries; no retry or bypass is justified. |
| [#447 — cumulative checkpoint lost](https://github.com/miuuyy/codex-chatgpt-web/issues/447) | New, locally reproduced source defect. Selected narrow correction through #448, as described above. |
| [#446 — read-only calls / unknown safety status](https://github.com/miuuyy/codex-chatgpt-web/issues/446) | New and subsequently updated. Reports successful local reads followed by an external stop, without an authoritative object identifying the safety decision. Distinguish a request reaching the MCP transport, SDK validation, handler invocation, outer tool execution, and ChatGPT accepting the result. #451 improves observability in principle, but its current implementation has independent hazards described below. |
| [#445 — native Deep Research in DEV](https://github.com/miuuyy/codex-chatgpt-web/issues/445) | Optional workflow proposal with author-reported live prototype evidence. The issue supplies no published feature commit or reviewable patch. Not a fix for existing import, retention, MCP or catalog failures. No new workflow is imported in this maintenance batch. |
| [#444 — Luna forgets / context exhausted / newer model absent](https://github.com/miuuyy/codex-chatgpt-web/issues/444) | New but insufficiently specified: the application-version field contains an account tier, and repeated narrative replaces diagnostics. Current Luna exact-parent rolling-checkpoint tests do not reproduce this account's failure. Need the actual route/model, canonical history/checkpoint sequence, context usage and capability probe before attributing the symptom to #447 or increasing limits. |
| [#443 — Interrupt hook changed](https://github.com/miuuyy/codex-chatgpt-web/issues/443) | New Windows report with the exact refusal and an attachment link, but no changed hook fragment or minimal reproduction in the body. Do not overwrite unknown changes. #431's independently reproduced interleaving may explain a subset, but #443 itself is not proven to be that same case. |
| [#441 update — first acknowledgement](https://github.com/miuuyy/codex-chatgpt-web/issues/441#issuecomment-5641493262) | New comment reports the generic provider error after the first acknowledgement in a long-context chat. Existing fork fixtures already cover both retained-response send activation and the first multipart context send, making the resulting error terminal. The additional comment does not identify ChatGPT's underlying failure or justify resending an activated prompt. |
| [#438 update — catalog counter zero](https://github.com/miuuyy/codex-chatgpt-web/issues/438#issuecomment-5642517228) | Reporter now supplies `successful_model_catalog_requests = 0` after opening the picker and reports only one official client. A later comment shows managed multi-agent settings, which does not prove the model catalog reached the route. Another user's reopen/reconnect workaround is anecdotal, not a cause. Preserve installed/waiting status and inspect effective home/profile/overrides and runtime acceptance without repeated blind reinstall. |
| [#431 update — proxy, downgrade, hook interleaving](https://github.com/miuuyy/codex-chatgpt-web/issues/431#issuecomment-5642829351) | Reporter now distinguishes three causes: an older binary cannot parse a newer active journal; unstable proxy/DNS/connection failures masquerade as failed session verification; and a foreign table breaks the hook locator. The last is source-reproduced and selected above. Stable-proxy success is author-reported; downgrade recovery must retain version ownership and reversible setup semantics. No credential reset or generic timeout increase is justified. |
| [#424 update — compaction handoff](https://github.com/miuuyy/codex-chatgpt-web/issues/424) | The safe diagnostic sequence shows three-part compaction with `compactionTrimmedMessages = 0`, followed by browser completion and a later environment failure. It is not the inline trimming defect in #447. The fresh fallback path does not call retained `CompactionTransactionStore.submit`, so absence of that path's acceptance log does not prove rejection. Actual summary delivery and the subsequent canonical Codex context remain unproven. |

### Windows catalog and 503 boundary

On the current fork, an explicitly drained daemon returns HTTP 503 for models and responses
before browser-turn creation. That is one source-supported way to obtain the reported shape,
not a diagnosis of #452. Doctor already rejects `accepting_turns !== true`; launcher resume
handling also checks that state. Existing synthetic tests for drained catalog rejection and
successful catalog observation passed during this review (**2 tests, 8 assertions**).

The next discriminating evidence is the matching runtime PID/version, `accepting_turns`, catalog
counter/time, exact 503 response body and the saved versus actual client home/profile/overrides.
The successful isolated Codex 0.153.4/0.154.0 catalog smokes and three-platform CI establish local
compatibility checks; they do not establish that this reporter's Windows client used that route.
No direct public-Web request, user-account prompt, configuration reset, or forced model change
was made to investigate these reports.

## Open pull-request inventory

All 11 open PRs had empty review decisions and no check-rollup entries in this snapshot. This is
not evidence that their patches are safe or that their authors ran no local tests.

| PR | Author / inspected head | Disposition |
| --- | --- | --- |
| [#451](https://github.com/miuuyy/codex-chatgpt-web/pull/451) | liu-dongfang / `1af4163310edc4a2c49e9c5c342804ab17db6289` | New diagnostics proposal; do not adopt this head unchanged. See defects below. |
| [#450](https://github.com/miuuyy/codex-chatgpt-web/pull/450) | liu-dongfang / `9eda72fd100b2b992b5075f3a3324e656d4d5cf3` | New exact-label correction selected, with scoped terminal-error tests. |
| [#448](https://github.com/miuuyy/codex-chatgpt-web/pull/448) | liu-dongfang / `fb9929a18d6be506364b2b14bb79ad6d8075072c` | New cumulative-checkpoint correction selected, adapted to fork boundaries. |
| [#442](https://github.com/miuuyy/codex-chatgpt-web/pull/442) | zm2231 / `cf75a3162ee28621dcb0beef730c01443a3a1fdb` | Unchanged head; six-kind escape-aware replay scrubbing already integrated. |
| [#439](https://github.com/miuuyy/codex-chatgpt-web/pull/439) | JulianZJN / `039c385f09ba43eac398259eb6360ffe02ede75e` | Unchanged head; optional Pro pinning integrated with stronger logical replay/cancellation and retained-history isolation. |
| [#435](https://github.com/miuuyy/codex-chatgpt-web/pull/435) | aolin480 / `2ed03f60f4785e0624b907b726a6404a28cf061b` | Unchanged head; complete JSON-hook ownership integration present. This does not automatically cover legacy TOML interleaving. |
| [#432](https://github.com/miuuyy/codex-chatgpt-web/pull/432) | gmoroz / `5b8face7b97f066da8e5fe40fbfcc4d7c0e0a3c8` | Unchanged head; fork extracts only a date from an explicitly Pro-linked tooltip. Unlinked live portals remain unverified. |
| [#430](https://github.com/miuuyy/codex-chatgpt-web/pull/430) | oenderg / `bbdb4077a9ca488c2b6c41162234c228da696f22` | Unchanged head; read-only task action and fresh connector contract identities integrated. Real installed dispatch remains a separate gate. |
| [#415](https://github.com/miuuyy/codex-chatgpt-web/pull/415) | ogyrec-o / `826f8804f59cf8972571018cfb8b15b5166c3a8b` | Unchanged; fork already includes the required Hono/js-yaml audit floors. |
| [#413](https://github.com/miuuyy/codex-chatgpt-web/pull/413) | Cham1229 / `210174707702bc64f872eff080c526295e5b5efb` | Unchanged localized documentation proposal. Fork uses Manual mode wording without absolute risk-removal claims. |
| [#412](https://github.com/miuuyy/codex-chatgpt-web/pull/412) | NickYCLin / `e73e910bdf2fd36bf7e0cde92d27930b26660440` | Unchanged; mode-specific issue reporting and troubleshooting already adapted. |

### Why #451 is not adopted unchanged

The proposed pre-SDK observer serializes message arguments before its exception guard. An
isolated **300,135-byte valid JSON `tools/call`** with deeply nested unknown input was accepted
by the current SDK and reached its handler, but the proposed observer raised `RangeError`
before SDK dispatch, producing neither a handler call nor a reply. Diagnostics must not turn
an accepted call into a dropped call. The proposed wire-name sanitizer also retains arbitrary
custom identifiers in plaintext; “safe export” would require an exact public-name allowlist or
hashing unknown names. A future version must bound and guard all summary construction and
preserve receive forwarding and send outcomes. This would improve observability; it would not
prove or bypass the external safety decisions reported in #446/#449.

## Newly closed proposals

These PRs were created and closed after the cutoff, are unmerged, and have no stated closure
reason in comments or reviews. Closure is not recorded as a maintainer rejection or correctness
finding. Their failed upstream CI stops at the already-addressed upstream dependency audit;
it is not evidence that their feature-specific tests failed.

| PR | Inspected head | Review boundary |
| --- | --- | --- |
| [#453 — answer binding and oversized context](https://github.com/miuuyy/codex-chatgpt-web/pull/453) | `40da06e49d1daa8850aa37007fea08c6c9b626b1` | Do not import the broad alternative. Exact-patch fixtures show its planner accepting a trimmed three-part compilation even when eight parts retain history, rebinding concatenating contradictory replacement answers, and its fragment verifier accepting only one of two required fragments. It also adds an unrelated parent-only instruction. |
| [#454 — explicit Plus/Pro context plan](https://github.com/miuuyy/codex-chatgpt-web/pull/454) | `8534e7c458b185236432bd4e3bed8b760f559d10` | Optional context-plan design with reproduced defects: DEV rejects the setter's emitted `--bigger-context-plan` flag; startup can display Plus while the runtime stores Pro. Claimed larger windows lack account-bound long-context evidence. Do not infer capacity from a selected tariff. |
| [#455 — subagent setting](https://github.com/miuuyy/codex-chatgpt-web/pull/455) | `dc9a0d253a72cf0175b25a0d6b435dafd6d3e09c` | Optional default-off policy change, not a demonstrated fix for new tool-safety reports. Its own commit emits DEV setup flags that its DEV parser rejects; its basename-based classifier also matches an unrelated namespaced `send_message`. Both were reproduced from the isolated patch. |
| [#456 — Traditional Chinese](https://github.com/miuuyy/codex-chatgpt-web/pull/456) | `24641d5cea83693fa0a2feddb29a690f297ad1c2` | Optional localization plus state synchronization associated with #454/#455. Its dictionary lacks 43 keys from the published fork, including Pro/import/waiting copy, and does not cover the fork's separate routing component. Adaptation would be a separate feature, not a current login fix. |

The author of all four closed PRs is **jamie950315 (Jamie Chen)**. Their individual commits were
reviewed separately from the stacked PR diffs, which include earlier feature proposals. The
new Deep Research proposal #445 is by **derekszen (Derek Zeng)** and has no published feature
commit. Its Linux/English research completion and export are author-reported prototype results;
fresh uninterrupted execution and other layouts remain outside independent verification.

The current fork's answer-identity helpers also reject two new assistant nodes and retain an
old identity while that old node is still present. Those pure-function observations identify a
possible empty-shell/replacement investigation, not an account-proven failure or permission to
append a replacement answer to committed text. A future narrow correction needs observed DOM
ownership plus replacement, sibling-continuation and committed-output consistency fixtures.

## Unchanged open issues

Together with the eleven rows in “New issues and meaningful updates,” these twenty rows account
for the complete 31-open-issue inventory. They were refreshed, not silently treated as resolved.

| Issue | Current boundary |
| --- | --- |
| [#437](https://github.com/miuuyy/codex-chatgpt-web/issues/437) | Exact connector selection and one stale-catalog refresh exist; actual account/workspace/DOM failure remains unproven. |
| [#436](https://github.com/miuuyy/codex-chatgpt-web/issues/436) | Personalization preflight timeout lacks deterministic reproduction. Keep its verification gate. |
| [#434](https://github.com/miuuyy/codex-chatgpt-web/issues/434) | Exact entity-button filename labels are preserved as inert text; general artifact delivery is a separate feature. |
| [#428](https://github.com/miuuyy/codex-chatgpt-web/issues/428) | Omission of a repeated connector mention does not prove that the retained binding disappeared. |
| [#427](https://github.com/miuuyy/codex-chatgpt-web/issues/427) | Instruction deduplication requires authoritative revisions; do not omit instructions solely because a tab is reused. |
| [#426](https://github.com/miuuyy/codex-chatgpt-web/issues/426) | A transaction/message-budget mismatch was a hypothesis. Existing scoped cancellation and bounded preparation do not prove the original hang's cause. |
| [#425](https://github.com/miuuyy/codex-chatgpt-web/issues/425) | Custom per-machine connector identities remain a separate coordinated feature. Fresh versioned ABI names do not solve every multi-device use case. |
| [#423](https://github.com/miuuyy/codex-chatgpt-web/issues/423) | Model-reported safety rejection still needs exact authoritative tool results; preserve enforcement. |
| [#422](https://github.com/miuuyy/codex-chatgpt-web/issues/422) | Startup recovery now exposes failure and fresh-process restart; original Windows ARM64 initialization cause remains unproven. |
| [#420](https://github.com/miuuyy/codex-chatgpt-web/issues/420) | Reporter withdrew the native-502 reproduction and attributed it to local configuration. |
| [#418](https://github.com/miuuyy/codex-chatgpt-web/issues/418) | Zero tool calls alone do not identify a missing registry, connector binding or execution failure. |
| [#416](https://github.com/miuuyy/codex-chatgpt-web/issues/416) | Independent Extra High capability is implemented; a current account probe is needed to discover it. |
| [#414](https://github.com/miuuyy/codex-chatgpt-web/issues/414) | Known hook normalization and JSON ownership are covered; unidentified changed owned data is still rejected. |
| [#411](https://github.com/miuuyy/codex-chatgpt-web/issues/411) | Manual-mode reporting and handoff-stage troubleshooting are present. |
| [#410](https://github.com/miuuyy/codex-chatgpt-web/issues/410) | Goal failure still has no exact failing sequence. |
| [#408](https://github.com/miuuyy/codex-chatgpt-web/issues/408) | Lost tools across turns need correlated native identity, connector and invocation evidence. |
| [#407](https://github.com/miuuyy/codex-chatgpt-web/issues/407) | Stale-turn recovery is terminal; separate provider capacity failure remains unproven. |
| [#405](https://github.com/miuuyy/codex-chatgpt-web/issues/405) | Standalone Windows Chrome timeout still needs a reproduction on the pinned runtime. |
| [#374](https://github.com/miuuyy/codex-chatgpt-web/issues/374) | App identity and connector contract migration remain distinct from display-name matching. |
| [#339](https://github.com/miuuyy/codex-chatgpt-web/issues/339) | Revoked-token rejection is correct; protected active-trace diagnostic retention is implemented, but the original abort initiator is unproven. |

## Current local Chrome work

The current working tree improves error classification/progress for the explicitly approved
reuse of the user's existing normal Chrome session. In particular, operating-system denial of
Chrome connection-information access, launcher authorization failure, Chrome permission denial,
timeout, missing session, capture and verification are distinct boundaries. This work does not
use public issue narratives as permission to access another profile, bypass a Chrome consent,
reset authentication, or label an unverified session authenticated. A grey launcher renderer and
an existing-session import failure require their own local observations. Neither is established
as a duplicate of #431 by the new proxy report.

## Verification and remaining gates

| Scope | Directly observed local result |
| --- | --- |
| #447 / #448 compaction | Nine new semantic tests failed before the fix and passed afterward. Six relevant compiler/usage/Manual/retained/server suites: **95 passed, 0 failed, 1,160 assertions**. |
| #450 stopped-thinking detection | The old detector missed both synthetic Chinese cases. Five focused checks passed; both complete affected worker/harness suites: **215 passed, 0 failed, 1,225 assertions**. |
| #431 hook interleaving | New locator/lifecycle regressions first failed. Final legacy/JSON/integration suites: **77 passed, 0 failed, 600 assertions**. Independent review found and then verified the no-final-newline fix: **5 focused cases, 136 assertions**, no remaining blocker. |
| #451 diagnostic proposal review | Actual fork SDK accepted the deep-input fixture; the proposed observer instead raised `RangeError` before dispatch. No source adoption. |
| #455 feature review | Exact proposed DEV argument parsing rejected both emitted policy flags; exact helper evaluation matched an unrelated namespaced `send_message`. No source adoption. |
| #452 diagnostic boundaries | Two existing drained-runtime/catalog-observation fixtures passed, **8 assertions**. They establish local behavior, not the reporter's cause. |

Focused counts overlap and must not be added as a unique repository total. Root TypeScript and
scoped whitespace checks passed for all three completed corrections. The hook correction's
provenance records its final verification, including independent no-final-newline review.

This review uses official issue/PR bodies, comments, current patch heads, source inspection and
isolated fixtures. The three selected corrections still require final combined release
verification and installation. Their provenance documents record completed local results. No upstream
review status, patch merge, synthetic fixture, successful catalog request or package build is
reported as a completed user login, installed Codex/MCP task, or resolution of every reporter's
account/platform symptom.
