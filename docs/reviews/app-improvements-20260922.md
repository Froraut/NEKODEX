# NEKODEX: two Astra waves, 2026-09-22

Baseline: `1e6dec0`, version `5.9.0-nekodex.5`. Work branch:
`codex/app-improvements-20260922`. The original checkout and installed app are
preserved; this work is in a separate Git worktree.

The user requested 16 Astra reviewers followed by 16 Astra reviewers/implementers.
Wave 1 uses 16 `gpt-6-astra` agents at medium reasoning, with separate source scopes.
Wave 2 independently challenges the findings and implements accepted bounded changes.
The coordinator owns shared wiring, integration, final builds, and renderer flows.

## Coverage and ownership

| Lane | Area |
| --- | --- |
| 1 | Overview and readiness |
| 2 | Account settings, safety, proxy validation |
| 3 | Task center |
| 4 | Browser workspaces and tools onboarding |
| 5 | Usage and quota presentation |
| 6 | Update interface |
| 7 | App shell, settings, route diagnostics |
| 8 | Chrome/profile authentication |
| 9 | Task ledger and admission queue |
| 10 | Workspace persistence and artifact handling |
| 11 | Native transport and usage delivery |
| 12 | Responses parsing, file content, events |
| 13 | Browser worker, model selection, attachments |
| 14 | Compaction and environment ownership |
| 15 | MCP, tunnel, Codex integration |
| 16 | Runtime and updater lifecycle |

## Verification plan

- Each implementation owner selects a small behavior-focused regression for its
  accepted change. No default repository/package suites or duplicated checks.
- Coordinator runs integrated root/launcher typechecks and renderer build after
  edits settle, plus syntax/whitespace checks for changed files where needed.
- Credential-free renderer inspection covers Overview, Accounts, Browser,
  Tasks, Activity, Setup/Connections, Settings, and Updates. It exercises changed
  actions and relevant empty/error/busy states, including compact and Russian UI.
- The existing Playwright fixture is used with an isolated Chromium profile and
  dynamically allocated loopback server. Temporary servers/browser runs close
  at completion. Fixture results do not establish real provider/auth acceptance.
- No release packaging, installed-app replacement, account/config changes, or
  live external submissions are part of this source-improvement run.

## Delivered changes

Both waves completed: 16 independent review sessions, followed by 16 new
review/implementation sessions, explicitly dispatched as `gpt-6-astra` with
medium reasoning. Session IDs and lane names are retained in
[the dispatch manifest](app-improvements-20260922-agents.json).
The duplicate attachment-name finding was consolidated into one implementation.
The resulting scope covers 31 distinct proposals, including bounded features.

| Area | Result | Focused owner cases passed |
| --- | --- | ---: |
| Overview / queue UI | Shared model-readiness rules; visible global/account pause scope; explicit history-unavailable hold reason | 6 |
| Account settings | Resume expired sessions without requiring an already-set stopped flag; revert unsaved proxy edits locally | 4 |
| Task center | Trace/account/model search, status/account filters, counts and reset; confirmation before closing a retained failed-task page; account history-health notices | 6 |
| Workspace UI | Explicit retry of remaining saved windows; readiness updates on same-identity events; consistent controls | 7 |
| Usage | Preserve unclassified lifetime totals; show qualified median/sample coverage below the p95 threshold; accurate empty states | 11 |
| Update UI | Gate install during lifecycle transitions, retain cancellation, show measured download ETA and accessible progress values | 5 |
| App shell / Settings | Invalidate known-obsolete route diagnostics after successful removal; semantic language follows onboarding preview | Parent UI |
| Chrome authentication | Preserve trusted restored-session evidence; fixed cause-specific EN/RU profile-login guidance without raw-error leakage | 9 |
| Queue / task history | Reconcile lost exact leases into visible interrupted incidents; expose per-account history health and hold affected admission | 11 |
| Workspace / artifact backend | Settle early rejected downloads; avoid duplicate live workspace IDs; retain live Temporary Chat and restore remaining saved windows explicitly | 18 |
| Native transport | Valid successful SSE usage receipts; discard incompatible old outbox records; correct decoded response headers | 8 |
| Responses | Malformed known function tools cannot bypass their schema through the extension fallback | 3 |
| Attachments | Deterministic names for same-named revisions, exact bytes and original metadata; common image encoding/20 MB preflight | 5 |
| Compaction | Retain failed exact-run results within the existing bounded cache; preserve canonical system/developer instructions through checkpoints | 9 |
| Codex integration / tunnel | One compensation boundary with committed ownership receipts, symlink preservation and guarded rename retries; owned-lock cleanup on initialization failure | 17 |
| Runtime / updater | Restore supervision after settled failed Quit; compensate guardian-start failure and fence relaunch on durable rollback | 13 |

The table records 132 distinct focused owner test cases, including relevant
pre-existing controls. Passing unchanged cases were reused, not repeatedly run
as a whole-app battery. The parent additionally verified eight integrated
renderer flow groups. Counts are evidence of this scope, not whole-app proof.

## Review findings resolved during integration

- Independent attachment review confirmed the compiler-to-upload/Manual mapping;
  generated image/skill names, supplied suffix names and case-normalizing
  filesystems are included in collision handling. No duplicate upload guard was
  weakened.
- Independent workspace review confirmed exact download ownership, late cleanup,
  live-ID exclusion before temporary pruning, native group anchors, original
  account checks and explicit retry. No automatic restoration was introduced.
- Independent task review traced the history-health wire through pool snapshots,
  types, App and TaskCenter, and challenged lost-lease reconciliation and failed
  page dismissal. No missing lease is classified as proof that nothing was sent.
- Independent native review checked the receipt producer against the actual
  receiver and the real Bun decompression contract. Historical invalid receipts
  are discarded; no usage is fabricated.
- Parent and independent integration review found Windows retry gaps: both
  `expectedSnapshot` and `expectedData` callers now revalidate before every rename,
  including after backoff. Fault injection verifies preservation of external edits.
- Independent updater review found that a failed rollback could lead to two
  relaunch requests across immediate compensation and later recovery. The owner
  reproduced both staging-delete and terminal-journal failure variants, then
  gated immediate relaunch on successfully persisted rollback. Actual later
  recovery is exercised in the added fixture cases.
- Visual review found default browser styling on workspace actions. They now use
  the app's existing button and select styles without changing action semantics.

## Integrated verification

- Root `bun run typecheck`: passed.
- Launcher `bun run build` (TypeScript plus Vite): passed. After the final
  workspace/queue presentation refinements, only the renderer build and affected
  flows were repeated. Final assets: `index-DIcvfkBt.js`, `index-Ds2sg7q4.css`.
- Changed CJS syntax checks and `git diff --check`: passed; the updater's final
  correction received its own syntax check.
- `node --test launcher/tests/astra-improvements-ui-preview.cjs`, with named
  follow-ups for failed fixture assumptions and later affected changes: all
  eight distinct flow groups passed with no page errors. Initial failures were
  fixture/locator issues (onboarding started on its saved-language second step,
  a select's label-text locator, scoped button name, and a zero-total usage fixture),
  corrected without inventing product regressions. Passing unrelated flows were
  not rerun.

The eight renderer groups cover task filters/protected dismissal/history health
and pause scope; workspace restore/same-identity readiness; Settings success versus
cancelled removal; unsaved onboarding language semantics; updater transition/ETA
and cancellation; lifetime/median usage; account resume/local proxy draft restore;
and navigation through Overview, Accounts, Browser, Activity, Task center,
Connections, Updates and Settings. Desktop 1280px and compact 760px views include
Russian Task Center and onboarding. Screenshots are in ignored
`launcher/output/playwright/astra-improvements/` and were visually inspected.

Native transport verification uses a short real loopback HTTP chain with Bun
fetch and gzip/Brotli data, including an upstream error. Account, Chrome, windows,
supervisor and updater checks otherwise simulate their external boundaries in
isolated fixtures. No real provider message, account import, configuration
mutation, installed update, OS recovery registration or live tunnel change was
used as verification.

## Explicit limits and handoff

- This is a source/development result. Version remains `5.9.0-nekodex.5`.
  `/Applications/NEKODEX.app` was observed at that version and was not replaced.
  No release tag, installer, notarization or distribution assets were produced.
- Failed compaction results use the existing process-local 30-minute retention;
  this is not restart-persistent duplicate prevention or indefinite retention.
- Native Windows behavior was fault-injected on macOS. A Windows lock-unlink
  failure is reported and can leave the lock; automatic stale-lock recovery is
  outside this change. Filesystem guards are not a portable atomic compare-and-swap.
- Profile-first native dialogs now preserve specific guidance; unrelated generic
  renderer passkey progress and broad authentication flows were not redesigned.
- Extremely long attachment extensions that leave no room within the existing
  filename bound fail explicitly. Image checks prove transport encoding/size,
  not image-decoder correctness or live provider acceptance.
- Vite's existing bundle-size advisory remains. No unrelated dependency upgrade,
  broad test suite or bundling redesign was added.
- Temporary verification browsers and loopback servers are closed. The original
  checkout's branch, untracked branding inventories and dependency links are
  preserved. The separate source worktree and current development build remain
  available for review.
