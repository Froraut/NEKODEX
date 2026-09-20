# Full-stack native/backend review — 2026-09-21

Baseline supplied by the coordinator: `d6f8733` on `main`, with a shared working tree. This lane
reviewed the current files rather than treating earlier reports as current source. Owned scope was
`src/server.ts`, `src/native-passthrough.ts`, `src/native-network.ts`,
`src/native-usage-telemetry.ts`, `src/http-body.ts`, `src/stall-timeout.ts`, and the focused native
regression file. Direct-caller reading was limited to the launcher background-runtime/proxy contract,
Hermes admission, and existing native lifecycle tests and review evidence.

No test, build, typecheck, verification script, application launch, process control, account access,
or network request was run. No branch, commit, or release operation was performed.

## Implemented findings

### 1. Authenticated native requests could be replayed across redirects and carry connection-local headers upstream

**Trigger → impact.** `forwardNativeCodexRequest()` used automatic redirect following for models,
Responses, compaction, and search. A 307/308 on a POST could therefore replay work, and a redirect
could receive account-scoped headers outside the exact endpoint selected by the bridge. Header
filtering removed the fixed hop-by-hop names but did not remove `Proxy-Connection` or arbitrary names
listed by the `Connection` header. Those connection-local fields could reach the official backend or
the local client.

**Fix.** Every native endpoint now uses `redirect: "manual"`; redirect responses remain visible to
the caller and no POST is replayed. Request and response filtering now also removes
`Proxy-Connection` and every header nominated by `Connection`, while preserving ordinary end-to-end
headers. The focused unrun case verifies both directions and the redirect mode.

**Evidence.** `src/native-passthrough.ts:26-37`, `:158-169`, `:613-620`;
`tests/full-review-native.test.ts:4-44`.

### 2. A validated background route was ignored when the launcher descriptor path itself was absent

**Trigger → impact.** `nativeNetworkBackgroundReady()` accepted a validated fallback route, including
the launcher's explicit `DIRECT` result, but `fetchNativeCodex()` used ambient direct fetch whenever
`CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR` had no path. The daemon could therefore report background
network readiness and then use a different route once detached. An invalid configured fallback was
also bypassed in that exact branch instead of failing closed.

**Fix.** When no descriptor path exists, native transport now uses the already validated last-known
background route if one exists, and surfaces a stored invalid-route error instead of silently changing
transport. A process with neither a descriptor nor any known/configured fallback retains the existing
standalone direct behavior. No upstream request is retried.

**Evidence.** `src/native-network.ts:82-107`; `tests/full-review-native.test.ts:67-116`.

### 3. Early local rejection could retain an unread request branch

**Trigger → impact.** Responses and compaction clone the incoming request before decoding so native
passthrough can preserve original bytes. If turn-identity validation rejected the decoded request,
the clone was abandoned without cancellation. Missing native authentication similarly failed before
reading an uploaded body, and unauthorized image uploads returned immediately. A request up to the
existing body budget could remain queued on the unused stream branch until garbage collection.

**Fix.** Identity-rejection exits cancel the unused native clone. Native passthrough cancels an unread
body before raising its authentication failure, and the image handler cancels an unauthorized upload.
The public status/error contracts are unchanged.

**Evidence.** `src/server.ts:500-528`, `:835-874`, `:461-475`;
`src/native-passthrough.ts:534-546`; `tests/full-review-native.test.ts:46-65`.

## Reviewed contracts preserved

- Native stream delivery remains demand-driven. Darwin/Linux use one direct reader pull per client
  pull; the Windows transform uses a zero readable high-water mark. Client abort and body cancellation
  reach the source reader, and turn ownership releases on EOF, error, abort, or cancellation.
- An upstream reset is hidden only after an exact SSE `data: [DONE]` line. A pre-terminator reset still
  fails the client stream. Native telemetry remains an isolated, bounded observer and preserves a
  recognized provider terminal outcome as intentionally documented.
- JSON bodies retain the 64 MiB encoded and 128 MiB decoded limits. Zstandard decoding enforces its
  output cap inside the decoder; unknown-length senders are cancelled at the encoded limit. Opaque
  image uploads retain the existing 128 MiB limit.
- Interface detach closes Web admission and refuses while Web HTTP/browser/compaction owners remain;
  native streams remain admitted when the background route is ready. Full shutdown still requires a
  drained runtime with no active HTTP, browser, or compaction owner, while signal shutdown revokes and
  waits for those owners before forcing the listener closed.
- Native/Web continuation ownership, bridge-artifact scrubbing, exact first-party model-version
  derivation, model catalog augmentation, and Web-only broker/tunnel admission remain unchanged.
- Native usage delivery remains a bounded best-effort side channel: 16 queued/scheduled events,
  stable event IDs across three retries, direct authenticated loopback delivery, and explicit drop
  warnings. It is not complete account-wide accounting and was not changed into a disk spool.
- The bridge stall timeout remains 300 seconds by default and clamps finite configuration to
  1–3,600 seconds; no defect justified changing that policy.

## Parent verification boundary

Three behavior-level regression cases were added to `tests/full-review-native.test.ts` and deliberately
not run in this lane. The parent can execute that file as the primary focused check, then select only
the existing native passthrough/background-network cases needed to diagnose a failure. No shared
type, localization, Electron-main, or other test-file delta is requested from the parent.

The parent's first focused run on Bun 1.4.0 passed the redirect/header and upload-cancellation cases.
The background-route case initially observed the test process's already initialized native-network
module, because the top-level passthrough import had captured environment before the fixture and Bun
reused it despite a query-string import. The fixture now runs in a clean Bun subprocess with its
environment established before the first import, matching daemon startup. This lane did not rerun it.

Live proxy/PAC behavior, real provider redirects, production credentials, installed-app shutdown,
and actual client disconnect timing remain unverified here. Those limits do not change the source
findings above; they define what the parent integration pass must establish before release claims.
