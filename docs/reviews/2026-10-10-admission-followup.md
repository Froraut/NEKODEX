# Admission follow-up: recovered verification, 10 October 2026

## Scope and provenance

PR #73 is merged as `2faaf385515fd97c51d83977afe6ae56d6fef514`.
Its tree matches local `fc460c11ad0f0b658fa12e905728a326dd63326e`.
The GitHub checks for macOS, Ubuntu, Windows and actionlint succeeded.
This follow-up is on `codex/complete-admission-review-20261010`.

Recovered the interrupted Claude workflow `wf_3786155c-800` from its journal in
`~/.claude/projects/-Users-alex/890f2da6-fedd-4725-b2fe-e11594351389/subagents/workflows/`.
All 18 original-finding checks and the runtime/UI/copy hunt produced results.
The queue/pool and evidence-restore hunts did not produce final results, and the
three-lens voting phase never started. No new independent votes are claimed.
The coordinator completed the missing scoped source review and checked the
remaining reported gaps against the final merged tree, not the moving diff.

## Reconciliation of the 18 original findings

| # | Area | Final disposition |
| --- | --- | --- |
| 1 | Transient startup/account holds | Fixed; transient holds do not start the 45-second readiness deadline. |
| 2 | Rollback journal compatibility | Fixed; final tree immediately rewrites legacy failed readiness rows. |
| 3 | Pinned-account diagnosis | Fixed; selection and diagnosis share `pinnedAccount`. |
| 4 | Dispatch-time tunnel cause | Fixed; audited cause and grace survive dispatch rejection. |
| 5 | Retry after repair | Fixed; queue rechecks after reporting the cause; the server consumes one automatic replay. Retained-conversation fix verified separately below. |
| 6 | Missed owner polls | Live-owner gap fixed. Restart-restored rows deliberately require explicit Resume, per design; this is not automatic restart recovery. |
| 7 | Chat Completions failure | Plain path was fixed in the merged tree. Tool bridge still returned 502; corrected in this follow-up. |
| 8 | Missing capability evidence | Final merged copy names Check account when no tunnel is available. |
| 9 | Connector-check remedy | Corrected remedy avoids the old check/connector loop. A manual plain account check still deliberately retires connector evidence. |
| 10 | Tunnel-ready evidence | Core path existed; late tunnel startup could outlive the restore. Fixed in this follow-up. |
| 11 | Stale readiness timer after Resume | Fixed, including global pause in final tree. |
| 12 | Capacity resetting the timer | Fixed; capacity, runtime transition and previous submission are neutral holds. |
| 13 | Ownerless retained conversation | Fixed; immediate typed predispatch failure preserves compaction fallback. |
| 14 | Throwing diagnostic disabling queue | Fixed; diagnosis is guarded. |
| 15 | Verification missing real boundaries | Existing tests exercise the real pool and HTTP control server. Added retained-session and API tool-bridge regressions; browser/provider acceptance remains a distinct live check. |
| 16 | Task Center failure/cause | Basic cause and deadline are present. Cosmetic limitation: during a neutral capacity hold the running deadline is hidden; a non-readiness retained failure has a generic label. |
| 17 | Restore after sign-in | Core path existed; long operations and coalesced receipts could lose the restore. Fixed in this follow-up. |
| 18 | Localized remedies | Final copy covers six languages. Literal dollar-sign interpolation is fixed in `fc460c11` and covered by the existing focused test. |

The four findings in the completed runtime/UI/copy hunt (retained conversation,
dollar labels, API status documentation and global-pause documentation) were all
already corrected by `fc460c11`. The later focused check confirms retained head
ownership and fresh-attempt creation without releasing the earlier conversation.

## Additional corrections made here

- `NativeChatCompletionBridge` now preserves an audited `account_not_ready`
  envelope as HTTP 400 with the original actionable message, rather than 502.
- Evidence restoration no longer expires after 45 two-second waits while a user
  operation or tunnel startup is still in progress. Pending waits do not masquerade
  as active checks, so missing-tunnel admission can still fail with its real cause.
- A sign-in/tunnel receipt arriving during a restore updates the same owner and
  retries superseded evidence. Model evidence can be restored before the tunnel
  starts, preserving plain requests while tool requests wait for their own tunnel.
- Pool destruction wakes/cancels its pending timers. Documentation describes the
  ownership and HTTP boundary.

## Focused evidence

`bun test tests/admission-readiness.test.ts tests/account-not-ready-replay.test.ts tests/admission-followup.test.ts`
passed 24 tests. The final adjustment restoring plain-request capabilities while
waiting for a tunnel passed the five follow-up tests again (22 assertions).
`bun run typecheck`, `node --check launcher/electron/account-pool.cjs`,
`git diff --check` and `bun run architecture:check` passed.

Before the fix, the new tests reproduced the API 502 and both late-restore
failures. Retained-conversation preservation already passed on the merged tree.
No full suite, package, release, installation or application restart was run.

## Live continuation checkpoint

The installed launcher and active runtime remain 6.1.19. New changes above are
source-only. PID 81705 was the stable installed launcher when inspected; PID
81741 served the 6.1.19 runtime. These PIDs are observations, not reusable targets.
The installed Overview showed ChatGPT session verified, tools connector not
verified and an account-evidence-restore warning. Native input then failed with
`noWindowsAvailable`; a fresh observation returned ScreenCaptureKit -3811.
Web recovery is continuing through the same installed app, preserving account
profiles and all current provider conversations. No tunnel or credential has been
created or changed by this follow-up yet.

## Live Web recovery and picker correction

Native Computer Use recovered after one binding reset; an actual Accounts button
click succeeded. Both windows were on-screen and not fullscreen; the earlier
capture/input failure was not evidence of an application crash.

Primary was already signed in at the live check. Its Check account action failed
with `ChatGPT model picker toggle is ambiguous`. Native UI opened the exact model
menu successfully. A read-only DOM observation showed its exposed
`data-model-picker-view-toggle` has no `aria-hidden` attribute. The old selector
required `aria-hidden="false"` and therefore found zero controls. The source now
accepts an omitted attribute while still excluding `aria-hidden="true"` and
rejecting duplicate candidates. Two isolated browser cases (explicit false and
omitted) passed with the original model/effort/menu/draft restored.

The account's own tunnel is unconfigured. OpenAI Platform in the embedded API
window reached Google's `This browser or app may not be secure` rejection. A
normal Chrome login for the same account reached the saved OpenAI passkey prompt
instead. At the latest checkpoint the dialog requests Touch ID. The user must
provide the biometric; no password reset, authentication bypass, tunnel creation
or new API key has been performed. Continue from that Chrome dialog, then inspect
the correct Platform organization/tunnel and finish the app's existing setup.

New source is not installed. The old installed 6.1.19 still has the picker-selector
failure and the late-restore/API-tool-path defects described above. Installing a
new build and live provider verification are separate remaining boundaries.

## Continued local completion

After the user requested completion, the source-built browser helper successfully
inspected the actual signed-in Primary ChatGPT page: authenticated/temporary true,
model families 6, 5.6 and 5.5 observed. This verifies the changed picker boundary
against current provider markup. The helper returned and exited.

The user authorized the prepared Restricted runtime key (Tunnels Read + Use only)
and it was saved directly to NEKODEX without including its value in this report.
Initial tunnel startup failed before connecting: the SDK-global alias for the
production default account collided with a stopped, missing-profile DEV entry
for a different tunnel. This is not a key rejection. New/reconfigured aliases now
include the canonical application home; the old SDK entry remains untouched.
The focused store check proves distinct aliases across homes and stable aliases
within one home. Version 6.1.20 identifies the pending local update.
