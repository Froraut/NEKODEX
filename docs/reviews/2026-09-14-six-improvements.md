# Six requested improvements — implementation work

Scope approved: native cross-task continuation; compaction recovery/progress; retained-tab
acceptance; resumable downloads; compatible-upgrade readiness; stopped-thinking diagnostics.

Completion requires implementation, focused verification within the shared user budget,
signed macOS release, installation and an accurate separation of live and fixture evidence.
No full suites or corpus replay. Use Instant for model-independent live work.

## Work tracking

- Cross-task continuation: implemented; exact native current-turn journal match, including payload
  and provenance, precedes normalization. Local root-task format only; unrelated tool text is rejected.
- Compaction recovery/progress: implemented; typed viewport acquisition failure can recover before
  Send activation, inside the existing owner. Preparation, recovery, acknowledgement and summary
  stages emit progress. Post-send failure/cancellation does not authorize a duplicate.
- Retained-tab acceptance: visible/background ownership and subsequent helper reuse covered by
  a focused scenario. Live retained-compaction continuation still needs its bounded acceptance.
- Resumable downloads: implemented; signed-identity cache, partial retention, Content-Range and
  full hash validation, restart when Range is ignored, inactivity and total limits, visible progress.
- Compatible setup: implemented; contract epoch and private identity hash preserve
  existing verification only when account, catalog, route and connector configuration agree.
- Stopped-thinking diagnostics: implemented with safe progress counters, final text size and
  a diagnostic checkpoint; no prompt contents, automatic resend or invented cause.

Verification: nine focused cases passed (five download/setup, three native delivery/compaction/
stopped-thinking, one visible/background retained lifecycle). Core and renderer typechecks passed;
one TypeScript optional-payload error was corrected before repeating the failed typecheck.
Automated verification so far is under 7 seconds. No full suite or corpus replay was run.
Signed release and live installation pending. Previous release evidence is reused explicitly.
