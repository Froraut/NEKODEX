# Lane 2 — setup connector identity migration

Baseline: `d880b12`. Assigned implementation: `src/setup.ts` only. Canonical targets are `Codex Native4`, `Codex Native4 DEV`, and `Codex Zero Risk4`; `Codex Zero Risk3` is a defensive alias, not a published identity here.

## Change

Setup already obtains the canonical active, Automatic, and Manual names from `resolveInteractionConnectorIdentities`; the parent-owned `src/config.ts` supplies generation 4 names and migrates saved legacy names in memory. That in-memory migration hid an active persisted legacy name from setup's ordinary before/after comparison. `src/setup.ts` now reads the saved active name for this decision only. When a known legacy active connector is migrating in Full mode, setup refreshes the existing mode's tunnel worker/profile. A loaded terminal daemon treats that migration as a runtime change, requiring `--restart-service` and an idle drain before replacement. DEV setup likewise refreshes its isolated tunnel profile. Existing snapshot and ownership checks govern rollback; Automatic and Manual tunnel IDs, runtime keys, and profile names remain separate. Inactive legacy names alone do not trigger a tunnel refresh.

The Manual Full-mode error now uses `ZERO_RISK_CHATGPT_CONNECTOR_NAME`, so it reports `Codex Zero Risk4` from the canonical parent constant.

## Review and limits

Manually reviewed the setup branches that select tunnel profiles, guard a loaded daemon, and restore setup-owned config/tunnel state after failure. No tests, typechecks, runtime/account setup, commits, or release actions were run in this lane, per the shared verification and ownership limits. New ChatGPT connector creation and real action invocation remain unproven by this local code change.

Changed paths: `src/setup.ts`; this report. No outside-scope code edits.
