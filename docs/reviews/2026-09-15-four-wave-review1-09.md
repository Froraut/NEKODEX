# Review wave 1, lane 9 — browser mode descriptor

Baseline: `3a66157`. Scope: source-only manual review of `launcher/electron/browser-host.cjs` mode transaction, descriptor and authentication gate, with direct callers in `main.cjs`, `account-pool.cjs`, and runtime setup callback. No code changes or executable checks.

## Findings

**0 confirmed defects; 0 potential findings (`R1-9-n` IDs unused).** No trigger with a source-proven incorrect generation-4 identity, lost descriptor mapping, or bypassed authentication gate was established in this lane.

## Counterevidence and boundaries

- `browser-host.cjs:526-561` publishes the proposed mode's mapping before calling setup; `main.cjs:797-829,896-929` supplies the setup callback and persists the launcher mode after success. `runtime.cjs:1526-1532` invokes `afterRuntimeReady` only after setup and runtime readiness. On setup failure, the host clears its override and republishes the prior mode. The override remains through the runtime-to-state publication gap and is cleared when saved mode catches up (`browser-host.cjs:240-252`). This addresses the previously documented #482 failure path.
- `browser-host.cjs:3194-3221` derives Automatic `surfaceTargets` from live WebContents and leaves Manual without new Automatic mapping; `account-pool.cjs:116-139` publishes the selected account as home and unions targets for existing exact turn leases. Old target entries in that union are intentional ownership preservation, not evidence of connector relabeling. A real failing trace would be needed to classify a stale-target issue.
- `browser-host.cjs:2844-2848,2905-2966,3021-3037` distinguishes authenticated, rejected and unavailable session verification. A protective HTTP response or failed fetch cannot establish sign-out; setup still rejects unverified authentication. `browser-host.cjs:2322-2343` requires an exact retained conversation key and connector identity rather than moving an old lease to the new connector.
- The host resolves the connector name via `getConnectorName` (`browser-host.cjs:3064-3069`), supplied by the runtime in `main.cjs:1205`; no generation identity or schema is hardcoded in this host. The generation-4 migration report documents current Native4/Native4 DEV/Zero Risk4 identities and separate new App IDs; the tunnel/upstream report records the #482 and #431 corrections. This read-only source review cannot prove account-side connector creation, Electron/CDP behavior, or a live approval, and their absence is not a defect.

Optional follow-up only if a concrete failure appears: capture the selected account, descriptor before/after setup rollback, and the exact helper/retained caller failure. No speculative mode or identity change is proposed.
