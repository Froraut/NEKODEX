# NEKODEX desktop identity

NEKODEX is the product name for the desktop workspace. The original cat mark
uses code brackets as eyes and appears in the sidebar, onboarding, Dock and tray.

## Visual direction

- Graphite `#1b1b24` content, ink `#191922` navigation, plum `#29263d` focal panel.
- Lavender `#c6bdff` identifies actions and selection. Mint `#84d8b1` means verified.
- Avenir Next on macOS, Segoe UI Variable on Windows, system sans-serif fallback.
- Left aligned content; a persistent navigation rail; a distinct Overview with
  one welcome panel, compact metrics and independently verified connections.
- Account management has its own page. Settings focus on agent behaviour and
  workspace preferences. Empty states point to a useful next action.
- Keyboard focus is visible. Reduced motion disables decorative animation.

The memorable element is the original cat-and-code mark. A large marketing hero,
decorative charts and duplicate status cards were excluded to keep this a useful
desktop tool.

## Compatibility

The product and executable name become NEKODEX. Existing app ID, installer GUID,
package IDs, browser partitions, environment variables, profile directories,
updater archive prefix and trust configuration stay stable. This avoids resetting
existing logins and keeps the established update channel identifiable. Source
and upstream copyright credits remain intact.

The signed updater validates the product name. The first NEKODEX release needs a
manual installation over the old app; old binaries expect the old executable
name and must not be advertised as transparently compatible with this rename.
Release tags and existing published assets are not modified by this UI work.

Overview uses saved verification state and current browser state across open account profiles. An active configured limit is not evidence of sustainable live capacity.
It does not represent account quotas or a capacity measurement across accounts.


## Cat reactions

Hover any cat or focus a large in-app cat to trigger one of twelve reactions:
curious, wink, happy, surprised, sleepy, yawn, sneeze, stretch, playful, purr,
peek or wiggle. A shuffled queue visits every reaction once before repeating;
the boundary between cycles also prevents immediate repetition. Head, ears, eyes and mouth animate independently;
the head and face also track the pointer within a small bounded range.
Animation stops on pointer exit or blur. Reduced motion suppresses movement,
leaving only the static expression. The desktop icon remains a static asset.

Regenerate the macOS PNG and multi-resolution Windows ICO from the editable SVG
with `node launcher/scripts/generate-brand-icons.cjs` on macOS.

## Development verification and local preview (2026-09-15)

- Renderer type check passed; the final renderer bundle built successfully.
- Two focused existing cases passed: durable DEV/production profile isolation
  (including the new display names and legacy login partition), and native
  packaging metadata (including the new product name and tray asset).
- Real isolated Electron UI: Overview, Accounts, Settings and Browser navigation
  worked; adding an account created and selected a separate profile. A cat
  reaction was observed in the development UI after the expanded animation set.
- The packaged macOS arm64 `NEKODEX.app` opened from its own bundle with the
  NEKODEX native application/menu name. It uses the isolated preview profile.
- The installed local bundle is ad-hoc signed for local use, not notarized or
  published as a GitHub release. Real multi-account ChatGPT requests and
  Windows/Linux execution were not part of this UI verification.
- Superseded source Electron instances and the task-owned Vite server were
  closed. Only the final packaged preview is intentionally retained for review.

Installed app: `/Applications/NEKODEX.app`.
Use `launcher/release/nekodex-preview/NEKODEX Preview.command` to reopen it with
`--dev-profile`; review data stays under `~/Library/Application Support/NEKODEX Preview`.
The ordinary production launch retains the previous profile paths. The local
preview bundle is a generated artifact and is not committed.

![Packaged NEKODEX preview](screenshots/overview.png)


## Final follow-up: responsive UI, illustration and cleanup

The user rejected the orbital glass artwork. The final asset is the generated
flat coding cat in `launcher/src/assets/cat-workspace.png`, with three alternating
hover/focus reactions. The original twelve main-cat reactions remain unchanged.
Overview now uses workspace-width container queries for 3/2/1 columns, fluid
margins and content-based card heights. Settings and other content pages scroll
at the workspace edge with a reserved gutter. Activity has search and level
filters; advanced context controls can be collapsed.

The native idle-surface URL and runtime validator now agree on NEKODEX. Its one
focused acceptance test passed. The existing disabled Codex bridge route remains
protected; a route ownership conflict still prevents runtime setup from being
called operational. ChatGPT sign-in was retained in the installed application.

17 old Codex Web GPT bundles were moved to Trash and their registrations removed.
The previous local NEKODEX build was also retired during final replacement.
Only `/Applications/NEKODEX.app` is retained as the current runnable deliverable.
User account data and source repositories were preserved. Trash was not emptied.
The global `app-build-artifact-cleanup` skill is installed and was returned as
user-scoped and enabled by Codex's skills/list.

See `completion-plan.md` and the repository-root `design-qa.md` for completion
and bounded verification. The current source changes are separate from a public
notarized release.


## Subsequent authorized route replacement

The user then explicitly requested rewriting the disabled route with NEKODEX.
That replacement completed after a real `NEKODEX READY` reply through the native
Codex client. The installed app now owns the healthy listener and its catalog
exposes five Web modes. See [route recovery](route-recovery.md) for exact evidence,
configuration backups, the optional profile and remaining distribution limits.

## Cat-only motion refinement

Motion is limited to cat anatomy. The coding illustration now has a stationary
raster scene, independent paw layers, and the same reusable head/face rig as the
main brand cat. It shares the twelve non-repeating expressions, including blinking,
winking and mouth shapes. Laptop, document, buttons and panels do not animate.
Non-cat transitions and animations are disabled; reduced-motion preferences also
suppress the cat effects. Renderer type-check/build and a focused DEV hover/focus
observation passed before updating the installed app. Backend runtime is unchanged.


## Setup and responsive follow-up

See [the focused review](setup-responsive-review.md) for state-based next-step
guidance, repair separation, workspace-width reflow, scrollable browser tabs,
MCP footer/video behavior and its five focused progression checks.
