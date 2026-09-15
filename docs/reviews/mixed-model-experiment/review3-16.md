# NEKODEX adjudication review3 lane 16 — identity

- Baseline: `9925453bd51e61c7b398abec12ec0da3aca3d3af`
- Review type: manual source adjudication only
- Scope: `src/config.ts`, `launcher/electron/connector-identity.cjs`, direct identity callers and downstream guards
- Source status: unchanged; no tests, typechecks, automation, runtime actions, commits, or delegation

## Adjudication

### Review1 claim 1 — whitespace-padded connector identities bypass migration checks

**Verdict: accepted. Root: `L16-padded-identity`. Severity: P2.**

The trigger is reachable. `loadConfigForSetup()` derives `automaticName` from persisted config and calls `isLegacyChatGptConnectorName(automaticName)` without canonicalizing it first (`src/config.ts:373-383`). `parseConfig()` repeats the same exact, untrimmed legacy checks for `appName`, `automaticAppName`, and `manualAppName` (`src/config.ts:437-457`). Therefore a value such as `"Codex Native3 "` is non-empty and within the length limit, but it is neither migrated nor rejected as a legacy value.

The downstream evidence makes this a concrete identity split rather than a cosmetic input issue. The Electron helper trims connector names in `validateConnectorName()` (`launcher/electron/connector-identity.cjs:14-19`) and the runtime legacy detector trims persisted names before checking them (`launcher/electron/runtime.cjs:501-507`). Meanwhile `parseConfig()` returns the untrimmed `automaticAppName` and `appName` (`src/config.ts:571-575`), `providerConfig()` projects that value to `chatgptWeb.appName` (`src/config.ts:593-624`), and the browser worker performs exact connector-row and connector-identity comparisons with that value (`src/adapters/chatgpt-web/browser-worker.ts:3110-3123,3228,3401,3445,4490`). The launcher and browser-worker layers can therefore disagree about the connector string or fail exact matching. The existing guards reject exact retired names, but they do not close the padded form.

Smallest fix: establish one canonical connector-name boundary for persisted config before legacy detection and equality checks. Either trim the three connector fields and use the canonical values throughout the returned config and migration path, or explicitly reject non-canonical whitespace. Preserve the public connector names and ABI; do not broaden custom-name policy.

### Review2 claim 1 — setup migration is isolated and runtime loading rejects retired identities

**Verdict: rejected as a defect claim. Root: none.**

The exact-name behavior is protected as described: `loadConfigForSetup()` owns migration (`src/config.ts:361-399`), while strict parsing rejects exact legacy active names with the migration message (`src/config.ts:443-467`). The accepted padded-identity defect is the missing canonicalization boundary around those checks; it does not invalidate the exact-name guard.

### Review2 claim 2 — mode/name and tunnel selection can leave an invalid active configuration

**Verdict: rejected as a defect claim. Root: none.**

The source rejects an active name that does not match the selected interaction mode and rejects equal automatic/manual connector names (`src/config.ts:459-467`). Full mode independently validates tunnel records, distinct tunnel IDs, active-mode presence, and equality between the active tunnel and the legacy `tunnel` field (`src/config.ts:507-520`). The Electron runtime supervisor repeats the tunnel boundary (`launcher/electron/runtime-supervisor.cjs:316-332`). No reachable current invalid state remains from this claim after those guards.

### Review2 claim 3 — direct verification or failure cleanup can publish false readiness or hide the primary error

**Verdict: rejected as a defect claim. Root: none.**

Automatic verification calls the current-name guard before spawning the browser helper (`launcher/electron/browser-helper-verifier.cjs:109-112`), and the main verification path clears `mcpSetupComplete` on failure while checking proof freshness before publication (`launcher/electron/main.cjs:708-756`). Manual mode explicitly records connector selection as a warning rather than automatic proof (`launcher/electron/main.cjs:708-727`). The helper preserves a primary operation error and attaches cleanup failure (`launcher/electron/browser-helper-verifier.cjs:198-223`), while runtime setup applies the same primary-error-plus-cleanup pattern. The proposed failure modes are therefore closed by existing callers and guards.

## Root register

Only one accepted, actionable root remains after merging duplicate manifestations:

- **`L16-padded-identity` — P2**
  - **Files:** `src/config.ts`, with downstream identity use in `src/adapters/chatgpt-web/browser-worker.ts`; the Electron validator is the inconsistent comparator.
  - **Trigger:** A persisted connector field contains an otherwise valid legacy/current/custom name with leading or trailing whitespace, especially a retired name such as `"Codex Native3 "`.
  - **Impact:** TypeScript config migration and strict parsing miss the retired identity while Electron trims it; returned provider/browser config can retain the padded string and fail exact connector matching.
  - **Fix:** Canonicalize connector fields once at the config boundary before migration, legacy checks, equality checks, and provider projection, or reject non-canonical whitespace. Keep public connector names and ABI unchanged.
  - **Evidence:** `src/config.ts:373-383,437-467,571-575,593-624`; `launcher/electron/connector-identity.cjs:14-23,40-49`; `launcher/electron/runtime.cjs:501-507,1023-1045`; `src/adapters/chatgpt-web/browser-worker.ts:3110-3123,3228,3401,3445,4490`.

## Counts

- Numbered claims adjudicated: 4
- Accepted: 1
- Rejected: 3
- Design-limit: 0
- Accepted unique actionable roots: 1
- Additional defects: 0

This review establishes source-level behavior only. It does not establish ChatGPT-side connector creation, approval, cache state, live DOM state, or production behavior.
