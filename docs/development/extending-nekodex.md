# Extending NEKODEX

Use this feature map with the maintained [architecture](../../ARCHITECTURE.md) and [module map](module-map.json). Start a feature at its domain boundary and keep its lifecycle owner in charge. Existing facade exports remain available to avoid forcing every caller to migrate at once.

## Where changes belong

| Change | Primary module | Keep separate |
| --- | --- | --- |
| Add an HTTP inference route | `src/server-route-policy.ts`, composed in `src/server.ts` | Stream settlement is in `http-turn-lifecycle.ts`; shutdown admission is in `server-admission.ts`. |
| Transform an incoming JSON request | `src/http-body.ts` | Rebuilt bytes need matching headers; native passthrough may intentionally preserve original wire bytes. |
| Add a Responses tool representation | `src/responses/tool-projection.ts` | Discovery announcements and callable tools must use the same availability policy; request ordering stays in `parser.ts`. |
| Change output encoding | `src/responses/output-policy.ts`, `json-output.ts`, `src/bridge.ts` | Share wire conventions; JSON projection never owns SSE backpressure, cancellation or terminal delivery. |
| Change continuation identity | `src/responses/continuation-scope.ts`, `continuation-owner.ts` | Derive and compare scope without importing persistence; `state.ts` remains the durable owner. |
| Change continuation serialization | `src/responses/state-snapshot.ts` | Live ownership, retention and write scheduling stay in `state.ts`. |
| Add a turn runtime capability | `src/adapters/chatgpt-web/turn-runtime.ts` | Adapter orchestration stays in `index.ts`; session replay is in `turn-session.ts`; cross-session retirement stays in `turn-execution.ts`. |
| Change response event delivery | `src/adapters/chatgpt-web/turn-round-delivery.ts` | Journal the whole event batch before observer delivery; reconnect must not submit another browser turn. |
| Extend the broker protocol | `src/adapters/chatgpt-web/turn-broker-protocol.ts` and `turn-broker-client.ts` | Authorization and turn transitions stay in `turn-broker.ts`; asynchronous result retention is in `turn-broker-owned-operations.ts`. |
| Change the Unix broker endpoint lifecycle | `src/adapters/chatgpt-web/turn-broker.ts` | Bind a private listener and publish its hard-linked public endpoint. Check inode ownership on cleanup; never move a replacement runtime's live socket to protect an old close. Verify reachability before and after that close. |
| Add a Web tool | `src/adapters/chatgpt-web/mcp-tool-routing.ts` and `mcp-native-tools.ts` | MCP binding acquisition, cancellation and settlement stay in `mcp-server.ts`. A valid schema is not an authority grant. |
| Support another environment envelope | `src/adapters/chatgpt-web/environment-envelope.ts` | Message provenance stays in `environment.ts`; ordered authority resolution is in `thread-environment-resolver.ts`. |
| Change picker/model behavior | `src/adapters/chatgpt-web/browser-model-selection.ts` | Durable send activation and browser/page ownership stay in `browser-worker.ts`. Pre-send verification must not repair or clear a prepared draft. |
| Add a named Web model or selectable effort | `src/chatgpt-web-models.ts`, `src/model-catalog.ts`, `src/server.ts` | Keep saved fixed-mode identities and native model order. A grouped row requires identical context/compaction budgets; explicit family proof belongs to browser selection, not an advertised name. |
| Change saved versus Temporary Chat policy | `src/config.ts`, `src/setup-policy.ts`, `launcher/electron/conversation-preferences.cjs` | Carry the default-off preference through provider/helper config. Synchronize only committed settings; release ready documents through the account pool and preserve running work. Keep fresh-per-turn independent. |
| Change response completion timing | `src/adapters/chatgpt-web/browser-response-policy.ts` | External progress suspends terminal grace windows; it does not grant an unlimited task deadline. |
| Change ChatGPT DOM selectors or extraction | `browser-submission-dom.ts`, `browser-response-dom.ts`, `browser-dom-revision.ts` | Submission history and bound-response caches retain their caller-owned identity. Browser send/rebind/timeout decisions remain in `browser-worker.ts`. |
| Change visible reasoning/commentary projection | `browser-visible-trace.ts` | Preserve append-only deltas and retained-byte bounds; DOM acquisition is separate. |
| Change connector personalization or cleanup | `browser-personalization.ts` | Mutating preflight owns its deadline and cleanup; failed persistent cleanup must remain distinguishable from ordinary cancellation. |
| Extend browser diagnostic evidence | `browser-diagnostics.ts` | Capture structure/counts by default, retain bounded private files, and keep screenshots explicitly opted in. Diagnostics do not own turn lifecycle. |
| Publish browser presentation changes | `launcher/electron/browser-state-publication.cjs`, composed in `account-pool.cjs` | Signal from pooled hosts without building discarded snapshots. Keep evidence retirement immediate and cancel queued publication on destruction. Main mode/setup changes must use pool publication to advance the observation revision. |
| Read account state in the renderer | `account-snapshot-controller.ts`, wrapped by `useAccountPoolSnapshot.ts` | A covering host revision can settle a notification race. Mutation/operation epochs still retire old reads; preserve unavailable-state guards and legacy fallback. |
| Merge browser state | `snapshot-observation.ts`, composed in `App.tsx` | Keep the newest same-source observation across startup snapshot/event races. A stamp is ordering metadata, never account authority. |
| Add an attachment representation | `src/adapters/chatgpt-web/attachment-payloads.ts` | File authorization stays in `src/responses/file-content.ts`; selected skills and image/document validation retain their distinct rules. |
| Change multipart transport or capacity | `prompt-multipart-contract.ts`, `browser-input-policy.ts` | Prompt compilation chooses content; stage/commit formatting and account/input capacity are separately testable contracts. |
| Add an output file format | `src/adapters/chatgpt-web/artifact-format.ts` | Verified storage is in `artifact-storage.ts`; transport and lease authority remain with acquisition/host owners. |
| Change compaction bookkeeping | `src/adapters/chatgpt-web/compaction-run-registry.ts` | Logical cancellation and physical settlement remain distinct; active-source delivery policy is in `active-compaction-source.ts`. |
| Change a rolling checkpoint | `rolling-checkpoint-format.ts` and `rolling-checkpoint-projection.ts` | `rolling-checkpoint.ts` owns persistence and publishes memory state only after a successful disk-backed commit. |
| Add a native endpoint/body rule | `src/native-request-preparation.ts` | Forwarding stays in `native-passthrough.ts`, byte-stream observation in `native-response-body.ts`, routing in `native-network.ts`. |
| Interpret Native SSE or JSON usage | `src/native-terminal-inspector.ts` | Bounded interpretation stops at `[DONE]`. An oversized terminal frame is read only from a bounded head (type, model) and tail (usage), revalidated like a parsed frame; `native-response-body.ts` owns byte delivery, cancellation and one telemetry receipt. Diagnostics cannot interrupt a completed stream. |
| Change native usage receipts | `src/usage/native-contract.ts` | Delivery and durable outbox ownership remain separate; provider-unknown tokens must not become zero. After a failed delivery only the retry timer drains the outbox, so requests do not rescan it. |
| Add a setup/configuration option | `src/setup-policy.ts` and `src/config-policy.ts` | Capture the original read snapshot before asynchronous work. `file-transactions.ts` owns publication/rollback receipts; setup owns side-effect order. |
| Interpret tunnel status or launch diagnostics | `src/tunnel-status.ts`, `launcher/electron/runtime-tunnel-policy.cjs` | Parsing/command policy does not own installation, credentials or runtime supervision. |
| Add a browser/account IPC method | `launcher/electron/ipc/browser-handlers.cjs` or `account-handlers.cjs` | Use the already-guarded registration callback. Authorization, lifecycle admission and application wiring remain in `main.cjs`. |
| Extend the helper output protocol | `src/adapters/chatgpt-web/browser-helper-protocol.ts` | Update the typed producer and runtime decoder together; unknown or malformed frames remain rejected. |
| Add a browser control operation | `src/launcher-browser-control.ts` | Descriptor authority is in `launcher-browser-descriptor.ts`; CDP attachment stays behind `launcher-browser-host.ts`. |
| Change account read/exclusive operations | `launcher/electron/account-operation-leases.cjs` | Account policy and admission remain in `account-pool.cjs`. |
| Change the cross-account browser snapshot | `launcher/electron/account-browser-snapshot.cjs` | Pure display projection consumes one full selected-host observation and tab-only rows for other hosts. Pool, hosts and ledgers retain ownership; do not cache session evidence. |
| Change browser turn ownership | `launcher/electron/browser-turn-lifecycle.cjs` | Keep one turn map and preserve durable ledger → removal → receipt ordering; Electron presentation stays in the host. |
| Change Manual prompt/confirmation/cancellation policy | `launcher/electron/browser-manual-turns.cjs` | The host supplies the existing tab/signal maps and explicit lifecycle/presentation ports. Native views and registry removal stay with their existing owners. |
| Change artifact transfer ownership | `launcher/electron/browser-artifact-transfers.cjs` | The network download guard owns writes; transfer leases must revalidate exact tab and lease ownership after awaiting completion. |
| Change update preparation | `launcher/electron/update-staging.cjs` | Before staging returns it owns cleanup; the controller owns handoff after return. Hashing is abortable; uncertain extractor exit preserves staging. |
| Select an update release | `launcher/electron/update-release-policy.cjs` | Preserve packaged repository, channel and platform checks. Download, signature validation and installation stay separate. |
| Read child process logs | `launcher/electron/runtime-output.cjs` | Preserve split UTF-8, bound each line and keep raw capture limits independent. Process ownership stays with the caller. |
| Extend runtime validation | `launcher/electron/runtime-config-contract.cjs` | Setup compatibility and permission to start a runtime are separate entry points. |
| Extend an application screen | `launcher/src/Onboarding.tsx`, `ActivitySurface.tsx`, `SetupSurface.tsx`, `McpSurface.tsx`, `SettingsSurface.tsx`, `BrowserSurface.tsx` | `App.tsx` owns navigation, shared snapshots and native browser placement. `BrowserSurface.tsx` owns browser controls; `ManualTurnGuide.tsx` owns prompt presentation and its countdown. |
| Add account UI actions | `useAccountPoolSnapshot.ts`, `useAccountCodexLogin.ts` | Preserve captured account/flow identity and invalidate older reads when applying a mutation receipt. |
| Add a screen loaded on navigation | `deferred-surface.tsx`, composed in `App.tsx` | Keep startup/IPC ownership in App, loading/error recovery local to the feature, and shared labels outside the deferred module. A browser-cached failed module needs explicit reload. |
| Display live logs | `launcher-log-store.ts`, subscribed by Overview and Activity | Retain 300 ordered records with stable IDs, reconcile snapshot/events, batch presentation notifications and cancel unused timers. Do not route logs back through App state or delay task/error/lifecycle IPC. |
| Add a Task Center action | `task-center-model.ts`, `task-center-copy.ts`, `TaskActionConfirmation.tsx` | Backend capabilities authorize actions; phase labels alone do not. Task Center retains focus restoration. |
| Add or load a translation | `locale-catalog.ts`, `i18n-<language>.json`, `useLocaleCopy.ts` | English is the synchronous fallback; translated `copyFor` reads require `loadLanguage` first. Avoid eager runtime imports of all dictionaries; preserve complete keys/placeholders. |
| Save a language choice | `language-selection.ts`, Settings and Onboarding | Load before IPC and preserve the latest selection revision. Failure must not rewrite the saved language or erase dirty inputs; keep reload/fallback available. |
| Read task history by ID | `launcher/electron/browser-task-ledger.cjs` | Its index references the same records and updates after durable writes. Preserve failed-write, restart, dismissal and uncertain-submission semantics. |
| Add a usage report section | `useUsageReport.ts`, `UsageCalendar.tsx`, `launcher/electron/usage-report.cjs` | Query identity, report projection and durable storage remain separate. Reuse the filtered receipt set and one sort per duration summary; preserve unknown coverage. Log changes must not trigger usage recomputation. |
| Add synthetic DEV context | `src/dev-chat/context-fixtures.ts` | Named chat persistence remains in `session.ts`; generated content stays explicitly inert. |
| Exercise saved/temporary chats in DEV | `src/dev-chat/cli.ts`, `driver.ts`, `session.ts` | DEV setup persists `--saved-chats` or `--temporary-chats` in its isolated config. Keep the default model unchanged; every advertised DEV model must resolve through the shared route owner. |

## Working across boundaries

Prefer an explicit argument or small typed dependency to importing an orchestration module back into a leaf. Preserve public facade exports when a caller migration is unnecessary. Give one writer ownership of each coupled lifecycle area; additional feature modules should not create another registry for the same resource.

For asynchronous UI, bind results and failures to the account, query or flow that started the operation. A screen unmount is not permission to cancel a host operation. Preserve dirty input until the user restores saved values or a matching save receipt arrives.

Login mutation receipts retire older status reads and explicitly restart observation even when their flow/phase fields are unchanged. A failed start followed by an unavailable host snapshot leaves the login state unknown; recover that snapshot before allowing another start. Keep this recovery action reachable in the affected account card.

For persistent changes, use the snapshot that produced the candidate. A later reread is not evidence that the original candidate is still current. Keep a before-image distinct from a receipt proving that this operation published bytes. Failures must preserve a retry target and truthful saved-state reporting.

## Verifying an extension

Use the smallest behavioral scenario that distinguishes the new contract from the old behavior. Exercise deferred completion, cancellation or write failure when those boundaries are affected; prove the fixture reaches the intended boundary before injecting the fault. Reuse unchanged checks, avoid source-text/count assertions, and keep one integrated build/UI owner.

The renderer preview in `launcher/scripts/ui-preview.cjs` serves the built renderer with synthetic IPC and no accounts or provider requests; its scenarios are listed at the top of the file. It does not establish live account, updater, provider or installed-app behavior.

The bounded `launcher/scripts/measure-ui-work.cjs` and
`measure-usage-projection.cjs <baseline-ref>` probes produce comparative evidence;
they are not default startup tasks or broad regression suites. Startup-only
size sampling uses `measure-ui-work.cjs --startup-only --language=ru`; it counts
all requested scripts, including the selected language chunk. Task probes are
`measure-task-history.cjs` (compiled UI, synthetic rows) and
`measure-task-lookup.cjs <baseline-ref>` (isolated valid synthetic journal).

`launcher/scripts/measure-browser-publication.cjs <baseline-ref>` compares actual
host/pool methods on an inert four-account history fixture. Its JSON byte count is
a serialization proxy, not Electron wire traffic.

Source publication, development verification, packaging and installed runtime are separate outcomes. This refactor does not change the release version or authorize a release.
