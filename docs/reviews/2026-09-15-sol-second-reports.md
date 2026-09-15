# NEKODEX second review — original Sol reports

Baseline: f426422a04ec6d174e7720432589cd4626724aa4. All 16 completed, collected and closed. These are reviewer claims; use the companion adjudication for final priorities and qualifications.

## 1. Russell

Agent: `01a0a59a-4962-77a3-9055-d0bbfec5b082`. Model: gpt-5.6-sol medium.

At commit `f426422a04ec6d174e7720432589cd4626724aa4`, I found **one new actionable bug** in the Helper IPC path. B01 (readiness during close) and B02 (account routing) appear implemented as described in the earlier fixes; I did not repeat them.

**A rejected outgoing frame terminates unrelated active turns.** [launcher-helper-client.ts:762](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/launcher-helper-client.ts:762) rejects a frame when the 128 MiB input queue would be exceeded, but the catch at [line 764](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/launcher-helper-client.ts:764) calls `failChild` before rethrowing. That detaches and terminates the shared Helper, then fails *every* pending turn ([lines 413 and 689](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/launcher-helper-client.ts:413)). A trigger is concurrent prompt acknowledgements with large inline images while the pipe is backed up; image-size validation occurs later in the worker, after the parent has sent the IPC frame ([browser-worker.ts:2077](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/browser-worker.ts:2077)). The worker’s duplicate-ID and capacity guards permit separate concurrent turns, so they do not prevent this collateral failure ([browser-worker.ts:2219](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/browser-worker.ts:2219)).

**Minimal repair:** keep the IPC byte limits, but handle a locally rejected frame or full queue as a failure of the offending turn. Abort that turn’s pending prompt selection; wait for bounded backpressure or reject its frame without killing the Helper that owns other turns. **Confidence:** high in the control-flow consequence, medium in how often pipe saturation occurs. I did not reproduce saturation or inspect live account behavior.

This was a read-only manual review of the named files and direct callers. I ran no tests, builds, apps, traffic, edits, or agents.



## 2. Linnaeus

Agent: `01a0a59a-489f-7351-a7cb-39163e4bd8b3`. Model: gpt-5.6-sol medium.

**One actionable finding** at the requested commit. The other suspected allocation paths did not meet the evidence threshold for a finding.

**Retained-only start can evict an unrelated retained tab before failing.**  
Location: [/Users/alex/Dev/nekodex/launcher/electron/account-pool.cjs:308](/Users/alex/Dev/nekodex/launcher/electron/account-pool.cjs:308) (capacity decision at line 273).

**Trigger:** The affinity file still maps conversation key `K` to an account, but `K`’s retained tab has been closed or evicted. Global tab capacity is full of other reclaimable retained tabs. A start request sets `requireRetainedConversation: true` for `K`.

**Causal evidence:** `chooseAccount()` treats persisted or pending affinity as enough to pin a retained request (lines 233–242). With no tab for `K`, `ensureTabCapacity()` can call `evictOldestReclaimableTurnTab()` (lines 267–275). Only afterward does `BrowserHost.beginTurn()` check for an exact retained tab and throw `retained_conversation_unavailable` ([/Users/alex/Dev/nekodex/launcher/electron/browser-host.cjs:2387](/Users/alex/Dev/nekodex/launcher/electron/browser-host.cjs:2387)). The direct control-server caller validates the retained flag and key, then forwards them without checking tab presence ([/Users/alex/Dev/nekodex/launcher/electron/control-server.cjs:281](/Users/alex/Dev/nekodex/launcher/electron/control-server.cjs:281)). This is narrower than the B07 readiness fix: `ready()` succeeds, but the request was already unable to acquire the required conversation.

**Minimal repair:** For a retained-only start, check that the selected host has a matching reusable tab, including connector requirements, before reclaiming any tab. Keep the host’s final check for races after that precheck. **Confidence: high** in the source-level path. **Unverified:** no live account or capacity reproduction was run, so its frequency and user-visible impact are unknown.

This was a read-only manual review of the pool, relevant host methods, direct control-server caller and upstream retained-handoff path. No tests, builds, launches, traffic or changes were made.



## 3. Plato

Agent: `01a0a59a-4a17-7263-b3ba-0bf7cc8ff1a6`. Model: gpt-5.6-sol medium.

At `f426422a04ec6d174e7720432589cd4626724aa4`, I found **one conditional journal-consistency defect** in the requested scope. The earlier uninstall crash window has a source-level recovery path in the current code; I did not repeat it as a finding.

**Disconnected v11 journal can leave a managed JSON hook behind.** [src/codex-integration.ts](/Users/alex/Dev/nekodex/src/codex-integration.ts:520) returns from deactivation when the journal already says `active: false` after checking only the restored TOML route. [Uninstall](/Users/alex/Dev/nekodex/src/codex-integration.ts:652) likewise accepts the disconnected state and removes the journals without checking `hooks.json`. [readJournal](/Users/alex/Dev/nekodex/src/codex-integration-journal.ts:281) returns immediately when the two journal copies agree, bypassing its external-hook consistency check.

**Trigger:** after a successful deactivation, `hooks.json` is restored or edited to contain the same journal-recorded managed hook. A later `route disconnect` reports no change, and uninstall can remove its ownership record while leaving that hook in place. The launcher’s status guard checks whether removal persisted through the route status, but that status does not establish absence of the JSON hook in the disconnected case.

**Minimal repair:** before accepting an inactive v11 JSON journal as clean, check for the recorded hook. If it still matches the journal’s ownership evidence, remove it through the compensated write path; if the entry has changed, report the inconsistency and preserve the user’s edit. **Confidence:** high in the control flow; medium in practical likelihood. **Unverified:** I did not reproduce an external hook restoration, crash, or live hook execution. This finding concerns a hook reappearing *after* durable deactivation; the recovery path for an interruption *during* deactivation was reviewed separately and appears to handle its intended write order.

This was read-only manual review of the scoped implementation, prior review and fixes, and direct CLI and launcher callers. No tests, builds, launches, edits, or agents were used.



## 4. Halley

Agent: `01a0a59a-4abf-7643-8ae7-2b649d054a76`. Model: gpt-5.6-sol medium.

At `f426422a04ec6d174e7720432589cd4626724aa4`, I found **two actionable gaps** in Setup compensation. Both are supported by manual source review; neither was reproduced at runtime.

1. **A failed full → browser-only change can leave the old tunnel service removed.** At [/Users/alex/Dev/nekodex/src/setup.ts:624](/Users/alex/Dev/nekodex/src/setup.ts:624), Setup uninstalls the existing tunnel service, then calls `stopTunnel(existing)` at line 625. If that stop returns an error other than an accepted “not running” response, Setup exits before the compensation `catch`, which begins at [line 677](/Users/alex/Dev/nekodex/src/setup.ts:677). The old config and Codex route still describe full mode, but its tunnel service has been removed. The direct CLI caller at [/Users/alex/Dev/nekodex/src/cli.ts:303](/Users/alex/Dev/nekodex/src/cli.ts:303) has no checkpoint guard; the launcher’s `runSetup` has a separate checkpoint and previous-runtime recovery path. **Minimal repair:** put these pre-commit tunnel mutations inside the compensation boundary and restore the prior service definition and loaded state when they are still owned by this attempt. The same boundary should cover a tunnel-readiness failure after service changes. **Confidence:** high for the CLI source path. **Unverified:** whether the launcher’s separate recovery succeeds for this failure, and how often `stopTunnel` fails in practice. This is an incomplete compensation case, not a challenge to the intentional mode-change policy.

2. **A final route failure does not undo a tunnel-client upgrade.** `configureTunnel` calls `installTunnelClient` at [/Users/alex/Dev/nekodex/src/setup.ts:368](/Users/alex/Dev/nekodex/src/setup.ts:368). The helper permits an installed `0.0.10` client to upgrade to `0.0.12` and replaces the shared executable and manifest at [/Users/alex/Dev/nekodex/src/tunnel.ts:142](/Users/alex/Dev/nekodex/src/tunnel.ts:142). It restores the old pair if *that installation* fails, but Setup’s later route-failure compensation snapshots and restores the key, profile and services without the executable or manifest ([/Users/alex/Dev/nekodex/src/setup.ts:715](/Users/alex/Dev/nekodex/src/setup.ts:715)). A rejected final route commit therefore leaves the previous configuration using the upgraded binary. **Minimal repair:** stage the upgrade until the route commits, or snapshot both files and restore them after failure only if their bytes still match this attempt’s writes. **Confidence:** high for the conditional source path. **Unverified:** whether any current installation still has `0.0.10`, and whether the version difference causes an observable runtime incompatibility.

I checked the earlier [review](/Users/alex/Dev/nekodex/docs/reviews/2026-09-15-sol-backend-review.md) and [fixes](/Users/alex/Dev/nekodex/docs/reviews/2026-09-15-sol-backend-fixes.md). The reported B11 final route-commit compensation is present; these findings concern paths outside that fix’s effective boundary. The review was read-only: no edits, tests, builds, launches, traffic or agents.



## 5. Locke

Agent: `01a0a59a-4c0b-7430-9180-1491e78175a5`. Model: gpt-5.6-sol medium.

В указанном коммите нашёл **одно обоснованное улучшение** в native-ветке. Повторно заявлять прежний Windows `tee`-дефект оснований нет: текущий код использует `TransformStream` с нулевым порогом буферизации на читаемой стороне, а отмена клиентского потока проходит через `pipeTo` к исходному потоку. На Darwin/Linux отмена обёрнутого тела также вызывает `reader.cancel()`; прямые вызывающие функции передают сигнал запроса в `HttpTurnCounter`.

- **Неограниченное накопление строки native SSE** — [native-passthrough.ts](/Users/alex/Dev/nekodex/src/native-passthrough.ts:177). **Триггер:** native upstream отдаёт длинную `data:`-строку без `\n` либо непрерывный поток без разделителя строки. **Причина:** `inspectLines()` добавляет каждый декодированный фрагмент в `lineBuffer` и сохраняет всю строку, хотя обёртке нужно лишь распознать точную строку `data: [DONE]`. Этот путь используется при native forwarding через [server.ts](/Users/alex/Dev/nekodex/src/server.ts:467) и не покрыт лимитом накопления событий для локального Web-ответа. Память растёт вместе с длиной строки даже при исправном чтении клиентом; повторное сканирование растущего буфера добавляет затраты CPU. **Минимальный ремонт:** распознавать терминатор потоковым ограниченным состоянием, помечая строку как слишком длинную для точного совпадения, вместо хранения её целиком. **Уверенность:** высокая в отсутствии ограничения; средняя в практической частоте и тяжести. **Непроверенные пределы:** не измерял реальные размеры native SSE-событий и поведение на Windows; по условию не запускал тесты, приложение или сетевые запросы.

Это оценка по исходному коду, а не воспроизведённый сбой. Других выводов с достаточной причинной опорой в заданном срезе нет.



## 6. Epicurus

Agent: `01a0a59a-4b5b-7cf2-94d4-bec3ddd5e21b`. Model: gpt-5.6-sol medium.

I found **one incomplete B03 fix** at commit `f426422a04ec6d174e7720432589cd4626724aa4`.

**A plain Web answer can carry a local item ID into native replay.** Trigger: a completed ChatGPT Web response contains only assistant text, and the next request switches to a native model using that response’s `previous_response_id`. The Web response builder assigns the text item a local `msg_*` ID at [bridge.ts](/Users/alex/Dev/nekodex/src/bridge.ts:895), and [state.ts](/Users/alex/Dev/nekodex/src/responses/state.ts:224) stores that output for continuation. Native forwarding expands the stored history and removes `previous_response_id` at [native-passthrough.ts](/Users/alex/Dev/nekodex/src/native-passthrough.ts:267), but `scrubBridgeArtifactsForNative` returns unchanged unless the input contains a recognized Web reasoning or compaction item ([native-passthrough.ts](/Users/alex/Dev/nekodex/src/native-passthrough.ts:104)). A text-only continuation therefore sends the Web-owned `msg_*` ID upstream. The module’s own replay contract says item IDs are scoped to the backend that created them ([native-passthrough.ts](/Users/alex/Dev/nekodex/src/native-passthrough.ts:96)). The existing regression checks that history expands, but does not check its item IDs.

**Minimal repair:** when forwarding a *known local continuation*, remove local item `id` fields from the expanded replay history even if it has no reasoning or compaction artifact. Preserve `call_id` links and the current byte-for-byte path for requests with unknown, native-owned response IDs. This is an incomplete earlier fix, not a finding against the intentional native passthrough policy.

**Confidence:** high in the source-level omission; medium in the resulting upstream rejection. This was read-only manual review. I ran no tests or account requests, so I did not verify how the native backend handles this particular `msg_*` item.



## 7. Avicenna

Agent: `01a0a59a-4de0-7e41-a785-d2eb0018ee1e`. Model: gpt-5.6-sol medium.

At `f426422a04ec6d174e7720432589cd4626724aa4`, I found two new source-level data-loss paths. The earlier inline-file rejection and opaque-reasoning replay fixes appear present in the inspected code, so I am not repeating them as findings.

1. **A malformed image block in a known message bypasses validation.** [schema.ts](/Users/alex/Dev/nekodex/src/responses/schema.ts:111) has a loose fallback for any item with a string `type`. A `{type:"message", role:"user", content:[{type:"input_image"}]}` item fails the image requirement at line 11 but passes that fallback. [parser.ts](/Users/alex/Dev/nekodex/src/responses/parser.ts:38) then turns it into `[image: ?]`; an unrecognized content block is silently omitted by the same projection loop. `server.ts:482` calls this parser and has no separate content guard. **Minimal repair:** restrict the fallback to genuinely unknown item types, so known `message` items must satisfy their content schema. **Confidence:** high for the source path. **Unverified:** no request was executed, and I did not establish which current clients send malformed blocks.

2. **A valid image in a system message is silently discarded.** [schema.ts](/Users/alex/Dev/nekodex/src/responses/schema.ts:43) permits `input_image` in system content. [parser.ts](/Users/alex/Dev/nekodex/src/responses/parser.ts:393) flattens that content to text and substitutes an empty string for every image part; [prompt.ts](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/prompt.ts:467) receives only the resulting strings. **Minimal repair:** either reject images in system messages at the request boundary or carry them as structured attachments while preserving system priority. **Confidence:** high for deterministic loss. **Unverified:** whether a supported client currently sends system images; no browser turn was run.

This was a read-only manual review of the requested files and direct callers. I ran no tests, builds, app launches, traffic, edits, or additional agents. Filename and `file_id` placeholders remain an explicit policy in the prior fixes report, so I did not count them as defects.



## 8. Archimedes

Agent: `01a0a59a-4cd0-78f2-92c2-1e50195ec221`. Model: gpt-5.6-sol medium.

I found **one justified improvement** at `f426422a04ec6d174e7720432589cd4626724aa4`:

**Cap active MCP activity leases per turn.** At [turn-broker.ts:1047](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/turn-broker.ts:1047), each valid claim adds an ID to `activities` without a count check. The earlier fix caps *completed* IDs at 4096 only when `activity_complete` runs ([turn-broker.ts:1084](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/turn-broker.ts:1084)). If many requests for one live turn remain unsettled, active leases can therefore grow without reaching that limit; tool calls also accumulate pending invocations and queued IDs at [turn-broker.ts:1136](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/turn-broker.ts:1136). The direct MCP handler creates a fresh lease per request and settles it only after the action finishes ([mcp-server.ts:513](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/mcp-server.ts:513)).

A minimal repair is an explicit per-turn active-claim cap checked before adding a new lease. On overflow, fail closed while preserving the delayed-claim protection provided by completed IDs; review the pending-invocation cap alongside it. **Confidence:** high in the source-level gap, moderate in its practical impact. I did not measure live MCP concurrency or establish whether an upstream transport imposes a lower limit.

The whole-turn revocation on invocation transport failure is an intentional policy documented in [mcp-server.ts:573](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/mcp-server.ts:573), so I did not repeat it as a defect. This was read-only manual review of the implementation, prior review and fixes, and direct callers; no tests or runtime reproduction were performed.



## 9. Jason

Agent: `01a0a59a-4eaa-7753-be69-0eab458c6d43`. Model: gpt-5.6-sol medium.

**1 actionable finding (P2): a failed retained-tab release loses the retirement barrier.**

At [turn-execution.ts:788](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/turn-execution.ts:788), `closeConversationAndWait` removes the conversation head, deletes its session entries and detaches their conversation key **before** awaiting the Launcher release at [line 803](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/turn-execution.ts:803). If `/v1/turn/release` times out or returns an error, the `finally` block at [line 808](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/turn-execution.ts:808) also removes the pending retirement. The retained tab may still be ready in Launcher, but the registry can no longer find its owner or retry its release. The compaction caller attempts cleanup after a handoff error, yet its guard at [index.ts:1073](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/index.ts:1073) sees the already-detached key and exits. A later turn can therefore encounter or reuse the old retained page without the registry’s intended release barrier. This is an incomplete failure path, distinct from the deliberate policy to keep physically unsettled sessions through TTL pruning.

**Minimal repair:** keep the conversation’s ownership and pending retirement represented until release is acknowledged; on release failure, retain a retryable release obligation and block replacement work for that key. Preserve the exact final-response replay when retirement is requested with a preserved session.

**Confidence:** high for the source-level loss of ownership and retry path; medium for its user-visible consequence. I did not reproduce a Launcher timeout or inspect a live retained tab. The earlier checkpoint-load and physical-settlement TTL findings appear addressed in the current implementation; I found no additional substantiated issue within this scope.



## 10. Gauss

Agent: `01a0a59a-4f93-75c2-af11-64cd75b1e1ea`. Model: gpt-5.6-sol medium.

At `f426422a04ec6d174e7720432589cd4626724aa4`, I found **two actionable issues** in the requested scope. Both are supported by source control flow; neither was reproduced at runtime.

1. **Passkey capture can remove a profile while Chrome still owns it.** [browser-login.ts](/Users/alex/Dev/nekodex/src/browser-login.ts:373) calls `rmSync(profileDir)` even when `context.close()` failed at line 368. The earlier browser-stop failure path at lines 292–300 also reaches this removal. If Chrome or the Playwright context remains alive, removal can race its use of the profile; the launcher receives an error but has no surviving profile handle to clean up safely. The managed login path already retains its profile when closure fails at lines 475–484, so this is an incomplete cleanup safeguard in the related passkey path. **Minimal repair:** remove the passkey profile only after both browser owners are confirmed closed; otherwise retain it, report its location, and provide an owned cleanup path. **Confidence:** high in the control flow; actual Chrome shutdown failure and its filesystem effects are unverified.

2. **A storage-save failure turns a completed managed-Chrome response into a failed turn.** [browser-worker.ts](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/browser-worker.ts:5264) captures and writes filtered storage after the response loop has completed. If `storageState()` or `atomicWriteFile()` throws, the enclosing catch at line 5274 reports the turn as failed instead of returning `finalText` at line 5273. Submission has already begun, and the direct caller classifies a post-submission failure as non-retryable in [index.ts](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/index.ts:308). A disk or permission error can therefore discard the completed result. **Minimal repair:** handle session-state persistence separately after response completion, surface its failure as a warning, and return the completed result while keeping the current in-memory context. **Confidence:** high in the control flow; no storage failure or live turn was reproduced.

The fresh managed-login profile, the ChatGPT/OpenAI storage allowlist, whole-turn MCP cancellation, and the launcher’s primary-account import guard appear intentional or already addressed; I found no substantiated new defect in those paths. I performed manual source and direct-caller review only. I made no edits and ran no tests, builds, launches, account traffic, or agents.



## 11. Leibniz

Agent: `01a0a59a-504d-79c3-8531-9faaff66240d`. Model: gpt-5.6-sol medium.

At commit `f426422a04ec6d174e7720432589cd4626724aa4`, I found **two actionable shutdown issues**. Neither was reproduced at runtime; both follow from the current control flow. I reviewed the prior findings and fixes, the implementation, and the direct caller guards. I made no changes or ran tests.

1. **A rejected signal-triggered Quit consumes its signal handler.** [main.cjs](/Users/alex/Dev/nekodex/launcher/electron/main.cjs:1446) registers `SIGTERM` with `process.once` (and does the same for `SIGINT` on line 1445). If the signal arrives during a setup or browser operation, [requestQuit](/Users/alex/Dev/nekodex/launcher/electron/main.cjs:1001) refuses to quit, but the handler has already been removed. A subsequent signal can terminate the launcher without running supervisor shutdown. The supervisor starts owned children as detached process groups on macOS/Linux at [runtime-supervisor.cjs](/Users/alex/Dev/nekodex/launcher/electron/runtime-supervisor.cjs:505), so this can leave runtime processes behind. **Minimal repair:** retain the signal handler when Quit is refused and define how a later signal retries or escalates shutdown. **Confidence:** high in the handler and caller path; whether a child survives depends on platform and process state.

2. **Quit can wait through a full tunnel recovery instead of promptly reaching its forced fallback.** [forceStopOwnedRuntime](/Users/alex/Dev/nekodex/launcher/electron/runtime-supervisor.cjs:2083) and [performStopForSetup](/Users/alex/Dev/nekodex/launcher/electron/runtime-supervisor.cjs:1979) await all recovery tasks before cleanup. A tunnel recovery can enter a 120-second connect command and then a 120-second readiness wait at [runtime-supervisor.cjs](/Users/alex/Dev/nekodex/launcher/electron/runtime-supervisor.cjs:1353). Those waits have no shutdown cancellation guard. The [Quit operation guard](/Users/alex/Dev/nekodex/launcher/electron/main.cjs:1001) checks runtime-host and browser-host operations; supervisor recovery is tracked separately, so it does not prevent this overlap. **Minimal repair:** give recovery a shutdown cancellation signal and a bounded settlement path before forced cleanup, while preventing a cancelled recovery from starting or adopting a child afterward. **Confidence:** medium-high from source control flow; actual delay depends on where recovery is when Quit begins.

The earlier detached-compaction drain finding appears addressed by the current three-counter check. Forced-partial Quit remains an intentional best-effort policy and is recorded by the caller; I have not counted either as a new defect.



## 12. Feynman

Agent: `01a0a59a-5100-7d23-9b7d-5ecb0c878ea6`. Model: gpt-5.6-sol medium.

At `f426422a04ec6d174e7720432589cd4626724aa4` on `main`, I found three actionable repository-rename gaps. These are source-level findings; I did not run tests, builds, installers, or account traffic. The earlier backend review and fixes document do not resolve these release contracts.

1. **Release workflow stays skipped after the rename.** [release.yml](/Users/alex/Dev/nekodex/.github/workflows/release.yml:28) runs its `plan` job only when `github.repository == 'Froraut/codex-chatgpt-web'`. A tag push or manual dispatch in `Froraut/NEKODEX` therefore skips `plan`; the dependent build and publish jobs cannot run. The owner check is a deliberate publication guard, but its old value is stale for the requested repository. **Minimal repair:** change the guard to the new repository, then align the signer’s repository identity check in [sign-release-metadata.cjs](/Users/alex/Dev/nekodex/scripts/sign-release-metadata.cjs:10) before attempting a new release. **Confidence:** high. **Unverified limit:** no workflow was dispatched.

2. **The published `5.2.0-nekodex.1` cannot accept a straightforward update published under the new repository identity.** The packaged updater takes its origin from [launcher/package.json](/Users/alex/Dev/nekodex/launcher/package.json:7), while [release-trust.json](/Users/alex/Dev/nekodex/launcher/release-trust.json:3) binds signed metadata to the old repository. Its direct caller supplies no replacement repository ([main.cjs](/Users/alex/Dev/nekodex/launcher/electron/main.cjs:1209)); update selection requires an asset URL under the packaged repository ([update.cjs](/Users/alex/Dev/nekodex/launcher/electron/update.cjs:106)), and verification requires that same repository in the signed payload ([release-trust.cjs](/Users/alex/Dev/nekodex/launcher/electron/release-trust.cjs:76)). A future release signed as `Froraut/NEKODEX` fails the old build’s identity contract even if GitHub makes it discoverable through the old name. The strict pin is an intentional trust policy; the missing migration path is the defect. **Minimal repair:** publish a *new-version* build with aligned new-repository package and trust identities, and define a publisher-authenticated transition for existing `.1` installations. Do not alter the immutable `.1` assets or silently relax their trust check. **Confidence:** high for the contract mismatch; medium for which failure appears first. **Unverified limit:** GitHub redirect and release-list behavior were not checked.

3. **Fresh installer defaults do not select the existing prerelease.** Both [install-launcher.sh](/Users/alex/Dev/nekodex/scripts/install-launcher.sh:35) and [install-launcher.ps1](/Users/alex/Dev/nekodex/scripts/install-launcher.ps1:34) use GitHub’s `/releases/latest` when no version is supplied, although the repository’s current version is `5.2.0-nekodex.1` and the publisher marks suffix releases as prereleases with `--latest=false` ([publish-release.cjs](/Users/alex/Dev/nekodex/scripts/publish-release.cjs:37)). The updater already uses the release list to handle this channel ([update.cjs](/Users/alex/Dev/nekodex/launcher/electron/update.cjs:29)). Once the new repository defaults are corrected, an installer run without `CODEX_WEB_GPT_VERSION` still cannot resolve `.1` as “latest” while it is the only published release. Explicit version and repository environment variables guard that path, so this is a default-install defect. **Minimal repair:** use a defined prerelease channel selection from published releases, or require and document an explicit version until a stable release exists. **Confidence:** high from the code and publication flags. **Unverified limit:** no GitHub API request or installer run was made.

I treated the retained `codex-chatgpt-web` runtime paths and application identity as compatibility contracts, and the approved certificate legal-holder name as out of scope.



## 13. Banach

Agent: `01a0a59a-51a9-7373-b1db-3c7eceadc49b`. Model: gpt-5.6-sol medium.

**0 findings** in the requested resource-boundedness scope at `f426422a04ec6d174e7720432589cd4626724aa4`. I found no substantiated new defect or incomplete earlier fix worth adding to the aggregate report.

Manual source review confirmed that the non-streaming path enforces its event byte and count budgets before queue delivery and aborts the producer on overflow ([server.ts](/Users/alex/Dev/nekodex/src/server.ts:616)); both authenticated cancellation routes use the bounded JSON reader ([server.ts](/Users/alex/Dev/nekodex/src/server.ts:958), [http-body.ts](/Users/alex/Dev/nekodex/src/http-body.ts:52)); diagnostic pruning rechecks process identity and ownership before deletion ([browser-diagnostic-retention.ts](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/browser-diagnostic-retention.ts:46)); and the launcher’s emergency stream-error sink rotates at its byte limit ([logging.cjs](/Users/alex/Dev/nekodex/launcher/electron/logging.cjs:181)). I checked the direct diagnostic and admin callers, including [browser-worker.ts](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/browser-worker.ts:1821) and [service.ts](/Users/alex/Dev/nekodex/src/service.ts:158).

This was read-only inspection. I ran no tests, builds, app launches, account traffic, edits, or additional agents. Rare PID reuse, sustained stream errors, and live cancellation behavior remain unverified; those limits alone do not establish a defect.



## 14. Chandrasekhar

Agent: `01a0a59a-5255-7cd2-ba38-efa9c65491d9`. Model: gpt-5.6-sol medium.

At `f426422a04ec6d174e7720432589cd4626724aa4`, I found **two actionable renderer state defects and one justified account-view improvement**. These are source-level findings; I ran no tests or app traffic.

1. **Manual setup can remain on “Tools” after credentials are saved.** [App.tsx](/Users/alex/Dev/nekodex/launcher/src/App.tsx:1466) reads a fresh snapshot after `setupMcp()`, but copies only `.state` into the parent. The wizard sets its own `credentialsConfigured` flag at line 1464, while Setup calculates `toolsInstalled` from the parent’s unchanged `snapshot.mcpCredentialsConfigured` at line 1192. [setup-progress.ts](/Users/alex/Dev/nekodex/launcher/src/setup-progress.ts:8) then keeps returning `"tools"` in manual mode, even if connector verification later sets `mcpSetupComplete`. The operation-completion refresh at App.tsx:87–89 also copies only `contextCapabilities`. **Minimal repair:** update the parent’s credential field from the fresh snapshot after setup, and refresh it when relevant operations complete. **Confidence: high.** I did not reproduce the wizard against saved credentials.

2. **A late startup snapshot can overwrite newer live state.** [App.tsx](/Users/alex/Dev/nekodex/launcher/src/App.tsx:61) starts `api.snapshot()` and unconditionally applies its browser, operation, state and logs when the IPC reply arrives. The live listeners are registered at lines 73–92. If the main process captures the snapshot, then publishes a newer browser or operation event before the reply is applied, lines 63–66 replace that event with older values. The state listener also discards events while `current` is null. **Minimal repair:** subscribe before requesting the snapshot and reconcile the initial reply with events received during startup, using sequence or generation tracking. **Confidence: medium-high** for the control-flow race; its frequency and visible duration are unverified.

3. **The Accounts page does not reflect background account changes while it stays open.** [AccountSettings.tsx](/Users/alex/Dev/nekodex/launcher/src/AccountSettings.tsx:18) loads `accountSnapshot()` once and refreshes local state only after its own actions. Authentication, account labels and active turns are read from hosts in [account-pool.cjs](/Users/alex/Dev/nekodex/launcher/electron/account-pool.cjs:83), and host changes publish browser-state events through account-pool.cjs:104–109. App receives those events at App.tsx:83, but Accounts receives no browser state or refresh signal. A sign-in or turn that changes in the background can therefore leave its card showing old status until the page is reopened or an account action is taken. **Minimal repair:** refresh the account snapshot on relevant browser-state changes while Accounts is mounted, with a guard against older responses replacing newer ones. **Confidence: high** for stale display; I did not measure how often users encounter it.

The earlier backend review and fixes do not resolve these renderer paths. I treated manual-mode account-check restrictions and the approved certificate legal-holder name as intentional boundaries, not findings.



## 15. Curie

Agent: `01a0a59a-52ff-7d61-b1d9-37b0c9a5c014`. Model: gpt-5.6-sol medium.

At `f426422a04ec6d174e7720432589cd4626724aa4`, I found **one justified improvement**. The prior review’s backend fixes are recorded as resolved, and I did not find a substantiated new defect in the DMG signing or release digest path.

- **Include the capacity case when a change touches both mapped areas.** [focused-pr-check.ts](/Users/alex/Dev/nekodex/scripts/focused-pr-check.ts:105) gives `backend-review` precedence whenever a backend case is selected, even if a changed path also matches `capacityFiles`. For a PR changing, for example, `src/native-passthrough.ts` and `src/adapters/chatgpt-web/concurrency.ts`, the selector outputs only the backend pattern. The [CI runner](/Users/alex/Dev/nekodex/.github/workflows/ci.yml:66) then executes only `tests/backend-review-regressions.test.ts`; the mapped browser capacity case does not run. The summary does flag the capacity path for manual review, so this is a **case-selection gap, not a claim that CI asserts capacity passed**. Minimal repair: select the capacity case alongside backend cases for mixed changes, using one bounded invocation that names both test files; retain the existing manual-review notice for other unmapped paths. **Confidence: high** from the selector and caller control flow. **Unverified:** no CI run or timing measurement was performed.

I reviewed the release callers’ guards as well: packaging signs, notarizes, staples and checks the release DMG before copying it to artifacts; release metadata hashes the copied assets, and publication checks authenticated local hashes and the draft’s reported remote digests. This was read-only source inspection, so it does not establish that a live notarization or GitHub release succeeds.

No files were changed; no tests, builds, app launches, account traffic, commits, branches or additional agents were used.



## 16. Popper

Agent: `01a0a59a-539d-7cc3-b5ed-569ca2dcc178`. Model: gpt-5.6-sol medium.

Ручной read-only review коммита `f426422a04ec6d174e7720432589cd4626724aa4` выявил два новых замечания. Прежний отчёт и файл исправлений учтены; сознательную отмену MCP на весь turn я не считаю дефектом.

1. **P2 — неудачная загрузка сохранённой среды может привести к перезаписи непрочитанного файла.** [thread-environment.ts](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/thread-environment.ts:255) устанавливает `loaded = true` до чтения и проверки `thread-environments.json`. Триггер — повреждённый JSON или запись с неверной структурой: первая попытка `resolve()` падает, но следующая попытка с текущим доверенным environment доходит до `set()` ([строка 159](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/thread-environment.ts:159)); `load()` уже пропускает файл, а `persist()` записывает только новое состояние ([строка 279](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/thread-environment.ts:279)). Минимальный ремонт — разобрать и проверить файл во временной карте, затем одновременно опубликовать карту и флаг `loaded`; при ошибке сохранить файл и возможность повторного чтения. **Уверенность: высокая** в описанном переходе состояний. **Не проверено:** наличие повреждённого файла у пользователя и поведение запущенного приложения. Это тот же класс ошибки, который прежние исправления устранили для Luna checkpoint store, но здесь он остался.

2. **P2 — экранированный текст native delegation меняется только для дочерней задачи.** [native-delegation.ts](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/native-delegation.ts:39) декодирует `&amp;`, `&lt;` и другие XML-сущности при наличии `lineage`, тогда как доставка в корневую задачу кладёт захваченное `<input>` без декодирования ([строка 51](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/native-delegation.ts:51)). Триггер — подтверждённая native-журналом доставка `<input>Review A &amp; B.</input>` в корневую Web-задачу: после повторного `parseRequest()` в [server.ts](/Users/alex/Dev/nekodex/src/server.ts:483) инструкция остаётся `Review A &amp; B.`. Проверка журнала подтверждает происхождение результата, но не исправляет его текст. Минимальный ремонт — применять одну и ту же функцию декодирования XML-сущностей к обеим ветвям после проверки происхождения. **Уверенность: высокая** для такого входа; существующий focused fixture подтверждает декодирование дочерней ветви. **Не проверено:** частота экранированных доставок в реальном native Codex и эффект на ответ модели.

Тесты, сборки, запуски и изменения файлов не выполнялись. Коммит и прямые caller guards проверены вручную; выводы остаются выводами по исходному коду, без runtime-воспроизведения.
