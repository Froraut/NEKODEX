# Compaction and delivery adaptation — verification

## Scope

Adapted durable retained-handoff checkpoints, existing submission evidence, and fault-injection testing. No automatic replay/resume, broker-token restoration, extra model acknowledgment round trips, or second outbox. Pre-existing working-tree changes are preserved. No release, installation or commit was performed.

## Implementation

- `browser-worker.ts`: cancellation checks before/after activation persistence and after acceptance; MCP progress baseline captured after activation persistence; existing generation excluded as new submission evidence.
- `index.ts`: structured retryable errors cannot reopen a turn whose send boundary has already been crossed.
- `compaction-checkpoint-store.ts` / `compaction-handoff.ts`: SQLite intent before retained structured handoff; bounded accepted summary after browser settlement; exact owner/source-context digest and operation UUID. Post-acceptance storage failure preserves live success and its shared-run cache. No restoration of execution authority.
- `cli.ts`: explicit read-only `compaction-checkpoints list` and `show ID --binding HASH`. List excludes summaries; show outputs escaped JSON and requires exact identifiers.
- Dedicated tests plus repaired existing recovery/provider-error fixtures. Design contracts in `docs/design/submission-evidence.md` and `docs/design/compaction-checkpoint-recovery.md`.

## Verified locally on macOS

- Root `bun run typecheck`: passed.
- `git diff --check`: passed.
- Eight targeted files: **47 passed, 0 failed, 359 assertions**. Includes real broker/socket isolation, duplicate/late delivery, cancellation, stale completion fencing, process SIGKILL, concurrent SQLite writers, disk-write rejection, shared-run reconnect with one send, retention capacity, and CLI summary privacy/binding checks.
- Five neighboring files: **74 passed, 5 failed**. The same five failing test names reproduce in a scratch control with HEAD versions of handoff/browser-worker/adapter files. The mixed control also has other fixture incompatibilities, so it is not a clean global baseline.
- Runtime bundle build succeeded (CLI and Node browser helper); built CLI version and empty read-only checkpoint list execute successfully.
- Standard release smoke did **not** pass in the mandated scratch environment. A diagnostic copy exposed the startup blocker: `Runtime command must not reference an ephemeral path`. The runtime path safety gate was not disabled and production smoke script was not modified. No installed-app or live-provider success is claimed.

Targeted files:

```
tests/compaction-checkpoint.test.ts
tests/compaction-checkpoint-cli.test.ts
tests/submission-evidence-faults.test.ts
tests/browser-submitted-provider-error.test.ts
tests/compaction-browser-recovery.test.ts
tests/routing-fault-invariants.test.ts
tests/browser-product-hardening.test.ts
tests/server-shutdown-compaction.test.ts
```

### Targeted resolution of the five neighboring failures

A later bounded review reproduced exactly those five cases, then resolved their current causes without running the neighboring files in full:

- **Completed compaction after native interruption — stale expectation.** The established E21 contract in `2026-09-15-coding-iterations.md` rejects cached summary publication after the exact native turn is interrupted. The corrected case verifies canonical reuse before interruption, rejection of both replay entry points afterward, and no replacement browser work.
- **Canonical rebuild after retained-browser loss — incomplete fixture.** The synthetic retained session lacked `releaseRetainedConversation`, which current ownership requires before fallback. Added the release acknowledgement and asserted it occurs before the fresh rebuild. The original canonical-task and successful-completion assertions remain.
- **Shared deadline after retained-browser loss — incomplete fixture and stale error code.** Added the same release acknowledgement. The scenario now exercises the intended hanging fresh rebuild and checks the existing structured `compaction_handoff_timeout`, non-retryability, bounded return, and two browser starts.
- **Exact native-turn interruption — source defect.** `cancelNativeTurn` called the runtime cancellation once directly and again through `retireSession`. Removed the redundant first pass: retirement already delivers cancellation synchronously. The existing test still requires one cancellation, exact thread/turn matching, removal after settlement, and preservation of the unrelated thread; an added assertion checks cancellation before hook acknowledgement.
- **Seventeenth owner rejection — stale capacity contract.** The session registry now includes tabless queue owners. Updated this case to admit owners through the configured browser capacity plus 64 waiting owners, reject the next owner, preserve exact in-flight reuse, and cancel all owned sessions on cleanup. Launcher tab admission remains a separate limit; this test does not claim to exercise physical tabs.

After the fixes, the selected five scenarios each passed: four in the scoped five-case run, followed by the isolated corrected deadline case. The extra synchronous-cancellation assertion received its own focused follow-up. No full neighboring suite, UI, provider request, build, or release smoke was run during this follow-up.

The earlier all-tests attempt had additional existing working-tree failures and timed out. The project-wide suite is not green.

## Limits

Checkpoint recording covers retained structured handoffs, not fresh fallback/multipart or active Manual-mode compaction. No automatic cross-restart summary reuse. Summaries are sensitive local plaintext (128 KiB maximum), stored in a private config directory with 24-hour logical expiry. At most 256 records: oldest settled records can be evicted; unresolved unexpired intents remain protected and a store filled with them blocks admission. Expired rows are physically reclaimed on later admission, not by a background erasure service. Windows ACL/durability behavior has not been exercised; no Windows or power-loss certification is claimed.
