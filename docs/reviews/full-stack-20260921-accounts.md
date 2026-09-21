# Accounts/backend review — 2026-09-21

## Boundaries

Manual source review covered the current `d6f8733` account implementation and the shared working-tree edits in:

- `launcher/electron/account-{registry,network,safety,pool,quotas}.cjs`
- `launcher/electron/codex-account-tools.cjs`
- `launcher/electron/codex-login.cjs`
- `launcher/electron/usage-store.cjs`
- `launcher/electron/atomic-file.cjs`

Direct boundaries were read where needed in `launcher/electron/main.cjs`, `browser-host.cjs`, and `inspection-control.cjs`, plus the current focused account/quota/usage tests and PR14 settlement notes. Account files, credentials, histories, production state, and live sessions were not read. No app, network request, test, build, typecheck, syntax command, or verification script was run. No Git branch, commit, or push operation was performed.

The PR14 contracts remain intact: quota results are bound to the exact Electron Session, evidence epoch, and principal lease; stale reads are cleared before publication; terminal device login retains its account-operation lease through bounded session reconciliation; cancellation/commit races preserve uncertain outcomes rather than claiming rollback.

## Implemented findings

### 1. Quota refresh did not own the account mutation boundary

**Trigger:** `refreshQuota()` performs two account-bound requests: it first obtains the current session token and then sends that token to the usage endpoint. Without a shared lease, a direct IPC caller could replace the account proxy or begin login/logout after token extraction but before the usage request completed.

**Impact:** the final evidence/principal checks prevented stale quota data from being displayed, but they ran after the network operation. They could not prevent a bearer request from continuing across a locally initiated proxy or credential-session transition. Ordinary turns and read-only session inspection do not mutate that boundary and do not need exclusion.

**Fix:** `host.ready()` now completes before lease acquisition, so browser initialization never sits behind a new non-cancellable quota operation. The quota request then acquires a dedicated cancellable account-read lease. That lease is intentionally absent from `accountOperationLabel()`, so active and newly admitted turns, account selection, pacing controls, and unrelated accounts continue normally. Session-mutating operations that call `acquireAccountOperation()`—proxy replacement, login/import, logout, and official Codex sign-in—reject while the exact account has a quota read. Existing evidence-epoch and principal checks remain the publication gate for external identity changes that no local lease can prevent.

`BrowserHost.withReadOnlyInspection()` was not reused for quota reads because that helper deliberately rejects an active turn and owns browser navigation/helper state. Quota refresh uses account-bound `Session.fetch()` and does not navigate the ChatGPT surface. Reusing that helper would preserve the original UX regression without adding a relevant safety boundary.

The existing quit preflight calls `cancelReadOnlyInspections()` before mutation/active-work vetoes. The pool now uses that phase to cancel account-read leases and await their exact release, with a 10-second settlement bound. `AccountQuotaReader.clear()` aborts the fetch, and account-tools destruction also clears and awaits tracked quota reads. A refresh still waiting for `host.ready()` owns no lease; after quit pauses inspections it cannot acquire one.

Quota reads remain tracked internally for cancellation and destruction, but they are intentionally absent from `codex-account-tools.currentOperation()`. Update/install prechecks consult lifecycle participants before the quit-time cancellable-read phase; reporting a quota read there would incorrectly veto an update that can cancel and settle the read. Official Codex sign-in and its reconciliation remain the only account-tools mutation reported by `currentOperation()`.

**Focused regression cases:** `tests/full-review-accounts.test.ts` proves that readiness is awaited before the read lease, release occurs after both resolve and reject, an active turn does not prevent read-lease acquisition, the read lease remains invisible to turn-routing and service mutation-operation reporting, a proxy-style mutation is rejected, and quit cancellation settles the lease. The fixtures contain no live fetch and were not run in this lane.

### 2. Saved account settings were atomic but not crash-durable

**Trigger:** registry selection/enabled state, proxy policy, pacing state, and conversation affinity used temp-file rename without syncing the temp file or containing directory. A successful call could therefore be reported before those bytes and the rename were stable across an OS or power failure.

**Impact:** after restart, the launcher could recover an older selected account, proxy, pacing policy, or conversation owner even though the prior mutation had returned success. This is especially material for proxy and affinity ownership because silently falling back changes which session or route a later request uses.

**Fix:** `writePrivateFileAtomic()` now has an opt-in `durable` mode that syncs the completed temp file before rename and the containing directory after rename on POSIX. Directory syncing remains unavailable on Windows. The account registry, account network, account safety, and affinity stores opt in; high-frequency ephemeral descriptors and unrelated callers retain the previous atomic-only behavior. Existing private file/directory modes and Windows rename retries are preserved.

The writer now returns an explicit frozen commit receipt:

- `{ committed: true, durability: "not-requested" }` for atomic-only callers;
- `{ committed: true, durability: "confirmed" }` after file and directory sync on POSIX;
- `{ committed: true, durability: "file-synced" }` on Windows, where this helper does not claim directory-entry sync;
- `{ committed: true, durability: "uncertain", warningCode: "NEKODEX_ATOMIC_DURABILITY_UNCERTAIN" }` if POSIX directory sync fails after rename.

Write, temporary-file sync, and rename failures occur before commit and still throw. A directory-sync failure occurs after the destination has already changed, so it no longer throws into callers that would retain old memory or roll back a newly applied proxy. Those callers advance their in-memory state to match the committed file. The uncertain receipt emits one process-wide sanitized warning without paths, content, account identity, or the raw filesystem error. It says that the saved value is active while sudden power loss may still revert it; repeated failures do not flood logs.

`AccountNetwork.save()` returns the receipt after advancing memory. The focused fault-injected case applies a new live proxy, forces directory sync to fail after rename, and confirms that the live Electron proxy, in-memory store, on-disk JSON, and a restarted store all retain the new proxy without applying the previous route as rollback. The test captures the sanitized warning code and was not run in this lane.

### 3. Usage recovery bypassed the existing Windows rename retry

**Trigger:** when the primary usage file was corrupt but its backup was valid, recovery quarantined the corrupt primary with raw `fs.renameSync()`. This was the only rename in that recovery path that bypassed the helper's bounded retry for transient Windows `EBUSY`, `EPERM`, and `EACCES` failures.

**Impact:** a transient scanner/indexer lock could make otherwise valid backup recovery fail, leaving usage unavailable until restart even though both the backup and retry mechanism existed.

**Fix:** corrupt-primary quarantine now uses `renameAtomicFile()`. The recovery order is unchanged: preserve legacy evidence if present, quarantine the corrupt primary, restore the validated backup durably, and retain the backup if any step fails.

## Rejected or unchanged candidates

- The current quota reader already rejects redirects, bounds response/token sizes, omits cookies from the bearer-token usage request, validates the token's account claim, aborts superseded reads, and returns `stale_read` instead of old buckets. No second quota parsing or cache change was justified.
- Device login keeps credentials inside the official Codex process and shared Codex home. It discards token material, drains private stderr without logging it, validates official response shapes, gates device-code disclosure on the captured account identity, and treats cancellation races as uncertain. No credential-file manipulation or controller rewrite was justified.
- Proxy validation rejects embedded credentials/fragments, limits fixed proxies to host/port, requires HTTPS PAC URLs, and bypasses loopback addresses. The new account-read lease serializes quota token use with proxy replacement without blocking ordinary turns; no additional proxy rewrite was justified.
- Usage storage already syncs primary and backup files, preserves unsupported future schemas, bounds history size, validates aggregate/lifetime relationships, and keeps corrupt evidence. A format migration was not justified.

## Parent integration and focused checks

No shared type, renderer, localization, preload, or `main.cjs` delta is required. The frontend may keep its existing per-account refresh state. Quota refresh remains available during running work; only session/proxy mutation of that exact account fails closed while its read lease is active.

Recommended parent-owned targeted checks after integration:

1. Run `tests/full-review-accounts.test.ts` for readiness ordering, concurrent-turn compatibility, mutation exclusion, release, quit cancellation, update-veto visibility, and the fault-injected committed-but-durability-uncertain proxy write.
2. Reuse the existing PR14 account settlement checks to confirm terminal sign-in still holds and releases its lease.
3. Run the existing atomic-file retry and usage-lifetime recovery cases alongside the new injected post-rename directory-sync failure case.

Remaining evidence limits are deliberate: no real provider quota/login response, live proxy transition, Windows file-lock event, sudden-power-loss recovery, packaged app, or rendered UI was observed in this lane. The parent owns integrated targeted execution and UI review.
