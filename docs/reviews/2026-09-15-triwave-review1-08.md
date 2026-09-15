# NEKODEX triwave review 1, lane 8 — helper verifier

Baseline: `3740505b0107af9a83053fd523ae1ad30be36465` (`HEAD`). Read-only manual source review of `launcher/electron/browser-helper-verifier.cjs`, the helper protocol implementation in `src/adapters/chatgpt-web/browser-helper-main.ts`, and direct browser-host/main callers. Compared against `docs/reviews/2026-09-15-four-wave-results.md` and `docs/reviews/2026-09-15-four-wave-adjudication.md`, including D16 and the prior helper-verifier review. No tests, typechecks, scripts, broad audits, runtime/account actions, production actions, code edits, or commits were performed. Native4, Native4 DEV, Zero Risk4 names and ABI pins were not changed.

## Findings

**0 new concrete bugs.** No `T1-8-n` finding IDs are issued.

The current implementation at `launcher/electron/browser-helper-verifier.cjs:43-66` keeps the exact spawned `ChildProcess` reachable after the bounded graceful shutdown, SIGTERM, and SIGKILL waits; it removes that handle only after an observed `exit` or `close`. `:167-192` retains the primary operation error and attaches a secondary cleanup error instead of replacing the operation failure. This is the implementation of adjudicated D16, not a new defect.

The protocol path is correlated by the generated operation ID at `launcher/electron/browser-helper-verifier.cjs:81,139-155`; readiness is accepted once, and input/output stream errors are converted into the operation result at `:106-117`. The helper emits the maintenance result/error with the same request ID in `src/adapters/chatgpt-web/browser-helper-main.ts:348-360,379-399`. `verifyConnectorWithBrowserHelper` then requires the returned text to equal the requested name at `launcher/electron/browser-helper-verifier.cjs:195-211`, while `runBrowserHelperOperation` applies the current-runtime connector-name guard for `verify` at `:78-80`.

Direct callers retain their result validation: `launcher/electron/browser-host.cjs:3071-3094` rejects incomplete or incorrect smoke evidence; `:3102-3125` validates and reports connector verification; and `:3136-3165` validates authenticated temporary-session and capability evidence for inspection. The launcher caller marks connector verification complete only after that awaited exact-name verification succeeds at `launcher/electron/main.cjs:682-706`.

## Repeats, known limits, and optional improvements

- **Repeat of D16 / prior helper lifecycle finding, not a new ID:** A helper that ignores shutdown and remains alive through the bounded termination windows still produces a cleanup failure after 9 seconds. The current code preserves the exact child handle and the primary operation error, as required by the adjudication. No new ownership or termination defect is established from source inspection.
- **Known live-proof boundary:** This review does not prove that a real helper child exits within those windows, that Chromium/CDP teardown completes promptly, or that a real ChatGPT account returns the expected connector/session evidence. The prior four-wave record explicitly leaves those runtime/account boundaries unverified.
- **Optional observability improvement, not counted:** When cleanup fails after a primary error, `browser-helper-verifier.cjs:176-180` stores `primaryError.cleanupError`, but `browser-host.cjs:3117-3123` logs only the primary error fields and `main.cjs:702-714` returns only the primary message. Exposing a bounded cleanup detail in diagnostics could aid support, but it is not a functional helper-verifier bug and does not justify a new finding ID or any Native4/Zero Risk4 change.
- **ABI/identity boundary:** No helper-verifier path reviewed here requires changing the canonical `Codex Native4`, `Codex Native4 DEV`, or `Codex Zero Risk4` connector identity, public tool schema, or ABI pins.

Counts: **0 new findings; 1 repeated D16 path; 1 known live-proof boundary; 1 optional improvement; 0 code changes.** Finding IDs: **none**.
