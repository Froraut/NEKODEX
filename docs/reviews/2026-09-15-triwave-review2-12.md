# NEKODEX triwave review 2, lane 12 — launcher state

Baseline: 3740505b0107af9a83053fd523ae1ad30be36465 (HEAD). Scope: independent read-only review of launcher state publication and identity-sensitive proof in launcher/electron/main.cjs, launcher/electron/state.cjs, launcher/electron/account-pool.cjs, launcher/src/App.tsx, launcher/src/Overview.tsx, and launcher/src/AccountSettings.tsx. Compared against docs/reviews/2026-09-15-triwave-review1-12.md, docs/reviews/2026-09-15-four-wave-results.md, and docs/reviews/2026-09-15-four-wave-adjudication.md. Manual source review only. No tests, typechecks, scripts, broad audits, runtime/browser actions, production actions, code edits, commits, or publication were performed. Native4, Native4 DEV, ZeroRisk4, their connector identities, public tool schemas, and ABI pins were not changed or implicated.

## Result

2 new concrete state-proof defects: T2-12-1 and T2-12-2.

Both are identity-transition paths outside the prior D03/D04/D06/D13 corrections. The current code stores setupIdentityHash with the authenticated account label, but does not use that identity to invalidate account-sensitive MCP proof when the selected account changes or when the selected account is logged out.

## T2-12-1 — Selecting another account leaves account-sensitive MCP proof marked verified

- Classification: new concrete defect; distinct source path from startup-failure invalidation and from the logout path below.
- Trigger: Automatic production mode has mcpSetupComplete === true after connector verification for selected account A. The user selects an already-created account B through Settings. launcher:account-select calls browserHost.selectAccount(id) and returns only the browser-pool snapshot at launcher/electron/main.cjs:942-946. AccountBrowserPool.selectAccount awaits the new host, commits the registry selection, rewrites the browser descriptor, increments selection state, and publishes browser state at launcher/electron/account-pool.cjs:183-201; it does not update launcher state or invalidate MCP proof.
- Consequence: persisted launcher state continues to report mcpSetupComplete: true, while setupIdentityHash still identifies account A. The renderer receives the new browser snapshot, but currentToolProof in launcher/src/App.tsx:48-53 reads only mcpSetupComplete (plus a failed runtime-start operation), while Overview.tsx:15-23 marks the tool connection ready from that flag alone. The UI can show the connector as verified for B even though B has not undergone the connector verification represented by the stored proof. A later Automatic turn uses B’s browser surface, so the stale global proof can suppress the intended per-account check.
- Source evidence: verification writes mcpSetupComplete: true, setupContract, timestamp, and an identity hash derived from the current runtime config and browser account label at launcher/electron/main.cjs:682-687; setupIdentity explicitly includes account at launcher/electron/upgrade-readiness.cjs:6-12. The only caller that changes the selected account is launcher/src/AccountSettings.tsx:94-101, which invokes api.selectAccount without a proof invalidation. No renderer path compares setupIdentityHash with the selected account identity.
- Minimum correction: On a successful selected-account transition, invalidate or qualify account-bound MCP proof before publishing the new browser state, including the stored identity/timestamp as appropriate. UI readiness must require proof for the currently selected account, while preserving account affinity, active-turn protections, and existing Manual-mode wording. Do not change Native4, Native4 DEV, ZeroRisk4, or public ABI pins.

## T2-12-2 — Logout leaves MCP and smoke proof current after authentication is removed

- Classification: new concrete defect; separate trigger and direct caller from T2-12-1, although the minimum state-invalidation mechanism may be shared.
- Trigger: Automatic production mode has completed MCP verification and possibly browser smoke for the selected account. The user invokes logout. launcher:browser-logout awaits browserHost.logout(), then updates only sessionRefreshReminderAt and publishes the returned browser state at launcher/electron/main.cjs:609-613. BrowserHost.logout clears session storage, confirms authentication is gone, and returns the unauthenticated browser snapshot at launcher/electron/browser-host.cjs:2795-2817.
- Consequence: logout does not clear mcpSetupComplete, setupIdentityHash, setupVerifiedAt, browserSmokePassed, or browserSmokeVersion. Overview.tsx:15-23 correctly makes the overall ready conjunction false when signedIn is false, but its individual tool connection still reports ready solely from mcpSetupComplete. In Setup, currentToolProof also remains true unless runtime-start failed, and the smoke row can continue to display passed because App.tsx:44-45 checks only the stored flag and app version. After subsequent login, these proofs can be presented as current without a fresh authenticated account proving them.
- Source evidence: logout’s state patch is limited to the reminder field at main.cjs:609-613; the browser implementation confirms the unauthenticated result at browser-host.cjs:2803-2817. The state store invalidates catalog/picker/MCP evidence only when coreSetupComplete === false at state.cjs:96-100,132-140; logout does not set that field or any proof fields. The smoke predicates at main.cjs:468-470 and App.tsx:44-45 have no authentication or account-identity condition.
- Minimum correction: Logout must invalidate account-sensitive MCP and smoke evidence, or mark it historical until a fresh authenticated account proves it. The next login/account selection must not inherit an old account’s current proof merely because the app version matches. Preserve optional smoke semantics after core setup and preserve Manual-mode semantics.

## First-wave challenge and repeats

- D03/D04: catalog epoch/supervisor checks and identity-bound health checks remain corrected in main.cjs:151-198 and runtime-supervisor.cjs:608-634. Repeat, no new ID.
- D06: renderer smoke derivation is corrected in App.tsx:88-101,132-141,172-181,215-223 and main.cjs:468-470. T2-12-2 is a different invalidation omission: logout changes authentication/session identity while leaving persisted version-matched smoke proof.
- D13: startup failure branches clear coreSetupComplete, catalog, and MCP fields before route recovery at main.cjs:1423-1430,1443-1450,1468-1471. T2-12-1 and T2-12-2 are successful user identity transitions outside those branches.
- The prior lane’s optional setup-core state-event publication remains optional; its direct UI caller immediately requests a fresh snapshot at App.tsx:1391-1394. No new ID.

## Known limits

- Source review does not prove live ChatGPT account connector state, account-label stability, or that every account uses a distinct authenticated ChatGPT session.
- The findings establish stale launcher proof under the explicit source transitions; they do not claim a later browser turn will always fail.
- No live account, runtime, UI, or installed-app behavior was exercised. Parent-owned final focused verification remains bounded to at most 60 seconds and at most 10 scenarios.
- Public connector publication, native approval, schema loading, and retained-task behavior remain outside this lane.

## Counts

- New concrete defects: 2 — T2-12-1, T2-12-2
- Repeats/corrected adjudicated roots: 4 — D03, D04, D06, D13
- Rejected first-wave claims: 0
- Optional improvements: 1 repeated optional boundary — setup-core could publish its returned state immediately
- Known proof limits: 4
- ABI/identity/schema findings: 0; Native4, Native4 DEV, and ZeroRisk4 remain preserved.

