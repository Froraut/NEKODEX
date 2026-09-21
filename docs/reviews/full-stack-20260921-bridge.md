# Bridge lane review — 2026-09-21

Base inspected: `d6f8733` (`main` / merged PRs 13–15). This lane reviewed the current implementations under `src/responses/**` and `src/adapters/chatgpt-web/**`, with focused reads of the server/native call sites and existing bridge, compaction, broker, Native6, and retained-conversation tests needed to verify the contracts. No historical report was treated as source evidence. No production account, secret, browser session, live application, network endpoint, build, test, or verification script was used.

## Implemented findings

### Targeted cancellation did not reach several pre-send browser stages

- Trigger: a turn is explicitly cancelled or retired while the worker is acquiring a managed page, preparing Temporary Chat, selecting a model/effort, capturing a submission baseline, refreshing a stale connector catalog, or attaching files.
- Impact: the client-facing turn can already be cancelled while the physical worker continues until its local stage timeout. The leased surface remains owned and can delay the next turn. A managed page created after cancellation could also remain hidden and unowned.
- Evidence: `runBrowserTurn` combined `turn.abortSignal` only for multipart attachment/send, prompt attachment, final send, and response observation. The `browser_page`, `temporary_chat_preparation`, initial/final effort selection, baseline capture, connector refresh, and `file_attachment` paths used only a stage-local signal or no signal.
- Fix: `browser-worker.ts` now composes the stage and turn signals throughout those paths, preserves `AbortError` instead of reclassifying cancellation as login/model/file failure, and closes a managed page that materializes after cancellation won the acquisition race.

### Compaction cancellation could remain blocked on source capability registration

- Trigger: structured compaction is cancelled while the source session's broker token promise is still pending.
- Impact: the compaction owner remains inside `settleActiveCompactionSource` or `settleActiveZeroRiskCompactionSource`; cancellation cannot release that ownership until token registration eventually settles.
- Evidence: browser outcome and physical settlement used `withCompactionAbort`, but the preceding `await source.runtime.token` did not.
- Fix: both source-settlement paths now race token acquisition against the same compaction cancellation signal and invoke the existing source-cancellation cleanup.

### A submitted compaction capability could lose its retention deadline before consumption

- Trigger: the one-shot handoff is submitted before its waiter consumes it, then the caller disappears before calling `wait`.
- Impact: `submit` cleared the TTL while the transaction still remained in the map, leaving an orphan with no remaining expiry path.
- Evidence: `CompactionTransactionStore.submit` cleared `transaction.timer`; only `consume`, `abort`, or `close` could then remove the transaction.
- Fix: the original TTL remains armed until `consume`; `consume` now clears the timer when it removes the transaction. Normal submit-before-wait behavior and the public control ABI are unchanged.

### Retry budgets were time-limited but not count-limited

- Trigger: many distinct native turns encounter retryable browser failures within the 30-minute retry window.
- Impact: `ChatGptWebTurnRetryPolicy.entries` could grow with every distinct retry key until TTL pruning, unlike the other bounded replay and handoff registries.
- Evidence: the registry pruned by age only and had no maximum entry count.
- Fix: retry budgets now have a 4,096-entry hard cap with fail-closed admission. The pre-send lookup rejects an unseen key with non-retryable `chatgpt_retry_capacity` while the registry is full, and the failure recorder repeats that guard in case capacity changed during an in-flight attempt. No unexpired entry is evicted, so an existing or exhausted key cannot regain a fresh retry budget after unrelated traffic.

## Parent shared-file delta requested

The browser-worker acquisition race was traced separately for managed and launcher-owned pages:

- Managed page creation has no native abort signal. If cancellation wins before `pageForNewTurn` resolves, one late-result continuation closes the eventual page; `managedPage` is never assigned, so the outer finalizer cannot double-close it. If creation wins, the immediate abort check closes it before assignment or the normal finalizer closes it after assignment, never both.
- A launcher connection that resolves after `boundedLauncherOperation` has already aborted is closed by that function's `releaseLateResult` and is never returned to the worker. After a connection is returned, the worker either closes it before assigning `turnConnection` or assigns it and leaves closure to the finalizer.
- One double-close race remains inside shared [src/launcher-browser-host.ts](../../src/launcher-browser-host.ts), outside this lane's owned files. During `selectLauncherPage`, abort invokes `closeOnAbort`, while the resulting catch block also calls `browser.close()` without sharing a one-shot close promise.

Requested parent delta in `connectLauncherBrowserHost`: create one memoized close immediately after `browser` is acquired, then use it from both cleanup paths:

```ts
let closePromise: Promise<void> | undefined;
const closeBrowser = () => closePromise ??= browser.close().catch(() => {});
const closeOnAbort = () => { void closeBrowser(); };
// ...
} catch (error) {
  void closeBrowser();
  throw error;
}
```

Preserve late-connect cleanup in `boundedLauncherOperation`, and keep the abort listener removal in `finally`. This removes concurrent duplicate CDP disconnects without changing launcher ownership or the returned public contract.

## Focused regression cases added, not run in this lane

`tests/full-review-bridge.test.ts` contains two behavior-level cases:

1. targeted cancellation interrupts a pending browser-page acquisition and releases prepared prompt resources;
2. compaction cancellation returns while the source capability token is still pending and cancels the source exactly once.

Per lane instructions, these cases were not executed. The parent owns integrated targeted checks.

## Reviewed boundaries with no code change

- Response continuation ownership: provider namespace plus hashed native owner and optional account-routing key; owner mismatch/unavailability fails closed. The in-memory response graph remains bounded by count, TTL, delta depth, and reachable bytes, with a separately bounded restart snapshot.
- Parser/replay: compaction items, reasoning envelopes, tool-search replay, tool-result image handling, and previous-response replay provenance preserve the current explicit fail-closed paths.
- Native6 lifecycle: operation identity is deterministic per turn token and operation key; retry fingerprints prevent key reuse with changed arguments; terminal results require exact delivery acknowledgement; acknowledged guards remain until turn retirement; status projection excludes result payloads and delivery IDs. Running, discoverable, guarded, and retained-result state all have explicit count/byte/TTL bounds. The public Native6 tool names and schemas were not changed.
- Completion fencing: active MCP leases, queued/delivered invocations, running detached operations, and terminal unacknowledged operations block browser completion; acknowledgement advances the revision before commit.
- Turn ownership and replay: one logical owner excludes a competing browser surface, exact rounds journal output before observer emission, and retained conversation release stays attached until launcher acknowledgement.
- Helper IPC and diagnostics: input frames/queues, line readers, replay feeds, Markdown/text buffers, diagnostics traces, thread environments, Luna checkpoints, retry/compaction handoffs, and session registries have explicit limits or lifecycle cleanup appropriate to their ownership.

## Remaining verification boundary

This is a manual source review with unexecuted regression cases, as required. The parent should include the new focused test file and the affected TypeScript compilation surface in its integrated targeted checks. The one shared launcher-host cleanup delta requested above is the only parent-owned source change identified; no shared type, i18n, or main-process delta is needed.
