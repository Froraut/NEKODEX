# Launcher recovery UI fixture

This fixture injects an in-memory `codexWebLauncher` into the built renderer. It
does not open Chrome, sign in, read an account, install models, register login
items, or connect to a real Electron IPC bridge. The empty browser viewport is
expected: an ordinary web tab cannot render Electron's native browser view.

From `launcher/`:

```bash
bun run build:renderer
bun tests/fixtures/ui-preview.cjs
```

Open the loopback URL printed by the process, adding one of these query strings.
Stop the process with Ctrl+C after the check. The port is allocated dynamically.

| Scenario | Steps and expected result |
| --- | --- |
| `?scenario=embedded` | Open Browser. Back, Forward, and Reload are disabled while Use passkey is enabled. The guide describes the separate Chrome option. Click Use passkey: the guide changes to Chrome instructions and the action becomes Import Chrome sign-in. Click that action: Importing is disabled to prevent duplicate confirmation. |
| `?scenario=passkey` | Open Browser. The separate Chrome guide appears immediately, above the native browser viewport. |
| `?scenario=onboarding` | Continue from the interaction selection. Open launcher is enabled without opening either social link and leads to Setup. |
| `?scenario=startup-error` | The first snapshot fails. The actual error and Retry appear instead of a permanent spinner. Retry opens Setup. |

Add `&language=zh-CN` or `&language=ja` to inspect localized guidance. Browser tabs
support Left/Right/Home/End selection and Enter/Space activation. All simulated
mutations are recorded in `window.fixtureCalls` for developer inspection.

## Observed checks on 2026-09-11

The built renderer was opened in an isolated in-app browser at 1280 × 720.
Accessibility-tree and visual checks confirmed:

- During embedded login, Back, Forward, and Reload were disabled, Use passkey was
  enabled, and the recovery guide was visible above the viewport.
- Use passkey switched to the separate-Chrome guide and Import Chrome sign-in;
  clicking the latter displayed disabled Importing and progress guidance.
- Navigating to Setup and back during import retained the disabled Importing
  state, preventing duplicate continuation after the Browser surface remounted.
- Right Arrow moved both focus and selected state from Sign in to Fixture tab.
- The optional support screen showed enabled Open launcher with both social
  actions untouched; Open launcher reached the DEV Setup screen.
- Startup failure displayed `Fixture runtime unavailable` and Retry. Retry
  reached the DEV Setup screen; no raw Electron method wrapper appeared.
- Japanese Chrome instructions and the explicit import button fit the same
  viewport. English and Japanese screenshots were inspected.
- The browser's captured console contained no warning or error entries for the
  checked English recovery flows.

These observations verify renderer behavior with simulated state. They do not
establish native passkey success, session import, or a real Codex response.
