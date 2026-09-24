# Lane 06 implementation — MCP routing and environment syntax

Baseline: `53d17361f3e9c81910055a7e2c18759ffce458bc`; branch verified as `codex/architecture-refactor-20260922`. Shared worktree changes from other lanes were preserved. Source-only work: no commit/push, app launch, live account/provider access, tunnel changes, installation/release, or spawned agents.

## Finding disposition

- **06-mcp-tools-F1 — implemented.** Independently confirmed that routing, generated gateway programs, and convenience registrations shared the transport-lifecycle closure. Extracted pure routing/projection into `mcp-tool-routing.ts` and explicit convenience registrations into `mcp-native-tools.ts`. Correction to review wording: the identified convenience block contains **five** registrations (`codex_exec`, `codex_write_stdin`, `codex_apply_patch`, `codex_view_image`, `codex_read_thread`), not six. All five moved. `codex_turn_start` remains a transport/broker lifecycle operation in the composition root.
- **06-mcp-tools-F2 — implemented.** Independently confirmed legacy candidate paths were compared while XML-encoded, before later decoding. New envelope syntax module decodes/trims at XML extraction boundaries before candidate comparison. Normalization consumes decoded paths without decoding them again. Metadata workspace keys remain literal filesystem paths. Added real request-envelope regressions for `A&B`, literal `A&amp;B`, and literal `A&quot;B`; the last control also covers recursive decoding caused by the former chained replacements.

## Architecture and invariants

- Immutable routing policy (`contract`, `allowWebSubagents`), with the current claimed environment passed for every resolution. Synchronous and owned dispatch use the same exported resolver; no authority cache, binding acquisition, or execution in routing.
- Direct visibility now owns its spawn filter. Gateway exclusions have one constructor shared by inventory, nested convenience calls, and invocation resolution. Static bridge deny names retain inactive-mode names; not derived from registrations.
- Native registrations receive typed claim/invoke capabilities. Direct-command selection, nested-command candidate selection, fail-closed approval schema checks, freeform rules, stdin yield cap, and read-thread semantics remain intact.
- Server retains broker activity settlement, timeout/release, compaction handoff, discovery orchestration, and owned-operation lifecycle. Previous exported helpers/constants/types remain available through `mcp-server.ts` re-exports.
- `environment-envelope.ts` owns sandbox syntax, decoded cwd/root selection, path normalization, the missing-context error constructor, and sandbox policy type. It has no dependency on turn provenance. `environment.ts` keeps provenance, metadata binding, replay/current-update precedence, claims, visualization exception, and final tool association.
- Metadata corroboration and final construction use the same cwd/root/sandbox interpretation. Missing versus explicitly invalid context errors remain distinct; the facade re-exports the exact error constructor.
- Lane04 was notified via agent message of the compatibility facade and decoded-path contract. `thread-environment.ts` was not edited. The syntax exports themselves confer no authority.

## Focused verification

All invocations completed below 30 seconds. Except the first short gateway invocation (107 ms), test commands were executed with Python `subprocess.run([...], timeout=30, check=True)` around the exact commands below. No full package/repository tests, typecheck, build, or UI run.

| Exact test command | Outcome |
| --- | --- |
| `bun test tests/four-wave-gateway.test.ts` | 1 passed; 3 assertions; 107 ms. Generated command program preserves nested errors and refuses unsupported shell options. |
| `bun test tests/security-fixes-mcp.test.ts` | 3 passed; 39 assertions; 892 ms. Raw wrapper refusal before sync/owned dispatch, permitted structured nested commands, explicitly enabled raw delegation. |
| `bun test tests/lane06-environment-envelope.test.ts tests/environment.test.ts --test-name-pattern 'lane06\|rejects a legacy multi-environment envelope\|does not hide malformed cwd markup\|uses the primary cwd\|rejects an unprovenanced developer gap'` | 8 passed; 52 filtered out; 11 assertions; 23 ms. Three encoded-path controls, error constructor distinction, four existing provenance/selection refusals and controls. The displayed escaped pipes are Markdown table escaping; the subprocess argument used ordinary regex alternation. |
| `bun test tests/zero-risk-mcp-lifecycle.test.ts --test-name-pattern 'exposes start and completion while hiding the bridge namespace'` | 1 passed; 5 filtered out; 41 assertions; 377 ms. Existing stdio ABI, hidden bridge namespace, safe lifecycle and callable tools. |
| `bun test tests/lane06-mcp-routing.test.ts` | 2 passed; 12 assertions; 10 ms. Inactive bridge-name protection/current-environment exclusions and shared direct/nested wait policy, including schema immutability. |
| `bun test tests/chatgpt-web-harness.test.ts --test-name-pattern 'Codex Native4 forwards supported approval arguments and rejects an unsupported native schema'` | 1 passed; 86 filtered out; 6 assertions; 554 ms. Actual synthetic broker delivery confirms supported approval arguments; unsupported schema explicitly rejected. |

Total: 16 selected behavioral cases passed. No new injected operational failure fixture was introduced; existing gateway error fixture and stdio broker tests establish callable/error behavior. `git diff --check -- src/adapters/chatgpt-web/environment.ts src/adapters/chatgpt-web/mcp-server.ts` passed. Final edits after the behavior checks only moved the sandbox type declaration to its syntax owner, removed an unused import/internal exports, and formatted imports; no runtime behavior changed.

## Exact lane-owned changed paths

1. `src/adapters/chatgpt-web/mcp-server.ts`
2. `src/adapters/chatgpt-web/mcp-tool-routing.ts` (new)
3. `src/adapters/chatgpt-web/mcp-native-tools.ts` (new)
4. `src/adapters/chatgpt-web/environment.ts`
5. `src/adapters/chatgpt-web/environment-envelope.ts` (new)
6. `tests/lane06-environment-envelope.test.ts` (new; shared tests untouched)
7. `tests/lane06-mcp-routing.test.ts` (new)
8. `docs/reviews/architecture-refactor-20260922/06-mcp-tools-implementation.md` (this report)

## Integration constraints

Parent owns integrated types/build/UI checks. No package/build or installed-app claim follows from these tests. Lane04 can keep existing imports unchanged or consume pure syntax through the facade; it must not decode selected paths again or promote syntax parsing into authority. No caller synchronization or tunnel changes are required. Known review discrepancy is only the convenience-registration count described above.
