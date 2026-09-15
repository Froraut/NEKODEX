# Review wave 2, fresh Sol lane 6 — launcher runtime migration

Frozen baseline: `3a66157a8943a80bbbe299699cc96bec82721ba1`. Manual, read-only source review of `launcher/electron/runtime.cjs`, direct setup/startup paths, and R1-06; R1-07 and R1-04 were read only where their failure roots intersected this path. No execution or source change.

## New concrete defects

**0.** No R2-6-n ID assigned. The candidate paths below do not establish a distinct new failure.

## Challenged candidates and counterevidence

- **Same-version legacy migration / Browser-only mode:** A launcher-owned persisted legacy name in any of `appName`, `automaticAppName`, or `manualAppName` is detected from `readSetupConfig()` before strict validation (`runtime.cjs:486-520`; `runtime-supervisor.cjs:403-420`). It bypasses the same-version early return, and the setup argument retains Full versus Browser-only (`runtime.cjs:1297-1335`). Production startup awaits upgrade before the final supervisor start (`main.cjs:1332-1377`). R1-06's rejection of this candidate stands. A Full migration still needs setup credentials and the fresh ChatGPT connector; an error there is not evidence that the name was silently reused.
- **Active tunnel identity:** Setup compares the persisted active name against its migrated copy and includes that difference in worker refresh (`src/setup.ts:131-140,526-534`); inactive names alone need no active-worker restart. The stricter runtime parser rejects legacy active/inactive names after setup (`src/config.ts:443-468`). This supports R1-06's active-profile observation; it does not prove account-side connector creation.
- **Rollback claim narrowed, not rejected as a finding:** R1-06 says `runSetup()` restores its checkpoint after failure. The code *attempts* restoration and reports individual restoration/recovery failures (`runtime.cjs:1547-1583`); it does not guarantee restoration when filesystem operations themselves fail. Preflight precedes stop (`runtime.cjs:1514-1525`). If an old retired identity is restored, the new supervisor can return `needs-setup` instead of ready (`runtime.cjs:612-653`; `runtime-supervisor.cjs:1258-1267`), which R1-06 already labels a surfaced recovery boundary. The startup catch publishes a failure (`main.cjs:1452-1465`). No distinct R2 defect is established by that limitation.
- **Readiness flags:** R1-07-2 already records the stale saved MCP-ready presentation after failed production startup (`main.cjs:1432-1465`), so it is a repeated candidate, **R1-7-2**, not R2-6-n. A false `coreSetupComplete` or `codexCatalogVerified` after failure is an invalidation decision, not proof that the local process or account-side connector failed. The `not-configured` branch clears MCP flags as well (`main.cjs:1409-1421`). R1-07-1's in-flight catalog race and R1-07-3's DEV readiness path remain that lane's distinct roots.
- **Terminal-managed rollback:** R1-04-1/2 concern writes to external launchctl definitions in `src/setup.ts`; `runSetup()` checkpoints launcher-visible files and chooses external repair when changed (`runtime.cjs:545-591,1562-1569`). Those reports are adjacent, not new launcher migration findings. No assertion of guaranteed service recovery follows from the file checkpoint.

## Known limitation / optional

The first-wave documented recovery and live account-proof boundaries remain limits rather than new bugs. A more explicit recovery explanation could distinguish restored files from a runnable former identity; the existing error already says previous runtime recovery failed (`runtime.cjs:1572-1582`). No schema or Native4/Zero Risk4 identity change is supported.

Counts: **0 new defects; 1 repeated candidate (R1-7-2); 0 rejected R1 findings; 1 R1 claim narrowed; 1 known recovery boundary; 1 live-proof boundary; 1 optional wording improvement.**
