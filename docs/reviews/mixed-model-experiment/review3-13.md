# NEKODEX adjudication review3 lane 13 — renderer

- Baseline: `9925453bd51e61c7b398abec12ec0da3aca3d3af`
- Repository: `/Users/alex/Dev/nekodex`
- Scope: `launcher/src/App.tsx`, `launcher/src/Overview.tsx`, `launcher/src/styles.css`, with direct caller and downstream stylesheet context as needed.
- Method: manual source adjudication only. No source edits, tests, typechecks, automated audits, runtime actions, commits, or delegation.
- Applied guidance: [nekodex-regression-prevention](/Users/alex/Dev/nekodex/skills/nekodex-regression-prevention/SKILL.md) and [right-size-test-runs](/Users/alex/.codex/skills/right-size-test-runs/SKILL.md).

## Adjudication

### Review 1 claim 1 — accepted

**Claim:** Overview can report a failed automatic runtime as connected and ready.

**Verdict:** accepted, P1. This is the same root as review 2 claim 2.

**Source evidence:** `launcher/src/Overview.tsx:15-18,21-24` computes `toolsReady` from only browser authentication and persisted `snapshot.state.mcpSetupComplete`. The direct caller at `launcher/src/App.tsx:833` passes no `operation`. Meanwhile `launcher/src/App.tsx:48-53` defines `currentToolProof(snapshot, operation)` and explicitly rejects a failed `runtime-start` in production automatic mode. The setup/MCP paths use that guarded predicate at `App.tsx:1376` and `1613`.

**Executable trigger:** With production automatic mode, authenticated browser, verified catalog and picker, and persisted `mcpSetupComplete === true`, receive `{ name: "runtime-start", status: "failed" }`. Overview still marks the tool connection verified and can show the ready headline because its predicate cannot see the failed operation.

**Impact:** The same live state is presented as ready by Overview while the guarded setup path treats tool proof as invalid. The primary Overview action can still open the browser because `workspaceReady` intentionally excludes MCP; that optional-MCP navigation does not remove the contradiction in the explicit “verified/ready” status.

**Essential fix:** Make Overview consume the current shared tool-proof result, or pass the current `operation` and apply the same `currentToolProof` predicate. Preserve the existing public connector ABI and names.

### Review 1 claim 2 — rejected

**Claim:** Browser toolbar has no narrow-layout behavior and can push controls off-screen.

**Counterevidence:** The named `styles.css` is not the complete stylesheet for this renderer path. `launcher/src/main.tsx:5-6` imports `styles.css` and then `nekodex.css`. The latter contains the active narrow rules at `launcher/src/nekodex.css:373-375`: `.browser-toolbar` becomes auto-height and wraps, `.browser-address` gets a flexible basis, and toolbar text buttons can wrap. Therefore the claimed absence of narrow behavior is false for the actual loaded CSS.

**Limit:** This adjudication does not infer perfect layout for every localization or arbitrary OS window size. The claim’s stated source premise—no narrow rule and forced single-row overflow—is disproven by the direct loaded caller stylesheet.

### Review 2 claim 1 — rejected

**Claim:** Overview has no stylesheet rules and is rendered as an unstyled, non-responsive layout.

**Counterevidence:** `launcher/src/main.tsx:5-6` imports `nekodex.css` after `styles.css`. That file has the full Overview rules at `launcher/src/nekodex.css:172-232`, including the heading, intro, metrics, grid, connection list, activity, art card, and illustration classes. It also has responsive container rules at `launcher/src/nekodex.css:286-322` for wide, 760px, and 480px workspace widths, plus compact connection-row rules at `439-444`. The direct caller at `App.tsx:833` reaches the same styled surface. The claim resulted from searching only `styles.css`, which is an incomplete downstream stylesheet boundary.

### Review 2 claim 2 — accepted

**Claim:** Overview can report the workspace fully ready after a failed production automatic runtime start.

**Verdict:** accepted, P1. Merge with review 1 claim 1 under root `L13-overview-stale-runtime-proof`.

**Counterevidence considered:** `workspaceReady` at `Overview.tsx:19` intentionally gates the primary browser action on account and model readiness only, and the app treats MCP as optional in some automatic-mode paths. That explains why the browser action may remain available without MCP. It does not invalidate the separate stale positive claim: `Overview.tsx:17-18,24,30-31` can still show `toolsReady`, “Verified”, and the ready headline after the exact failed operation that `App.tsx:48-53` excludes.

**Essential fix:** Same shared predicate fix as review 1 claim 1.

## Root merge

Only one unique actionable root is accepted. The two rejected responsive claims relied on an incomplete stylesheet search and have direct counterevidence in the imported `nekodex.css`. No second real defect met the requested bar after tracing direct callers and downstream guards. No invented gateway envelope contract, hypothetical hardening, impossible backend-invalidated UI state, or unavoidable non-atomic race was counted.

## Counts

- Accepted: 2 claims
- Rejected: 2 claims
- Design-limit: 0 claims
- Unique accepted roots: 1

## Essential fix

Unify Overview’s MCP/tool readiness with the existing `currentToolProof(snapshot, operation)` predicate (or pass an equivalent already-computed value from `App.tsx`). This removes the stale “verified/ready” renderer state after a failed production automatic runtime start while keeping the public connector ABI and names unchanged.
