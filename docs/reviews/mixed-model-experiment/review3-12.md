# NEKODEX adjudication review 3, lane 12 (http)

- Baseline: `9925453bd51e61c7b398abec12ec0da3aca3d3af`
- Repository: `/Users/alex/Dev/nekodex`
- Review mode: manual source adjudication only; no source edits, tests, typechecks, automated audits, runtime actions, commits, or delegation
- Requested source focus: `src/server.ts`, `src/bridge.ts`, and direct callers/downstream guards needed to establish HTTP cancellation, bounded resources, retry ownership, and submission ownership
- Skills applied: `/Users/alex/Dev/nekodex/skills/nekodex-regression-prevention/SKILL.md` and `/Users/alex/.codex/skills/right-size-test-runs/SKILL.md`

## Adjudication

### Review1 claim 1 — accepted

**Verdict: accepted. Root: `L12-retry-handoff-cancel`. Severity: P1.**

`responseRequest()` creates the request-owned `AbortController` at `src/server.ts:625`, wires the HTTP signal at `src/server.ts:628-631`, and records a retry continuation at `src/server.ts:648-653` immediately after `queue.push(event)`. The queue insertion is not the client-visible SSE delivery boundary. `bridgeToResponsesSSE()` consumes the queue later, emits `response.failed` at `src/bridge.ts:653-668`, reports the terminal state, and only then invokes `onCancel` and returns the iterator at `src/bridge.ts:676-681`. Client cancellation reaches the same `onCancel` hook through `cancelStream()` at `src/bridge.ts:808-815`, which aborts the request and clears the iterator, but it does not revoke the handoff already stored in `retry-continuation.ts`.

The `!abort.signal.aborted` check is useful against cancellation observed before the callback, but it does not establish that the queued retryable event crossed the bridge's terminal delivery boundary. `rememberRetryableTurnFailure()` stores the handoff in process-local state, and `isAcceptedRetryContinuation()` can authenticate a later successor by the exact source hash. The downstream identity and hash guards therefore make the replay precise; they do not repair the missing cancellation/delivery ownership transition. `environment.ts` clears handoff state for a fresh current-turn instruction, but a later request carrying the prior source is exactly the retry continuation path that can consume this stale handoff.

The actionable gap is to bind creation to confirmed terminal processing and revoke a pending handoff when the request is cancelled before that processing. This is a real ownership defect, rather than the unavoidable fact that cancellation and an already-running callback can interleave.

### Review1 claim 2 — accepted, narrowed

**Verdict: accepted. Root: `L12-stream-queue-budget`. Severity: P2.**

`src/event-queue.ts` caps only `buffered.length` at 10,000. `src/server.ts:638-645` applies the 32 MiB and 100,000-event accounting only when `parsed.stream` is false, so the streaming path has no byte budget. The queue stores complete `AdapterEvent` objects, including raw text, tool arguments, and other payload fields. A slow reader can therefore leave up to 10,000 events retained while the size of each event remains unrestricted. This is a concrete memory bound gap even though the queue is count-bounded.

The smallest useful correction is a request-owned streaming byte budget in addition to the count limit, with failure and abort when either budget is exceeded. The budget must account for events retained in the queue and release accounting when an iterator removes them. The existing non-streaming budget and queue count limit are downstream guards, but neither bounds streaming payload bytes.

### Review2 claim 1 — accepted, merged with Review1 claim 2

**Verdict: accepted, narrowed. Root: `L12-stream-queue-budget`. Severity: P2.**

The report calls the post-cancel queue unbounded. That wording is rejected: `AsyncEventQueue` still throws after 10,000 buffered events, and `queue.fail()` closes the queue. The underlying defect is real and is the same root as Review1 claim 2. `cancelStream()` sets `closed`, invokes `onCancel`, and calls `returnIterator()` at `src/bridge.ts:808-815`; the server's `onCancel` aborts its controller. However, `deliverEvent()` checks only `eventDeliveryFailed` at `src/server.ts:635`, not `abort.signal.aborted`, so a non-cooperating producer callback can continue appending stale events until the count guard trips. During that window, event payload bytes remain unbounded, and cancellation does not immediately close the producer-facing queue.

The counterevidence matters for scope: normal adapters receive the abort signal and are expected to stop, `run()` closes the queue in `finally`, and the queue has a 10,000-event cap. Those guards lower frequency and prevent literal count infinity, but they do not establish cancellation ownership for callbacks that outlive `runTurn()` or a byte bound for the retained objects. The fix should include an abort check at the delivery boundary and a streaming byte budget; queue closure on cancellation may be added through the same ownership path.

### Review2 other requested areas — no separate numbered defect

The report's retry/submission conclusion is rejected as a zero-finding conclusion, because Review1 claim 1 is independently supported by the source. The report correctly identifies exact identity/source-hash checks and terminal cancellation paths, but those guards do not prove client delivery before the handoff is recorded. No separate submission ownership defect is added beyond the merged retry handoff root.

## Scope exclusions and direct-caller checks

`HttpTurnCounter.track()` propagates client aborts to the request controller and releases HTTP ownership after response/body settlement. `/v1/responses`, Hermes `/hermes/v1/responses`, and the in-process `responseRequest()` callers use that path; this does not alter the two findings above because the retry map and adapter event queue are owned inside `responseRequest()`.

The native passthrough no-deadline observation remains a design limitation: the source shows caller-signal propagation, but this lane does not establish a local timeout contract or a non-cooperative upstream implementation. It is not counted as a defect. No gateway envelope claim, UI-only state claim, hypothetical hardening, or known unavoidable non-atomic race was accepted.

## Accepted roots

1. `L12-retry-handoff-cancel` — defer retry handoff creation until the retryable terminal event is processed by the SSE bridge, and revoke it when cancellation wins before that point.
2. `L12-stream-queue-budget` — stop post-cancel delivery and bound streaming queue memory by payload bytes as well as event count.
