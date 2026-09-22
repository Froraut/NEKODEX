# Lane 01 — HTTP server and service boundaries

Baseline: `53d17361f3e9c81910055a7e2c18759ffce458bc` (HEAD confirmed). Read-only source review of `src/server.ts`, `src/http-body.ts`, `src/service.ts`, and `src/event-queue.ts`, with direct callers inspected. No tests, builds, applications, providers, accounts, or subagents were run. Only this report was written. Existing untracked node_modules entries were left alone.

Read the relevant Responses, Native, Compaction, Integration and Runtime sections of `app-improvements-20260922.md`, `app-improvements-wave3-20260922.md`, and `app-improvements-waves4-5-20260922.md`. In particular, pending SSE cancellation/retention, queue saturation delivery, incomplete-upload cancellation and detached compaction ownership already have source protections; these are preservation requirements, not new findings. Verification recommendations follow `right-size-test-runs`; they are proposals for the implementation wave, not executed evidence.

## 01-http-server-F1 — Rebuilt Web compaction body retains compressed-wire headers

**Priority:** P2, confirmed source defect.

**Locations:** `src/server.ts:833-845, 876-885, 899-908`; `src/http-body.ts:56-88`; consumer `src/server.ts:502-512`.

**Trigger/evidence:** Send valid zstd JSON to `/v1/responses/compact` selecting a supported Web model such as `chatgpt-web/high`. The first `readJsonRequestBody` correctly decompresses it. The Web branch then copies all incoming headers into a new Request, writes an ordinary `JSON.stringify` body, and invokes `responseRequest`. Its second body read still sees `Content-Encoding: zstd` and sends plain JSON into `zstdDecompress`, returning HTTP 400 before the adapter runs. Incoming `content-length` also describes the old representation. This is deterministic from the two reader call sites; runtime reproduction was deliberately not performed.

**Concrete change/benefit:** Introduce a small internal JSON-request construction helper in `http-body.ts`: copy the required semantic headers, remove obsolete encoding and length headers, set JSON content type, and retain the original abort signal. Use it at the compact-to-response boundary. Do not modify the native branch: that branch deliberately retains original bytes. `src/native-passthrough.ts:609-615` already removes encoding when rewriting a native body and is a useful consistency reference, not an additional write target.

This creates an explicit contract for future endpoints that transform a wire request into an internal request. Preserve canonical `x-codex-turn-metadata`, header/body authority precedence, Web admission, and summary validation. The DEV caller at `src/dev-chat/driver.ts:665-680` currently sends plain JSON, explaining why that path does not expose the defect. Hermes constructs fresh JSON headers (`src/hermes-integration.ts:139-141`), so it does not need a corrective edit.

**Write set:** `src/server.ts`, `src/http-body.ts`, dedicated `tests/server-compaction-http-body.test.ts`.

**Smallest verification:** A fake-adapter compaction case with zstd input, original content length, and turn metadata must reach the adapter once and produce the expected compact output. Pair with an identity-encoded case and a fake-upstream native case proving compressed bytes/encoding remain intact. Maximum 5 seconds per case, 20 seconds for the selected file; no real provider or browser.

## 01-http-server-F2 — Resume can reopen admission after shutdown has started

**Priority:** P1, confirmed state-transition defect; timing-dependent operational trigger.

**Locations:** `src/server.ts:1015-1033, 1182-1197, 1315-1330, 1449-1478`; compensation callers `src/service.ts:238-275` and `launcher/electron/runtime-supervisor.cjs:2647-2663, 2680-2719`.

**Trigger/evidence:** Shutdown sets `draining = true`, snapshots/cancels current HTTP turns, then waits for compaction, HTTP and worker/broker cleanup before stopping the listener. While those promises are pending the listener still accepts control requests. `/admin/resume` unconditionally sets `draining = false`; `acceptingNative()` checks only that flag, so a new native request can start after the cancellation snapshot. It can then be killed by `server.stop(true)` without having belonged to the shutdown cancellation set. Web admission can also reopen if its remaining readiness gates permit it.

This is reachable beyond a hypothetical hostile client: stale-owner recovery sends compensating resume after a graceful-shutdown/exit failure, and drain clients compensate after uncertain delivery. A second window exists between successful `/admin/shutdown` acknowledgement and the scheduled shutdown callback because no irreversible state is recorded before `setTimeout`.

**Concrete change/benefit:** Extract a small runtime admission state object (`running`, reversible `draining`, irreversible `shutting-down`) into `src/server-admission.ts`. Commit `shutting-down` synchronously when an idle shutdown is accepted, and synchronously at signal shutdown entry, before cancellation scans or awaits. Admission and broker-owner acceptance must derive from it. Resume can leave reversible drain, but must return an explicit non-success response once shutdown is committed. Keep cleanup settlement accounting and existing caller compensation for ordinary drain failures. Do not fake successful resume, force early cleanup, or introduce a new drain-token protocol in this lane.

**Write set:** `src/server.ts`, new `src/server-admission.ts`, dedicated `tests/server-shutdown-admission.test.ts`. `service.ts` needs no caller change for an HTTP rejection: its control helper already throws on non-OK responses.

**Smallest verification:** In an isolated loopback fixture hold one physical cleanup promise open, invoke only that server's shutdown handler, send authenticated resume, then attempt native work. Assert resume rejection, closed admission, zero new upstream invocations, and eventual listener stop after releasing cleanup. Also verify ordinary drain/resume still succeeds and the scheduled admin-shutdown state is immediately irreversible. Maximum 5 seconds per case, 20 seconds for this focused file. Parent coordinates any supervisor consumer check; launcher files are not this lane's write set.

## 01-http-server-F3 — Extract transport ownership and explicit endpoint policy from the composition root

**Priority:** P2 architecture improvement, independently worthwhile without a new bug.

**Locations:** `src/server.ts:70-355` (transport lifecycle/diagnostics), `950-990` (separate JSON path policy), `1077-1097, 1332-1446` (dispatch/admission/tracking). The module is 1,498 lines and also owns adapter execution and compaction.

**Evidence/cost:** Adding an inference endpoint requires separately remembering the media-type list, global Host/origin boundary, the right Native versus Web admission predicate, tracked endpoint name, abort propagation and identity binding. Responses and compact duplicate almost the same tracked dispatch/options wiring. Meanwhile approximately 286 lines of platform-specific stream ownership live alongside endpoint semantics. These are coherent existing responsibilities, not a reason to introduce a router framework.

**Concrete change/benefit:** Move `HttpTurnCounter`, identity/evidence types and its private diagnostics into `src/http-turn-lifecycle.ts`, retaining re-exports from `server.ts` for current tests/callers. Preserve Darwin/Linux direct pull, Windows demand-driven TransformStream, interruption tombstones, exactly-once release and diagnostic isolation unchanged. Introduce `src/server-route-policy.ts` with explicit method/path descriptors for public inference routes: media-type requirement, tracked endpoint and admission category. Derive JSON policy from those descriptors and use a narrow tracked-dispatch helper. Keep control/Hermes authorization explicit and before work; do not apply JSON restrictions to multipart image edits. Web routing must still recheck admission after body decoding, while native traffic remains independent of the broker/tunnel.

**Write set:** `src/server.ts`, new `src/http-turn-lifecycle.ts`, new `src/server-route-policy.ts`, dedicated `tests/server-route-policy.test.ts`. Preserve `responseRequest` and `compactRequest` exports for DEV and Hermes. No changes to adapter/bridge/native transport modules or `event-queue.ts` are justified by this extraction.

**Smallest verification:** Select existing lifecycle cases covering EOF, cancellation settlement and Windows backpressure, plus route cases for exact Host rejection before work, drain rejection, and native availability while Web is unavailable. Add only a missing observable contract case, not snapshots of the route table. Maximum 5 seconds per case and 30 seconds per selected command; parent reuses overlap with F2 rather than rerunning a whole lifecycle file.

## Ownership and integration

Assign F1–F3 to **one implementation owner** because all touch `server.ts`; sequence the transport extraction, lifecycle transition correction and request-header correction under that owner. The aggregate write set above is disjoint from other lanes if they treat `server.ts` as read-only and hand over any wiring requests. Native/Responses/Compaction lanes retain their domain modules; runtime-supervisor owns any launcher messaging adjustment for irreversible shutdown. Do not duplicate their findings or move their semantics during this extraction. Parent owns integration, development/UI verification, Git and publication. `service.ts` and `event-queue.ts` were reviewed but need no separate refactor just to fill a quota.
