# Workspace platform: implemented local boundary and next feature ports

The current adoption program includes local and remote workspaces, SSH/SFTP,
commands, owned worktrees, editing, Git review/restore, terminal docks and manual
code snapshots (P03–P10 and DW8). This document records a working local foundation
and the concrete next adapters. Existing Codex capabilities affect ownership and
integration, rather than removing these features from the NEKODEX program.

## Current implementation

`launcher/electron/local-workspace.cjs` exports `createLocalWorkspaceService`.
Its declaration is `local-workspace.d.cts`. Main supplies a trusted
`pickDirectory()` callback and a private `registryPath`, for example
`<userData>/workspace-private/registry.json`. Neither dependency is IPC data.
The service has no `addRoot(path)` or path/envelope-import method. Only a completed
native directory picker creates a grant. A cancelled picker creates nothing.

Each selected canonical local directory gets an immutable random workspace ID,
picker provenance and captured device/inode ancestry. Persisted grants and editor
drafts share a private, bounded, versioned registry. Registry loading rejects a
symlink, a nonregular or oversized file, foreign ownership where available, and
group/world permissions on POSIX. It preserves invalid state by failing, rather
than silently erasing it. Removing a grant requires resolving or explicitly
discarding its retained drafts first. Snapshots are ephemeral; reopening Git
requires a fresh capture.

| Operation | Contract |
| --- | --- |
| `pickRoot()` / `listRoots()` / `forgetRoot(id)` | Explicit selection, stable IDs, removal of that exact grant; no scan of home or observed task paths. |
| `list(id, relativePath)` / `tree(id, relativePath, depth)` | At most 300 entries per directory, 600 tree entries and depth 4. `.git` is excluded. Links and special files are visible as blocked/unsupported entries, never traversed. |
| `preview(id, relativePath)` | At most 256 KiB, with distinct missing/text/binary/truncated states, size and an opaque revision. Text is strict UTF-8. Truncated and binary previews cannot be overwritten through the text editor. |
| `save(id, {path, expectedRevision, text, draftId?})` | Retain the draft first, compare the revision that produced the candidate, then write an adjacent temporary file, sync it and replace the selected file. A conflict returns the current revision while retaining the candidate. Resolving it requires an explicit reopened revision. New files use `expectedRevision: null`. |
| `listDrafts(id)` / `discardDraft(id, draftId)` | Recover full text after service restart; discard applies only to the matching workspace/draft. A changed/unavailable root does not prevent reading the retained draft. |
| `retainDraft(id, input)` | Persist bounded editor text without changing a workspace file. Repeated recovery writes for one workspace/path reuse its draft identity. |
| `gitBases(id)` | Bounded read-only enumeration of captured HEAD plus up to 128 local and saved remote-tracking branch references. Choices carry opaque IDs, exact commit OIDs and ref labels; symbolic remote HEAD aliases are omitted. No fetch, checkout or arbitrary revision expression is accepted. |
| `gitStatus(id, {baseId?})` | Capture full HEAD/base commit IDs and refs, bounded porcelain status and working diff under an opaque snapshot ID. A selected base ID must belong to this workspace and still match the captured HEAD, branch and base OID. Main-only callers retain the prior exact `baseOid` option; renderer IPC accepts only an enumerated `baseId`. An unborn/unavailable HEAD remains unavailable. |
| `gitDiff(id, snapshotId)` | Return that snapshot's captured text and HEAD/base IDs and refs. Compare a fresh observation and report current/stale/unavailable; a moved/deleted selected base branch or changed HEAD invalidates the observation without replacing the old diff. Binary and truncation flags remain explicit. A truncated observation cannot claim to be current. |

All file calls use workspace-relative paths. Absolute paths, traversal,
backslashes/drive paths and `.git` components are rejected. Every operation
revalidates the selected root and its ancestry. File reads reject symlinks and
hard links, open with `O_NOFOLLOW` where available, compare descriptor/path
identities, and recheck parents. Save rechecks parent identities and the opened
file revision immediately before synchronous replacement. Cleanup likewise
requires the original parent identity; a changed parent is not followed to
delete a temporary file in a different directory.

These checks handle ordinary external edits, replaced parents and symlink
escapes. They are not a kernel filesystem sandbox: portable Node does not expose
`openat`/`renameat` with directory handles and compare-and-swap replacement.
A hostile local process can race filesystem checks and the final syscall, and
an arbitrary external editor can write between the last revision check and
replacement. A native filesystem adapter is the next port if the product needs
that stronger adversarial guarantee. Do not describe the current wrapper as
isolating arbitrary native execution. The service serializes its own synchronous
saves; it does not claim to lock other programs out of the repository.

Git inspection starts only fixed read commands, with no shell: `rev-parse`,
`symbolic-ref`, `for-each-ref`, `status`, `diff` and a bounded config-key enumeration. Before inspection it reads
filter key names without comparing worktree bytes, then overrides each discovered
driver's clean/smudge/process command to empty and required flag to false.
Unrepresentable driver names, excessive driver count or failed/truncated config
enumeration fail closed. The config runner is separate from the guarded runner,
so enumeration never recurses. It sets `--no-pager`, `--no-optional-locks`, disables fsmonitor
and untracked caching, clears external diff, uses `--no-ext-diff` and
`--no-textconv`, avoids submodule recursion, removes inherited `GIT_*` overrides
and disables global/system config and credential prompts. Lazy fetching, LFS
smudging, askpass, credential helpers and transport protocols are disabled through
explicit config/environment overrides. Output is capped at
512 KiB per command and each owned command has a 5-second read deadline. Killing
a timed-out read affects that child only. No fetch, checkout, commit, worktree
mutation, SSH, network execution or terminal session is part of this service.
Status and diff form an observational snapshot, not an atomic Git transaction;
changes during capture produce unavailable when detected, and later changes
produce stale. Untracked files appear in status but their content is not claimed
as a diff or snapshot backup.

## Composition and renderer flow

The Electron composition root owns one service and a guarded IPC allowlist.
`pickRoot` has no incoming path argument; its callback invokes the platform
directory chooser with the current launcher window as parent. The renderer
receives workspace IDs and display paths, and sends only IDs plus relative
paths for operations. Provider prompts, task observation, workspace metadata and
environment envelopes never become grants. This authority is for the human
workspace surface; it does not silently change Codex/tool-host permissions.

`ipc/workspace.cjs` receives the existing sender-authorized/lifecycle-guarded
`registerIpcHandler` function. Its no-argument picker method rejects incoming
path/provenance payloads, while file methods validate IDs, relative paths and
bounded draft shapes. `preload.cjs` exposes the narrow `workspace*` methods.

Git base discovery returns labels and exact OIDs, while selection sends back only
the workspace-bound opaque choice ID. The Git review shows the current branch,
lets the user compare working files with HEAD, a local branch or an existing
remote-tracking branch, and captures a fresh connected diff on selection.
Changing the selected base immediately retires the previous displayed capture.
The freshness action retains captured bytes while exposing changed HEAD/base
state. This flow reads local Git state and does not switch branches or fetch.

`resolveGrant(id)` stays main-only for other trusted workspace owners to
revalidate the same selected root. It is not a new renderer authority channel.

`WorkspaceSurface.tsx` provides English/Russian folder selection, expandable
directories, relative-path opening, text editing, draft recovery and explicit
conflict review, plus captured Git status/diff freshness. Recovery writes are
debounced and serialized with file saves per workspace/path; a surface/file
change flushes pending dirty text. The display says a draft is saved only after
the persistence receipt. A sudden process crash before a pending debounce is
accepted can still lose the latest keystrokes. Closing/remounting a surface does
not cancel accepted operations or retarget their receipts to another file.

The useful connected flow is select folder → list directory → preview text →
edit/save → reopen, plus an external edit → conflict → retain/reopen/resolve
flow. Git review selects a captured snapshot and shows its HEAD/base and stale
state. Surface changes and late asynchronous results stay keyed to the workspace,
path and snapshot that started them. The renderer keeps dirty text until a
matching successful save receipt, an explicit discard or a deliberate restore.
On a saved receipt with `draftRetained`, the file was saved but private registry
cleanup failed; report both facts and retain recovery access.

## Next ports for P03–P10 and DW8

All rows below remain in scope for the adoption program. They are explicit
implementation stages, with authority/settlement boundaries that the local
foundation deliberately does not pretend to have completed.

| Feature | Next owner and port | Required connected outcome |
| --- | --- | --- |
| P03: remote SSH/SFTP catalog and preview | `RemoteWorkspaceRegistry.select({sshAlias, canonicalRemoteRoot})` comes from a user-facing host/root chooser; `RemoteReadPort.list/preview({workspaceId, connectionEpoch, relativePath})` implements the same bounded presentation shapes. | Keep SSH alias/agent and normal known-host checking. Bind the grant to resolved host identity, account, canonical remote root and connection epoch. A host-key failure or disconnect is unavailable, never an empty successful directory; do not auto-accept a changed key. SFTP canonicalization and parent/link checks happen on the remote host. |
| P04: remote commands and writes | `RemoteOperationOwner.prepare/commit/observe/cancel(operationId)` with durable request digest, exact host/root, writer identity and terminal receipt. `RemoteWritePort.save` uses remote revision tokens and retains the local draft. | Establish the supported execution route and action permissions. A lost connection after acceptance is an unknown outcome to reconcile; do not blindly repeat a command or write. Credentials remain in the system SSH/keychain path, outside workspace JSON and logs. |
| P05: owned local worktrees | `WorktreeOwner.prepare/create/inspect/archive({sourceWorkspaceId, runId, baseOid})` with one journal and a private NEKODEX ownership marker. Each resulting root receives its own immutable grant, linked to the source selection and exact creation receipt. | Recover the exact owner after restart; serialize repo mutations. Inspect dirty, untracked, ignored and foreign refs before cleanup. User-owned or Codex-owned checkouts are referenced as external resources and never cleaned by this owner. A successful status read alone never authorizes worktree creation/removal. |
| P06: owned remote worktrees | `RemoteWorktreePort` implements the same operation journal over the chosen SSH host, with canonical root, host-key identity and explicit remote mutation receipts. | Implement it as a supported remote feature, rather than treating upstream absence as rejection. Reconnect and reconcile creation before replay. Verify remote marker, Git common directory, branch and dirty state before archiving; never remove a path based on a local cached label. |
| P08: editor and restart restoration | `EditorSessionStore` owns selected workspace/file, persisted drafts, cursor/scroll and expected revision; service save receipts are the sole authority for clearing dirty state. | Reopen selected roots only from grants. Recover unavailable-root drafts, multiple tabs and an external-edit conflict; never persist credentials or unrelated prompt text in editor state. Use a native `FileMutationPort` if stronger simultaneous-writer guarantees are required. |
| P07: Git review | Local inspection keeps `gitStatus/gitDiff`. Remote uses the implemented [RemoteGitReviewController](remote-git-review.md), one existing SSH transport, captured identities, separately reviewed Stage/Unstage/Commit and atomic signed v2 action/receipt pairs. Local mutation parity remains a separate boundary. | Real SSH/UI conflict/edit/stage/unstage/resolved-merge commit passed24 independent properties. Complete index entries and exact parents are reviewed; typed inspection never replays unknown effects. Actual mid-effect network-loss remains unverified. |
| P09 / DW8: manual snapshots and selected restore | `SnapshotStore.capture({workspaceId, selectedPaths, revisions})` writes immutable content-addressed blobs plus a private manifest outside the user's branch. `RestoreOwner.preview/commit({snapshotId, paths, expectedCurrentRevisions})` is a journalled mutation. | Declare tracked/untracked/ignored/binary/submodule coverage. Preserve current dirty and untracked files; preview exact path/base/hash and compare current revisions before each selected restore. Retain before-images, per-file receipts and partial/unknown outcomes. Do not use reset/stash as a default, erase concurrent edits or run automatic rollback because a test failed. A repeated matching restore uses its receipt instead of replay. |
| P10: human PTY terminal dock | `TerminalOwner.open({workspaceId, profileId}) → terminalId`; `input/resize/observe/close({terminalId, generation})` binds an exact native PTY process and journal. A PTY adapter is a distinct dependency, never `git()` or an IPC arbitrary-shell string. | One owner handles cwd, process identity, bounded output/backpressure, resize/input and exact exit. Switching tabs retains the same terminal; stale input never reaches another project. Closing waits for that terminal's terminal outcome and preserves unrelated shells. Restart restoration shows unavailable/exited honestly; it does not replay commands. Human terminal access does not automatically grant an agent tool. |

The opt-in Agent-mode pre-offer checkpoint is now implemented in
[`agent-workspace-snapshots.md`](agent-workspace-snapshots.md), with signed
task/generation grants and durable selected-file before-images before model
offer. It does not claim a full external client's pre-write hook or every model
change: a post-turn diff remains insufficient proof of a complete before-image.
Remote operations, PTYs and worktree mutation each need a single
owner, their own focused development proof and the existing release ordering
before distribution.

## Focused foundation evidence

`bun test tests/local-workspace.test.ts` uses disposable real Git repositories.
It verifies picker-only access, immutable grant recovery, private persistence,
external-edit conflict/draft recovery and explicit refreshed save; symlink-parent
escape and root replacement rejection; binary/truncated previews; and a captured
Git diff that becomes stale after a same-status file edit. A repository configured
with real fsmonitor/external-diff/textconv/filter callbacks leaves its callback
markers uncreated during inspection. The filter fixture first demonstrates that
ordinary Git status invokes its valid clean filter on an equal-size tracked-file
edit, then removes that marker before checking service inspection. These are service-level proofs. Electron picker/UI,
SSH/SFTP, native PTY, worktree/snapshot mutation and installed-app results require
their separate connected-flow evidence.

`bun test tests/workspace-ipc.test.ts` exercises the registered handlers through
the existing logged IPC admission wrapper: an unauthorized sender and a forged
picker payload do not reach the picker, unsafe draft/path fields are rejected,
recovery writes leave disk bytes unchanged, repeated writes share a draft ID,
and explicit save publishes through the service. Main-only grant resolution is
absent from renderer registration. Renderer interaction evidence remains with
the integrated development target.
