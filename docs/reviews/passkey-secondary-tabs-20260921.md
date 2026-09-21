# Passkey and browser presentation follow-up

User reported Use passkey failing on the additional account Prim2 and clipped feedback/tab titles in installed 5.9.0-nekodex.3.

Confirmed source causes:
- AccountBrowserPool.openPasskeyLogin applied the primary-only existing-Chrome import restriction, despite renderer passkey controls being available for additional accounts.
- Pool account-operation admission rejected an already-owned embedded login before BrowserHost's existing bounded handoff could cancel and join that login.
- Global HTML error toasts could sit behind native WebContents; CSS z-index cannot raise HTML above that native view.
- Tabs were capped at 220 px and placed the status dot after an ellipsized title.

Changes prepared:
- Dedicated, user-initiated passkey capture targets the selected account's existing BrowserHost and partition. Only a pool-owned embedded login may hand off. A pinned passkey owner survives the embedded lease's cleanup and prevents cross-account selection; competing leases remain rejected. Existing Chrome session import remains primary-only and its unsupported secondary-account button is hidden.
- Browser errors reserve an inline region above the native viewport; other surfaces retain their existing toast. Passkey actions respect lifecycle transitions.
- Tab order is cat, status, full title. Tabs use content width and a horizontally scrollable strip instead of prematurely clipping titles.

Evidence: four pool ownership/handoff/conflict/cancellable-initial-probe cases passed; two existing bounded host-handoff/cancellation cases passed. Launcher TypeScript passed. Isolated browser checks cover secondary-account action dispatch, passkey waiting controls, safe inline error layout with the update banner, full tab text/order and no document overflow at 760 and 1280 px. Captures were visually inspected. An initial fixture selector expected “Continue”; corrected to the actual “Import browser sign-in” label. No live credentials were imported by these tests.

The clarified additional scope is internal NEKODEX windows/tabs. Added separate sandboxed BrowserWindows using the selected account's existing session; task-owned views are never re-parented. macOS native tab groups support new tab/window buttons, Cmd-T/Cmd-N and Control-Tab/Control-Shift-Tab. User windows retain existing remote permission/external-link guards and share no privileged preload. Account sessions remain distinct, a global 16-window/tab cap bounds resources, and quit respects pages that refuse unload. Auth-page navigation retires account proof until rechecked; ordinary browsing does not reset valid proof.

Two manager cases passed (separate windows/tab groups/session isolation/keyboard actions and unload veto). A real isolated Electron 41.10.7 probe created three windows, grouped two as native tabs, switched focus forward and backward and closed every test window successfully. Source renderer buttons and error geometry (including the bounds sent for the native viewport) passed the focused 760/1280 px flow. No real account or provider was used in the probe. Final launcher TypeScript/build and source diff review precede packaging. Installed app is currently .3; its old .2 runtime was retained because active tasks and then embedded account login blocked graceful activation. Every attempted external drain was resumed on failure; do not force-kill the login owner or claim .3 runtime activation yet.

## Installed handoff

The signed/notarized local Apple Silicon .4 application is installed at `/Applications/NEKODEX.app`. The earlier .3 GUI/.2 runtime mismatch was resolved through an authenticated idle drain and shutdown, without cancelling active requests. The .4 runtime became ready, with Native/Web admission, broker and tunnel ready; the restart banner disappeared. Subsequent fresh inspection again observed installed GUI and runtime version .4 with draining false. Developer ID strict signature and Gatekeeper checks passed; DMG notarization receipt: `088275bc-e475-4e30-b5a1-b2a2868e558d`.

Installed Browser UI visibly exposed the selected Prim2 account, new window/tab controls and Use passkey. The attempted passkey click was interrupted by a native binding change, so it does not prove a completed passkey authentication. After the task resumed, Computer Use could capture the application but native clicks returned `noWindowsAvailable`; a metadata-only probe found both Codex and NEKODEX off-screen with zero AX windows, while the application/runtime remained healthy. Do not infer a passkey rejection from that control failure or restart the app again to force a UI test. Actual dedicated passkey login completion remains unverified and requires the user's authentication interaction. Window grouping and switching have real isolated Electron evidence, not an asserted live-account login result.

Current .4 DMG/ZIP are retained in `launcher/artifacts`. The task-owned probe app/server and installation staging are gone. Existing rollback archive and account profiles are preserved. Source branch is pushed; no .4 public release or builds for other platforms were published.
