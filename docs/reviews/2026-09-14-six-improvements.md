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
## Released and installed

Version `5.1.0-froraut.17` is published and installed at `/Applications/Codex Web GPT.app`.
Release source: `9a6e405ce8eb3401359da99043697eecda27ac9d`.
GitHub Actions run `34888772679` completed ARM64, Intel and publication jobs.
The installed ARM64 archive was checked against signed release metadata and its expected source
and workflow run; Gatekeeper accepted it as Notarized Developer ID. The previous installation
was backed up before replacement.

The daemon reported this version, healthy and accepting turns. The setup UI verified the owned
tunnel and Codex Native3 connector; setup contract 1 was saved at 2026-09-14T19:57:57.666Z.
This first receipt does not itself demonstrate preservation across a future live upgrade.

## Bounded live acceptance and remaining limits

One Instant request was sent through native send_message_to_thread to the existing
Review session speed and setup task. Turn `01a0a17f-f7ce-7131-af28-ee8dbfb39151`
completed in 24.586 seconds without the former current-turn-id rejection. This confirms
that the observed native cross-task envelope passed the installed bridge.

The final response was: “This tool call was blocked by OpenAI's safety checks.”
The native journal contained no command/file-tool execution for this request, so the requested
marker read did not pass acceptance. The user's screenshot confirms the completed response,
not a pending compaction spinner. The precise origin and reason for that message remain
unestablished; no alternate execution path or automatic replay was attempted.

The user-opened Chrome tab displayed the ChatGPT home page, not the failed temporary
conversation, and therefore supplied no additional evidence about the tool refusal.

The visible/background retained-tab lifecycle has focused fixture coverage. A new successful
live primary compaction followed by native tool execution on this release remains unconfirmed.
Earlier successful compaction belongs to the previous-release evidence and is not counted as
new-release acceptance. Download interruption/resume and compatible-upgrade preservation
have focused fixture evidence, not a new live failure-injection or subsequent-version upgrade.
No additional model replay or broad verification was run to work around these limits.
