# NEKODEX second Sol review — 2026-09-15

Baseline: `f426422a04ec6d174e7720432589cd4626724aa4` on main, after backend fixes, signed release and repository rename to Froraut/NEKODEX.

User explicitly requested 16 Sol reviewers. All use gpt-5.6-sol medium. Manual read-only inspection; no tests, builds, live requests or application changes. Findings below require parent adjudication; absence of a finding is not proof of exhaustive correctness.

## Dispatch

1. Russell (`01a0a59a-4962-77a3-9055-d0bbfec5b082`): Helper startup/shutdown and IPC protocol completeness: launcher-helper-client.ts browser-helper-main.ts direct worker call sites
2. Linnaeus (`01a0a59a-489f-7351-a7cb-39163e4bd8b3`): Account allocation transactions, pending affinity, retained tab failure and cleanup: launcher/electron/account-pool.cjs
3. Plato (`01a0a59a-4a17-7263-b3ba-0bf7cc8ff1a6`): Route uninstall/deactivation crash recovery and journal consistency: src/codex-integration.ts codex-integration-journal.ts shared.ts
4. Halley (`01a0a59a-4abf-7643-8ae7-2b649d054a76`): Setup final-failure compensation including service/tunnel state and changed-mode handling: src/setup.ts
5. Locke (`01a0a59a-4c0b-7430-9180-1491e78175a5`): Streaming cancellation and backpressure on both platform branches: src/server.ts HttpTurnCounter and native stream wrapping
6. Epicurus (`01a0a59a-4b5b-7cf2-94d4-bec3ddd5e21b`): Local response state and Web/native transition replay correctness: src/responses/state.ts native-passthrough.ts and server routing
7. Avicenna (`01a0a59a-4de0-7e41-a785-d2eb0018ee1e`): Request schema/parser, file/image handling and reasoning replay: src/responses/parser.ts schema.ts and prompt.ts
8. Archimedes (`01a0a59a-4cd0-78f2-92c2-1e50195ec221`): MCP broker cancellation, activity limits and capability lifecycle: turn-broker.ts mcp-server.ts
9. Jason (`01a0a59a-4eaa-7753-be69-0eab458c6d43`): Checkpoint persistence, physical owner retirement, TTL/cleanup: rolling-checkpoint.ts turn-execution.ts
10. Gauss (`01a0a59a-4f93-75c2-af11-64cd75b1e1ea`): Managed Chrome login cleanup/storage filtering and launcher import boundaries: src/browser-login.ts browser-worker.ts login helpers
11. Leibniz (`01a0a59a-504d-79c3-8531-9faaff66240d`): Launcher runtime supervision, shutdown fallback, drain/restart bookkeeping: runtime-supervisor.cjs main.cjs
12. Feynman (`01a0a59a-5100-7d23-9b7d-5ecb0c878ea6`): Repository rename compatibility in release/updater/trust/installer contracts: new repo Froraut/NEKODEX (old Froraut/codex-chatgpt-web), existing published immutable 5.2.0-nekodex.1. Inspect hard-coded owner pins and workflow conditions.
13. Banach (`01a0a59a-51a9-7373-b1db-3c7eceadc49b`): Resource boundedness: diagnostic leases, logs, non-streaming accumulator, admin body bounds. Focus newly introduced limits and actual failure paths.
14. Chandrasekhar (`01a0a59a-5255-7cd2-ba38-efa9c65491d9`): Renderer async behavior and setup/settings account state consistency: launcher/src/App.tsx AccountSettings.tsx setup-progress.ts
15. Curie (`01a0a59a-52ff-7d61-b1d9-37b0c9a5c014`): CI focused-case selection, release DMG signing pipeline robustness and metadata/digest integrity: scripts/focused-pr-check.ts .github/workflows/ci.yml launcher/scripts/package.cjs (exclude repository-rename issue owned reviewer12)
16. Popper (`01a0a59a-539d-7cc3-b5ed-569ca2dcc178`): Native tool delegation and context/compaction continuation edge cases: native-delegation.ts environment.ts compaction-continuation.ts compaction-handoff.ts

## Results

**16/16 completed, collected and closed.** The original reports are preserved in [second-round reports](2026-09-15-sol-second-reports.md). There are 24 observations below, not 24 reproduced failures. Parent inspected the cited current implementation and qualified severity, intentional contracts and limits. Only these documentation files changed.

## Release and rename blockers

| ID | Priority | Location | Adjudication and repair |
| --- | --- | --- | --- |
| R01 | P1 | .github/workflows/release.yml:28; scripts/sign-release-metadata.cjs:10 | Accepted. Workflow plan requires the old repository name and will skip after the rename. Update the exact repository guard together with signer/trust identity; do not simply loosen the guard. |
| R02 | P1 migration | launcher/package.json:7; launcher/release-trust.json:3; launcher/electron/update.cjs:106; release-trust.cjs:76 | Accepted identity mismatch. Updater pins old owner/path and signed metadata identity. Parent read the old-name GitHub releases endpoint: it now returns asset URLs under Froraut/NEKODEX, which do not satisfy the old exact URL check. Future metadata under the new identity also fails old trust pins. Use a new-version migration with a documented manual-install path if no authenticated transition can satisfy existing binaries. Keep published .1 assets immutable. |
| R03 | P2 | scripts/install-launcher.sh:35; scripts/install-launcher.ps1:34 | Accepted default selection failure. Parent queried Froraut/NEKODEX/releases/latest and received HTTP 404; only a prerelease remains. Explicit version works around channel selection. Define a prerelease channel or require the selected version, rather than treating latest as all published releases. DMG links remain valid. |

## Runtime and state findings

| ID | Priority | Location | Trigger, adjudication and minimal repair |
| --- | --- | --- | --- |
| R04 | P2 | src/adapters/chatgpt-web/launcher-helper-client.ts:762 | Local rejection of an oversized outgoing frame/full pipe queue calls failChild and fails unrelated turns sharing that helper. Isolate unsent offending-turn failures; retain whole-helper termination for actual transport corruption. Saturation frequency unmeasured. |
| R05 | P2 | launcher/electron/account-pool.cjs:308; browser-host.cjs:2387 | A retained-only request with stale affinity but no actual retained tab can evict an unrelated tab before the host rejects it. Precheck the exact reusable retained tab and connector before reclamation; keep the final race check. Distinct from the fixed host-ready failure. |
| R06 | P2 conditional | src/codex-integration.ts:520,652 | An inactive v11 journal checks restored TOML but not absence of its managed JSON hook. If that exact hook reappears through external restoration, disconnect/uninstall can lose ownership evidence while leaving it installed. Verify inactive JSON-hook consistency, preserve changed user entries, and compensate only proven managed entries. Not an observed interrupted-deactivation failure. |
| R07 | P2 | src/setup.ts:624,677 | A tunnel stop/readiness failure before the final route-commit catch bypasses setup-level compensation after service mutation. Expand the transaction boundary to include those mutations. Terminal-owned config may already have changed, while launcher callers have separate checkpoints; do not claim every invocation leaves the same old config. |
| R08 | P2 conditional | src/adapters/chatgpt-web/turn-execution.ts:788–808 | closeConversationAndWait removes owner/key state before release acknowledgement; failed release also drops retirement. Retain a retryable release obligation and block same-key replacement until acknowledgement. Source defect established; live leftover-tab reuse not reproduced. |
| R09 | P2 | launcher/electron/main.cjs:1445 | process.once signal handlers are consumed even if requestQuit refuses because an operation is active. A later signal can take the platform default termination path. Keep/re-arm signal handling and define retry/escalation without bypassing owned cleanup. |
| R10 | P2 conditional | launcher/electron/runtime-supervisor.cjs:1979,2083,1353 | Stop and forced fallback await recovery work that has long connect/readiness waits. Add shutdown cancellation and bounded settlement, ensuring cancelled recovery cannot later adopt/spawn children. Multi-minute delay is possible from source, not measured. |
| R11 | P2 | src/adapters/chatgpt-web/thread-environment.ts:255 | loaded=true precedes persisted environment parsing/validation; a later resolve/set can overwrite unread state after a failed load. Apply temporary-map publication as already done for the checkpoint store. |
| R12 | P2 | src/adapters/chatgpt-web/native-delegation.ts:39,51 | Verified child delegation XML-decodes input, verified root delivery leaves entities encoded. Decode once consistently after provenance verification. The carrier's real-world escaped-input frequency is unverified. |
| R13 | P2 conditional | src/native-passthrough.ts:104,267; src/bridge.ts:895 | Known local text-only continuation restores history but retains locally generated msg_* item IDs because scrubbing requires a reasoning/compaction marker. Strip local replay item IDs based on proven local continuation; preserve call_id relationships and unchanged native request bytes. Source omission is clear; upstream rejection not exercised. |
| R14 | P2 | src/responses/schema.ts:111; parser.ts:38 | Generic typed-item fallback accepts malformed known message content; invalid images become placeholders and unknown blocks disappear. Require known item types to satisfy their actual schema; keep forward compatibility only for unknown item types. |
| R15 | P2 | src/responses/schema.ts:43; parser.ts:393 | System images are accepted then discarded when system content is flattened to text. Explicitly reject unsupported system images or preserve structured attachments with system semantics. No current client demonstrated this input. |
| R16 | P2 conditional | src/browser-login.ts:368–373 | Passkey capture removes its temporary profile even when browser/context closure failed. Use the managed-login cleanup safeguard here too: retain an owned profile on uncertain closure and report cleanup evidence. |
| R17 | P2 | src/adapters/chatgpt-web/browser-worker.ts:5264 | Storage-state capture/write after a completed managed-Chrome answer can convert completion to a turn failure. Separate best-effort session persistence from answer delivery and report a warning. Disk-fault reproduction not run. |

## Renderer findings

| ID | Priority | Location | Adjudication and repair |
| --- | --- | --- | --- |
| R18 | P2 | launcher/src/App.tsx:1466,1192 | After credentials setup only fresh.state is copied; parent mcpCredentialsConfigured remains stale and Manual setup can remain on Tools. Refresh the relevant snapshot field, including operation completion. |
| R19 | P2 conditional | launcher/src/App.tsx:61–92 | Startup snapshot is applied after newer live events without generation reconciliation; early state events are discarded while snapshot is null. Subscribe first and merge buffered/versioned events so stale initialization cannot overwrite current state. Race not reproduced. |
| R20 | P3 UX | launcher/src/AccountSettings.tsx:15 | Account cards refresh on initial load/own actions but not background host changes. Refresh on relevant events, coalesce requests and prevent older replies overwriting newer state. |

## Robustness and workflow improvements

| ID | Priority | Location | Adjudication and repair |
| --- | --- | --- | --- |
| R21 | P2 robustness | src/native-passthrough.ts:177 | Native SSE terminal detection stores an entire unterminated line and rescans it. Use bounded streaming state for exact data: [DONE] detection without retaining arbitrary line content. Unbounded source path established; production impact unmeasured. |
| R22 | P2 robustness | src/adapters/chatgpt-web/turn-broker.ts:1047,1136 | Completed activity tombstones are bounded but concurrent active claims/pending invocations are not directly count-bounded per turn. Add admission limits while preserving late-claim rejection and completion fencing. Upstream practical concurrency limit unknown. |
| R23 | P3 transactional completeness | src/setup.ts:368,715; src/tunnel.ts:142 | Setup rollback restores configuration/service/profile/key but not an earlier successful tunnel-client binary/manifest upgrade. A rejected setup can leave the newer client with prior config. This does not alone prove incompatibility; define retained-upgrade policy or include both files in compensation. |
| R24 | P3 workflow | scripts/focused-pr-check.ts:105; .github/workflows/ci.yml:66 | Mixed backend+capacity changes select only backend cases. CI does disclose the capacity path as manual review, so this is not false success. Either select the most relevant mixed cases within the shared budget, or explicitly preserve the manual-review choice; do not automatically exceed five default cases. |

## What was not reopened

- Helper startup settlement and accountRoutingKey transmission are present.
- Windows eager tee was replaced by a demand-driven TransformStream; no repeat of the old tee finding.
- Three-counter drain now includes detached compaction.
- Checkpoint loaded-state publication and TTL physical-settlement guard are present.
- Admin body bounds, non-streaming aggregate budget, emergency log rotation and diagnostic ownership checks yielded no new substantiated resource finding in reviewer 13's scope.
- Whole-turn MCP cancellation and best-effort forced quit are documented policies, not new unconditional bugs.
- DMG signing/notarization/digest ordering yielded no new source-level signing defect.
- The certificate legal-holder name is explicitly approved and outside review scope.

## Recommended next implementation order

1. Repair repository identity/channel migration before another release or auto-update attempt (R01–R03).
2. Preserve release obligations and broaden setup rollback boundaries (R05–R08, R11, R13).
3. Fix shutdown/IPC isolation and completed-answer handling (R04, R09–R10, R16–R17).
4. Correct Manual setup and startup state reconciliation, then parser/delegation edge cases (R12, R14–R15, R18–R20).
5. Add bounded native SSE/active claims and choose the smaller maintenance improvements deliberately (R21–R24).

This round is review only: no runtime fixes, build, restart, repackaging or dependency changes. The two small read-only GitHub API observations support release identity/channel findings; all other failures remain source-derived, not live reproductions. All 16 reports were collected and all agents closed. Publication of this report does not update the installed app.
