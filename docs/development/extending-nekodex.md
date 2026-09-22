# Extending NEKODEX

This map describes the module boundaries introduced by the September 22, 2026 refactor. Start a feature at its domain boundary and keep its lifecycle owner in charge. Existing facade exports remain available to avoid forcing every caller to migrate at once.

## Where changes belong

| Change | Primary module | Keep separate |
| --- | --- | --- |
| Add an HTTP inference route | `src/server-route-policy.ts`, composed in `src/server.ts` | Stream settlement is in `http-turn-lifecycle.ts`; shutdown admission is in `server-admission.ts`. |
| Transform an incoming JSON request | `src/http-body.ts` | Rebuilt bytes need matching headers; native passthrough may intentionally preserve original wire bytes. |
| Add a Responses tool representation | `src/responses/tool-projection.ts` | Discovery announcements and callable tools must use the same availability policy; request ordering stays in `parser.ts`. |
| Change continuation serialization | `src/responses/state-snapshot.ts` | Live ownership, retention and write scheduling stay in `state.ts`. |
| Add a turn runtime capability | `src/adapters/chatgpt-web/turn-runtime.ts` | Adapter orchestration stays in `index.ts`; session replay is in `turn-session.ts`; cross-session retirement stays in `turn-execution.ts`. |
| Change response event delivery | `src/adapters/chatgpt-web/turn-round-delivery.ts` | Journal the whole event batch before observer delivery; reconnect must not submit another browser turn. |
| Extend the broker protocol | `src/adapters/chatgpt-web/turn-broker-protocol.ts` and `turn-broker-client.ts` | Authorization and turn transitions stay in `turn-broker.ts`; asynchronous result retention is in `turn-broker-owned-operations.ts`. |
| Add a Web tool | `src/adapters/chatgpt-web/mcp-tool-routing.ts` and `mcp-native-tools.ts` | MCP binding acquisition, cancellation and settlement stay in `mcp-server.ts`. A valid schema is not an authority grant. |
| Support another environment envelope | `src/adapters/chatgpt-web/environment-envelope.ts` | Message provenance stays in `environment.ts`; ordered authority resolution is in `thread-environment-resolver.ts`. |
| Change picker/model behavior | `src/adapters/chatgpt-web/browser-model-selection.ts` | Durable send activation and browser/page ownership stay in `browser-worker.ts`. Pre-send verification must not repair or clear a prepared draft. |
| Change response completion timing | `src/adapters/chatgpt-web/browser-response-policy.ts` | External progress suspends terminal grace windows; it does not grant an unlimited task deadline. |
| Add an attachment representation | `src/adapters/chatgpt-web/attachment-payloads.ts` | File authorization stays in `src/responses/file-content.ts`; selected skills and image/document validation retain their distinct rules. |
| Add an output file format | `src/adapters/chatgpt-web/artifact-format.ts` | Verified storage is in `artifact-storage.ts`; transport and lease authority remain with acquisition/host owners. |
| Change compaction bookkeeping | `src/adapters/chatgpt-web/compaction-run-registry.ts` | Logical cancellation and physical settlement remain distinct; active-source delivery policy is in `active-compaction-source.ts`. |
| Change a rolling checkpoint | `rolling-checkpoint-format.ts` and `rolling-checkpoint-projection.ts` | `rolling-checkpoint.ts` owns persistence and publishes memory state only after a successful disk-backed commit. |
| Add a native endpoint/body rule | `src/native-request-preparation.ts` | Forwarding stays in `native-passthrough.ts`, byte-stream observation in `native-response-body.ts`, routing in `native-network.ts`. |
| Change native usage receipts | `src/usage/native-contract.ts` | Delivery and durable outbox ownership remain separate; provider-unknown tokens must not become zero. |
| Add a setup/configuration option | `src/setup-policy.ts` and `src/config-policy.ts` | Capture the original read snapshot before asynchronous work. `file-transactions.ts` owns publication/rollback receipts; setup owns side-effect order. |
| Add a browser/account IPC method | `launcher/electron/ipc/browser-handlers.cjs` or `account-handlers.cjs` | Use the already-guarded registration callback. Authorization, lifecycle admission and application wiring remain in `main.cjs`. |
| Extend the helper output protocol | `src/adapters/chatgpt-web/browser-helper-protocol.ts` | Update the typed producer and runtime decoder together; unknown or malformed frames remain rejected. |
| Add a browser control operation | `src/launcher-browser-control.ts` | Descriptor authority is in `launcher-browser-descriptor.ts`; CDP attachment stays behind `launcher-browser-host.ts`. |
| Change account read/exclusive operations | `launcher/electron/account-operation-leases.cjs` | Account policy and admission remain in `account-pool.cjs`. |
| Change browser turn ownership | `launcher/electron/browser-turn-lifecycle.cjs` | Keep one turn map and preserve durable ledger → removal → receipt ordering; Electron presentation stays in the host. |
| Change update preparation | `launcher/electron/update-staging.cjs` | Before staging returns it owns cleanup; the controller owns handoff after return. Hashing is abortable; uncertain extractor exit preserves staging. |
| Extend runtime validation | `launcher/electron/runtime-config-contract.cjs` | Setup compatibility and permission to start a runtime are separate entry points. |
| Extend an application screen | `launcher/src/SetupSurface.tsx`, `McpSurface.tsx`, `SettingsSurface.tsx` | `App.tsx` owns navigation, shared snapshots and the native browser surface. |
| Add account UI actions | `useAccountPoolSnapshot.ts`, `useAccountCodexLogin.ts` | Preserve captured account/flow identity and invalidate older reads when applying a mutation receipt. |
| Add a Task Center action | `task-center-model.ts`, `task-center-copy.ts`, `TaskActionConfirmation.tsx` | Backend capabilities authorize actions; phase labels alone do not. Task Center retains focus restoration. |
| Add a usage report section | `useUsageReport.ts`, `UsageCalendar.tsx`, `launcher/electron/usage-report.cjs` | Query identity, report projection and durable storage remain separate. |

## Working across boundaries

Prefer an explicit argument or small typed dependency to importing an orchestration module back into a leaf. Preserve public facade exports when a caller migration is unnecessary. Give one writer ownership of each coupled lifecycle area; additional feature modules should not create another registry for the same resource.

For asynchronous UI, bind results and failures to the account, query or flow that started the operation. A screen unmount is not permission to cancel a host operation. Preserve dirty input until the user restores saved values or a matching save receipt arrives.

For persistent changes, use the snapshot that produced the candidate. A later reread is not evidence that the original candidate is still current. Keep a before-image distinct from a receipt proving that this operation published bytes. Failures must preserve a retry target and truthful saved-state reporting.

## Verifying an extension

Use the smallest behavioral scenario that distinguishes the new contract from the old behavior. Exercise deferred completion, cancellation or write failure when those boundaries are affected; prove the fixture reaches the intended boundary before injecting the fault. Reuse unchanged checks, avoid source-text/count assertions, and keep one integrated build/UI owner.

The renderer preview in `launcher/tests/fixtures/ui-preview.cjs` supplies synthetic IPC without accounts or provider requests. `launcher/tests/architecture-refactor-ui-preview.cjs` covers the changed safety/workspace/usage flows; existing focused previews cover navigation and task/Settings behavior. These fixtures do not establish live account, updater, provider or installed-app behavior.

Source publication, development verification, packaging and installed runtime are separate outcomes. This refactor does not change the release version or authorize a release.
