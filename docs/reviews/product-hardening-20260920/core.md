# Core runtime hardening

Date: 2026-09-20  
Branch: `codex/nekodex-product-hardening`  
Owner scope: non-launcher `src`, excluding `src/adapters/chatgpt-web/**` and `src/launcher-browser-host.ts`

## Core changes

### Async tool-operation connector contract

Core now persists `AppConfig.experimentalAsyncToolOperations` and propagates it as
`provider.chatgptWeb.experimentalAsyncToolOperations`. The field defaults to `false` and is valid
only in automatic Full mode. Synchronous configurations continue to use `Codex Native4` or
`Codex Native4 DEV`; Manual mode remains `Codex Zero Risk4`. The opt-in async schema uses the
separate exact identities `Codex Native5` and `Codex Native5 DEV`, preventing ChatGPT from reusing
Native4's cached synchronous MCP schema.

Setup accepts the mutually exclusive `--async-tool-operations` and
`--synchronous-tool-operations` flags. A toggle changes the exact connector identity, refreshes the
tunnel worker command, and returns `connectorVerificationReset: true` with the selected
`connectorName`; launcher/browser state must clear its connector proof on that signal or equivalent
config-name comparison. Setup never edits an installed configuration unless setup is actually run,
and an inconsistent field/name pairing fails closed instead of silently replacing a cached schema.

The tunnel MCP command includes `--async-tool-operations` only for a validated automatic Full
Native5 configuration. The browser-owned parser/server already consume that flag as
`asyncToolOperations`; core did not edit those files. Doctor reports the selected operation mode
and exact connector identity.

Exact production CLI lines are:

```text
Tool operations: asynchronous (experimental; connector "Codex Native5")
Tool operations: synchronous (connector "Codex Native4")
```

DEV prints the corresponding `Codex Native5 DEV` or `Codex Native4 DEV` identity. No active
production config was rewritten during implementation.

### Native request telemetry

Native `/responses` and `/responses/compact` passthrough now has a privacy-bounded streaming
observer. It reads exactly one upstream chunk per downstream pull, forwards the original bytes,
uses no tee, preserves cancellation and backpressure, and retains at most a 64 KiB SSE frame or
256 KiB JSON candidate for terminal metadata. Oversized or unrecognized payloads are not retained;
usage becomes `unreported` while recognized HTTP or SSE terminal state still supplies the outcome.
A recognized upstream terminal event is immutable for statistics: downstream cancellation or a
later delivery/connection error preserves that terminal outcome and any validated usage. Only a
pre-terminal cancellation is recorded as `aborted`; the original stream still receives its normal
cancel or error behavior.
SSE treats only explicit `response.completed`, `response.incomplete`, `response.failed`, or `error`
events as terminal. `response.created` and `response.in_progress` never become immutable terminal
state. For standalone JSON only, `status: queued` or `in_progress` is classified as incomplete at
EOF rather than as a false completion. The first recognized actual terminal is write-once.

One terminal event is queued per observed request with this schema:

```ts
{
  schemaVersion: 1;
  eventId: string;
  source: "native";
  endpoint: "responses" | "responses/compact";
  requestedModelId: string | null;
  reportedModelId: string | null;
  startedAt: string;
  durationMs: number;
  outcome: "completed" | "incomplete" | "failed" | "aborted";
  httpStatus: number;
  failureCategory:
    | "http-auth" | "http-rate-limit" | "http-client" | "http-server"
    | "transport" | "stream" | "protocol" | "aborted" | null;
  usageStatus: "reported" | "unreported";
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cachedInputTokens?: number;
    reasoningOutputTokens?: number;
  } | null;
}
```

Model IDs pass a strict 128-character allowlist. Usage is accepted only as finite nonnegative safe
integers with a coherent total, cached tokens no greater than input, and reasoning tokens no greater
than output; it is otherwise `null`, never fake zero. Model labels must be slash-separated
alphanumeric-leading identifiers, so URLs, absolute paths, traversal segments, queries, fragments,
and colon schemes are rejected. No request input, response
output, tool content, header, URL, request ID, account ID, or browser identity is collected.

`httpStatus` is the upstream status, or `0` when a transport failure or abort occurs before an HTTP
response exists.

Delivery uses a process-local queue capped at 16 and an unawaited authenticated POST to the launcher
control endpoint `/v1/usage/native`, with a one-second timeout, redirects disabled, and `proxy: ""`.
Delivery errors are swallowed and cannot affect the native stream or route. Electron UsageStore
remains the sole disk writer.

### Full-mode broker readiness was not part of health or admission

`src/server.ts` now tracks the existing `TurnBroker.listen()` promise as `starting`, `ready`, or `failed`. Full-mode health reports `broker_ready`, `broker_state`, and a bounded failure code. `accepting_turns` remains false until the broker is ready, and model, Responses, compaction, search, image, and Hermes turn admission returns a retryable 503 while the runtime is drained or the broker is unavailable. Drain/resume also preserves the broker gate.

`src/setup.ts` now requires `broker_ready: true` before accepting a full-mode daemon. `src/doctor.ts` reports a full-mode broker failure as an error instead of treating the Responses listener alone as ready. No TurnBroker API or adapter implementation changed.

### Doctor reported an installed but inactive Codex route as ready

`src/doctor.ts` now consumes the existing `inspectCodexIntegration().active` result. A reversible but disconnected integration is an error with an explicit restored-route explanation. The positive result now states that the NEKODEX route is both installed and active.

### Login verification markers were not bound to verified account state

`src/browser-login.ts` introduces version-2 verification markers containing the exact UTF-8 byte length and SHA-256 of a bounded, structurally valid browser storage-state document. Both state and marker reads are bounded. A changed, truncated, oversized, invalid, or mismatched state is no longer accepted as authenticated evidence.

Legacy version-1 authenticated markers are treated only as candidates for live reverification. Setup keeps the old storage-state file, performs the normal owned-browser capability inspection, and writes a version-2 marker only after that succeeds. Capture-only markers remain untrusted. The exported `writeBrowserLoginVerificationMarker` helper is the integration point for authenticated managed-browser state writers; the browser owner now calls it immediately after refreshing `storage-state.json`.

### Continuation state could exceed its advertised memory bound

`src/responses/state.ts` now measures serialized state in actual UTF-8 bytes, bounds snapshot reads, refuses one entry larger than the global 64 MiB budget, and permits eviction down to zero entries. Unserializable state is not treated as weightless. Count and byte-cap evictions create bounded one-hour tombstones.

`rememberResponseState` returns an explicit retention result. A later request for a known nonretained `previous_response_id` still receives the compatible HTTP 409 response, now with the specific `too-large`, `unserializable`, or `capacity` reason. The response format and successful continuation behavior are unchanged.

### Missing provider usage was serialized as measured zero usage

`src/bridge.ts` now emits `usage: null` when a completed or incomplete provider response has no usage report. Reported usage retains the existing Responses object shape. This preserves the client contract already used by in-progress response snapshots while preventing downstream statistics from treating unknown consumption as zero.

## Focused regression cases added or tightened

The parent owns execution. No test or build command was run here.

1. `legacy login evidence requires live reverification without deleting stored state` — version-1 evidence no longer authenticates the state and the existing state remains available for live upgrade.
2. `review: chunk-split oversized native terminal stays completed across early delivery cancellation` — a known terminal event split across chunks remains completed when its oversized data frame is skipped and the consumer cancels before `[DONE]`/EOF; usage stays unreported and delivered bytes retain downstream backpressure.

## Manual coverage

Implementation and caller review covered:

- `src/config.ts`, `src/types.ts`, `src/cli.ts`, `src/dev-chat/cli.ts`, `src/tunnel.ts`,
  and setup/Doctor connector identity consumers for the Native4/Native5 mode split;
- `src/native-passthrough.ts` and `src/native-usage-telemetry.ts` for bounded native stream
  observation, terminal classification, privacy filtering, and best-effort launcher delivery;
- `src/server.ts`, `src/setup.ts`, `src/doctor.ts`, and the existing TurnBroker public lifecycle;
- `src/browser-login.ts` plus setup, Doctor, CLI/import, and managed-browser persistence callers;
- `src/responses/state.ts`, native/Web continuation expansion, completed-response retention, and 409 compatibility;
- `src/bridge.ts` streaming and non-streaming completed/incomplete usage envelopes;
- focused cases in `tests/browser-login.test.ts` and `tests/backend-review-regressions.test.ts`.

No launcher source, adapter/browser implementation, account data, active route, service, tunnel, runtime process, or updater working tree was changed by this owner. No commit was created.

## Verification boundary

Only manual source/diff review and whitespace validation were performed. Per the shared-checkout instruction, the parent owns compilation and focused execution. The managed-Chrome marker integration, Native5 MCP parser/server seam, launcher verification reset, and authenticated native-usage receiver are present in the shared source and were reviewed only at their direct core-facing contracts.
