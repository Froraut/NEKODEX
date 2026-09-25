# Durable retained-compaction diagnostics

## Scope and production boundary

`requestRetainedCompactionHandoff` creates a checkpoint after obtaining the one-shot in-memory broker transaction and **before calling `worker.run`**. `begin` commits an intent in SQLite using an immediate transaction and `synchronous=FULL`. If that write fails, no browser operation is invoked. SQLite owns transaction locking and rollback recovery; this implementation does not use application-managed JSON slots, pending files, or atomic renames.

This is a local diagnostic journal, not a resumable workflow, a durable broker, or an exactly-once delivery protocol. No startup scan performs work. An accepted summary is available for explicit local inspection but is never automatically fed back to the model. No record authorizes a retry. The pre-existing no-replay guard, one-shot broker capability, retained-conversation requirement, logical cancellation and physical-settlement ownership remain authoritative.

Only the retained structured handoff path is instrumented. Fresh-context fallback/multipart sends and active Manual-mode result delivery do not pass through this boundary. Extending those paths requires their owners to establish an appropriate boundary at the actual send operation without treating stored diagnostics as permission to resume.

## Schema and meaning

Version 1 stores:

- a random operation UUID, distinct from broker handoff IDs and control tokens;
- a SHA-256 binding of the available source owner key, native thread/turn IDs, retained conversation key, full parsed source context, raw request, model, and options;
- creation and expiry timestamps;
- one outcome: `intent`, `ambiguous`, `interrupted`, or `accepted`;
- the complete accepted summary, limited to 128 KiB of UTF-8 bytes, or NULL for other outcomes.

The binding input is hashed rather than stored as separate raw request, identity, or context fields. The digest provides exact serialized-input discrimination, not authentication, encryption, or semantic canonicalization. Missing source IDs remain missing. Digest equality is never recovery authority and may reveal equality or permit guesses of known inputs.

**Accepted summaries are persisted in plaintext locally.** They can contain sensitive material from the conversation; the store does not redact their contents. The storage limits and filesystem permissions below apply to these summaries as well as metadata. Broker capabilities, cookies, and error strings are not separately captured by the journal, but the summary itself is provider-authored text rather than a guaranteed secret-free representation.

`intent` means the operation crossed the database commit boundary, **not** that Send occurred. After a crash or SIGKILL it remains uncertain. `ambiguous` means the operation failed after intent creation, including cases where submission cannot be established. `interrupted` means cancellation/deadline was observed; it does not establish absence of remote effects. `accepted` means the broker delivered the handoff and the owned browser promise settled before the operation deadline. It does not prove that the caller durably published the summary. Interruption during browser settlement is recorded as interrupted instead.

Failure to persist acceptance preserves the successful live summary and its shared in-memory result, preventing a reconnect from replacing that success with a second operation. The warning contains only the checkpoint UUID and binding. Failure to persist a failure/cancellation outcome preserves the original error; the intent can remain uncertain. A summary exceeding the byte limit is not stored partially, and its persistence failure does not discard the live result. Cancellation before intent creation produces no checkpoint.

## Storage, bounds, permissions, and recovery

Default database: `getConfigDir()/compaction-checkpoints/checkpoints.sqlite`, respecting `CODEX_CHATGPT_WEB_HOME`.

- The directory is created recursively with mode `0700`. On POSIX, it must be owned by the current UID and have no group/other permissions. A final-component directory symlink or non-directory is rejected. Existing database entries must be regular files; database symlinks, including dangling symlinks on write, are rejected. Write opens set the database mode to `0600`. Read opens do not independently validate database ownership or mode.
- SQLite uses `journal_mode=DELETE`, `synchronous=FULL`, `auto_vacuum=FULL`, `secure_delete=ON`, a maximum of 12,288 database pages, and a five-second busy timeout. Database size in bytes depends on page size; temporary rollback-journal storage is additional. SQLite can recover a hot rollback journal on a subsequent write open. A read-only inspection may fail when recovery requires a write.
- At most 256 records are retained through the normal write API. A new intent first deletes expired records. At capacity, it removes the oldest records whose outcome is accepted, ambiguous, or interrupted. Unexpired intent records are protected. If insufficient replaceable records exist, the transaction fails before the browser operation. Capacity recycling can remove an accepted summary before its expiry; this is not an audit log or durable deduplication ledger.
- `finish` updates only an unexpired intent matching both UUID and full binding. It cannot overwrite finalized records or recreate an evicted/expired record. Repeated source bindings receive independent UUIDs and are not deduplicated by this journal.
- Logical expiry is 24 hours. Reads exclude expired records. Physical deletion occurs during later intent creation, with SQLite secure deletion and auto-vacuum configured. No background deletion service runs, so expiry alone is not physical erasure and does not erase backups or filesystem snapshots.
- Metadata reads filter unknown versions, malformed UUIDs/bindings, invalid timestamps/TTL, future creation times, and unknown outcomes. Summary reads also require the exact UUID/binding, accepted outcome, string content, and the UTF-8 byte limit. Missing storage creates nothing and returns no records. Unsafe storage and database errors can throw; they never grant replay permission.

The implementation assumes trusted configuration-home ancestry and a filesystem supported by SQLite. It does not defend against a malicious same-UID process swapping paths. POSIX modes do not certify Windows ACLs. SQLite synchronization is an OS/filesystem durability boundary, not a hardware power-loss guarantee; the code does not independently fsync newly created directory ancestry.

## Explicit inspection

`compaction-checkpoints list` returns metadata and `automaticResume: false`. `compaction-checkpoints show UUID --binding HASH` validates the exact identifiers, then returns metadata and an accepted summary when available. Output is JSON, which escapes terminal control characters in provider-authored text. These commands require no browser or configured service and offer no resume/replay action. There is no public HTTP recovery endpoint.

## Verification

The repository tests were removed at `f3cf75c`. The commands and results below document
verification against an earlier source revision; they are historical evidence, not current
runnable checks. Future verification follows the focused DEV/manual procedure.

`tests/compaction-checkpoint.test.ts` contains local worker/broker fixtures and actual SQLite/filesystem checks for intent ordering, accepted summaries, ambiguous/interrupted outcomes, pre-cancellation, failure before worker invocation, acceptance-write failure without reconnect replay, binding/finalization fencing, retention, concurrent writers, metadata/summary validation, unsafe paths, and SIGKILL recovery. `tests/compaction-checkpoint-cli.test.ts` covers read-only empty-store inspection, identifier validation, rejection of replay commands, and explicit accepted-summary inspection. These are local tests, not live-provider or installed-application evidence.

The bounded source review ran the following three existing cases: a real SQLite acceptance-update failure preserving one successful operation on reconnect; malformed persisted metadata and oversized-summary rejection; and unsafe directory/dangling database-symlink rejection. Result: **3 passed, 0 failed, 12 assertions**. Other listed tests were inspected as coverage, not claimed as executed by that review. Later retention and additional test changes require their owner's focused verification.

```sh
bun test tests/compaction-checkpoint.test.ts --test-name-pattern 'malformed metadata|unsafe directories|real SQLite acceptance'
```
