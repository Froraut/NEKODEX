# NEKODEX adjudication review3, lane 6

- Baseline: 9925453bd51e61c7b398abec12ec0da3aca3d3af
- Scope: launcher/electron/account-pool.cjs, direct callers and downstream guards needed to adjudicate account capability evidence and selection races.
- Method: read-only manual source review of the unchanged baseline and review1-06.md / review2-06.md.
- Verification: no tests, typechecks, scripts, automated audits, runtime or account actions, commits, source edits, or delegation.

## Adjudication

### Review1 claim 1 — selected default account bypasses capability and connector evidence

**Verdict: rejected.**

The cited branch is real: chooseAccount().eligible() returns immediately for an enabled default account in selected mode at launcher/electron/account-pool.cjs:396-400, before authentication, capability, and connector predicates. The report overstates what that proves. The account registry documents the selected-mode contract as failing when the selected account is disabled (launcher/electron/account-registry.cjs:67-69); it does not require a capability record for the primary selected account. The pool also explicitly exempts default from the connector evidence predicate at account-pool.cjs:406. Automatic turn requests may omit both requestedEffort and connectorIdentity (launcher/electron/control-server.cjs:279-293), so a capability check is not established as a universal admission precondition by the callers.

This is therefore an intentional compatibility policy visible in the source, with no source counterevidence that it violates a named public contract. The UI’s “Models checked” label describes available evidence; it does not by itself prove that every selected primary-account turn must be rejected without it. No root is opened.

### Review1 claim 2 — account disablement can race with turn acquisition

**Verdict: accepted. Root: L06-admission-currentness.**

beginTurn() chooses an account, records ownership and reservation, then awaits host.ready() at launcher/electron/account-pool.cjs:469-483. It does not re-read the registry, compare the account’s enabled state, or re-run the same fresh-turn eligibility checks before host.beginTurn() at lines 484-489. setAccountEnabled() synchronously changes registry metadata and invalidates local capability/connector evidence at lines 215-219, but no post-await guard in beginTurn() observes that change.

The retained/running continuation exception in chooseAccount() is deliberately narrow and does not cover a fresh acquisition. The actionable gap is a pool-owned currentness check after readiness and before browser turn creation, with reservation/ownership cleanup on rejection.

### Review1 claim 3 — account login can start for an account that is no longer selected

**Verdict: accepted. Root: L06-login-selection.**

The renderer performs a split sequence in launcher/src/AccountSettings.tsx:94-98: it awaits selectAccount(A), opens the browser, then starts openAccountLogin(A) without awaiting the second call. The pool method calls selectAccount(A) again at launcher/electron/account-pool.cjs:296-302, then crosses into host.openLogin(). BrowserHost.openLogin() creates its async login operation and enters withManualOperation() only after an awaited readiness boundary (launcher/electron/browser-host.cjs:2504-2532, 3173-3180). During that gap, a separate selectAccount(B) can pass the pool’s current-operation guard and commit B. The login operation can then continue on A while the visible selected account is B.

The existing selectionRevision protects each individual selectAccount() call, but openAccountLogin() does not retain that ownership across the subsequent login start. Selection and login need one pool-owned lease/currentness check, or an equivalent revision check immediately before starting the login operation.

### Review2 claim 1 — checkAccount leaves old capability evidence usable during host readiness

**Verdict: accepted. Root: L06-check-invalidation.**

At launcher/electron/account-pool.cjs:233-241, checkAccount() awaits host.ready() before calling invalidateEvidence(id). A prior capabilities entry therefore remains visible through accountSnapshot().checked and usable by chooseAccount() while the new check is pending. If readiness fails before line 239, the old evidence also survives this check attempt. The separate inspectSession() path invalidates before its asynchronous inspection at lines 279-294, which confirms that the ordering in checkAccount() is an actual lifecycle inconsistency rather than a required precondition.

The fix is to invalidate before the first awaited readiness step and retain the existing epoch check before publishing capability or connector evidence.

### Review2 claim 2 — turn admission does not revalidate proof or enablement after readiness

**Verdict: accepted; merged with Review1 claim 2 under L06-admission-currentness.**

This is the same root as Review1 claim 2. The report correctly identifies that revealRevision at launcher/electron/account-pool.cjs:470 only guards optional visible-account reveal at lines 490-496. It does not protect the fresh account decision or the browser lease created at line 489. Account disablement and any capability/connector invalidation can occur while host.ready() is pending, yet the fresh turn proceeds using the pre-await decision. The exact retained/running owner path is intentionally preserved and does not cure the fresh-admission gap.

### Review2 claim 3 — balanced routing can admit an authenticated but unchecked secondary account

**Verdict: accepted. Root: L06-balanced-evidence.**

The control server passes requestedEffort and connector identity as optional fields into beginTurn() (launcher/electron/control-server.cjs:279-293). In balanced mode, chooseAccount() filters all enabled accounts through eligible() at launcher/electron/account-pool.cjs:423-425. For an authenticated secondary account with no capability record and a request omitting effort and connector, none of lines 402-406 rejects the candidate, so line 407 admits it. accountSnapshot() simultaneously reports checked: false because it derives that flag from this.capabilities.has(account.id) at lines 91-97.

This is a directly reachable mismatch between the balanced scheduler and its account evidence state. The narrow fix is to require current capability evidence for secondary accounts in automatic balanced routing, while preserving the explicit manual mode and selected-primary compatibility policy. Connector evidence remains separately required when a connector is requested.

### Review3 claim 1 — additional defects outside the adjudicated roots

**Verdict: rejected.**

After tracing the pool’s direct IPC callers, control-server admission path, account registry, renderer account settings flow, and the reached browser-host readiness/login/inspection guards, no additional defect met the requested standard of direct source evidence and an actionable gap. Gateway envelope concerns, hypothetical hardening, impossible UI states already rejected by backend guards, and unavoidable non-atomic races without a concrete missing check were excluded. Public connector ABI and names remain unchanged.

## Merged actionable roots

1. **L06-check-invalidation — stale capability evidence survives the start of checkAccount()**
   - Severity: P1
   - Files: launcher/electron/account-pool.cjs
   - Trigger: a prior capability record exists; checkAccount() is invoked while host.ready() is pending or fails.
   - Fix: invalidate capability and connector evidence, advance the epoch, and capture it before the first await; publish only when the epoch remains current.

2. **L06-admission-currentness — fresh turn acquisition uses a pre-await account decision**
   - Severity: P1
   - Files: launcher/electron/account-pool.cjs, launcher/electron/control-server.cjs
   - Trigger: /v1/turn/start chooses an account, then enablement or capability/connector evidence changes while host.ready() is pending.
   - Fix: revalidate account existence, enabled state, evidence identity, and fresh-turn eligibility immediately before host.beginTurn(); reject and release a stale reservation while preserving exact retained/running continuation ownership.

3. **L06-login-selection — login start is not owned by the selection revision**
   - Severity: P2
   - Files: launcher/electron/account-pool.cjs, launcher/src/AccountSettings.tsx, launcher/electron/browser-host.cjs
   - Trigger: account A is selected, openAccountLogin(A) crosses an async readiness boundary, and account B is selected before A’s login operation marker is installed.
   - Fix: make selection and login one pool-owned operation, or retain and verify the selection revision and selected account immediately before starting login.

4. **L06-balanced-evidence — balanced routing admits unchecked authenticated secondary accounts**
   - Severity: P1
   - Files: launcher/electron/account-pool.cjs, launcher/electron/control-server.cjs
   - Trigger: balanced mode receives a turn without explicit effort or connector requirements while an authenticated secondary account has no current capability record.
   - Fix: require current capability evidence for secondary automatic balanced candidates before admission; retain separate connector proof checks when requested.

## Review result

- Numbered claims adjudicated: 7
- Accepted: 5
- Rejected: 2
- Design-limit: 0
- Merged actionable roots: 4
- Additional review3 defects: 0

No source code or public connector ABI was changed.
