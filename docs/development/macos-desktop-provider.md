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
exact generated executable path and SHA-256. The fixed output is under
`launcher/electron/desktop-helper/darwin-<arch>/`; distribution signing requires
an explicit signing-owner port. This source change does not add a release or
package entry. The native deployment target is macOS 14; the main application's
minimum OS version is unchanged. No Windows/Linux native implementation is
claimed.

The Bun constructor receives only a trusted resolved executable and pin. The
child has private captured stdio, no shell and no arbitrary CLI arguments. It
does not restart or replay automatically. Parent exit ends the helper; the
helper also checks parent identity immediately before input. Explicit disable,
abort and close stop the exact owned helper and wait for its exit. No other app
is launched, activated, restarted or terminated by this provider.

## Permissions and selected window

Status reads only `CGPreflightScreenCaptureAccess`, `AXIsProcessTrusted` and
`CGPreflightPostEventAccess`. There is no permission-request API or TCC/global
policy change. Screen capture, Accessibility and event-posting flags remain
separate; background AX operations do not require event-posting permission.
Missing permission or a missing exact window binding yields unavailable/refused
operations, not a synthetic successful observation.

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
intervening global input/modifier state. Immediately before dispatch, real AX hit-testing at
the point must resolve to the exact retained selected AX window, not through a
sheet, menu or popover, and without passing through another process. CG stacking
also refuses any layer-0 window, or any selected-PID window at any layer, above the
selected window there. Non-intercepting system overlays, such as the macOS 27
full-screen Dock and screencaptureui layers, are left to AX. Foreground handoff
input requires a foreground observation; otherwise it is refused as
`observe-with-foreground-required`. There are no global shortcut, keyboard
fallback, pasteboard, arbitrary AX attribute or arbitrary process-command APIs.
Successful receipts establish dispatch/AX acceptance, never a clicked business
property or verified inserted result. OS input is not an atomic transaction;
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
foreground CG pixel-click fallback and other applications remain unverified.
The final task correctly remained `review_required`; this is DEV evidence,
not verified task completion or an installed-app, packaged-release or production
result.

Primary API grounding is the selected Apple SDK's ScreenCaptureKit headers
(`SCStream.h`, `SCShareableContent.h`, `SCScreenshotManager.h`), CoreGraphics
`CGWindow.h`/`CGEvent.h`, and HIServices public AX headers. No private window-ID
lookup or permission-control symbol is used.
