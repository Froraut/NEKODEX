# NEKODEX architecture and UI refactoring — 2026-09-22

User requested one wave of 16 Astra reviewers followed by one wave of 16 Astra implementation agents. Overall refactoring, extensibility, codebase improvements, UI adjustments and confirmed bug fixes are all in scope.

Baseline: `53d17361f3e9c81910055a7e2c18759ffce458bc` (latest completed app-improvements branch, verified on origin). Worktree: `/Users/alex/Dev/nekodex-refactor-20260922`. Branch: `codex/architecture-refactor-20260922`. Existing version: `5.9.0-nekodex.5`.

## Workflow

All review reports must finish before implementation starts. Parent consolidates findings and assigns one writer per coupled file. No source changes in wave 1. Implementation wave revalidates proposals before editing and records rejected or superseded findings explicitly. No speculative frameworks or weakening of ownership, authority, cancellation, rollback, timeout or permission contracts.

## Coverage

| Lane | Primary area |
| --- | --- |
| 01-http-server | HTTP server and service boundaries |
| 02-responses | Responses parsing and durable conversation state |
| 03-adapter-execution | ChatGPT adapter and turn execution |
| 04-turn-broker | Turn broker, delegation, environment authority |
| 05-browser-worker | Browser worker/model selection |
| 06-mcp-tools | MCP transport, tools, environment |
| 07-files-prompts | Files, artifacts and prompt construction |
| 08-compaction | Compaction/checkpoint lifecycle |
| 09-native | Native forwarding, routing and usage outbox |
| 10-setup-config | Configuration, setup and integration |
| 11-electron-ipc | Electron main/preload/control interfaces |
| 12-accounts-auth | Accounts, login and identity lifecycle |
| 13-browser-state | Browser host, queues, task ledger and workspaces |
| 14-runtime-updates | Runtime supervision, update recovery and storage |
| 15-app-accounts-ui | App shell, account settings and onboarding renderer |
| 16-feature-ui | Task, queue, workspaces, usage and update renderer |

## Verification ownership

One global coverage plan: lane owners run only focused behavioral checks for their changed contracts, with short timeouts; parent owns integrated TypeScript checks, renderer/helper development builds where affected, and a systematic isolated UI pass covering changed connected flows. No full repository/package suite, production account/provider operations, updater/install/release, or duplicated verification. Prior results are reused for unchanged behavior. Shared wiring and test fixtures are parent-owned unless explicitly handed off.

Implementation and findings disposition will be recorded after the review barrier.


## Review barrier and implementation acceptance

All 16 review agents completed and were closed before dispatching 16 new Astra medium implementation agents. The 46 report findings are accepted for implementation subject to independent source revalidation; any evidence-based rejection must be recorded. Existing public facades remain compatible to isolate writers.

Shared ownership: lane 05 alone edits browser-worker; lane 07 supplies attachment contracts; lane 11 alone edits main and helper producer/client; lane 10 owns Pro/compaction settings snapshot guards; lane 13 alone owns browser-host; lane 12 alone owns account-pool; lane 15 owns App/accounts UI; parent owns i18n and integrated fixture verification.

## Findings ledger

All 46 proposals have implementation evidence in the lane reports. The parent integration checks are recorded below when settled.

| Finding | Implemented change | Evidence |
| --- | --- | --- |
| 01-http-server-F1 | Rebuilt Web compaction body retains compressed-wire headers | [01-http-server implementation](architecture-refactor-20260922/01-http-server-implementation.md) |
| 01-http-server-F2 | Resume can reopen admission after shutdown has started | [01-http-server implementation](architecture-refactor-20260922/01-http-server-implementation.md) |
| 01-http-server-F3 | Extract transport ownership and explicit endpoint policy from the composition root | [01-http-server implementation](architecture-refactor-20260922/01-http-server-implementation.md) |
| 02-responses-F1 | Separate bounded snapshot encoding from live continuation ownership; persist rejection-only mutations | [02-responses implementation](architecture-refactor-20260922/02-responses-implementation.md) |
| 02-responses-F2 | Extract one tool projection contract and apply availability policy to discovery announcements | [02-responses implementation](architecture-refactor-20260922/02-responses-implementation.md) |
| 03-adapter-execution-F1 | Extract the runtime factory with explicit mode-specific ownership | [03-adapter-execution implementation](architecture-refactor-20260922/03-adapter-execution-implementation.md) |
| 03-adapter-execution-F2 | Give native-round delivery one journal-first contract and one successful-finalization path | [03-adapter-execution implementation](architecture-refactor-20260922/03-adapter-execution-implementation.md) |
| 03-adapter-execution-F3 | Separate session/replay state and feeds from the ownership registry | [03-adapter-execution implementation](architecture-refactor-20260922/03-adapter-execution-implementation.md) |
| 04-turn-broker-F1 | separate the broker protocol/client from turn state | [04-turn-broker implementation](architecture-refactor-20260922/04-turn-broker-implementation.md) |
| 04-turn-broker-F2 | encapsulate owned-operation retention and acknowledgement | [04-turn-broker implementation](architecture-refactor-20260922/04-turn-broker-implementation.md) |
| 04-turn-broker-F3 | separate authority resolution from environment persistence | [04-turn-broker implementation](architecture-refactor-20260922/04-turn-broker-implementation.md) |
| 05-browser-worker-F1 | Extract the model-selection transaction and its pre-send proof | [05-browser-worker implementation](architecture-refactor-20260922/05-browser-worker-implementation.md) |
| 05-browser-worker-F2 | Unify response-health suspension and fix stale terminal timers | [05-browser-worker implementation](architecture-refactor-20260922/05-browser-worker-implementation.md) |
| 06-mcp-tools-F1 | Extract tool routing and native registrations from transport lifecycle | [06-mcp-tools implementation](architecture-refactor-20260922/06-mcp-tools-implementation.md) |
| 06-mcp-tools-F2 | Separate environment syntax from provenance, fixing encoded cwd selection | [06-mcp-tools implementation](architecture-refactor-20260922/06-mcp-tools-implementation.md) |
| 07-files-prompts-F1 | one prepared-attachment contract for both transports | [07-files-prompts implementation](architecture-refactor-20260922/07-files-prompts-implementation.md) |
| 07-files-prompts-F2 | enforce the file byte bound before decoding | [07-files-prompts implementation](architecture-refactor-20260922/07-files-prompts-implementation.md) |
| 07-files-prompts-F3 | portable filename policy must agree with the Electron guard | [07-files-prompts implementation](architecture-refactor-20260922/07-files-prompts-implementation.md) |
| 07-files-prompts-F4 | separate artifact format policy and verified storage from acquisition | [07-files-prompts implementation](architecture-refactor-20260922/07-files-prompts-implementation.md) |
| 08-compaction-F1 | Extract a compaction-specific run registry with one cancellation transition | [08-compaction implementation](architecture-refactor-20260922/08-compaction-implementation.md) |
| 08-compaction-F2 | Share active-source settlement mechanics, keep delivery policies explicit | [08-compaction implementation](architecture-refactor-20260922/08-compaction-implementation.md) |
| 08-compaction-F3 | Separate rolling-checkpoint responsibilities and publish cache only after persistence | [08-compaction implementation](architecture-refactor-20260922/08-compaction-implementation.md) |
| 09-native-F1 | Separate request preparation, byte-stream handling and usage observation | [09-native implementation](architecture-refactor-20260922/09-native-implementation.md) |
| 09-native-F2 | Cancel a caller's cold-route wait without canceling shared resolution | [09-native implementation](architecture-refactor-20260922/09-native-implementation.md) |
| 09-native-F3 | Give runtime usage receipts a standalone contract module | [09-native implementation](architecture-refactor-20260922/09-native-implementation.md) |
| 10-setup-config-F1 | P1: bind configuration reads to their original file snapshot | [10-setup-config implementation](architecture-refactor-20260922/10-setup-config-implementation.md) |
| 10-setup-config-F2 | extract the filesystem receipt layer from configuration and route policy | [10-setup-config implementation](architecture-refactor-20260922/10-setup-config-implementation.md) |
| 10-setup-config-F3 | extract a pure setup transition policy with explicit loading contexts | [10-setup-config implementation](architecture-refactor-20260922/10-setup-config-implementation.md) |
| 11-electron-ipc-F1 | Extract guarded browser/account IPC registration from application composition | [11-electron-ipc implementation](architecture-refactor-20260922/11-electron-ipc-implementation.md) |
| 11-electron-ipc-F2 | Separate descriptor/CDP authority from control operations behind the existing facade | [11-electron-ipc implementation](architecture-refactor-20260922/11-electron-ipc-implementation.md) |
| 11-electron-ipc-F3 | Make helper output a shared typed wire contract | [11-electron-ipc implementation](architecture-refactor-20260922/11-electron-ipc-implementation.md) |
| 12-accounts-auth-F1 | bind verification to the inspected storage snapshot | [12-accounts-auth implementation](architecture-refactor-20260922/12-accounts-auth-implementation.md) |
| 12-accounts-auth-F2 | extract the account operation lease registry | [12-accounts-auth implementation](architecture-refactor-20260922/12-accounts-auth-implementation.md) |
| 12-accounts-auth-F3 | fail closed when the owned Codex child does not stop | [12-accounts-auth implementation](architecture-refactor-20260922/12-accounts-auth-implementation.md) |
| 13-browser-state-F1 | Extract one browser turn lifecycle owner (maintainability, worthwhile now) | [13-browser-state implementation](architecture-refactor-20260922/13-browser-state-implementation.md) |
| 13-browser-state-F2 | Live workspace close loses durable-deletion retry target (confirmed source defect, P2) | [13-browser-state implementation](architecture-refactor-20260922/13-browser-state-implementation.md) |
| 14-runtime-updates-F1 | Extract the runtime configuration contract from supervision | [14-runtime-updates implementation](architecture-refactor-20260922/14-runtime-updates-implementation.md) |
| 14-runtime-updates-F2 | Separate authenticated preparation from update control and handoff | [14-runtime-updates implementation](architecture-refactor-20260922/14-runtime-updates-implementation.md) |
| 14-runtime-updates-F3 | Make cache and staged-asset hashing cancellable | [14-runtime-updates implementation](architecture-refactor-20260922/14-runtime-updates-implementation.md) |
| 15-app-accounts-ui-F1 | Extract connection/settings feature boundaries from App | [15-app-accounts-ui implementation](architecture-refactor-20260922/15-app-accounts-ui-implementation.md) |
| 15-app-accounts-ui-F2 | Account snapshot and login controllers with explicit ownership | [15-app-accounts-ui implementation](architecture-refactor-20260922/15-app-accounts-ui-implementation.md) |
| 15-app-accounts-ui-F3 | Safety draft reconciliation and local restore | [15-app-accounts-ui implementation](architecture-refactor-20260922/15-app-accounts-ui-implementation.md) |
| 16-feature-ui-F1 | Separate usage query lifecycle from report rendering | [16-feature-ui implementation](architecture-refactor-20260922/16-feature-ui-implementation.md) |
| 16-feature-ui-F2 | Scope workspace errors to their account; reuse a bounded action gate | [16-feature-ui implementation](architecture-refactor-20260922/16-feature-ui-implementation.md) |
| 16-feature-ui-F3 | Give Task Center one typed confirmation/presentation model | [16-feature-ui implementation](architecture-refactor-20260922/16-feature-ui-implementation.md) |
| 16-feature-ui-F4 | Extract pure report projection from the durable usage store | [16-feature-ui implementation](architecture-refactor-20260922/16-feature-ui-implementation.md) |

## Extension guide

[Extending NEKODEX](../development/extending-nekodex.md) maps feature changes to their module owners, compatibility boundaries and verification approach.

## Integrated verification and completion

All 16 implementation agents completed their assigned findings and focused follow-ups, then were closed. All 46 findings are implemented; conditional sub-details were adapted where preserving the existing contract required it (see lane reports). No additional agent wave was started.

- Core `bun run typecheck` passed after resolving three extraction omissions (browser progress liveness, fresh-compaction completion delivery, retained broker socket probe) and test fixture type mismatches. Each affected runtime branch received targeted follow-up evidence.
- Renderer `bun run typecheck` passed. `bun run build:renderer` passed, 101 modules; JS `index-4ql37qmf.js`, CSS `index-BzWYyHSU.css`. The existing >500 kB bundle advisory remains; no unmeasured performance claim is made.
- `bun run scripts/build-browser-helper.ts` passed. Syntax checks passed for all 18 changed Electron CJS modules.
- Nine mounted-renderer scenario groups passed: new safety restore/dirty draft, workspace account-scoped errors including late failure, usage query identity/calendar/CSV; existing Settings removal, eight-section navigation plus compact Russian tasks, keyboard task confirmation/queue scope, capacity/Doctor state, task filters/protected dismissal/history health, workspace restoration/tools-readiness handoff. Screenshots at 760px and 1280px were inspected; no page errors or horizontal overflow were observed in these checks. IPC is synthetic in these fixtures.
- Actual source Electron passed with temporary isolated DEV home, real preload/snapshot IPC, version `5.9.0-nekodex.5`, manual mode, and Overview, Accounts, Task center, Connections, Settings. Configuration remained absent; no provider/account setup was performed. Successful PID 25173 exited and its temporary profile was removed.
- The first Electron proof reached the screen capture but its cleanup assertion queried Playwright's application handle after close; the fixture now retains the child handle before closing and records evidence in a nested finally. One later startup attempt timed out on the app shell at four seconds without sufficient failure capture; an instrumented follow-up passed in about one second. This does not establish a product defect or broad startup reliability. Diagnostic capture remains in the fixture. No timeout was increased.
- Installed `/Applications/NEKODEX.app` stayed PID 26812, started September 21. No task-owned DEV process or temporary profile remains. Current ignored renderer/helper outputs and concise evidence are retained in this source worktree.

Focused existing fixtures were migrated only where assigned for the changed module boundaries. Known unrelated source-layout assertions elsewhere were not broadly rewritten or executed. No full repository/package suite, cross-OS runtime run, installer, signed release, actual updater transaction or live provider flow is claimed. Individual lane reports give exact behavioral commands, reached failure boundaries, and limits; counts should not be summed as a deduplicated suite.

## Delivery

Branch: `codex/architecture-refactor-20260922`, based on latest completed `codex/app-improvements-20260922` revision `53d1736`. Version remains `5.9.0-nekodex.5`. This is a source/development refactor; installed app and release assets are separate. The canonical `/Users/alex/Dev/nekodex` checkout and its unrelated branding inventory are preserved.
