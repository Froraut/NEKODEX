"use strict";

// registerIpcHandler must be the composition root's sender-authorized guard.
// All authority and input checks also live in the native owner, not in the UI.
function registerRemoteWorkspaceIpc({ registerIpcHandler, service }) {
  const id = value => { if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/.test(value)) throw new Error('Invalid remote workspace identifier.'); return value; };
  const handle = (name, fn, count) => registerIpcHandler(`launcher:remote-workspace-${name}`, (_event, ...args) => {
    if (args.length !== count) throw new Error('Invalid remote workspace argument count.'); return fn(...args);
  });
  handle('git-bases', hostId => service.gitBases(id(hostId)), 1);
  handle('git-capture', (hostId, input) => service.gitCapture(id(hostId), input), 2);
  handle('git-diff', (hostId, input) => service.gitDiff(id(hostId), input), 2);
  handle('git-prepare', (hostId, input) => service.gitPrepare(id(hostId), input), 2);
  handle('git-apply', (hostId, input) => service.gitApply(id(hostId), input), 2);
  handle('git-inspect-action', (hostId, actionId) => service.gitInspectAction(id(hostId), id(actionId)), 2);
  handle('git-list-actions', hostId => service.gitListActions(id(hostId)), 1);
  handle('git-prune-actions', (hostId, actionIds) => service.gitPruneActions(id(hostId), actionIds), 2);
  handle('worktree-inspect', hostId => service.worktreeInspect(id(hostId)), 1);
  handle('worktree-prepare', (hostId, input) => service.worktreePrepare(id(hostId), input), 2);
  handle('worktree-create', (hostId, token) => service.worktreeCreate(id(hostId), id(token)), 2);
  handle('worktree-list', hostId => service.worktreeList(id(hostId)), 1);
  handle('worktree-inspect-owned', (hostId, worktreeId) => service.worktreeInspectOwned(id(hostId), id(worktreeId)), 2);
  handle('worktree-prepare-archive', (hostId, worktreeId) => service.worktreePrepareArchive(id(hostId), id(worktreeId)), 2);
  handle('worktree-archive', (hostId, token) => service.worktreeArchive(id(hostId), id(token)), 2);
  handle('hosts', () => service.listHosts(), 0);
  handle('add-host', input => service.addHost(input), 1);
  handle('forget-host', hostId => service.forgetHost(id(hostId)), 1);
  handle('connect', hostId => service.connect(id(hostId)), 1);
  handle('disconnect', hostId => service.disconnect(id(hostId)), 1);
  handle('cancel-operation', hostId => service.cancelOperation(id(hostId)), 1);
  handle('list', (hostId, directory) => service.list(id(hostId), directory), 2);
  handle('preview', (hostId, file) => service.preview(id(hostId), file), 2);
  handle('retain-draft', (hostId, input) => service.retainDraft(id(hostId), input), 2);
  handle('drafts', hostId => service.listDrafts(id(hostId)), 1);
  handle('discard-draft', (hostId, draftId) => service.discardDraft(id(hostId), id(draftId)), 2);
  handle('save', (hostId, input) => service.save(id(hostId), input), 2);
  handle('approve-command', (hostId, input) => service.approveCommand(id(hostId), input), 2);
  handle('execute-command', (hostId, token) => service.executeCommand(id(hostId), id(token)), 2);
  handle('receipts', hostId => service.listReceipts(id(hostId)), 1);
  handle('reconcile', (hostId, receiptId, note) => service.reconcile(id(hostId), id(receiptId), note), 3);
}
module.exports = { registerRemoteWorkspaceIpc };
