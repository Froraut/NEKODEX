# Review wave 1, lane 15: routing hook ownership

Baseline `3a66157`; manual source review only. Scope: `src/codex-integration.ts`, `src/codex-integration-journal.ts`, direct CLI caller and JSON hook helper, with the generation4 connector and tunnel/upstream boundary reports. No execution, typecheck, or code change.

## Potential finding (1)

### R1-15-1 — A status read can remove a hook added after disconnect

- **Trigger:** A version 11 JSON-hook installation is disconnected, leaving an inactive journal. Later, another actor adds the same `{ type: "command", command: <recorded command>, timeout: 3 }` entry at the journal's recorded group/hook index (for example, after an external restore of the hooks file). A `nekodex route status` read follows before another disconnect.
- **Code path:** `src/cli.ts:336` calls `inspectCodexIntegration()`, which calls `readJournal()` at `src/codex-integration.ts:748`. With identical journal copies, `readJournal()` calls `reconcileInactiveJsonHook(primary)` at `src/codex-integration-journal.ts:329-331`. That obtains `restoredInactiveJsonHook()` at lines 225-238; the exact entry matches by index and hash, then lines 262-268 write its removal. Thus a status operation mutates `hooks.json` and removes an entry created after disconnect without a new active ownership claim.
- **Consequence:** The actor's hook disappears as a side effect of a read; the resulting status hides the discrepancy. A same-command, same-entry insertion is indistinguishable from a pending interrupted disconnect using only the journal's current index/hash. This is a source-derived potential ownership defect, not a live reproduction. It needs adjudication against the intended crash-recovery policy before changing the mechanism.
- **Counterevidence / boundary:** The direct `deactivateCodexIntegration()` path uses `readJournal({ reconcileInactiveHook: false })` at `src/codex-integration.ts:511-530` and refuses an occupied inactive slot. A changed command or entry hash fails the exact verification rather than being removed; `src/codex-integration-journal.ts:239-250` also refuses an occupied foreign slot. Automatic reconciliation deliberately handles a crash between journal/config and hook writes. The upstream report documents the repeated-disconnect correction; this finding concerns a later *status* read, not that direct correction. No generation4 identity or public schema change is implicated.

## No defect counted

- Active JSON hook verification during preflight/install, disconnect and status checks the recorded entry before removing or rewriting it (`src/codex-integration.ts:303-310,391-402,536-558,760-764`). Those paths fail closed on a changed entry.
- Inactive journal disagreement and recovery have separate config/hook matching checks (`src/codex-integration-journal.ts:272-295,350-384`); no second concrete unsafe write was established from the reviewed path.
- The generation4 report explicitly leaves live ChatGPT schema loading, approval and retained-task transition unproven. Missing live proof is not counted as a routing defect.

Counts: **1 potential finding**, **0 confirmed live defects**, **0 optional improvements proposed**. No tests or scripts run; no production, installation, commit or identity/schema changes.
