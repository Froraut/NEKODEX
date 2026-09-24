# Major benefits — four Sol waves, 2026-09-21

Base `72dfbcb`; branch `codex/nekodex-major-benefits-20260921`.
User requests meaningful product improvements with concise communication: 16 backend reviewers, 16 frontend reviewers, 16 implementation lanes, 16 independent final reviewers. The same 16 Sol agents are reused across sequential waves. Changes are selected for user impact, not finding count.

## Backend wave proposals (all 16 reports received)

| Lane | Proposal | Decision entering frontend review |
| --- | --- | --- |
| 01 | Safety-aware fresh balanced selection, pre-tab fallback | Challenge policy and ownership; no automatic fallback approved. |
| 02 | Pure safety availability before fresh balanced assignment | Same candidate as 01; require compatibility with cooldown policy. |
| 03 | Observe already-submitted turn after daemon crash | Large recovery design; no resubmission or guessed recovery proof allowed. |
| 04 | Per-account/model outcome and latency diagnostics | Strong candidate: useful comparisons from existing aggregates with explicit sample coverage. |
| 05 | Shared readiness report and next action | Strong candidate: coherent account/model/tool readiness, no automatic mutations. |
| 06 | Distinguish unavailable auth verification from signed-out, explicit retry | Strong candidate: avoid unnecessary login/setup after transient network failure. |
| 07 | Repair Web tunnel without restarting healthy native work | Strong candidate if existing lifecycle ownership supports narrow safe repair. |
| 08 | Structured task incident and recovery actions | Fold useful explanations into readiness rather than parallel incident architecture. |
| 09 | Durable updater recovery reconciliation | Defer broad installer lifecycle extension pending focused design; not needed for chosen account/workflow benefits. |
| 10 | Durable task history and cancellation ledger | Defer new sensitive persistent history; selected diagnostics reuse existing data. |
| 11 | Freshness-aware bounded parallel account quota portfolio | Strong candidate: faster, coherent multi-account visibility with partial failure support. |
| 12 | Remove fresh-turn idle document bootstrap | Defer Electron critical-path optimization until real benchmark/navigation proof. |
| 13 | Release HTTP ownership before upstream cancellation settles | Not approved: requires proof that reporting idle cannot hide still-owned work. |
| 14 | Live multi-account model catalog overlay | Defer cross-runtime capability protocol; readiness UI can explain actual account evidence without changing provider routing. |
| 15 | Profile-aware staged config repair | Defer config/journal expansion; preserve exact existing route ownership. |
| 16 | Durable tool-operation journal across restart | Defer sensitive persistence/new recovery protocol; process-local ownership boundary preserved. |

Frontend wave evaluates the candidate set as complete user flows and challenges usability, impact, overlap, truthfulness, and implementation risk before scope is frozen. No implementation or live account mutations during review waves.

## Frozen implementation scope after all 16 frontend reports

1. Recover temporary session-verification failure without treating it as signed-out or forcing login. Retain historical identity, fail closed for new dispatch, offer an explicit scoped retry; preserve active work and account selection.
2. Refresh account allowance snapshots with concurrency capped at three, shared per-account in-flight ownership, partial results, freshness and retained last-known values. No cross-account quota totals/ranking or automatic routing. Batch completion is reported honestly; no invented per-request progress or unsupported cancellation UI.
3. Diagnose recorded failures and observed duration by existing account/model usage groups, with sample coverage, meaningful empty states, compact summary and accessible details. No additional sensitive persistence or automatic performance-based routing.
4. Explicit narrow Web tunnel repair preserving the healthy Native daemon, credentials and configured route. Eligibility is authoritative and checked again on action; no success until current health proves recovery. No concurrent or active-Web-work repair.

Supporting presentation: one pure renderer next-action selector reused on Overview/Connections, a compact session-recovery notice preserving Browser tabs, and shared localized feature copy. Existing deep diagnostics remain; no parallel incident/readiness backend framework.

Rejected: automatic balanced rotation due to cooldown/pacing conflicts with explicit current product policy. No fallback after reservation. Deferred candidates above are separate architecture changes, not required for these four benefits.

### Shared wire contracts and ownership

- Auth: `AuthenticationStatus = 'unknown' | 'verified' | 'signed-out' | 'unavailable'`; optional `authenticationStatus`, `authenticationCheckedAt`, `lastVerifiedAt` on browser and account snapshots. Existing `authenticated` remains strict current proof; labels retained on unavailable are explicitly historical. `refreshAccountAuthentication(id)` returns `AccountPoolSnapshot`. Backend retry performs observation only, joins/guards ownership, and does not select/login/reconfigure accounts.
- Quota: extend `AccountQuotaSnapshot` with optional `freshness: 'fresh'|'stale'`, `freshUntil: string|null`, `refreshError: string|null`. Same-owner failed refresh can retain last available values with stale metadata, never across identity/epoch. `refreshAccountCodexQuotas()` returns `{generatedAt, rows:[{accountId,evidenceEpoch,status:'updated'|'retained'|'unavailable'|'skipped',snapshot:AccountQuotaSnapshot|null,reason:string|null}]}`. Backend freezes eligible accounts and uses three workers; no renderer-supplied concurrency. UI keeps existing values while refreshing and respects per-account revisions.
- Usage: `diagnosticGroups` optional backward-compatible snapshot array; discriminated identities `source:'web'|'native'`, existing account/model/effort/mode/message-kind or endpoint/model/source fields, `accepted,completed,failed,cancelled,incomplete?,knownOutcomeTotal,knownOutcomeCompletionRate`, `durations:{observedSamples,eligibleSamples,medianMs,p95Ms}`, `failures:[{code,count}]`, `classifiedFailureSamples`. Period-only, no raw events. Counts factual; comparison/percentile UI marks insufficient samples explicitly.
- Repair: `RuntimeCapabilities.tunnelRepair?: {eligible:boolean,reason:string,active:boolean}`; `repairWebRoute()` returns `{status:'recovered'|'unavailable',reason:string|null}`. Backend checks current generation, Full Automatic config, native+broker health, own tunnel, no active Web/manual work and no competing transition; never drains/restarts daemon or rewrites config. A bounded operation uses existing lifecycle cancellation on shutdown, no new Cancel control without supported ownership.
- Shared copy: `workflowCopy(language)` in new `workflow-copy.ts`; owner16 supplies session/portfolio/recovery/insights subobjects for all six languages. UI writers coordinate requested keys rather than editing that file.
- Sole shared wiring writer: lane13 owns `main.cjs`, `preload.cjs`, `types.ts`, `lifecycle-admission.cjs` if required. Other lanes export their APIs and notify lane13. Lane12 exclusively owns `App.tsx`. No other shared-file writes without handoff.
- Verification: one focused behavioral check per changed contract; parent integrated typecheck/build after owners settle; isolated renderer workflow in wave4. No full repository suites, duplicate check batteries, live auth/provider calls, installer preparation or installed replacement during implementation.

### Wave 3 file owners

| Lane | Exclusive implementation ownership |
| --- | --- |
| 01 | BrowserHost auth evidence and observation-only retry |
| 02 | AccountPool auth projection and scoped retry ownership |
| 03 | Quota reader freshness/last-known retention |
| 04 | Codex account tools batch/coalescing |
| 05 | New pure workspace-readiness helper |
| 06 | Usage-store diagnostic aggregation |
| 07 | RuntimeSupervisor narrow tunnel repair |
| 08 | AccountSettings orchestration |
| 09 | AccountCodexControls and quota summary presentation |
| 10 | UsageDashboard and insights UI |
| 11 | Overview readiness consumer |
| 12 | App.tsx and isolated recovery components |
| 13 | Main/preload/types/lifecycle shared wiring |
| 14 | Pure usage diagnostic presentation/ranking helper |
| 15 | Credential-free fixture and major-benefit UI runner |
| 16 | Shared localized workflow copy |

Waves 1, 2 and 3 are complete (16 reports each). Parent integration feedback added: latest catalog failures override saved readiness; fresh cached quotas are not described as newly fetched; Web admission is fenced and rechecked before tunnel mutation; quota batch handles queued account/epoch changes independently; completion rate uses completed outcomes rather than the inverse failure rate; generic browser errors are not parsed as authentication errors. Integrated launcher TypeScript passed. Wave 4 completed independent review of other owners' changes plus isolated UI verification.

## Final review and verification

All 16 final-review reports were collected and their accepted findings resolved. Review ownership rotated: quota reader, auth host, quota orchestration, usage aggregation, tunnel repair, Accounts, readiness/Overview, quota presentation, Activity, App integration, IPC/types, numeric eligibility, localized copy, auth pool, rendered UI, and product/safety integration.

Accepted findings were corrected before handoff:

- Only authoritative fingerprint-bound session observation can establish verified authentication; smoke/connector/helper success cannot fabricate proof. Login/reset/logout transitions remain coherent. Closed pools reject retries before coalescing.
- Tunnel repair retires monitor generation, settles previous status writes, verifies current false/true acknowledgements, and restores monitoring. A persistence failure cannot erase newly proven Web health. Eligibility requires fresh exact-instance health.
- Quota busy ownership is separate from data revision; epoch changes cannot leave spinners stuck. Retry controls respect active/login/read ownership. Freshness advances at its deadline without a provider request; localized summaries wrap.
- Classified failure coverage excludes unknown and pruned classifications. Completion is actual completed/known outcomes; details expose cancellation and incomplete counts without labelling intentional cancellation a failure.
- Explicit unavailable Web cannot be presented as workspace ready. Optional Automatic tools remain neutral; catalog precedes picker. Native availability claims depend on current Native readiness, and recovered notices are retired on a newer regression.
- Bounded insight helpers reject non-finite limits and impossible sample coverage. All six locales use consistent safe labels and placeholders.

Independent reviewers rechecked the material remediations without duplicating passing test runs. The proposed cached-quota reclassification was rejected: the UI calls fresh cached results **Current**, retains their real observation time, and reserves **Last known** for stale results. Internal row status `updated` does not assert new provider I/O. Automatic ranking of intentional user cancellations as failures was also rejected; factual outcomes are visible in drilldown.

| Focused check | Final result |
| --- | --- |
| Authoritative authentication evidence and read-only retry | 5 passed |
| Account retry ownership, epochs and shutdown | 5 passed |
| Quota freshness, retention and backoff | 3 passed |
| Three-worker portfolio, partial results and identity coalescing | 5 passed |
| Usage group reconciliation, filtering and coverage | 2 passed |
| Tunnel fence, monitor race, ownership and Native preservation | 7 passed |
| Shared readiness truth and mode rules | 7 passed |
| Diagnostic sample qualification and limits | 5 passed |
| Accounts async ownership, retry and automatic TTL expiry | 9 passed |
| Quota presentation and non-aggregation | 2 passed |
| Overview recovery/readiness presentation | 5 passed |
| Mixed-outcome Activity rendering | 1 passed |
| Launcher TypeScript and final renderer build | Passed; final renderer `index-D5905Ebc.js` / `index-D4SnKrmD.css` |

Final isolated browser verification passed all four flows on `index-Cc3d_LX1.js` with zero page errors: authentication unavailable/retry, mixed quota portfolio, evidence-qualified Activity, and Web repair success/failure. After removing a duplicate quota count sentence, only the affected quota and Activity cases were rerun on final `index-D5905Ebc.js`; both passed. Unchanged auth/repair evidence was reused. Synthetic Activity totals were reconciled with both groups (27 total, 22 completed, 4 failed, 1 cancelled).

Parent and UI reviewer inspected desktop and 760px captures plus Russian repair text. No document-level horizontal overflow was present. The detailed Activity table intentionally has local horizontal scrolling for later columns. Screenshots are retained in ignored `launcher/output/playwright/major-benefits-ui/`; exact temporary browser/server processes were closed. Initial browser failures were traced to fixture/selector inconsistencies, not attributed to an unproven stale build, and only affected checks were repeated.

No accepted substantive finding remains in the frozen four-feature scope. All four waves (16 Sol lanes each, same 16 agents reused) are complete. Source-only handoff: version remains `5.9.0-nekodex.2`, no installer/release/version bump or installed-app replacement. Existing untracked branding inventories and dependency links were preserved. Backend checks use owned temporary fixtures/mocks; no real provider requests, login, tunnel restart, installer, or production mutation was used for verification. The existing full BrowserHost suite baseline described in `two-wave-20260921.md` was not rerun. Root runtime source is unchanged from the previously checked baseline. No full repository suite was run.
