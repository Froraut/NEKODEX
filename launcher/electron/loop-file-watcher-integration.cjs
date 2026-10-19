'use strict';
const path = require('node:path');
const { createLoopFileWatcher } = require('./loop-file-watcher.cjs');
const { createLoopFileWatcherRecovery } = require('./loop-file-watcher-recovery.cjs');
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
    if (closing || !canRequest()) throw new Error('Loop file source admission is closed');
    const { supervisor, config, pendingVersion, pendingMessage } = runtimeState();
    const allowDraining = body.action === 'get';
    if (pendingVersion && !allowDraining) throw new Error(pendingMessage);
    const captured = JSON.stringify(config);
    if (!config || !await supervisor.ownedAgentRuntimeReady(config, { allowDraining })) throw new Error('Start the current NEKODEX runtime to use Loop file sources');
    if (closing || !canRequest() || JSON.stringify(supervisor.readConfig()) !== captured) throw new Error('Loop file source runtime owner changed');
    let receipt;
    try { receipt = await supervisor.control(config, 'agent-mode', { body, returnErrorReceipt: true }); }
    catch (error) {
      if (pendingVersion && /\bHTTP 404\b/.test(error instanceof Error ? error.message : String(error))) throw new Error(pendingMessage);
      throw error;
    }
    if (receipt?.ok !== true) throw new Error(receipt?.message || receipt?.error || 'Loop file source operation failed');
    return receipt.value;
  }
  let ownedService = null, recoveryController, recoveryReceipt = null, retainedRecovery = null, closing = false, closingPromise;
  let unavailableReason = 'An existing owner lock is retained. Its physical owner and unfinished work have not been reconciled.';
  const unavailable = () => { throw Object.assign(new Error('Loop file source is unavailable because an existing owner lock is retained. Its physical owner and unfinished work have not been reconciled. Explicit owner recovery is required; this instance starts no source reads.'), { code: 'LOOP_SOURCE_OWNER_RECOVERY_REQUIRED' }); };
  const expectedOwnerConflict = error => error?.code === 'LOOP_SOURCE_RECOVERY_IN_PROGRESS'
    || error?.code === 'EEXIST' && error.syscall === 'open' && error.path === path.join(path.resolve(directory), 'owner.lock');
  function acquireOwner() {
    ownedService = createLoopFileWatcher({ directory, resolveProject,
      getTask: (taskId, workId) => coreRequest({ action: 'get', taskId, ...(workId !== undefined ? { workId } : {}) }),
      enqueueWork: body => coreRequest(body),
    });
  }
  try { acquireOwner();
  } catch (error) {
    // A lock may belong to another live owner or survive an unclean exit. Its
    // existence proves neither stale ownership nor a settled enqueue. Isolate
    // this optional source; never inspect/delete the lock or mutate its journal.
    if (!expectedOwnerConflict(error)) throw error;
    if (error.code === 'LOOP_SOURCE_RECOVERY_IN_PROGRESS') unavailableReason = 'A retained recovery transaction requires exact receipt inspection; physical ownership has not been reconciled.';
  }
  const recovery = () => recoveryController ??= createLoopFileWatcherRecovery({ directory });
  function assertAdmission() {
    if (closing || !canRequest()) throw new Error('Loop file source admission is closed');
  }
  function assertNewAction() {
    assertAdmission(); const current = runtimeState(); if (current.pendingVersion) throw new Error(current.pendingMessage);
  }
  const owner = () => { if (closing) throw new Error('Loop file source owner is closing'); if (!ownedService) unavailable(); return ownedService; };
  // IPC and main lifecycle retain one facade. Explicit recovery changes only its
  // owned delegate; existing references can never keep using an obsolete owner.
  const service = Object.freeze({
    status() {
      return ownedService ? { ...ownedService.status(), availability: 'owned', recoveryRequired: false, retainedRowsLoaded: true, recoveryReceipt, retainedRecovery }
        : { capability: 'explicit-selected-local-file-metadata', genericExternalWatchers: false, rows: [],
          availability: 'recovery_required', recoveryRequired: true, retainedRowsLoaded: false, reason: unavailableReason, recoveryReceipt, retainedRecovery };
    },
    select(input) { assertNewAction(); return owner().select(input); },
    enable(input) { assertNewAction(); return owner().enable(input); }, disable: id => owner().disable(id),
    refresh: id => owner().refresh(id), reconcile: input => owner().reconcile(input), waitForIdle: () => owner().waitForIdle(),
    recoveryReview() {
      assertAdmission(); const review = recovery().review(); retainedRecovery = review.retainedRecovery ?? null;
      if (retainedRecovery) recoveryReceipt = retainedRecovery.receipt ?? null;
      return review;
    },
    recoveryStatus(reviewId) {
      const receipt = recovery().inspect(reviewId) ?? null;
      if (retainedRecovery?.recoveryId === reviewId) { retainedRecovery = { recoveryId: reviewId, receipt }; recoveryReceipt = receipt; }
      else if (!retainedRecovery && receipt) recoveryReceipt = receipt;
      return { receipt };
    },
    recover(input) {
      assertNewAction(); let receipt;
      try { receipt = recovery().recover(input); }
      catch (error) { if (error?.recoveryReceipt) recoveryReceipt = error.recoveryReceipt; throw error; }
      recoveryReceipt = receipt;
      if (receipt.state === 'completed' && receipt.terminal === true && receipt.recovered === true && !ownedService) {
        try { acquireOwner(); }
        catch (error) {
          unavailableReason = expectedOwnerConflict(error)
            ? 'Recovery completed, but another retained owner or recovery transaction prevents this instance from acquiring source ownership.'
            : 'Recovery completed, but fresh source ownership could not be acquired. Inspect retained state before any further action.';
        }
      }
      return { ...receipt, ownerAcquired: Boolean(ownedService), status: service.status() };
    },
  });
  return {
    service,
    register({ privacyHandle, dialog, getWindow }) {
      registerLoopFileWatcher({ service, resolveProject, dialog, getWindow,
        handle: (channel, handler) => privacyHandle(channel, (event, body) => {
          if (['select', 'enable'].includes(body?.action)) {
            owner(); assertNewAction();
          }
          return handler(event, body);
        }, body => body?.action === 'disable'),
      });
    },
    beforeTaskAuthorityChange(body) {
      if (!ownedService || closing) return;
      if (typeof body.taskId === 'string' && (['run', 'step', 'cycle', 'resume-continuation', 'refresh-execution'].includes(body.action)
          || body.action === 'control')) ownedService.invalidateTask(body.taskId);
    },
    beforeForget: id => { if (ownedService && !closing) ownedService.invalidateProject(id); },
    beforeOwnerTeardown() {
      if (!ownedService || closing) return;
      let failure;
      for (const id of new Set(service.status().rows.map(row => row.taskId))) {
        try { ownedService.invalidateTask(id); } catch (error) { failure ??= error; }
      }
      if (failure) throw failure;
    },
    currentOperation: () => recoveryController?.currentOperation?.() || ownedService?.currentOperation() || null,
    close() {
      if (closingPromise) return closingPromise;
      closing = true;
      closingPromise = (async () => {
        const results = await Promise.allSettled([Promise.resolve().then(() => ownedService?.close()),
          Promise.resolve().then(() => recoveryController?.close?.())]);
        const failure = results.find(result => result.status === 'rejected'); if (failure) throw failure.reason;
      })();
      return closingPromise;
    },
  };
}
module.exports = { createLoopFileWatcherIntegration };
