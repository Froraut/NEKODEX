# Lane 02 — Responses parsing and durable continuation

Baseline inspected: `53d17361f3e9c81910055a7e2c18759ffce458bc` in `/Users/alex/Dev/nekodex-refactor-20260922`. Read-only source review; **no tests or builds run**, no applications/providers/accounts used, no agents spawned. Only this report was written. Findings below are source-grounded, not runtime reproductions.

Reviewed all seven `src/responses/*` modules, the Web and native continuation callers, downstream tool validation/prompt projection, and relevant existing tests. Checked the Responses/Requests and Compaction sections of `app-improvements-20260922.md`, `app-improvements-wave3-20260922.md`, and `app-improvements-waves4-5-20260922.md`. Known-function fallback validation, deferred function validation, wire-name flattening, checkpoint coverage, and pending-SSE cancellation are completed work or reserved scope, not new findings here.

## 02-responses-F1 — Separate bounded snapshot encoding from live continuation ownership; persist rejection-only mutations

**Priority:** medium; coherent maintainability improvement with a concrete persistence defect.

**Evidence / exact locations:**

- `src/responses/state.ts:22–72,150–220` owns continuation scope types, owner hashing, validation and comparison; `239–338` owns two disk-format readers; `385–482` owns budgeted graph serialization and filesystem writes; `508–582,632–700` owns live eviction, lookup and retention. A new retention rule currently requires reasoning about all these responsibilities in one 700-line module.
- Snapshot size policy is implemented twice: actual graph selection/serialization at `398–455` and individual-chain eligibility estimation at `599–625`. Both construct node skeletons and account for JSON array separators/root entries. Changes to persisted metadata must update both paths consistently.
- Rejection-only branches at `669–676` add a rejection but return before `schedulePersist()` at `693`. The post-prune capacity return at `689–691` does the same. In contrast, ownership rejection at `655–660` explicitly schedules persistence. `flushResponseState()` at `494–499` does nothing without an already pending timer.

**Trigger / consequence:** after a prior snapshot has flushed, a completed response whose retained history exceeds the memory limit records `not-retained-too-large` in memory but schedules no disk write. With no later successful retention, even graceful shutdown cannot flush that reason. After restart, that response ID becomes generic `unavailable`, losing the deliberately specific rejection classification. This is not a claim that disk writes are guaranteed: the documented cache remains best effort.

**Caller check:** `src/server.ts:613–620` calls retention for completed Web responses; `1461` flushes at shutdown. Web lookup explains specific reasons at `580–599`. `src/native-passthrough.ts:584–595` distinguishes known local rejection reasons from generic unavailable IDs: specific local failures stop before forwarding, while unknown IDs may belong upstream. Losing the rejection therefore changes routing behavior after restart, although it does not prove successful upstream execution or data disclosure.

**Concrete change:** extract a pure `state-snapshot.ts` module owning persisted node/root/rejection shapes, v1/v2 decoding, bounded v2 encoding, and shared node/root byte accounting. Pass explicit time/budget inputs where needed for small deterministic fixtures. Keep the map, TTL/eviction, exact-object replay WeakMaps, debounce/path capture, filesystem wrapper, public exports, and completion eligibility in `state.ts`. Keep ownership semantics unchanged; scope comparison can remain in the live module initially rather than adding a second broad migration. Introduce one live-state mutation scheduling path so accepted rejection-only mutations also dirty the snapshot. Do not schedule reads or rejected malformed IDs as writes, and do not change `eligible` into a promise of durable storage.

**Benefit:** adding snapshot metadata or another format has one bounded codec seam; request retention no longer needs to implement disk graph mechanics. The focused bug fix preserves already-defined failure reasons across the existing best-effort persistence path.

**Write set:** `src/responses/state.ts`, new `src/responses/state-snapshot.ts`, new `tests/responses-state-snapshot-contract.test.ts`. No caller edits required. One implementation owner handles this entire coupled change. Native/server owners may inspect the behavior but must not independently rewrite retention policy.

**Smallest meaningful verification proposed:** one offline targeted file, maximum **30 seconds total**, with (1) a tiny chained round trip plus wrong-owner lookup and exact replay-prefix control, (2) v1 compatibility and malformed-parent/depth rejection, and (3) rejection-only dirty/flush/reload behavior after an earlier flush, using small injected codec budgets or a deliberately unserializable in-process payload where appropriate. Assert the specific rejection survives reload, not merely that a file exists. Include snapshot byte-bound selection in that tiny graph fixture. Reuse existing owner checks; avoid an all-history corpus. The old `tests/coding-iterations-focused.test.ts:49–51` expects v1 `states` despite current v2 output, so do not use that stale assertion as proof or broaden this lane into test-suite cleanup.

## 02-responses-F2 — Extract one tool projection contract and apply availability policy to discovery announcements

**Priority:** medium; extension-seam improvement with a confirmed contradictory model instruction.

**Evidence / exact locations:**

- `src/responses/parser.ts:109–135,162–258` implements tool choice, namespace normalization, known-function validation, custom wrapping, hosted exclusions, discovery tools and open named extensions inside the history parser.
- Three ingress paths feed these rules: top-level tools (`632`), `additional_tools` (`369–378`), and deferred search output (`582–601`). Search output calls `buildTools` to produce its announcement (`591`); final tools are separately rebuilt and filtered at `632–643`.
- With `model: "chatgpt-web/medium"`, `allowWebSubagents: false`, and a `tool_search_output` containing `{type:"function",name:"spawn_agent"}`, line `598` announces that `spawn_agent` is available and instructs the model to call it. Line `638` subsequently removes it from `context.tools`. `src/collaboration-tools.ts:3–11,38–44` confirms that this exact name is blocked.
- `src/server.ts:546–548` actually passes this setting. `src/adapters/chatgpt-web/prompt.ts:409–423` carries tool-result content into the prompt, while `src/adapters/chatgpt-web/index.ts:361–366` rejects requested names absent from the final tool list. Thus the model receives conflicting instructions and can reach a predictable unavailable-tool error; this does not bypass the enforcement boundary.

**Concrete change:** create `tool-projection.ts` with explicit projection, availability filtering, stable wire-name deduplication, and choice normalization functions. Keep message ordering, pending reasoning, file authority and replay-prefix handling in `parser.ts`. Project each declaration source through the same contract; discovery announcements must derive from policy-eligible projected tools. Preserve declared-before-loaded precedence, discovery result status, the distinction between genuinely unknown extensions and malformed known functions, default-namespace custom support, and existing hosted exclusions. A blocked-only discovery result should not claim callable tools. Do not invent a plugin registry or change collaboration authorization.

**Benefit:** adding a supported tool shape has a clear owner instead of modifying a mixed history parser; discovery text and active tool capabilities cannot diverge merely because filtering occurs later. This extends the already-completed wire-name correction rather than rediscovering it.

**Write set:** `src/responses/parser.ts`, new `src/responses/tool-projection.ts`, `tests/responses-loaded-tool-validation.test.ts`. Keep `schema.ts`'s established function validation contract and reuse its export. This set is disjoint from F1; nevertheless the lane's implementation agent can own both. No edits to Web prompt, adapter, collaboration policy, server or bridge. Those are read-only consumer evidence/cross-lane wiring points.

**Smallest meaningful verification proposed:** the existing focused loaded-tool validation file plus one blocked/allowed discovery regression, maximum **15 seconds total**. Assert blocked collaboration names occur in neither active tools nor positive discovery announcements; an unrelated namespaced tool remains available; enabled collaboration remains advertised. Existing cases cover nested invalid functions, freeform/default namespace behavior and exact wire names. No provider calls or UI checks are needed for this pure parser seam.

## Ownership and handoff

Recommend both bounded changes for the implementation wave, with one lane-02 owner and the disjoint file sets above. Preserve existing public parser/state APIs so other lanes need no migration. Parent owns acceptance, integration, aggregate verification/build/UI planning, Git and publication. No new finding is proposed for file resolution or compaction: keep the explicit authorized resolver, strict file bytes/MIME checks, and current compaction framing intact. Read and applied `right-size-test-runs` when proposing the focused verification above; all verification here remains a proposal, not an executed result.
