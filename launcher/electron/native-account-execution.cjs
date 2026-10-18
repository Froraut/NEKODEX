'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createOwnedNativeAccountServer } = require('./owned-native-worker.cjs');
const { makeNativeAccountAdmission } = require('./native-account-admission.cjs');
const { privateDirectory, regular, fail, canonical } = require('./owned-native-admission.cjs');
const { uuid } = require('./owned-native-journal.cjs');
function syncPath(file) { const fd = fs.openSync(file, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
/** Main-only account generation owner. No arbitrary RPC, auth bytes or foreign thread API. */
function createNativeAccountExecutionService({ authority, inventory, getWrapperPin, storageRoot, onChange,
  requestTimeoutMs, terminalTimeoutMs, stopGraceMs, maxConcurrentThreads = 2, testHooks = {} } = {}) {
  if (!authority?.acquireProfileOwner || !inventory?.trustedInventory || typeof getWrapperPin !== 'function' || !path.isAbsolute(storageRoot || '')) throw fail('invalid_execution_owner', 'Trusted Native execution dependencies are required');
  let current, preparing, closing, destroyed = false;
  const notify = () => { try { onChange?.(); } catch {} };
  async function admit(input = {}) {
    const { actionId, inventoryActionId, profileId, epoch, modelIds } = input;
    for (const id of [actionId, inventoryActionId, profileId, epoch]) uuid(id);
    if (Object.keys(input).some(key => !['actionId', 'inventoryActionId', 'profileId', 'epoch', 'modelIds'].includes(key))) throw fail('invalid_execution_owner', 'Unexpected Native execution authority');
    const identity = canonical(input);
    if (destroyed || preparing) throw fail('execution_busy', 'Native execution owner is unavailable');
    if (current) {
      if (current.identity === identity) return { models: models(), serverGeneration: current.serverGeneration };
      throw fail('execution_busy', 'Close the exact Native account generation before replacing it');
    }
    preparing = (async () => {
      const evidence = inventory.trustedInventory(inventoryActionId);
      if (!evidence || evidence.profileId !== profileId || evidence.epoch !== epoch) throw fail('unqualified_inventory', 'Current selected Native inventory is required');
      const lease = authority.acquireProfileOwner({ profileId, epoch, actionId, kind: 'execution' });
      current = { identity, lease, serverGeneration: randomUUID(), server: null, admission: null, lock: null, lockBytes: null, failed: false };
      try {
        const profile = authority.resolveProfile(profileId, epoch, lease), pin = await getWrapperPin();
        privateDirectory(storageRoot); const root = path.join(storageRoot, current.serverGeneration); privateDirectory(root);
        const lock = path.join(profile.root, '.execution-owner'), lockBytes = JSON.stringify({ pid: process.pid, actionId, serverGeneration: current.serverGeneration });
        fs.writeFileSync(lock, lockBytes, { flag: 'wx', mode: 0o600 }); current.lock = lock; current.lockBytes = lockBytes;
        syncPath(lock); syncPath(profile.root);
        const admission = makeNativeAccountAdmission({ authority, lease, profile, inventory: evidence, inventoryActionId, pin,
          serverGeneration: current.serverGeneration, generationRoot: root, modelIds, testHooks });
        current.admission = admission;
        current.server = createOwnedNativeAccountServer({ admission, requestTimeoutMs, terminalTimeoutMs, stopGraceMs, maxConcurrentThreads, onChange: notify, testHooks });
        fs.writeFileSync(path.join(root, 'generation.json'), JSON.stringify({ version: 1, profileId, epoch, serverGeneration: current.serverGeneration,
          inventoryActionId, modelAdmissions: admission.models }) + '\n', { flag: 'wx', mode: 0o600 });
        syncPath(path.join(root, 'generation.json')); syncPath(root);
        notify(); return { models: models(), serverGeneration: current.serverGeneration };
      } catch (reason) { current.failed = true; notify(); throw reason; }
    })();
    try { return await preparing; } finally { preparing = undefined; }
  }
  function models() { return !destroyed && !current?.failed && current?.server?.inspect().accepting ? current.admission.models.map(row => ({ ...row })) : []; }
  return Object.freeze({ admit, models,
    resolveAdmission(admissionId, model) {
      if (!models().some(row => row.id === model && row.admissionId === admissionId)) return undefined;
      return { historySource: current.admission.historySource, createWorker: (binding, onReceipt) => current.server.createWorker(binding, onReceipt) };
    },
    inspect: () => ({ models: models(), profileId: current?.lease.profileId ?? null, epoch: current?.lease.epoch ?? null,
      server: current?.server?.inspect() ?? null, ownerHeld: Boolean(current), failed: current?.failed ?? false }),
    currentOperation: () => preparing ? 'Preparing Native account execution' : current?.server?.currentOperation() ?? (current?.failed ? 'Native account execution reconciliation' : null),
    destroy() {
      if (closing) return closing; destroyed = true; notify();
      closing = (async () => {
        if (preparing) { try { await preparing; } catch {} }
        if (!current) return;
        await current.server?.destroy();
        if (current.lock && fs.existsSync(current.lock)) {
          if (regular(current.lock, 4096).toString() !== current.lockBytes) throw fail('profile_owner_changed', 'Native execution lock changed');
          fs.unlinkSync(current.lock);
          syncPath(path.dirname(current.lock));
        }
        authority.releaseProfileOwner(current.lease); current = undefined; notify();
      })().catch(reason => { closing = undefined; throw reason; }); return closing;
    },
  });
}
module.exports = { createNativeAccountExecutionService };
