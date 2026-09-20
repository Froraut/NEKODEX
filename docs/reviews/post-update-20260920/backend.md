# Post-update backend review — launch and window lifecycle

Baseline reviewed: release commit `ba7e030` / `v5.7.0-nekodex.2`. The checkout was on
`715fcfe`; `git diff ba7e030..HEAD` was empty, and release files were read explicitly from
`ba7e030`.

Scope was limited to the Electron main-process startup/window lifecycle, updater launcher and
worker, macOS bundle identity/signing seams, shutdown, and recovery. This was a manual source and
direct-caller review only. No tests, builds, typechecks, scripts, network access, process inspection,
app control, authentication, or live-system actions were performed. Existing unrelated worktree
changes were not touched.

## Implementation status

The three accepted findings are implemented in the current working tree in
`launcher/electron/main.cjs` only. The implementation uses the existing consumed updater readiness
handoff as one-use update foreground provenance, plus a nonsecret restart-only environment marker
that is deleted at process startup. Explicit macOS open/update/restart paths activate the application;
`--hidden` autostart remains hidden.

The file renderer now has one guarded owner for exact main-frame load failure and renderer-process
loss. It reloads that file renderer at most once, never reloads account/ChatGPT web views, and does
not restart the core while work is active. A failed reload uses native user-controlled recovery;
active work can continue and restart is offered only after the lifecycle is idle.

Quit now persists sessions and completes browser veto checks before asking the runtime supervisor for
its final native HTTP/compaction drain. A refused shutdown remains reversible: the supervisor's
compensation is retained, restart eligibility and admission are restored, and the complete application
graph remains open. Only a resolved terminal shutdown result commits exit. After that point,
browser/account cleanup is best effort and every failure is logged while process exit continues;
admission and the dismantled UI are never reopened. No helper module or other owner's
source file was required. Per instruction, this implementation received manual direct-caller review
only; no test, build, typecheck, network, UI, runtime, process, or authentication action was run.

## Diagnosis boundary: the supplied CUA failure is not evidence that the released app failed to launch

The updater necessarily replaces the old Electron process. `runTransaction()` starts the detached
update supervisor and records its PID (`launcher/electron/update-worker.cjs:416-433`), and
`update-launcher.cjs` then starts the replacement application as a different child process
(`launcher/electron/update-launcher.cjs:24-32`). A computer-use binding retained against the old
process can therefore return `procNotFound` until its app/window inventory is refreshed. That is a
stale external handle, not a launcher readiness receipt.

The supplied current evidence is stronger: installed app and configuration are both 5.7.2, the
current parent PID is 13049, and native state proof is true. In this release, a configured candidate
does not acknowledge updater readiness until `startIfConfigured()` is ready, the bridge route has
been connected, and `proveUpdateReadiness()` receives `lifecycleStatus: "local-usable"` with native
availability `ready` (`launcher/electron/main.cjs:1817-1847`). The worker also requires the ready PID
to equal the child PID recorded by the launcher, keeps both the application child and supervisor
alive through a grace interval, and only then commits (`launcher/electron/update-worker.cjs:367-401,
416-436`). On the supplied facts, “the replacement process never opened” is contradicted by the
candidate's own version-bound native lifecycle proof. The remaining plausible product-side problem
is visible window activation or later renderer/window recovery.

The release preserves the intended replacement identity. `launcher/package.json` keeps
`appId: dev.codexwebgpt.launcher`, product name `NEKODEX`, and the compatible production profile;
the staged-update validator requires the matching `CFBundleIdentifier`, `CFBundleExecutable`, and
`APPL` package type before replacement (`launcher/electron/update-validation.cjs:334-368`). Release
packaging separately verifies the extracted ZIP app's deep signature, configured Developer ID team,
stapled notarization, Gatekeeper assessment, and embedded Bun publisher (`launcher/scripts/package.cjs:99-120`).
I found no current source proof of a bundle-identity or signing mismatch that explains this report.

## 1. P2 — a successful macOS update launch has no explicit foreground-activation handoff

**Proof and direct callers.** The update worker invokes `update-launcher.cjs` as a detached process
group (`launcher/electron/update-worker.cjs:416-433`). On macOS, that helper bypasses LaunchServices
and directly spawns `NEKODEX.app/Contents/MacOS/NEKODEX` with ignored stdio
(`launcher/electron/update-launcher.cjs:24-28`). The new main process creates its window hidden. Its
initial `ready-to-show` handler calls only `window.show()` when this is not a hidden login launch
(`launcher/electron/main.cjs:524-560,594-601`). The only `focus()` call is inside
`showMainWindow()` (`main.cjs:477-488`), but normal first startup does not call that function unless
a queued second-instance/tray/browser request has already set `mainWindowShowRequested`. There is no
`app.focus({ steal: true })` or equivalent activation step for an updater-launched candidate.

**Concrete effect.** The candidate can satisfy the worker's process and native-runtime readiness
proof and still leave its first window behind the currently active application or in a non-foreground
activation state. To the user this looks like “NEKODEX did not open,” even though the process and
runtime are healthy. This is consistent with the supplied native proof and is independent of the
temporary stale CUA binding.

**Smallest fix.** Preserve direct execution and the existing readiness environment, but make the
update handoff carry an explicit `foregroundRequested` bit alongside the already authenticated ready
token. After the renderer reaches `ready-to-show`, the candidate should consume that bit once and call
`app.focus({ steal: true })`, then `showMainWindow()`. Ordinary autostart must continue honoring
`--hidden`; background recovery launches should opt in only when they are intended to be visible.
This avoids changing bundle identity or moving readiness secrets into command-line arguments.

## 2. P2 — a dead file renderer leaves a live app that activation cannot repair

**Proof and direct callers.** `createWindow()` installs navigation, close, state, and
`ready-to-show` handlers, but no `render-process-gone`, main-frame `did-fail-load`, or
`unresponsive` recovery handler (`launcher/electron/main.cjs:524-608`). `loadRenderer()` is called
once during startup (`main.cjs:611-617,1679-1682`). After startup, macOS activation is permanently
wired to `showMainWindow()` (`main.cjs:1983`), which returns when the window is absent/destroyed and
otherwise only restores/shows/focuses the existing window (`main.cjs:477-488`). The `closed` handler
explicitly clears `mainWindow` and readiness state (`main.cjs:585-590`), but activation never
recreates it. A renderer process failure can likewise leave the BrowserWindow alive with unusable
web contents and no reload/restart path.

**Concrete effect.** The main process, control server, tray, and native runtime can remain healthy,
so native state proof stays positive, while clicking the Dock icon or reopening the app cannot
restore a usable launcher window. A second-instance request follows the same ineffective
`showMainWindow()` path. This is a real product lifecycle defect, although the supplied
`procNotFound` event alone does not prove that this renderer failure occurred.

**Smallest fix.** Add one bounded renderer/window recovery owner in `main.cjs`. For a main-frame load
failure or `render-process-gone`, attempt one `loadRenderer()` reload against the existing window;
if that fails or the window was destroyed unexpectedly, use the existing native startup-recovery
dialog and controlled relaunch path. `activate` and `second-instance` should call an
`ensureMainWindowVisible()` helper that either shows a healthy renderer or starts that single
recovery action. Guard it with a generation/in-flight flag so repeated Dock clicks cannot create
parallel windows, duplicate IPC registration, or competing relaunches.

## 3. P1 — shutdown can report failure and reopen a partially dismantled application

**Proof and direct callers.** `requestQuit()` performs its user-veto checks first, but then awaits
`runtimeSupervisor.shutdown()` before persisting browser sessions and destroying browser/account
resources (`launcher/electron/main.cjs:1412-1445`). Both later steps may throw. `persistSession()`
flushes every account host through `Promise.all()`, so one failed cookie-store flush rejects the
whole call (`launcher/electron/account-pool.cjs:889`). `closeBrowserResources()` then destroys every
registered lifecycle participant, destroys `browserHost`, and closes `browserControl`; it deliberately
continues through individual failures and throws one aggregate error after those destructive actions
(`launcher/electron/main.cjs:652-675`). `AccountBrowserPool.destroy()` marks the pool destroyed,
clears account operations, destroys every host, and removes its descriptor (`account-pool.cjs:890-896`).
The official account-tools participant closes windows, clears quota readers, destroys its controller,
and marks itself destroyed (`codex-account-tools.cjs:205-213`).

Any rejection from session persistence or resource teardown enters the broad `requestQuit()` catch.
That catch resets `quitting`, calls `allowRestartAfterQuitFailure()`, reopens browser turn admission,
shows the existing window, and reports `{ ok: false }` (`launcher/electron/main.cjs:1449-1459`). It
does not restart the already stopped runtime, recreate destroyed account/browser services, restart
the control server, or re-register their IPC/lifecycle ownership.

**Concrete effect.** A recoverable cookie flush failure after runtime shutdown can return the user
to a visible launcher whose runtime is stopped. A later teardown failure is worse: the same recovery
path can present and reopen admission on objects already marked destroyed, with account windows,
hosts, permissions, descriptor, or control socket partially gone. The update-install caller then
treats Quit as rejected and tries to cancel the updater (`main.cjs:1373-1397`), but the old
application is no longer a coherent recovery target. This is independent of the observed post-update
foreground issue, but it can turn a Quit/restart/update cleanup error into a live broken state.

**Smallest fix.** Give `requestQuit()` an explicit shutdown commit point. Keep every user veto and
recoverable preflight before it: close admission, verify no global operation or active browser turn,
and persist the browser session while all services and the runtime are still intact. Then call
`runtimeSupervisor.shutdown({ force: false })` while exit is still uncommitted, because the supervisor
owns the final native HTTP/compaction drain veto and its compensation. If preflight or shutdown
rejects, call `allowRestartAfterQuitFailure()`, reopen admission, and keep the application graph
usable. Commit exit only after shutdown resolves with a terminal stopped/partial result. From that
point, run `closeBrowserResources()` as bounded best-effort cleanup, log its exact failures, and
continue to `app.quit()`; never route a post-commit failure back through
`openTurnAdmission()`/`showMainWindow()`. For restart, call `app.relaunch()` only after this committed
boundary. This preserves the current native drain veto and forced-partial policy while preventing a
false return to an application whose browser/account owners have already been destroyed.

## Reviewed current paths not reported again

The release has the previously requested structured updater readiness, runtime-generation fallback,
durable `rollback-pending-stop`, replacement process identity records, startup native recovery, and
queued pre-window second-instance visibility request. Those older findings are addressed in
`ba7e030` and are not repeated here. Forced-partial ordinary Quit remains the documented best-effort
policy from the earlier backend review; this lane did not relabel it as a new defect.


## Final integrated recovery boundary

Parent DEV observation on the pinned Electron build showed that a force-crashed renderer can retain
`detached=true` frame wrappers after both loadFile and reload. The IPC guard correctly rejects those
frames. The final implementation therefore routes renderer-process loss directly to a native recovery
dialog and guarded explicit application restart; it does not weaken IPC authorization or claim that
loading HTML recovered the application. A normal main-frame load failure may make one bounded reload
attempt, and the reloaded trusted frame must be live before recovery is acknowledged. Cancelled loads
(ERR_ABORTED) are ignored.

The final targeted DEV case confirmed visible and focused initial launch, an appropriate native
recovery prompt after a forced crash, and unchanged separate account-view identities. The test chose
Keep running and did not stop the runtime. The native dialog was captured by the test harness, not
claimed as a production UI click. The earlier automatic-reload implementation description is
superseded by this observed fail-closed boundary. Postcommit cleanup still exits; a native drain veto
remains precommit and keeps the complete application graph intact.
