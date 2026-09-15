# NEKODEX backend review fixes — 2026-09-15

Source baseline: d391f7d8211e0e5e588597a0a943d104b1e14544. Follow-up to [the adjudicated review](2026-09-15-sol-backend-review.md).
Nine Sol implementation workers handled disjoint write scopes; parent integrated, manually reviewed changes and performed the focused checks. All workers are closed.

## Finding disposition

| Finding | Disposition |
| --- | --- |
| B01 helper readiness shutdown | Startup promise rejected before child detachment; idempotent close owns cleanup; deferred worker call captures its helper instead of reading a cleared field. |
| B02 account routing field | Both IPC sides carry and validate accountRoutingKey; ready advertises support and old helpers reject keyed turns explicitly. |
| B03 Web-to-native continuation | Native forwarding expands known local Web IDs, removes local previous_response_id and serializes complete scrubbed history. Unknown native IDs retain byte-for-byte passthrough. |
| B04 checkpoint loading | Temporary validated map and loaded flag publish only on successful load. Failed load can be retried without overwriting unread checkpoints. |
| B05 drain | HTTP, browser and detached-compaction counters must all be valid nonnegative integers and zero. |
| B06 Manual tunnel key | CLI loads interaction mode and uses the matching key path for writing and reporting. |
| B07 premature tab eviction | Host readiness precedes reclaiming a retained tab; reservation accounting remains active across the await. |
| B08 premature affinity | Tentative bindings exist in memory during acquisition; durable binding follows lease success or a failure with a surviving owned tab. Empty failed acquisition drops tentative binding. |
| B09 inline files | Unsupported file_data fails explicitly before browser routing, including fallback schema forms; filename/file_id references keep their existing semantics. |
| B10 interrupted uninstall | Managed routes durably deactivate before journal deletion. Legacy v2 has an uninstall intent with restored-config hash. Recovery-first deletion and conditional compensation preserve recoverability. |
| B11 final route commit failure | Active-v11 preflight evaluates replacement hook; final failure compensates config, main/tunnel services, profile and key when still owned by the attempt. Concurrent edits are preserved and compensation failures reported. |
| B12 failed login profile reuse | Attempt-specific private profiles; cleanup after browser closure on success/failure; a profile that cannot be safely closed is retained with an explicit cleanup error. |
| Windows tee risk | Replaced eager tee observer with zero-readable-high-water TransformStream and bounded writable strategy. Client demand controls consumption; pipe completion/cancellation controls lifecycle accounting. |
| Physical owner TTL | Physically unsettled sessions survive logical TTL pruning, preserving the ownership barrier. |
| Redacted-only reasoning | Parser retains bridge-owned opaque redacted metadata even without readable thinking. Web prompt projection still includes only readable summaries; opaque blocks are not invented plaintext or sent as ordinary prompt text. |
| Forced-partial quit | Best-effort Quit still exits, but records structured incomplete-cleanup evidence and preserves possible surviving ownership state. |
| MCP per-call cancellation | Deliberate whole-turn revocation retained and contract documented. No unsafe per-call isolation added without native invocation identity and late-result disposal. This is an explicit policy disposition, not a claim that sibling calls now survive cancellation. |
| Non-streaming accumulation | Total delivered event budget: 32 MiB UTF-8 serialized data / 100,000 events. Overflow fails the queue, aborts producer and discards collected partial events. |
| Completed activity retention | Live turn retires at 4,096 completed activity IDs; no tombstone is dropped while its token remains usable. |
| Admin request bounds | Both authenticated cancellation bodies use bounded JSON reader with 4 KiB encoded and decoded limits. |
| Diagnostic PID reuse | New markers record process-start identity on supported platforms; per-prune PID cache avoids repeated process probes. Deletion rechecks ownership. Unknown identity and legacy markers conservatively retain live-PID leases. |
| Emergency log retention | Current process-stream-error log and one rotated predecessor capped at 256 KiB each, including migration of oversized prior file. |
| Managed Chrome state | Existing allowlist filters storage before login persistence and subsequent worker persistence. |
| Capacity docs | Removed sixth-versus-sixteen contradiction and separated configured admission from sustainable measured capacity. |
| Dependabot | Monthly root/launcher Bun proposals, at most two open per directory, no automatic merge configured. |
| PR CI | Required verify job names retained. One Linux command runs mapped named cases with a 29-second timeout. Unmapped changes explicitly require manual review, without claiming runtime verification. Full three-platform verify/package/smoke requires affirmative workflow_dispatch input. |

## Verification and delivery

- Eight named regression tests passed: local Web-to-native history, Windows-shaped slow consumption, helper close before ready, checkpoint retry, inline-file/redacted parser behavior, account readiness failure/retry, interrupted disconnected-journal cleanup, and existing native verbatim forwarding.
- One helper test initially failed because its fixture descriptor lacked private permissions; fixed the fixture and reran only that case. Typecheck found one optional chunk typing issue and a missing fixture callback; corrected and repeated typecheck successfully.
- Automated test/typecheck commands together took approximately six seconds, below the shared 60-second budget. No full suites, mass review pipeline or live-account model requests were run.
- Vite development build passed. Isolated Electron source target opened the Overview at launcher/dist/index.html with DEV profile /tmp/nekodex-backend-review-dev. It was gracefully closed; no temporary development app remains.
- Fresh runtime bundle and macOS arm64 app built after focused development verification.
- Installed /Applications/NEKODEX.app successfully; PID 22471 at handoff. Installer required /healthz status=ok and accepting_turns=true before reporting success.
- Installed UI reopened with ChatGPT sign-in retained and runtime startup events at 17:29 local time.
- Prior bundle retained recoverably at /Users/alex/.Trash/NEKODEX-before-cat-motion-1789482568.app. Temporary runtime staging and this task's disposable DEV profile were removed.
- Local ad-hoc signed build, version 5.1.0-froraut.18. No notarization, public binary release, dependency upgrade or live Windows certification performed.

## Practical limits

The fixes remove the reviewed failure paths; they do not prove every live model/account/capacity combination. Windows flow was exercised through the win32 stream branch on macOS Bun, not a Windows OS. Full service/tunnel compensation, managed Chrome federated sign-in, legacy v2 crash recovery and rare PID-reuse failure paths received manual review rather than live fault injection. File compare/write compensation cannot atomically exclude a concurrent external edit between comparison and replacement. A permanently stuck physical helper remains owned until explicitly closed rather than being silently forgotten. Retained-tab eviction can still precede failure in the new tab's initialization after host readiness.

MCP cancellation remains whole-turn by design; opaque reasoning remains opaque; Dependabot and CI configuration in a feature branch are source changes, not proof that repository defaults or remote checks already executed.
