# Remote Git Review: implementation contract

This describes the implemented development source contract. The separate
[acceptance report](../reviews/2026-10-19-remote-git-review.md) records verification;
the isolated real SSH/UI flow and final development restart/offline-history
observation passed. Installed delivery remains separate. The
[adoption program](full-adoption-program.md) assigns Git Review to P07 and the
editor/conflict boundary to P08. Existing remote SSH/SFTP editing and managed
worktree create/Open/archive remain separate capabilities.

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

The existing per-host exclusive owner remains in force. The controller also
serializes mutations by resolved endpoint, SSH user and canonical common-directory
identity. A private remote common-directory gate covers aliases that reach the
same physical repository through different endpoint names. The endpoint key
alone does not prove server identity or lock external programs out; Git index
locks and ref comparisons remain required.

## Implemented connected behavior

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
The helper refuses configured repository/worktree `core.attributesFile` and
relevant filter, text/EOL, encoding, ident and autocrlf conversion policies.
Global/system Git configuration and attributes are deliberately disabled and
disclosed in the review limitations. Replacement objects are disabled as well.

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

Each mutation has a distinct action ID and exact request/review digests. The
RemoteWorkspace v2 registry atomically publishes the signed prepared Git row and
its matching signed started receipt before SSH dispatch. Terminal row and receipt
publication is also one registry write; load/store validate their action, kind,
digest and state pairing. Private immutable plans never cross IPC.

Before a Git effect, the helper fsyncs its UUID action record under the worktree
Git directory and acquires the private common-directory owner gate. Records bind
the reviewed scope, before-state and intended index/tree/ref transition, including
known candidate/result OIDs. Gate cleanup requires durable terminal evidence and
exact owned lock cleanup. Persistence uncertainty stays held. One remote action
identity survives disconnect; there is no second command sender.

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
Known remote results whose local atomic publication failed remain held until an
exact local settlement retry. After restart, prepared rows become unknown and
inspection reads the retained remote ledger; Apply never redispatches them.
`listActions` is passive and works offline. Explicit local pruning accepts only
reviewed or settled nonheld completed/failed rows, never prepared/unknown/held
actions. It preserves remote UUID ledgers; applying a pruned ID is refused.

## Files, bounds and acceptance

`launcher/electron/remote-git-review.cjs/.d.cts` and the fixed
`remote-git-review-helper.cjs` use the existing RemoteWorkspace transport/receipt
owner. The facade, guarded IPC, preload and renderer expose
bases/capture/diff, prepare/apply stage/unstage/commit and exact action inspection.
The scoped Remote Git Review surface links conflict paths to the existing SFTP
editor and retains explicit review/Apply and unknown-outcome ownership.

Bounds are 32 selected paths, 256 KiB per selected file and 384 KiB selected bytes;
512 status entries, 512 KiB diff text, and bounded HEAD plus 128 ref choices.
The controller retains 24 captures and 24 diff responses. Signed Git actions are
limited to 32 records / 8 MiB within the 24 MiB RemoteWorkspace registry, reserving
256 KiB for each prepared/unknown action. Referenced receipts remain pinned.
Capacity refusal does not authorize automatic pruning or outcome acknowledgement.

The focused backend target uses temporary real Git repositories for callback
refusal, staged/unstaged/rename/binary/conflict views, stale index/ref and lost-ACK
reconciliation without replay. Initial commits and resolved-merge parent handling
are covered at the backend boundary. A connected component fixture is covered;
the actual isolated SSH/UI fixture also passed: conflict sides -> concurrent-save
refusal with retained draft -> explicit new baseline/save/readback -> diff ->
separate Stage/Unstage/Commit reviews -> independent index/tree/ref and merge-parent
observation (24/24 checks). The fixture was disconnected and retired after all
three signed action/receipt pairs and remote ledgers completed. Real network loss
mid-effect was not injected; lost-ACK/restart recovery remains backend evidence.
Unchanged local/worktree/Native proofs are reused; no broad suite or live
business repository is implied. See the acceptance report for exact completed
checks and remaining SSH/UI proof. Installed delivery and full P07/P08 parity
remain separate claims.
