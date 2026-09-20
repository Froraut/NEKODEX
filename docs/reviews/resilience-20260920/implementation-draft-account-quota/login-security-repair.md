# Draft account quota/login security repair

Implemented in the unshipped account quota/login controllers only. This worker did not edit parent integration, renderer, BrowserPool, tests, build files, branding inventory, dependencies, or installed application state.

## Files

- `launcher/electron/account-quotas.cjs`
- `launcher/electron/codex-login.cjs`
- this completion note

## Quota controller contract

`AccountQuotaReader.clear(accountId)` now deletes the owned cache state and aborts its in-flight fetch. Starting a read for the same local account with a different Electron Session or evidence epoch also aborts the superseded request. Before an in-flight result can update or return account data, `read()` requires that the account map still points to the exact state and that the state still has the requested session and epoch. A late completion returns the existing unavailable DTO shape with `reason: "stale_read"`; it cannot return the prior plan or bucket data.

The existing reported-quota DTO is preserved, including `accountBucket`, `additionalBuckets`, and `additionalBucketsTruncated`. The parent must still capture the BrowserPool evidence epoch before calling `read()` and compare it again immediately before publishing the result. The controller check closes its own clear/supersession race; it does not replace that final BrowserPool ownership check.

## Official Codex login controller contract

The controller continues to use the official `account/login/start` device-code flow against the configured shared Codex home. It does not inspect, copy, stage, promote, restore, or delete `auth.json`, tokens, cookies, or any other credential artifact.

Preferred construction:

```js
createCodexLoginController({
  codexHome,
  codexPath,
  isAccountCurrent(accountId) { /* compare the captured BrowserPool evidence/principal lease */ },
  logger,
})
```

`getSelectedAccountId` remains only as a compatibility fallback for the currently unshipped draft. Parent integration must use `isAccountCurrent`; selecting an unrelated Web account must not invalidate a legitimate device flow. Before `start({ accountId, confirmed: true })`, the parent establishes the lease for the explicitly clicked registered account. The callback must keep returning `true` only while that account’s captured evidence epoch and principal remain current.

`selectionLock()` returns `null` or `{ flowId, accountId, phase }`. While present, parent integration must block credential replacement, proxy changes, logout, account removal, or another login that targets that same account. It may allow ordinary UI selection of another account. If the bound account’s evidence/principal lease changes despite the lock, call `await reconcileOwnership()`; `status()` also detects loss and starts cancellation. Device-code disclosure is gated by `ownershipCurrent`, so `canOpen`, `verificationUrl`, and `userCode` are hidden after lease loss.

The flow object is assigned before process startup so destruction or lease loss can cancel it synchronously. Every awaited startup boundary rechecks that the same flow is still in `starting` before sending the next RPC, accepting a login response, or entering `waiting`. If cancellation made the flow terminal while `initialize` or `account/login/start` was pending, `start()` returns that terminal snapshot and cannot resurrect the flow.

Cancellation uses the official RPC exactly as follows:

```text
method: account/login/cancel
params: { loginId }
response: { status: "canceled" | "notFound" }
```

`canceled` produces terminal `phase: "cancelled"`, `authOutcome: "cancelled"`, and `cancelStatus: "canceled"`. `notFound`, an invalid/missing cancellation response, or an RPC failure does not claim that old credentials were preserved. It initiates official identity reconciliation and ends as `phase: "needs-confirmation"`, `authOutcome: "uncertain"` unless a success notification proves commit.

A successful `account/login/completed` notification is treated as committed even if it races cancellation. The controller then reads the official current identity with:

```text
method: account/read
params: { refreshToken: false }
```

The validated private UI projection is only `{ type: "chatgpt", email, planType }`; workspace routing and all credential material are discarded. A protocol-valid `account: null` is retained as no confirmed identity. After any cancellation attempt, that result produces `phase: "needs-confirmation", authOutcome: "uncertain"`; it never turns a missing account into a committed login claim. The email is returned in `actualAccount` for a private identity-confirmation UI and is never logged by this controller. Normal success with a confirmed ChatGPT account becomes `phase: "completed", authOutcome: "committed"`. A success/cancel race, lease loss, `notFound`, null/wrong account, or inability to validate the account becomes `phase: "needs-confirmation"` with an honest committed/uncertain outcome. The requested local `accountId` and observed `actualAccount` remain separate; the controller never automatically attributes or binds the official identity to that local account.

Public snapshots include:

- `ownershipCurrent`, `selectionLock`, `canOpen`, and `canCancel`
- `authOutcome`, `cancelStatus`, and `phase`
- `actualAccount` and `requiresOpenaiAuth`
- `requiresIdentityConfirmation`
- `desktopAccountChange: "not_performed"`

The UI must require the user to confirm the actual official account shown after device completion. It must not say that Codex Desktop changed, that cancellation restored previous credentials, or that an uncertain outcome left the old account untouched. Official login owns credential commit; this controller reports what the official completion, cancellation, and account-read APIs establish.

## Manual review and limits

I manually reviewed both changed controllers, the accepted lane-13 report, the Daybreak counter-review, and the locally generated first-party schemas for `CancelLoginAccountResponse`, `GetAccountParams`, and `GetAccountResponse`. No automated syntax check, unit test, build, live app-server request, real account switch, credential read, auth-file operation, renderer check, or network operation was run. Parent ownership includes all focused controller checks and the complete UI/integration verification.
