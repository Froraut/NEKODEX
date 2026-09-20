# Visual system and motion implementation

Implemented the accepted UI lane 09/15 recommendations in the assigned visual-system scope on `codex/account-limits-login` from baseline `e10c52acb23da1c05d401faaa49d0b34c912e830`.

## Files changed

- `launcher/src/tokens.css`
  - Added shared panel, accent-border, shadow, press, control, and panel-motion tokens while preserving the existing NEKODEX lavender palette.
- `launcher/src/styles.css`
  - Restored targeted transitions that had been suppressed by the old global motion guard.
  - Added consistent hover/press feedback for primary and secondary buttons and clearer selected/hover treatment for interaction-mode cards.
  - Increased select/language control height and changed `.switch` to a stable 44×44 hit area around the unchanged compact 32×18 track.
  - Added focused dialog-row feedback and reduced-motion-safe panel/backdrop/toast entrance animations.
- `launcher/src/nekodex.css`
  - Reused the new tokens for account-card hierarchy and focus-within state.
  - Added a workspace-container reflow for the Settings mode picker at 760px content width, plus a smaller responsive heading and short-window sidebar spacing.
  - Removed the blanket `animation/transition: none` rule; the existing explicit reduced-motion rule remains authoritative.
- `launcher/src/BrandMark.tsx`
  - Coalesced pointer feedback to at most one DOM write batch per animation frame, cached bounds for each pointer entry, and skipped all decorative reaction work under reduced motion.
  - Preserved the reusable `useCatReaction()` contract used by the Overview illustration.
  - Removed the non-actionable keyboard tab stop from `BrandMark` while retaining its image semantics, artwork, colors, and pointer personality.
- `launcher/src/CatTail.tsx`
  - Reviewed and intentionally left unchanged: it already uses refs/direct SVG writes, stops while hidden, resets for reduced motion, and performs no per-frame React state work.

## Coordination contracts

- The CSS mode-card reflow is container-based, so it remains valid when the App owner adjusts the compact-shell breakpoint. It does not alter `App.tsx` navigation or interaction semantics.
- Switch enlargement changes only the button's CSS hit box; it does not add overlays, move DOM ownership, or intercept clicks outside the assigned control.
- Motion is restricted to named properties and named keyframes. No `transition: all` or global `will-change` was introduced.
- Reduced motion disables transitions and animations in the existing final NEKODEX override, while `BrandMark` now also avoids its JavaScript work.
- Account selection, native approvals, connector state, and account/usage behavior were not changed.

## Verification limits

Per parent coordination, no tests, build, live Electron run, account/network work, or new captures were performed. The parent owns focused checks and the complete UI capture pass. Review here was limited to the accepted synthetic fixtures and manual source/diff inspection. A patch-hygiene `git diff --check` command was run before the final compatibility correction; no product code was executed.
