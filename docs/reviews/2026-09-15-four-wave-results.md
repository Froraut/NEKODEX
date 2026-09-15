# NEKODEX: two review waves, adjudicator, two implementation waves

User-authorized sequence: 16 Sol reviewers → 16 fresh Sol reviewers → one Sol adjudicator → 16 Sol implementers → 16 fresh Sol implementers. Baseline `3a66157a8943a80bbbe299699cc96bec82721ba1`; generation remains Native4 / Native4 DEV / Zero Risk4. Source development release remains `5.2.0-nekodex.2`.

## Method

Both review waves inspect the same frozen source. Findings require a concrete trigger, source evidence, consequence and counterevidence. The second wave looks for missed call paths and challenges first-wave claims. The adjudicator deduplicates and accepts/rejects candidates before implementation. Implementation wave 2 checks and corrects the preceding implementation rather than forcing changes in clean scopes. No agent runs tests; parent reserves one shared focused verification pass within 60 seconds and at most ten expanded scenarios. No source publication precedes that pass.

Counts distinguish unique accepted defects, repeats, rejected candidates, optional changes and residual corrections to the same defect. No-change results are valid. No full suites, installed-app replacement, release packaging or real account changes are part of this task. Historical review/release documents stay unchanged.

## Completed sequence and measurements

All **65 fresh gpt-5.6-sol medium agents** were dispatched as requested: 32 reviewers, one adjudicator and 32 implementers. All reports were collected and all agents closed. Each wave's sixteen reports is saved as `2026-09-15-four-wave-review1-NN.md`, `review2-NN.md`, `fix1-NN.md`, or `fix2-NN.md`. Two first-wave implementer handoffs were written into report files by the parent from their returned text.

| Stage | Agents | Result | Dispatch-to-collection time |
| --- | ---: | --- | --- |
| Review 1 | 16 | 13 candidate defects; adjudicator accepted 11 | 4m 22s |
| Review 2 | 16 | 8 additional accepted defects; repeated/refined paths not added again | 4m 44s |
| Independent adjudicator | 1 | 19 unique accepted defects; 2 first-wave candidates rejected | 4m 54s |
| Implementation 1 | 16 | Repairs covering D01–D19 across 15 source-owning lanes; Overview needed no edit | 6m 30s |
| Implementation 2 | 16 | 6 lanes refined code; 10 required no further source change | 4m 58s |

The approximately 28-minute interval through collection and final checks includes parent integration, messages and coordination. Times measure wall clock, not summed model compute; no token/cost data was exposed. This is not a controlled comparison with the prior three-wave or migration tasks, whose scopes differ. Source edits and lane counts are not unique defect counts.

## Adjudication

The [canonical ledger](2026-09-15-four-wave-adjudication.md) maps every accepted D01–D19 to reviewer IDs, concrete triggers, direct source evidence and the owning files. Both read-only waves stayed on `3a66157`; no source changed before the adjudicator finished.

Two first-wave candidates were rejected: changing a connector display identity cannot leave that old name inside tunnel YAML because the MCP command does not contain the name; DEV core setup readiness represents installed configuration, not proof of a running Full tunnel. Unknown future approval schemas and unproved account behavior were not counted as new defects. The smoke-snapshot issue from review 2 is a refinement of the review-1 smoke issue, not an extra defect.

## Final source behavior

- **D01/D02 — setup ownership:** service and tunnel installers report exact owned plist bytes immediately after their write and before bootstrap. Setup records that intent, preserves original errors, treats failed status probes as unknown ownership and continues independent compensation without adopting arbitrary later file bytes.
- **D03/D04 — catalog proof:** an old asynchronous probe cannot publish into a newer monitor epoch/configuration. Positive counters must come from the known current launcher-owned daemon with matching PID, service, version, mode and readiness, using the same fetched payload.
- **D05/D17 — account admission and selection:** a pinned fresh turn passes the applicable readiness filter without moving affinity. Existing exact continuations retain their intended ownership behavior. Stale tab/account selection requests cannot overwrite a later request; failed activation restores prior selection while it still owns that change.
- **D06/D13 — current UI evidence:** smoke evidence is current-version persisted state, not a monotonic session/renderer boolean. Failed/external production startup retires the monitor and clears current MCP/catalog proof before awaiting route recovery. Historical verification timestamps remain historical.
- **D07 — journal reads:** ordinary reads do not remove a hook reintroduced after a completed disconnect. Explicit pending-disconnect recovery requires matching active-primary/inactive-recovery evidence and byte/config guards. Uninstall verifies the journal target path and preserves uncertain foreign state.
- **D08/D09 — command gateway:** returned native `isError` becomes a gateway error with bounded diagnostic content; a nested `shell_command` rejects unmappable TTY/output options before execution. Public tool names, descriptions, schemas and generation-4 ABI pins are unchanged.
- **D10/D11 — DEV lifecycle:** direct setup of an existing Full DEV configuration requires explicit evidence that its prior tunnel alias is stopped before changing client, key, profile or config. Running/unknown state produces a pre-mutation refusal rather than an unsafe takeover or a stranded old tunnel.
- **D12/D18/D19 — truthful results:** post-commit cleanup is a successful setup with warnings; original chat failures survive cleanup failures, and both closes run even if one throws synchronously; launcher-owned `tunnel status` does not require a launchd service.
- **D14/D15 — browser observations:** connector rows/counts/titles are scoped to a single visible popup following the composer mention, retaining exact highlight and selected-pill checks. DOM observation errors keep their cause rather than masquerading as an empty menu.
- **D16 — helper cleanup:** shutdown, TERM and final bounded KILL use the exact child handle; the handle remains owned until observed exit/close, and primary operation errors retain secondary cleanup details.

Implementation wave 2 refined setup compensation, synchronous DEV cleanup, startup invalidation ordering, selection ownership, mention-popup proof and uninstall path validation. These refine existing D IDs; they are not six additional independently discovered defects.

## Focused verification

Five named cases passed, with nine intended scenarios and one targeted fixture retry (ten scenario executions total):

1. Gateway error propagation and pre-dispatch rejection of unsupported nested-shell options (two synthetic cases).
2. Ordinary journal inspection preserves a hook restored after disconnect (isolated files).
3. A pinned fresh turn rejects stale connector evidence without moving affinity (pool fixture).
4. The production catalog monitor ignores a retired probe and a foreign PID counter, then accepts current owned evidence (three responses with injected transport, no network).
5. Both actual installer functions report their newly written plist before a synthetic bootstrap failure (two cases; isolated VM, temporary files and mocked service commands, never real launchd).

The account fixture initially lacked the newly used `exactRetainedTurnTab` method. Parent completed that fixture and repeated only the failing case; previously passing cases were not rerun. The older disabled-account fresh-turn expectation was aligned with the new admission contract by manual fixture review.

Backend and launcher `tsc --noEmit` passed, along with syntax checks for the five changed Electron backend modules. Combined executable verification took under five seconds, within the shared 60-second budget. No agent ran tests; no full suite or broad benchmark ran. Test-owned temporary files were removed; no app, tunnel, paid model turn or real service was started/stopped for these checks.

## Remaining evidence and safety boundaries

- These checks do not prove every launchd failure interleaving, open-renderer state transition, real mention-popup DOM variant, account readiness, live approval or retained-task continuation. The `.popover` scope follows existing source evidence; a foreign popup that appears concurrently remains an ambiguity guarded by exact composer/pill proof, not a guaranteed ownership proof.
- If service state cannot be observed after failure, the owned definition can remain with an explicit recovery error. Setup does not guess that an unobserved service is safe to restore or stop.
- A noncooperating external actor can insert an identical hook between the final uninstall check and journal deletion. The code does not claim cross-process atomicity for that interval. Ordinary reads are non-destructive; general compare/write gaps remain documented.
- Direct DEV setup now deliberately refuses a running or unverifiably stopped Full tunnel. A verified owner/idle-drain transition must stop it before mutation; this task did not introduce a new distributed ownership protocol.
- Failure to observe exit even after SIGKILL remains an explicit cleanup error; retained child ownership lasts only while the launcher process exists.
- **Source only:** development version stays `5.2.0-nekodex.2`; Native4, Native4 DEV and Zero Risk4 stay unchanged. No DMG, release tag, signing/notarization, installed-app replacement or ChatGPT connector creation was performed.

## Efficiency conclusion

Review wave 2 contributed eight accepted additional defects, so it had useful yield in this scope. The adjudicator prevented two erroneous first-wave explanations from becoming patches and consolidated repeated roots. The second implementation wave changed six of sixteen lanes; the other ten correctly avoided unnecessary edits. For ordinary follow-up changes, this supports concentrating the correction pass on changed/high-risk owners instead of always repeating sixteen writers. It does not establish that fewer agents would have found the same defects or that NEKODEX itself runs faster.
