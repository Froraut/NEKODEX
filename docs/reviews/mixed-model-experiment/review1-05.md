# NEKODEX mixed-model experiment review wave 1, lane 5

- Review type: manual source review only
- Baseline: `9925453bd51e61c7b398abec12ec0da3aca3d3af`
- UTC start: `2026-09-15T20:28:21Z`
- UTC end: `2026-09-15T20:33:43Z`
- Scope inspected: `launcher/electron/main.cjs`, `launcher/electron/state.cjs`, and `launcher/electron/upgrade-readiness.cjs`; direct callers and consumers inspected only where needed to establish the proof publication path: `launcher/electron/account-pool.cjs`, `launcher/electron/runtime.cjs`, `launcher/electron/runtime-supervisor.cjs`, and the renderer's `currentToolProof` helper in `launcher/src/App.tsx`.
- Guidance applied: `skills/nekodex-regression-prevention/SKILL.md` and `/Users/alex/.codex/skills/right-size-test-runs/SKILL.md`.
- Verification: no tests, typechecks, scripts, live actions, edits to source, commits, or delegation. This is a manual review of source behavior only.

## Findings

### 1. High — positive MCP proof is not bound to the runtime instance

- Exact location: `launcher/electron/main.cjs:151-166` (`captureAccountProofContext`, `accountProofContextIsCurrent`); `launcher/electron/main.cjs:1423-1498` (startup and upgrade preservation). Related renderer consumer: `launcher/src/App.tsx:48-53` (`currentToolProof`).
- Trigger:
  1. Complete MCP verification so persisted state contains `mcpSetupComplete: true` and a valid `setupIdentityHash`.
  2. Quit and relaunch, or replace/restart the managed runtime while keeping the account, mode, and configuration values unchanged.
  3. The new runtime has a new process/instance, but `setupIdentity(...)` still hashes the same account and selected configuration. On an unchanged upgrade, `preserveSetup(...)` also accepts the old proof, and the renderer treats `mcpSetupComplete === true` as current tool proof.
- Impact: a successful connector/runtime check from an earlier runtime instance remains positive evidence after the runtime process that was checked has been replaced. A newly started runtime can therefore be presented as verified before its current process, route, and MCP endpoint have been checked. This violates the proof invariant that runtime identity must be part of the currentness predicate.
- Smallest fix: add a persisted runtime instance/boot identity to the proof record and to `captureAccountProofContext`/`accountProofContextIsCurrent`, or conservatively clear `mcpSetupComplete` whenever the launcher starts or replaces the managed runtime and require a fresh `launcher:mcp-verify`. Do not let `preserveSetup` preserve the positive MCP flag across a new runtime instance unless that instance identity is explicitly carried and revalidated.
- Confidence: high. The current predicate contains generation, interaction mode, account label, and selected config, but no runtime PID/instance identity; the renderer consumes the positive flag directly.
- Classification: bug, not a design limitation.

### 2. High — state loading accepts positive MCP proof without schema/account identity

- Exact location: `launcher/electron/state.cjs:101-119` (`readState`); `launcher/src/App.tsx:48-53` (`currentToolProof`).
- Trigger:
  1. Start with a version-1 state file containing `mcpSetupComplete: true` but no `setupContract`/`setupIdentityHash`, or with a malformed `setupIdentityHash` that `readState` removes.
  2. Launch the app.
  3. `readState` validates and deletes the malformed identity field, but does not clear `mcpSetupComplete`. The renderer's readiness predicate checks only `mcpSetupComplete` (plus the runtime-start failure special case).
- Impact: the launcher can expose a positive MCP/tool-ready state even though no current setup contract, account identity, or setup verification record accompanies it. This is exactly the stale/legacy-state path that schema and account identity checks are supposed to close.
- Smallest fix: make `readState` fail closed by clearing `mcpSetupComplete` whenever the required proof fields are absent or invalid. The check should require the current `SETUP_CONTRACT` and a valid `setupIdentityHash` plus valid verification metadata; if `state.cjs` must remain independent, pass the current contract into normalization or perform the equivalent current-contract check at the single proof predicate/writer.
- Confidence: high. The parser currently deletes invalid identity data independently of the positive flag, and the renderer does not require the deleted fields.
- Classification: bug, not a design limitation.

## Design limitation, not counted as a bug

Manual mode deliberately records `mcpSetupComplete: true` after local runtime health and returns a connector check with `status: "warning"`, while telling the operator to select the connector for each turn (`launcher/electron/main.cjs:708-727`). That is an explicit distinction between local runtime proof and ChatGPT-side connector selection, so it is not counted as a finding here.

## Zero-findings note

This review is not zero-findings: the two findings above are concrete current bugs in proof invalidation and schema/account/runtime identity. No additional issue met the requested bar without relying on speculative hardening, stylistic preference, or a historical already-fixed claim.
