# Private owned Native worker

This leaf is a Mac-first, trusted-main implementation candidate for a **new** private Codex worker. It is not integrated into main, Bun, renderer, Agent mode, or the installed app. Windows/Linux remain phase 2. Existing native metadata control retains `startTurn:false`, `interruptTurn:false`, and `approve:false`.

The implemented available route is explicitly **local-fixture-only**. `official-openai` reports `official_policy_preflight_unverified` before profile creation or CLI launch. Real account login, authenticated cloud-policy admission, and actual OpenAI delivery remain separate unverified work. No existing credentials are read or copied.

## Files and ports

- `launcher/electron/owned-native-admission.cjs`: fixed version/catalog/config admission, private profile construction, Mac managed-policy probe, connected effective checks.
- `launcher/electron/owned-native-worker.cjs` and `.d.cts`: one owned stdio transport, one new ephemeral thread, bounded exact-ID event projection, lifecycle and offers.
- `launcher/electron/owned-native-journal.cjs`: private durable intent/ACK/terminal/unknown receipts, one process owner and restart uncertainty.
- `tests/owned-native-worker.test.ts`: focused synthetic RPC boundary cases.
- `tests/fixtures/owned-native-worker-local.cjs`: opt-in actual stock-CLI/local-fake Responses proof; never part of a default test run.

`createOwnedNativeWorkerService` is main-only. Constructor inputs include the exact executable SHA256, private authority home, single-model catalog JSON/hash/ID, and a fixed route. A renderer/Bun-facing integration must resolve admitted identifiers in main instead of accepting these inputs directly.

The public leaf methods are `createOwnedWorker({actionId})`, `offerOwnedTurn({workerHandle,actionId,text,outputSchema?})`, passive `inspectOwnedWorker(workerHandle?)`, `retireOwnedWorker({workerHandle,actionId})`, `currentOperation()`, and `destroy()`. Handles are opaque UUIDs; callers cannot adopt/proxy/resume a foreign native thread or override its model/home/config. Text input is supported; image input is explicitly unsupported. Do not send base64 images as text and call that image delivery.

`onReceipt` observes persisted offered/ACK/terminal receipts; observer errors never authorize replay. Passive inspect exposes durable action receipts without constructing a profile or starting a CLI. `compileOutputSchema` is an injected trusted-main synchronous schema compiler required for structured offers. The Electron leaf has no new third-party dependency. Future public integration must accept a fixed schema ID and resolve its schema/compiler in main.

## Admission and limitations

Pinned stock version: `0.163.0`; official source commit `83086188ae0614bd882818ff1aa23f3194962012`. Before startup the leaf checks the exact executable bytes plus official standalone package layout metadata; it does not infer provenance from an initialize user-agent string. Supplying a SHA256 is trusted-main admission, not a claim of independently verified distribution signing.

The only available route uses a new private HOME, CODEX_HOME, explicit SQLite home, empty cwd, sealed config/catalog, private receipts, and a constructed environment with dummy fixture auth. No ambient API keys, Codex thread identity, proxy configuration, or user MCP/config files are forwarded. The catalog contains one exact model ID with shell disabled, apply-patch absent, direct tool mode, no experimental tools, no search, no JS, no Responses Lite/websocket transport, and a required instruction template. Unknown model fallback/model switches are not admitted.

Pre-start checks reject any `/etc/codex/config.toml`, `managed_config.toml`, or `requirements.toml`, unreadable policy probes, and discoverable ancestor `.codex`/`.git` sources. This conservative source refusal is intentional; policy is neither removed nor ignored. Mac MDM probing uses the same CoreFoundation `CFPreferencesAppValueIsForced` domain `com.openai.codex` and keys `config_toml_base64` / `requirements_toml_base64` as the official loader, through fixed JXA in the built-in `/usr/bin/osascript`. A forced key, including forced-but-empty, means unavailable. It reads only forced metadata, never policy text or tokens. The observed current-host probe returned false for both keys.

After initialization confirms the configured home, public `config/read {includeLayers:true,cwd}` and `configRequirements/read {}` must pass before `thread/start`, and again before each offer. Every admitted effective leaf must match. Raw source layers must exactly match the sealed user config, pinned packaged defaults, or empty system/project layers. Any managed/cloud/other source, non-null requirement, profile override, or changed file is refused. The public Config projection materializes default fields; exact whole-object equality would be a false rejection. Public `ToolsV2` only exposes web_search, so plan/request-user-input disabling is verified via strict accepted ConfigToml plus the exact raw layer rather than falsely claiming a projected runtime echo.

The configuration closes shell, image, web/browser/computer, code mode/JS, subagents/board, apps/plugins, skills roots/discovery, goals/memories/history notes, plan/input/permissions/time/sleep/deferred tools, hooks, legacy notify, shell snapshots, remote control, discovery/auth elicitation, unbounded retries, async compaction and request compression. The exact config key for Rust `Feature::MemoryTool` is **`features.memories`**, not `memory_tool`. MCP is absent because no inherited effective source/selected roots/dynamic tool input is admitted; an empty MCP table is not treated as a universal veto.

Connected checks happen after process startup and cannot retrospectively prove startup was quiet. Authenticated cloud configuration can arrive before public RPC and may affect startup warmups. That is why the official authenticated route is unavailable. A dedicated user profile alone does not bypass system/managed/cloud authority. Changes to the CLI, source pin, capabilities, schema projection, or mandatory policy invalidate admission. Mac 13 binary compatibility is not established by this local run.

## Durable ownership and observation waits

Intent is persisted before the native request write, with stable action ID, worker generation, source/admission/catalog binding, input/schema hashes, request ID, and generated clientUserMessageId. Initial intent stores an input hash; terminal private receipts retain bounded canonical input/output text under the declared automatic-host/native-assistant authorship. Reusing an action ID rejects before a new native offer. `clientUserMessageId` is correlation, not promised idempotency. Thread creation verifies a causally new ephemeral idle thread, exact model/provider/cwd/permissions and no foreign parent/fork/instruction sources.

An ACK persists the exact native turn ID. Only matching thread/turn events are projected, and only canonical user/assistant text is retained. Automatic input is labeled `automatic-host`; native user role does not establish human authorship. Per item text is bounded at128KiB, canonical page384KiB, item count100, pre-ACK queue128 events/1MiB and raw RPC line1MiB. System/developer/tool/reasoning/raw Response payloads are not canonical messages. Unsupported server requests are denied and revoke the inference-only scope. Native usage is the exact matched per-turn breakdown when available, otherwise null; no generic price or exact request-count claim is made.

The request/terminal wait limits are **observation waits, not inference deadlines**. On expiry an offer can return `{state:'unknown',ownerHeld:true}` while the same child, pending request, exact-ID event queue and `currentOperation()` remain owned. New offers and new workers are blocked. A late exact ACK/terminal can durably reconcile that same action and trigger `onReceipt`; no second sender or replay is used. There is no timer-driven interruption/process destruction. A physically closed/lost owner or explicit retire/destroy records unknown with `ownerHeld:false`. A restart turns retained nonterminal/held records into owner-lost uncertainty, never replay; explicit retirement is required before a different worker can be created. Retiring uncertainty does not assert success or zero usage.

The journal preserves bounded terminal receipts, including canonical results, and fails closed on external writes/quota/invalid source. Each receipt has at most32 append-only state observations (state, reason, held ownership, exact turn ID, timestamp; no repeated raw text). Late reconciliation changes the latest projection while retaining the earlier unknown fact. A second passive service object checks only lock/PID metadata and reports an elsewhere/unverified owner rather than inventing owner loss. Scope retirement closes only the exact owned process group using the existing process-tree helper. There is no Desktop daemon stop, foreign-thread cancel, broad process kill, or automatic state deletion. The final integration must register a separate lifecycle participant and preserve held inference ownership in quit/scope-revocation decisions.

An existing owner lock is never automatically stolen, unlinked or replaced, including a proved-stopped PID. Passive status exposes stale ownership and actions fail closed with `stale_owner_recovery_required`. Controlled main recovery can allocate a fresh authority generation while preserving the old receipts; this leaf does not claim a read/unlink sequence is cross-process compare-and-swap. Normal release removes only the current owner's exact nonce, and every durable write checks that ownership still matches.

## Structured output and effect authority

The exact public field is top-level `outputSchema` in `turn/start`, constraining the final assistant message. The host must still validate JSON with the pinned schema. A future closed JSON union for `tool_request`/`final` is a declared NEKODEX adapter protocol, not a native function call. Native tools remain empty. Bun ToolJournal must remain sole effect admission/approval/execution/reconciliation owner, and a tool result would be a separately counted text continuation. Do not fabricate native toolOutput. Existing Machine dispatch authentication and Web provider routing remain unchanged; they require an explicit separate Native adapter admission.

## Focused evidence, 2026-10-18

Initial dedicated unit run: 5cases/40assertions passed. A subsequent changed-lifetime case passed alone: both late ACK and late terminal survive observation waits, retain the physical owner, and reconcile with one child and no replay. The final changed admission/schema/observation checks passed as3 selected cases/46assertions; then only the changed passive-owner/late-event case was rerun (1case/21assertions, six other cases filtered). No stock protocol proof was repeated for these lifetime changes. All positive contract tests use explicit macOS-only skips elsewhere; a small phase-2 unavailable-boundary case is retained for non-Mac CI rather than pretending cross-platform support.

Final ownership follow-up: stopped-lock preservation and the changed late case passed as2 selected cases/33assertions. The final retire-intent ordering change then passed only that same late case (1case/23assertions): a duplicate retirement action ID cannot detach a still-held inference, and exact late events still reconcile it. Earlier unchanged passing results are retained; no broad suite/typecheck or stock fixture rerun was started.

The actual fixture had startup-only rejections before any provider request while correcting the exact memories key, required catalog instructions, and normalized public Config projection. Each attempt closed its exact child/listener and removed its exact private state. No existing profile/auth/thread was touched.

One successful connected stock-CLI/local-fake run then observed:

```json
{"proof":"stock-cli-0.163-local-fake-only","realOpenAI":false,"realAccountAuth":false,"toolsExactlyEmpty":true,"canonicalMessages":4,"nativeTimestamps":true,"sameThreadContinuation":true,"ownedChildCount":1,"providerRequests":3,"unknownWithoutReplay":true,"structuredOutput":{"answer":"local first"},"nativeUsage":{"totalTokens":10,"inputTokens":7,"cachedInputTokens":0,"cacheWriteInputTokens":0,"outputTokens":3,"reasoningOutputTokens":0}}
{"ownedChildClosed":true,"listenerClosed":true,"privateStateRemoved":true}
```

The third actual turn's ACK was deliberately filtered inside the fixture's one owned stdio stream. No extra sender was created. Exactly three local requests were observed and zero replay. The later observation-wait lifetime correction changes held-owner behavior, not the proven model/schema/tools wire request; that stock fixture was not repeated. The dedicated late-event case verifies the changed lifetime instead.

This is not real model quality, OpenAI/account authentication, real provider delivery, UI integration, packaging or release proof. The fixture is opt-in:

```sh
node tests/fixtures/owned-native-worker-local.cjs /absolute/official/0.163.0/bin/codex
```

## Primary version-pinned references

- [Catalog startup-only field](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/config/src/config_toml.rs#L404-L406), [static manager selection](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/model-provider/src/provider.rs#L388-L398), [required instruction template](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/protocol/src/openai_models.rs#L934-L947).
- [System/cloud/managed precedence](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/config/src/loader/README.md#L26-L46), [cloud snapshot before layer composition](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/config/src/loader/mod.rs#L211-L235), [exact forced managed preference API](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/config/src/loader/macos.rs#L150-L206).
- [Shell gate](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/core/src/tools/spec_plan.rs#L1244-L1285), [independent apply patch](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/core/src/tools/spec_plan.rs#L1432-L1435), [memories feature key](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/features/src/lib.rs#L1279-L1283), [legacy notify independent registration](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/hooks/src/registry.rs#L122-L140).
- [ThreadStartParams ephemeral](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/app-server-protocol/schema/typescript/v2/ThreadStartParams.ts#L12-L22), [TurnStartParams correlation/steering](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/app-server-protocol/schema/typescript/v2/TurnStartParams.ts#L14-L37), [exact outputSchema](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/app-server-protocol/schema/typescript/v2/TurnStartParams.ts#L69-L75), [public ToolsV2 projection](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/app-server-protocol/schema/typescript/v2/ToolsV2.ts).
- [Official fake Responses/SSE event helpers used by the fixture](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/core/tests/common/responses.rs#L753-L830).

The expanded research and extraction mapping is also saved outside the code checkout at `/Users/alex/Documents/ChatGPT/Nekodex/reviews/owned-native-worker-design-20261018.md`.
