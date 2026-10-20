"use strict";

// registerIpcHandler is the composition root's sender-authorized lifecycle guard.
// The service captures native picker/window dependencies; IPC cannot supply them.
function registerWorkspaceIpc({ registerIpcHandler, service, beforeForget = () => {} }) {
  const id = (value) => {
    if (typeof value !== "string" || !/^[a-f0-9-]{36}$/.test(value)) throw new Error("Invalid workspace identifier");
    return value;
  };
  const relative = (value, allowEmpty = false) => {
    if (typeof value !== "string" || value.length > 4096 || (!allowEmpty && !value)
        || value.includes("\0") || value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value)
        || (value !== "" && value.split("/").some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git"))) {
      throw new Error("Invalid workspace-relative path");
    }
    return value;
  };
  const draft = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)
        || Object.keys(value).some((key) => !["path", "text", "expectedRevision", "draftId"].includes(key))
        || typeof value.text !== "string" || Buffer.byteLength(value.text) > 256 * 1024
        || (value.expectedRevision !== null
          && (typeof value.expectedRevision !== "string" || !/^[a-f0-9]{64}$/.test(value.expectedRevision)))) {
      throw new Error("Invalid workspace draft");
    }
    return { path: relative(value.path), text: value.text, expectedRevision: value.expectedRevision,
      ...(value.draftId === undefined ? {} : { draftId: id(value.draftId) }) };
  };
  const handle = (channel, action) => registerIpcHandler(channel, (_event, ...args) => action(...args));
  const noArgs = (action) => (...args) => {
    if (args.length !== 0) throw new Error("This workspace action takes no incoming path or metadata");
    return action();
  };
  handle("launcher:workspace-roots", noArgs(() => service.listRoots()));
  handle("launcher:workspace-pick", noArgs(() => service.pickRoot()));
  handle('launcher:workspace-open-worktree', (...args) => {
    if (args.length !== 2) throw new Error('Select the exact source and managed worktree');
    return service.openManagedRoot(id(args[0]), id(args[1]));
  });
  handle("launcher:workspace-forget", (workspaceId) => {
    const captured = id(workspaceId); beforeForget(captured); return service.forgetRoot(captured);
  });
  handle("launcher:workspace-list", (workspaceId, directory = "") => service.list(id(workspaceId), relative(directory, true)));
  handle("launcher:workspace-preview", (workspaceId, file) => service.preview(id(workspaceId), relative(file)));
  handle("launcher:workspace-save", (workspaceId, input) => service.save(id(workspaceId), draft(input)));
  handle("launcher:workspace-retain-draft", (workspaceId, input) => service.retainDraft(id(workspaceId), draft(input)));
  handle("launcher:workspace-drafts", (workspaceId) => service.listDrafts(id(workspaceId)));
  handle("launcher:workspace-discard-draft", (workspaceId, draftId) => service.discardDraft(id(workspaceId), id(draftId)));
  handle("launcher:workspace-git-bases", (...args) => {
    if (args.length !== 1) throw new Error("Select one workspace for Git base choices");
    return service.gitBases(id(args[0]));
  });
  handle("launcher:workspace-git-status", (...args) => {
    if (args.length < 1 || args.length > 2) throw new Error("Select one workspace and an optional captured base");
    const [workspaceId, options] = args;
    if (options === undefined) return service.gitStatus(id(workspaceId));
    if (!options || typeof options !== "object" || Array.isArray(options)
        || Object.keys(options).length !== 1 || Object.keys(options)[0] !== "baseId") {
      throw new Error("Select a captured repository base; Git expressions are not accepted");
    }
    return service.gitStatus(id(workspaceId), { baseId: id(options.baseId) });
  });
  handle("launcher:workspace-git-diff", (workspaceId, snapshotId) => service.gitDiff(id(workspaceId), id(snapshotId)));
}

module.exports = { registerWorkspaceIpc };
