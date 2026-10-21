# Owned macOS desktop provider

`src/browser-companion/macos-desktop.ts` implements the existing
`DesktopProviderPort` through the fixed Swift stdio helper
`launcher/native/desktop-provider.swift`. It starts disabled. Only trusted user
controls can enable it and select a window. Model-facing observation/input never
accept executable paths, raw native commands, shell text or network destinations.
One Bun owner holds the helper, selection, current observation and operation
correlations; Electron must delegate to that owner rather than start another
helper.

## Build and ownership

`bun scripts/build-desktop-helper.cjs --development` performs ordinary Swift
compilation and development signing without launching the helper. It emits the
exact generated bundle and executable paths and the executable SHA-256. The
fixed output is the app bundle
`launcher/electron/desktop-helper/darwin-<arch>/NEKODEX Desktop Helper.app`
(executable `Contents/MacOS/nekodex-desktop-helper`, fixed `Info.plist` with
`CFBundleIdentifier` `dev.nekodex.desktop-provider.v1` and `LSUIElement`); a
leftover bare executable from earlier builds is removed. Only a Developer ID
build carries that release identifier. An ad-hoc build (every `--development`
build, and a runtime bundle built without a publisher identity) carries
`dev.nekodex.desktop-provider.development.v1`, named "NEKODEX Desktop Helper
(Development)", and `signDesktopHelper` refuses either mix; see
[TCC grants across updates](macos-desktop-tcc-updates.md). The runtime bundle
copies the whole signed bundle, the packaged asset contract requires its
executable and `Info.plist`, and release signing and installed verification
sign and check the bundle, so its seal covers `Info.plist`. Distribution signing
requires an explicit signing-owner port. This source change does not add a release or
package entry. The native deployment target is macOS 14; the main application's
minimum OS version is unchanged. No Windows/Linux native implementation is
claimed.

The Bun constructor receives only a trusted resolved executable and pin. The
child has private captured stdio, no shell and no arbitrary CLI arguments. It
does not restart or replay automatically. Parent exit ends the helper; the
helper also checks parent identity immediately before input. Explicit disable,
abort and close stop the exact owned helper and wait for its exit. No other app
is launched, activated, restarted or terminated by this provider.

## Permission identity across updates

macOS TCC does not judge the process that calls a permission API; it judges
that process's *responsible* process, which a spawned child inherits. Before
this change the helper ran inside the runtime's process tree, so TCC judged
whichever app or terminal had started that runtime. Live diagnosis on
6.1.33-nekodex.6 (2026-10-21, read-only: `log stream`/`log show` with
`subsystem == "com.apple.TCC"`, plus the libsystem responsibility query that
`launchctl procinfo` prints) showed:

- Under NEKODEX.app, the bun daemon and the helper are both attributed to
  `dev.codexwebgpt.launcher` (NEKODEX.app, pid of the app). That client had no
  Screen Recording, Accessibility or post-event entry, so all three read false.
- The earlier 6.1.33-nekodex.3, .4 and .5 checks that read all three as granted
  were attributed to `com.anthropic.claude-code`: the helper had been started
  from a terminal session, and the grants were that terminal's, not NEKODEX's.

So the grant was never NEKODEX's own, and which grant applied depended on who
started the runtime: a terminal, NEKODEX.app, or a daemon that outlived the app
instance that spawned it. Granting NEKODEX.app instead would hand Screen
Recording and Accessibility to every process NEKODEX starts, including model
tool shells.

The helper now ships as the bundle above and becomes its own responsible
process. When it starts without being self-responsible, it spawns its own
canonical bundle executable once with `posix_spawn` and
`responsibility_spawnattrs_setdisclaim`, then only supervises it. This
libsystem call has no public header; it is resolved with `dlsym`, and it is the
same mechanism Chromium and LLDB use for their helpers. It is a process
attribution call, not a permission-control symbol: it changes no TCC state and
grants nothing. The disclaimed helper:

- inherits exactly the owner's three stdio ports (`POSIX_SPAWN_CLOEXEC_DEFAULT`)
  and the same fixed `PATH`/`LANG`/`LC_ALL` environment the Bun owner already
  uses, plus a stage marker that forbids a second hop;
- is supervised by the first process, which keeps no copy of the ports (stdin
  EOF and closure reach the helper directly), forwards SIGTERM/SIGINT/SIGHUP,
  kills the helper when its own owner disappears, and exits with the helper's
  status;
- requires before input both its own parent (the supervisor) and the
  supervisor's original parent (the Bun owner), failing closed if either
  changed or cannot be read.

"Self-responsible" means the full responsibility record: the responsible pid
*and* the responsible path must be the helper's own canonical executable. On
6.1.33-nekodex.8 under macOS 27 the record for the Bun daemon and the helper
named their own pid but `/Applications/NEKODEX.app/Contents/MacOS/NEKODEX` as
path; tccd judges that path, so screen capture was evaluated for
`dev.codexwebgpt.launcher` and stayed false while the helper's Accessibility and
post-event grants (evaluated for the accessing helper) read true. A pid-only
check had skipped the disclaim. The helper reads the record with
`responsibility_get_responsible_for_pid` and disclaims unless both match.

TCC then keys the client as the bundle identifier
`dev.nekodex.desktop-provider.v1` with the designated requirement
`identifier "dev.nekodex.desktop-provider.v1" and anchor apple generic and …
certificate leaf[subject.OU] = CNMWGJF2CG`. Neither depends on the bundle's
path, so one grant survives every signed update and covers nothing but this
helper. Each row keeps the code requirement of the build that created it, and
toggling never rewrites it: on 6.1.33-nekodex.10 the Accessibility row held an
ad-hoc DEV cdhash, because DEV builds then shared the release identifier, so no
release matched it. DEV builds now carry their own identifier
(`dev.nekodex.desktop-provider.development.v1`); being ad hoc, their
requirement is a cdhash and each rebuild needs its own grant. If the call is
unavailable or the spawn fails, the helper serves inline with inherited
attribution; `status` reports this through `permissionClient.selfResponsible:
false` and the UI warns not to grant the parent app.

**Stable location.** An installed runtime does not run the helper from its
per-version directory. `ensureStableDesktopHelper` copies the runtime's own
verified sibling bundle byte for byte to
`~/Library/Application Support/NEKODEX/Desktop Helper/NEKODEX Desktop Helper.app`
(directory mode 0700, owned by the user, never a symlink) and the provider is
pinned to that copy's SHA-256. The transport re-runs the same check before
every helper start: an equal copy is left untouched; a different one (another
runtime version, damage or tampering) is replaced through a staging directory
and an atomic rename, and the pin is verified afterwards. So System Settings
always lists one path that survives updates and pruning. The location must not
be inside another `.app`: a probe of the signed helper inside
`NEKODEX.app/Contents/` was judged as `dev.codexwebgpt.launcher` for Screen
Recording although it was self-responsible. An explicit DEV pin (source CLI)
keeps its checkout path. Details and the evidence are in
[TCC grants across updates](macos-desktop-tcc-updates.md).

Because the grant now belongs to the helper rather than to whoever spawned it,
speaking the helper's stdio protocol must not be enough to use it: any
same-user process could exec the bundle. So the first `enable` of each helper
process shows a system alert from the helper itself
(`CFUserNotificationDisplayAlert`, "Allow NEKODEX desktop control?"). It is not
a TCC prompt and changes no TCC state. The default button refuses, a
120-second timeout refuses, and only **Allow** enables the provider (otherwise
`enable-not-confirmed`). The answer is kept only in that process, whose stdio
belongs to the owner that started it; it is never persisted, because a stored
answer would serve whoever starts the helper next. "Disable and release desktop
access" and a restart end the process, so the next enable asks again. A
caller without its own Accessibility or post-event rights cannot answer that
alert, and before a confirmed enable the helper cannot capture, select or input.
`listWindows` before a confirmed enable returns owner names and identities with
empty titles, because titles depend on the helper's screen recording grant.
The Bun owner waits for this answer without its 12-second request deadline;
abort and close still stop the exact helper. `openPermissionSettings` stays
available without confirmation: it can only make macOS show its own prompt for
the helper, and the user still decides.

**One-time re-grant.** Grants made before the bundled helper belong to
NEKODEX.app or a terminal and no longer apply. An Accessibility row created by
an earlier DEV build must be removed with **–** and added again; a toggle does
not repair it. The exact steps are in
[TCC grants across updates](macos-desktop-tcc-updates.md#one-time-repair-after-installing-this-change).
Later signed updates keep the rows. Older entries for NEKODEX or a terminal can
be turned off.

## Permissions and selected window

Status reads only `CGPreflightScreenCaptureAccess`, `AXIsProcessTrusted` and
`CGPreflightPostEventAccess`, and reports `permissionClient`: whether the helper
is self-responsible, its bundle identifier, name (`NEKODEX Desktop Helper`) and
bundle path. Status never prompts or changes TCC state. Screen capture,
Accessibility and event-posting flags remain separate; background AX operations
do not require event-posting permission. Missing permission or a missing exact
window binding yields unavailable/refused operations, not a synthetic
successful observation.

The only request path is the explicit `openDesktopPermissionSettings` admin
action (`permission`: `screenCapture`, `accessibility` or `postEvent`), behind a
per-permission "Open …" button that appears when that permission is missing.
Only when the helper is self-responsible does it call the matching public
request API (`CGRequestScreenCaptureAccess`,
`AXIsProcessTrustedWithOptions` with the prompt option, or
`CGRequestPostEventAccess`) so that macOS lists "NEKODEX Desktop Helper",
possibly with its own prompt; it never registers a parent app. It then opens
`x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture`
or `?Privacy_Accessibility` (post-event access is granted in Accessibility) and
re-reads status. It never grants access, enables the provider, selects a
window, captures or inputs; the user decides in System Settings. A new Screen
Recording grant applies to a fresh helper process, so after granting choose
Disable and release desktop access, then inspect again. If the entry is not
listed, add the bundle path shown in the UI with + and Command-Shift-G.

Window inventory uses bounded on-screen window/process metadata. Selection binds
CG window ID, PID plus kernel process-start seconds/microseconds and a metadata
epoch. Kernel `PROC_PIDTBSDINFO` supplies the start identity; unavailable/incomplete
process data refuses the window rather than falling back to PID alone.
`NSRunningApplication.launchDate` is deliberately excluded: direct-executable
GUI launches can have a valid running application but no LaunchServices launch
date. The helper
retains a uniquely matched public AX window reference and checks that exact
reference still belongs to the process. Capture also requires that reference,
so reuse of a CGWindowID without the original AX window cannot silently select
another window. Titles can be unavailable under OS privacy policy; ambiguous AX
geometry/title matching is refused. Selection and screenshots are not persisted.

Observation captures the selected single window through ScreenCaptureKit, with
no cursor or shadow, preserving the declared screenshot-pixel coordinate map.
Window/process instance, frame, scale and AX state are checked around capture.
The image is capped at 16,777,216 pixels and 8 MiB PNG bytes. The binding carries
the full PNG SHA-256, provider/scope/observation IDs and frame/window epochs.

PNG user resources remain memory-only. `modelImage` re-encodes that cached PNG
to JPEG at the same dimensions, trying at most five fixed qualities until it
fits 160 KiB; it never resizes or captures another image. The JPEG's own hash,
dimensions and `sourceScreenshotId` linking the PNG are checked. If no quality
fits, model-image delivery fails rather than substituting another mapping. The
model tool should return this as actual MCP image content; base64 text is not a
substitute for a model-visible image.

## Input and receipts

Input consumes an exact current observation once. Before input, the helper
recaptures the selected window and requires the same screenshot hash/frame,
process/window instance and selected AX target state. Supported button/control
clicks use a cached unambiguous AXPress reference scoped to the selected window.
Literal text targets only the captured supported focused text control and its
unchanged selected range/value. It inserts selected text, or preserves the
captured prefix/suffix when the only supported setter is AXValue. Secure or
unsupported text controls are refused. This AX route works with the selected
window in the background and does not activate it.

Generic pixel-click fallback requires the exact selected window/process already
frontmost and focused, post-event permission, unchanged focused element and no
intervening global input/modifier state. Immediately before dispatch, the window must
still have the observed frame, and real AX hit-testing at
the point must resolve to the exact retained selected AX window, not through a
sheet, menu or popover, and without passing through another process. CG stacking
also refuses any layer-0 window, or any selected-PID window at any layer, above the
selected window there. Non-intercepting system overlays, such as the macOS 27
full-screen Dock and screencaptureui layers, are left to AX. The click is a
mouse-moved, down and up sequence posted only to the selected process and addressed
to the selected window at the window-relative point, so it cannot reach another
application and does not move the pointer. AppKit drops a PID-posted event without
a window number and window-relative point, and the public window-under-pointer
fields do not supply them. The events are therefore built with the public NSEvent
mouse-event constructor and checked before dispatch; a record that differs from the
expected one is refused as `event-unavailable`. Foreground handoff
input requires a foreground observation; otherwise it is refused as
`observe-with-foreground-required`. There are no global shortcut, keyboard
fallback, pasteboard, arbitrary AX attribute or arbitrary process-command APIs.
Successful receipts establish dispatch/AX acceptance, never a clicked business
property or verified inserted result. A click receipt names its exact target:
the consumed observation id, the screenshot-pixel point and the window-relative
point (top-left origin, points) it maps to through the observed window size.
Property reads report each element's frame in the same window-relative points,
so a reviewer can judge containment without pixels; geometry is metadata, never
part of the input binding. OS input is not an atomic transaction;
revalidation occurs immediately before the fixed action and cannot eliminate
every concurrent human/application change afterward.

`actWithOperation` accepts the trusted ToolJournal-derived UUID; `act` supplies a
fresh UUID for callers without an existing journal operation. The existing
ToolJournal remains the only durable journal. An input wait expiring returns
unknown while retaining the same live helper/request and late reply. It does
not kill or resubmit accepted input. `readExistingReceipt(operationId, binding)`
reads only retained facts and can reconcile the late terminal reply; it never
starts a helper, observes, enables or inputs. An uncertain operation blocks new
observations/input until a terminal fact is reconciled. If its helper/parent is
gone and no terminal receipt exists, uncertainty remains.

Cancellation signals passed to native input must mean explicit user stop/task
retirement/host close. A generic tool's technical observation-budget timeout
must not be forwarded as that cancellation signal. `passiveStatus()` exposes
logical work, physically retained input and closing-owner counts without any
native call or process start. Shutdown must close this provider before waiting
for a retained input to drain.

## Verification boundary

The focused TypeScript cases use injected transport facts to exercise default
off state, exact owner/frame/image matching, bounds, image-seal checks,
single-use observations, unknown-result latching and late read-only
reconciliation. Synthetic JPEG marker bytes in that contract case establish
header/hash ownership, not rendering or native codec output.

Ordinary native compilation and passive permission/window-metadata reads remain
separate from OS capture/input delivery. The following connected DEV evidence
was supplied by the root's actual product-UI/Cua flow on 2026-10-18, using the
isolated inert AppKit fixture. MCP remained disabled during this check.

| Boundary | Observed evidence | Limit |
| --- | --- | --- |
| Selected window and process instance | The kernel-start helper listed and bound fixture window `12374`, PID `18648`, title `NEKODEX Desktop Fixture · fc3cc9a7`, through the product UI. | This establishes that directly launched GUI windows are admitted with the kernel identity fix; it does not authorize another window or process. |
| OS permissions | Product UI showed screen capture, Accessibility and post-event permission flags all `true`. | These were observed grants, not permission requests or changes made by the provider. Their state must be refreshed for another live owner. |
| Native capture and model image | The first actual observation produced a 70,027-byte JPEG at 1120 × 624 pixels; its preview was visually checked through Cua. A second observation produced a 78,916-byte JPEG. The final click flow used a fresh 1120 × 624 observation with ID prefix `504555ac` in a new task with ID prefix `f2fe`. | These are actual native-image delivery facts, separate from the marker-only unit fixture. Capture alone is not proof of input; the click has its own receipt and readback below. |
| Separately approved literal text input | The native receipt was `completed` with the `ax-literal-text-dispatched` reason. Cua separately read the actual text field and recorded-text label as exactly `NEKODEX desktop DEV 20261018`. | The receipt establishes AX dispatch; the separate visible readback establishes this fixture's text result. Neither implies general business-result verification. |
| Separately approved button click and counter effect | The product UI approved screenshot coordinates `(280, 290)` against that fresh exact binding. Operation ID prefix `03e6f42e` returned `completed` with `ax-press-dispatched`. At Cua readback time 11:38:08, the actual fixture showed `Counter: 1` and the literal text remained exactly `NEKODEX desktop DEV 20261018`. Its private state receipt had sequence `3`: launch, one text change and one counter-button action. | This establishes the fixture's screenshot-coordinate mapping to the cached AX target and actual AXPress/counter effect. The generic foreground CG pixel-event path was not exercised. Identifier prefixes here are labels for supplied evidence, not complete replay keys. |
| UI transport follow-up | The earlier UI HTTP/history 128 KiB pending-metadata problem was fixed in core and UI. The fresh task then completed the separately approved native click flow and delivered its canonical click result to the third synthetic model offer. | This connected flow replaces the earlier pending-click limitation; it does not establish unrelated HTTP payload sizes or a real external-model call. |
| Agent outcome status | The synthetic flow reached `review_required` after 3/3 offers, including the final canonical click result. | It was not marked verified-complete. The visible fixture result and the model's final report remain distinct from backend property verification. |
| Last retained DEV lifecycle state | After the successful fixture readback, root began closing the helper, DEV GUI/core and fixture. | Closure completion is not established by this evidence update. Another owner still requires its own selection and fresh observation; this is not a claim of current post-restart readiness. |

This evidence covers the selected fixture's native capture, visible JPEG
delivery, literal text result, approved screenshot-coordinate-to-AX target
mapping and actual AXPress/counter change after the transport fix. Generic
foreground pixel-click delivery to a fixture through the development helper is
recorded separately in `docs/reviews/2026-10-19-desktop-foreground-handoff.md`;
installed acceptance and other applications remain unverified.
The final task correctly remained `review_required`; this is DEV evidence,
not verified task completion or an installed-app, packaged-release or production
result.

Primary API grounding is the selected Apple SDK's ScreenCaptureKit headers
(`SCStream.h`, `SCShareableContent.h`, `SCScreenshotManager.h`), CoreGraphics
`CGWindow.h`/`CGEvent.h`, AppKit `NSEvent.h` and HIServices public AX headers. No
private window-ID lookup, event field or permission-control symbol is used.
