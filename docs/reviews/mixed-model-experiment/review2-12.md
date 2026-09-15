# Independent blind review wave 2, lane 12

- Repository: `/Users/alex/Dev/nekodex`
- Baseline: `9925453bd51e61c7b398abec12ec0da3aca3d3af` (HEAD matched; no source diff in the inspected files)
- UTC start: `2026-09-15T20:35:36Z`
- UTC end: `2026-09-15T20:37:35Z`
- Review mode: source-only manual inspection; no tests, typechecks, scripts, runtime checks, commits, or delegation
- Requested regression-prevention skill: `/Users/alex/Dev/nekodex/skills/nekodex-regression-prevention/SKILL.md` was read and applied; the available `/Users/alex/.codex/skills/right-size-test-runs/SKILL.md` was also read and applied

## Inspected scope and paths

Inspected only:

- `/Users/alex/Dev/nekodex/src/server.ts`
  - `HttpTurnCounter.track`, `cancelAll`, and `beginCancelTurn`
  - `responseRequest`, including native passthrough, ChatGPT Web routing, streaming and non-streaming collection
  - HTTP request abort propagation, retryable failure recording, compaction entry path, direct endpoint callers, and shutdown/cancel handlers
- `/Users/alex/Dev/nekodex/src/bridge.ts`
  - `bridgeToResponsesSSE` stream startup, pull/push behavior, backpressure polling, iterator return, client cancellation, timeout, terminal/error handling, and batch response conversion

The review followed normal, alternate/native passthrough, error, cancellation, retry, submission/continuation ownership, shutdown, and direct in-process caller paths. No mixed-model experiment reports or historical findings were read.

## Finding 1 — canceled streaming request can retain unbounded adapter events

- **Trigger:** A streaming `/v1/responses` request is canceled by the HTTP client (or by `/admin/cancel-turn`, `/admin/cancel-turns`, or shutdown), while the adapter has a delayed producer, timer, process callback, or otherwise non-cooperative `runTurn` path that continues calling the supplied `deliverEvent` callback after its `abortSignal` is set. `bridgeToResponsesSSE.cancelStream` closes the response and invokes `onCancel`, which aborts the local controller, but `deliverEvent` does not check that controller before enqueueing.
- **Exact location:** `src/server.ts:635-647`, function `responseRequest`, local function `deliverEvent`; the streaming queue is created at `src/server.ts:627` as `new AsyncEventQueue<AdapterEvent>()`. The only event budget at `src/server.ts:638-644` is inside `if (!parsed.stream)`, so it does not apply to this path. Cancellation reaches this code through `src/server.ts:680-688` and `src/bridge.ts:808-816`.
- **Consequence:** After the client-visible stream has been canceled, each late adapter event is still appended to the queue. Because the streaming branch has no byte/count budget and the bridge has already stopped consuming after `cancelStream`, a sustained late producer can grow process memory until it stops or the process is terminated. The HTTP ownership counter may eventually release when the adapter returns, but that does not bound the detached queue during the interval.
- **Counterevidence / boundary:** Normal adapters are passed `abortSignal` and are expected to stop promptly; the bridge also calls `returnIterator`, and the non-streaming branch has a 32 MiB/100,000-event budget. Those facts reduce frequency but do not close the reachable late-callback path: the source itself explicitly supports producer callbacks outside `runTurn`'s promise (`src/server.ts:655-657`) and currently guards only `eventDeliveryFailed`, not cancellation.
- **Smallest fix:** Make the first line of `deliverEvent` return when the request-owned controller is aborted, for example `if (eventDeliveryFailed || abort.signal.aborted) return;`. Keep the existing `queue.close()` in `run`'s `finally`; this prevents post-cancel queue growth while preserving normal retry recording before cancellation. If the adapter can emit indefinitely after abort, an explicit bounded queue or a cancellation-aware queue close would be a stronger follow-up, but is not required for the smallest fix.
- **Confidence:** High. The missing cancellation guard and the unbounded streaming queue are directly visible in the named files; the trigger is reachable through the documented late producer callback boundary and the existing HTTP cancellation paths.

## Other requested areas

No additional current, concrete defects met the requested bar in the inspected paths. In particular, retryable submission ownership is gated on a delivered retryable HTTP 503 and a non-aborted request at `src/server.ts:648-654`; terminal failures and cancellation do not create that handoff. The stream bridge returns the iterator and invokes the request abort hook on client cancellation and terminal paths, while `HttpTurnCounter` releases ownership on response completion, body cancellation, reader completion, and abort settlement.
