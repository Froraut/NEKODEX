# Lane 11 — Electron IPC implementation

Worktree: `/Users/alex/Dev/nekodex-refactor-20260922`.
Assigned branch: `codex/architecture-refactor-20260922`; review baseline: `53d17361f3e9c81910055a7e2c18759ffce458bc`.
Source implementation only. No commit, push, application launch, live provider/account use, installation, release, or additional agents. Other owners' files were not edited.

## Finding disposition

| Finding | Disposition | Independent validation and implementation |
| --- | --- | --- |
| F1 | Implemented | Browser/account groups were embedded in `registerIpc`. Extracted two explicit registrars accepting the already authorized/logged/lifecycle-guarded `handle`. Main retains authorization, lifecycle composition, dialogs, window access, proof adapters, and the independent window-control event path. The parent explicitly assigned this lane sole ownership of main.cjs. |
| F2 | Implemented | Descriptor validation, CDP ownership, and HTTP controls were coupled. Extracted descriptor, control, and shared error leaves. CDP acquisition/page selection stay in the host facade. The facade reexports the same public symbols and error constructors. The helper client now imports descriptor/control leaves directly. |
| F3 | Implemented with a source-grounded correction | The receiver's union/parser were local while the producer accepted unknown. The new protocol leaf exports the unchanged turn parser, `HelperTurnOutputMessage`, and producer-wide `HelperOutputMessage`. Producer writes now require that type. However, the original union did not cover existing maintenance `result.value` frames: `maintain()` emits inspect/smoke results, `browser-helper-verifier.cjs` forwards the envelope, and `browser-host.cjs` validates `result.value`. Added a narrow maintenance result union, keeping the turn parser's rejection of value-only results unchanged. No cast was added to make producers fit. |

No finding was rejected. Review statements were treated as maintainability findings, not newly reproduced runtime defects.

## Preserved contracts

- IPC channel names, argument order, return shapes and validation remain unchanged. Bounds retain sender zoom; close retains expected trace ID. Browser/runtime/account-service access uses getters. Dialog adapters retain current window/state and exact login-controller signal checks. Account refresh remains an admitted mutation. Proxy/login retain `assertAccountMutable`; failed account checks invalidate proof only if the checked account is still selected after the await.
- HTTP controls were moved without changing descriptor reread points, timeouts, retries, feature gates, request fields, receipt checks, queue acknowledgement, cancellation reconciliation, retained no-work evidence, or artifact ownership. Control imports descriptor/errors directly and does not import the host facade or Playwright. Existing facade imports remain compatible, including `instanceof` checks.
- Helper input parsing, feature negotiation, turn fences, pending/unresolved ownership and callbacks remain in their existing owners. Unknown output messages/events still fail closed.
- Lane07 requested payload import wiring in helper-main. The actual current source used a static `chatGptDocumentFilePayloads` import, rather than the mentioned dynamic prompt-payload import. Moved that existing symbol directly to `./attachment-payloads`; its exported signature was confirmed in lane07's new leaf. Worker-class imports remain unchanged.

## Focused verification

Read and applied `/Users/alex/.codex/skills/right-size-test-runs/SKILL.md`. No repository/package suite, typecheck, build, or UI run was started. Each invocation completed below 30 seconds; selected existing commands and the child-process fixture used Python `subprocess.run(..., timeout=30)` as the wall-clock bound.

| Exact command | Outcome |
| --- | --- |
| `node --test launcher/tests/domain-ipc-registrars.test.cjs` | 3 passed, about 41 ms. Uses real renderer guard, logged registration and lifecycle admission: unauthorized/closed refresh is blocked before service invocation; current host receives exact close owner and sender zoom; awaited failure preserves a newer selection's proof. The failure fixture explicitly asserts entry into checkAccount before injecting rejection. |
| `bun test tests/browser-helper-protocol.test.ts` | 3 passed, 29 ms. Valid zero-revision completion fence, malformed revision/unknown-event rejection, and maintenance producer shape versus strict turn decoder. |
| `bun test tests/launcher-browser-host.test.ts --test-name-pattern 'launcher descriptor rejects non-loopback browser ownership\|launcher turn control preserves a missing retained conversation as a typed signal\|manual launcher mutations reconcile one lost local response with the same turn owner'` | 3 passed; 21 filtered out; 150 ms. Existing facade callers and typed error identity work through the extracted leaves. |
| `bun test tests/browser-admission-protocol.test.ts --test-name-pattern 'aborting a waiting helper\|retained precheck propagates'` | 3 passed; 1 filtered out; 1192 ms. Durable not-sent cancellation and both retained precheck/no-work variants. |
| `bun test tests/browser-helper-protocol-cleanup.test.ts` | 1 passed, 70 ms. Real fixture child records that it reached run before emitting an unknown event. Public client.run rejects for the intended protocol failure, exact owner receives failed release, and the child stops. Temporary descriptor/helper files and loopback fixture server are removed/stopped in finally. |
| `node --check launcher/electron/main.cjs` | Passed. |
| `node --check launcher/electron/ipc/account-handlers.cjs` | Passed. |
| `node --check launcher/electron/ipc/browser-handlers.cjs` | Passed after correcting an extra closing parenthesis introduced during extraction. Initial syntax attempt caught this before behavioral checks; all reported passes use the corrected source. |
| `git diff --check -- launcher/electron/main.cjs src/launcher-browser-host.ts src/adapters/chatgpt-web/browser-helper-main.ts src/adapters/chatgpt-web/launcher-helper-client.ts` | Passed after trimming an extra trailing blank line in the host facade. |

Total: 13 focused behavioral cases passed. The review's proposed existing helper-client invalid-protocol cleanup case was not present in `tests/launcher-helper-client.test.ts`; the new public-client/fixture-child case supplies that evidence without rewriting another lane's tests. Existing selected fixtures were not edited or converted into source-string assertions.

In the commands above, `\|` represents the regex alternation character `|` (escaped for Markdown table rendering), not a literal backslash passed to Bun.

## Exact changed files

1. `launcher/electron/main.cjs`
2. `launcher/electron/ipc/browser-handlers.cjs` (new)
3. `launcher/electron/ipc/account-handlers.cjs` (new)
4. `launcher/tests/domain-ipc-registrars.test.cjs` (new)
5. `src/launcher-browser-host.ts`
6. `src/launcher-browser-descriptor.ts` (new)
7. `src/launcher-browser-control.ts` (new)
8. `src/launcher-browser-errors.ts` (new)
9. `src/adapters/chatgpt-web/launcher-helper-client.ts`
10. `src/adapters/chatgpt-web/browser-helper-main.ts`
11. `src/adapters/chatgpt-web/browser-helper-protocol.ts` (new)
12. `tests/browser-helper-protocol.test.ts` (new)
13. `tests/browser-helper-protocol-cleanup.test.ts` (new)
14. `docs/reviews/architecture-refactor-20260922/11-electron-ipc-implementation.md` (this report)

## Integration constraints

- Parent owns integrated core/renderer type checks, helper/renderer build and rendered UI checks. Producer literals are now compiler-constrained, but this lane does not claim an integrated typecheck passed.
- Include lane07's `src/adapters/chatgpt-web/attachment-payloads.ts` in the integrated change. Its `chatGptDocumentFilePayloads` export was present when the helper import was wired.
- Keep the new Electron `ipc/` directory and TypeScript leaves with their owners when integrating. No preload, renderer API, control-server, browser-worker, application menu, external-links, shared fixture, or i18n file was edited by this lane.
- Existing tests that inspect moved source text may require parent triage; none were mechanically rewritten to match the extraction. The focused behavioral evidence above is the lane's acceptance evidence.
