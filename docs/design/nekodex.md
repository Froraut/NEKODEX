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
- The current local bundle is ad-hoc signed for local use, not notarized or
  published as a GitHub release. Real multi-account ChatGPT requests and
  Windows/Linux execution were not part of this UI verification.
- Superseded source Electron instances and the task-owned Vite server were
  closed. Only the final packaged preview is intentionally retained for review.

Local app: `launcher/release/nekodex-preview/mac-arm64/NEKODEX.app`.
Use `launcher/release/nekodex-preview/NEKODEX Preview.command` to reopen it with
`--dev-profile`; review data stays under `~/Library/Application Support/NEKODEX Preview`.
The ordinary production launch retains the previous profile paths. The local
preview bundle is a generated artifact and is not committed.

![Packaged NEKODEX preview](screenshots/overview.png)
