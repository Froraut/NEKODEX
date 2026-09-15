# NEKODEX — original reviewer reports

Baseline: `5d80fecef2b3d591eeadc9d74bfb340ed5b46ca1`. These are reviewer claims, not the final adjudication. See the companion backend review for parent decisions.

## 1. Hume

Model: gpt-5.6-sol; effort: medium.
Agent: `01a0a565-fa38-7652-a433-5eaba912b2f2`.
Scope: HTTP admission, body bounds, disconnect/abort and streaming lifecycle: src/server.ts src/http-body.ts src/bridge.ts.
Status: completed; collected and closed.

Manual review of commit `5d80fecef2b3d591eeadc9d74bfb340ed5b46ca1` found one substantiated streaming bug and one body-bound improvement. I inspected the three scoped files and the direct queue, native-passthrough, and Hermes callers needed to check their guards. I ran no tests or traffic.

1. **Bug — P2, high confidence:** [src/server.ts:311](/Users/alex/Dev/nekodex/src/server.ts:311). On Windows, a slow client can leave `clientBody` unread while the lifecycle reader at lines 322–330 eagerly drains the other tee branch. The tee can then retain response chunks for the client branch without a byte bound. The lifecycle reader also calls `release()` when the upstream ends, even if those chunks have not reached the client. A long response can therefore accumulate memory, and the active HTTP-turn count can reach zero before delivery finishes. **Minimal fix:** preserve a Windows-safe stream shape while bounding consumption against the client branch’s progress; release turn ownership only when client delivery or cancellation settles. **Unverified limit:** this follows from the stream topology; I did not exercise Bun’s Windows transport or measure retained memory.

2. **Improvement — P2, high confidence:** [src/server.ts:968](/Users/alex/Dev/nekodex/src/server.ts:968) and [src/server.ts:1000](/Users/alex/Dev/nekodex/src/server.ts:1000). Both authenticated admin cancellation endpoints use `req.json()` before validating their short identifiers. The JSON body has no size bound at these call sites, so an oversized request bearing the control token can be buffered and parsed in full before rejection. The Responses, Hermes, native, and image paths I checked use bounded readers; these two admin paths bypass them. **Minimal fix:** read each admin body with a small explicit byte limit before JSON parsing. **Unverified limit:** I did not measure Bun’s allocation behavior, and this finding depends on a caller possessing the control token.

I found no additional disconnect or abort bug that survived checking the direct cancellation paths.



## 2. Confucius

Model: gpt-5.6-sol; effort: medium.
Agent: `01a0a565-f998-7570-a4db-69005b49c5ab`.
Scope: Concurrency admission and queue fairness/leaks: src/adapters/chatgpt-web/concurrency.ts turn-broker.ts resource-budgets.ts and event-queue.ts.
Status: completed; collected and closed.

Manual review at HEAD `5d80fecef2b3d591eeadc9d74bfb340ed5b46ca1` found no substantiated concurrency-admission or queue-fairness bug. Two bounded-memory improvements are actionable:

1. **P2 improvement — completed activity IDs grow without a per-turn bound.** [turn-broker.ts](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/turn-broker.ts:1077) adds every completed MCP activity ID to `completedActivities`; entries are retained until `revoke()` removes the channel. A long Manual mode turn can remain live without a TTL after start ([line 669](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/turn-broker.ts:669)), so many completed calls steadily increase this set. The tombstones are needed to reject a delayed claim after cleanup, so a minimal fix must preserve that protection—such as bounding the claim’s delivery window before expiring its tombstone. **Confidence:** high that retention is unbounded; moderate that real turns reach a material size. I did not measure workload or memory.

2. **P2 improvement — the non-streaming response bypasses the event queue’s backlog bound.** [event-queue.ts](/Users/alex/Dev/nekodex/src/event-queue.ts:19) limits events waiting in the queue, but the direct non-streaming caller immediately drains them into an unbounded `events` array ([server.ts](/Users/alex/Dev/nekodex/src/server.ts:704)) until the turn ends. For a turn that emits many small progress events, the queue stays below 10,000 while the response accumulator continues growing. Apply a byte or event budget to that accumulator, with a terminal error when exceeded. **Confidence:** high in the code path; the size of a realistic response and any downstream limit were not measured.

This was read-only manual inspection of the four scoped files and the direct callers cited above. No tests, builds, launches, traffic, edits, or other agents were used.

## 3. Volta

Model: gpt-5.6-sol; effort: medium.
Agent: `01a0a565-fb9c-7422-80a5-6d663766f76e`.
Scope: Browser worker request lifecycle and failures: browser-worker.ts browser-helper-main.ts launcher-helper-client.ts.
Status: completed; collected and closed.

Manual review of HEAD `5d80fecef2b3d591eeadc9d74bfb340ed5b46ca1` found two actionable bugs. I inspected the three requested files and the direct caller and launcher code needed to establish their effects. I made no changes and ran no tests, builds, apps, or traffic.

1. **P1 bug — shutdown can hang while the helper is starting.** [launcher-helper-client.ts:309](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/launcher-helper-client.ts:309). If `close()` runs while `ensureChild()` is awaiting the helper’s `ready` frame, `close()` clears `child` and the readiness reject callback without settling that promise. The readiness timer rejects only while `this.child === child` ([line 363](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/launcher-helper-client.ts:363)), and the child-exit handler has the same ownership guard ([line 657](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/launcher-helper-client.ts:657)). The pending `run()` can therefore remain unresolved, while the worker’s `close()` awaits active runs ([browser-worker.ts:2279](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/browser-worker.ts:2279)). **Minimal fix:** reject the outstanding readiness promise with a shutdown error before clearing its callbacks; ensure a concurrent startup cannot install a child after closure. **Confidence:** high from the promise and guard paths. **Unverified:** how often shutdown overlaps the 15-second startup window in a running app.

2. **P2 bug — account affinity is lost in automatic helper turns.** [launcher-helper-client.ts:285](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/launcher-helper-client.ts:285). The adapter supplies `accountRoutingKey` for turns associated with a thread ([index.ts:761](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/index.ts:761)), and the worker includes it in the launcher’s start request ([browser-worker.ts:4396](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/browser-worker.ts:4396)). The client omits it from the helper’s `run` frame, and [browser-helper-main.ts:213](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/browser-helper-main.ts:213) does not reconstruct it. The launcher passes the resulting missing routing key to its account selection ([control-server.cjs:292](/Users/alex/Dev/nekodex/launcher/electron/control-server.cjs:292)); the pool uses that key to look up thread affinity ([account-pool.cjs:232](/Users/alex/Dev/nekodex/launcher/electron/account-pool.cjs:232)). A thread can consequently be assigned without its intended account affinity. **Minimal fix:** include and validate the key in the helper request, then copy it onto the helper’s `BrowserTurn`. **Confidence:** high for the field loss; medium for any particular account reassignment, which depends on pool state. **Unverified:** a live turn with multiple eligible accounts.

These are code-path findings; runtime frequency and end-to-end effects remain untested under the requested read-only scope.



## 4. Boyle

Model: gpt-5.6-sol; effort: medium.
Agent: `01a0a565-fc45-7452-8641-5ab3eeeb6e73`.
Scope: Electron native browser host tab allocation, session disposal, isolation: launcher/electron browser-host files (discover paths), src/launcher-browser-host.ts.
Status: completed; collected and closed.

Manual review of NEKODEX at `5d80fecef2b3d591eeadc9d74bfb340ed5b46ca1` found two actionable tab allocation bugs. I inspected the native host, account pool, launcher control path, and direct worker caller. I made no changes and ran no tests or app instances.

1. **P2 — A failed new turn can evict a retained conversation tab.** [account-pool.cjs](/Users/alex/Dev/nekodex/launcher/electron/account-pool.cjs:290) calls `ensureTabCapacity` before `await host.ready()`. When global capacity is full, that check removes a reclaimable retained tab (lines 261–269). If the chosen host then fails to become ready, no new tab is allocated, but the retained browser document is already gone. Move the capacity check to immediately after successful `host.ready()`, before `host.beginTurn()`. **Confidence:** high in the ordering and loss of the tab. **Unverified limit:** I did not reproduce a host-readiness failure; the impact occurs when one happens.

2. **P2 — A failed first acquisition can permanently pin an account without creating a tab.** [account-pool.cjs](/Users/alex/Dev/nekodex/launcher/electron/account-pool.cjs:283) writes conversation and task routing keys to `account-affinity.json` before capacity, readiness, and tab creation succeed. A failure in any of those steps removes the temporary trace owner (lines 296–300), but leaves the saved affinity. On retry, `chooseAccount` returns that pinned account before checking current eligibility or selected-account mode (lines 228–253), even though no conversation tab was established. Commit new affinity only after a successful lease, while preserving ownership for a tab that survives a failed response. **Confidence:** high in the persisted state and retry routing. **Unverified limit:** whether a particular failed acquisition is retried under a changed account selection depends on the calling workflow.

These are bugs in state transitions, not general isolation recommendations. The same-trace and retained-tab reuse guards in `BrowserHost.beginTurn` were checked before reporting them.



## 5. Hubble

Model: gpt-5.6-sol; effort: medium.
Agent: `01a0a565-fae2-7d21-ae19-1f4f20a747ac`.
Scope: Retry safety, duplicate sends and timeout cancellation: retry-policy.ts retry-continuation.ts pro-retry-hint.ts turn-execution.ts.
Status: completed; collected and closed.

### Reviewer 5/16 — retry, duplicate sends and cancellation

**One finding substantiated.**

| Severity | Type | Location | Confidence |
|---|---|---|---|
| P2 | Bug in the ownership guard | [turn-execution.ts](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/turn-execution.ts:926) | High for the code path; low for how often it occurs in production |

**Trigger and cause.** If a browser result has settled but its helper remains in physical cleanup for more than the 30-minute registry TTL, `prune()` removes the session because it checks `isActive()` and `lastUsedAt()`, but does not check `isPhysicallySettled()`. The removal creates no retirement promise. A later request for the same thread can therefore pass the owner checks in `getOrCreateAfterOwnerRetirement()` ([lines 644–652](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/turn-execution.ts:644)) and start another browser turn while the earlier helper still owns its surface. The ordinary retirement path does register an owner barrier ([line 953](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/turn-execution.ts:953)); pruning bypasses it.

**Minimal fix.** Keep a physically unsettled session during pruning, or remove it through `beginRetirement()` so the next turn waits for physical settlement. This does not imply that a duplicate send has been observed: the review establishes a missing serialization guard under the stated condition. I did not verify whether helper cleanup can exceed the TTL in a live failure.

I checked the supplied HEAD `5d80fecef2b3d591eeadc9d74bfb340ed5b46ca1`, the four scoped files, and their direct callers by manual read-only inspection. No tests, builds, launches, traffic, or edits were performed. No applicable repository `AGENTS.md` was present along the inspected path; the provided global instructions and `right-size-test-runs` were applied.



## 6. Planck

Model: gpt-5.6-sol; effort: medium.
Agent: `01a0a565-fcec-77b1-aaa5-ca00c01522ee`.
Scope: Compaction atomicity and recovery: compaction-transaction.ts compaction-continuation.ts compaction-handoff.ts rolling-checkpoint.ts.
Status: completed; collected and closed.

## Reviewer 6/16 — compaction atomicity and recovery

**One substantiated finding (bug, P2): a failed checkpoint load can leave the in-memory store marked as loaded.** At [rolling-checkpoint.ts:357](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/rolling-checkpoint.ts:357), `load()` sets `loaded = true` before parsing and validating the persisted file. If that file contains malformed JSON or an invalid record, the first load throws. A later request skips the file because `loaded` is already true and proceeds with an empty map; a subsequent successful `commit()` can then persist that map at [rolling-checkpoint.ts:375](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/rolling-checkpoint.ts:375), replacing checkpoint records that the process never loaded. The direct caller applies the store for Luna turns and commits a captured checkpoint when the browser answer completes ([index.ts:430](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/index.ts:430), [index.ts:476](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/index.ts:476)).

The minimal fix is to mark the store loaded only after the entire file has parsed and validated into a temporary map, then replace the live map. On failure, leave the prior state and file untouched so a later request cannot silently overwrite them. **Confidence: high** in the failure path; the review did not verify how often a persisted checkpoint file becomes invalid.

I found no other issue I could substantiate within the scoped files and their direct callers. This was read-only manual review at the specified HEAD; I ran no tests, builds, app launches, or traffic.

## 7. Herschel

Model: gpt-5.6-sol; effort: medium.
Agent: `01a0a565-fed7-77b2-942f-6ee9e8a9e520`.
Scope: Response parsing/stream protocol/tool call edge cases: src/responses/parser.ts schema.ts reasoning-envelope.ts.
Status: completed; collected and closed.

Manual, read-only review of commit `5d80fecef2b3d591eeadc9d74bfb340ed5b46ca1` found two actionable bugs. I inspected the three requested files and direct callers; I ran no tests, builds, app launches, or traffic. No repository `AGENTS.md` was found along the applicable path.

1. **P2 — Inline file content is lost during parsing.** [parser.ts:47](/Users/alex/Dev/nekodex/src/responses/parser.ts:47) converts every `input_file` block to a textual `[file: …]` reference using only `file_id` or `filename`. [schema.ts:18](/Users/alex/Dev/nekodex/src/responses/schema.ts:18) accepts `file_data`, including a block with `file_data` alone. Such a request parses successfully, then reaches the user or developer message with `[file: ?]` and none of the supplied file content. The minimal fix is to handle inline data as a supported file attachment, or reject that shape explicitly before routing instead of silently replacing it. **Confidence: high.** I did not verify an end-to-end inline-file request or whether a particular Codex client currently sends one.

2. **P2 — Redacted-only reasoning envelopes disappear on replay.** [parser.ts:429](/Users/alex/Dev/nekodex/src/responses/parser.ts:429) creates a thinking part only when it can derive nonempty text; an `ocxr1` envelope containing `red` but no `txt` or summary therefore leaves `pendingReasoning` empty. The direct bridge producer can emit precisely that shape: it collects redacted blocks, encodes them, and emits an envelope-only reasoning item when summaries are hidden ([bridge.ts:222](/Users/alex/Dev/nekodex/src/bridge.ts:222), [bridge.ts:234](/Users/alex/Dev/nekodex/src/bridge.ts:234)). Preserve the opaque redacted metadata in the parsed representation even when no readable thinking text exists, then ensure the replay consumer can carry it. **Confidence: high for the parser’s data loss; medium for its downstream effect.** I did not verify a provider turn with a redacted-only block, and the ChatGPT Web prompt conversion currently projects thinking parts to text alone.

No third finding met the evidence threshold.



## 8. Nash

Model: gpt-5.6-sol; effort: medium.
Agent: `01a0a565-fdb1-7111-a5ac-5efca0ebde7b`.
Scope: Response state and context lifecycle, retention: src/responses/state.ts compaction.ts and native-passthrough.ts.
Status: completed; collected and closed.

### Reviewer 8/16 — response state and context lifecycle

**One substantiated bug (P1, high confidence): Web → native continuation can lose the prior turn.** At [server.ts:486](/Users/alex/Dev/nekodex/src/server.ts:486), a request for a native model goes directly to passthrough before `expandPreviousResponseInput` runs at line 499. A completed Web turn receives a local `resp_*` ID and is recorded by [state.ts:224](/Users/alex/Dev/nekodex/src/responses/state.ts:224). If the next request supplies that ID as `previous_response_id` and only the new input, [native-passthrough.ts:264](/Users/alex/Dev/nekodex/src/native-passthrough.ts:264) forwards the unexpanded request when the new input contains no bridge artifact. The native backend cannot resolve the Web-owned ID. If the input does contain a bridge artifact, scrubbing removes the ID at line 138 but still forwards only the supplied input, losing the stored preceding context.

**Minimal fix:** Before native forwarding, distinguish locally stored Web response IDs from native IDs. For a local ID, restore its recorded input and output, scrub bridge artifacts from that complete history, and remove `previous_response_id`. Preserve the existing passthrough for native-owned IDs. The Web-route guard for unavailable local state at [server.ts:535](/Users/alex/Dev/nekodex/src/server.ts:535) does not cover this native route.

**Unverified limit:** This is a manual, read-only code finding. I did not run a request or verify which Codex clients send an ID-only delta immediately after a model switch. I found no other sufficiently supported finding in the scoped files. The requested passthrough file is located at `src/native-passthrough.ts` in this HEAD.



## 9. Sagan

Model: gpt-5.6-sol; effort: medium.
Agent: `01a0a566-0243-7341-aba5-f39983a67c2d`.
Scope: ChatGPT authentication/account isolation: src/chatgpt-session.ts browser-login.ts existing-chrome-login.ts passkey-login-control.ts and corresponding launcher code.
Status: completed; collected and closed.

## Reviewer 9/16 — ChatGPT authentication and account isolation

I found two actionable defects in the **managed-Chrome login path**. They do not apply to the launcher’s passkey and existing-Chrome imports, which use disposable transfer directories and filter captured state. This was a read-only review of HEAD `5d80fecef2b3d591eeadc9d74bfb340ed5b46ca1`; I ran no tests or application.

1. **Bug — P2: a failed login can leave an authenticated profile for the next attempt.** [browser-login.ts](/Users/alex/Dev/nekodex/src/browser-login.ts:409) always uses the same `login-profile` directory. Its cleanup at [line 465](/Users/alex/Dev/nekodex/src/browser-login.ts:465) runs only when `browserLoginStateExists(config)` is true. If verification fails before a valid state and marker are saved, that Chrome profile remains. A later attempt intended for another account can reopen the earlier account’s session; the composer and Temporary Chat checks at lines 443–450 establish an authenticated surface but do not compare account identity. Use a unique temporary profile for each attempt and remove that attempt’s profile after Chrome and Playwright have closed. **Confidence:** high in the reuse and cleanup path; whether Chrome restores a particular session cookie on retry is unverified.

2. **Bug — P2: managed-Chrome login saves cookies beyond the ChatGPT/OpenAI allowlist.** [browser-login.ts](/Users/alex/Dev/nekodex/src/browser-login.ts:451) captures the persistent context’s full storage state and writes it unchanged at line 454. The managed browser later loads that file at [browser-worker.ts](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/browser-worker.ts:2366) and writes full context state again at line 5264. If federated sign-in leaves identity-provider cookies or other origin storage in the dedicated profile, those values are retained in NEKODEX’s ChatGPT state file and replayed into its context. Apply the existing `sanitizeBrowserLoginStorageState` filter before both writes. **Confidence:** high in the unfiltered data flow; the presence of third-party cookies in any particular sign-in is unverified.

The launcher’s account partitions, primary-profile-only import guard, and post-import session probe did not substantiate an additional finding in this scope.



## 10. Boole

Model: gpt-5.6-sol; effort: medium.
Agent: `01a0a566-00b7-7100-9465-ef07124effac`.
Scope: Model catalog, effort selection, config validation: src/model-catalog.ts chatgpt-web-models.ts pro-model-config.ts adapters/chatgpt-web/model.ts effort-stabilization.ts.
Status: completed; collected and closed.

Отчёт reviewer 10/16 по HEAD `5d80fecef2b3d591eeadc9d74bfb340ed5b46ca1`: **подтверждённых находок нет**.

Вручную просмотрел пять заданных файлов и прямые вызовы выбора маршрута, передачи effort, сохранения Pro-настройки и управления слайдером. Подозрительные случаи проверил по защитным условиям: недоступные режимы отсекаются при выборе маршрута и в адаптере; значение effort выбранной строки каталога приводится к effort адаптера перед запросом; Pro-настройка читается для автоматического Pro-запроса. Оснований назвать эти места багами по статическому коду не нашёл.

Ограничение вывода: тесты, сборку, приложение и браузер не запускал; поведение при изменении интерфейса ChatGPT или ответа внешнего каталога остаётся непроверенным. Файлы не менял.



## 11. Kierkegaard

Model: gpt-5.6-sol; effort: medium.
Agent: `01a0a566-0183-7f41-8c33-d5fb774f9234`.
Scope: Setup and Codex route transaction consistency/recovery: src/setup.ts codex-integration*.ts route-diagnostics.ts.
Status: completed; collected and closed.

Manual review of HEAD `5d80fecef2b3d591eeadc9d74bfb340ed5b46ca1` found two actionable recovery bugs. I inspected the scoped route and setup code and the direct callers and guards needed to establish each trigger. I made no changes and ran no tests.

1. **P1 · Bug — an interrupted uninstall can leave route recovery unable to proceed.** [codex-integration.ts](/Users/alex/Dev/nekodex/src/codex-integration.ts:646) restores Codex config before deleting the primary and recovery journals at lines 651–652. If the process stops after the primary deletion but before the recovery deletion, the remaining recovery journal still describes the old installation. [readJournal](/Users/alex/Dev/nekodex/src/codex-integration-journal.ts:282) requires that sole recovery copy to match the restored config and throws when it does not. A later uninstall retry reaches that read first, so it cannot finish the cleanup. **Minimal fix:** record a durable uninstall intent or disconnected state that recovery can recognize before restoring config and removing the journals. **Confidence:** high from the write order and recovery guard. **Unverified:** no interruption was reproduced; filesystem behavior was assessed from code.

2. **P2 · Bug — setup can commit a new runtime config while route installation fails.** [setup.ts](/Users/alex/Dev/nekodex/src/setup.ts:574) saves terminal-owned config, and the launcher path saves it at line 614, before [installCodexIntegration](/Users/alex/Dev/nekodex/src/setup.ts:621). There is no setup-level compensation for a later route failure. One concrete trigger is an updated runtime hook command that already appears in another `hooks.json` entry: [preflightCodexIntegration](/Users/alex/Dev/nekodex/src/codex-integration.ts:325) returns early for a valid active v11 journal, while the actual JSON hook installer [rejects the duplicate](/Users/alex/Dev/nekodex/src/codex-interrupt-hook-json.ts:153). Setup then fails after saving the new runtime config, leaving the prior Codex route in place. **Minimal fix:** make preflight exercise the proposed route and hook replacement for active v11 journals, and compensate setup’s config and service changes if the final route commit fails. **Confidence:** high for the ordering and missing compensation; medium for how often this trigger occurs. **Unverified:** no update or failure was reproduced, and I did not assess live service state.



## 12. Nietzsche

Model: gpt-5.6-sol; effort: medium.
Agent: `01a0a565-ffc7-7d71-94da-0089ca8adc90`.
Scope: Runtime process start/stop/restart and orphan cleanup: src/process.ts service.ts launcher runtime process manager (discover).
Status: completed; collected and closed.

Manual review at `5d80fecef2b3d591eeadc9d74bfb340ed5b46ca1` found two actionable bugs in the runtime lifecycle. I read the applicable instructions and traced the direct shutdown callers. I made no changes and ran no tests or processes.

1. **P1 bug — Quit can succeed after forced shutdown leaves an owned runtime running.** At [main.cjs:1003](/Users/alex/Dev/nekodex/launcher/electron/main.cjs:1003), `requestQuit()` awaits `shutdown({ force: true })` but does not inspect its result. [runtime-supervisor.cjs:2080](/Users/alex/Dev/nekodex/launcher/electron/runtime-supervisor.cjs:2080) records tunnel or daemon stop failures and returns `forced-partial`; the caller then commits app exit at line 1009. Trigger: a graceful stop fails and the fallback also cannot confirm the tunnel stopped or cannot terminate the daemon. The launcher exits while its state file records a failure and an owned process may remain. **Minimal fix:** treat `forced-partial` as a failed quit and surface its recorded failures; commit exit only after shutdown confirms completion. **Confidence:** high for the control-flow bug; whether a particular process survives depends on the stop failure. I did not reproduce it at runtime.

2. **P2 bug — Restart’s idle check omits detached compaction work.** [runtime-supervisor.cjs:1834](/Users/alex/Dev/nekodex/launcher/electron/runtime-supervisor.cjs:1834) accepts a drain when HTTP and browser counts reach zero, even if `active_compaction_runs` is positive. The daemon reports that count at [server.ts:910](/Users/alex/Dev/nekodex/src/server.ts:910) and refuses `/admin/shutdown` while it is positive at line 1069. Trigger: a detached compaction remains active during restart or setup stop. The supervisor can stop the tunnel before shutdown is refused, then must compensate by starting the tunnel again; the requested restart fails despite its nominal idle wait. **Minimal fix:** validate and wait for `active_compaction_runs === 0` in the supervisor’s drain loop, as the terminal-managed service already does. **Confidence:** high from the matching request and refusal paths; the duration and frequency of detached compaction were not verified.

The stale-owner recovery path checks the recorded owner and daemon PID before shutdown; I found no further substantiated finding within this scope.



## 13. Descartes

Model: gpt-5.6-sol; effort: medium.
Agent: `01a0a566-03a8-7ed0-b5fb-fc5761dc52a8`.
Scope: MCP tool bridge transport cancellation and trust boundaries: src/adapters/chatgpt-web/mcp-server.ts mcp-main.ts native-delegation.ts.
Status: completed; collected and closed.

## Reviewer 13/16 — MCP bridge cancellation and trust boundaries

**One actionable finding (bug, P2).** A cancellation of one MCP tool call revokes the shared turn binding and rejects other calls from the same turn. At [mcp-server.ts:572](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/mcp-server.ts:572), every failed broker invocation, including one aborted through its request signal, calls `release` for the binding. The broker reuses that binding across claims for the turn ([turn-broker.ts:1048](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/turn-broker.ts:1048)); `release` revokes the channel and rejects all pending invocations ([turn-broker.ts:1099](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/turn-broker.ts:1099), [turn-broker.ts:605](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/turn-broker.ts:605)).

**Trigger:** A turn issues two tool calls concurrently, then cancels one request. The other call can fail with a revoked binding even though its own request was not cancelled. **Minimal fix:** Track cancellation by invocation ID and retire only that invocation; reserve whole-turn revocation for an explicit turn-abandonment event. **Confidence:** High in the code path; the frequency of concurrent calls and per-request cancellation in the live transport is unverified. The whole-binding release is deliberate in the current code, so the parent should adjudicate whether that policy is intended for individual MCP cancellations.

I found no separately substantiated trust-boundary defect in `mcp-main.ts` or `native-delegation.ts`. This was a read-only manual review at `5d80fecef2b3d591eeadc9d74bfb340ed5b46ca1`; no tests or runtime traffic were used.



## 14. Hilbert

Model: gpt-5.6-sol; effort: medium.
Agent: `01a0a566-02f3-75c2-950f-c3f87881fe4d`.
Scope: Tunnel lifecycle, local service exposure/auth and recovery: src/tunnel.ts tunnel-service.ts and relevant launcher integration.
Status: completed; collected and closed.

## Reviewer 14/16 — tunnel lifecycle and local exposure

**One substantiated bug (P2): `tunnel key-import` stores a Manual mode key in the Automatic mode file.** At [src/cli.ts:423](/Users/alex/Dev/nekodex/src/cli.ts:423), the command loads the current configuration but calls `installRuntimeKeyBytes(key)` without an interaction mode. Its default is `"automatic"` at [src/tunnel.ts:176](/Users/alex/Dev/nekodex/src/tunnel.ts:176), which selects `tunnel-runtime-automatic.key`; Manual mode uses `tunnel-runtime-zero-risk.key` at [src/tunnel.ts:169](/Users/alex/Dev/nekodex/src/tunnel.ts:169).

The trigger is importing a replacement runtime key while the saved configuration is in Manual mode. The command reports success, but the active tunnel keeps reading its existing Manual mode key file, so the import cannot repair a missing or expired Manual key. The minimal fix is to load the configuration before the import and pass `config.browserInteractionMode` to both `installRuntimeKeyBytes` and `managedRuntimeKeyPath` in the success message. **Confidence: high.** This is a code-path finding; I did not execute the command or verify behavior against a live tunnel.

I found no further substantiated bug in the scoped lifecycle, service, launcher recovery, or local authentication paths. The review was read-only and manual at HEAD `5d80fecef2b3d591eeadc9d74bfb340ed5b46ca1`; it included direct callers and guards, with no tests, builds, launches, or traffic.



## 15. Averroes

Model: gpt-5.6-sol; effort: medium.
Agent: `01a0a566-04f7-7161-bf8e-d885887d4a12`.
Scope: Disk/state/log/diagnostic bounded retention and settings persistence: browser-diagnostic-retention.ts read-bounded-file.ts config.ts and launcher state persistence.
Status: completed; collected and closed.

Read-only manual review of NEKODEX at `5d80fecef2b3d591eeadc9d74bfb340ed5b46ca1` found two actionable retention issues. I checked the direct callers and guards before reporting them. No tests, builds, launches, traffic, edits, or mutations were performed.

1. **P2 bug — a stale diagnostic lease can prevent pruning after PID reuse.** [browser-diagnostic-retention.ts](/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/browser-diagnostic-retention.ts:18) treats a trace as active when *any* process has the PID saved in `.active.json`; the marker stores only the PID at line 50. If a browser helper crashes before `dispose()` releases its marker, and the OS later assigns that PID to another long-running process, pruning excludes the completed trace despite the completed-trace limit. The [processRunning guard](/Users/alex/Dev/nekodex/src/process.ts:9) establishes PID existence, not ownership. **Minimal fix:** record and verify a process identity that survives PID reuse, such as PID plus process start time, with a conservative fallback where that identity cannot be checked. **Confidence:** high in the causal path; the occurrence and duration depend on a crash, PID reuse, and a later prune. I did not reproduce it.

2. **P3 improvement — the process-stream error log has no size retention.** [logging.cjs](/Users/alex/Dev/nekodex/launcher/electron/logging.cjs:180) appends every guarded stdout/stderr stream error to its diagnostic file without a size check or rotation. [main.cjs](/Users/alex/Dev/nekodex/launcher/electron/main.cjs:96) installs that guard for `process-stream-errors.log`. Repeated stream errors can therefore grow this file indefinitely, while the separate `launcher.jsonl` logger rotates at 4 MiB. **Minimal fix:** apply a small byte cap and rotation to the stream-error sink. **Confidence:** high in the missing bound; actual disk impact requires repeated stream errors and was not measured.

The file descriptor reader’s byte guard and the launcher state’s atomic write path did not yield a further substantiated finding within this scope.



## 16. Mendel

Model: gpt-5.6-sol; effort: medium.
Agent: `01a0a566-0451-7a31-8a29-cbc2041d6be6`.
Scope: GitHub practices/tools research tied to actual backend dependencies and architecture: inspect package manifests and README, research primary upstream GitHub/docs; propose at most 3 justified improvements with tradeoffs, avoid library churn.
Status: completed; collected and closed.

Reviewed HEAD `5d80fecef2b3d591eeadc9d74bfb340ed5b46ca1` through the manifests, README, GitHub workflows, and their direct verification script. I found **no substantiated backend bug**. Two GitHub workflow improvements are justified:

1. **P2 · Improvement — Make PR verification proportional to the change.** [ci.yml](/Users/alex/Dev/nekodex/.github/workflows/ci.yml:56) runs `bun run verify` on every pull request. [verify.ts](/Users/alex/Dev/nekodex/scripts/verify.ts:20) expands that command into both dependency audits, both complete test sets, typechecks, builds, notices, and a runtime smoke check; CI then packages and smokes the app at [ci.yml](/Users/alex/Dev/nekodex/.github/workflows/ci.yml:57). **Trigger:** a narrow backend or documentation PR. **Effect:** the PR check still performs broad verification, contrary to the supplied standing limit, and makes review slower. **Minimal fix:** give PRs a focused check selected for the changed behavior; keep packaging and broader release checks behind a separately authorized release path. **Tradeoff:** a focused PR check covers fewer unrelated regressions, so release coverage must be managed deliberately. **Confidence:** high that the commands have this scope; whether repository administrators already handle the standing limit outside these files is unverified.

2. **P3 · Improvement — Configure restrained dependency update proposals.** The backend and launcher have separate pinned Bun lockfiles ([root package.json](/Users/alex/Dev/nekodex/package.json:56), [launcher package.json](/Users/alex/Dev/nekodex/launcher/package.json:1)), while `.github` has no Dependabot configuration. **Trigger:** an upstream fix for the MCP SDK, Playwright, Electron, or a transitive dependency. **Effect:** the repository has no configured GitHub mechanism to propose a reviewed lockfile update; the existing CI audits assess the current lockfiles but do not propose updates. **Minimal fix:** configure low-frequency Dependabot entries with `package-ecosystem: bun` for `/` and `/launcher`, cap open PRs, and review each update against the browser and MCP boundaries before merging. GitHub [documents support for text `bun.lock`](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories), which this repository uses. **Tradeoff:** update PRs consume maintainer time, and dependency changes can alter behavior despite a passing audit. **Confidence:** high on the missing configuration and documented Bun support; I did not verify repository settings or run an update proposal.

I did not recommend a dependency-review action: GitHub’s [dependency-graph file table](https://docs.github.com/en/code-security/reference/supply-chain-security/dependency-graph-supported-package-ecosystems) does not list Bun lockfiles, so coverage for this repository would need proof first. No tests, builds, traffic, edits, or other agents were used.



