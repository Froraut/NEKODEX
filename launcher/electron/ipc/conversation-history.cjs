const fs = require('node:fs/promises');
const ACTIONS = new Set(['status', 'set-recording', 'threads', 'thread', 'message', 'search', 'delete-thread', 'delete-message', 'export', 'import-selected', 'owned-native-status', 'owned-native-consent']);
for (const action of ['transcript-native-status', 'transcript-native-consent', 'transcript-subscriptions', 'transcript-revoke']) ACTIONS.add(action);
for (const action of ['owned-conversation-status', 'owned-conversation-consent', 'owned-conversation-subscriptions', 'owned-conversation-revoke']) ACTIONS.add(action);
/** Guarded main handle is injected by the composition root. The current daemon
 * remains the only DB writer; this registrar never launches/probes another app. */
function registerConversationHistory({ handle, runtimeHost, clipboard, dialog, canonicalRecorder,
  getApplicationVersion, beforeRecordingRevoke, beforeRecordingConsent, afterRecordingConsent, projectRecordingStatus }) {
  const requestHistory = async (_event, body) => {
    if (body && ['canonical-status','canonical-consent','canonical-refresh','canonical-list'].includes(body.action)) {
      if(typeof body!=='object'||Array.isArray(body)||!canonicalRecorder)throw new Error('Canonical native history is unavailable');
      const allowed=body.action==='canonical-list'?['action','cursor','limit']:body.action==='canonical-status'?['action','threadId']:body.action==='canonical-consent'?['action','threadId','enabled','consent','acknowledgeUnknownSecrets']:['action','threadId','cursor','limit'];
      if(Object.keys(body).some(key=>!allowed.includes(key)))throw new Error('Canonical history accepts only an exact selected-thread action');
      if(body.action==='canonical-list')return canonicalRecorder.list({cursor:body.cursor??null,limit:body.limit??30});
      if(body.action==='canonical-status')return canonicalRecorder.status(body.threadId);
      if(body.action==='canonical-consent')return canonicalRecorder.setConsent(body.threadId,{enabled:body.enabled,consent:body.consent,acknowledgeUnknownSecrets:body.acknowledgeUnknownSecrets});
      return canonicalRecorder.refresh(body.threadId,{cursor:body.cursor??null,limit:body.limit??50});
    }
    if (!body || !ACTIONS.has(body.action) || JSON.stringify(body).length > 600000) throw new Error('Invalid history request');
    const enabling = body.enabled === true && ['set-recording', 'owned-conversation-consent'].includes(body.action);
    // Capture ordering before any await: a later privacy revoke must also fence
    // a delayed successful enable response, including a lost revoke ACK.
    const consentAttempt = enabling ? beforeRecordingConsent?.(body) : null;
    const revoking = body.action === 'owned-conversation-revoke'
      || ['set-recording', 'owned-conversation-consent'].includes(body.action) && body.enabled === false;
    if (revoking) await beforeRecordingRevoke?.(body);
    const supervisor = runtimeHost.supervisor;
    const config = supervisor.readConfig();
    const allowDraining = ['status', 'threads', 'thread', 'message', 'search', 'export', 'owned-native-status', 'transcript-native-status', 'transcript-subscriptions', 'transcript-revoke',
      'owned-conversation-status', 'owned-conversation-subscriptions', 'owned-conversation-revoke'].includes(body.action)
      || ['set-recording', 'owned-native-consent', 'transcript-native-consent', 'owned-conversation-consent'].includes(body.action) && body.enabled === false;
    if (body.action === 'owned-conversation-consent' && body.enabled !== false && supervisor.launcherProfile === 'production'
        && getApplicationVersion?.() && config?.releaseVersion !== getApplicationVersion()) throw new Error('Owned conversation recording is waiting for the safe runtime switch');
    if (!config || !await supervisor.ownedAgentRuntimeReady(config, { allowDraining })) throw new Error('Start the current NEKODEX runtime to use conversation history');
    const receipt = await supervisor.control(config, 'conversation-history', { body });
    if (!receipt || receipt.ok !== true) throw new Error(receipt?.error || 'History operation failed');
    if (enabling) await afterRecordingConsent?.(body, receipt.value, consentAttempt);
    return projectRecordingStatus ? projectRecordingStatus(body, receipt.value) : receipt.value;
  };
  handle('launcher:conversation-history', requestHistory);
  handle('launcher:conversation-history-revoke', (_event, body) => {
    const ownedRevoke = body?.action === 'owned-conversation-revoke' && typeof body.conversationId === 'string'
      && Object.keys(body).sort().join(',') === 'action,conversationId';
    if (!ownedRevoke && (!body || body.enabled !== false || !['set-recording', 'owned-native-consent', 'transcript-native-consent', 'canonical-consent', 'owned-conversation-consent'].includes(body.action))) throw new Error('This history action only revokes recording');
    return requestHistory(_event, body);
  });
  handle('launcher:conversation-history-copy', async (_event, text) => {
    if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 8 * 1024 * 1024) throw new Error('History copy exceeds the text limit');
    clipboard.writeText(text); return { copied: true };
  });
  handle('launcher:conversation-history-save', async (_event, markdown) => {
    if (typeof markdown !== 'string' || Buffer.byteLength(markdown, 'utf8') > 8 * 1024 * 1024) throw new Error('History export exceeds the text limit');
    const result = await dialog.showSaveDialog({ title: 'Save selected conversation text', defaultPath: 'nekodex-conversation.md', filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (result.canceled || !result.filePath) return { saved: false };
    await fs.writeFile(result.filePath, markdown, { encoding: 'utf8', mode: 0o600 });
    await fs.chmod(result.filePath, 0o600);
    return { saved: true, path: result.filePath };
  });
}
module.exports = { registerConversationHistory };
