# Setup and responsive UI follow-up

## Fixed

- Setup now derives one next action from actual installation/account/catalog state.
  A saved catalog awaiting the user's picker confirmation shows confirmation,
  rather than offering Reinstall as the main action. Missing catalog requests
  lead to routing diagnostics. Reinstallation is an explicit repair action.
- Existing installations describe the connection test as optional. Automatic
  model-only use is not blocked by optional tools. Manual mode with missing
  credentials leads to MCP setup without inspecting ChatGPT sign-in.
- Overview distinguishes waiting for a catalog, waiting for picker confirmation
  and an absent installation. It no longer tells an already-signed-in user with
  installed models to connect their account again.
- Setup buttons, settings controls, MCP fields, browser toolbar and manual-turn
  guidance adapt to workspace width, including a visible sidebar in a medium
  window. Long account names wrap without displacing the selected badge.
- Browser tabs can scroll horizontally. The narrow browser toolbar uses a
  separate action row while keeping history/address/zoom available.
- MCP instructions use the outer page scrollbar; action buttons have a sticky,
  wrapping footer. Tutorial videos start only when played, pause when collapsed,
  and pause the inline copy when expanded.
- Troubleshooting and Hermes are collapsible secondary sections.

## Bounded verification

Renderer type-check and build passed. Five focused setup progression cases passed
in tests/setup-progress.test.ts: pending confirmation, pending catalog, initial
reply check, manual credentials, and optional tools. Actual isolated Electron UI
was inspected at 900 × 650 for Setup, Browser and MCP. Main actions and text
remained accessible, and the browser toolbar correctly wrapped into two rows.
No setup/network mutation or model request was performed during this UI review.
Backend runtime and saved accounts are unchanged.

The current installed account's next step is confirming that its Web models are
visible in Codex. This review does not automatically affirm the user's picker
confirmation or re-run a paid/model request just to change a checkmark.
