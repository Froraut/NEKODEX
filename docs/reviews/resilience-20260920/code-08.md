# Code review lane 08: usage and history durability

Scope was limited to `launcher/electron/usage-store.cjs` and `src/native-usage-telemetry.ts`, with direct callers inspected only to confirm failure propagation. This was a bounded manual review: no source edits, automated checks, builds, CI, live-account work, network authentication, child agents, or UI driving were performed. The account-quota worker was not reviewed.

## Findings

### 1. P1 — Native lifetime/history silently undercounts whenever one delivery attempt fails

**Location:** `src/native-usage-telemetry.ts`, `deliver` lines 43–59, `drain` lines 62–78, and `enqueueNativeUsageTelemetry` lines 81–93. The resulting misleading coverage is exposed by `launcher/electron/usage-store.cjs`, `snapshotNative` lines 476–482 and 508–513.

**Observed:** A missing descriptor returns from `deliver` as if delivery succeeded (lines 44–45). A missing/unready receiver, unreadable descriptor, authentication mismatch, store rejection, or response taking more than one second throws, but `drain` catches the error and permanently discards that event (lines 67–73). The queue is process-local and evicts the oldest pending event at 16 entries (line 90); there is no retry, shutdown drain, durable spool, or persisted dropped-event counter. The receiver's UUID receipt deduplication only protects events that reach it. `snapshotNative` derives `total` and every outcome from recorded rows, so its `unrecorded` field is always zero for a valid aggregate even when producer events were lost before receipt.

**Failure trigger:** Any native response ending while the launcher descriptor/control receiver is briefly unavailable, slower than 1,000 ms, or the process is exiting loses that terminal event. A burst that leaves 17 pending events while delivery is blocked also evicts at least one event.

**Inferred impact:** The dashboard can present a coherent completion rate and lifetime total that are lower than actual native activity, without indicating partial coverage. This is especially likely during launcher restart/recovery—the period for which durable history is most useful.

**Proposed fix and ownership:** The native-telemetry owner should retain the same stable `eventId` in a bounded retry/outbox lifecycle, use backoff for retryable descriptor/transport/5xx failures, and drain on orderly shutdown without delaying responses. The usage-store owner should persist producer sequence/acknowledgement or explicit dropped-event counts so snapshots can report coverage as partial; UUID deduplication should continue to make ambiguous retries safe. Because this changes both delivery and lifetime semantics, the parent should assign it to one lifecycle owner rather than split the two files between writers.

### 2. P1 — The 20 MB serialized-state ceiling can halt recording before receipt limits perform compaction

**Location:** `launcher/electron/usage-store.cjs`, `persist` lines 350–357, `accept` lines 368–377, and `recordNative` lines 405–450. The Web direct caller converts a thrown write into a process-lifetime store error in `launcher/electron/account-pool.cjs`, `recordUsage` lines 132–135.

**Observed:** `persist` rejects any next snapshot larger than 20 MB before entering its write-error handler (line 352). Web receipts are only rejected at 100,000 entries and otherwise age out only when their daily row is older than 90 days (lines 369–371). Native receipts are capped at 10,000, but they share the same file with Web receipts, daily rows, lifetime groups, and native aggregates. There is no byte-budget compaction before serialization. On the Web path, the first over-limit `accept` is caught by `recordUsage`, which sets `this.usage.error`; later `accept`/`finish` calls return early and native recording reports unavailable until restart. On the native path, the oversized next state repeatedly fails and the control request returns an error; the producer then drops the event under finding 1.

**Failure trigger:** A sufficiently active 90-day window grows `local-usage.json` past 20 MB before the nominal 100,000 Web-receipt guard, or aggregate cardinality plus receipts consumes the remaining budget. Restart reloads the last under-limit snapshot but does not remove the pressure, so the next records can fail again.

**Inferred impact:** New outcomes and lifetime totals stop advancing while older detailed receipts consume the budget. The preserved on-disk snapshot is recoverable, but the product can remain in a restart loop of near-immediate recording failure and incomplete totals.

**Proposed fix and ownership:** The usage-store owner should compact against a byte budget before `persist`: preserve aggregate/lifetime counters, prune oldest receipt-level duration/dedup details to a bounded recent window, and persist explicit receipt/duration/dedup coverage counters. Reserve headroom below 20 MB and reject only if the compact aggregate itself cannot fit. Treat capacity separately from an I/O-corruption error so one expected compaction boundary does not disable all recording for the process. This belongs wholly to the usage-store owner; UI can consume the resulting coverage fields in the later UI wave.

### 3. P2 — Each terminal event synchronously clones and durably rewrites the full history twice on the Electron request path

**Location:** `launcher/electron/usage-store.cjs`, `writeDurable` lines 164–176, `persist` lines 350–357, and `recordNative` lines 405 and 450. The synchronous call is made directly from `launcher/electron/control-server.cjs`, `handle` lines 136–140.

**Observed:** `recordNative` performs `structuredClone(this.state)` for each event. `persist` then serializes the complete combined Web/native state, atomically writes and fsyncs the primary file, and normally repeats the full durable write for the backup. All filesystem operations are synchronous. The authenticated control-server handler does not enqueue this work elsewhere; it performs it before returning the telemetry acknowledgement.

**Failure trigger:** As retained history approaches its allowed size, every completed native response incurs full-state clone, serialization, two file writes, file fsyncs, and directory fsyncs. Concurrent terminal responses serialize behind Electron's main-thread work; any acknowledgement exceeding the producer's one-second timeout is treated as failed and discarded.

**Inferred impact:** History growth increases Electron UI/control latency and can create self-induced native telemetry loss even on a healthy local machine. A crash-safe design is present, but its write amplification works against the delivery timeout and the later full-UI resilience goal.

**Proposed fix and ownership:** The usage-store owner should move receipt commits to one serialized persistence worker and use a bounded append journal (or equivalent incremental durable record) with periodic atomic snapshot/backup compaction. The control route should acknowledge only after the small journal record is durable, while snapshot compaction happens outside request latency. Keep one writer and preserve the current primary/backup recovery contract. This is coupled to finding 2 and should be implemented by the same lifecycle owner, with the control-server owner limited to the acknowledgement boundary.

## Review boundary

The validation, migration reconstruction, retained-row versus lifetime invariants, UUID receipt deduplication, and primary/backup atomic-write ordering were manually inspected. I found no additional important actionable defect within this lane that was independent of the three coupled issues above.
