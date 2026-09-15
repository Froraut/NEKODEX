# NEKODEX — three review waves and three correction waves

Baseline: `3740505b0107af9a83053fd523ae1ad30be36465`.

The user requested three waves of 16 Sol reviewers followed by three waves of 16 Sol implementers. All six waves were dispatched. Agents performed source review and targeted implementation only; they did not run broad suites, production actions, account changes or release operations.

## Sequence

| Stage | Agents | Result |
| --- | ---: | --- |
| Review wave 1 | 16 | Found new conditional source paths plus repeats of prior D01–D19 corrections. |
| Review wave 2 | 16 | Rechecked wave 1 on unchanged source, added new paths for late proof writers, account evidence, status diagnostics, gateway structured results and control-child ownership. |
| Review wave 3 | 16 | Adversarially checked wave 1/2 findings and cross-scope interactions; rejected overclaims and confirmed the remaining concrete paths. |
| Correction wave 1 | 16 | Implemented the accepted findings across setup, launcher state, account evidence, browser worker, gateway, DEV CLI, journals, tunnel control and diagnostics. |
| Correction wave 2 | 16 | Corrected cross-scope interactions, stale proof, control queues, journal guards, status ownership and renderer surface ordering. |
| Correction wave 3 | 16 | Final adversarial source pass; added only justified residual fixes, including disabled-account evidence and mode-proof invalidation. |

Total: **96 Sol agents** across the six requested waves. All results were collected and agents were closed. Finding counts are deduplicated by behavior root; repeated reports do not become additional bugs.

## Main corrections

- Setup rollback restores exact captured service/tunnel plist bytes and never regenerates divergent definitions from old config during compensation. Ownership checkpoints happen immediately after setup-owned writes.
- Direct service installation refuses to overwrite an already loaded launchd definition; launcher and terminal tunnel ownership remain separate.
- Tunnel and launcher control operations propagate cancellation, retain exact child handles, serialize per control scope and prevent a new control command from overlapping an unresolved predecessor.
- Catalog and smoke proof are guarded by generation, runtime identity, daemon PID, current mode/config and current setup state. Late smoke/MCP results cannot resurrect invalidated evidence.
- Account capability and connector evidence use per-account epochs. Disable, logout, failed reinspection, authentication loss, account switching and failed connector checks invalidate stale proof before new routing can use it.
- Automatic account/tab reveal preserves later explicit user selection. Pinned fresh turns still pass readiness checks while exact retained/running continuations retain their ownership semantics.
- DEV status preserves valid configuration while reporting tunnel/feature probe errors separately. Tunnel status distinguishes launcher-owned runtime health from terminal-owned launchd service state.
- Journal inspection is read-only; explicit recovery uses exact active-primary/inactive-recovery evidence and byte guards. Missing journal copies now fail closed instead of silently recreating over a concurrent change.
- Gateway results preserve structured fields through the existing freeform JSON envelope, preserve `isError`, and reject unmappable nested shell options before execution.
- DEV compaction uses the correct mode-specific instruction set. Undeclared or malformed simulated tool calls and duplicate call IDs fail closed before receipts are retained.
- Renderer persistence and browser-surface actions are ordered and intent-aware. Stale activation cannot reopen Browser over Settings/Activity/MCP; MCP wizard state changes only after successful persistence.
- Connector popup observation stays fail-closed with exact row, highlight and selected-pill checks; stale popup cleanup happens before retry.
- Helper and tunnel child cleanup retain process ownership through bounded shutdown, TERM/KILL escalation and observed settlement.

The generation-4 contract remains unchanged: **Codex Native4**, **Codex Native4 DEV**, **Codex Zero Risk4**, with the same public ABI pins.

## Final verification

The parent ran one shared focused pass after all six waves:

- gateway structured-error and nested-shell-option case — passed;
- ordinary journal inspection preserving a reintroduced hook — passed;
- pinned account readiness/affinity case — passed;
- catalog proof rejects retired/foreign evidence and accepts current owned evidence — passed;
- both service installer functions checkpoint their own plist bytes before synthetic bootstrap failure — passed;
- backend and launcher `tsc --noEmit` — passed;
- syntax checks for five changed Electron modules — passed;
- `git diff --check` — passed.

The focused cases used isolated temporary files, a synthetic broker/stdio path and mocked service commands. They did not start an actual tunnel, launchd service, Electron production instance or ChatGPT account session. No full suite or broad benchmark ran. The combined automated verification stayed within the shared fast-check budget.

## Remaining boundaries

The source-level corrections do not prove account-side connector approval, live ChatGPT schema loading, real picker DOM ownership, a completed native turn, installed-app behavior, or every launchd/OS scheduling interleaving. Cross-process compare/write races and a few noncooperating-process recovery cases remain explicitly fail-closed rather than guessed away. These are recorded in the individual wave reports and were not counted as silently solved.

No DMG, signing/notarization, installed-app replacement, production restart, release tag or ChatGPT account mutation was performed in this task.
