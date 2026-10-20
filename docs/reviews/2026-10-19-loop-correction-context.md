# Meaningful Native Loop and GUI correction context

Task `de24a923-d83c-4c72-8c41-78d6c6947f9f` exercised a bounded recurring service
risk review with the existing authenticated Native development profile. It used
two substantive input packets and three real GPT-6.1-Sol offers under a bound of
four. No tools or operational changes were performed. Price remained unknown.

## Defect and implementation

Source review before the GUI correction found that correction rebuilt each
`StageInput` without its runtime `userInput`. The last claimed mailbox packet
remained in the work history, but its values were absent from a later corrected
execution. Same-revision history filtering could not restore them. Adding a
requirement could therefore revert a future report to the original cycle facts.

Correction now resolves the unique claimed work packet for the task's current
cycle, verifies its `lastWorkKey` and enqueue generation, and restores that text
as data on all corrected stages, including replacement IDs. Ambiguous state is
refused. Stage reconstruction explicitly projects plan fields; caller-provided
runtime fields cannot transfer user input, continuations or execution grants.
The next authoritative packet still supersedes the prior packet normally.

Two focused cases with24 assertions and core TypeScript passed on pinned
Bun1.4.0. The regression covers cycle2 U, Pause, changed requirements/new stage,
save without send, stale-scope refusal, explicit Run receiving U, and later V
replacing U. Independent narrow review found no substantive issue. Renderer
source did not change; its retained passing checks were reused.

## Real connected flow

| Step | Observed behavior |
|---|---|
| Initial packet M |120jobs, processing30/min, arrivals10/min, disk8GiB/minimum5. Correct net drain20/min, conditional clearance6minutes against target5, disk margin3GiB. |
| Empty mailbox |Cycle1 settled `review_required / waiting_for_mailbox_work` at one offer; it did not send an empty continuation. |
| One new packet U |Backlog90, processing20/min, arrivals25/min, disk4GiB. Existing live Run consent automatically started cycle2, generation2/revision2, totaling two offers. |
| Meaningful changed result |Correctly reported growth5/min, no finite clearance ETA, disk shortfall1GiB and worse trajectory despite a smaller backlog. Both cycle reports passed independent semantic review. |
| Actual GUI Pause |The real button produced paused generation3/revision2, removed Loop Run consent and sent nothing. |
| Scoped DEV replacement |Native closed through UI, core73114 wrote its current close receipt while main73136 remained alive, then main quit. New core76025/main76028 loaded the context fix and retained the same task. |
| Actual GUI admission refresh |Rebound the task to the current Native owner, generation4/revision2, without sending. |
| Actual GUI correction |Only a presentation requirement was entered: include a decision status beside each proposed role owner. No U metric was repeated. Save created generation5/revision3, a pending stage, exactly preserved U and no Loop Run grant; offer count remained two. |
| Separate actual GUI Run |Sent one new offer on a fresh Native binding/thread. Canonical automatic-host input contained exact durable U, and the canonical assistant summary matched the core result. |
| Corrected output |Still used90/20/25/4GiB, growth5/min, no finite ETA and shortfall1GiB; added explicit proposed/pending-decision statuses beside all three role owners. Independent semantic review passed. |
| Final actual GUI Pause |Three offers total, cycle2, generation6/revision3, paused with no Run grant. No fourth offer. |

The third input's canonical `stage.userInput` and user mailbox message exactly
match the claimed U packet. Its correction text contains none of U's numeric
metrics. This verifies the corrected data path rather than relying on repeated
source values in the correction. Its Native thread differs from both original
cycle threads. Leaf state was completed, retired and owner-free; no persisted
physical `thread/closed` timestamp is claimed.

After final Pause, Native closed through the UI. Core76025 wrote `closed:true`
for its current PID with zero Web requests while main76028 was still available;
main quit normally afterwards. Both DEV pairs are absent, and ports57134/54352
are closed. Profiles, current packet, canonical results and receipts remain.

Evidence is retained under
`/Users/alex/Documents/ChatGPT/Nekodex/reviews/evidence/native-integrated-20261019/native-semantic-loop/`:
cycle snapshots and semantic review; `gui-correction-fixed/` contains pre-Run
state, canonical context evidence, corrected report, review and cleanup receipts.

This is controlled semantic Loop, GUI correction and durable-context acceptance.
It does not establish operational remediation, indefinite service reliability,
external watchers, recovery during an active unknown send, installed delivery or
personal human final approval. The task reached waiting-for-mailbox review and
was explicitly left paused; no `verified_complete` claim was made.
