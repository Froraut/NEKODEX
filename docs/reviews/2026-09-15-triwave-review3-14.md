# Triwave review 3, lane 14 — CLI status

Current source: 3740505b0107af9a83053fd523ae1ad30be36465 (HEAD). Scope: CLI status paths and direct status helpers. This was a read-only manual source review after wave 1 and wave 2. No tests, typechecks, scripts, runtime probes, production actions, code edits, commit, or ABI/connector changes.

## New concrete finding

### T3-14-1 — Read-only CLI status can repair Codex integration files

Trigger: The Codex integration has a recoverable journal state: for example, only one journal copy exists, the primary and recovery copies differ in a state that readJournal can reconcile, or a v11 recovery journal represents a pending JSON hook write whose recorded configuration and external hook state still match the recovery rules.

Exact source and direct callers: src/cli.ts:335-344 implements route status by calling inspectCodexIntegration(). The same inspection is called by runDoctor() at src/doctor.ts:151, so it also affects top-level doctor and status through src/cli.ts:318-324,527. inspectCodexIntegration() calls readJournal({ reconcileInactiveHook: false }) at src/codex-integration.ts:762. Despite the status caller being observational, readJournal() writes during reconciliation: it can call writeFilesWithCompensation() for divergent v2 copies at src/codex-integration-journal.ts:321-333, call recoverPendingJsonHookWrite() at :339-346, copy a sole journal to the missing side with atomicWriteFile() at :347-356, or rewrite both journal copies at :359-374. The pending JSON path itself writes the hook file and journal at :256-280.

Consequence: A user asking for codex-chatgpt-web route status, doctor, or top-level status can change Codex integration journal files, and in the pending v11 path can change the interrupt-hook JSON, merely by reading diagnostic state. This crosses the CLI status boundary and can turn an inspection into an implicit recovery operation. A failed or interrupted repair can affect the files that the next diagnostic call observes, while the status command provides no indication that it performed a write.

Counterevidence and boundary: readJournalSnapshot() is explicitly observational and does not perform these repairs, but inspectCodexIntegration() does not use it. route diagnostics uses the snapshot path and is therefore outside this finding. The finding requires a journal state eligible for the existing recovery rules; an ordinary equal, healthy journal does not write. No live journal or hook was touched.

Disposition: Concrete new CLI status root. The correction should preserve Native4, Native4DEV, ZeroRisk4, and the existing journal/connector ABI while separating status inspection from recovery, or at minimum making any repair explicit and reported. No identity migration or schema change is implied.

## Cross-wave adjudication

- T1-14-1 upheld and repeated: In DEV status, a thrown tunnelStatus() after valid Full config still overwrites the captured configured state with configured false and leaves MCP marked not required. The ordinary nonzero/non-JSON tunnel response remains structured and does not trigger this path.
- T1-14-2 upheld and repeated: readDevChatExperimentalFeatures() remains outside the loadConfig() catch and can abort DEV status after the command has already captured a configuration error.
- T2-14-1 upheld and repeated: Exceptional getTunnelServiceStatus() or tunnelStatus() probes can abort production doctor, top-level status, or tunnel status before their reports are emitted. This is separate from T3-14-1 because T2 is lost diagnostic output on probe exceptions; T3 is an unintended filesystem mutation on a successful status path.
- Adjudicated repeat D19: Launcher-owned tunnel status still uses runtime health for its exit decision while also reading OS service state. The earlier launcher-owned false exit candidate remains corrected and receives no T3 ID.
- Rejected candidate: No new Native4/Native4DEV/ZeroRisk4 identity, MCP tool, public schema, or ABI defect is established. The connector names and mode-specific config guards remain consistent with the preserved boundary.
- Optional, not counted: route status does not set a failing exit code for inactive or inconsistent route state. The JSON exposes installed, active, and errors; the source does not establish a contract that this informational command must fail, so no new ID is assigned.
- Known limits: This report establishes conditional source paths only. It does not establish how often journal reconciliation is encountered, whether any local journal is currently repairable, the result of a live connector attachment, or production incidence. No final verification scenario was consumed by this lane.

Counts: 1 new concrete finding (T3-14-1); 3 prior findings repeated/upheld (T1-14-1, T1-14-2, T2-14-1); 1 corrected repeat (D19); 1 rejected candidate; 1 optional path excluded; 3 known evidence limits.
