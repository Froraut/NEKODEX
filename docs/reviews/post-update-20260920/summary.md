# Post-update recovery and second review

Baseline: published and installed 5.7.0-nekodex.2. Target: 5.7.0-nekodex.3.

The user reported a missing window after updating and a partially filled progress bar at download start,
then requested another backend/frontend/architecture review including tunnel and native-request behavior.
Three bounded Sol lanes reviewed the current release and implemented disjoint accepted fixes. Parent
integrated the protocol, progress UI and final recovery boundary. Workers ran no tests or builds.

Accepted changes:

- Explicit macOS foreground intent after update/restart/reopen, retaining hidden autostart.
- Native renderer-recovery action with active-work protection; no weakening of IPC authorization.
- Shutdown commit after the supervisor's native drain veto, with best-effort cleanup only afterward.
- Ordered tunnel-state revisions and coherent adoption/publication of the current tunnel PID.
- Empty initial transfer state; package verification has no misleading download fill.
- Bounded login polling recovery, explicit stale-account recovery, and structured connector instructions.

The proposal to invalidate durable setup proof on every PID change was rejected: saved config/connector
proof, live capability readiness, and in-flight verification identity are intentionally separate.
A broad rewrite of the service graph was not needed for the accepted defects.

## Observations and limits

The installed .2 app and runtime both reached .2, and health reported native/Web/tunnel availability.
A current process and health response do not prove that the user sees the window. Metadata initially
placed NEKODEX outside the active fullscreen Space. After the host left fullscreen, the current-PID
AX and on-screen CoreGraphics window existed, while the native control provider still returned
noWindowsAvailable after fresh discovery and one REPL reset. That remaining automation-path cause was
not identified; it was not called an application startup crash. A backup with the same bundle ID caused
separate identifier ambiguity; it was preserved and exact app paths were used.

One focused authenticated endpoint case confirmed that a stale loss revision cannot close recovered Web
admission or affect native admission. Five renderer scenarios covered empty progress, verification state,
transient login recovery, stale-account recovery and connector steps. The stale warning was then reduced
to one primary inline notice. A real empty DEV launch confirmed visible/focused startup and separate
account-view ownership. Forced renderer loss exposed detached frames after reload; the final path offers
a captured native recovery prompt and preserves the account views/runtime instead of bypassing the guard.
The test selected Keep running; it did not claim a production restart or live account sign-in.

The global macos-computer-use-recovery and computer-use-issues skills were updated with these evidence
boundaries. The learned-skills maintenance rule also recorded why a loaded page is not sufficient proof
of a usable recovered renderer. Original profiles, cookies and authentication were not copied to tests.
