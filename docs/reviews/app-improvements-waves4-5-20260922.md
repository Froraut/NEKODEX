# NEKODEX — review wave 4 and fix wave 5, 2026-09-22

Requested: 16 Astra review agents, then 16 Astra fix agents. Starting revision
`18b4278277d7e6c7d6b59ab591a007633584408b`, branch
`codex/app-improvements-20260922`, existing draft PR #19.

Wave 4 is read-only review. Wave 5 begins after all 16 reviews are collected and
ownership/overlapping findings are resolved. Fixers independently verify each
accepted finding; absence of a justified fix is acceptable. Both waves explicitly
request `gpt-6-astra` at medium reasoning. No release or installed-app replacement
is included.

## Coverage and shared ownership

| Lane | Area |
| --- | --- |
| tasks-queue-ui | Task actions, confirmations, filters and queue presentation |
| account-forms | Account settings, safety, proxy and Codex controls |
| shell-settings | App shell, Settings and route diagnostics |
| workspaces | Workspace windows, directory, manifest and manager |
| usage | Stored usage, diagnostics and export |
| updates-interface | Download, retry/cancel, progress and update controls |
| chrome-auth | Profile selection, capture, identity and login cleanup |
| account-lifecycle | Account ownership, safety, readiness and task ledger |
| admission | Queue/control protocol, lease acknowledgement and capacity |
| files | Artifact transfer, Manual files and input-file authority |
| native | Native forwarding, usage delivery, proxy and cancellation |
| responses | Parsing, streams and continuation ownership |
| web-worker | Web send/read, model selection, attachments and retries |
| compaction | Checkpoints, current-turn authority and cancellation |
| setup-integration | Setup compensation, config/journal and tunnel ownership |
| runtime-updater | Runtime supervision, update transactions and recovery |

Coordinator owns shared wiring where needed, fixtures, integrated builds/UI,
acceptance decisions and publication. There is one writer for each coupled
source file. Findings that require a shared file are assigned before edits begin.
Prior proof is in the earlier two-wave and wave-3 reports; completed fixes are
not rediscovered as new work.

## Verification policy

Each accepted change receives the smallest useful behavioral check. Injected
failures must prove that the target boundary was reached before the fault.
No full repository/package suites, duplicated test lanes or broad automated
audit pipeline. Parent validates integrated types/build and affected renderer
flows after owners settle. Current unchanged passing evidence is reused.
External process/provider/account boundaries use isolated fixtures unless a
specific safe development observation is necessary. Installed production app,
user accounts and live routes are preserved.

## Findings and results

Review wave complete; all 16 reports collected before any source implementation.
Fix wave contains 16 new agents. Initial accepted scope is the source-grounded
findings below; final counter-review may refine a correction or reject a claim.

| Area | Accepted finding |
| --- | --- |
| Task queue UI | Retained inspection pages need an actionable capacity explanation |
| Account forms | Already-expired quota evidence can leave refresh controls stuck |
| Settings | Mode changes retain previous runtime's routing diagnostics |
| Workspaces | Failed durable deletion removes its visible retry target |
| Usage | Future retained days crash period reports; CSV omits optional token coverage |
| Download | Stalled transfer retains stale positive speed/ETA |
| Chrome verification | Temporary-session cleanup failure is masked; connection close is not awaited |
| Account lifecycle | Not-sent tab removal leaves deferred safety/affinity reservations |
| Admission | Queued retained-source failure loses typed error and safe cleanup evidence |
| Files | Completed unpromoted partials lose cleanup owner; canonical names do not match raw download names |
| Native routing | Descriptor fallback reuses a responses-only PAC route for unrelated URLs |
| Responses | Cancelled pending SSE read can still call completion/retain continuation |
| Web worker | Final Luna/Think mode is not checked before send activation |
| Compaction | An interrupted intervening turn can be omitted by an older checkpoint |
| Setup | Compensation uses bytes-only ownership and may remove dependencies of an uncertain connect |
| Updater | In-memory committed phase can authorize cleanup before durable commit journal |

Shared lifecycle decision: the account-lifecycle fixer alone owns browser-host.cjs
and account-pool.cjs, including completed-artifact partial cleanup. The files fixer
owns DownloadItem name matching. The admission fixer owns queue/control/client
protocol and coordinates exact no-work evidence through the lifecycle owner.
The setup transaction and direct write-receipt dependencies have one owner.

## Completed implementation

All 16 review reports were collected before dispatching 16 new fixers. The
original run stopped at its usage limit with source edits intact. The completion
task resumed the original account-lifecycle, admission and setup owners, then the
native owner and files counter-reviewer. No replacement review wave was invented.
All accepted findings above are implemented; there are no deferred implementation
items in this wave. Dispatch IDs remain in the accompanying manifest.

| Area | Result and focused evidence |
| --- | --- |
| Task queue | Inspection-capacity explanation gives an explicit review/dismiss/close path; compact renderer flow passes without automatically closing work. |
| Account forms | Render-time quota clock plus deadline wakeups handles delayed expired evidence; 2 component cases and the actual renderer refresh action pass. |
| Settings | A requested mode change retires completed and pending old diagnostics; 1 component case and the rendered transition pass. |
| Workspaces | Failed durable removal restores its retry target; overflow removals can reduce the count until persistence fits. 2 real-file manager cases and renderer failure/retry pass. |
| Usage | Period projection excludes retained future days without deleting them. CSV appends optional-token coverage, preserving unknown versus zero. 2 store cases and 1 CSV consumer case pass. |
| Download | Three seconds without bytes clears speed/ETA without extending the idle deadline; 3 transfer/timer cases pass, including recovery, hashing and cancellation. |
| Chrome verification | Both temporary storage clearing and connection closure are awaited; safe cleanup errors remain visible. 3 consumer/verifier cases pass. |
| Account lifecycle | Exact account/helper/tab/surface/task ownership plus durable terminal not-sent evidence authorizes reservation rollback; failure retains recovery evidence. 3 lifecycle cases and 1 queue-release authority case pass. |
| Admission | Queue persistence and control/client propagation preserve the allowlisted retained-conversation error and explicit predispatch no-work proof; 1 queue case and 2 real loopback protocol cases pass. |
| Files | Host cleans completed unpromoted partials, including completion-microtask races, and preserves promoted files. 2 host cases pass. Guard canonicalizes Unicode names without changing ownership; 3 guard cases pass. |
| Native | Descriptor fallback uses exact URL cache identity, bounded expiry and rejection state. 2 new cases and existing background/rejection controls pass. Durable background readiness requires explicit global transport; the affected readiness case passes after counter-review. |
| Responses | Pending SSE reads recheck cancellation before completion retention; 5 real queue/bridge cases pass. |
| Web worker | Final read-only Luna/Think check rejects mode drift before send activation; 3 groups/9 scenarios pass. The portable regression is retained as `tests/browser-worker-final-mode.test.ts`. |
| Compaction | A checkpoint cannot skip an intervening unsummarized turn; 6 selected parser/store/compiler cases pass. |
| Setup | Committed file receipts guard compensation against external inode/mode changes; failed connect preserves dependencies until exact stopped proof. 4 actual-caller/filesystem cases pass, with process/provider boundaries mocked. |
| Updater | Durable commit publication precedes the in-memory committed phase and backup deletion; 2 real-file transaction cases pass. |

Passing unchanged checks from the interrupted run were reused. Selected failing
fixtures were corrected and only affected cases rerun. No repository/package
default suite or broad automated audit was run.

## Counter-review and integrated verification

- Independent read-only lifecycle/admission/artifact review found no actionable
  blockers. It traced durable ledger/safety ordering, exact removal authority,
  allowlisted journal replay, cleanup ownership and promotion boundaries.
- The existing independent updater review confirmed that the failure fixture
  reaches actual replacement and readiness before commit-publication failure,
  and that backup-deletion failure after commit is recovery-cleanup only.
- Parent setup review checked receipt propagation, config BOM preservation,
  config/shared import initialization, successful-removal checkpoints, and the
  running/unknown failed-connect gates in both setup callers. Existing regular
  file publication retains its 0600 policy; arbitrary prior mode restoration is
  not newly promised.
- Parent found and resolved an integration defect in the initial native fix:
  a five-minute exact-responses lease cannot authorize indefinite background
  operation. `nativeNetworkBackgroundReady()` now rejects bootstrap/PAC-only
  detach even while that bounded route is usable. Existing quit handling asks
  the user to keep NEKODEX open or explicitly stop connections. No PAC route is
  silently widened to unrelated endpoints.
- Root `bun run typecheck` passed on the final source. The interrupted run's
  successful launcher `bun run build` (typecheck plus renderer) was reused:
  renderer sources were unchanged after it. Assets are `index-C5i1-Kuk.js` and
  `index-BzWYyHSU.css`; the existing size advisory remains.
- `bun run scripts/build-browser-helper.ts` passed for the final browser worker.
- All 4 `astra-wave5-ui-preview.cjs` groups passed across the initial run and
  one affected rerun. Three groups passed immediately. The capacity case used
  an incorrect `/close/` expectation for the rendered word `closing`; correcting
  that expectation required no product change. Screenshots at 760px and 1280px
  were inspected. No page errors or horizontal overflow were observed.
- The portable final-mode regression's positive group passed after moving it
  from the temporary handoff into the repository; unchanged negative evidence
  was reused. No machine-specific source imports remain in that test.
- Actual source Electron launched with a new temporary DEV home and manual-mode
  seed. Confirmed `NEKODEX DEV`, version `5.9.0-nekodex.5`, exact isolated
  userData/coreHome/codexHome, real preload/snapshot IPC, and Overview, Accounts,
  Task center and Settings. Configuration remained absent and no page errors
  occurred. PID 3908 exited and the temporary profile was removed.
- The installed `/Applications/NEKODEX.app` process remained PID 26812, started
  September 21. No production launch/restart or installed replacement occurred.
- Integrated diff hygiene and changed CJS syntax checks passed. Final UI identity
  evidence and screenshots remain in ignored
  `launcher/output/playwright/astra-wave5/`.

## Delivery boundary

This completes the source/development changes in draft PR #19 on
`codex/app-improvements-20260922`. Version remains `5.9.0-nekodex.5`. Packaging,
installation, release assets, real Chrome sign-in, live provider submissions,
account credentials, tunnel/workspace grants and production routing were not
changed. Backend external boundaries use isolated files, streams, EventEmitters,
loopback control or process mocks; they do not prove live provider behavior or
cross-platform installation.

Removal receipts are process-local and do not authorize automatic post-crash
refunds. File guards detect changes at observed boundaries and are not an OS
compare-and-swap. Failed-connect status with an unsupported/uncertain schema
preserves dependencies for recovery. Exact URL fallback remains limited to five
minutes; only explicitly configured global transport permits durable detach.
