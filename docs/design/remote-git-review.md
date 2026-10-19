# Remote Git Review: next implementation contract

This is a planned contract, not an implementation or acceptance report. The
[adoption program](full-adoption-program.md) assigns Git Review to P07 and the
editor/conflict boundary to P08. Existing remote SSH/SFTP editing and managed
worktree create/Open/archive do not implement full remote Git Review.

The [local workspace owner](workspace-platform.md) supplies read-only
`gitBases/gitStatus/gitDiff`. Its worktree/snapshot mutation service is not a
local stage/unstage/commit API. This contract adds the complete remote review
flow and separately approved index/commit mutations; it does not replace that
scope with worktree management or imply that local mutation parity exists.

## Scope and authority

One main-owned `RemoteGitReviewController` uses the existing selected SSH host,
strict host checking, pinned alias configuration, connected canonical root and
fixed JSON/Python helper transport. Renderer input contains opaque IDs, bounded
relative paths and explicit intent, never executable Git arguments or helper
source. Git Review is a human workspace feature; it adds no Agent tool authority.

Every capture/plan binds host fingerprint, SSH account, connection epoch,
canonical worktree root/device/inode, Git directory and common-directory identity.
Linked worktrees resolve their actual index and Git metadata; do not assume
`root/.git` is a directory. Mutation review identifies the affected repository,
branch, files and index/ref changes. Selection or a read capture grants no write.

Keep the existing per-host exclusive owner. Also serialize Git mutations by
host fingerprint + SSH account + canonical common-directory identity, including
different host profiles/worktrees that share the same repository. This does not
lock external programs out; Git index locks and ref comparisons are still required.

## Required connected behavior

| Operation | Required behavior |
| --- | --- |
| Status and bases | Typed NUL-delimited porcelain parsing, including rename pairs, staged/unstaged/untracked and unmerged entries. Enumerate bounded HEAD/local/saved remote-tracking bases with exact OIDs and opaque choices. Represent unborn HEAD explicitly. |
| Diff and freshness | Separate staged and working-tree/per-file views, captured HEAD/base/index identity, binary/truncation/unavailable flags. Preserve old review bytes when a fresh observation is stale. Moving/deleting a base, changing HEAD/index or relevant file bytes invalidates the capture. Untracked listing alone is not a content diff. |
| Stage | Review exact selected paths, modes, current revisions and desired index content. Explicit Apply stages only that reviewed candidate and preserves unrelated index entries. Rename review includes both paths. Index publication must not silently consume newer unreviewed worktree bytes. |
| Unstage | Separately review exact selected index entries and captured HEAD/unborn baseline. Change only the index; preserve worktree bytes and unrelated staging. No worktree reset is hidden behind Unstage. |
| Commit staged | Review the complete staged tree, branch, message, author/committer policy and exact parents. Commit includes no implicit add. Unmerged entries block commit. Initial commit has no parent; a resolved merge displays and binds its parent set. |
| Conflicts and editing | Show base/ours/theirs index stages. Open the path through the existing SFTP editor, retain its draft and expected revision, then explicitly save and stage the resolution. Preserve the draft on a concurrent edit or disconnect. No automatic ours/theirs selection or conflict-marker deletion. |

Binary files may be inspected as metadata and staged within declared bounds;
the text editor does not overwrite binary/truncated content. Ignored files are
never auto-added. Display large-file, unusual-path, submodule/gitlink and sparse
checkout limitations before mutation; do not traverse a submodule as another grant.
No automatic merge/rebase/cherry-pick continuation is inferred from conflict UI.
An explicitly reviewed resolved-merge commit also binds and settles its exact
merge-state metadata; it must not leave the repository falsely shown as merging.
An unsupported repository/sequencer state must be identified before accepting a
mutation, rather than partially executing a different Git workflow.

## Mutation and callback boundary

Read operations retain the current callback protections: fixed argv, no shell,
bounded output/read deadlines, no pager/external diff/textconv/fsmonitor,
disabled clean/smudge/process callbacks, credential prompts, LFS/lazy fetching,
transport protocols and inherited `GIT_*` overrides. Apply the same protections
to writes, additionally disabling hooks, editors and signing subprocesses.
Repository configuration must not become executable authority. Relevant Git
attribute/conversion policy must be captured or refused, never silently changed.

Stage/unstage publish an exact candidate index while owning the real Git
`index.lock`. Revalidate the original index identity/digest, selected revisions
and directory identities before publication; fsync candidate and containing
directories. Release only the exact lock this operation owns. Preserve competing
locks and fail stale rather than overwrite another writer's staging.

Commit records the exact staged tree/message/parents and candidate commit OID
before the final ref update. Update the captured ref using compare-and-swap
against the expected HEAD (or the explicit absent ref for an initial commit).
Do not auto-fetch, switch branches, reset, clean, push, run tests or invoke hooks
as a consequence of viewing, staging or committing.

These typed operations run with the SSH user's existing permissions. The root
is not a command sandbox, and the wrapper does not claim adversarial filesystem
compare-and-swap against arbitrary non-Git writers. Existing SFTP final revision
checks/atomic rename retain their disclosed simultaneous-writer limitation.

## Durable ownership and lost acknowledgements

Each mutation has a distinct action ID and exact request digest. Persist a signed
local intent before dispatch and a private fsynced remote action record before
the Git effect. Bind records to the reviewed scope, before-state and intended
index/tree/ref transition; retain known candidate/result OIDs and terminal phase.
Use one remote action identity after disconnect, never a second command sender.

A lost connection after acceptance is unknown, not failed/no-effect. Reconnect
only establishes transport: it does not restore approval or replay stage/commit.
Typed inspect/reconcile reads that action's record and exact current index/ref/
commit evidence. A free-text acknowledgement alone cannot prove the Git effect.
Missing, contradictory or partial evidence stays unknown and blocks conflicting
mutations; a new action ID is not a way around the held outcome.

Register ownership before asynchronous work. UI remount, host/root switching and
late callbacks keep their original scope and cannot clear another draft/capture.
Quit closes admission and joins accepted mutations through physical settlement
and durable receipts; a read timeout is not authority to kill a Git mutation.

## Implementation seam and proportional acceptance

Add `remote-git-review.cjs/.d.cts` beside `remote-worktrees.cjs`, using the same
RemoteWorkspace transport/receipt owner with its own fixed helper operations.
Extend `remote-workspace.cjs/.d.cts`, guarded IPC, preload and renderer types with
bases/capture/diff, prepare/apply stage/unstage/commit and exact action inspection.
Add a scoped `RemoteGitReview` surface linked to the existing remote editor;
respect parent connection/list ownership before starting child reads.

Use one focused backend target with a temporary real Git repository for callback
refusal, staged/unstaged/rename/binary/conflict views, stale index/ref and lost-ACK
reconciliation without replay. Add one connected component flow and one actual
isolated SSH/UI fixture: edit conflict -> deliberate save -> diff -> stage/unstage
-> reviewed commit -> independent index/tree/ref OID observation. Cover an initial
commit and resolved-merge parent handling at the affected backend boundary.
Reuse unchanged local/worktree/Native proofs; no broad repository suite or live
business repository is implied. Installed delivery remains separate acceptance.
