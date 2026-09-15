# Independent blind review wave2 lane4 diagnostics

- Repository: `/Users/alex/Dev/nekodex`
- Baseline: `9925453`
- UTC start: `2026-09-15T20:34:53Z`
- UTC end: `2026-09-15T20:36:51Z`
- Source state: unchanged; review-only inspection
- Inspected scope: `src/doctor.ts`, `src/cli.ts`, and `src/route-diagnostics.ts`
- Required regression-prevention skill: `/Users/alex/.codex/skills/nekodex-regression-prevention/SKILL.md` was not present, so it could not be read. The required `/Users/alex/.codex/skills/right-size-test-runs/SKILL.md` was read and applied.
- Verification: manual source review only. No tests, typechecks, scripts, runtime probes, edits outside this report, commits, or delegation.

## Finding 1 — `runDoctor()` can abort before producing a total report when the Codex probe throws

- **Trigger:** `inspectCodexIntegration()` throws an exception instead of returning its normal inspection object. This is the individual Codex integration probe at the direct call site.
- **Exact location:** `src/doctor.ts:155` (`const codex = inspectCodexIntegration();`). The caller is `src/cli.ts:321-323` (`doctorCommand()`), with the process-level fallback at `src/cli.ts:597-600`.
- **Consequence:** The exception escapes `runDoctor()` before the service, proxy, and full-mode tunnel checks at `src/doctor.ts:164-235` run. `doctorCommand()` therefore never receives a `DoctorReport`, cannot print the report or JSON form, and the top-level handler emits only `codex-chatgpt-web: ...` with exit code 1. A single probe failure prevents the promised aggregate diagnostics from reporting the remaining reachable checks.
- **Counterevidence:** The surrounding individual probes are deliberately isolated: launcher browser inspection is caught at `src/doctor.ts:116-137`, managed service status at `src/doctor.ts:164-184`, `proxyCheck()` catches its fetch/response failures at `src/doctor.ts:68-101`, and tunnel service/runtime probes are caught at `src/doctor.ts:201-226`. `readCodexRouteDiagnostics()` separately catches inspection failures at `src/route-diagnostics.ts:105-123` and records `integration-unreadable`, which shows that probe failure is expected to be representable rather than terminate diagnostics.
- **Smallest fix:** Wrap only the `inspectCodexIntegration()` call in a `try/catch`; on failure, append a `codex` error check with the exception detail and continue through the existing checks. Preserve the existing normal-path handling for `installed` and `errors`.
- **Confidence:** High.

## Review conclusion

One concrete reachable current defect was found. No additional defect was reported from the alternate, error, cancellation, or direct-caller paths in the three-file scope because the remaining candidates were either explicitly fail-closed behavior or lacked sufficient evidence without inspecting files outside the requested boundary.
