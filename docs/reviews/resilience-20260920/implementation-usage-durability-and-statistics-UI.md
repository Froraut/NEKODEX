# Usage durability and Statistics UI implementation

## Implemented

### Durable bounded storage

- `UsageStore` now prepares one coherent serialized snapshot and prunes receipt-level detail before the 20 MB hard limit. Web receipts are capped at 50,000, native receipts retain the existing 10,000 cap, and a 16 MB high-water mark compacts oldest receipt details toward 14 MB.
- Compaction preserves daily rows, outcome counters, token aggregates, failure aggregates, and Web/native lifetime aggregates. Completed Web receipts are removed before active receipts; removing receipt detail can reduce deduplication, duration, failure-detail, and run-count coverage, but it does not rewrite aggregate totals.
- `accept`, `finish`, and `recordNative` retain their public synchronous contracts and now copy only the maps and rows they mutate instead of cloning the entire combined history.
- The primary snapshot remains an atomic fsynced write. The recovery backup is refreshed from the committed primary with `COPYFILE_FICLONE`, which is copy-on-write on supporting filesystems and safely falls back to a normal durable copy. Primary and backup remain independent files, so in-place primary corruption does not corrupt the backup. This removes the ordinary second JSON serialization and avoids a second full physical write on supporting filesystems without adding a journal or another persistent writer.

### Best-effort native telemetry

- Native usage delivery keeps the original event ID across three bounded retries (250 ms, 1 s, and 4 s) so ambiguous acknowledgements remain safe under existing receipt deduplication.
- The process-local queue remains bounded at 16. Missing descriptors, exhausted retries, and capacity eviction now emit metadata-only `native_usage_telemetry_dropped` warnings.
- Delivery remains best effort and process local. Process termination, sustained receiver outage, or capacity pressure can still lose events. No unknown event count is invented or persisted.

### Statistics presentation and export

- Period and lifetime tables now aggregate identical visible mode/model labels before rendering and use separate stable row identities. This removes the duplicate React keys produced when several accounts share `automatic · high · GPT-5.6`.
- CSV export now preserves account ID, mode, effort, model version/source, message kind, endpoint, model ID/source, and raw group counters instead of collapsing Web rows to model version alone. Native exports use `scope=native-recorded-only`; native unrecorded counts are blank rather than a misleading zero.
- Native mode no longer displays a disabled “All accounts” selector. It shows account attribution as unavailable and retains the existing browser-account/native-token boundary explanation.
- The Native unrecorded metric and table columns are hidden. A visible localized recorded-only note states that best-effort delivery can miss events and totals are not complete coverage.
- Empty reports use a compact empty-period state instead of a grid of zero cards and a blank chart. Renderer normalization clears contradictory duration values only when a synthetic or malformed zero-total snapshot still carries duration samples. This is defensive fixture/API-boundary handling, not evidence of a live backend defect.
- Table captions, headers, responsive Native metric layout, and account-boundary hierarchy were tightened within the existing NEKODEX visual system.

## Integration contracts

- No `types.ts` change is required. Existing `UsageSnapshot`, `UsageMetrics`, and token null-versus-zero semantics are preserved. A missing provider token value remains `null`/em dash/blank CSV; a reported zero remains numeric zero.
- Localization owner added `usageNativeRecordedOnly`: “Recorded requests only. Best-effort delivery can miss events, so these totals are not complete coverage.” This implementation consumes that key but does not own localization files.
- Native persistence remains synchronous, so no browser-owner/control-server callback change is required in this implementation. If persistence is later moved off-thread, `recordNativeUsage` must return a promise and the authenticated control route must await durable commit before returning HTTP 200; retries depend on that acknowledgement boundary.
- `UsageStore` remains the sole persistent usage writer. Native telemetry does not create a disk spool or WAL.

## Files owned and changed

- `launcher/electron/usage-store.cjs`
- `src/native-usage-telemetry.ts`
- `launcher/src/UsageDashboard.tsx`
- `launcher/src/usage-lifetime.css`
- `launcher/src/usage-statistics.ts` (new scoped presentation helper)
- `docs/reviews/resilience-20260920/implementation-usage-durability-and-statistics-UI.md`

The localization files containing `usageNativeRecordedOnly` were changed by the separate catalog owner and are intentionally not claimed by this lane.

## Verification boundary and remaining limits

Per worker scope, no automated test, typecheck, build, Electron launch, live account operation, network operation, or UI drive was run. Parent owns focused regression checks and full UI review.

The remaining material limits are explicit: telemetry remains bounded best effort; receipt compaction reduces detail/deduplication coverage before aggregate totals; the primary snapshot write is still synchronous; clone acceleration depends on filesystem support and otherwise falls back to a full durable backup copy; and the renderer cannot quantify events that never reached the sole persistent writer.
