# NEKODEX mixed-model experiment review wave 3, lane 3

- Review: review3-03 (adjudication/integration)
- Baseline: 9925453bd51e61c7b398abec12ec0da3aca3d3af
- Source scope: src/codex-integration.ts, src/codex-integration-shared.ts, src/codex-integration-journal.ts, and direct callers needed for ownership/read behavior
- Verification: manual source review only; no source edits, tests, typechecks, scripts, automated audit, runtime, commits, or delegation

## Adjudication

### Review1 claim 1 — accepted

**Root: L03-write-ownership. Severity: P1.**

The claim is directly supported by the source. uninstallCodexIntegration snapshots the config and restored hooks at lines 691–692, then writes them at lines 708 and 711 through writeFileSnapshot. For ordinary files, writeFileSnapshot performs no expected-byte comparison; for symlinks it checks only link and resolved-target identity before the atomic write (src/codex-integration-shared.ts:337-350). An intervening same-path edit with the same symlink identity can therefore be overwritten. The rollback guard at lines 731–741 runs only after a later failure and cannot undo a successful overwrite that was already made.

Review2's recovery guards do not close this path: writeFilesWithCompensation compares bytes only when its caller supplies expectedData, while these uninstall writes bypass that helper. This is an actionable ownership gap, not the known compare/write filesystem race.

### Review1 claim 2 — accepted

**Root: L03-delete-ownership. Severity: P1.**

The claim is directly supported by the source. After taking catalogSnapshot and modelsCacheSnapshot at lines 693–694, uninstall removes the legacy catalog at line 715 and the models cache at line 718 without checking that the live bytes still match the snapshot. A file recreated or replaced after the snapshot can be deleted by this operation. The expected map protects only the later rollback decision; it is not a pre-delete ownership check.

The journal copies are handled differently: removeJournalCopy re-snapshots and compares bytes immediately before rmSync (lines 698–705), so review2's evidence is applicable to journal-copy deletion but not to catalog/cache deletion.

### Review1 claim 3 — accepted

**Merged into root: L03-write-ownership. Severity: P1.**

The claim is directly supported by the source and applies beyond uninstall. writeFilesWithCompensation snapshots all paths once before the write loop (lines 365–368), but it performs the current-byte check only for entries that provide expectedData (lines 372–379). Every writeIntegrationState call constructs managed recovery/config/hooks/primary writes without expectedData (lines 416–430), including install, reconnect, and disconnect callers in src/codex-integration.ts. An edit between the initial snapshot and a managed write can be overwritten, and compensation cannot reliably identify that overwrite as a pre-write conflict.

This is the same missing pre-write ownership contract as review1 claim 1, with a wider set of callers, so the claims are merged rather than reported as duplicate roots.

### Review2 conclusion — rejected

**No separate root.**

The conclusion of zero reachable defects is contradicted by the concrete mutation paths above. Review2 correctly describes several protections: JSON hook slot/hash validation, pending inactive-hook rules, journal recovery expectedData checks, and observational readJournalSnapshot. Those protections do not establish byte ownership for uninstall's config/hooks writes, uninstall's catalog/cache deletions, or writeIntegrationState's ordinary managed writes. The report therefore overgeneralizes guards from the journal recovery paths.

### Journal read/recovery and direct-caller assessment

- readJournalSnapshot is observational: it parses primary/recovery copies and reports recoveryPending without repairing them. route-diagnostics.ts uses this path, so no read-side mutation defect is established.
- Inspection callers such as readCodexSubagentProtocol and inspectCodexIntegration pass repair: false; mutation callers intentionally use the repairing/reconciliation path. The default repair behavior is a design hazard if misused, but no concrete current misuse was found in the inspected callers.
- readJournal fail-closed selection, pending inactive disconnect proof, and JSON hook ownership checks are supported by source. The remaining compare-then-mutate filesystem race is an explicit unavoidable boundary and is not counted as an additional defect because the requested scope provides no actionable atomic primitive gap.
- No additional real defects were found within the requested scope and direct callers.

## Essential fixes

1. Add an expected-byte ownership check to uninstall's config and restored-hooks writes, retaining the existing symlink identity check and refusing to overwrite an intervening edit.
2. Guard catalog and model-cache deletion with an immediate live snapshot comparison, preserving the file and surfacing an ownership conflict when it changed.
3. Make writeIntegrationState/its managed write callers supply the snapshot bytes as expectedData, or enforce that contract centrally for every managed write. Keep the public connector ABI and names unchanged.

The findings are source-level only. They establish a source ownership gap, not a claim about installed-app, live account, or production behavior.
