# Triwave review 3, lane 13 — renderer App

HEAD: `3740505b0107af9a83053fd523ae1ad30be36465` (`3740505`)  
Scope: `launcher/src/App.tsx` and its direct renderer IPC/state callers. Final adversarial read-only pass after triwave waves 1 and 2. No tests, typechecks, scripts, broad audits, runtime/account checks, production actions, source edits, or commit. Native4 / Native4 DEV / ZeroRisk4 connector ABI and identity were preserved.

## New concrete finding

### T3-13-1 — delayed browser activation can resurrect the embedded surface after the user navigates away (P2, conditional)

**Trigger.** A renderer action calls `activateBrowser()` and the `launcher:browser-surface-active` IPC call is delayed while the user changes to another surface before that call resolves. The affected callers include Setup actions that open or reveal the browser, such as sign-in, existing-Chrome sign-in, smoke, and the “open workspace” next action.

**Source evidence.** `activateBrowser` immediately starts `api!.setBrowserSurfaceActive(true)` after scheduling `setSurface("browser")`, then awaits it and optionally calls `showBrowser()` at `launcher/src/App.tsx:620-624`. Surface navigation only changes React state at `:637-640`; the `useLayoutEffect` at `:576-590` subsequently sends the current `browserSurfaceActive` value, including `false` after navigation away. Neither the direct activation promise nor the deactivation promise is tied to a monotonically checked navigation intent. The main handler applies each arriving command immediately through `browserHost.setSurfaceActive(active === true)` at `launcher/electron/main.cjs:544-548`; the host mutates visibility/state synchronously at `launcher/electron/browser-host.cjs:1909-1914`.

**Consequence.** If the earlier `true` IPC completes after the later `false` IPC, the native embedded browser can end with `surfaceActive=true` while the renderer is showing Settings, Activity, MCP, or another non-browser surface. With the `show` argument, the same delayed continuation can also call `showBrowser()` after the user has left Setup. This crosses the renderer’s selected surface with native view visibility and can expose an old browser view over a different workspace surface or leave the host active until another renderer effect happens to send a corrective command.

**Minimal correction direction.** Make browser-surface commands last-intent-wins: use a renderer activation/navigation generation and check it before applying completion side effects, or centralize activation/deactivation through one cancellable/serialized helper. The native handler should continue accepting the existing boolean surface ABI; preserve Native4 / Native4 DEV / ZeroRisk4 names and pins.

**Limit.** The race requires delayed/reordered IPC completion plus a surface change during the small activation window. This is source-derived and was not runtime-reproduced under the requested read-only restrictions.

## Repeats, refinements, and rejected candidates

- **T2-13-1 repeat/refinement:** `McpSurface.install()` still awaits `updateSnapshot()` after successful `setupMcp` and before `move(2)` (`App.tsx:1619-1637`). A second snapshot failure can still present a committed setup as an install failure. No T3 ID is assigned.
- **T2-13-2 repeat/refinement:** the `selectedManualTab?.manualState` effect still redirects to Browser and activates the native surface on status-only changes (`App.tsx:549-555`). No T3 ID is assigned.
- **T1-13-1 repeat:** MCP step state is still optimistically changed before `setMcpStep` persistence resolves (`App.tsx:1598-1609`). No T3 ID is assigned.
- The `activateBrowser` race also covers the post-logout continuation at `App.tsx:664-673`; it is the same root and is not counted separately.
- D06 stale smoke evidence and D13 failed-runtime proof remain corrected on the current inspected paths; no new roots were found.
- Full-snapshot filtering remains an optional efficiency improvement only.
- No candidate implicated the Native4 / Native4DEV / ZeroRisk4 ABI or identity.

## Counts

- New concrete defects: **1** — `T3-13-1`.
- Repeats/refinements: **3** — T2-13-1, T2-13-2, T1-13-1.
- Corrected adjudicated roots rechecked: **2** — D06 and D13.
- Optional improvements: **1** — completion snapshot payload/filtering.
- Rejected new candidates: **0**.
- ABI/identity changes: **0**.

Only `docs/reviews/2026-09-15-triwave-review3-13.md` was written. No source, tests, typechecks, scripts, production state, or Git state was changed.
