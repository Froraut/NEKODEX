# Opt-in Agent workspace snapshots before model offer

DW8a now has an implemented pre-turn hook for explicitly selected local files.
It is separate from manual workspace snapshots and their Electron registry.
The Bun task snapshot owner writes its own private SQLite database. Opening the
Agent screen or creating a task without the checkbox does not capture files.

## Main, task and runtime composition

The Electron local workspace service receives this trusted constructor option:

```js
agentWorkspaceGrantKeyPath: path.join(CORE_HOME, "agent-workspace", "grant-key")
```

Main must first receive an explicit user action selecting an existing picker
root, an exact relative file list and the task UUID/family UUID/generation. It
then calls this main-only method:

```js
const grant = workspaceService.prepareAgentWorkspaceGrant(
  workspaceId,
  selectedRelativePaths,
  { taskId, familyId, generation },
);
```

Only main injects the returned object into `CreateAgentTask.workspaceSnapshotGrant`.
Raw renderer/provider paths, environment envelopes and model-generated metadata
cannot be substituted for it. The UI checkbox must explain the selected-file
coverage and remain off by default. A generation change requires explicit
renewal for that exact generation; a pause/resume/correction is not permission
to silently extend the old signed binding.

The signing authority is `launcher/electron/agent-workspace-grant.cjs`. Main
creates a 32-byte owner-only key, signs the snapshot-only grant and durably
registers its active state in `<keyPath>.grants.json`. The canonical root,
captured device/inode ancestry, selected paths, workspace/task/family IDs and
generation are all signed. Grant metadata contains no selected file contents.
The registry has one writer, main, and signs active/revoked state as well.
Preparing the same active task/family/generation with identical workspace,
ancestry and selected paths returns the exact existing grant. A create-action
retry therefore keeps the same command body and signature. A changed scope for
that binding fails until the user explicitly revokes the existing grant; it is
never replaced silently.

`listAgentWorkspaceGrants(workspaceId?)` exposes summaries for the explicit
revocation UI. `revokeAgentWorkspaceGrant(grantId)` durably revokes that exact
grant. `forgetRoot` blocks while its active grants remain; it neither silently
retains a hidden folder permission nor auto-revokes unrelated tasks. Bun checks
the current signed registry on each hook, so a previously delivered token does
not survive revocation. Missing key/registry, changed root or ancestry and an
invalid signature all fail closed. Revocation stops future capture; existing
private snapshots remain retained history and are not automatically purged.

Bun constructs the distinct owner with trusted paths:

```ts
const snapshots = createAgentWorkspaceSnapshots({
  keyPath: join(coreHome, "agent-workspace", "grant-key"),
  storagePath: join(coreHome, "agent-workspace", "task-snapshots.sqlite"),
});
const runtime = new AgentModeRuntime({
  // Existing store, execution port and model dependencies.
  beforeOffer: async ({ task, dispatch }) => {
    await snapshots.beforeTurn({
      task,
      generation: dispatch.generation,
      dispatchId: dispatch.id,
    });
  },
});
```

The existing Agent runner owns task admission and model offer. It awaits this
hook before `store.offer` or provider execution. A hook failure cancels the exact
never-offered dispatch, releases its reservation, sleeps the worker and pauses
the unchanged generation with `workspace_snapshot_unavailable`. A late hook
cannot pause a corrected replacement generation. An already offered/unknown
dispatch keeps the runner's existing uncertain-send reconciliation; this owner
does not replay it.

`snapshots.listTask(taskId)` returns bounded attempt states and admission receipt
metadata for Agent detail UI. Receipts include path/hash/size/missing flags and
exact grant/task/generation/dispatch/snapshot identities, without file content.
`readSnapshot(dispatchId)` returns the private before-image to a trusted host
consumer; do not expose it to generic status/event/model channels. `close()`
belongs in the runtime's existing shutdown owner after pending hook work settles.

## Durable order and recovery

1. Verify the grant's HMAC, current active registry state, exact task/family/
   generation and canonical root/ancestry. No grant means a cheap skipped hook.
2. For a new dispatch, durably insert a `preparing` record before reading selected
   workspace content. It commits separately under SQLite `synchronous=FULL`.
3. Capture only the named paths with the shared
   `workspace-file-capture.cjs` leaf. It rejects symlinks, hard links, unsafe
   parents, special files and over-limit content. Missing files are explicit
   before-images; parent directories must already exist. Binary bytes are valid.
4. Recheck selected revisions, active grant/root and private storage. Commit
   immutable before-image bytes and an `admitted` receipt in one transaction.
5. Only after that successful receipt does the runner offer execution.

The exact dispatch identity deduplicates an admitted snapshot. Recovery returns
that same receipt only while the current selected file revisions still match
the captured baseline. If they drift, the original snapshot remains intact and
execution is held; it never takes a replacement before-image under the old ID.
A `preparing` record left by a crash and a terminal failed capture both refuse
recapture. A fresh explicit action with a new dispatch, and a renewed grant when
the generation changed, can deliberately select a new baseline.

The owner permits 48 completed snapshots, 512 total attempts and 64 MiB retained
content. Each capture inherits the shared 64-file, 256-KiB-per-file and 4-MiB-total
bounds. Quota failure holds execution; it does not delete old snapshots. Its
database and signing registry are different owners and never write one another's
records.

## Authority and scope limits

The grant says `pre-turn-snapshot-only`. It grants neither filesystem/model-tool
access, shell execution, SSH, worktree mutation nor automatic restore. The
current configured tool host keeps its own permission contract. Selected files
are the declared coverage: unselected, ignored, generated and submodule contents
are not implicitly covered; there is no claim that every model change is backed
up. This is a pre-offer selected-file checkpoint, rather than proof of an atomic
filesystem boundary around all later model/tool effects.

HMAC authenticates which trusted main instance delegated this scope to Bun. It
does not isolate a malicious process already running with the user's full OS
privileges and access to private key files. The portable filesystem layer also
does not provide kernel `openat`/`renameat` isolation from hostile simultaneous
directory-swap races. Ordinary ancestry replacement, symlink escape, concurrent
edits and stale/revoked capabilities are rejected explicitly.

## Focused evidence

`bun test tests/agent-workspace.test.ts` uses disposable real selected files and
the real `AgentModeRunner` hook. Its executor observes durable original bytes
and receipt before performing a disposable file effect. The private bytes
survive reopening, and metadata contains no plaintext before-image. Other cases
prove exact-dispatch deduplication, baseline drift rejection without recapture,
explicit renewal for a new generation, symlink capture failure pausing before
offer with zero sends and preserved failed recovery, forged selection rejection,
explicit revocation, active-grant root-removal blocking and replaced-root refusal.
These are local hook/service proofs; the integrated UI checkbox/native chooser,
live model execution and installed application remain separate evidence layers.
