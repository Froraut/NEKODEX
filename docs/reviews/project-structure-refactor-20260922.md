# Project-wide structure review and maintenance — September 22, 2026

Baseline: `e0fd612`, branch `codex/architecture-refactor-20260922`, PR #20.
The user requested a maintained architecture skill/document and another
structural refactoring pass across the entire project. This is a subsystem-level
structure and ownership review, not a claim of exhaustive line-by-line bug or
security verification. No additional agent wave or full test suite was run.

## Durable architecture maintenance

- Root `ARCHITECTURE.md` is the canonical entry point: 23 subsystem rows, process
  graph, six execution flows, state/persistence owners, verification and update
  rules. The existing `docs/architecture.md` remains the detailed runtime-mode
  companion; useful prior contracts were preserved.
- `docs/development/extending-nekodex.md` maps changes to the current module owner.
- `docs/development/module-map.json` records **415 source/infrastructure/assets
  paths and 1,338 static runtime dependency references** at this revision. Its
  declared roots exclude tests, historical docs, dependencies and generated
  output. Type-only/computed edges require human review.
- `scripts/architecture-map.ts` supplies `architecture:update` and
  `architecture:check`. Body-only edits do not churn the map; file/import changes
  do. The checker also rejects dead local architecture links. It uses Bun's
  built-in import scanner and needs no dependency installation.
- Root `AGENTS.md` requires updating architecture and the map with structural
  changes. CI checks map/link freshness once on Linux, without broadening the
  existing behavior-test selector or invoking release builds.
- The local `nekodex-architecture` skill preserves this workflow, resolves the
  active checkout, handles older branches without transplanting a newer map, and
  keeps evolving facts in the repository. Its metadata permits implicit use.
  Installation was validated locally and archived through skill-preservation;
  no background watcher, schedule or account operation was created.

## Coverage and disposition

| Project area | Review result / applied change |
| --- | --- |
| CLI, HTTP and service entry points | Reviewed composition, admission and request/stream boundaries. Existing server-policy/turn-lifecycle modules remain the owners; no additional registry or route rewrite was justified. |
| Responses JSON/SSE | Extracted `responses/json-output.ts` and common `output-policy.ts`. JSON construction no longer lives in the SSE lifecycle implementation; both retain the same wire conventions and facades. |
| Continuation state and Native ownership | Extracted pure `responses/continuation-scope.ts`; owner derivation no longer imports the disk-backed state store. Existing `state.ts` API remains available. |
| Native forwarding/network/telemetry | Reviewed request/body/route/outbox boundaries and the prior terminal inspector split. Kept these focused owners; no provider behavior or route policy change needed. |
| Model catalog and browser capacity | Extracted `browser-input-policy.ts` from the worker; canonical model/context/transport limits remain in `chatgpt-web-models.ts`. |
| Web adapter/session/broker | Reviewed registry, round delivery, client/protocol and retained-operation ownership. Kept the existing single execution owner and replay/acknowledgement contracts. |
| MCP/environment/tool authority | Reviewed routing and environment boundaries. Parsing remains separate from provenance; no grant, tunnel association or tool schema changes. |
| Prompts/multipart/attachments | Extracted `prompt-multipart-contract.ts` for stage/commit formatting and transaction types. Compiler and attachment validation remain separate; existing exports preserve callers. |
| Browser automation and host | Reviewed the prior DOM/Manual/artifact split. Input policy was the next independent worker boundary; page acquisition/submission/cancellation remains one lifecycle. |
| Compaction/checkpoints | Reviewed transaction/run/source/persistence boundaries, including Manual's different delivery policy. Retained existing owners; no extra state machine or checkpoint migration. |
| Configuration/setup/Codex integration | Reviewed policy vs side-effect order and original-read snapshot/write-receipt rules. Kept transaction composition intact; no configuration or live route edit. |
| Tunnel | Extracted `tunnel-status.ts`, separating inventory/readiness diagnostics from install/control. Existing public exports remain compatible. |
| Electron composition/IPC/profiles | Reviewed service composition, guarded registration and profile isolation. Kept the admission owner and account-scoped control boundaries. |
| Accounts/authentication/workspaces | Reviewed pool maps, exact leases, identity and selected-UI vs turn-owner separation. Existing account registry and flow controllers remain appropriate; no account mutation. |
| Runtime supervision | Shared `runtime-output.cjs` now decodes bounded log lines for RuntimeHost and RuntimeSupervisor. Extracted `runtime-tunnel-policy.cjs`; process ownership remains in the supervisor. |
| Update/release selection | Extracted pure `update-release-policy.cjs`; packaged repository/channel/platform rules remain separate from metadata verification, download, staging and install. |
| UI/navigation/localization | Extracted `Onboarding.tsx` and `ActivitySurface.tsx` with their local state/helpers. App retains shared snapshots/navigation. Existing language dictionaries remain central; no needless split of translation data. |
| Task Center/usage/async account UI | Reviewed feature hooks and projections; retained existing boundaries. Mounted Activity/usage evidence confirms the moved surface retains query/calendar/export behavior. |
| DEV harness | Extracted deterministic inert `context-fixtures.ts` from named session persistence; driver/transport ownership unchanged. |
| Build/scripts/CI/docs/assets | Added the drift check and current architecture entry points; corrected README source-development command. Reviewed owned output transactions and release separation; no packaging/install work. |

This pass deliberately retains cohesive lifecycle owners. Covering every
subsystem does not mean moving code that already has a useful independent owner.

## Behavioral defects corrected

The duplicated child-output readers decoded each Buffer independently. A UTF-8
character split across chunks became replacement characters. They also clipped
only an unterminated tail, allowing a huge newline-terminated line to bypass the
line bound. The shared StringDecoder-based reader preserves split characters,
clips both complete and fragmented oversized lines, discards excess until the
next newline, and keeps raw capture separate. No log privacy or child-process
authority was moved into the decoder.

## Focused evidence

- Core and renderer TypeScript checks passed; renderer (105 modules) and browser
  helper builds passed. Existing renderer bundle-size advisory remains.
- Six named JSON/SSE cases passed: normal/compaction success and failure parity,
  plaintext collaboration arguments, and non-message collaboration control.
- Four named continuation/prompt/DEV cases passed: persisted owner-bound replay,
  six-part context transport, independent named state/filler, deterministic
  bounded coherent context payloads.
- Six named supervisor/update cases passed: managed invocation, error/readiness
  diagnostics, fork-origin checks, release channel selection and platform assets.
- Two tunnel parser cases and two input-policy cases passed. The selected older
  input tests initially expected obsolete behavior: Pro reasoning above its
  500,000-character bound, Extra High visibility implying Pro capacity, Medium
  carrying 600,000 Pro characters, and accepting three multipart parts. Their
  expectations were corrected to current unchanged policy; only affected cases
  were rerun. Production limits were not loosened.
- Two runtime-output cases passed: byte-by-byte UTF-8 with identical raw capture,
  and bounded complete/fragmented lines with recovery at the next line.
- Two map-maintenance cases passed: move/import drift without body churn and
  missing documentation-link rejection. Actual generation initially exposed the
  import scanner's shebang limitation and one incorrect draft doc link; both
  were corrected before the map/link check passed.
- Three mounted renderer scenarios passed: onboarding Manual choice and finish
  with no social action; Activity log filtering/export; usage query identity,
  calendar and CSV. The Activity capture was inspected; IPC is synthetic.
- Changed Electron modules passed syntax checks. Actual source Electron uses the
  isolated fixture and exact renderer selection introduced in the prior pass;
  passed in about 1.2 seconds across five screens with real preload/snapshot IPC;
  PID 65216 exited and the temporary profile was removed. Its result is retained
  in ignored local evidence.

No full repository/package suite or live provider/account scenario was needed.
Unchanged passing checks from earlier passes were reused rather than repeated.

## Orchestration size changes

| File | Before | After |
| --- | ---: | ---: |
| `src/bridge.ts` | 1,101 | 797 |
| `src/responses/state.ts` | 428 | 344 |
| `src/tunnel.ts` | 777 | 672 |
| `browser-worker.ts` | 3,802 | 3,621 |
| `prompt.ts` | 907 | 804 |
| `src/dev-chat/session.ts` | 287 | 191 |
| `runtime-supervisor.cjs` | 2,883 | 2,772 |
| `update.cjs` | 707 | 602 |
| `launcher/src/App.tsx` | 1,490 | 1,234 |

Counts describe responsibility extraction, not measured speed or reduced total
source size. Version remains `5.9.0-nekodex.5`; source publication and local DEV
proof do not replace or release the installed application.
