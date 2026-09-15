# Connector identity migration — launcher UI lane 4

Baseline: `d880b12`. Scope: `launcher/src/App.tsx`, `launcher/src/i18n.ts` only.

Changed `launcher/src/i18n.ts` in English, Chinese, and Japanese. Setup and Manual mode instructions now use `Codex Native4`, `Codex Native4 DEV`, and `Codex Zero Risk4`. Migration help tells users to create separate connectors and retain Native3, Native3 DEV, and Zero Risk2 as legacy identities. It describes the `codex_exec` schema change as planned and asks for connector creation and verification before tool use; it does not assert that a ChatGPT plugin already exists. `Codex Zero Risk3` was never published here; parent-owned aliases may recognize that name defensively without presenting it as a prior release.

`launcher/src/App.tsx` required no change: the step-three name is rendered from `snapshot.connectorNames[interactionMode]`, so the parent-owned connector identity update supplies the canonical name. The existing migration-help panel displays the revised copy. The old runtime snapshot still reports Native3/Zero Risk2 at this lane's baseline; integration depends on the parent identity change.

Manual review covered the step-three rendering path and all old-name occurrences in the edited localization file. `git diff --check` passed. No tests, typechecks, suites, benchmarks, account changes, or plugin creation were performed under the shared verification budget and lane instructions.
