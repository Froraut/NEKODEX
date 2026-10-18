# Owned Native Agent integration — 18 October 2026

This source batch connects the existing Bun Agent task owner to a main-owned
Native inference path, fresh-profile official CLI login, qualified own-profile
inventory and an account-server execution pool. Source/development identity is
`6.1.32-nekodex.9`; the installed app remains `.8`, with its separately completed
[D01 migration](2026-10-18-d01-implementation.md). The last published baseline is
`d5da164` with four successful CI jobs; current source changes have not acquired
that publication/CI status. Draft PR #98 remains stacked on the D01 branch.

No real Native account, model inventory or inference has been verified. The actual
Russian DEV UI prepared a fresh epoch, initiated official CLI `login --device-auth`,
displayed its transient code and opened the fixed official device page. The
existing-account browser flow reached passkey verification; the human step was not
completed and the CLI later ended unsuccessfully. No saved authentication is
claimed. The exact GUI then exited gracefully with its helpers settled; the
separate task-owned core remains idle. The private profile/journals are retained.
Another login requires a fresh explicit epoch, without copying existing auth.

## Authority and implemented source

- `local-responses` and `owned-native` remain explicit saved execution choices.
  Bun retains the task runtime, runner, store and ToolJournal. It commits the full
  exact envelope digest before one private HTTP offer; main validates that claim
  before startup and before inference. Incoming hashes cannot install claims.
- Main's private descriptor/bearer/instance checks precede Native dispatch and
  BrowserHost lookup. Early prepared receipts release HTTP observation while the
  same physical operation continues. Passive receipt/event reads never send
  again. Held unknown/lost ACK retains correlation and prevents replay.
- `native-account-authority.cjs` owns explicit fresh physical epochs, official
  device login, create-before-spawn intent, ephemeral code projection and exact
  process-group cancellation/close. Parent only observes auth stat metadata;
  it never reads, copies, hashes or exports credential contents. A shared opaque
  profile lease and journaled expected-config-hash publication protect later owners.
- `native-account-inventory.cjs` performs a network/fork-denied native-library
  exact personal-Pro classifier, then two sequential metadata-only app-server
  generations: static official bootstrap/policy/account/usage, followed by own
  online model listing/account/usage. Each process closes before the next boundary;
  cache is read only after online closure. Only six fixed metadata RPCs exist,
  with no threads, turns or login RPC. Qualified native active-account identity,
  backend account ID, `ordinaryUsageAllowed:true`, fresh full original ModelInfo
  and cache provenance are required. Auth refresh is reconciled only inside the
  exact owned native lifetime, followed by closure and offline classification;
  outside changes remain unknown. Historical receipts do not reconstruct trust.
- `native-account-admission.cjs` consumes that current original catalog and exact
  auth/config/executable/cache pins. It preserves original model names/instructions
  and seals an explicit tool-disabled execution projection; it does not invent
  model metadata. A new generation requires cache provenance within 300 seconds,
  and effective policy/account/usage are checked again at execution boundaries.
- `native-account-execution.cjs` resolves qualified model/admission pairs into
  one account process/AuthManager/sender, generation SQLite and separate binding
  journals. Its pool supports two new ephemeral threads across distinct tasks.
  Unsubscribe ACK is not thread closure: retirement awaits the exact closed event
  or physical account-process close. Unknown outcomes retain owners, without
  replay or killing neighbouring threads. Whole-app cleanup closes the account
  process before facades and auth storage. An idle execution lease is not active
  inference. The existing metadata/fork client gains no turn authority.
- Main/IPC/renderer are wired: explicit Inspect models runs inventory, then selects
  at most the first two nonhidden actual picker rows for admission, without
  inference. Descriptor rows come only from the live execution owner; there are
  currently no actual admitted rows. This qualified-account path is separate from
  the unchanged fixture `official-openai` refusal, which still reports
  `official_policy_preflight_unverified`.
- The fixed `neko-agent-result-v1` schema expresses NEKODEX `tool_request` or
  `final` assistant text. Native tools stay empty; Bun validates announced arguments
  and alone approves, executes, journals and reconciles effects. Continuation
  binds the completed Native turn/task generation/worker. Current Native input
  remains text only and each task permits one worker, even though the account
  pool can serve two separate tasks. Max-turns counts Native offers; monetary
  cost stays unknown.
- Scope revocation fences older task-family generations. Exact core admission is
  independent of Web tunnel health and remains valid during drain. Native cleanup
  must settle before Bun's validation listener/DB closes. A failed physical close
  or cleanup retains owner state and supports retry of that cleanup only.

## Wrapper and actual binary evidence

The separate Cargo root uses the official public Codex app-server library at
`83086188ae0614bd882818ff1aa23f3194962012`, Rust 1.95.0 and a locked dependency
resolution. It uses strict mandatory policy loading, stdio, constructor plugin
startup Skip, disabled ephemeral remote control and no managed daemon. It has no
generic CLI override, helper argv dispatch, dotenv or listener. Skip alone is not
an authenticated-startup or no-network guarantee.

The latest locked offline arm64 build exited 0 at 16:59:12 UTC. Its current binary
is 446,394,224 bytes, SHA256
`835674dd9455f7394ee0992596ad39d03d6872a739afec4afedd7c543a039d64`.
Static metadata/pins matched. Actual `--account-info` under the network/fork-denied
macOS sandbox with an empty private profile returned unauthenticated, no auth/cache
and empty stderr. The temporary profile was removed. The actual official bootstrap
catalog is 472,072 bytes; it is source material, not available-model proof.

The historical actual wrapper/loopback fake-provider proof remains valid for its
unchanged wire boundary: tools exactly empty, four canonical IDs/timestamps,
automatic-host input, same-child/thread continuation, three local provider requests
and a deliberately lost ACK without replay. It predates the classifier rebuild
and is not a signed-in-account check. The reusable current build target is retained;
the earlier 4.08 GiB target cleanup was before this rebuild. See the
[build guide](../development/owned-native-worker-build.md) for current artifact pins.

## Focused evidence

| Boundary | Observed result | Limit |
| --- | --- | --- |
| Bun Native provider/runtime/store/ToolJournal | 1 case / 95 assertions passed | Injected bridge; no real account/model |
| Main binding/late-event/generation/cleanup bridge | 1 / 83 passed | Fake leaf |
| Actual private Node HTTP + Bun authority/runtime/store | 1 / 20 passed | Fake leaf, one offer/no replay |
| Exact owned-core admission | 1 / 8 passed | Offline acceptance/drain/exact identity |
| Server shutdown Native invalidation | 1 / 42 passed | Actual server with held fake leaf/RPC fault |
| Main cleanup retry; leaf physical-close recovery | 1 / 32 and 1 / 25 passed | Targeted injected failures |
| Guarded auth IPC; Agent IPC/error paths | 1 / 16 and 3 / 13 passed | Owner/transport fixtures |
| Inventory → two nonhidden model admissions/status/close IPC | 1 / 9 passed | Fake inventory/execution owners; no real model |
| Sequential inventory and auth-stat reconciliation | 1 / 185 passed | Fake children and actual bootstrap datafile |
| Shared account process / two task threads / retirement | 1 / 92 passed | Fake stdio account process, interleaving and held receipts |
| Actual wrapper/static classifier | Build + empty-profile sandbox passed | No signed-in account, model or inference |
| Historical actual pinned wrapper/local fake provider | Passed | Three loopback requests only |
| Existing offline local tools; Web image projection | 1 / 26 and 2 / 156 retained passing | Unchanged focused fixture evidence |
| Root and renderer TypeScript | Passed at 17:30 UTC | Current source types, not UI/model execution |
| Renderer development bundle | Final integrated 194-module bundle passed at 17:32 UTC | Development bundle, not an installed update |
| Plain CLI development bundle/version | 634 modules and exact `.9` version passed at 17:32 UTC; temporary output removed | No packaging or inference |
| Architecture map | 717 source modules, documented paths and freshness passed | Rust target cache excluded; generated artifacts are not source modules |

Unchanged passing results were reused. No full repository suite, release
packaging, distribution signing, notarization, replacement installation or release
asset publication is claimed. The final focused build checks passed. New source publication and its exact CI
receipt remain separate from these development observations.

The goal retains N01–N08 plus every one of the 36 areas, macOS first and
Windows/Linux second. Real auth/catalog/model delivery, actual-provider Automatic
Goal, consent-aware owned final-summary history, supported client reuse/fork/handoff,
SSH/Agent remote authority, authenticated MCP, executable/binary/network skill
resources and named consumer/usage evidence remain open in the
[full program](../design/full-adoption-program.md). A source-ready owner or fake
fixture does not complete those outcomes.
