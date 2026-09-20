# Electron backend hardening

Scope owner: `launcher/electron` only, plus two focused regression cases. No renderer, runtime bundle,
packaging, installer, route, release, build or automatic write operation was performed by this lane.
The pre-existing `resumable-download.cjs` 100 ms progress publication edit remains integrated.

## Implemented behavior

- Quit and update now close versioned account-pool turn admission before shutdown. Existing or
  acquiring browser/manual turns cause a non-destructive refusal; native HTTP/compaction work is
  handled by the supervisor's atomic drain. Ordinary quit no longer requests `cancel-turns` and no
  longer falls through to forced cleanup. Any refused/failed quit reopens admission. Update holds the
  same gate across download preparation and quit, removing the prior check/start race.
- Default/primary accounts pass the same live authentication, capability and connector eligibility
  rules as additional accounts. `launcher:mcp-verify` now publishes connector evidence through the
  pool. On automatic/full startup, the primary account performs a non-smoke connector verification
  after fresh auth/capability inspection in the same evidence epoch. Manual mode does no startup DOM
  inspection.
- Update jobs persist both `parentPid` and exact `parentIdentity`. The detached worker waits only
  while that exact process identity remains live, so PID reuse cannot hold or authorize an update.
- Every remote browser surface uses one external-link broker. One visible native mouse/keyboard
  gesture authorizes one link. The broker consumes that gesture before bounded DNS resolution,
  rejects local/single-label/private/loopback/link-local destinations (including bracketed and
  IPv4-mapped IPv6), and logs only origin/context/error type. Existing allowlisted auth popups remain
  embedded and bypass the external broker exactly as before.
- Usage persistence is schema v3 with account attribution supplied only by `AccountBrowserPool`.
  Existing v1/v2 rows migrate to `accountId: "unknown"`, `modelVersionSource: "unknown"` and
  `messageKind: "unknown"`; original legacy bytes receive a versioned backup. Receipts remain private
  deduplication/observation state.
- Experimental async tool operations are an explicit automatic Full-mode transaction. The default
  remains synchronous `Codex Native4` / `Codex Native4 DEV`; opt-in selects `Codex Native5` /
  `Codex Native5 DEV`. Manual mode always passes the synchronous setup flag and remains
  `Codex Zero Risk4`; no ZeroRisk5 identity exists. The IPC transaction closes turn admission,
  requires idle browser/runtime ownership, uses the normal setup rollback path, verifies the saved
  boolean and connector identity, and invalidates account/setup evidence only after a real change.
  A no-op preserves existing proofs.

## Async tool operation UI contract

The preload exposes:

```ts
setAsyncToolOperations(enabled: boolean): Promise<LauncherState>
```

The persisted launcher field is `state.experimentalAsyncToolOperations`. It is valid only when the
runtime config is automatic Full mode. Browser-only and Manual requests fail with actionable setup
messages. The transaction invokes `--async-tool-operations` or `--synchronous-tool-operations`, and
production continues through route replacement/service restart while DEV uses its isolated setup.
`connectorName` and `connectorNames.automatic` in launcher snapshot reflect Native5 only after the
flag is persisted. Switching modes explicitly carries the synchronous flag into Manual mode.

## Browser owner contract

`POST /v1/turn/usage` keeps all existing fields and accepts these optional bounded fields:

```text
modelVersionSource: observed | pinned | unknown
messageKind: task | context_stage | compaction
```

Omission maps to `unknown`. The endpoint accepts no account identity; pool ownership of the live
trace supplies the stable local `accountId`.

`POST /v1/turn/end` accepts the browser lane's normalized source codes:

```text
rate_limit_exceeded | account_safety_stop | context_length_exceeded |
model_unavailable | tool_timeout | browser_failure | other
```

Storage maps these to the fixed aggregate UI allowlist:

```text
rate_limit | safety_stop | timeout | browser_failure | other | unknown
```

`tool_timeout` becomes `timeout`; context-size/model-unavailable currently become `other`. Raw error
messages and URLs are never saved in usage history.

## UI owner contract

The existing `usage(7 | 30 | 90)` call remains valid. IPC additionally accepts:

```ts
usage({ days: 1 | 7 | 30 | 90, accountId?: string | null })
```

The object rejects unknown keys, invalid ranges and unbounded account identifiers. The snapshot keeps
the legacy fields (`available`, `error`, `startedAt`, `lifetime`, `lifetimeGroups`,
`lifetimeUnclassified`, `recovered`, `backupAvailable`, `rows`) and adds:

```text
generatedAt, timeZone, period { startDay, endDay, days }, selectedAccountId
accounts [{ id, label, available }]
metrics {
  total, messageCount, completed, failed, cancelled, unrecorded,
  knownOutcomeTotal, knownOutcomeCompletionRate,
  observedRunCount,
  runCountCoverage { observedMessages, totalMessages, complete }
}
durations { observedSamples, medianMs, p95Ms }
failures [{ code, count }]
calendar [{ day, total, completed, failed, cancelled, unrecorded }]
```

`calendar` always contains the full selected local-calendar period, including zero days. Duration
quantiles include only valid retained accepted-to-outcome receipt observations; `observedSamples`
makes partial coverage explicit. `observedRunCount` is the count of unique hashed `(trace,
helperPid)` receipt owners: it measures observed browser executions/runs, not logical Codex tasks.
Retries or helper replacement can create another run. `runCountCoverage` reports retained receipt
coverage. No exact task count is published without a separate stable native task identity. Historical
unknown and deleted accounts are explicit and never guessed from labels.

CSV remains a renderer responsibility and must use aggregate snapshot fields only. It must not emit
receipt, trace, PID, owner hash, cookies, email or raw error data.

## Native Responses usage contract

The authenticated launcher control server accepts `POST /v1/usage/native` with the exact bounded
schema from `src/native-usage-telemetry.ts`:

```ts
{
  schemaVersion: 1;
  eventId: UUID;
  source: "native";
  endpoint: "responses" | "responses/compact";
  requestedModelId: string | null;
  reportedModelId: string | null;
  startedAt: ISODateString;
  durationMs: number;
  outcome: "completed" | "incomplete" | "failed" | "aborted";
  httpStatus: number;
  failureCategory: "http-auth" | "http-rate-limit" | "http-client" | "http-server"
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

Model labels require a leading alphanumeric character, are limited to 128 safe characters, and
reject `://`. HTTP status `0` is accepted only for pre-HTTP transport/abort outcomes. Required token
counts are bounded safe integers; cached input cannot exceed input and reasoning output cannot exceed
output. `usageStatus` must agree exactly with null/non-null `usage`.

The event UUID is immediately hashed for deduplication. Raw UUIDs, exact event timestamps, receipts,
headers, payloads and URLs never leave the private store. Native data is never attributed to a
ChatGPT browser account. Receipt retention is capped; daily/lifetime aggregates survive receipt
eviction. Excess model cardinality rolls into an explicit `unknown` model bucket without dropping
aggregate totals.

Usage queries now accept `source: "web" | "native"`; omission remains `web`. Native queries reject
`accountId` and return the same period/metrics/calendar/durations envelope, with separate
`incomplete`, `responseCount`, model/endpoint rows and token coverage. Required token totals are null
when no sample reported usage. Optional cached/reasoning totals are null until their own reported
sample counts are nonzero. UI should display incomplete separately from completed/failed/cancelled
and show token coverage as reported versus unreported samples.

The public token object is named `tokens`, matching the final renderer DTO and CSV exporter.

The core event and private persisted aggregate retain `reasoningOutputTokens`. Public native rows,
lifetime groups, calendar and top-level token usage expose the UI DTO names `reasoningTokens` and
`reasoningReportedSamples`, preventing a missing reasoning card while keeping storage compatible.
Duration `medianMs` is the conventional median and averages the middle pair for even samples
(`1000, 3000 -> 2000`). `p95Ms` remains nearest-rank.

## Focused cases added, not executed

`launcher/tests/electron-hardening-focused.test.cjs` contains exactly two cases:

1. A visible native gesture opens one public external URL while script-only, private DNS, loopback and
   mapped-private IPv6 paths remain blocked.
2. v2 usage migrates to explicit unknown attribution while a v3 account observation produces bounded
   duration, allowlisted failure, run/message coverage, account inventory and a full one-day calendar.

Per lane instruction, no test, build, typecheck, syntax command or runtime operation was run. Parent
owns the shared focused-verification budget and all packaging/delivery work.

## Final handoff

Electron source files owned and changed by this lane:

- `launcher/electron/account-pool.cjs`
- `launcher/electron/browser-host.cjs`
- `launcher/electron/connector-identity.cjs`
- `launcher/electron/control-server.cjs`
- `launcher/electron/external-links.cjs`
- `launcher/electron/main.cjs`
- `launcher/electron/preload.cjs`
- `launcher/electron/runtime.cjs`
- `launcher/electron/state.cjs`
- `launcher/electron/update.cjs`
- `launcher/electron/update-worker.cjs`
- `launcher/electron/upgrade-readiness.cjs`
- `launcher/electron/usage-store.cjs`

The pre-existing `launcher/electron/resumable-download.cjs` 100 ms progress edit was preserved and
integrated without rewriting its owner change.

Exactly two focused cases were added in `launcher/tests/electron-hardening-focused.test.cjs`:

1. `external-link broker consumes one visible native gesture and rejects local destinations`
2. `usage v3 migrates legacy attribution and aggregates account durations, failures, runs and zero days`

The second case includes the even-sample duration example `1000 ms, 3000 ms -> median 2000 ms`
while retaining nearest-rank `p95 = 3000 ms`.

Direct-caller manual review covered the Electron IPC/preload boundary, account-pool ownership,
browser-host remote surfaces, runtime setup/rollback and connector-name selection, core native
telemetry producer schema, UI usage query/DTO/CSV consumption, updater worker handoff, state/setup
identity persistence, and v1/v2/v3 usage migration.

Material limits for parent verification and delivery:

- No automated case, syntax check, typecheck, build, runtime launch, setup transaction, update,
  route change, install or packaging operation has run in this lane.
- Native telemetry delivery is intentionally best effort and process-local; a missing launcher,
  queue eviction or delivery timeout can omit that observation entirely without becoming a
  data-plane failure. `unreportedSamples` applies only to delivered events whose provider usage was
  unavailable.
- Native deduplication and duration quantiles cover retained receipts only. Daily and lifetime
  counters survive receipt eviction; public sample counts disclose partial coverage.
- Historical Web usage migrates to explicit unknown account/model provenance. Observed browser runs
  are not exact logical Codex task counts.
- External-link DNS checks are bounded and reject currently resolved private/local addresses, but
  the system browser owns subsequent navigation and redirects after handoff.
- Native5 requires a separately created and verified Native5 connector after opt-in. Native4 remains
  the default and ZeroRisk4 remains the Manual identity.
