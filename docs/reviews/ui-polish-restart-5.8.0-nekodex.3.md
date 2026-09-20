# NEKODEX 5.8.0-nekodex.3 — restart and whole-interface review

The finish-update action previously refused to exit while a read-only session inspection remained pending. The launcher now cancels and joins its own inspection/navigation/helper before quitting. Active tasks, login, account mutations and unsettled helper cleanup retain their guards. The restart button shows immediate pending feedback and remains pending until the main process actually exits.

## Interface changes

- Overview uses one activity summary and compact configuration actions. Connection statuses align with their actions. A tunnel interruption is reported separately from a healthy native route and no longer asks users to confirm already configured models.
- Account allowance and official sign-in share a flatter layout, unknown windows appear once, real zero remains visible, and replacing credentials is secondary. Optional pacing/proxy forms follow the main account actions.
- Browser cancellation names the exact turn, preserves its trace identity through IPC and prevents duplicate clicks while pending. The hidden browser still reports active runs. Manual instructions and actions occupy separate rows.
- Connections preserve full localized step labels and usable model-menu targets. Settings controls, dialogs and the manual timeout selector use consistent layout and styling. Empty Activity reports explain changing source/period and disable empty CSV export.
- Update discovery failures offer an explicit retry check. Download/install retry remains a separate action. Copy explains automatic GUI reopen and a possible final runtime activation. New download progress starts empty.
- Onboarding language names appear once. New UI strings cover all six supported languages. README images use the current isolated example profile.

## Development evidence — 2026-09-20

One coordinated coverage plan covered Overview (ready/running/tunnel failure), Accounts (known zero/unknown allowance, signed out, device login, expanded proxy), Browser (pending cancellation and Manual), both Connections paths including a fresh setup and Manual model menu, Web/Native/empty Activity, Settings/diagnostics/dialog, Updates (initial download, verification/reduced motion, error/retry), and the three onboarding steps. The combined inventory contains 26 distinct rendered states. No full repository/package suite was run.

The original 21-capture pass took 5.935 seconds; affected screens were recaptured after real fixes. The final affected-screen pass took 5.117 seconds and found no page errors or document/control horizontal overflow. Screenshots were visually inspected; short panel entrance animations were allowed to settle. This is fixture evidence using production components and matching stylesheet order, not live account or network evidence.

Interactions exercised include onboarding navigation, opening/closing the details dialog with Escape, opening/closing the model menu and its ARIA control relationship, exact-turn cancellation with a pending state while the second turn remains present, and retrying update discovery without installing. The empty export and reported-zero/unknown distinction were checked. A fixture-only English assertion on a Russian screen and a model-menu fixture using Automatic mode were corrected; neither was a product failure.

The final renderer typecheck and Vite build passed in about two seconds. An earlier missing React hook import was caught and corrected. The build retains its pre-existing large-chunk advisory.

The isolated Electron restart observation passed two cases in 1.318 seconds: an active-task veto preserved the interface and its inspection; a stalled read-only inspection was cancelled, its controlled cleanup completed, one relaunch was requested, and the app exited normally (code 0). Relaunch scheduling was recorded; this fixture did not launch a replacement process. This proves the main/preload/renderer restart control flow, not every real helper/network failure.

## Evidence limits

The UI was rendered on macOS at meaningful 960–1360 px widths with English and Russian cases, including reduced motion. It does not establish all Windows/Linux font/layout behavior, screen-reader output, all language/viewport combinations, or a real ChatGPT tool result. Packaging, installed version and the subsequent live update remain separate release outcomes. Four Sol review lanes supplied disjoint UI findings; the parent integrated changes and owned all runtime checks.
