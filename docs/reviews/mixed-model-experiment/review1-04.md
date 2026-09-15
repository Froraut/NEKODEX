# NEKODEX mixed-model experiment review 1-04

- Lane: 4 (diagnostics)
- Repository baseline: `9925453`
- UTC review start: `2026-09-15T20:30:43Z`
- UTC review end: `2026-09-15T20:31:55Z`
- Review mode: manual source review only

## Inspected scope

Primary files:

- `src/doctor.ts`
- `src/cli.ts`
- `src/route-diagnostics.ts`

Direct callers and implementations inspected only as needed to establish probe behavior:

- `inspectCodexIntegration()` and journal reads in `src/codex-integration.ts` and `src/codex-integration-journal.ts`
- `getServiceStatus()` in `src/service.ts`
- `getTunnelServiceStatus()` in `src/tunnel-service.ts`
- `tunnelStatus()` in `src/tunnel.ts`
- `browserLoginStateExists()` in `src/browser-login.ts`
- `runCommand()` in `src/process.ts`

No other wave reports were read. No source edits, tests, typechecks, scripts, live actions, commits, or delegation were performed.

## Findings

### 1. High — `runDoctor()` can abort without producing a report when the Codex integration probe fails

- Location: `src/doctor.ts:155`, `runDoctor()`; command entry at `src/cli.ts:320-323`.
- Trigger: Make the Codex integration journal unreadable or invalid so `readJournal({ reconcileInactiveHook: false, repair: false })` throws from `inspectCodexIntegration()` (for example, an invalid journal with no usable copy). Run `codex-chatgpt-web doctor --json`.
- Impact: `runDoctor()` never appends a `codex` check or returns `DoctorReport`; the exception reaches `main().catch()`, which emits only a generic stderr error. Independent checks after that probe, including service, proxy, tunnel, and connector checks, are skipped. This violates the report-total diagnostic contract and prevents callers requesting JSON from receiving a structured diagnostic result or consistent `report.ok` exit handling.
- Smallest fix: Wrap the `inspectCodexIntegration()` call in the same per-probe `try/catch` pattern used for service and tunnel probes. On failure, append one `codex` error check with a stable message and bounded `errorDetail(error)`, then continue to the remaining checks.
- Confidence: High. The called implementation explicitly rethrows when both journal copies fail to parse, while this call site has no catch.
- Classification: Bug, not a design limitation. The report can classify an unreadable integration as an error without requiring the integration result to continue.

### 2. Medium — A malformed selected profile is reported only as generic `profile-unavailable`

- Location: `src/route-diagnostics.ts:63-73`, `diagnoseCodexConfiguration()`.
- Trigger: Keep a valid root `config.toml`, invoke `codex-chatgpt-web route diagnostics --profile NAME`, and make `NAME.config.toml` exist with malformed TOML. The profile parse at line 68 throws and is swallowed; the result emits `profile-unavailable` with `provider: null`.
- Impact: The diagnostic cannot distinguish a missing profile from a malformed profile. Operators are directed toward the wrong class of remediation, and the individual probe failure is not represented by a stable malformed-state issue code. The output also hides otherwise valid root configuration because the selected profile path is treated as unavailable.
- Smallest fix: Track the profile parse failure separately and append a stable `profile-invalid` issue code (and retain the existing `profile-unavailable` result shape only for absent or invalidly named profiles). Preserve the root configuration status while marking the selected profile failure.
- Confidence: High. The catch is unconditional and deliberately discards the parse error; the two states produce identical output.
- Classification: Bug in failure classification. Treating a selected profile as an overlay is a valid design limitation; collapsing malformed input into “unavailable” is not.

### 3. Medium — A selected profile read failure is mislabeled as a root config read failure

- Location: `src/route-diagnostics.ts:124-140`, `readCodexRouteDiagnostics()`.
- Trigger: Use a readable valid root `config.toml`, request `route diagnostics --profile NAME`, and make `NAME.config.toml` exist but unreadable or non-regular (for example, replace it with a directory). The shared `try` block throws at line 130, then the catch calls `diagnoseCodexConfiguration(null, ...)` and marks `configStatus: "unreadable"` with `config-unreadable`.
- Impact: The report says the root configuration is unreadable and discards its parsed content even though only the selected profile probe failed. This can lead an operator to repair or replace the wrong file and prevents route diagnostics from reporting the valid root provider/override state.
- Smallest fix: Read the root config and selected profile in separate guarded probes. Keep `text` and root `configStatus` when only the profile read fails, and append a distinct `profile-unreadable` issue code while leaving the profile overlay unapplied.
- Confidence: High. Both reads currently share one catch, and the catch unconditionally resets the root input to `null` and emits `config-unreadable`.
- Classification: Bug in per-probe attribution, not a design limitation. The command may reasonably fail closed for an unreadable overlay, but it must identify which input failed.

## Design limitation / non-finding

An invalid or missing main configuration causes `runDoctor()` to return after the `config` check (`src/doctor.ts:113-117`). I did not count that as a report-total bug: the remaining checks depend on validated configuration for their paths, mode, browser host, and tunnel settings, so continuing would require inventing probe inputs. The independent-probe failure above is different because a configured diagnostic can continue after the Codex integration probe fails.
