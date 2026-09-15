# Independent blind review wave2 lane13 renderer

- Repository: `/Users/alex/Dev/nekodex`
- Baseline: `9925453`
- Source status: unchanged; no source edits made
- UTC review start: `2026-09-15T20:36:28Z`
- UTC review end: `2026-09-15T20:37:36Z`
- Requested scope: stale renderer intent, readiness, and responsive UI correctness in `launcher/src/App.tsx`, `launcher/src/Overview.tsx`, and `launcher/src/styles.css`
- Inspected paths: Overview direct caller and readiness helper in `App.tsx`; Overview rendering and interaction paths; generic content-surface and responsive stylesheet rules; reachable setup, error, cancellation, and direct-caller context in `App.tsx`
- Verification: manual source review only. No tests, typechecks, scripts, runtime checks, commits, delegation, or source edits were performed.
- Skill note: read and applied the repository-local `/Users/alex/Dev/nekodex/skills/nekodex-regression-prevention/SKILL.md` and the available `/Users/alex/.codex/skills/right-size-test-runs/SKILL.md`.

## Findings

### 1. Overview-specific renderer has no stylesheet rules, so the current Overview intent is not rendered as a responsive layout

- Trigger: reach the Overview surface through the normal `surface === "overview"` branch at `launcher/src/App.tsx:833`, at any viewport width. `Overview` emits the page-specific classes at `launcher/src/Overview.tsx:26-63`, including `overview-heading`, `workspace-intro`, `workspace-metrics`, `overview-grid`, `connection-list`, `workspace-art-card`, and `workspace-illustration-stage`.
- Exact location: `launcher/src/Overview.tsx:26-63`; the stylesheet has only the generic `.content-surface` / `.content-scroll` rules at `launcher/src/styles.css:923-941` and generic width changes at `launcher/src/styles.css:2741-2765`. An exact search of `styles.css` found no selectors for the Overview-specific class names.
- Consequence: the page-specific hierarchy, metric row, two-column overview grid, connection rows, art card, and illustration stage fall back to browser defaults or unstyled block flow. Buttons retain user-agent defaults except for generic button rules, and the intended compact/mobile composition has no corresponding breakpoint behavior. At narrower widths, content can wrap as ordinary inline/button content and the art/connection sections are not laid out according to the renderer's declared structure.
- Counterevidence: the outer surface still receives height, padding, overflow, and scrolling from `.content-surface` and `.content-scroll`; this can make the page appear superficially usable while leaving the actual Overview renderer unstyled.
- Smallest fix: add the missing Overview class rules to `launcher/src/styles.css`, including the base layout and the needed narrow-width collapse/wrapping rules, or restore the intended stylesheet block if it was accidentally omitted. Keep the existing generic content scrolling rules.
- Confidence: high.

### 2. Overview can report the workspace fully ready after a failed production automatic runtime start

- Trigger: in production automatic mode, have sign-in, catalog verification, picker confirmation, and `mcpSetupComplete` true, then receive an operation `{ name: "runtime-start", status: "failed" }`. This is a reachable failure state because the shared readiness helper explicitly treats that combination as failed at `launcher/src/App.tsx:48-53`.
- Exact location: `launcher/src/Overview.tsx:15-24` computes `toolsReady` only from `signedIn && snapshot.state.mcpSetupComplete`, and `ready` at `launcher/src/Overview.tsx:18` uses that value. The direct caller at `launcher/src/App.tsx:833` passes `copy`, `browser`, `snapshot`, `logs`, and `navigate`, but no `operation`.
- Consequence: the Overview can show `overviewReady`, mark the tool connection as verified, and present the ready-state workspace messaging even though the current runtime-start operation failed. The setup surface has the opposite, guarded behavior through `currentToolProof(snapshot, operation)` at `launcher/src/App.tsx:48-53`, so the same live state can be rendered as ready on Overview and failed on Setup.
- Counterevidence: `workspaceReady` intentionally excludes MCP readiness at `launcher/src/Overview.tsx:19`, and the app treats MCP as optional in some automatic-mode navigation paths (`launcher/src/App.tsx:505-507`). That explains why opening the browser without MCP may be valid; it does not explain or correct the separate contradiction where `ready` and `toolsReady` claim verified readiness after the explicit runtime-start failure.
- Smallest fix: pass the current `operation` into `Overview` and derive tool readiness from the same `currentToolProof` rule used by Setup, or expose a shared readiness value from `App.tsx` so Overview cannot omit the failure condition.
- Confidence: high.

No additional concrete reachable defects met the requested bar without relying on speculative hardening, style preference, or known fail-closed limitations.
