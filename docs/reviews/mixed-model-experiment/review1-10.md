# NEKODEX mixed-model experiment review wave 1 — lane 10 (dev)

- Baseline: `9925453bd51e61c7b398abec12ec0da3aca3d3af`
- Review mode: manual source review only
- UTC start: `2026-09-15T20:30:40Z`
- UTC end: `2026-09-15T20:32:16Z`

## Inspected scope

Primary files:

- `src/dev-chat/driver.ts`
- `src/dev-chat/cli.ts`
- `src/dev-chat/transport.ts`

Direct implementation inspected as needed for broker startup ownership and cleanup:

- `src/adapters/chatgpt-web/turn-broker.ts` (`TurnBroker.forSocket`, `listen`, `start`, and `close`)

Direct callers inspected:

- `src/dev-chat/cli.ts` call sites for `startDevChatTransport`, `DevChatDriver.send`, and `guardedDevEventEmitter`

The requested regression-prevention and right-sized verification skills were read first. No source edits, tests, typechecks, scripts, live actions, commits, delegation, or other wave reports were used.

## Findings

### 1. High — malformed call-shaped output is silently accepted as a successful turn

- Location: `src/dev-chat/driver.ts:229-251`, `toolCalls`; consumed by `DevChatDriver.send` at `:553-573`.
- Trigger: make the Responses envelope return `status: "completed"`, `end_turn: true`, and an output item shaped like `{ "type": "function_call", "name": "exec_command", "call_id": "" }` (optionally alongside an ordinary assistant message). `toolCalls()` skips it at `:234`, returns an empty call list, and `send()` treats the round as a final answer at `:556-565`.
- Impact: a call-shaped protocol record receives no simulated receipt, is not rejected, and is appended to `workingInput`/saved history. The turn can report success with missing or empty tool output, so exact call-to-receipt linkage is lost and malformed history is retained for later turns. The same silent filtering applies when `call_id` is absent or non-string. The parser also does not enforce a bounded ID.
- Smallest fix: make `toolCalls()` fail closed when an object is call-shaped (`type` is `function_call` or `custom_tool_call`) but lacks a non-empty bounded `call_id`, valid tool name, or valid input. Parse function arguments as the required JSON/object representation and reject malformed JSON instead of converting it to a string. Keep unknown/non-call output handling separate from malformed call handling.
- Confidence: high. The trigger follows directly from the current branch conditions; no external behavior is needed.
- Classification: bug, not a design limitation.

### 2. Medium — rejected broker startup leaves a poisoned broker registry entry and can strand startup resources

- Location: `src/dev-chat/transport.ts:43-44`, `startDevChatTransport`; `src/adapters/chatgpt-web/turn-broker.ts:250-255`, `TurnBroker.forSocket`; `:746-835`, `start`.
- Trigger: after the tunnel status check succeeds, make `config.brokerSocketPath` point to an existing regular file, or to a socket that fails the ownership/permission/probe checks. `startDevChatTransport()` obtains and registers a `TurnBroker` in the module-level `brokers` map before `await broker.listen()`. `TurnBroker.start()` rejects, but neither the transport nor `start()` removes the failed instance or resets its rejected `startPromise`. A later attempt with the same path returns the same instance from `forSocket()` and immediately reuses the rejected promise, even after the path has been repaired.
- Impact: one transient or recoverable startup failure can permanently poison that broker path for the process. For failures after `createServer()` has assigned `this.server`, the rejection path also has no centralized startup rollback; the broker is not returned to the CLI, so the normal `transport.close()` cleanup cannot run. This can leave a task-owned listener/socket or stale registry state behind.
- Smallest fix: make broker startup transactional: on a failed `start()` remove this instance from `brokers` only if it is still the mapped instance, clear `startPromise`, and close/unlink only resources proven to have been created by this start attempt. In `startDevChatTransport`, use a failure cleanup path only for broker resources owned by this invocation; do not unlink an existing socket that failed the ownership/probe check.
- Confidence: high for the poisoned registry entry; medium-high for partial-listener leakage because the exact failing `server.listen`/callback interleaving depends on the OS event sequence. The stale registry failure is deterministic for the regular-file trigger.
- Classification: bug, not a design limitation.

## Receipt-linkage design limitation (not counted as a bug)

`src/dev-chat/cli.ts:157-187` validates a result against `pendingNames.shift()`, so it proves only FIFO tool-name order. `DevChatEvent.tool_call` at `src/dev-chat/driver.ts:35` carries no call ID, and the guard therefore cannot directly verify that a receipt belongs to the exact originating call when two calls share a name or if an emitter reorders events. In the current path, `DevChatDriver.send` emits each `tool_call` and its `tool_result` synchronously in the same loop (`driver.ts:576-580`), and `simulatedReceipt` plus `toolOutput` use the actual `call.callId`; therefore this is a representability/observability limitation of the event contract, not a demonstrated current mislinking bug. The smallest future improvement would be to include `callId` in the event and compare it directly, while preserving the call ID already written into the receipt and Responses output.

## Conclusion

Two concrete current bugs were found: malformed call-shaped records can be silently accepted, and failed broker startup can poison the process-wide broker registry and bypass cleanup. No third concrete bug met the requested evidence threshold.
