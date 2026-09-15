# NEKODEX mixed-model experiment review wave 3 — lane 10 (dev)

- Baseline: `9925453bd51e61c7b398abec12ec0da3aca3d3af`
- Review mode: manual source review only
- Repository: `/Users/alex/Dev/nekodex`
- Scope: `src/dev-chat/driver.ts`, `src/dev-chat/cli.ts`, `src/dev-chat/transport.ts`, with direct broker/gateway callers inspected as needed
- Source state: baseline source unchanged; existing untracked workspace artifacts were not modified
- Verification: no tests, typechecks, scripts, automated audit, runtime actions, commits, delegation, or source edits

The regression-prevention skill and the fast-verification policy were read before review. Findings below are based on source and direct caller tracing; confidence labels from review1/review2 were not used as evidence.

## Adjudication

### Review1 claim 1 — accepted

**Claim:** malformed call-shaped Responses output can be silently accepted as a completed turn.

**Evidence:** In `src/dev-chat/driver.ts:229-251`, `toolCalls()` skips every object whose `call_id` is not a string before it examines its call type. A call-shaped item such as `{type: "function_call", name: "exec_command"}` therefore produces no `DevToolCall`. In `send()` at `driver.ts:553-565`, an empty call list plus `end_turn === true` commits `workingInput`, saves state, and returns a successful result. The call-shaped record is retained by `historyOutput()`/the subsequent `workingInput.push(...output)` path without a receipt.

**Counterevidence and boundary:** This is narrower than the review wording suggests. A recognized call with a string name reaches `guardedDevEventEmitter()`; `validateDeclaredDevTool()` rejects an undeclared name, rejects non-object input for function tools, and requires string input for custom tools. The gateway’s freeform path explicitly carries raw string `input` through `execGatewayProgram()` in `src/adapters/chatgpt-web/mcp-server.ts:379-402`; requiring every tool input to be a JSON object would invent a contract. The demonstrated defect is the pre-guard silent filtering of call-shaped records missing a non-empty usable ID or required identifying fields.

**Adjudicated verdict:** accepted. The actionable root is fail-closed detection at the DEV response parsing boundary. The fix must preserve custom/freeform string input and must not change the public connector ABI or gateway names.

### Review2 claim 1 — accepted

It is the same root as Review1 claim 1. The cited early `call_id` filter and the successful `calls.length === 0` branch are present. Duplicate-ID protection at `driver.ts:266-275` only runs for calls that survived parsing, so it does not cover the filtered record.

**Adjudicated verdict:** accepted; merged into `L10-malformed-call-record`.

### Review1 claim 2 — accepted

**Claim:** failed broker startup can poison the broker registry and leave startup ownership/cleanup incomplete.

**Evidence:** `startDevChatTransport()` obtains the process-global `TurnBroker.forSocket()` instance at `src/dev-chat/transport.ts:43` and awaits `broker.listen()` before it creates and returns the only transport cleanup closure at lines 45-53. `TurnBroker.forSocket()` inserts the instance into `brokers` before startup at `src/adapters/chatgpt-web/turn-broker.ts:249-255`. `start()` stores the promise at line 748 and rejects it for a non-socket path at lines 784-790; the rejected promise is neither cleared nor removed from `brokers`. A later call with the same path receives the same broker and the same rejected promise. This is deterministic for the existing-regular-file trigger.

There is also a startup cleanup gap for listener setup: `listen()` assigns `this.server = server` at `turn-broker.ts:764-767`, then the server error handler rejects the start promise at line 767. The failed path has no transactional rollback before `startDevChatTransport()` can return ownership to the CLI. The CLI’s `finally` at `src/dev-chat/cli.ts:547-557` is therefore unavailable when transport startup itself rejects.

**Counterevidence and boundary:** `TurnBroker.close()` is idempotent enough for the successful path and removes the registry entry at `turn-broker.ts:728-744`; the CLI does call it after a successful transport start. The existing regular-file and another-process checks intentionally avoid unlinking an unowned path. The issue is that failed startup does not reach that cleanup, rather than a license to unlink any path after an ownership check fails. The exact OS-level outcome of every `server.listen` error depends on the event sequence, but the missing rollback and retained rejected registry entry are directly evidenced and have an actionable fix.

**Adjudicated verdict:** accepted. Merge with Review2 claim 2 as one transactional startup/rollback root.

### Review2 claim 2 — accepted

The transport-level missing `try/catch` around `await broker.listen()` is real, and the broker-level `server` assignment before the rejection-capable listen operation confirms why transport-only cleanup cannot cover it. The claim’s strongest wording (“a given failure always leaks an OS resource”) is not established for every interleaving, but the root remains actionable: failed startup must clear its registry/promise state and close only resources owned by that startup attempt, preserving the primary error.

**Adjudicated verdict:** accepted; merged into `L10-broker-startup-rollback`.

### Review2 claim 3 — accepted

**Claim:** Ctrl-C does not cancel an in-flight interactive request.

**Evidence:** `interactive()` installs `reader.on("SIGINT", () => reader.close())` at `src/dev-chat/cli.ts:292-299`. For an active message, the loop is awaiting `executeMessage()` at lines 303-306 or 321-325. `executeMessage()` calls `driver.send(state, message, emit)` without an abort signal at `cli.ts:279-289`; `DevChatDriver.send()` constructs a new `Request` and calls `responseRequest()` without a signal at `src/dev-chat/driver.ts:535-544`. Closing readline only breaks a pending question; it does not interrupt the already-running request. The outer cleanup cannot begin until that request settles.

**Counterevidence and boundary:** Ctrl-C at the prompt is handled because `reader.question()` rejects and the loop exits. The problem is limited to the active-message path. The server and ChatGPT adapter already have abort propagation primitives (`req.signal`, adapter `abortSignal`, and broker wait signals), so the gap is in the DEV CLI/driver path rather than an impossible cancellation guarantee. A focused fix would thread a per-message signal from interactive SIGINT through `executeMessage()`, `send()`, and the request boundary, while retaining normal cleanup after settlement.

**Adjudicated verdict:** accepted; root `L10-interactive-cancel`.

## Design-limit and rejected overreach

The FIFO check in `guardedDevEventEmitter()` (`src/dev-chat/cli.ts:164-180`) compares pending tool names, while `DevChatEvent.tool_call` has no call ID. That is a representability/observability limitation: it cannot independently prove exact call identity when same-named calls are reordered. In the current implementation, `send()` emits each call and its result synchronously, and both `simulatedReceipt()` and `toolOutput()` use the originating `call.callId`; no current mislinking was demonstrated. It is therefore a design-limit observation, not an additional actionable defect.

The proposed requirement that all gateway or custom inputs be JSON objects is rejected. The gateway explicitly distinguishes structured `arguments` from freeform string `input`, and the public freeform contract must remain intact. Likewise, a hypothetical broker race without a concrete ownership or cleanup gap would be rejected; the startup root above is retained because the rejected registry state and missing rollback are directly visible in source.

No additional defect beyond the three merged roots met the requested evidence threshold.

## Essential fixes

1. Fail closed at `toolCalls()` for call-shaped records with missing/empty/badly bounded IDs or required identifying fields, while preserving the declared custom/freeform string contract. Do not append malformed call-shaped records as successful history.
2. Make broker startup transactional: remove only the still-mapped failed instance, clear its rejected start state, and close/unlink only resources proven to belong to that startup attempt. Keep existing ownership checks and preserve the primary startup error.
3. Add an abort path for interactive active messages from SIGINT through `executeMessage()` and `DevChatDriver.send()` to `responseRequest()`, then let existing cleanup run after the aborted operation settles.

## Counts

- Numbered claims reviewed: 5
- Accepted claims: 5
- Rejected claims: 0
- Design-limit verdicts among numbered claims: 0
- Merged actionable roots: 3
- Additional defects: 0
