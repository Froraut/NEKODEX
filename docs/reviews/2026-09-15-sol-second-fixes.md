# Second Sol review fixes — NEKODEX 5.2.0-nekodex.2

Baseline: 2013e6b3f4c370fcb822631b8578e030759a317f. Parent integrated eleven Sol medium implementation workers with disjoint write scopes. All workers completed and were closed. This is the source-development update; published 5.2.0-nekodex.1 assets remain immutable.

## Disposition of all 24 observations

- **R01–R03, release identity and installers:** workflow owner guard, package/update origin, public trust repository, installer defaults and support links now use Froraut/NEKODEX. Same publisher key; no trust-check weakening. Installer defaults select the newest published release including prereleases. Source version advances to .2 so the changed repository trust contract is distinguishable. Existing .1 binaries require a manual signed-DMG transition once .2 is released; their bytes cannot be retroactively fixed.
- **R04, helper IPC:** unsent frame/queue limit failures no longer kill the shared helper. Small turn-abort frames wait at most five seconds for pipe capacity. Real pipe errors still terminate failed transport. If abort cannot be delivered, caller failure is explicit and helper-side cleanup falls back to completion/turn timeout.
- **R05, retained tab allocation:** exact conversation/connector precheck runs before capacity reclamation; final host checks remain for races.
- **R06, inactive journal hook:** an exact journal-owned JSON hook that reappears is reconciled with guarded compensated writes; modified/ambiguous entries are preserved with an error. Uninstall rechecks before dropping ownership journals.
- **R07/R23, setup transaction:** compensation begins before tunnel configuration, service mutation and readiness. Completed mutations are checkpointed; runtime-change classification is recalculated after tunnel configuration. Tunnel binary, manifest and mode join rollback using exact intended bytes. Incomplete prior installs and ambiguous external changes are preserved.
- **R08, release acknowledgement:** conversation keys, session entries and release obligations remain until Launcher acknowledges release. Failed release can be retried; same-owner replacement is blocked until acknowledgement. Preserved final-response replay remains represented.
- **R09/R10, shutdown:** SIGINT/SIGTERM handlers persist after refused Quit. Recovery cancellation propagates to control processes/readiness; bounded settlement prevents waiting through an entire recovery timeout. Aborted recovery is fenced from late spawn/adoption. Failed Quit allows explicit restart only after recovery settles; committed Quit remains fenced.
- **R11/R12, context:** thread-environment loading validates a temporary map before publishing loaded state. Verified root and child delegation decode XML entities consistently once.
- **R13/R21, native forwarding:** restored local history strips backend-local item IDs, preserving call_id links and incoming non-restored items. Exact SSE terminal detection keeps only a bounded candidate string; oversized lines are skipped for matching without buffering their contents.
- **R14/R15, request boundary:** known item types cannot escape validation through the unknown-type fallback. Invalid images and unsupported system-message images fail explicitly; genuinely unknown item types remain forward-compatible.
- **R16/R17, login and completed answers:** passkey profiles are retained with cleanup evidence when browser closure is uncertain. A managed-Chrome session-storage failure after answer completion becomes a warning rather than discarding the answer.
- **R18/R19/R20, renderer:** listeners register before initial snapshot, pending events reconcile with it, and snapshot refreshes preserve newer state revisions. Credentials propagate into parent state and MCP screen. Account snapshots refresh on background events with coalescing and stale-reply guards. Pending startup logs are capped at 300.
- **R22, live broker limits:** 64 active claims and 64 pending native invocations per turn; overflow retires the turn explicitly rather than dropping live tombstones. Completion fence rejects new native invocations.
- **R24, CI:** mixed backend/capacity paths select both relevant areas in one bounded Linux invocation with at most five named cases; overflow remains explicit manual review.

## Verification

Five named focused cases passed (no full suites):
1. Known local Web continuation expands history and drops its local message ID.
2. Long native SSE data line retains split exact terminal detection and forwards bytes unchanged.
3. Known malformed message/system image rejection, with normal text still accepted.
4. Failed retained release preserves ownership until a successful retry.
5. Authenticated metadata under the renamed repository verifies exact asset bytes and rejects changed bytes.

Backend and launcher TypeScript checks passed. Initial typechecking identified a too-narrow CI array type and a private-method fixture typing issue; corrected and rechecked the affected compilation. No passing behavior tests were rerun. All test/typecheck processes took under ten seconds in aggregate; development renderer builds were under a second each. Vite rebuilt once after the small startup-log cap correction.

Actual Electron source DEV target opened with version 5.2.0-nekodex.2 from launcher/dist/index.html; Accounts rendered its primary-account state. This is a source UI launch check, not a live Manual-credentials or forced event-race reproduction. The isolated /tmp/nekodex-second-fixes-dev instance was gracefully closed and its disposable profile removed.

## Remaining boundaries

- No new DMG, public release or installed-production replacement in this pass. README downloads still target published .1. Future release must use a new .2 tag and manual migration for .1's old repository pins.
- Managed service rollback, busy signal handling, multi-account retained-tab failures and passkey shutdown failures were reviewed manually; not live fault-injected.
- A failed external tunnel connect may have written profile bytes without an acknowledgement. Those uncheckpointed bytes are deliberately preserved and named for manual recovery rather than treated as owned writes.
- Filesystem compare/write cannot exclude an external edit in the final comparison-to-write gap without a shared lock.
- New claim limits are conservative bounds, not measured throughput claims. Full Windows execution and all model/account combinations remain unverified.
