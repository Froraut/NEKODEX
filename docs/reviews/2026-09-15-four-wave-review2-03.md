# Four-wave review 2, lane 03 — core connector identity migration

Baseline: `3a66157a8943a80bbbe299699cc96bec82721ba1`. Frozen-source manual review of `src/config.ts`, direct setup/runtime callers, Wave 1 lane 03, and adjacent lanes 04/10 where the exact migration or rollback root overlaps. No tests, typechecks, scripts, runtime/account operations, source edits, or publication.

## Counts

- New concrete defects: **0** (`R2-3-n` IDs: none).
- Repeated candidates: **2**, both `R1-4-1` and `R1-4-2` from the adjacent setup rollback lane; no new IDs assigned.
- Rejected or qualified first-wave claims: **1**.
- Known limitations: **1**; optional improvements: **1**.

## Independent failure trace and challenge

**Active legacy migration:** Trigger: a persisted active Native3/Native3 DEV or older Zero Risk identity is loaded for setup. `src/config.ts:361-399` maps known legacy names in the setup copy, while runtime `loadConfig` calls strict `parseConfig` and rejects retired active/automatic/manual names at `src/config.ts:355-358,444-467`. `src/setup.ts:131-140,531-534` compares the *raw persisted active* `appName` with the new target before tunnel reuse, and `:966-969` applies the corresponding DEV refresh. Consequence: this trace does not support silent reuse of the old active tunnel identity. Counterevidence/limit: inactive names do not refresh the active tunnel by design; `src/config.ts:116-125,515-520` keeps mode-specific tunnel selection distinct. The setup path must still complete, and source inspection cannot certify account-side connector creation.

**Qualification of Wave 1 lane 03's rollback claim:** Its statement that setup writes active tunnel and identity “in the same transaction with rollback” (`review1-03.md:7`) is too categorical for failing installation calls. Trigger: `launchctl bootstrap` fails after service or tunnel-service plist bytes were written but before the caller checkpoints them. `src/setup.ts:699-701,742-743` checkpoints only on successful returns; rollback's stale ownership snapshots at `:796-806,823-826` can leave setup-owned plist bytes and an old stopped service. Consequence: an old config with a new definition, or a stopped prior tunnel, is possible on those conditional failures. Counterevidence: the adjacent `review1-04.md:7-18` already reports the precise paths as `R1-4-1` and `R1-4-2`; successful installation reaches the checkpoints, and neither launchd failure was reproduced. These are **repeated candidates**, not new core-config defects or proof that ordinary migration fails. The narrower first-wave conclusion about raw active identity comparison remains supported.

**Mode and provider routing:** Trigger: a valid Manual config is loaded. `src/config.ts:423-427,447-468` requires Full launcher host, a distinct Zero Risk4 manual name, and active name matching the selected mode; `:578-580` projects Manual account capability flags false, while `providerConfig` at `:593-624` selects the manual backend and app name explicitly. Consequence: false capability flags in Manual mode do not establish a runtime failure. Counterevidence: `review1-10.md:11-15` traces exact helper identity verification in Automatic and a deliberate local-health warning in Manual; no source evidence here establishes missing settlement merely from lack of direct IPC.

## Boundaries

- **Optional (same as Wave 1 lane 03, no new ID):** Trigger: an Automatic saved config uses a nonlegacy custom connector name and ordinary setup is rerun. `src/config.ts:373-393` preserves that name on load, but `src/setup.ts:258-269,467-476` selects the canonical profile identity. Consequence: setup switches the target to Native4. Counterevidence: `connector-generation4-results.md:14` says custom cached App IDs need a distinct new identity for the changed schema; retaining the old cache would be unsafe. A separate explicit custom-new-identity workflow is an optional compatibility decision, not a canonical identity migration defect.
- **Known evidence limit:** `connector-generation4-results.md:44-56` provides bounded local protocol evidence but no proof that ChatGPT loaded the new public schema, live native approval completed, or retained account tasks survived. Missing live proof alone is not a source finding.

Native4, Native4 DEV, Zero Risk4, their public schemas, and tunnel identity assignments require no change from this lane. No `R1-3-n` duplicate exists because Wave 1 lane 03 counted zero defects.
