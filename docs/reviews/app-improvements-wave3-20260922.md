# NEKODEX — third Astra wave, 2026-09-22

User-requested continuation of the two-wave improvement task. Baseline
`40cd571b616d9d984ce83179784d2d40b9c52385`; same branch
`codex/app-improvements-20260922` and draft PR #19. Source version remains
`5.9.0-nekodex.5`; no installed replacement or release is included.

Sixteen new agents were explicitly dispatched as `gpt-6-astra`, medium reasoning.
Each reviews the current implementation and may implement at most two justified,
bounded improvements in its assigned area; a no-change verdict is allowed.
One writer per file area. The coordinator owns shared types, fixture wiring,
integrated checks, review records and source publication.

| Lane | Ownership |
| --- | --- |
| tasks | TaskCenter and its stylesheet |
| queue | Admission queue and QueueControls |
| account-forms | Account forms, validation, presentation |
| workspaces | Workspace storage/windows and manager UI |
| usage | Usage statistics, export and presentation |
| overview | Readiness, Overview and tools onboarding |
| updates-ui | Update progress and controls |
| shell | App navigation, Settings, route diagnostics |
| chrome-auth | Existing/profile-first Chrome login and binding |
| account-backend | Account pool, safety and task ledger |
| artifact-files | Artifact downloads, file access and Manual attachments |
| native | Native transport, cache and usage delivery |
| request-attachments | Prompt attachments, request schemas/parsing |
| compaction | Compaction lifecycle/checkpoints |
| integration-tunnel | Codex integration transactions and tunnel installation |
| runtime-updater | Runtime supervision and updater recovery |

Verification reuses prior passing evidence for unchanged behavior. Each writer
selects meaningful narrow checks for its delta. Coordinator checks integrated
types/build and affected UI flows once changes settle, adding targeted follow-up
only for changes or failures. No default full suites, live account mutations,
provider submissions, actual updates or production route changes are planned.

## Delivered results

All 16 lanes completed source review and implementation. Dispatch identifiers
are in [the wave-3 manifest](app-improvements-wave3-20260922-agents.json).

| Area | Delivered change | Focused cases passed |
| --- | --- | ---: |
| Tasks | Safe-choice focus, Escape/Keep return focus, live-row removal fallback and preserved filter focus | 8 |
| Queue | Priority changes affect the next awaited admission; removed account resets visible and actual control scope | 3 |
| Account forms | Consistent input styling; unsaved proxy draft survives changed host evidence and restores latest saved value | 2 |
| Workspaces | Transient loading/auth windows count and remain manageable; coalesced bounds flush; overflow rejects writes without overwriting the prior manifest | 4 |
| Usage | CSV retains daily date, selected-account scope and observation time; spreadsheet formula-leading text is neutralized | 3 |
| Overview | Current-version smoke/credential evidence; derived account/runtime priority over retained catalog failure | 3 |
| Updates UI | Installation handoff overrides pending cancellation presentation and removes obsolete cancellation promises | 1 |
| Settings | Live capacity metadata with draft preservation; new Doctor request retires old successful evidence | 3 |
| Chrome login | Safe errors across chooser/isolated-capture boundaries; cancellation rechecks after awaited setup/capture | 7 |
| Account backend | Direct starts reject unhealthy task history before pacing/reservation; multipart acceptance evidence never regresses | 2 |
| Artifacts | Terminal failure removes partial bytes; cancellation settles before external callbacks; finite positive integer completion size | 5 |
| Native | Replay validation matches receiver timestamps/token relationships; invalid usage does not discard the terminal outcome | 2 |
| Requests | Namespaced/deferred known-function validation; discovery names match callable tool projection | 6 |
| Compaction | Preserve earlier current-turn items inside replay; cancelled waits cannot consume buffered capabilities | 5 |
| Integration | Exact uninstall write/removal ownership; preserve concurrent replacement and regular/symlink permission edits | 6 |
| Updater backend | Carry failed-preparation relaunch ownership; persist terminal rollback before cleanup eligibility | 6 |

The 66 cases include a small number of existing directly affected controls.
Unchanged passing checks were reused. No package/repository default suite ran.
The parent separately exercised seven changed renderer flow groups and one
isolated source Electron startup/navigation pass.

## Independent review and resolutions

- Compaction: reviewed exact-object replay metadata, current native-turn boundary,
  checkpoint parent matching and actual cancelled capability consumers. Accepted
  the conservative retention of current input; no new recovery authority.
- Account backend: traced multipart send receipts through worker, host, ledger,
  restart, retrySafe, queue cancellation and release predicates. Accepted the
  monotonic evidence and selected-account history refusal; no automatic fallback.
- Integration: counter-review found that an attempted but uncommitted uninstall
  write could still enter unguarded compensation, and ordinary-file chmod was not
  represented. Both corrected: only returned write receipts or successful removal
  markers authorize rollback; regular-file modes are captured and compared too.
  Independent re-review closed both findings. setup.ts's broader legacy rollback
  procedures remain outside this scoped change and are not certified here.
- Updater: independent review accepted the source delta but found its initial
  post-replacement fixture failed earlier identity/bundle validation. Corrected
  it to pass the real validator, assert new candidate bytes at `after-replace`,
  assert that checkpoint outside the catch, and retain the injected failure as
  rollbackReason. The corrected case passed; no production validator was weakened.
- Workspace overflow was not left hidden behind a lane planning limit. Writes
  exceeding 16 unique valid entries now fail before changing the durable file,
  show the existing persistence warning, and recover when the total fits.

## Parent verification

- Root TypeScript passed after a new test's Buffer matcher typing was corrected.
- Launcher TypeScript and renderer build passed. A final renderer-only rebuild
  included the later workspace persistence copy. Final assets:
  `index-B3E67_H-.js` and `index-BzWYyHSU.css`. Existing bundle-size advisory remains.
- Browser helper development build passed; no distribution packaging occurred.
- All changed CJS files passed syntax checks; `git diff --check` passed.
- Seven groups in `launcher/tests/astra-wave3-ui-preview.cjs` passed: keyboard and
  live-row focus, queue account removal; proxy draft/validation/style; actual CSV
  download contents; pending cancel versus installing; capacity refresh and Doctor
  failure; Overview evidence priority; transient workspace/persistence warning.
- Browser verification used isolated Chromium, fixture-only IPC, desktop 1280px
  and compact 760px views, with screenshots inspected and no page errors. Initial
  failed observations came from fixture/selector assumptions (actual CSV/Doctor
  labels, Doctor's message field, and authentication precedence over a transition).
  Corrected only those fixtures and reran affected groups.
- Actual source Electron launched through the repository's Electron executable
  and launcher entrypoint with a fresh temporary DEV home, manual-mode seed and
  no account credentials or configured integration. Verified `NEKODEX DEV`, exact
  userData/coreHome/codexHome isolation, actual preload/snapshot IPC, and Overview,
  Accounts, Task center and Settings. No page errors; source version
  `5.9.0-nekodex.5`; configuration remained absent. Its process (PID 63455) exited,
  and the task-owned temporary profile was removed. Screenshots and the compact
  identity/result record remain in ignored `launcher/output/playwright/astra-wave3/`.
- The installed production process (PID 26812, started September 21) remained
  running at `/Applications/NEKODEX.app`; no replacement/restart was performed.

## Limits and knowledge correction

This is a source/development update to PR #19, not an installed release. Backend
faults use temporary filesystem/EventEmitter/IPC fixtures; native Windows, actual
Chrome login, provider replies, real updater installation and OS recovery
registration were not exercised. No account credentials, live route or production
configuration changed.

Saved-plus-live workspace manifests remain limited to 16 valid entries per
account. Overflow preserves the last durable file and warns that current windows
are not fully saved; no eviction or unlimited retention is claimed. Ordinary
integration publication retains its existing 0600 policy; guards preserve
external permission edits but are not a filesystem compare-and-swap primitive.
Existing process-local compaction retention and broader setup rollback limits
remain as documented in the previous report.

Under the user's standing learned-skill authorization, the local
`right-size-test-runs` instruction now requires proof that a fault-injection
fixture reached its claimed phase before treating the result as coverage. The
small edit preserves verification limits and was metadata-validated. Only that
resource and its archive entry were preserved in the private skills repository
on an isolated branch, preserving unrelated concurrent staged archive work.
