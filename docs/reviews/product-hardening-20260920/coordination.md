# Active implementation ownership and integration seams

Verification is complete: ten selected behavioral cases passed within 33.708 seconds of total
automated checks, including failed attempts and compilation. See verification.md for scope and limits.
Do not rerun successful checks or the older September 19/20 release test sets.

- Browser Daybreak: `01a0bbd7-ec07-7773-ace9-7dd4d062360b`, adapter directory and
  `src/launcher-browser-host.ts`. Fix state-file lost updates/locking, stable affinity (preserve
  existing SHA256(account-thread:threadId) keys), revision retries, validated model provenance,
  Native5 process-owned async tools. Needs exactly-once start key, replayable result + explicit ack
  tombstone, queued cancel versus post-dispatch observation-only cancellation, sibling isolation.
- Core Daybreak: `01a0bbd7-ec5d-7e31-b0da-e5ad3b7e2bf2`, remaining src. Fix broker readiness,
  Doctor inactive route, exact-state authentication markers, continuation UTF-8/memory limits,
  unknown usage != zero; wire Native5 opt-in config/CLI/setup/Doctor. Add bounded byte-preserving
  native telemetry, best-effort only, no data-plane dependency on recording success.
- Electron Daybreak: `01a0bbd7-4a26-70e3-b1f7-5d51a3a61786`, launcher/electron. Own all account,
  shutdown/update, parent process identity, native gesture/public-link policy, usage v3 migration,
  Web/Native collector/IPC, and Native5 setup preference plumbing.
- UI Daybreak: `01a0bbd7-ecb9-70e0-9ad5-6eb99217eeb5`, launcher/src. Own richer statistics,
  aggregate CSV, stale/filter states, updater double-submit protection, modal/select/radio
  accessibility, active-runs quick access, Native5 opt-in and all six locale additions.
- Parent: scripts/workflows/installers/build staging; source integration, development checks and delivery.

Shared statistics query: `usage(number | {days:1|7|30|90, source:'web'|'native', accountId?:string|null})`.
Default source is Web. Accounts apply only to Web. Keep old lifetime/recovery fields. Added report:
`generatedAt,timeZone,period,selectedAccountId,accounts,metrics,durations,failures,calendar`.
Calendar includes zero days. Incomplete is a distinct Native outcome, not unrecorded or successful.
Completion denominator excludes unrecorded but includes known incomplete/cancelled results.
Per-request dates/receipts/IDs/labels never enter CSV. Native token coverage is reported/unreported;
optional cache/reasoning fields need their own coverage or remain unavailable, never guessed zeros.
Distinct trace/PID owners are observed browser runs, not exact logical Codex task counts.

Browser emitter fields: `modelVersionSource: observed|pinned|unknown`,
`messageKind: task|context_stage|compaction`; pinned requires live validation, not requested config.
Failure codes are bounded and normalized, never raw errors/URLs. Account identity comes from pool.

Native collector event is defined in `src/native-usage-telemetry.ts`; receiver is authenticated
`/v1/usage/native`. Sole persistent writer remains Electron UsageStore. No raw body/headers/URLs.
Forwarding must survive telemetry parsing/recording failure; oversized frames retain terminal status
when the SSE event header proves it but have unknown usage. Default queue cap is 16.

Native5 flag: `experimentalAsyncToolOperations`, CLI `--async-tool-operations` /
`--synchronous-tool-operations`. Separate Codex Native5 / Codex Native5 DEV connector. Native4 and
Zero Risk4 schemas stay unchanged. Operations are not crash-durable across broker restart.

Initial updater working diff was saved at `/tmp/nekodex-hardening-initial-updater.patch`.
It is now within the authorized improvement scope and should be preserved/integrated, not discarded.
Branding inventories and dependency symlinks remain unrelated. Live accounts/routes are untouched.
