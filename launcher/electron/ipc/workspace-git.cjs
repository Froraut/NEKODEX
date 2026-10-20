"use strict";

// registerIpcHandler must be the composition root's sender-authorized lifecycle guard.
// Neither absolute paths, storage locations nor Git arguments cross this boundary.
function registerWorkspaceGitIpc({ registerIpcHandler, service }) {
  const id = (value) => {
    if (typeof value !== "string" || !/^[a-f0-9-]{36}$/.test(value)) throw new Error("Invalid workspace resource identifier");
    return value;
  };
  const object = (value, keys) => {
    if (!value || typeof value !== "object" || Array.isArray(value)
        || Object.keys(value).some((key) => !keys.includes(key))) throw new Error("Invalid workspace operation");
    return value;
  };
  const paths = (value) => {
    if (!Array.isArray(value) || !value.length || value.length > 64 || value.some((item) => typeof item !== "string"
        || !item || item.length > 4096 || item.startsWith("/") || /^[A-Za-z]:/.test(item) || /[\\\0]/.test(item)
        || item.split("/").some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git"))) {
      throw new Error("Invalid selected file paths");
    }
    return value;
  };
  const preview = (value) => ({ previewId: id(object(value, ["previewId"]).previewId) });
  const handle = (channel, count, action) => registerIpcHandler(channel, (_event, ...args) => {
    if (args.length !== count) throw new Error("Unexpected workspace operation arguments");
    return action(...args);
  });
  handle("launcher:workspace-git-review-bases", 1, workspaceId => service.reviewBases(id(workspaceId)));
  handle("launcher:workspace-git-review-capture", 2, (workspaceId, value) => {
    const input = object(value, ["baseId"]);
    return service.reviewCapture(id(workspaceId), input.baseId === undefined ? {} : { baseId: id(input.baseId) });
  });
  handle("launcher:workspace-git-review-diff", 2, (workspaceId, value) => {
    const input = object(value, ["captureId", "kind", "path", "stage"]);
    id(input.captureId);
    if (!["worktree", "staged", "base", "conflict"].includes(input.kind)) throw new Error("Invalid local Git diff kind");
    if (input.path !== undefined) paths([input.path]);
    if (input.kind === "conflict" ? !input.path || ![1, 2, 3].includes(input.stage) : input.stage !== undefined) throw new Error("Invalid conflict stage");
    return service.reviewDiff(id(workspaceId), input);
  });
  handle("launcher:workspace-git-review-prepare", 2, (workspaceId, value) => {
    const input = object(value, ["actionId", "captureId", "operation", "paths", "message", "author"]);
    id(input.actionId); id(input.captureId);
    // The controller validates operation-specific fields and exact bounded author/message data.
    if (input.paths !== undefined) paths(input.paths);
    return service.reviewPrepare(id(workspaceId), input);
  });
  handle("launcher:workspace-git-review-apply", 2, (workspaceId, value) => {
    const input = object(value, ["actionId", "reviewDigest"]); id(input.actionId);
    if (typeof input.reviewDigest !== "string" || !/^[a-f0-9]{64}$/.test(input.reviewDigest)) throw new Error("Invalid exact local Git review");
    return service.reviewApply(id(workspaceId), input);
  });
  handle("launcher:workspace-git-review-inspect-action", 2, (workspaceId, actionId) => service.reviewInspectAction(id(workspaceId), id(actionId)));
  handle("launcher:workspace-git-review-list-actions", 1, workspaceId => service.reviewListActions(id(workspaceId)));
  handle("launcher:workspace-git-review-prune-actions", 2, (workspaceId, actionIds) => {
    if (!Array.isArray(actionIds) || !actionIds.length || actionIds.length > 32) throw new Error("Invalid settled local Git actions");
    return service.reviewPruneActions(id(workspaceId), actionIds.map(id));
  });
  handle("launcher:workspace-worktrees", 1, (workspaceId) => service.listWorktrees(id(workspaceId)));
  handle("launcher:workspace-worktree-create", 2, (workspaceId, value) => {
    const input = object(value, ["name", "expectedHeadOid"]);
    if (typeof input.name !== "string" || !/^[a-z0-9][a-z0-9-]{0,47}$/.test(input.name)
        || typeof input.expectedHeadOid !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(input.expectedHeadOid)) {
      throw new Error("Invalid worktree name or captured commit");
    }
    return service.createWorktree(id(workspaceId), { name: input.name, expectedHeadOid: input.expectedHeadOid });
  });
  handle("launcher:workspace-worktree-archive-preview", 2, (workspaceId, worktreeId) => service.previewArchive(id(workspaceId), id(worktreeId)));
  handle("launcher:workspace-worktree-archive", 2, (workspaceId, value) => service.archiveWorktree(id(workspaceId), preview(value)));
  handle("launcher:workspace-snapshots", 1, (workspaceId) => service.listSnapshots(id(workspaceId)));
  handle("launcher:workspace-snapshot-create", 2, (workspaceId, value) => {
    const input = object(value, ["paths", "label"]);
    if (input.label !== undefined && (typeof input.label !== "string" || input.label.length > 120)) throw new Error("Invalid snapshot label");
    return service.createSnapshot(id(workspaceId), { paths: paths(input.paths), ...(input.label === undefined ? {} : { label: input.label }) });
  });
  handle("launcher:workspace-snapshot-delete", 2, (workspaceId, snapshotId) => service.deleteSnapshot(id(workspaceId), id(snapshotId)));
  handle("launcher:workspace-restore-preview", 2, (workspaceId, value) => {
    const input = object(value, ["snapshotId", "paths"]);
    return service.previewRestore(id(workspaceId), { snapshotId: id(input.snapshotId), paths: paths(input.paths) });
  });
  handle("launcher:workspace-restore", 2, (workspaceId, value) => service.restoreSnapshot(id(workspaceId), preview(value)));
}
module.exports = { registerWorkspaceGitIpc };
