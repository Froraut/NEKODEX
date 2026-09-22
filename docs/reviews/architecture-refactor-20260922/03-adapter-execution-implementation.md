# Lane 03 — adapter execution implementation

Implemented against the shared `codex/architecture-refactor-20260922` worktree, baseline `53d17361f3e9c81910055a7e2c18759ffce458bc`. Only the lane-owned files listed below were edited. No commit, push, application launch, live provider/account operation, installation, release, additional agent, or integrated build/typecheck was performed.

## Finding disposition

| Finding | Disposition and source evidence |
| --- | --- |
| F1 runtime factory | Implemented. Independently confirmed the nested factory and duplicated automatic worker lifecycle construction. `turn-runtime.ts` now owns construction, Manual control types/implementation, cancellation wrapper, and separate Manual/read-only/tools builders. `ChatGptTurnRuntimeContext` supplies typed worker, broker and checkpoint method subsets; the named request supplies input, trusted environment, identity, capabilities and hooks. Both ordinary execution and fresh compaction fallback in `index.ts` call the same factory. The namespace closure depends only on adapter configuration, not mutable adapter execution state. |
| F2 round delivery | Implemented. Independently confirmed duplicated live/settled successful answer validation, usage/completion, and tool delivery. `turn-round-delivery.ts` now journals complete event batches before observer calls and supplies one successful-answer implementation plus shared tool delivery. Usage estimation is an injected closure. |
| F3 feeds/session separation | Implemented. Independently confirmed feeds, session journal and registry coexistence. Moved feeds/runtime shapes to `turn-feeds.ts` and the intact session class to `turn-session.ts`. `turn-execution.ts` retains identity derivation and the ownership registry and re-exports the previous public classes/types. The session imports runtime types directly from feeds and retains its injected registry budget callback; it does not import the registry. |

No finding was rejected. These are cohesive refactors of confirmed source duplication and ownership boundaries; the review did not claim a new product defect and this implementation does not reclassify the refactors as bug fixes.

## Preserved contracts and deliberate boundaries

- Automatic lifecycle construction is lazy and invoked only by automatic builders; Manual mode does not acquire automatic-worker dependencies. Both automatic modes receive the same trace/text, submission and compaction progress callback construction.
- Token publication still follows successful compilation. Manual Sent acknowledgement, causal failure capture before self-induced revocation, and authoritative completion precedence over launcher cleanup failure remain in the Manual builder.
- `browser` and `physicalSettlement` remain distinct. Targeted cancellation can reject the former while the worker still owns the latter. Compaction fallback continues retaining physical ownership and arming deadlines in `index.ts`; no deadline logic was moved into delivery/runtime helpers.
- Ordinary submission poisoning and the compaction exception remain intact. Error classification still precedes retry accounting in the adapter.
- Broker revocation, browser/error racing, tool-boundary acknowledgement, replay prelude selection, and immediate retry cleanup remain adapter orchestration.
- Existing live completion records its final replay prelude before broker revocation (also on error); settled completion records it after validated buffered output. The delivery method explicitly preserves this difference instead of silently unifying policy ordering.
- Full-journal resource failures still bypass journal append for the failure frame. Replay terminal detection remains in the adapter. Session whole-batch reservation, serial observer tail, deferred capability retirement, and registry acknowledgement/retirement maps are unchanged.
- `ChatGptZeroRiskManualControl` remains importable from `index.ts`; feeds, runtime types and `ChatGptTurnSession` remain importable from `turn-execution.ts`. No caller migration is required for compaction/broker/server lanes. Concurrency, retry-policy, retry-continuation and turn-progress implementations were not edited.

## Focused verification

Used `right-size-test-runs`. Every Bun invocation below was run through Python `subprocess.run(..., timeout=30, check=True)` with Bun `--timeout 5000`. No default package suite, broad audit, build or typecheck was run. Selected existing tests were not edited.

1. `bun test tests/chatgpt-resource-budgets.test.ts tests/turn-broker-lifecycle.test.ts --test-name-pattern 'replay journal caps|final replay copies|registry byte cap|native interruption retires' --timeout 5000`
   - **4 passed**, 22 filtered out; 184 ms reported by Bun.
   - Atomic journal refusal/terminal poisoning, shared replay allowance, registry allowance release, exact native interruption.
2. `bun test tests/chatgpt-web-harness.test.ts tests/zero-risk-adapter.test.ts --test-name-pattern 'a client disconnect detaches|an observer failure in the middle|an ambiguous submission outcome|journal byte exhaustion|a Manual mode launcher failure remains' --timeout 5000`
   - **5 passed**, 93 filtered out; 297 ms.
   - Reconnect without duplicate browser submission, journalled batch recovery after observer failure, ambiguous-send stability, full-journal reconnect, Manual causal failure preservation.
   - Manual fixture logged missing temporary launcher descriptor during retained-release cleanup; the selected causal-failure assertion passed. No real Launcher was started.
3. `bun test tests/adapter-execution-refactor.test.ts --timeout 5000`
   - **5 passed** at that point, 161 ms; the two adapter timing cases were added afterward.
   - Successful structured buffering/usage/terminal journal; mismatch rejection; reached validator failure before any output; reached observer failure on event two with a complete canonical tool batch retained; automatic callbacks and cancellation/physical settlement in both modes.
4. `bun test tests/adapter-execution-refactor.test.ts --test-name-pattern 'adapter completion and reconnect agree' --timeout 5000`
   - Initial new fixture failed before worker admission because canonical native input lacked turn metadata. Fixed the fixture with `internal_chat_message_metadata_passthrough.turn_id`; this was not a production-source failure.
   - Corrected cases: **2 passed**, 445 ms. Strengthened the same cases with an explicit admission-boundary assertion and, for the settled case, an awaited session outcome; reran only those cases: **2 passed**, 5 filtered out, 384 ms.
   - Both initial delivery and exact reconnect contain the complete final answer and exactly one done event, with exactly one browser start. The fixture explicitly asserts settled versus pending state before observer admission. Early adapter failure is raced against worker startup so it cannot masquerade as a reached worker boundary.
5. `git diff --check -- src/adapters/chatgpt-web/index.ts src/adapters/chatgpt-web/turn-execution.ts`
   - Passed. Also reviewed the extracted implementations and integration diff for preserved lifecycle ordering.

Total unique behavioral cases: **16 passed** (9 existing, 7 new). No claim of full-suite, compiler, rendered UI, application or provider verification.

## Exact changed paths

- `src/adapters/chatgpt-web/index.ts`
- `src/adapters/chatgpt-web/turn-execution.ts`
- `src/adapters/chatgpt-web/turn-runtime.ts` (new)
- `src/adapters/chatgpt-web/turn-round-delivery.ts` (new)
- `src/adapters/chatgpt-web/turn-feeds.ts` (new)
- `src/adapters/chatgpt-web/turn-session.ts` (new)
- `tests/adapter-execution-refactor.test.ts` (new; lane-owned)
- `docs/reviews/architecture-refactor-20260922/03-adapter-execution-implementation.md` (this report)

## Integration constraints

Parent owns integrated core/renderer types, helper/renderer builds and rendered UI checks. Bun behavior checks do not establish TypeScript diagnostics. Other lanes may continue extracting broker/compaction modules; this lane uses their existing facades and requires no synchronized caller edits. Keep the compatibility re-exports when integrating. No source outside this exact write set was edited by lane 03.

## Integrated compiler follow-up — settled

Parent's integrated core TypeScript check identified a missed production reference: standalone structured compaction in `index.ts` still called the removed `emitBrowserCompletion`. The original focused tests had not exercised successful fresh compaction fallback, so their passing result did not cover this path.

Restored `emitBrowserCompletion` in `turn-round-delivery.ts` and imported it in `index.ts`. Both normal successful round delivery and standalone structured compaction now use its terminal framing. It preserves the original error-outcome throw and `{ type: "done", stopReason: "stop", endTurn: true, usage }` event. Standalone compaction still emits its canonical summary first, uses the same usage estimate, then clears retry state after successful completion delivery; it does not acquire a native-round journal or ordinary stream-equality validation.

Corrected the new test fixtures without casts: the tool request specifies `freeform: false`, and the read-only sandbox explicitly specifies `networkAccess: false`.

Focused follow-up command (Python subprocess wall timeout 30 seconds):

```sh
bun test tests/retained-compaction.test.ts tests/adapter-execution-refactor.test.ts --test-name-pattern 'structured compact rebuilds canonical context when its retained source is absent|successful delivery validates|tool delivery journals|automatic lifecycle shares' --timeout 5000
```

Result: **6 passed**, 40 filtered out, 64 assertions, 834 ms. The two existing retained-compaction cases each logged `fallback=source_unavailable_before_handoff`; they assert the worker is running compaction without retained-conversation requirements, inspect the prepared canonical context, assert one browser start, observe the canonical latest-user appendix, and require a final successful `done`. They therefore reach the previously missing helper, including Bigger Context disabled and enabled. The existing shared test file was not edited. The four selected lane-owned cases cover the shared successful terminal path and both corrected fixtures.

Follow-up changes are limited to `index.ts`, `turn-round-delivery.ts`, `tests/adapter-execution-refactor.test.ts`, and this report. No global types/build/suite rerun was performed. Compiler confirmation remains with the parent's integrated check.
