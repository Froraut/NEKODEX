# Explicit desktop foreground handoff

Ordinary GUI approval changes the foreground application and the local input timestamp. The generic CG input branch previously required both to remain unchanged since its screenshot, so the normal approve button prevented a positive pixel-input flow. AX actions on a selected background window and authenticated approval without local input were separate paths; neither proved that GUI pixel input worked.

## Product change

`desktop/observe`, `desktop/click` and `desktop/type` now accept optional literal `waitForForeground:true`. This is part of the exact saved model arguments, discovered schema, approval fingerprint and native operation identity. Existing calls without the field retain their old behavior. The MCP desktop adapter refuses this native-only mode explicitly.

After approval the native helper waits for the human to return the exact selected window to the foreground and release physical keys/buttons. It never activates an application, adjusts the selected point, accepts a caller timestamp or expires the user's consent. Waiting checks window/parent/input metadata without repeatedly capturing screenshots. Revocation, abort, disabled provider, parent loss or closed stdin stops the owned wait.

For input, the original binding remains unchanged. The helper requires the same process/window, frame, screenshot SHA and focused element after handoff. Only that independently matching preflight establishes a private post-handoff input baseline. New input during capture or before dispatch is refused; exact foreground, owner, focus, frame and occlusion checks remain immediately before effect. There is one consumed attempt, and unknown outcomes cannot be replayed.

The approval panel explains this mode before consent. Its cancellation control keeps the original task/generation/call scope and remains usable while the ordinary panel is busy. It uses the existing dedicated window-revocation route; cancellation does not claim rollback of already dispatched input. An IPC observation timeout does not remove the retained cancellation scope or authorize another invocation.

## Evidence so far

- Focused controller/native transport verification: **three cases,82 assertions**, pinned Bun1.4.0. These are inert transport checks, covering exact mode forwarding, preserved binding/operation identity, late-receipt mismatch refusal and abort without new capture/input.
- Core and renderer TypeScript passed. Renderer build passed:222modules/1.13seconds.
- Updated Swift helper development compilation passed; SHA-256 `cef9834867ba9ba90b77580d24e712c4c5bc72c699290e3c90cf564253f36f98`.
- Independent scoped source review found no actionable ownership, cancellation or argument-forwarding issue.
- Actual helper permission preflight reported Screen Recording, Accessibility and Post Event available. The helper was closed with0active requests. That preflight captured no image and dispatched no input.
- Actual CUA exercised the real `AgentToolsSurface` and its CSS in a separate offline Electron fixture with only the API replaced. Approve held the call pending; CUA observed Refresh/Approve disabled and Cancel enabled. Clicking Cancel sent the original frozen scope, settled the pending synthetic call as failed and restored the UI. Screenshot layout was inspected. The fixture exited normally and its PID85295 is absent. Native/model/network/VM calls were0.

The offline UI fixture's DOM instrumentation recorded `approveDisabled:false`; this is not adopted as proof of enablement. The independent CUA accessibility state and screenshot showed the approve control disabled. Raw event history is preserved for diagnosis rather than rewritten.

A separate compiled Cocoa fixture has a mouse-only purple NSView with AXImage role and no AXPress, plus a read-only counter. It is prepared for actual pixel input and independent AX-property verification. After explicit per-call approval, one successful real `desktop/observe` returned the selected window at 1120 x 624 with `Counter: 0`. An earlier foreground-wait request settled failed/not_sent with no image and was reconciled and closed before the successful ordinary background observation. The successful JPEG hash is `b1b8683e3aa37025434d798acc36cfc92e759249f79f643e557a7221ccea5b83`. No click or type was invoked. The driver closed with zero active requests, and the task-owned Cocoa fixture was then closed; all related PIDs were absent. Positive foreground handoff, CG dispatch, counter mutation and independent verifyProperty are therefore **not yet accepted**.

Local raw evidence is under `/Users/alex/Documents/ChatGPT/Nekodex/reviews/evidence/native-integrated-20261019/`: `foreground-permissions-preflight.json`, `foreground-ui-fixture/owner.json` and events, retained Cocoa source, `foreground-observe-completion.json` and successful `foreground-driver-evidence/6fad17ec-26e3-4e08-8951-fbddd2bac1e8/`. The driver uses the real StandaloneMcpHost and ToolJournal with a synthetic exact QA task,0model offers, no service socket and no automatic subsequent call.

## P13 live acceptance finding (2026-10-21, macOS 27.2)

Two defects blocked the generic CG pixel click in the live P13 run. Raw evidence is under `/Users/alex/Documents/ChatGPT/Nekodex/reviews/evidence/native-integrated-20261019/p13-cg-click-20261021/`.

**Stacking check refused every pixel click.** `pixelTarget` accepted only when the first on-screen CG window containing the point with alpha > 0 was the selected window. On macOS 27 the Dock always owns a full-screen layer-20 window (0,0,1728,1117, alpha 1) that does not intercept input. While its toolbar is open, screencaptureui adds a full-screen layer-24 "Screenshot" window too. In attempt 3 (task `354c7709`), observe with `waitForForeground` passed. The click was then refused with `pixel-target-occluded-or-changed`, although the fixture was frontmost and visibly unobstructed. At the click point (708,374), the stack was Screenshot (24), Dock (20), then the fixture (0). CG has no public key that marks a window as not intercepting input, so CG ordering alone cannot tell these overlays from a real covering surface.

The fix makes real Accessibility hit-testing the authority. `AXUIElementCopyElementAtPosition` on the system-wide element, with a 1-second messaging timeout that is restored to the default afterwards, must return an element of the selected PID. Its parent chain must reach the exact retained AX window (`CFEqual` with the selected AX reference), and its `AXWindow` attribute must agree when the element reports one. The chain must not pass through a sheet, menu, menu bar or menu bar item, drawer, popover or the application element. CG remains a second, conservative check. Any layer-0 window stacked above the selected window at the point is still refused, and so is any window of the selected PID at any layer. The selected window must contain the point. Other processes' non-zero-layer overlays are left to AX. The held-mouse-button check is unchanged. The whole check still runs immediately before dispatch, after the final `inputOwner`; the CG and button reads come last because they are cheaper and change faster. A failed or timed-out hit test refuses with `pixel-target-hit-test-mismatch` or `pixel-target-hit-test-unavailable`. One consequence is conservative: a click over a cross-process remote view embedded in the window, which reports another PID, is refused rather than allowed.

Local hit-test-only validation on 2026-10-21 ran the helper's actual `pixelTarget` code, compiled with a harness, against the running fixture window (PID 24365, frame 584,206,560,312). The Screenshot (24) and Dock (20) overlays were present. No click or other input was sent to the fixture or NEKODEX. The development helper compiled with `scripts/build-desktop-helper.cjs --development` has SHA-256 `a0dd872befa80d69af272f62ce6e7f64d83eec0fcbd754c1fb74f93c4e85d5aa`. Focused desktop controller and native transport tests passed: 19 tests, 232 assertions, Bun 1.4.3, including the compiled helper's passive status case.

| Point / condition | Previous CG-first result | New result |
| --- | --- | --- |
| Purple view (708,374), Dock + Screenshot overlays only | `pixel-target-occluded-or-changed` | pass (AX: fixture `AXImage`, window equal) |
| Title bar (700,215) | `pixel-target-occluded-or-changed` | pass (AX hit is the selected `AXWindow` itself) |
| Outside the window (500,600), ChatGPT beneath | refused | `pixel-target-hit-test-mismatch` |
| Menu bar (100,10), fixture's own menu bar item | refused | `pixel-target-hit-test-mismatch` |
| Dock item (864,1105) | refused | `pixel-target-hit-test-mismatch` |
| Separate-process 40x40 overlay at layer 0, accepting mouse | refused | `pixel-target-hit-test-mismatch` |
| Same overlay at layer 3, accepting mouse (CG would skip it) | refused | `pixel-target-hit-test-mismatch` |
| Same overlay at layer 3 or 20 with `ignoresMouseEvents` | refused | pass |
| Same overlay at layer 0 with `ignoresMouseEvents` | refused | `pixel-target-occluded-or-changed` (conservative CG rule) |

Synthetic CG stacks gave the expected results: overlays only → unobstructed; another app's layer-0 window → refused; a same-PID layer-101 window → refused; selected window missing or with another PID → refused. This is hit-test evidence only. A positive live CG dispatch and counter change still need a new P13 run.

**Background observe followed by foreground input could never pass.** In attempt 1 (`acceptance-attempt1.json`), observe ran without `waitForForeground` while the fixture was inactive, and click then ran with it. After the handoff, the fresh capture shows active window chrome, so its PNG SHA can never equal the inactive-chrome binding. The click was refused late with `screen-or-frame-changed`, after the human had already returned the window. The tool layer now records whether each observation was itself a foreground observation. A `waitForForeground` click or type after an observe without it fails at argument validation with `observe-with-foreground-required`, before any wait, capture or native request. The observe, click and type tool descriptions name the requirement and the code. The native helper enforces the same rule as a backstop and returns a rejected receipt with that reason. It consumes the observation and does not wait.

## P13 pixel-click delivery finding (2026-10-21, macOS 27.2)

With the hit-test fix installed as 6.1.33-nekodex.4, P13 attempt 4 (`attempt4/acceptance-p13.json`) passed observe and the hit test. `desktop/click` returned `completed` with `input-dispatched; application-result-unverified`, but the purple view never received `mouseDown`. The AX readback and `state.json` stayed at `Counter: 0`. The helper had posted a down/up pair of `CGEvent`s, built from the global point, with `postToPid`.

AppKit routes a mouse event by the window number and window-relative point in its event record. The WindowServer fills both when it routes an event, but an event posted to a PID is not routed. A diagnostic twin of the fixture logged every received mouse event. The events arrived with `windowNumber` 0 and a screen-space `locationInWindow`, so `NSApplication` had no window to send them to. Setting the public `kCGMouseEventWindowUnderMousePointer` and `kCGMouseEventWindowUnderMousePointerThatCanHandleThisEvent` fields to the window ID did not change this.

`NSEvent.mouseEvent(with:location:modifierFlags:timestamp:windowNumber:context:eventNumber:clickCount:pressure:)` is public and its `cgEvent` carries the window number. For a window of another process, the conversion treats the location as a screen point: the record's location and its window-relative point both become that point, flipped against a screen height. The helper reads that height from the conversion of the origin and encodes the exact top-left window-relative point the same way. It posts mouse-moved, down and up to the selected PID only. Before dispatch it checks the converted record: type, location, left button, click state 0/1/1, no modifier flags and the decoded window number. A mismatch is refused as `event-unavailable`. Immediately before dispatch the window must also still have the observed frame, because the events carry window-relative coordinates (`owner-or-frame-changed`). The existing owner, focus, hit-test, occlusion, button and input checks are unchanged and still run last.

Delivery probes, against the owned fixture or its diagnostic twin only, at screenshot (248,336), window point (124,168):

| Method | Received by the application | Effect |
| --- | --- | --- |
| Previous helper: `CGEvent` at the global point, `postToPid` | window 0, screen-space location | counter unchanged |
| Same, plus window fields 91/92, a mouse-moved first, click state 1 | window 0 | counter unchanged |
| `NSEvent` constructor with the documented window-base location | window set, `locationInWindow` (124,−661) | view not hit |
| Same, then `CGEvent.location` set to the global point | window set, `locationInWindow` (−1,313) | view not hit |
| `NSEvent` constructor with the encoded window-relative point (shipped) | window set, `locationInWindow` (124,144), `mouseDown` inside | counter +1, 3 of 3 |
| Session-tap post while frontmost | routed by the WindowServer | counter +1, but the real pointer moved |

The session tap also works, but it delivers to whatever window is under the point when the WindowServer routes the event, and it moves the human's pointer. The PID-targeted event cannot reach another application. The pointer position was unchanged after every PID-targeted run.

End to end, a driver used the helper's real stdio protocol: enable, select, properties, observe with `waitForForeground`, click with `waitForForeground`, properties. Each observation was 1120 × 624 for the 560 × 312 window. The fixture window was at (584,207) for the first rows and at attempt 4's (584,206) for the final build.

| Helper | Screenshot point → window point | Receipt | AX counter and `state.json` |
| --- | --- | --- | --- |
| Previous (built from `origin/main`) | (248,336) → (124,168) | `completed`, `input-dispatched` | 6 → 6 |
| Fixed, 4 runs | (248,336) → (124,168) | `completed` | +1 each, 6 → 10 |
| Fixed | (50,242) → (25,121), inside | `completed` | +1 |
| Fixed | (46,238) → (23,119), 1 pt outside | `completed` | unchanged |
| Fixed | (446,430) → (223,215), inside | `completed` | +1 |
| Fixed | (450,434) → (225,217), 1 pt outside | `completed` | unchanged |
| Final build, fresh fixture, 2 runs | (248,336) → global (708,374) | `completed` | +1 each, 0 → 2 |
| Final build | (50,242) inside, then (46,238) 1 pt outside | `completed` | +1, then unchanged |

The final development helper, compiled with `scripts/build-desktop-helper.cjs --development`, has SHA-256 `10aeafc8c4f66cc33e68295f6b616168983429a654ff5df61937fc64c2161667`. The screenshot-to-point mapping is unchanged and correct: with attempt 4's frame (584,206), (248,336) maps to global (708,374). The corner probes show that the delivered point is accurate to within 1 pt. The encoded global location in the record is the window-relative point, because the conversion cannot know another process's window origin. AppKit's `locationInWindow` is correct; an application that reads the raw `CGEvent` global location would see that window-relative value. The conversion behavior for a foreign window is undocumented, so the record check is the guard. Delivery inside the target application remains live evidence only. Raw probe sources and results are in `p13-cg-click-20261021/delivery-proof-20261021/`.

A new focused test compiles the real helper source with an inert entry point and checks the encoded events without capturing or posting anything. Replacing the encoder with the previous coordinate-only events makes it fail. This is development-helper and fixture evidence, not installed P13 acceptance.

## Delivery boundary

This source batch is not the earlier installed `.9` artifact. No installer or public release asset has been produced for it. Native sign-in remains postponed by the user, and active production core work is preserved. Actual installed acceptance and the remaining desktop calls require their own evidence.
