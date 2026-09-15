# NEKODEX adjudication review 3, lane 5

- Repository: /Users/alex/Dev/nekodex
- Baseline: 9925453bd51e61c7b398abec12ec0da3aca3d3af
- Review type: manual source adjudication only
- Scope: launcher/electron/main.cjs, launcher/electron/state.cjs, launcher/electron/upgrade-readiness.cjs, and direct callers/consumers required to establish proof publication and readiness behavior.
- Guidance applied: /Users/alex/Dev/nekodex/skills/nekodex-regression-prevention/SKILL.md and /Users/alex/.codex/skills/right-size-test-runs/SKILL.md.
- Verification boundary: no code edits, tests, typechecks, automated audit, runtime actions, commits, or delegation.

## Adjudication

### Review1 claim 1 — accepted

**Verdict:** accepted. **Root:** L05-runtime-instance-proof.

captureAccountProofContext() and accountProofContextIsCurrent() in launcher/electron/main.cjs bind in-flight publication to the proof generation, browser interaction mode, account label, and setupIdentity(runtime config, account). setupIdentity() in launcher/electron/upgrade-readiness.cjs hashes configuration and account, but no runtime PID, boot instance, supervisor ownership identity, or equivalent instance token. The startup path can call runtimeSupervisor.startIfConfigured() and then retain mcpSetupComplete; an unchanged configuration therefore produces the same setup identity after a runtime replacement. The renderer's currentToolProof() consumes the positive boolean directly, subject only to the runtime-start failure special case.

The late-publication guards are valid counterevidence for an in-flight verification race: they reject a result when the generation, mode, or configuration/account identity changes. They do not invalidate a proof already persisted before a new runtime instance starts. This is an actionable currentness gap, not a hypothetical UI state.

### Review1 claim 2 — accepted

**Verdict:** accepted. **Root:** L05-persisted-proof-schema.

readState() in launcher/electron/state.cjs deletes an invalid or missing setupIdentityHash and independently retains mcpSetupComplete. It also accepts a positive MCP flag without requiring setupContract, setupIdentityHash, or verification timestamps. currentToolProof() in launcher/src/App.tsx checks only mcpSetupComplete plus the production automatic runtime-start failure condition. Thus a version-1 record with positive MCP proof and missing or malformed identity fields can still expose tool readiness.

Review2 claim 3 reaches the same root through startup: the normal configured-runtime startup branch synchronizes runtime setting flags, while the identity comparison in preserveSetup() is used only in the managed-runtime-upgrade branch. Explicit logout, account selection, mode changes, and runtime failure paths do invalidate proof, but they do not repair a schema-incomplete positive record at load or revalidate every persisted positive record against the current account/configuration identity. The source therefore supports one merged schema/startup invalidation root.

### Review2 claim 1 — accepted

**Verdict:** accepted. **Root:** L05-runtime-config-invalidation.

The production contextChangeQueue.onApplied callback updates experimentalBiggerContext, catalog/picker state, and restart state, but does not clear mcpSetupComplete, setupIdentityHash, or setupVerifiedAt, and does not retire the account-proof generation. The DEV direct caller has the same omission after runtimeHost.setBiggerContext(). Because experimentalBiggerContext is an input to setupIdentity(), a successful setting mutation changes the identity represented by the saved hash while the MCP proof remains positive. Existing catalog/picker invalidation does not invalidate MCP connector/runtime proof.

### Review2 claim 2 — accepted

**Verdict:** accepted. **Root:** L05-runtime-config-invalidation.

The launcher:zero-risk-pro handler waits for active browser work to settle, then calls runtimeHost.setZeroRiskPro() and updates zeroRiskProEnabled, catalog verification, and restart state. It does not invalidate the MCP proof fields or retire the proof generation. zeroRiskProEnabled is also included in setupIdentity(), so the successful mutation leaves the stored identity hash describing the prior runtime profile. The active-operation guard prevents one concurrency case but does not repair the post-mutation stale-proof state. This is the same invalidation root as Review2 claim 1.

### Review1 unnumbered manual-mode note — design-limit

Manual mode records local runtime health as mcpSetupComplete while returning a connector warning and instructing the operator to select the connector per turn. That distinction is explicit in the MCP verification handler and is not a defect. The public connector ABI and names remain outside this review's proposed fixes.

## Rejected or non-additional issues

No numbered claim is rejected. The existing account-selection, logout, mode-change, runtime-failure, and late-verification invalidators are real protections and were not promoted to findings. No additional defect met the requested evidence bar without relying on speculative hardening, an invented gateway envelope contract, an impossible renderer state already blocked by backend invalidation, or a known unavoidable non-atomic race without a concrete actionable gap.

## Accepted roots and essential fixes

1. **L05-runtime-instance-proof (P1):** Bind positive MCP proof to a launcher/runtime boot or supervisor instance identity, or clear all MCP proof fields whenever the managed runtime starts or is replaced. Require that identity in the single backend proof predicate and in the proof writer; do not preserve proof across a new runtime instance without revalidation.
2. **L05-persisted-proof-schema (P1):** Fail closed when loading or starting with positive proof that lacks the current setup contract, valid identity hash, and required verification metadata. Recompute and compare the current account/config identity during startup, then clear the complete dependent proof record on mismatch or incomplete schema before readiness can be published.
3. **L05-runtime-config-invalidation (P1):** Route successful Bigger Context and Zero Risk Pro mutations through the existing account-proof invalidation path, clearing all dependent proof fields and retiring the publication generation before publishing the new runtime configuration. Apply the same rule to production queue and DEV direct callers.
