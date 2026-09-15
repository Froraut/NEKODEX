# Independent blind review wave2 lane5

- Repository: `/Users/alex/Dev/nekodex`
- Baseline: `9925453`
- Source status: unchanged; review only
- UTC review start: `2026-09-15T20:37:55Z`
- UTC review end: `2026-09-15T20:39:07Z`
- Inspected scope: `launcher/electron/main.cjs`, `launcher/electron/state.cjs`, `launcher/electron/upgrade-readiness.cjs`
- Focus: positive proof publication and invalidation; state schema; account and runtime identity; alternate, error, cancellation, and direct-caller paths
- Method: manual source review only. No tests, typechecks, scripts, runtime, commits, delegation, or source edits were used.
- Instructions applied: repository-local [`skills/nekodex-regression-prevention/SKILL.md`](/Users/alex/Dev/nekodex/skills/nekodex-regression-prevention/SKILL.md) and [`/Users/alex/.codex/skills/right-size-test-runs/SKILL.md`](/Users/alex/.codex/skills/right-size-test-runs/SKILL.md).

## Findings

### 1. Bigger Context changes leave a prior MCP/account proof usable

- **Trigger:** A successful MCP verification has set `mcpSetupComplete: true` and `setupIdentityHash`; then the user changes Bigger Context. In production this is the queued `contextChangeQueue` path (`main.cjs:1260-1280`), and in the DEV direct caller it is `main.cjs:913-931`.
- **Exact path:** `upgrade-readiness.cjs:8-10` includes `experimentalBiggerContext` in `setupIdentity`. After the queued mutation, `main.cjs:1275-1279` updates `experimentalBiggerContext`, clears catalog and picker proof, and starts catalog monitoring, but does not clear `mcpSetupComplete`, `setupIdentityHash`, `setupVerifiedAt`, or `pickerVerifiedAt`. The DEV direct caller at `main.cjs:922-927` has the same omission.
- **Consequence:** The runtime identity represented by the stored hash changes while `mcpSetupComplete` remains true and the old account/runtime hash remains persisted. Any readiness path that consumes the MCP boolean can present old connector verification as current until a later verification or explicit account/mode invalidation.
- **Counterevidence:** Catalog and picker proof are invalidated in the queued path, and `mcp-verify` rechecks its captured context before its positive write (`main.cjs:673-736`). Those protections do not clear the already-positive MCP proof when the setting mutation itself completes.
- **Smallest fix:** Treat a successful Bigger Context mutation as an account/runtime proof invalidation: clear `mcpSetupComplete`, `setupIdentityHash`, `setupVerifiedAt`, and `pickerVerifiedAt` (and retire the publication generation) before publishing the new setting state. Apply the same rule to the DEV direct caller.
- **Confidence:** High.

### 2. Zero Risk Pro changes leave a prior MCP/account proof usable

- **Trigger:** A successful MCP verification is followed by `launcher:zero-risk-pro` toggling the profile.
- **Exact path:** `setupIdentity` hashes `zeroRiskProEnabled` (`upgrade-readiness.cjs:8-12`), but `main.cjs:944-961` calls `runtimeHost.setZeroRiskPro`, then only updates `zeroRiskProEnabled`, `codexCatalogVerified`, and `codexRestartRequired` (`main.cjs:953-958`). It does not invalidate the MCP proof fields or retire the proof generation.
- **Consequence:** The stored `setupIdentityHash` describes the previous runtime profile while `mcpSetupComplete` remains true. In production the catalog is reset to false, but that does not make the MCP/account proof itself false; the UI and any direct consumer can still treat the old runtime verification as valid.
- **Counterevidence:** The handler blocks while an active browser turn or browser operation exists (`main.cjs:945-951`), which prevents one class of concurrent mutation. It does not address the stale proof after the allowed mutation succeeds.
- **Smallest fix:** Invalidate account/runtime proof after `setZeroRiskPro` succeeds and before publishing the updated state, clearing all dependent proof fields listed in `state.cjs:9-15` and retiring the publication generation.
- **Confidence:** High.

### 3. Persisted positive proof is accepted without schema or current identity revalidation at startup

- **Trigger:** The launcher restarts with persisted `mcpSetupComplete: true` from an older or externally changed state record lacking a valid `setupContract`/`setupIdentityHash`, or with a valid old hash after the account/runtime identity changed while the launcher was stopped. This is reachable without an `upgrade.updated` event.
- **Exact path:** `state.cjs:116-119` only deletes malformed/missing identity fields; it does not clear `mcpSetupComplete` or other positive proof. Startup reads the state at `main.cjs:1217-1230`, then the normal configured-runtime path at `main.cjs:1457-1466` synchronizes only the two settings flags. The positive identity comparison in `preserveSetup` (`upgrade-readiness.cjs:14-16`) is used only inside the `upgrade.updated` branch (`main.cjs:1427-1448`), and `accountProofContextIsCurrent` (`main.cjs:160-166`) guards in-flight operations rather than persisted proof.
- **Consequence:** On a restart with no runtime upgrade, stale or schema-incomplete `mcpSetupComplete` can survive even though the current account label or runtime configuration no longer matches the proof, so readiness can be shown from cached state.
- **Counterevidence:** Explicit logout, account selection/enabling, and mode changes call `invalidateAccountProof` (`main.cjs:648`, `869`, `980`, `1000-1007`), and runtime startup failures retire the in-memory generation (`main.cjs:1501-1552`). Those paths do not cover a stopped-app identity change or a legacy state record with positive proof.
- **Smallest fix:** During startup, after `browserHost.ready()` and runtime configuration are available, require `coreSetupComplete`, `setupContract === SETUP_CONTRACT`, a valid stored identity hash, and equality with `setupIdentity(currentConfig, browser.accountLabel)` before retaining positive proof; otherwise clear the full account proof patch and retire its generation. At minimum, missing/invalid identity schema must clear `mcpSetupComplete` rather than only deleting the hash.
- **Confidence:** High.

## Review conclusion

Three current, reachable proof-currentness defects were found. They are all invalidation/schema gaps; no speculative future-only hardening, style issue, or known fail-closed limitation is reported.
