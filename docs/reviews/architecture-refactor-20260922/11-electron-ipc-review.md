# Lane 11 — Electron IPC and cross-process contracts

Baseline inspected: `53d17361f3e9c81910055a7e2c18759ffce458bc` in `/Users/alex/Dev/nekodex-refactor-20260922`.
Read-only source review. **No tests, builds, apps, providers, accounts or agents were run.** Only this report was written. Findings below are maintainability/extensibility improvements, not claims of newly reproduced runtime defects.

Reviewed the delivered-changes and integration sections of `docs/reviews/app-improvements-20260922.md`, `app-improvements-wave3-20260922.md`, and `app-improvements-waves4-5-20260922.md`. In particular, retained-conversation typed failures/no-work evidence, exact queue acknowledgement, cancellation, artifact completion ownership, and account proof invalidation are existing protections to preserve. Applied `right-size-test-runs` to the proposed verification only.

## 11-electron-ipc-F1 — Extract guarded browser/account IPC registration from application composition

**Priority:** medium; implement now as a bounded feature seam.

**Evidence:** `launcher/electron/main.cjs:902-1683` contains a roughly 780-line `registerIpc` mixing application snapshots, browser interaction, login orchestration, account operations, installation, settings, diagnostics and update transitions. The reusable security seam already exists at **902-909**: renderer authorization plus logging plus `lifecycleAdmission.guard`. Browser handlers at **984-1058** and account handlers at **1478-1532** are coherent groups embedded in this composition root. Adding an account operation currently requires editing the same large file as quit/update ownership.

The handlers are not interchangeable forwarding boilerplate. Examples: bounds use the sending renderer's zoom factor (**984-986**); file selection tests exact login-controller identity (**1040-1047**); authentication refresh remains an admitted mutation (**1479-1483**); proxy/login operations call `assertAccountMutable` (**1506-1515**); check failure invalidates global proof only if the account is still selected (**1517-1531**). Actual renderer callers in `launcher/src/App.tsx:933-978,1237,1582,1738` and the bridge/type declarations in `launcher/electron/preload.cjs:19-49,65-87` / `launcher/src/types.ts:494-525,550-568` confirm that these are active public operations.

**Concrete change:** introduce `launcher/electron/ipc/browser-handlers.cjs` and `account-handlers.cjs`, each exporting an explicit registration function accepting the **already guarded** `handle` callback and narrow dependencies/getters. Move these two groups, preserving channel strings, argument order, return values, ordering and validators. Keep Electron wiring, snapshot composition, quit/update/setup transactions and the authorization wrapper in main. Supply dialog/file-selection adapters and current-window/current-state access as closures; do not capture a replaceable window or mutable lifecycle flags at registration time. Never pass raw `ipcMain` to these modules. Preserve the event sender for bounds; keep window-control's separate authorized event path unchanged.

**Benefit:** new browser/account operations have a domain-local extension point without a competing IPC policy or another edit to lifecycle composition. This is a first extraction, not a mandate to mechanically split every handler.

**Write set:** new two registrar modules and one dedicated registrar test file. `main.cjs` is a **parent-owned shared integration file**: parent performs the removal and registration calls, or explicitly delegates sole ownership for this patch. No preload, renderer, types, browser-host or account-service behavior changes are needed. Coordinate account/login owners before moving their wiring.

**Smallest verification:** one fixture test of the actual registrar wired through the existing guarded registration helper: reject unauthorized sender before invoking dependencies; reject account refresh during lifecycle closure; preserve exact trace ID on close and selected-account proof behavior after awaited failure. Fake service boundaries only. Maximum **30 seconds** for that focused command; parent owns integrated Electron/UI checks. Avoid a snapshot listing every channel.

## 11-electron-ipc-F2 — Separate descriptor/CDP authority from control operations behind the existing facade

**Priority:** medium; implement now with one owner for the dependency split.

**Evidence:** `src/launcher-browser-host.ts` is 1,054 lines. It combines descriptor ownership and shape validation (**58-225**), bounded CDP attachment/page selection (**227-413**), authenticated session inspection (**414-483**), Manual control (**531-751**), automatic admission/progress/end (**753-911**), and artifact/release operations (**913-1054**). Control-only consumers consequently depend on a module that also imports Playwright and filesystem authority policy. `src/adapters/chatgpt-web/launcher-helper-client.ts:9,801` needs descriptor/control operations; `browser-worker.ts:4944-5008` consumes the automatic lease and typed failures before sending work.

Server comparison is essential: `launcher/electron/control-server.cjs:134-209,211-480` defines distinct operation contracts, while **482-505** preserves allowlisted typed failures. Client admission has its own same-mutation retry, 202 polling, exact-surface acknowledgement and cancellation reconciliation (**767-910**). Manual retries (**594-615**) and artifact registration retries (**968-989**) have different semantics. These are reasons to separate responsibilities, not to merge them into an indiscriminate retry wrapper.

**Concrete change:** extract leaf `src/launcher-browser-descriptor.ts` for descriptor types/read/validation and constants; `src/launcher-browser-control.ts` for HTTP operations and their protocol types; and a small error-types leaf for constructors shared by both. Leave CDP connection/page-selection functions in `launcher-browser-host.ts`, and re-export existing public symbols there so current consumers keep their imports and `instanceof` identity. Control imports descriptor/errors directly, never through the facade. Move functions without altering timeouts, descriptor reread points, wire fields, feature gates, receipt checks or error classes. No generic transport framework and no server rewrite in this patch.

**Benefit:** adding a control operation no longer entails editing descriptor/CDP ownership code; the actual leaf boundaries permit control-only dependencies and isolated protocol reasoning. No performance gain is claimed without measurement.

**Write set:** `src/launcher-browser-host.ts`, three new leaf modules, and only directly affected test imports if necessary. No control-server, browser-worker, queue or native-network source edits. Parent must assign this file exclusively and coordinate consumers with admission/native lanes; preserve their public contract rather than transplanting their policy.

**Smallest verification:** selected existing descriptor rejection and control cases: non-loopback rejection, missing-retained typed signal, Manual lost-response reconciliation, and queue cancellation/no-work propagation from its existing focused fixture. Use exact named cases, maximum **30 seconds per focused command**, no complete test-file battery. Parent owns one integrated typecheck after all owners settle.

## 11-electron-ipc-F3 — Make helper output a shared typed wire contract

**Priority:** medium; implement if parent assigns producer wiring to this owner.

**Evidence:** `src/adapters/chatgpt-web/launcher-helper-client.ts:54-219` owns the helper-output union and runtime decoder inside a 957-line process/turn lifecycle class file. Its receiver at **482-518** correctly rejects invalid frames and tracks exact child/turn cleanup. The producer, `src/adapters/chatgpt-web/browser-helper-main.ts:101`, accepts `unknown` in `writeProtocol`; event producers at **277-299** construct completion-fence and prompt-selection frames without compile-time agreement with the receiving union. Adding an event therefore requires coordinating separately authored literals, decoder branches and lifecycle dispatch. Existing unknown-message rejection is valuable; do not remove it.

**Concrete change:** create `src/adapters/chatgpt-web/browser-helper-protocol.ts` containing the output union and unchanged runtime parser. Import these in the client; type producer `writeProtocol(message: HelperOutputMessage)` and correct any actual mismatches rather than casting them away. Keep input-message parsing, child lifecycle, pending/unresolved ownership, feature negotiation, fences and callbacks in their current owners. This intentionally starts with one wire direction; do not grow a protocol framework or rewrite both state machines.

**Benefit:** the producer compiler checks event spelling and required fields against the same contract the client decodes; new events have one discoverable schema and fail closed at runtime.

**Write set:** new protocol module and `launcher-helper-client.ts`; **cross-lane producer wiring** in `browser-helper-main.ts:101` belongs to parent or its designated sole helper owner. Coordinate with browser-worker/compaction reviewers; no `browser-worker.ts` edits. This set is disjoint from F1/F2.

**Smallest verification:** a focused parser fixture covering a valid completion-fence event, malformed revision and unknown event, plus one existing helper-client invalid-protocol cleanup case selected by name. Maximum **30 seconds**; reuse unchanged lifecycle evidence. Parent's integrated typecheck checks producer literals.

## No-change conclusions and handoff

`application-menu.cjs` already separates menu construction from callbacks; `external-links.cjs` already provides a narrow broker with gesture consumption, ownership and bounded DNS checks. No worthwhile new extraction or confirmed defect is proposed there. The preload is an explicit allowlist and renderer `LauncherApi` is a useful facade: avoid dynamic arbitrary-channel invocation or a second registry merely to shorten it.

All three findings preserve behavior and require no product decision. Parent owns acceptance, shared-file allocation, integrated build/UI plan, Git and publication. This report is source evidence only; no tests were run.
