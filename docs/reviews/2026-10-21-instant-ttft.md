# Instant time to first text

Goal from 2026-10-17: first text of an instant Web reply in under 5 s. This pass measures
where the time goes on the installed 6.1.32-nekodex.20, removes the avoidable waits that
are safe to remove, and records what bounds the rest.

## Method

- **Installed build, end to end.** `codex exec -m chatgpt-web/gpt-5.6-sol-instant` with
  effort `low`, a new ephemeral thread and the prompt "Reply with exactly one word: pong".
  A byte-for-byte TCP pass-through between Codex and the gateway (:17844) timestamps the
  request and the first `response.output_text.delta`. Stage times come from the turn's
  browser diagnostic checkpoints and the launcher log.
- **ChatGPT side.** A passive CDP session on the new turn tab only (Network events and a
  read-only DOM probe; no input, no emulation) timestamps the `f/conversation` POST, its
  response headers, the SSE events, the Stop control and the stream close.
- **Before/after without installing.** The same captured Codex request (95,753 prompt
  characters, about 32k tokens, tool-capable, saved chat with the connector) is compiled and
  run by the browser worker of either checkout against the live launcher, alternating base
  (`origin/main` 2d8ada3a, equal to the installed .20) and this branch. Times are from the
  start of the turn (the `/v1/turn/start` call), which corresponds to the gateway request
  minus about 0.1 s of request parsing and prompt preparation.

These are individual runs, not percentiles; ChatGPT's own latency varies by about ±1.5 s
between runs.

## Baseline: installed 6.1.32-nekodex.20

| Run | CLI start → request | Page acquired | Navigation done | Picker done | Prompt attached | Response visible | First text | Completed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 2.92 s | +1.22 | +2.87 | +4.06 | +4.97 | +5.92 | **+10.53** | +11.81 |
| 2 | 2.61 s | +0.70 | +2.69 | +3.83 | +4.71 | +5.50 | **+15.65** | +16.31 |
| 3 | 2.63 s | +0.72 | +2.17 | +3.32 | +4.20 | +5.06 | **+10.03** | +11.55 |
| 4 | 2.90 s | +0.71 | +2.95 | +3.98 | +4.86 | +5.74 | **+10.90** | +12.36 |
| 5 | 2.75 s | +0.74 | +2.96 | +4.10 | +5.05 | +5.87 | **+10.12** | +11.37 |

Columns after the first are seconds after the gateway request. The 13.6 s of 2026-10-17
was measured from CLI start; the comparable figure today is 12.8–13.6 s (18.3 s in run 2).

ChatGPT side of run 5 (CDP, seconds after the gateway request):

| Event | Time |
| --- | ---: |
| `f/conversation` POST | 5.41 |
| Response headers | 7.17 |
| Assistant text "pong" in the DOM | 8.18 |
| `message_stream_complete`; Stop hidden; the answer re-renders (same text, new HTML) | 8.76 |
| `[DONE]`, stream closed | 9.24 |
| First text delivered to Codex | 10.12 |

So for a one-paragraph reply the browser spent 0.88 s after the stream closed: the final
paragraph waited a fresh 750 ms after the completed-turn proof appeared, plus up to a
250 ms poll.

## Where the avoidable waits were

1. **Launcher admission poll (≈0.35 s every Web turn).** `/v1/turn/start` answers 202
   "queued" and admits the row in the background in about 100 ms, but the helper re-polled
   only after a fixed 500 ms. The lease arrived 0.53 s after the turn started.
2. **Final paragraph window (≈0.6 s on short replies).** The tail's 750 ms window restarted
   when the completed-turn proof first appeared, although the paragraph had usually been
   unchanged since ChatGPT finished streaming.
3. **Response poll granularity (up to 0.25 s per release).** The loop slept a flat 250 ms,
   so a due block or a stream close was noticed up to an interval late.

Other fixed or bounded waits, measured but **not changed** here:

- Connector mention: a 250 ms settle before typing, then `@codex` typed with a 25 ms
  per-key delay (about 0.3 s). Keyboard typing replaced `insertText` after missed mention
  menus; a miss costs a 2.5 s wait for the exact row. Needs a soak test before changing.
- Effort slider: a new chat opens at value 4, so Instant takes four ArrowLeft presses
  (about 0.3 s), then a 300 ms stability hold that guards against ChatGPT moving the slider.
- Pre-send verification reopens the picker (about 0.1 s); kept as the independent check.

## Changes

- `src/launcher-browser-control.ts`: a queued start is re-polled after 50, 100, 200 and
  400 ms, then every 500 ms. Admission semantics and the queue itself are unchanged.
- `src/adapters/chatgpt-web/markdown.ts`: a final block released only by the completed-turn
  proof (Stop hidden, completion actions visible, no Codex tool call in flight, this turn's
  stream closed) needs that proof to survive another observation (250 ms), and its content
  must have been unchanged for the full 750 ms counted from its last change. ChatGPT's
  completion re-render resets that window, so it still runs after the answer settles. Blocks
  bounded by a following block keep the whole window after the boundary. The completion
  tracker, broker fence, consistency and mutable-reference checks are unchanged.
- `src/adapters/chatgpt-web/browser-worker.ts`, `browser-page-guards.ts`,
  `browser-response-policy.ts`: the response loop observes again when a buffered block is
  due or the owned conversation stream opens or closes, never later than 250 ms and never
  sooner than 20 ms after the previous observation.

## After: same request, base and branch alternating

| Milestone (median of 6) | Base | Branch | Change |
| --- | ---: | ---: | ---: |
| Lease received | 0.53 s | 0.18 s | −0.35 s |
| Page acquired | 0.71 s | 0.33 s | −0.38 s |
| Send activated | 4.52 s | 4.13 s | −0.39 s |
| Stream closed → first text | 0.93 s | 0.36 s | −0.57 s |
| Turn start → first text | 10.51 s | 9.00 s | −1.51 s |

Per run, turn start → first text: base 10.75, 9.53, 10.43, 10.59, 13.17, 9.30 s; branch
11.99, 9.11, 10.03, 8.71, 8.90, 8.86 s. Stream close → first text: base 0.85–1.02 s;
branch 0.31–0.56 s. The part attributable to this change is about 0.95 s per new-thread
turn (0.39 s before Send plus 0.57 s after the stream closed); the rest of the median
difference is ChatGPT variance. Retained follow-up turns gain the admission and tail parts.

Two alternating pairs with a two-paragraph answer still delivered the first paragraph
before completion (first text 10.87/9.48 s base, 9.47/8.06 s branch). All 16 harness turns
completed with the expected text. Focused tests cover the poll schedule against a fake
control server, the tail timing (two cases fail on base), the boundary regression and the
stream-close wake-up.

## What bounds the latency

With this change a new-thread instant turn spends, from the gateway request:

| Part | Time | Owner |
| --- | ---: | --- |
| Admission, tab, CDP connection | 0.3–0.4 s | NEKODEX |
| New-chat page load to a ready composer | 1.4–2.2 s | ChatGPT page and network |
| Picker, connector, prompt, pre-send check | 2.0–2.2 s | NEKODEX UI automation |
| POST → assistant message complete | 2.8–3.7 s | ChatGPT server (≈2 s to headers for this prompt) |
| Message complete → Stop hidden → stream closed | 1.0–1.5 s | ChatGPT client |
| Stream closed → first text | 0.3–0.5 s | NEKODEX tail proof |

Codex itself adds 2.1 s before the gateway sees the request: with `service_tier = "ultrafast"`
and the built-in `openai` provider it first opens a WebSocket, receives 426 from the gateway
and retries HTTP only about 2 s later. Disabling every MCP server does not change this gap.
A provider entry with `supports_websockets = false` (as the local `codex-providers` entry
already has) should avoid it; that was not measured here.

Under 5 s from the gateway request is therefore not reachable by trimming waits: ChatGPT's
server and client account for 4–5 s on their own. The remaining levers are structural:

- A pre-loaded new-chat tab per account (launcher) would remove the 1.4–2.2 s page load,
  and with the connector and picker prepared ahead, most of the 2 s of automation.
- Reading this turn's SSE for the assistant message's own completion would release the tail
  about 1 s earlier than the Stop control and stream close allow.
- The 95k-character prompt drives the ≈2 s to response headers.

Each needs live validation with an installed launcher; none is part of this change.
