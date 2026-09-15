# Independent blind review wave2 lane10 dev

- Repository: `/Users/alex/Dev/nekodex`
- Baseline: `9925453`
- Inspected source: `src/dev-chat/driver.ts`, `src/dev-chat/cli.ts`, `src/dev-chat/transport.ts`
- UTC review start: `2026-09-15T20:31:00Z`
- UTC review end: `2026-09-15T20:38:00Z`
- Source was unchanged. No tests, typechecks, scripts, runtime checks, commits, delegation, or source edits were performed.

## Findings

### 1. Malformed call-shaped Responses items can be accepted as a successful final answer

- Trigger: A Responses output item is call-shaped, such as `{type: "function_call", name: "exec_command", arguments: "{}"}` without a `call_id`, or `{type: "function_call", call_id: "c1"}` without a valid name, and the same response has `end_turn: true` (or otherwise contains no recognized call after filtering).
- Exact location: `src/dev-chat/driver.ts:229-251`, especially the early `if (typeof item.call_id !== "string") continue` at lines 232-234 and the type/name filters at lines 235-249; the result is then accepted by `send()` at lines 553-560.
- Consequence: The parser silently drops a protocol call instead of rejecting it. `send()` can persist the response as completed and return its text, so the requested tool operation is omitted while the turn appears successful. This violates the fail-closed parsing boundary and prevents any receipt from being linked to the originating call.
- Counterevidence: Recognized calls with a non-empty ID are checked for duplicates against retained input by `assertUniqueToolCallIds()` at lines 266-275, and normal recognized calls produce `call_id`-carrying receipts. That protection does not run for call-shaped records filtered out before `DevToolCall` creation.
- Smallest fix: In `toolCalls()`, detect `function_call` and `custom_tool_call` records before filtering; require a non-empty bounded `call_id`, valid declared shape/name, and supported input, then throw a parse error for malformed or unsupported call-shaped records instead of continuing.
- Confidence: High.

### 2. Broker startup can leak a partially initialized broker when `listen()` fails

- Trigger: `TurnBroker.forSocket(config.brokerSocketPath)` constructs a broker and `await broker.listen()` rejects after creating or partially acquiring startup resources (for example, a socket or listener setup fails during completion).
- Exact location: `src/dev-chat/transport.ts:43-45`. The cleanup closure is created only at lines 47-51, after the awaited `listen()` call has succeeded.
- Consequence: The rejected startup exits `startDevChatTransport()` without closing the broker. The CLI calls this function before its cleanup-owning `try` block at `src/dev-chat/cli.ts:520-526`, so the normal `finally` at lines 547-557 cannot recover that broker. A later invocation can see a stale socket/listener or the process can retain broker resources after a failed start.
- Counterevidence: Once `listen()` succeeds, the returned `close()` is idempotent and the CLI closes it in its `finally` block. If `listen()` is fully atomic and always self-cleans on every rejection, this specific leak would not occur; that behavior is not established by the inspected files.
- Smallest fix: Wrap `await broker.listen()` in `try/catch`, call `await broker.close()` on rejection, preserve the original startup error, and rethrow it. Keep the returned idempotent closure for the successful-start path.
- Confidence: High for the missing cleanup path; medium for an actual leaked OS resource on a given `listen()` failure because the broker implementation was outside the requested scope.

### 3. Ctrl-C does not cancel an in-flight interactive request

- Trigger: In interactive mode, press Ctrl-C while `executeMessage()` is awaiting `driver.send()` for a browser/Responses request.
- Exact location: `src/dev-chat/cli.ts:292-305`, specifically the `reader.on("SIGINT", () => reader.close())` handler at lines 294-295. `driver.send()` starts uncancellable awaits at `src/dev-chat/driver.ts:535-545`, and no abort signal is passed through the request path.
- Consequence: Closing the readline interface does not cancel the active `driver.send()` operation. The current request can continue to completion, and the CLI does not reach the interactive loop's `finally` cleanup until that request returns. This contradicts the interactive help text at `src/dev-chat/cli.ts:292-293` (“Ctrl-C or Ctrl-D exits”) for the in-flight case and can leave the user unable to stop a long request promptly.
- Counterevidence: Ctrl-C at the input prompt causes the pending `reader.question()` to reject and the loop then exits; `finally` closes the reader. The issue is limited to the active-message path, where the handler only closes readline and no request cancellation is wired.
- Smallest fix: Create an `AbortController` for each interactive message, abort it from the SIGINT handler, pass its signal through `executeMessage()` into `driver.send()` and the underlying request/adapter path, and let the existing outer `finally` perform cleanup after the aborted operation settles.
- Confidence: High.
