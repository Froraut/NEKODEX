# Application navigation and setup UI implementation

Implemented the accepted navigation/setup findings without editing parent-owned
backend, preload, shared types, account controls, global tokens, or localization
sources.

## Changed behavior

- Replaced the separate Setup and MCP sidebar entries with one localized
  Connections entry. Setup and tool configuration remain distinct internal
  surfaces under a shared Models/Tools tab hierarchy and retain separate proofs.
  Activity now sits with the working surfaces instead of occupying a one-item
  Runtime group.
- Made DEV catalog evidence part of readiness instead of treating profile
  installation as a successful catalog. Manual mode no longer waits for Automatic
  catalog/picker evidence; it requires its own local-tool/connector proof.
- Reworded completed setup through localized copy as checks/availability and
  explicitly states that a real tool task has not been tested. No saved setup flag
  is presented as successful tool execution.
- Added durable inline catalog-failure state to Overview and Setup, keyed recovery
  clearing, and direct routing-diagnostics, Activity, and privacy-safe export paths.
- Merged post-operation connector names, model/context capability projection,
  capacity/model preferences, and optional lifecycle/runtime capability metadata
  without replacing a newer state or lifecycle event with an older snapshot.
- Moved Native6/connector mutation out of Settings into Connections. Settings now
  links to the current mode's tool connection and is grouped as Execution,
  Connections, Models and context, Application, and Diagnostics.
- Added an exact connector identity card: current saved identity, runtime-provided
  new target identity, new-App-ID warning, selectable read-only target field, and
  exact verification status. Native4/5 compatibility remains explicit; external
  creation and verification stay disabled until the runtime is configured for the
  displayed target.
- Corrected radiogroup arrow handling so non-radio info controls cannot change a
  model choice. Portaled the Bigger Context dialog, made Escape obey its busy lock,
  preserved prior inert values, and restored focus to the opener or active sidebar
  destination.
- Raised the renderer compact-sidebar query from 820 px to 860 px. The global CSS
  owner must keep the corresponding media treatment aligned.
- Kept the NEKODEX cat identity and removed only the duplicate action buttons from
  the Overview art card.

## Files owned and changed

- `launcher/src/App.tsx`
- `launcher/src/Overview.tsx`
- `launcher/src/setup-progress.ts`
- `launcher/src/RouteDiagnostics.tsx`
- `launcher/src/connections.css` (new, scoped styles)
- `docs/reviews/resilience-20260920/implementation-application-navigation-and-setup-UI.md` (this note)

Localization keys requested from and implemented by the localization owner are
consumed here; this lane did not edit `i18n.ts` or locale JSON. Account login/quota
controls and the `AccountSettings` implementation remain parent-owned. The App
call site now passes the active `language` so those controls can localize their
account and quota states without reading global document state.

## Cross-owner contracts

1. **Lifecycle projection:** the renderer accepts optional
   `runtimeCapabilities` with `revision`, `runtimeStatus`, `nativeAvailability`,
   `webAvailability`, `tunnelStatus`, `releaseVersion`, process IDs, and `detail`.
   It also accepts the corresponding optional revisioned `lifecycle` event. Local
   tool readiness requires observed `tunnelStatus: "ready"`; it is never inferred
   from persisted setup state alone.
2. **Recommended connector identity:** the backend should add optional
   `recommendedConnectorNames: { automatic, manual }`, sourced from connector
   identity constants. `connectorNames` remains the saved/current mode identity.
   Until the recommended projection is present, an existing synchronous Automatic
   configuration can invoke the existing Native6 upgrade from Connections, then
   reads the resulting exact identity from a fresh snapshot; it does not invent an
   identity from saved state.
3. **Preload/types:** parent-owned `LauncherSnapshot`/`LauncherApi` should describe
   `runtimeCapabilities`, `runtimeStatus`, `lifecycle`,
   `recommendedConnectorNames`, and optional `onLifecycle`. The implementation is
   structurally optional so integration can land in either order.
4. **Clipboard:** no connector-copy success is claimed. The exact name is a native
   read-only input that selects on focus and supports ordinary Cmd/Ctrl+C. If a
   dedicated button is desired, parent should add an IPC contract such as
   `copyConnectorName(value: string): Promise<boolean>` before the UI shows
   localized Copy/Copied feedback.
5. **Compact breakpoint:** `App.tsx` now switches behavior at 860 px. The CSS owner
   should align the compact-sidebar media treatment to 860 px (or report a jointly
   chosen replacement) so overlay styling begins at the same threshold.

## Verification limits

Per the parent-owned verification plan, this lane ran no tests, typechecks, builds,
Electron sessions, screenshots, live UI, accounts, network calls, authentication,
or runtime/tool actions. Source was manually inspected only. Parent must perform
focused integration checks and the full synthetic UI capture wave after all
concurrent owners settle. In particular, live focus restoration, connector
migration, catalog recovery, lifecycle event ordering, responsive layout, and real
tool execution remain unverified here.
