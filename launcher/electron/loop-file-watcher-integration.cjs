'use strict';
const path = require('node:path');
const { createLoopFileWatcher } = require('./loop-file-watcher.cjs');
const { registerLoopFileWatcher } = require('./ipc/loop-file-watcher.cjs');

/** Main-owned adapters only. No startup, path grant, model offer or enqueue replay. */
function createLoopFileWatcherIntegration({ directory, workspaceService, runtimeHost, getApplicationVersion, canRequest = () => true }) {
  const resolveProject = id => workspaceService.resolveGrant(id);
  function runtimeState() {
    const supervisor = runtimeHost.supervisor, config = supervisor.readConfig(), applicationVersion = getApplicationVersion?.();
    const pendingVersion = supervisor.launcherProfile === 'production'
      && typeof applicationVersion === 'string' && applicationVersion.length > 0
      && typeof config?.releaseVersion === 'string' && config.releaseVersion.length > 0 && config.releaseVersion !== applicationVersion;
    return { supervisor, config, pendingVersion,
      pendingMessage: `Application ${applicationVersion} is installed; runtime ${config?.releaseVersion} is still active. This Loop file source action requires the automatic safe runtime switch. Existing work continues.` };
  }
  async function coreRequest(body) {
    if (!canRequest()) throw new Error('Loop file source admission is closed');
    const { supervisor, config, pendingVersion, pendingMessage } = runtimeState();
    const allowDraining = body.action === 'get';
    if (pendingVersion && !allowDraining) throw new Error(pendingMessage);
    const captured = JSON.stringify(config);
    if (!config || !await supervisor.ownedAgentRuntimeReady(config, { allowDraining })) throw new Error('Start the current NEKODEX runtime to use Loop file sources');
    if (!canRequest() || JSON.stringify(supervisor.readConfig()) !== captured) throw new Error('Loop file source runtime owner changed');
    let receipt;
    try { receipt = await supervisor.control(config, 'agent-mode', { body, returnErrorReceipt: true }); }
    catch (error) {
      if (pendingVersion && /\bHTTP 404\b/.test(error instanceof Error ? error.message : String(error))) throw new Error(pendingMessage);
      throw error;
    }
    if (receipt?.ok !== true) throw new Error(receipt?.message || receipt?.error || 'Loop file source operation failed');
    return receipt.value;
  }
  let service, recoveryRequired = false;
  const unavailable = () => { throw Object.assign(new Error('Loop file source is unavailable because an existing owner lock is retained. Its physical owner and unfinished work have not been reconciled. Explicit owner recovery is required; this instance starts no source reads.'), { code: 'LOOP_SOURCE_OWNER_RECOVERY_REQUIRED' }); };
  try {
    service = createLoopFileWatcher({ directory, resolveProject,
      getTask: (taskId, workId) => coreRequest({ action: 'get', taskId, ...(workId !== undefined ? { workId } : {}) }),
      enqueueWork: body => coreRequest(body),
    });
  } catch (error) {
    // A lock may belong to another live owner or survive an unclean exit. Its
    // existence proves neither stale ownership nor a settled enqueue. Isolate
    // this optional source; never inspect/delete the lock or mutate its journal.
    if (error?.code !== 'EEXIST' || error.syscall !== 'open' || error.path !== path.join(path.resolve(directory), 'owner.lock')) throw error;
    recoveryRequired = true;
    service = Object.freeze({ status: unavailable, select: unavailable, enable: unavailable, disable: unavailable,
      refresh: unavailable, reconcile: unavailable, currentOperation: () => null, close: async () => {} });
  }
  return {
    service,
    register({ privacyHandle, dialog, getWindow }) {
      registerLoopFileWatcher({ service, resolveProject, dialog, getWindow,
        handle: (channel, handler) => privacyHandle(channel, (event, body) => {
          if (recoveryRequired) return unavailable();
          if (['select', 'enable'].includes(body?.action)) {
            const current = runtimeState(); if (current.pendingVersion) throw new Error(current.pendingMessage);
          }
          return handler(event, body);
        }, body => body?.action === 'disable'),
      });
    },
    beforeTaskAuthorityChange(body) {
      if (recoveryRequired) return;
      if (typeof body.taskId === 'string' && (['run', 'step', 'cycle', 'resume-continuation', 'refresh-execution'].includes(body.action)
          || body.action === 'control')) service.invalidateTask(body.taskId);
    },
    beforeForget: id => { if (!recoveryRequired) service.invalidateProject(id); },
    beforeOwnerTeardown() {
      if (recoveryRequired) return;
      let failure;
      for (const id of new Set(service.status().rows.map(row => row.taskId))) {
        try { service.invalidateTask(id); } catch (error) { failure ??= error; }
      }
      if (failure) throw failure;
    },
    currentOperation: () => service.currentOperation(),
    close: () => service.close(),
  };
}
module.exports = { createLoopFileWatcherIntegration };
