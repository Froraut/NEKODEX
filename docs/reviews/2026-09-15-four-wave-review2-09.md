# Review wave 2, lane 9 — browser mode descriptor/auth

Frozen source: `3a66157a8943a80bbbe299699cc96bec82721ba1`. Manual, read-only trace of `browser-host.cjs` and direct setup, account-pool, control-server and launcher-browser-host callers. No executable checks or source changes.

## Counts

**New confirmed defects: 0. Repeated candidates: 0. Rejected/qualified first-wave claims: 1 (`R2-9-1`). Known limitations/optional: 1.** No defect ID is assigned to an unproven runtime failure. `R1-9-n` had no findings, so there is no lane-9 duplicate; the account affinity readiness bypass in `R1-8` is a separate candidate and is not repeated here.

## R2-9-1 — qualify first-wave authentication wording, no defect

**Trigger and lines:** For an Automatic session probe whose JSON session response explicitly has no user or has expired, `launcher/electron/browser-host.cjs:2940-2944` marks verification `rejected`; `:3021-3039` sets `authenticated: false` and signed-out status, but `probeAuthentication({ forSetup: true })` throws only when `!rejected` (`:3035-3037`). Thus the blanket wording in `R1-9` that “setup still rejects unverified authentication” cannot mean that every negative probe itself throws. A failed fetch/HTTP challenge is `unavailable` (`:2917-2923,2952-2965`) and does throw for setup; a confirmed sign-out is a different verdict.

**Consequence and counterevidence:** This distinction changes the local probe's return/exception contract; it does **not** establish that setup accepts a signed-out account. Setup's Automatic inspection calls `inspectLauncherBrowserHost` (`src/setup.ts:330-340`), whose control request uses the descriptor token (`src/launcher-browser-host.ts:392-400`) and rejects evidence without `authenticated === true` and `temporary === true` (`:401-405`). The control server routes that request to the host's helper inspection (`launcher/electron/control-server.cjs:122-130`; `browser-host.cjs:3128-3165`), which also rejects incomplete authenticated/temporary evidence (`:3150-3152`). Manual mode deliberately disables automatic inspection (`control-server.cjs:122-127`). Classification: **qualified R1-9 statement, no proven auth bypass**.

## Descriptor transaction and direct callers

`browser-host.cjs:526-561` publishes the proposed Automatic mapping before runtime setup; the callback may commit once and only after setup's runtime becomes ready (`launcher/electron/runtime.cjs:1522-1532`). `main.cjs:797-829,896-929` persists the mode after success. The host override bridges that state-publication interval (`browser-host.cjs:240-252`), and failure clears it and republishes the previous mode (`:555-560`). The account pool wraps per-account descriptor writes and republishes the selected home plus exact target union (`account-pool.cjs:60-69,116-139`); the source-first-wave concern about a lost *shared* descriptor is therefore not supported by a mere per-host write. The selected host alone changes mode (`:296-299`), and the control server gates Automatic starts when Manual is selected (`control-server.cjs:281-295`). The helper resolves the selected/leased target by ownership ID (`src/launcher-browser-host.ts:266-315`); no new public schema or connector name is embedded in the host (`browser-host.cjs:3064-3069,3194-3221`). Completion of the UI invoke is the resolved setup and persisted state path, not a missing standalone mode IPC.

## Conditional limitation, no new finding

If a runtime setup failure also fails to restore the prior runtime (`runtime.cjs:1562-1588`), the host's finally path still republishes its prior-mode descriptor (`browser-host.cjs:555-560`). That is a compound recovery failure requiring exact runtime/descriptor evidence; the source already reports restoration failure and does not prove a normal mode switch or an identity migration silently succeeded. Similarly, existing turn target IDs across accounts are retained for exact leases (`account-pool.cjs:136-139`); their presence alone is not a stale-identity defect. No speculative Native4/ZeroRisk4 identity, schema or production change is proposed.
