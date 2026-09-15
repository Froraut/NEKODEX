# NEKODEX mixed-model experiment review wave 1, lane 12 (http)

- Baseline: `9925453bd51e61c7b398abec12ec0da3aca3d3af`
- Review type: manual source review only
- UTC start: `2026-09-15T20:28:44Z`
- UTC end: `2026-09-15T20:31:54Z`
- Scope inspected: `src/server.ts` as the primary file; `src/bridge.ts`, `src/event-queue.ts`, `src/http-body.ts`, `src/native-passthrough.ts`, and `src/adapters/chatgpt-web/retry-continuation.ts` only for direct cancellation, queue, passthrough, and retry ownership paths.
- Explicitly not done: no source edits, tests, typechecks, scripts, live actions, commits, delegation, or reading of other wave reports.

## Findings

### 1. Retry handoff can survive a cancelled or never-delivered streamed failure

- **Severity:** High
- **Classification:** Current bug; retry/submission ownership race.
- **Exact location:** `src/server.ts:635-654`, `deliverEvent`; the call to `rememberRetryableTurnFailure` at lines 651-653.
- **Trigger:** Start a streaming `/v1/responses` request whose adapter emits an `error` event with `retryable === true` and `status === 503`. `deliverEvent` calls `queue.push(event)` and immediately records the retry handoff. Before `bridgeToResponsesSSE` consumes and emits that terminal event, cancel the HTTP response body or abort the request. The request aborts through the callback at `src/server.ts:688`, but the already-recorded handoff is not cleared.
- **Impact:** A later native turn in the same thread/model/effort scope can be accepted as a retry successor even though the prior retryable failure was never delivered to the client and the client may have explicitly cancelled the turn. That permits replay/submission of the prior user instruction without the required terminal-failure evidence at the client boundary. The check `!abort.signal.aborted` only observes the race point before cancellation; it does not bind the handoff to eventual delivery or cancellation settlement.
- **Smallest fix:** Move retry-handoff creation behind the bridge's terminal-event delivery boundary, using a dedicated callback that runs only when the retryable terminal event is actually processed, and clear the pending handoff when the stream is cancelled before that boundary. Keep the existing exact identity/source-hash checks in `retry-continuation.ts`.
- **Confidence:** High. The race follows directly from queue insertion and handoff recording being synchronous and ordered before stream consumption; no timing assumption beyond a client cancellation between those two operations is required.

### 2. Streaming adapter-event memory is bounded by count, not bytes

- **Severity:** Medium
- **Classification:** Current bounded-resource bug.
- **Exact location:** `src/server.ts:627` creates `new AsyncEventQueue<AdapterEvent>()`; `src/server.ts:638-645` applies the 32 MiB/100,000-event budget only when `parsed.stream` is false. The queue's count-only limit is `src/event-queue.ts:10-20`.
- **Trigger:** Send a streaming `/v1/responses` request and make the client read slowly or stop reading while the adapter emits 10,000 events whose fields contain large tool-input or raw-text payloads. Once the bridge's output backpressure stops consuming the queue, `AsyncEventQueue` retains up to 10,000 full event objects. The streaming path never applies the byte budget used by the non-streaming path.
- **Impact:** The process can retain memory proportional to `10,000 × event payload size` before the count limit trips. A single large-event stream can therefore consume substantially more memory than the intended non-streaming 32 MiB safety budget, causing avoidable process pressure or termination under a slow/disconnected client.
- **Smallest fix:** Give the streaming queue a byte budget as well as its event-count budget, charging each buffered event and releasing the charge when the async iterator removes it; fail and abort the turn when either limit is exceeded. The existing count limit can remain as a separate guard.
- **Confidence:** High. The queue stores the complete generic `AdapterEvent` objects and checks only `buffered.length`; the server's byte accounting is explicitly skipped for streaming.

## Design limitation, not counted as a bug

Native passthrough operations (`models`, `alpha/search`, and image endpoints) use the caller's abort signal but have no local operation deadline in `src/server.ts` or `src/native-passthrough.ts`. If the upstream fetch neither completes nor responds to cancellation, `HttpTurnCounter` can retain the HTTP turn until that external operation settles. This is a boundedness/reliability limitation visible in the current design, but I am not classifying it as a concrete bug because the intended timeout policy and upstream cancellation guarantees are outside this lane's source evidence.

## Zero-findings note

Not a zero-findings review. The two findings above are the strongest concrete current issues found in the permitted source scope. No additional speculative hardening or historical already-fixed claims are included.
