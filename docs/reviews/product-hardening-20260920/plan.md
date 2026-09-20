# NEKODEX product hardening

User objective: review the whole codebase, fix current defects, substantially improve functions
and statistics, and produce a more capable application than the upstream comparison baseline.
Baseline: main `42aaca6`, released source `7bdf209`, version `5.4.0-nekodex.1`.
Work branch: `codex/nekodex-product-hardening`.

## Work and acceptance

1. Inventory production source and delivery code; assign nonoverlapping manual-review lanes.
   Record actual coverage and concrete failure paths, not a blanket zero-bugs claim.
2. Fix confirmed findings and their direct callers with one owner for each coupled lifecycle.
   Preserve account data, task affinity, permissions, connector isolation and updater trust.
3. Improve statistics with actionable, honest measurements: account attribution, result/failure
   breakdown, time measurements where observed, usable ranges and private aggregate export.
   Retain old history and explicitly distinguish unknown/unrecorded values from zero.
   Separate Web message statistics from Native proxied request statistics. Native telemetry must
   preserve stream bytes/backpressure, remain bounded and best-effort, and disclose reported versus
   unreported token coverage. Only the Electron collector writes the aggregate store; no request
   payloads, authorization headers, raw URLs or precise per-request records enter exports.
4. Improve the actual user workflows revealed by the survey; integrate existing updater progress
   edits after inspecting their behavior. Existing branding inventories remain unrelated.
5. Validate changed behavior through a small development observation and selected regression cases.
   Parent alone controls a shared maximum of ten expanded cases / 60 seconds of checks. No full
   test suite, mass corpus replay or repeated successful check. The user separately authorized the
   broad manual source survey in this task; it is not permission for broad automated verification.
6. Publish coherent source and a rebuilt application after development verification. Preserve
   current platform signing requirements; Windows has no publisher certificate and remains a
   labelled preview unless real signing credentials become available. Do not interrupt active work.

## Review ownership

- Daybreak browser lane: `src/adapters/chatgpt-web`.
- Daybreak core lane: remaining `src` modules.
- Daybreak Electron lane: `launcher/electron`.
- Daybreak interface lane: `launcher/src` including current updater progress edits.
- Parent: packaging/build/install scripts, workflow/architecture integration, upstream comparison,
  requirements, final ownership assignment, focused verification and delivery.

Subagent model requests use `gpt-daybreak-blue-latest` and were accepted by the dispatch tool.
No claim is made that all future defects can be eliminated or that superiority is universal.
Comparisons will name specific implemented capabilities and the inspected upstream revision.

Native5 is an explicit opt-in generation for owned asynchronous tool start/poll/ack/cancel.
Native4 and Zero Risk4 cached schemas remain intact. Cancellation after native dispatch cancels
observation only and must not promise reversal of external side effects. Pending operations are
owned across transport reconnects within the current broker process, not durable across its crash.
