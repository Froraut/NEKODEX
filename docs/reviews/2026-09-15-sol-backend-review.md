# NEKODEX — 16 Sol backend review

Review baseline: `5d80fecef2b3d591eeadc9d74bfb340ed5b46ca1`.

Requested scope: bugs, inconsistencies, edge cases and justified backend improvements. All 16 reviewers use `gpt-5.6-sol`, medium reasoning. Read-only manual review; no tests, builds, app restarts or production traffic. Agent findings require parent adjudication; source inspection is not runtime reproduction.

## Dispatch ledger

- 1. Hume — `01a0a565-fa38-7652-a433-5eaba912b2f2` — HTTP admission, body bounds, disconnect/abort and streaming lifecycle: src/server.ts src/http-body.ts src/bridge.ts
- 2. Confucius — `01a0a565-f998-7570-a4db-69005b49c5ab` — Concurrency admission and queue fairness/leaks: src/adapters/chatgpt-web/concurrency.ts turn-broker.ts resource-budgets.ts and event-queue.ts
- 3. Volta — `01a0a565-fb9c-7422-80a5-6d663766f76e` — Browser worker request lifecycle and failures: browser-worker.ts browser-helper-main.ts launcher-helper-client.ts
- 4. Boyle — `01a0a565-fc45-7452-8641-5ab3eeeb6e73` — Electron native browser host tab allocation, session disposal, isolation: launcher/electron browser-host files (discover paths), src/launcher-browser-host.ts
- 5. Hubble — `01a0a565-fae2-7d21-ae19-1f4f20a747ac` — Retry safety, duplicate sends and timeout cancellation: retry-policy.ts retry-continuation.ts pro-retry-hint.ts turn-execution.ts
- 6. Planck — `01a0a565-fcec-77b1-aaa5-ca00c01522ee` — Compaction atomicity and recovery: compaction-transaction.ts compaction-continuation.ts compaction-handoff.ts rolling-checkpoint.ts
- 7. Herschel — `01a0a565-fed7-77b2-942f-6ee9e8a9e520` — Response parsing/stream protocol/tool call edge cases: src/responses/parser.ts schema.ts reasoning-envelope.ts
- 8. Nash — `01a0a565-fdb1-7111-a5ac-5efca0ebde7b` — Response state and context lifecycle, retention: src/responses/state.ts compaction.ts and native-passthrough.ts
- 9. Sagan — `01a0a566-0243-7341-aba5-f39983a67c2d` — ChatGPT authentication/account isolation: src/chatgpt-session.ts browser-login.ts existing-chrome-login.ts passkey-login-control.ts and corresponding launcher code
- 10. Boole — `01a0a566-00b7-7100-9465-ef07124effac` — Model catalog, effort selection, config validation: src/model-catalog.ts chatgpt-web-models.ts pro-model-config.ts adapters/chatgpt-web/model.ts effort-stabilization.ts
- 11. Kierkegaard — `01a0a566-0183-7f41-8c33-d5fb774f9234` — Setup and Codex route transaction consistency/recovery: src/setup.ts codex-integration*.ts route-diagnostics.ts
- 12. Nietzsche — `01a0a565-ffc7-7d71-94da-0089ca8adc90` — Runtime process start/stop/restart and orphan cleanup: src/process.ts service.ts launcher runtime process manager (discover)
- 13. Descartes — `01a0a566-03a8-7ed0-b5fb-fc5761dc52a8` — MCP tool bridge transport cancellation and trust boundaries: src/adapters/chatgpt-web/mcp-server.ts mcp-main.ts native-delegation.ts
- 14. Hilbert — `01a0a566-02f3-75c2-950f-c3f87881fe4d` — Tunnel lifecycle, local service exposure/auth and recovery: src/tunnel.ts tunnel-service.ts and relevant launcher integration
- 15. Averroes — `01a0a566-04f7-7161-bf8e-d885887d4a12` — Disk/state/log/diagnostic bounded retention and settings persistence: browser-diagnostic-retention.ts read-bounded-file.ts config.ts and launcher state persistence
- 16. Mendel — `01a0a566-0451-7a31-8a29-cbc2041d6be6` — GitHub practices/tools research tied to actual backend dependencies and architecture: inspect package manifests and README, research primary upstream GitHub/docs; propose at most 3 justified improvements with tradeoffs, avoid library churn

## Results

## Final collection and adjudication

**16/16 Sol reports completed, collected and agents closed.** No runtime source, dependency, installed application or account state changed. No tests, builds, benchmark traffic or application restarts were run. This is manual code review, not a claim that all defects were found or that the app now works flawlessly.

[Original reports](2026-09-15-sol-backend-reports.md) preserve every reviewer result, including no-finding outcomes. Parent inspected the cited implementation paths and distinguished deterministic control/data-flow problems from platform-dependent risks and deliberate policies. Priorities below are the parent's, not an automatic adoption of reviewer severities.

### Accepted source-level defects

“Accepted” means the triggering path is supported by source inspection; none was reproduced against a live account.

| ID | Priority | Location | Trigger and consequence | Minimal repair direction |
| --- | --- | --- | --- | --- |
| B01 | P1 | src/adapters/chatgpt-web/launcher-helper-client.ts:309 | Closing during helper startup clears readiness callbacks without settling their promise. Timer/exit guards ignore the detached child; a waiting run can hang. | Reject readiness before clearing callbacks; explicitly guard closed lifecycle and clean up startup ownership. |
| B02 | P2 | src/adapters/chatgpt-web/launcher-helper-client.ts:285; browser-helper-main.ts:213 | Automatic helper serialization/reconstruction drops accountRoutingKey supplied by the adapter. Intended thread account affinity cannot reach allocation. | Carry and validate the field across both sides of the helper protocol. Conversation-key affinity still exists; this is not proof every request chooses the wrong account. |
| B03 | P1 | src/responses/state.ts:224; src/server.ts:486; src/native-passthrough.ts:264 | A native request continuing a local Web response by ID and delta bypasses local history expansion. The native upstream cannot resolve a Web-owned ID; scrubbing can instead remove the ID without restoring history. | Resolve known local response state before native forwarding, scrub the expanded history and serialize the changed body. Preserve native-owned IDs and byte replay for unchanged native requests. |
| B04 | P2 | src/adapters/chatgpt-web/rolling-checkpoint.ts:357 | A malformed persisted checkpoint sets loaded=true before parsing fails. A later load skips the file and a later commit can overwrite unread records. | Parse and validate into temporary state; commit the loaded flag/map only after success. Preserve the failed file. |
| B05 | P2 | launcher/electron/runtime-supervisor.cjs:1834 | Drain accepts zero HTTP/browser turns despite active detached compaction. Subsequent shutdown refuses, potentially after tunnel stop. | Include validated active_compaction_runs in the idle contract and diagnostic. |
| B06 | P2 | src/cli.ts:423; src/tunnel.ts:169 | Manual-mode key-import writes the automatic-mode key path and reports success. | Load config first and pass interaction mode to both key installation and displayed path. The original report's first sentence incorrectly says configuration is already loaded; it is loaded below this branch. |
| B07 | P2 | launcher/electron/account-pool.cjs:290 | At capacity, a retained tab is evicted before host.ready succeeds. A readiness failure destroys an existing document without obtaining the replacement. | Check readiness before destructive reclamation; keep allocation/reservations coherent across the await. |
| B08 | P2 | launcher/electron/account-pool.cjs:283 | New affinity is persisted before capacity/readiness/lease success and remains after a failure that created no tab. Retry can be pinned to an account that never established a conversation. | Commit affinity on successful acquisition, or compensate only newly created bindings if no surviving owned tab exists. Do not migrate established conversations. |
| B09 | P2 | src/responses/parser.ts:47; schema.ts:18 | input_file.file_data is accepted but converted to a filename placeholder, silently losing inline content. | Explicitly reject unsupported inline files or implement a bounded supported attachment path. Do not imply the content reached ChatGPT. |
| B10 | P1 | src/codex-integration.ts:646; codex-integration-journal.ts:282 | Crash between primary/recovery journal deletion after config restoration leaves an active recovery journal incompatible with restored config. Retry cannot finish normally. | Persist a recognizable uninstall transaction/disconnected state before restoration and journal cleanup. This is a crash-window recovery defect, not observed current route corruption. |
| B11 | P2 | src/setup.ts:574,614,621; codex-integration.ts:325 | Runtime config/service changes precede final route installation. A duplicate proposed JSON hook can pass the active-v11 preflight shortcut and fail final installation, leaving partial setup state. | Preflight actual proposed hook/route changes and compensate setup-level changes on final commit failure. |
| B12 | P2 | src/browser-login.ts:409,465 | Managed-Chrome login reuses a fixed profile, removing it only after valid saved login state exists. Failed login can contaminate a later attempt with the previous session. | Use an attempt-owned temporary profile and guaranteed cleanup after all browser resources close. Applies to managed Chrome, not current launcher import paths. |

### Findings deliberately qualified or downgraded

- **Windows streaming (reviewer 1, P2 conditional):** server.ts:311 eagerly drains one tee branch while client delivery may stall on the other; the observer may also release lifecycle accounting before client consumption completes. The unbounded slow-branch risk matches [MDN's tee documentation](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream/tee). Parent accepts the stream-topology risk, but a Windows Bun-specific bounded delivery design needs a focused platform check before replacing this intentional compatibility workaround.
- **Long cleanup ownership (reviewer 5, P2 conditional):** turn-execution.ts:926 prunes inactive logical sessions without consulting physical settlement or establishing the normal retirement barrier. The problematic case requires physical cleanup to outlast the registry TTL (reported 30 minutes). Keep the barrier; do not report observed duplicate sends.
- **Redacted-only reasoning (reviewer 7, compatibility gap):** parser.ts:429 drops metadata when no readable thinking text exists, although bridge.ts can create such envelopes. Source loss is real; current Web consumer usefulness is unproven. Preserve opaque metadata only under a defined replay contract; this is not evidence of degraded answer quality.
- **Forced-partial quit (reviewer 12, P2 policy/observability):** main.cjs ignores the structured forced-partial shutdown result. This can conceal incomplete cleanup, but forced exit is intentionally best-effort and an external unkillable process cannot be solved by refusing Quit indefinitely. Surface incomplete cleanup, retain ownership evidence and define recoverable exit behavior. Do not adopt the reviewer's unconditional “never quit” fix.
- **MCP cancellation (reviewer 13, policy decision):** mcp-server.ts:572 deliberately revokes the whole turn binding after invocation transport failure. Concurrent siblings can fail; source explicitly treats the response as abandoned. Parent does not call this an unconditional bug. Per-invocation cancellation would need invocation identity, native-result disposal, and protection against late side effects before narrowing revocation.

### Backend robustness improvements

1. **Bound total non-streaming response accumulation** (server.ts:704). A bounded pending queue does not bound the drained events array. Prefer incremental aggregation of necessary final state; enforce a byte budget with explicit termination. Actual memory impact unmeasured.
2. **Bound completed activity tombstones safely** (turn-broker.ts:1077). A long manual turn can retain many IDs. Expiring IDs alone reopens delayed claims; pair retention with a bounded claim-delivery contract.
3. **Bound authenticated admin JSON bodies** (server.ts:968,1000). Reuse the existing bounded reader with a small control-message limit. These endpoints require a control token; this is hardening, not a demonstrated public attack.
4. **Use process identity stronger than PID for diagnostic leases** (browser-diagnostic-retention.ts:18). Crash plus PID reuse can make a stale trace look active. Check process start identity before keeping or deleting another owner's data.
5. **Rotate process-stream-errors.log** (launcher/electron/logging.cjs:180). The normal launcher logger rotates, but the emergency stream-error sink appends without a cap.
6. **Filter managed-Chrome storage exports** (browser-login.ts:451 and browser-worker.ts:5264). Reuse the existing ChatGPT/OpenAI storage allowlist at both persistence points. Third-party retained state is conditional on sign-in flow; no actual cookies were inspected.
7. **Reconcile architecture documentation** (docs/architecture.md:86,94,236). It claims sixteen tabs and rejection of a sixth turn in the same section. Describe configured admission separately from measured sustainable capacity.

### GitHub tools and practices

- **Recommended candidate: low-frequency Dependabot proposals** for root and launcher Bun manifests/lockfiles, capped open PR count, reviewed updates and no automatic merge. [GitHub documents text bun.lock support](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories). Repository-level availability/settings were not inspected. This improves maintenance; it does not repair the lifecycle defects above.
- **Proportional PR workflow:** ci.yml currently expands verify into full tests/audits/builds on three operating systems, followed by packaging. Separate targeted PR checks from explicitly authorized broad release checks. Avoid required checks stuck pending when adding path filters. No workflow was triggered or changed in this review.
- **No replacement browser/MCP framework justified by this review.** Existing Playwright, MCP SDK, queue and transaction primitives already cover the architecture. First correct ownership, cancellation, bounded retention and commit ordering in existing code; adding another queue/database/browser library would introduce migration risk without resolving the demonstrated causes.

### Recommended implementation order

1. **Lifecycle and routing:** B01, B02, B05, B06, B08. These affect shutdown, correct account routing and repair flows.
2. **State and context integrity:** B03, B04, B09, B10, B11. Preserve local/native continuation distinctions and crash recovery.
3. **Resource limits and uncommon paths:** B07, B12, response/log limits, diagnostic ownership and storage filtering.
4. **Separately scoped contracts:** Windows stream compatibility, physical-settlement timeout, MCP cancellation and opaque reasoning replay.
5. **Maintenance:** restrained dependency proposals and documentation/CI alignment.

Implementation should use a small development reproduction for each changed failure path, within the standing shared verification limits. No implementation, installed-app replacement, dependency update or backend performance improvement is claimed by this report.

