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

## Delivery boundary

This source batch is not the earlier installed `.9` artifact. No installer or public release asset has been produced for it. Native sign-in remains postponed by the user, and active production core work is preserved. Actual installed acceptance and the remaining desktop calls require their own evidence.
