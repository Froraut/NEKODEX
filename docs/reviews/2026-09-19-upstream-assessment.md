# NEKODEX upstream assessment — 2026-09-19

## Baselines and scope

- Upstream: https://github.com/miuuyy/codex-chatgpt-web
- Latest published release: v5.0.8, published 2026-09-16 21:15:45 UTC; peeled commit `00aab23eb78a0d35ab575ff14044e29c0f80e711`. “5.8” in the request corresponds to v5.0.8.
- Current upstream main: `eaf4f09ae92d4dc4429fa597b0861663138f08f8`, including post-release `cea5e1c` and six-part transport `eaf4f09`.
- Local NEKODEX main: `4eb5d177adadad276fde20cd9b07129624273370`; package version `5.3.0-nekodex.1`; integration commit `637ce65` is included.
- Installed `/Applications/NEKODEX.app` runtime manifest independently reports `5.3.0-nekodex.1`, release commit `de79f5d5ec8a41f599acfa393760c219a95dad34`, clean build, ARM64. The earlier handoff document's “still .9” statement is stale. Installed files do not prove current process identity, account access, or successful post-update requests.
- Live GitHub snapshot: 34 open issues and 14 open PRs. Closed recent PR metadata was also inspected to distinguish closed proposals from merged changes.
- Read-only source/manual assessment, with three parallel scoped readers. No tests, builds, runtime restarts, account requests, installation or publication. Existing updater edits, branding inventories and dependency links were preserved. This report is the only new working-tree artifact from this task.

## v5.0.8 coverage

| Release item | Local status and evidence |
| --- | --- |
| DIL/PUIK assistant reply roots | Present: `src/adapters/chatgpt-web/browser-worker.ts:4098`, with local commentary/ownership safeguards. Earlier isolated Electron evidence is recorded in `2026-09-18-implementation-plan.md:42`; not repeated here. |
| Selected skills as files | Present: `src/adapters/chatgpt-web/skill-attachments.ts` is identical to the release version. Native selected-skill provenance, opt-in setting, token and combined attachment accounting were included in `637ce65`. |
| Native system HTTP(S) proxy | Functional equivalent already present: `launcher/electron/native-proxy.cjs:37`, main's provider wiring, supervised child environment, and `src/native-passthrough.ts:32`. Explicit environment settings win; unsupported proxy protocols are rejected. It resolves for the managed runtime rather than upstream's per-request control RPC, so PAC/VPN changes during a running process are not equivalent. |
| Actionable model catalog failure in launcher | Missing. Local `main.cjs:213` monitors successful catalog requests only; `src/server.ts:385` lacks upstream failure receipt/stage/code reporting. Port this while retaining local epoch/config/ownership guards. |
| First-run X invitation wording | Upstream-specific promotion, not a functional NEKODEX requirement. |

Conclusion: the main release capabilities are present, but claiming complete v5.0.8 parity would be inaccurate because catalog failure diagnostics are missing and proxy refresh semantics differ.

## Confirmed additional source gaps after the release

1. **High: reasoning composer size and owned HTTP 413 errors.** Local `src/chatgpt-web-models.ts:74` permits 1,045,000 characters; upstream `cea5e1c` reduced this to 500,000 following its measured server rejection. Local browser worker lacks `ChatGptSubmissionRejectionObserver` / `message_length_exceeds_limit` classification. Adapt the conservative ceiling and exact owned-request classification; the upstream measurement is not a live NEKODEX reproduction or universal account guarantee.
2. **High: six-part Bigger Context transport.** Local `prompt.ts:48` and helper/browser validation still support two/three parts. Upstream `eaf4f09` supports two/six while preserving a threefold advertised context multiplier. Adapt compiler, helper boundary, browser preflight, usage accounting and labels together. Preserve whole records, transaction ACKs, final-only tools/attachments and the chosen execution model. More transport parts do not increase model capacity, and an indivisible oversized record can still fail.
3. **High: authenticated same-turn steering environment.** Local `thread-environment.ts:168` rejects current non-compaction envelopes outside its historical fallback; upstream adds `extractChatGptSteeringEnvironmentClaim` and compares authority against the canonical current rollout. Adapt that narrow path, not an unconditional cached-cwd fallback. Related #557; closed #568 is not evidence of a merged solution.
4. **Medium/high: persist selected reasoning effort across UI rerenders.** Upstream reopens the effort menu, verifies the committed selection, then checks its surface/label before send. Local `browser-worker.ts:3642` does the final check only when `expectedMode.modelVersion` is pinned. Extend to ordinary effort selection while preserving local pinned-version safeguards. Related #564; local composer retry already exists and is a distinct layer.
5. **Medium: deferred tool discovery on an empty filtered inventory.** Local `mcp-server.ts:974` returns an empty tools page with no `discovery_tools`. Upstream exposes the actual available native tool-search entry separately on a miss. Adapt without widening Native4/Zero Risk visibility or executing discovery automatically.

Do not reimplement the already-present nonretryable rate-limit dialog, durable account cooldown, original structured-compaction error propagation (`index.ts:1151`), historical same-thread environment recovery, owned setup handoff, or previously integrated optional controls solely because their upstream PR remains open/was recently closed.

## Open pull request decisions

The PR reader covered all 14 open proposals, using bodies/diffs and local call paths. These remain unmerged proposals and have not been runtime-tested here.

| PR | Decision |
| --- | --- |
| [#553](https://github.com/miuuyy/codex-chatgpt-web/pull/553) fresh conversation | **Fix local integration first.** Parent confirmed `index.ts:449` suppresses conversationKey, while Full worker `browser-worker.ts:4584` still sends connectorIdentity, and `control-server.cjs:165` rejects identity without key. Feature exists, but this source path is inconsistent. No live reproduction performed. |
| [#578](https://github.com/miuuyy/codex-chatgpt-web/pull/578) plan markers | **Adapt.** Local `markdown.ts:187` lacks restoration of standalone proposed_plan markers after Markdown escaping. Preserve literal markers without changing code/quoted content. |
| [#579](https://github.com/miuuyy/codex-chatgpt-web/pull/579) live-turn DOM timeout | **Adapt.** Local `browser-worker.ts:3000,5287` starts rebind before checking broker activity. Bounded grace/backoff helps avoid disrupting a provably live turn. A timeout does not cancel an already-stalled evaluate call. |
| [#577](https://github.com/miuuyy/codex-chatgpt-web/pull/577) retry same-page rebind | **Adapt narrowly.** Local `browser-worker.ts:4848` has one attempt. Retry only after safe old-transport settlement; do not copy broad error matching or ignored close errors. |
| [#581](https://github.com/miuuyy/codex-chatgpt-web/pull/581) retire unanswered tool batches | **Useful design, not a direct cherry-pick.** Local `turn-execution.ts:396,998` lacks delivery-age expiry for active sessions. Thirty minutes of silence alone does not establish abandonment of a legitimate long tool. Preserve ownership/replay semantics; local constructor argument three is already maxReplayBytes. |
| [#580](https://github.com/miuuyy/codex-chatgpt-web/pull/580) bounded ownership probe | Already present with stronger local deadline/abort/late-session cleanup in `launcher-browser-host.ts:289`; no port. |
| [#582](https://github.com/miuuyy/codex-chatgpt-web/pull/582) Windows titlebar | Different layout; local CSS already offsets browser content, and overlay uses 52 px rather than upstream proposal's 46 px. No direct port. |
| [#583](https://github.com/miuuyy/codex-chatgpt-web/pull/583) native replay docs | Optional documentation/cases. Runtime normalization already exists in `native-passthrough.ts:104,292`. External routes that bypass this layer remain outside its guarantees. |
| [#560](https://github.com/miuuyy/codex-chatgpt-web/pull/560) isolated Windows packaging smoke | Useful before Windows distribution. Local `smoke-package.cjs:98` runs installer/registered app; adapt extracted-payload approach without losing AccountPoolHost.ready initialization. No Windows package check was run. |
| [#555](https://github.com/miuuyy/codex-chatgpt-web/pull/555) Windows system CA docs | Optional troubleshooting with NEKODEX executable names. |
| [#474](https://github.com/miuuyy/codex-chatgpt-web/pull/474) compaction model | Already present, `chatgpt-web-compaction-policy.ts:65`, App settings. Idle-only preference changes are a deliberate local difference. |
| [#470](https://github.com/miuuyy/codex-chatgpt-web/pull/470) usage dashboard | Dashboard/storage already present. Optional additions: observed unpinned Pro version, lifetime breakdown and recovery backups. Preserve schema/history through migration; do not add a second recorder. |
| [#462](https://github.com/miuuyy/codex-chatgpt-web/pull/462) Web subagent setting | Already present in App/parser/MCP filtering. Do not import stacked unrelated changes. |
| [#439](https://github.com/miuuyy/codex-chatgpt-web/pull/439) Pro version preference | Already present, including pinned pre-send verification. |

## Open issue assessment

All 34 open issue bodies were covered by the issue lane and its readers, including all 14 numbered 541+. Relevant maintainer comments and selected user follow-ups were read; this is not a claim to have read every historical user comment or downloaded diagnostic archives. No reported incident was reproduced here.

- **#541 / #552 / #557:** high-priority source gaps described above: composer ceiling and owned 413 classification, six-part transport, and authenticated same-turn steering. The upstream 500k measurement does not explain every Plus/short-message report; six parts do not fix an indivisible oversized record; steering recovery must validate current native authority.
- **#564 / #466:** general effort-persistence guard is missing. Existing composer retry and pinned-model check are partial coverage, not proof that the reported attachment failure is fixed.
- **#443:** additional medium-priority gap in `src/codex-interrupt-hook.ts:319,385`: semantically equivalent TOML basic/literal string trust keys can fail textual matching. Upstream `cea5e1c` handles this without relaxing hook ownership. Most relevant to Windows. Prior interleaving fixes do not cover this spelling change.
- **#543 / #452 / #438:** add catalog failure diagnostics; native proxy support alone does not prove the disappearance/503 reports are solved. `route-diagnostics.cjs:51` still treats zero successful requests as waiting.
- **#437 / #436:** improve diagnostic precision. Missing connector menu row should not prove the connector is uninstalled (`browser-worker.ts:3203`); unproven personalization state should not be labelled unpersonalized (`browser-worker.ts:607`). These reports do not justify merely increasing timeouts.
- **#551 / #547 / #556:** relevant mechanisms already covered: old 15-second setup clamp removed, rate-limit failure nonretryable with cooldown, typed compaction failure preserved. An AggregateError during simultaneous retirement failure is a conditional remaining diagnostic concern, not a reproduced cause of #556.
- **#549:** local `setup.ts:477` preserves successful bootstrap runtime. New upstream supervisor-owned startup differs, but the original SIGTERM bug has not been demonstrated in this fork.
- **#428 / #418 / #408:** retained conversations skip connector selection; recent user A/B evidence merits a targeted investigation. Do not claim deferred tool-discovery changes alone solve it.
- **#489 / #449 / #446 / #423:** reported upstream safety failures, not an established local fix opportunity. No safety-bypass recommendation.
- **#546 / #407 / #441 / #561:** capacity, identity, generic site error and post-compaction/CUA reports remain unproven as local bugs.
- **#545 / #570 / #542 / #339 / #485 / #484 / #426 / #424:** existing DOM completion, token ownership and handoff mechanisms were considered. Local completion is not blocked solely by sawRunning=false; newer correlated evidence is needed before changing token/handoff policy. The author correction on #485 and existing cancel-before-tab-removal mitigation for #426 were accounted for.

Recommended next implementation order: fix the local fresh-conversation contract; adapt 500k/413 plus six-part transport as one coherent context change; add exact same-turn steering recovery; complete catalog diagnostics; preserve plan markers and improve live-turn/rebind recovery; then general effort persistence and deferred discovery. Windows-only changes and richer usage statistics are separate lower-priority work. Abandoned-tool timeout policy needs explicit correctness design, not an unconditional 30-minute kill.

## Delivery interpretation

This assessment recommends selective adaptations. It does not authorize a blanket upstream merge or treat reported upstream incidents as reproduced local bugs. The source fork has additional account affinity, proxy, cancellation, connector and updater behavior that a wholesale replacement could lose. Current installed metadata is newer than the historical handoff note, but no live account/route health claim is made.
