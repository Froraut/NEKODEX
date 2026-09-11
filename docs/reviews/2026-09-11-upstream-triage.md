# Upstream issue and pull-request review

Reviewed on 2026-09-11 for fork build **5.0.7-froraut.1**, starting from fork commit `ae98fbd`.
Upstream `main` remained `e85e369`. The review retrieved all **23 open issues** with their
narratives/comments and all **7 open pull requests**, screened the **80 latest closed issues**,
examined **22 relevant closed issues** in detail, and checked **25 recently merged PR commits**.
All 25 merged commits were already ancestors of this fork.

> **2026-09-11 follow-up, candidate 5.1.0-froraut.1:** The original review and 5.0.7 installation
> checkpoint below remain historical. The [completion review](2026-09-11-completion-review.md)
> supersedes the old deferred implementation decisions for #430, #432 and #439, adds #442 and
> the guarded #441 failure mode, and separates source completion from signing/account/platform
> acceptance. The current upstream refresh found 24 open issues and 8 open PRs at 19:35 UTC;
> upstream `main` remained `e85e369`. Nothing here implies upstream closure or acceptance.

Reports and patches are evidence to investigate, not proof that their diagnosis or proposed fix
is correct. No user credentials, account sessions, raw issue attachments, or live Codex
configuration were used in the upstream review fixtures.

## Selected changes

- **Independent Extra High capability — issue #416.** A four-position reasoning slider can
  expose Extra High without Pro. Preserve that independent capability throughout detection,
  configuration, login markers, setup, IPC, catalog admission, adapter selection, and context
  budgeting. Unknown or contradictory evidence remains rejected. Regression fixtures credit
  [aktsmsm's observed slider report](https://github.com/miuuyy/codex-chatgpt-web/issues/416).
- **Existing JSON hooks — PR #435.** Incorporate the complete ownership-aware v11 journal change,
  including trust state, migration, interruption recovery, symlinks, rollback and uninstall.
  The mixed-source warning was reproduced, but it did not itself prevent Codex from finding
  hooks. This is a compatibility improvement, not a blanket fix for installation failures.
  Original author and exact source commits are recorded in
  [upstream PR provenance and validation](../upstream-pr-435-integration.md).
- **Filename labels — issue #434.** Preserve only the reported entity-button filename as inert
  escaped text/code, through both DOM projection and Markdown conversion. Do not infer a URL,
  download a file, or grant a rendered filename authority to access a local path. The report's
  DOM example is synthetic; general artifact delivery remains a separate feature.
- **Manual-mode diagnostics — issue #411 / PR #412.** Include Zero Risk/manual mode and the
  manually selected ChatGPT model/effort in issue reporting. Explain the separate handoff stages
  and privacy-safe diagnostic collection without promising the elimination of all account risk.

## Open issues

The table records review disposition. It does not claim that upstream issues have been closed
or that every account-specific symptom is resolved by this fork.

| Issue | Area | Disposition |
| --- | --- | --- |
| [438](https://github.com/miuuyy/codex-chatgpt-web/issues/438) | Install to Codex | Needs actual catalog-request/provider/home evidence; successful file installation is not catalog verification. |
| [437](https://github.com/miuuyy/codex-chatgpt-web/issues/437) | Codex Native unavailable | Existing exact-name and stale-catalog recovery covers known cases; account/workspace/DOM failure boundary is unproven. |
| [436](https://github.com/miuuyy/codex-chatgpt-web/issues/436) | Personalization preflight timeout | No deterministic reproduction. Keep the verification gate; do not skip it or increase deadlines without cause. |
| [434](https://github.com/miuuyy/codex-chatgpt-web/issues/434) | Attachment labels/artifacts | Narrow label-preservation fix selected; general download/storage/Outputs integration deferred. |
| [431](https://github.com/miuuyy/codex-chatgpt-web/issues/431) | Linux DEV session verification | Fresh setup inspection differs from earlier smoke; posted diagnostics are insufficient to establish the failure. |
| [428](https://github.com/miuuyy/codex-chatgpt-web/issues/428) | Follow-up connector mention | Retained-conversation omission is intentional. Need evidence that the actual connector binding was lost. Closed 429 is a duplicate. |
| [427](https://github.com/miuuyy/codex-chatgpt-web/issues/427) | Instruction deduplication | Feature backlog requiring authoritative instruction revisions; do not drop required instructions just because a tab is reused. |
| [426](https://github.com/miuuyy/codex-chatgpt-web/issues/426) | Bigger Context preparation hang | Proposed budget mismatch is a hypothesis; transaction and message budgets differ intentionally. Need dispatch/cancellation evidence. |
| [425](https://github.com/miuuyy/codex-chatgpt-web/issues/425) | Replace old connector | Fixed identities are intentional; multi-device/custom identity support needs a coordinated design. |
| [424](https://github.com/miuuyy/codex-chatgpt-web/issues/424) | Post-compaction trusted environment | Browser completion does not prove an accepted Codex checkpoint. Existing 398 fixes are present; exact handoff still needs evidence. |
| [423](https://github.com/miuuyy/codex-chatgpt-web/issues/423) | Reported safety-check rejection | Quoted phrase is model-reported, not an application error. Need actual failing tool/broker results; no enforcement bypass is justified. |
| [422](https://github.com/miuuyy/codex-chatgpt-web/issues/422) | Windows ARM64 invisible startup | Needs platform reproduction. A larger timeout alone is not causal proof; visible startup recovery is a later improvement. |
| [420](https://github.com/miuuyy/codex-chatgpt-web/issues/420) | Windows native passthrough 502 | Reporter withdrew reproduction and attributed it to local/incomplete configuration; not claimed as a fork fix. |
| [418](https://github.com/miuuyy/codex-chatgpt-web/issues/418) | No native tool found | Zero tool calls do not identify the broken boundary; connector selection is not invocation proof. |
| [416](https://github.com/miuuyy/codex-chatgpt-web/issues/416) | Extra High without Pro | Implemented with regression fixtures; refresh actual account capabilities to discover the independent bit. |
| [414](https://github.com/miuuyy/codex-chatgpt-web/issues/414) | Hook configuration drift | Known CRLF/comment normalization is already covered. Exact changed fragment is absent; JSON hook compatibility is independently improved. |
| [411](https://github.com/miuuyy/codex-chatgpt-web/issues/411) | Manual-mode reporting | Documentation/issue-form correction selected. |
| [410](https://github.com/miuuyy/codex-chatgpt-web/issues/410) | Goal failure | No exact error or diagnostic sequence; no defensible runtime change identified. |
| [408](https://github.com/miuuyy/codex-chatgpt-web/issues/408) | Tools disappear across turns | Needs correlated continuation, connector and invocation evidence. |
| [407](https://github.com/miuuyy/codex-chatgpt-web/issues/407) | Capacity and stale turn identity | Stale revision already returns terminal 400; separate fresh capacity symptom remains unproven. |
| [405](https://github.com/miuuyy/codex-chatgpt-web/issues/405) | Standalone Windows Chrome timeout | Needs reproduction on the pinned runtime; standalone Chrome and packaged Electron are distinct paths. |
| [374](https://github.com/miuuyy/codex-chatgpt-web/issues/374) | Connector App ID | Custom identities were intentionally removed. Clearer selection-vs-invocation diagnostics are useful; ABI redesign is deferred. |
| [339](https://github.com/miuuyy/codex-chatgpt-web/issues/339) | Retired MCP binding | Revoked-token rejection is correct; abort initiator is unknown. Active-trace diagnostic retention remains a real improvement opportunity. |

## Open pull requests

None of these seven PRs exposed completed review/check results at the inspection time.
Independent tests of adopted work are recorded separately from author-reported evidence.

| PR | Author / inspected head | Decision |
| --- | --- | --- |
| [435](https://github.com/miuuyy/codex-chatgpt-web/pull/435) | aolin480 / `2ed03f60` | Adopt complete validated JSON hook ownership/restore change; retain attribution. |
| [432](https://github.com/miuuyy/codex-chatgpt-web/pull/432) | gmoroz / `5b8face7` | Defer retry-date extraction until the tooltip is tied to the Pro control; global text matching can select unrelated chat text. |
| [430](https://github.com/miuuyy/codex-chatgpt-web/pull/430) | oenderg / `bbdb4077` | Defer public read-only MCP ABI change; needs connector refresh and a fresh installed task invocation. |
| [439](https://github.com/miuuyy/codex-chatgpt-web/pull/439) | JulianZJN / `039c385f` | Defer optional Pro-family pinning and retained-namespace changes; separate from the observed login/model-capability bugs. |
| [415](https://github.com/miuuyy/codex-chatgpt-web/pull/415) | ogyrec-o / `826f8804` | Already covered: Hono 4.13.5 and js-yaml 4.3.2 are in the fork's audited lockfiles. |
| [412](https://github.com/miuuyy/codex-chatgpt-web/pull/412) | NickYCLin / `e73e910b` | Adapt manual-mode reporting and troubleshooting. |
| [413](https://github.com/miuuyy/codex-chatgpt-web/pull/413) | Cham1229 / `21017470` | Existing localized manual-mode documentation retained; reject absolute no-risk wording. |

## Relevant closed reports and remaining work

Released fixes were present with matching source/tests for **398, 394, 379, 377, 376, 372, 352,
348, 322, 318, 314, 288, and 280**. Relevant changes were present, while exact original
account/platform acceptance remained unproven or partial, for **397, 357, 353, 346, 323, 316,
and 275**. Closure of **321** did not establish its root cause. **267** confirms the value of
diagnosing a custom model provider bypassing the bridge without deleting user configuration.

Additional bounded opportunities remain: protect diagnostics for active traces from retention
pruning, bound individual peer-CDP acquisition waits, and show effective provider/home/catalog
diagnostics during setup. The existing outer timeout mitigates some peer-acquisition stalls;
it is not proof that every internal wait obeys its own timeout.

The earlier [security/reliability review](2026-09-11-review.md) remains applicable. A successful
package build or startup smoke does not prove live ChatGPT passkey acceptance, a connector
invocation, or a full installed Codex turn. Installation and live validation are recorded separately.

## Build and installation checkpoint

The integrated **5.0.7-froraut.1** source passed `bun run verify` on macOS arm64:
**777 core tests passed** (one Windows-only skip), **343 launcher tests passed** (one Linux-only
skip), zero failures, both dependency audits clean, both typechecks successful, and a successful
relocated runtime smoke. The native macOS package build and its packaged startup smoke passed.

The packaged app replaced the previous installed copy after a private rollback backup was made.
The running Settings screen reports **5.0.7-froraut.1**, the installed `app.asar` hash matches the
verified archive, and the existing language, startup preference, interaction mode, onboarding,
and context preference were preserved. The installed app was observed switching an active
embedded login directly into the Chrome passkey flow, with disabled navigation and a visible
**Import Chrome sign-in** guide, without waiting for the old login timeout.

These observations prove package installation and the login handoff. They do not assert a completed
user passkey verification, a successfully imported account session, or an installed Codex/MCP turn.

Artifact checksums:

- macOS arm64 ZIP: `06d4d59c7b2d9d7ddde05f2778379b9cb7a6aa00077d0614a6dc2218baba282f`
- Installed `app.asar`: `d7d074a4e4051dff0b353c2a8f94eee4ae108415eab97a9204dcf67396f0e434`
- Runtime bundle identity: `b2963f853eac42b6e927aea3ab5a27f2f453b36ab6df97f7a126ae21accb71df`

The local package has an ad-hoc signature verified with `codesign --verify --deep --strict`.
This is not Developer ID signing or notarization, and no stable binary release is claimed.

## 2026-09-11 follow-up dispositions for 5.1.0-froraut.1

This dated addition does not rewrite the 5.0.7 table or its observed installation hashes.
The [completion review](2026-09-11-completion-review.md) records exact inspected heads,
contributors, code/test evidence and the nine prior improvement areas.

| Item | Updated disposition |
| --- | --- |
| [PR #430](https://github.com/miuuyy/codex-chatgpt-web/pull/430) | Read-only task action implemented with exact structured-tool validation and fresh Native3/Native3 DEV/Zero Risk2 connector identities. Local stdio tests passed; creation and installed Automatic/Manual dispatch remain separate account gates. |
| [PR #432](https://github.com/miuuyy/codex-chatgpt-web/pull/432) | Retry-date extraction implemented only for a visible tooltip explicitly linked to the exact Pro control. Unrelated text is rejected; missing linkage preserves the original error. Live quota evidence remains unverified by this fork. |
| [PR #439](https://github.com/miuuyy/codex-chatgpt-web/pull/439) | Optional Pro-family selection implemented with per-request snapshots, exact pre-send verification and retained-history separation that preserves logical cancellation/replay ownership. Fresh account and installed-tool acceptance remain unverified. |
| [PR #442](https://github.com/miuuyy/codex-chatgpt-web/pull/442) | New since the original inventory. Six-kind, escape-aware, exact-length replay scrubbing implemented with upstream provenance and broader local regressions. |
| [Issue #441](https://github.com/miuuyy/codex-chatgpt-web/issues/441) | New since the original inventory. Generic provider errors after send activation are terminal, preventing automatic duplicate replay. The actual worker-path fixture verifies one send and cleanup; the original provider/account root cause is not established. |

All four PRs and issue #441 remained open at the follow-up inspection. No new upstream changes
were imported solely because they appeared in the refreshed list. The current candidate has no
recorded completed account session, installed Codex/MCP acceptance, notarized Apple release or
Windows publisher signature; final integrated/package/install evidence belongs to the new report.
