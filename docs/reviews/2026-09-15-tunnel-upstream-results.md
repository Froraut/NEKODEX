# NEKODEX — tunnel corrections and open upstream review

Date: 2026-09-15. Baseline: `359d8fc000d73b32497cf6465fbd3cd1998d3a14`.
Source development version remains `5.2.0-nekodex.2`. This task does not build a distributable, change the installed app, restart production, or publish a release.

## Execution and counting

One `gpt-5.6-sol` medium agent performed tunnel research, selected improvements, consulted upstream GitHub sources, then completed three sequential correction runs with retained context. At the user's subsequent request, fifteen additional Sol medium researchers reviewed disjoint groups of open upstream issues/PRs in parallel. Completed researchers were reused for accepted corrections; no further agents were spawned. Total unique agents: **16**.

The live upstream inventory contained **74 open records: 46 issues and 28 PRs**. All were assigned once across reports [01](2026-09-15-upstream-01.md) through [15](2026-09-15-upstream-15.md). Related issue/PR pairs and overlapping symptoms are not independent defects. The related closed PR #403 was inspected as context for #405, not counted as another open item. These are source and upstream-report assessments, not reproductions on every reporter's platform/account.

## Three tunnel correction runs

| Run | Result | Coordinator dispatch-to-collection | Agent-reported working interval |
| --- | --- | --- | --- |
| 1 | Implemented T01 bounded download, T02 filtered ZIP extraction, and per-probe part of T03 | 4m 02s | 2m 39s |
| 2 | Corrected the remaining T03 unload-deadline ordering; 0 new independent defects | 2m 23s | 41s |
| 3 | No further source correction justified; clarified reports | 1m 54s | 43s |

Initial research took 3m 16s by the coordinator clock. Collection time includes scheduling, parent integration and new user requests; it is not model compute. The full task through the last agent collection took 24m32s; the added upstream review plus correction/integration portion occupied 15m18s of that interval. These include coordination and scope changes. There were **3 unique tunnel findings**, not 3 plus another deadline bug: run 2 refined T03.

- T01: stream and count response bytes before assembling the final array; cancel and release on failure. Archive cap 100 MiB, checksum cap 1 MiB. The final copy can temporarily duplicate the bounded bytes, and a received chunk already exists before it can be rejected.
- T02: use the existing `fflate` filter to expand only the intended executable; bound entries and declared/output binary size; reject ambiguous and unsafe paths. Preserve pinned client version and checksum verification.
- T03: `launchctl print` has a per-probe timeout; unload polling checks its deadline before probing and caps each probe to remaining time. This is not a 20-second guarantee for the complete stop operation, which also contains `bootout` and other status reads. OS scheduling and synchronous process termination can add overhead.

Research and raw run reports: [research](2026-09-15-tunnel-research.md), [run 1](2026-09-15-tunnel-correction-1.md), [run 2](2026-09-15-tunnel-correction-2.md), [run 3](2026-09-15-tunnel-correction-3.md).

## Upstream decisions integrated

| Item | Decision |
| --- | --- |
| [PR #488](https://github.com/miuuyy/codex-chatgpt-web/pull/488) | Adapt the useful shared URL/MIME validator and reject unsupported effective Web image inputs before adapter construction. Preserve native passthrough and valid inline attachments. Worker still owns base64/count/byte limits. |
| [Issue #482](https://github.com/miuuyy/codex-chatgpt-web/issues/482) | Publish the Automatic native target before setup inspects it, restore the prior mode on failure, and retain the committed override until launcher state catches up. Include selected-account aggregate descriptor handling. |
| [PR #459](https://github.com/miuuyy/codex-chatgpt-web/pull/459) | Preserve the user's selected tab when acquiring/reusing a hidden Automatic turn. Existing configurable capacity already supersedes the PR's fixed ten-tab limit. |
| [PR #435](https://github.com/miuuyy/codex-chatgpt-web/pull/435) | Existing JSON-hook support stays; repeated disconnect now checks inactive v11 hook ownership without silently removing a reappeared/foreign hook. |
| [Issue #431](https://github.com/miuuyy/codex-chatgpt-web/issues/431) | Distinguish unavailable session verification from a proven signed-out session. HTTP/protective responses and network failures do not instruct the user to sign in; setup still requires verified authentication. |
| [Issue #411 / PR #413](https://github.com/miuuyy/codex-chatgpt-web/pull/413) | Add the missing Manual row to the Chinese README, with current text-only and connector semantics. |

This is **five bounded runtime corrections and one documentation correction** selected from upstream review, in addition to the three tunnel findings. Several are residual edges of previously adapted changes; do not call all of them newly discovered upstream bugs.

### Deliberately not integrated

- **#487:** confirmed `codex_exec` wrapper compatibility gap. An optional-field implementation was evaluated, then withdrawn because it changes the immutable Native3/ZeroRisk2 public schema and needs a coordinated connector-identity migration. No schema/pin/profile change remains. The existing exact structured `codex_tool_call` route remains available, with outer Codex retaining approval authority.
- **#426, #484, #436:** parent counter-review removed three overstrong defect classifications. Page closure has an error/settlement path; Manual already has authoritative completion and cancellation; personalization already has a bounded fail-closed check. A specific failing trace is needed before changing these policies.
- **#339:** revoking an abandoned capability is intentional. Keeping old executable tokens alive based only on a stale-claim message could violate turn isolation; no such change was made.
- **#374/#425:** custom connector name search/setup is an optional compatibility improvement. **#427:** repeated unchanged instructions are a potential retained-context optimization, not demonstrated semantic corruption; skipping them needs an acknowledged-delivery state, especially after retries and new surfaces.
- **#472**, **#460/#461**, **#474**, **#470**, **#464**, **#465**, **#445**, **#462**: useful candidates for separate transport, compaction, usage, read-tool, DEV and policy changes. Their broad/stacked patches would change lifecycles or public contracts and have not been imported. In particular, TXT recall reports do not establish a guaranteed model context window; usage dashboards must not claim account quota.
- PAC adaptation, retry handoff, Pro selection, cumulative checkpoints, retired-handle scrubbing, MCP pre-validation diagnostics, dependency fixes and several catalog/localization changes are already in NEKODEX. Reports identify the matching code; they are not duplicate patches.

## Small before/after extraction sample

Same synthetic ZIP (4,429 compressed bytes): one 64 KiB executable and one irrelevant 4 MiB file. Two repetitions, old `unzipSync(archive)` versus current `extractTunnelBinary` in the same Bun 1.4.0 process:

| Repetition | Old extraction | Selective extraction | Materialized returned bytes, old → new |
| --- | ---: | ---: | ---: |
| 1 | 33.51 ms | 7.47 ms | 4,259,840 → 65,536 |
| 2 | 22.08 ms | 0.90 ms | 4,259,840 → 65,536 |

The returned payload is 65 times smaller for this deliberately irrelevant-file-heavy sample. This is not a heap peak, real release benchmark, network speed measurement, or overall NEKODEX speedup. JIT/cache effects are visible in the two timings; no stable speed multiplier is claimed.

## Verification and delivery boundary

Five named focused cases were selected, approximately nine expanded scenarios:

1. Bounded stream rejects an undeclared oversized body and cancels reading.
2. ZIP extraction selects the executable and rejects an unsafe path.
3. Web HTTP boundary rejects unsupported URLs/MIME before creating the adapter; valid inline inputs remain accepted by automatic/Manual route stubs.
4. Existing retained-conversation case now verifies background reuse preserves the user's home selection.
5. Real generated authentication-probe script executed in a small VM with a failed fetch reports verification unavailable and retains the setup gate.

All five passed. Backend `tsc --noEmit` passed in 2.26 seconds; final `node --check` passed for browser-host, account-pool and main. Test/type/syntax execution and the tiny extraction sample used under five seconds in aggregate. No unchanged case was rerun. The HTTP adapter and browser environment are test doubles; these results do not prove live ChatGPT upload, Electron CDP switching, Windows setup, or current account readiness. Hook ownership and descriptor transaction branches were reviewed directly. No full suites or mass dependency audit ran. All sixteen agents were closed after their reports and accepted corrections were collected; no development app or server was left running.

## Efficiency conclusion

The earlier three waves used 48 fresh agents and had dispatch-to-collection windows of 5m08s, 6m03s and 2m11s on a much larger scope. This task used one retained-context agent for the narrow tunnel path and fifteen parallel readers only after an explicit request expanded the scope to 74 upstream records. Those are different workloads; neither raw elapsed time nor finding counts establish a controlled winner or token-cost reduction.

Practical result: keep a sequential owner for a tightly coupled lifecycle; parallelize independent upstream groups; require source counterevidence before counting a defect. Two workers briefly touched different methods in the same browser-host file; parent stopped the overlap and assigned the remaining combined host work to one writer. Future scopes must name exact files/methods and escalate ownership changes before editing. The third tunnel pass correctly produced no forced refactor. No token/cost figures were exposed, so none are estimated.
