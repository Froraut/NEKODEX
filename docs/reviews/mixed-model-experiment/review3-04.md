# NEKODEX adjudication review 3-04

- Lane: 4 (diagnostics)
- Repository: `/Users/alex/Dev/nekodex`
- Baseline: `9925453`
- Review mode: manual source adjudication only
- Scope: `src/doctor.ts`, `src/cli.ts`, `src/route-diagnostics.ts`, and direct probe callers needed to verify the claims
- No source edits, tests, typechecks, automated audits, runtime actions, commits, or delegation were performed.

## Adjudication

### review1 claim 1 — accepted

**Root: `L04-codex-probe` (P1).** `runDoctor()` calls `inspectCodexIntegration()` at `src/doctor.ts:155` without a per-probe guard. `inspectCodexIntegration()` calls `readJournal({ reconcileInactiveHook: false, repair: false })` and can throw when both journal copies are unreadable or invalid; its later consistency checks only catch errors after a journal has been selected. The exception therefore escapes before the service, proxy, and full-mode tunnel checks at `src/doctor.ts:164-235`. `doctorCommand()` at `src/cli.ts:318-324` receives no report, and the top-level handler at `src/cli.ts:597-600` emits only generic stderr text.

This is a report-total diagnostics defect. The neighboring browser-host, service, proxy, tunnel-service, and tunnel-runtime probes already classify their failures and continue. `readCodexRouteDiagnostics()` also catches its journal inspection failure and records `integration-unreadable`, which is direct evidence that this failure class is representable. The fix is to isolate this one call, append a bounded `codex` error check, and continue the existing checks.

### review2 claim 1 — accepted, duplicate of `L04-codex-probe`

The claim identifies the same call site, trigger, consequence, and smallest fix as review1 claim 1. Its counterevidence is correct: the process-level catch is not a structured doctor result, and the other doctor probes are individually guarded. It adds no separate root.

### review1 claim 2 — accepted into `L04-profile-probe`

`diagnoseCodexConfiguration()` parses the selected profile at `src/route-diagnostics.ts:65-73`. The unconditional catch at line 68 discards the TOML parse error, after which malformed profile text and an absent/invalid selected profile both become `profile-unavailable`. The source has a stable `config-invalid` code for the root TOML parse failure, so the absence of an analogous profile failure classification is an actual diagnostic attribution gap rather than a requirement to expose raw TOML.

The report should retain the valid root configuration result and identify the selected profile parse failure with a bounded, stable issue code. The public route diagnostics shape can remain compatible; this is an internal diagnostic classification fix.

### review1 claim 3 — accepted into `L04-profile-probe`

`readCodexRouteDiagnostics()` reads the root config and selected profile in one `try` block at `src/route-diagnostics.ts:124-131`. If the root is valid but the selected profile read fails, the catch at lines 132-138 calls `diagnoseCodexConfiguration(null, ...)`, resets the provider fields, and reports `config-unreadable`. That misattributes the failure to `config.toml` and loses valid root evidence. `readBoundedUtf8File()` explicitly throws for a non-regular file, invalid UTF-8, or an oversized file, so this is reachable for more than a theoretical filesystem race.

The smallest coherent fix is to guard root and profile reads separately, preserve root text/status when it was read successfully, and report a distinct selected-profile read issue. This claim and review1 claim 2 share one actionable root because both arise from treating the selected profile as an indistinguishable extension of the root probe; the parse and read failure classes should still receive distinct issue codes.

### review1 unnumbered design limitation — design-limit

The early return after an invalid main configuration at `src/doctor.ts:107-113` is a design limitation, not an accepted report-total defect. The remaining probes require validated config for paths, mode, browser host, and tunnel settings. Continuing would require inventing probe inputs and could produce misleading checks. This is different from the Codex integration probe, which is an independent configured inspection with existing structured error semantics.

## Additional directly evidenced defect

### review3 claim 1 — accepted

**Root: `L04-login-probe` (P1).** In managed-chrome mode, the login probe at `src/doctor.ts:144-151` calls `browserLoginStateExists()` and then calls `secureFile()` twice without a surrounding `try/catch`. `browserLoginStateExists()` itself catches only marker JSON read/parse failures (`src/browser-login.ts:530-540`); `secureFile()` calls `statSync()` (`src/doctor.ts:36-39`) and can throw when the state file or verification marker is removed, becomes inaccessible, or is otherwise not stat-able between the existence check and the permission check. The exception escapes `runDoctor()` and prevents all later diagnostics from being reported.

This is the same report-total failure class as the accepted Codex probe root, but it is a different direct probe and has a different smallest fix, so it remains a separate root: guard the complete login check and append a structured login error on probe failure. It is directly evidenced by the uncaught `statSync()` path; no runtime race or hypothetical UI state is needed to establish the missing error boundary.

## Rejected or non-actionable candidates

- No gateway/freeform envelope claim was accepted in this lane. The gateway explicitly uses a freeform JSON envelope, so a contract requiring a different structured outer ABI would be invented and would violate the unchanged public connector boundary.
- No service timeout or nonzero-status claim was added. `getTunnelServiceStatus()` supplies a bounded `launchctl` timeout and documents ordinary nonzero output as unloaded; the doctor catches probe exceptions. Any stronger claim would require a changed semantic contract or runtime evidence outside this review.
- No non-atomic race claim was added. A race without a concrete actionable gap in these diagnostic readers is an acknowledged boundary, not a defect for this lane.

## Counts

- Numbered claims adjudicated: 5
- Accepted claim decisions: 5 (one duplicate, four unique actionable claims)
- Rejected claim decisions: 0
- Design-limit decisions: 1 unnumbered review1 candidate
- Unique accepted roots: 3
- Essential fixes: isolate `inspectCodexIntegration()`, separate root/profile diagnostic reads and classifications, and guard the complete managed-chrome login probe.
