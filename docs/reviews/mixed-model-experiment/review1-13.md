# Mixed-model experiment review 1-13 — renderer lane

- Baseline: `9925453bd51e61c7b398abec12ec0da3aca3d3af`
- UTC start: `2026-09-15T20:31:47Z`
- UTC end: `2026-09-15T20:32:54Z`
- Review mode: manual source review only; no edits to source, tests, typechecks, scripts, live actions, commits, or delegation.

## Inspected scope

- `launcher/src/App.tsx`
- `launcher/src/Overview.tsx`
- `launcher/src/styles.css`
- Direct style import used by the named renderer path: `launcher/src/nekodex.css` (needed to evaluate the `Overview` responsive classes; imported after `styles.css` by `launcher/src/main.tsx`)
- Direct renderer state/type references in `launcher/src/types.ts` and the named file's local callers, only where needed to establish the reviewed behavior.

Applied guidance from:

- [`skills/nekodex-regression-prevention/SKILL.md`](/Users/alex/Dev/nekodex/skills/nekodex-regression-prevention/SKILL.md)
- [`right-size-test-runs/SKILL.md`](/Users/alex/.codex/skills/right-size-test-runs/SKILL.md)

No other wave report was read. No verification command was run; this is the requested manual review.

## Findings

### 1. P1 — Overview can report a failed automatic runtime as connected and ready

- **Exact location:** `launcher/src/Overview.tsx:16-18`, `Overview()` (`modelsReady`, `toolsReady`, `ready`).
- **Executable trigger:** Start from a persisted state with `browserInteractionMode === "automatic"`, `mcpSetupComplete === true`, `codexCatalogVerified === true`, `codexPickerConfirmed === true`, and an authenticated browser. Then let the renderer receive an `OperationState` with `name === "runtime-start"` and `status === "failed"` while the persisted setup flag remains true. The Overview still computes `toolsReady === true` and `ready === true`, because it receives no operation and checks only `mcpSetupComplete`.
- **Impact:** The main Overview headline becomes “Your workspace is connected”, the tool connection row says verified, and the primary action presents the workspace as ready while the automatic runtime has just failed. This can direct the user into a non-working workspace and leaves stale positive readiness visible.
- **Smallest fix:** Make Overview consume the same current tool proof used by `App.tsx:48-53` (pass the current operation, or pass a renderer-level `toolsReady` value computed by that shared predicate). At minimum, include the production automatic `runtime-start` failure exclusion in the Overview readiness calculation.
- **Confidence:** High. The inconsistency is directly visible in the two predicates: `Overview` uses only the stored flag, while `App.tsx` explicitly rejects this failed runtime state.

### 2. P2 — Browser toolbar has no narrow-layout behavior and can push controls off-screen

- **Exact location:** `launcher/src/styles.css:661-750`, `.browser-toolbar`, `.browser-address`, `.browser-zoom-controls`, and `.toolbar-text-button`; the only narrow media rules at `styles.css:2752-2805` do not cover this toolbar.
- **Executable trigger:** Open the Browser surface in a compact window narrow enough that the fixed history controls, zoom group (`styles.css:711-735`), and both text actions (`styles.css:742-750`) consume the available width (for example, a phone-sized or narrow split window). The toolbar remains a single non-wrapping flex row; only `.browser-address` is allowed to shrink. The fixed controls therefore overflow the toolbar or force the address field to collapse to an unusable width, with the sign-in actions becoming clipped or unreachable.
- **Impact:** At the responsive sizes explicitly handled elsewhere by the renderer, core Browser actions can be visually clipped or unavailable. A user may be unable to reach passkey or existing-Chrome sign-in even though the Browser surface is open.
- **Smallest fix:** Add a narrow toolbar rule that gives the address region a bounded minimum usable width and moves the text actions into a second row or a compact overflow/control state; keep the fixed controls in the first row. The fix should be scoped to the toolbar rather than changing global overflow.
- **Confidence:** Medium-high. The source establishes fixed-width groups and no wrapping/overflow policy or narrow override. Exact clipping depends on the window width and localized label lengths, so the trigger is intentionally width-specific.

## Design limitation, not counted as a bug

`Overview.tsx:17-18` requires `mcpSetupComplete` for the headline “workspace connected”, while `App.tsx:505-507` labels MCP as optional in automatic mode and `Overview.tsx:32` already allows the primary action once account plus model readiness is present. This creates a potentially confusing status distinction: the workspace can be usable while the headline still says it is not fully connected. I classify this as a product/readiness-definition decision rather than a concrete renderer bug; the review does not propose changing it without adjudication.

## Zero-findings boundary

No third concrete current bug met the bar of an executable trigger and source-backed impact without relying on speculative hardening, stylistic preference, or a historical already-fixed claim.
