# NEKODEX full UI/UX review wave 2 — Luna medium, lane 3 (`wizard-actions`)

- Repository: `/Users/alex/Dev/nekodex`
- Baseline: `540180047f8a6bee4b735d62a89d3eb64dc428a7`
- Scope: manual read-only review of `launcher/src` and direct UI callers, with the MCP wizard screenshot checked against the source behavior.
- Verification: source review and static screenshot inspection only. No edits to source, tests, typechecks, scripts, runtime/app starts, commits, pushes, or delegation.

## Findings

### P2 — MCP wizard does not expose the current step to assistive technology

- Component/line: `launcher/src/App.tsx:1700-1713`, `McpSurface` wizard stepper.
- Trigger: Open Codex tools (MCP), move to any step, and navigate the stepper with a keyboard or screen reader.
- Actual: The current step is communicated only by the `is-active` class and visual styling. The wrapper has an `aria-label` but no grouping role, and none of the step buttons exposes `aria-current`. Completed buttons expose a check icon visually, while future buttons are natively disabled, but the current/completed distinction is not available as state semantics.
- Expected: The active step is announced as the current step, with the step sequence and step names available as a coherent wizard navigation landmark.
- Smallest fix: Add `aria-current="step"` to the active step button and give the stepper an appropriate accessible grouping/name (for example, `role="group"` with its existing label). Preserve the native disabled state for future steps.
- Confidence: high.

### P2 — MCP step 3 reuses the step 2 connector video

- Component/line: `launcher/src/App.tsx:38-42`, `MCP_GUIDE_MEDIA`; consumed by `McpSurface` at `launcher/src/App.tsx:1717-1723`.
- Trigger: Advance from “Create a tunnel and API key” through credentials to the connector verification step, then open “Guide video”.
- Actual: `MCP_GUIDE_MEDIA[1]` and `MCP_GUIDE_MEDIA[2]` both resolve to `mcp-connect-connector.mp4`. The step 3 dialog labels the media with the step 3 title, but plays the same connector-creation guidance as step 2.
- Expected: Step 3 either has verification-specific guidance or does not present a video whose content belongs to an earlier step.
- Smallest fix: Provide a dedicated verification asset at index 2, or omit the step 3 media entry so the guide-video disclosure is not rendered for that step.
- Confidence: high.

## Rejected or non-findings

- No branding finding: product/technical compatibility identifiers were treated as functional labels, per scope.
- Completed MCP credentials are read-only at `launcher/src/App.tsx:1748-1764`; `Replace credentials` is the explicit unlock action, and `Keep credentials` clears the replacement fields without replacing the saved values.
- Completed setup rows are gated by `complete && !repeatable` at `launcher/src/App.tsx:2295-2303`; account, smoke, and core setup completion therefore do not silently re-enter their actions.
- Busy guards and disabled actions cover MCP back/next/done/reconnect paths at `launcher/src/App.tsx:1630-1637`, `1847-1882`; terminal login guides expose retry only after the operation is no longer active.
- The MCP screenshot’s responsive layout is consistent with the source container rules: the footer wraps, the stepper hides labels at narrow widths, and the action buttons remain reachable. No additional reachable overflow or clipping defect was established from the available static screenshot.

## Clean areas reviewed

- MCP saved-credential state and explicit replacement flow.
- MCP back/next/connect/reconnect/verify/done state gating.
- Setup-row completion gating and troubleshooting re-entry.
- Error/retry controls in existing-Chrome and passkey login guides.
- Visible keyboard focus rules, Escape handling for expanded tutorial video, and tab semantics in the browser surface.
- Responsive wizard footer and narrow-content rules.

## Notes and limits

This is a source-level review at the requested commit. No live MCP account, browser, screen-reader, or runtime behavior was established. The two findings are reachable from the UI structure and do not depend on a visual preference.
