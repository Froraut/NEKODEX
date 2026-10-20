'use strict';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OFFICIAL_URL = 'https://auth.openai.com/codex/device';
const ACTION_KEYS = {
  status: ['action', 'actionId'],
  'preview-owner-recovery': ['action'],
  'recover-owner': ['action', 'actionId', 'reviewDigest'],
  'prepare-profile': ['action', 'actionId', 'label'],
  'begin-device-login': ['action', 'actionId', 'profileId', 'epoch'],
  'cancel-login': ['action', 'actionId', 'loginAttemptId'],
  'inspect-models': ['action', 'actionId', 'profileId', 'epoch'],
  'close-execution': ['action', 'actionId', 'profileId', 'epoch'],
};
/** The guarded main handle owns login. Renderer supplies only opaque IDs and intent. */
function registerNativeAccounts({ handle, getAuthority, getInventory, getExecution, beforeExecutionClosed, onExecutionClosed, openExternal, clipboard }) {
  // Known pre-intent refusals are observations, not a command retry. Retain them
  // in this main instance so a lost refusal response can be read back by action ID.
  const rejected = new Map();
  const closed = new Map(); // Current-main observations; leaf retirement receipts remain durable.
  handle('launcher:native-accounts', async (_event, body) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || !Object.hasOwn(ACTION_KEYS, body.action)
      || Object.keys(body).some(key => !ACTION_KEYS[body.action].includes(key))
      || Buffer.byteLength(JSON.stringify(body)) > 2048
      || body.action !== 'preview-owner-recovery' && (body.action !== 'status' || body.actionId !== undefined) && !UUID.test(body.actionId)) throw new Error('Invalid Native account action');
    const authority = getAuthority();
    let recoveryPreview, recoveryReceipt;
    try { if (body.action === 'preview-owner-recovery') {
      if (!authority.previewRecovery) throw new Error('Native recovery is unavailable');
      recoveryPreview = await authority.previewRecovery();
    } else if (body.action === 'recover-owner') {
      if (typeof body.reviewDigest !== 'string' || !/^[a-f0-9]{64}$/.test(body.reviewDigest) || !authority.recoverOwner) throw new Error('Invalid Native recovery review');
      recoveryReceipt = await authority.recoverOwner({ actionId: body.actionId, reviewDigest: body.reviewDigest });
    } else if (body.action === 'prepare-profile') {
      if (typeof body.label !== 'string' || !body.label.trim() || body.label.length > 80 || /\p{C}/u.test(body.label)) throw new Error('Invalid Native profile label');
      authority.prepareProfile({ actionId: body.actionId, label: body.label });
    } else if (body.action === 'begin-device-login') {
      if (!UUID.test(body.profileId) || !UUID.test(body.epoch)) throw new Error('Invalid Native profile identity');
      authority.beginDeviceLogin({ actionId: body.actionId, profileId: body.profileId, epoch: body.epoch });
    } else if (body.action === 'inspect-models') {
      if (!UUID.test(body.profileId) || !UUID.test(body.epoch) || !getInventory) throw new Error('Invalid Native inventory selection');
      await getInventory().run({ actionId: body.actionId, profileId: body.profileId, epoch: body.epoch, explicitUserAction: true });
      if (getExecution) {
        const evidence = getInventory().trustedInventory(body.actionId);
        if (!evidence) throw new Error('Native inventory has no current catalog');
        const modelIds = evidence.picker.filter(row => row.hidden !== true).slice(0, 2).map(row => row.id);
        const { randomUUID } = require('node:crypto');
        await getExecution().admit({ actionId: randomUUID(), inventoryActionId: body.actionId,
          profileId: body.profileId, epoch: body.epoch, modelIds });
      }
    } else if (body.action === 'close-execution') {
      if (!UUID.test(body.profileId) || !UUID.test(body.epoch) || !getExecution) throw new Error('Invalid Native account selection');
      const execution = getExecution(), current = execution.inspect();
      if (current.profileId !== body.profileId || current.epoch !== body.epoch) throw new Error('Native execution scope changed');
      await beforeExecutionClosed?.(execution);
      await execution.destroy();
      if (closed.size >= 128) closed.delete(closed.keys().next().value);
      closed.set(body.actionId, { actionId: body.actionId, kind: 'close-execution', profileId: body.profileId, epoch: body.epoch, state: 'completed' });
      onExecutionClosed?.(execution);
    } else if (body.action === 'cancel-login') {
      if (!UUID.test(body.loginAttemptId)) throw new Error('Invalid Native login identity');
      await authority.cancelLogin({ actionId: body.actionId, loginAttemptId: body.loginAttemptId });
    } } catch (error) {
      if (error?.actionRecorded !== false) throw error;
      if (rejected.size >= 128) rejected.delete(rejected.keys().next().value);
      rejected.set(body.actionId, { actionId: body.actionId, knownNotStarted: true });
    }
    let inventory, execution;
    try { inventory = getInventory?.().inspect(); } catch { /* No reviewed build is not model availability. */ }
    try { execution = getExecution?.().inspect(); } catch { /* No available profile is not an inference proof. */ }
    if (body.actionId && !recoveryReceipt) recoveryReceipt = authority.inspectRecovery?.(body.actionId);
    const snapshot = authority.inspect();
    return { ...snapshot, receipts: [...snapshot.receipts, ...closed.values()], ...(inventory ? { inventory } : {}), ...(execution ? { execution } : {}),
      ...(recoveryPreview ? { recoveryPreview } : {}), ...(recoveryReceipt ? { recoveryReceipt } : {}),
      ...(rejected.has(body.actionId) ? { rejectedAction: rejected.get(body.actionId) } : {}) };
  });
  handle('launcher:native-accounts-open', async (_event, url) => {
    if (url !== OFFICIAL_URL || !getAuthority().inspect().profiles.some(profile => profile.login?.state === 'pending'
      && profile.login.verificationUrl === OFFICIAL_URL && profile.login.userCode)) throw new Error('No pending Native device login');
    await openExternal(OFFICIAL_URL); return { opened: true };
  });
  handle('launcher:native-accounts-copy', (_event, code) => {
    if (typeof code !== 'string' || !code || code.length > 128 || !getAuthority().inspect().profiles.some(profile => profile.login?.state === 'pending'
      && profile.login.verificationUrl === OFFICIAL_URL && profile.login.userCode === code)) throw new Error('No matching Native device code');
    clipboard.writeText(code); return { copied: true };
  });
}
module.exports = { registerNativeAccounts };
