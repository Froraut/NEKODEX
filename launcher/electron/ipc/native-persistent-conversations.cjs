'use strict';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEYS = {
  snapshot: ['action', 'actionId', 'archiveCursor'],
  create: ['action', 'actionId', 'model', 'text', 'retainContext', 'expectedContext', 'conversationMode', 'recordFutureText'],
  send: ['action', 'actionId', 'conversationId', 'revision', 'text', 'expectedContext'],
  fork: ['action', 'actionId', 'conversationId', 'revision', 'expectedContext', 'lastTurnId'],
  closeIdle: ['action', 'actionId', 'conversationId', 'revision', 'expectedContext'],
  stop: ['action', 'actionId', 'conversationId', 'revision', 'expectedContext'],
  archive: ['action', 'actionId', 'conversationId', 'revision', 'expectedContext'],
  resume: ['action', 'actionId', 'conversationId', 'revision', 'expectedContext'],
};
const invalid = () => Object.assign(new Error('Invalid persistent Native conversation request'), { code: 'invalid_request' });

/** Main receives intent and opaque identities only. No paths, credentials or raw RPC. */
function registerPersistentNativeConversations({ handle, getService, getContext }) {
  const projectAction = row => ({ actionId: row.actionId, kind: row.kind,
    ...(row.conversationId ? { conversationId: row.conversationId } : {}), state: row.state,
    ...(row.ownerHeld === true ? { ownerHeld: true } : {}),
    ...(row.reasonCode ? { reasonCode: row.reasonCode } : {}),
    ...(['completed', 'failed', 'interrupted'].includes(row.nativeStatus) ? { nativeStatus: row.nativeStatus } : {}) });
  const snapshot = async (value, actionId, archiveCursor) => {
    const source = value || await getService().list({ archiveCursor });
    const context = getContext();
    const observed = actionId ? getService().inspectAction(actionId) : undefined;
    const projectConversation = row => ({
        id: row.id, revision: row.revision, threadId: row.threadId, model: row.model,
        status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt,
        ...(row.parentId ? { parentId: row.parentId } : {}),
        conversationMode: row.conversationMode === 'canonical-text-v1' ? 'canonical-text-v1' : 'neko-json-v1',
        ...(row.conversationMode !== 'canonical-text-v1' && typeof row.lastSummary === 'string' ? { lastSummary: row.lastSummary } : {}),
        ...(row.conversationMode === 'canonical-text-v1' && typeof row.lastTextPreview === 'string'
          ? { lastTextPreview: row.lastTextPreview.slice(0, 2048), lastTextTruncated: row.lastTextTruncated === true || row.lastTextPreview.length > 2048 } : {}),
        ...(row.recordingRequiredBeforeFirstSend === true ? { recordingRequiredBeforeFirstSend: true } : {}),
        ...(typeof row.lastTurnId === 'string' && row.lastTurnId.length > 0 && row.lastTurnId.length <= 128 && !/[\u0000-\u001f]/.test(row.lastTurnId)
          ? { lastTurnId: row.lastTurnId } : {}),
        ...(row.archivedAt ? { archivedAt: row.archivedAt } : {}),
        stopAvailable: row.stopAvailable === true, stopReason: typeof row.stopReason === 'string' ? row.stopReason : null,
        archiveAvailable: row.archiveAvailable === true, archiveReason: typeof row.archiveReason === 'string' ? row.archiveReason : null,
        ownerAvailable: row.ownerAvailable === true,
        resumeAvailable: row.resumeAvailable === true,
        ...(typeof row.resumeReason === 'string' ? { resumeReason: row.resumeReason } : {}),
    });
    const result = {
      available: Boolean(context), profileId: context?.profileId || null, epoch: context?.epoch || null,
      serverGeneration: context?.serverGeneration || null,
      models: (context?.models || []).map(model => ({ id: model.id, ...(model.label ? { label: model.label } : {}) })),
      conversations: source.conversations.map(projectConversation),
      archivedConversations: (source.archivedConversations || []).map(projectConversation),
      archivedCount: source.archivedCount || 0, archivedConversationIds: source.archivedConversationIds || [],
      archiveNextCursor: source.archiveNextCursor || null, quota: source.quota,
      actions: source.actions.map(projectAction),
      ...(observed ? { observedAction: projectAction(observed) } : {}),
      busy: source.busy === true, retention: 'explicit-native-context', resumeSupported: source.resumeSupported === true,
    };
    if (Buffer.byteLength(JSON.stringify(result)) > 2 * 1024 * 1024) throw Object.assign(new Error('Native snapshot exceeds its bound'), { code: 'response_too_large' });
    return result;
  };
  handle('launcher:native-persistent-conversations', async (_event, body) => {
    let invoked = false;
    try {
      if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.hasOwn(KEYS, body.action)
        || Object.keys(body).some(key => !KEYS[body.action].includes(key))
        || Buffer.byteLength(JSON.stringify(body)) > 34 * 1024) throw invalid();
      if (body.action === 'snapshot') {
        if (body.actionId !== undefined && !UUID.test(body.actionId) || body.archiveCursor !== undefined && !UUID.test(body.archiveCursor)) throw invalid();
        return { ok: true, value: await snapshot(undefined, body.actionId, body.archiveCursor) };
      }
      if (!UUID.test(body.actionId)) throw invalid();
      const expected = body.expectedContext;
      if (!expected || typeof expected !== 'object' || Array.isArray(expected)
        || Object.keys(expected).some(key => !['profileId', 'epoch', 'serverGeneration'].includes(key))
        || !UUID.test(expected.profileId) || !UUID.test(expected.epoch) || !UUID.test(expected.serverGeneration)) throw invalid();
      const current = getContext();
      if (!current || ['profileId', 'epoch', 'serverGeneration'].some(key => current[key] !== expected[key])) {
        throw Object.assign(new Error('Native account context changed'), { code: 'context_changed' });
      }
      if (body.action === 'create') {
        if (body.retainContext !== true || typeof body.model !== 'string' || !body.model || body.model.length > 200) throw invalid();
        if (body.conversationMode !== undefined && !['neko-json-v1', 'canonical-text-v1'].includes(body.conversationMode)) throw invalid();
        if (body.recordFutureText !== undefined && (body.conversationMode !== 'canonical-text-v1' || !body.recordFutureText
          || typeof body.recordFutureText !== 'object' || Array.isArray(body.recordFutureText)
          || Object.keys(body.recordFutureText).sort().join(',') !== 'acknowledgeUnknownSecrets,consent'
          || body.recordFutureText.consent !== true || body.recordFutureText.acknowledgeUnknownSecrets !== true)) throw invalid();
      } else if (!UUID.test(body.conversationId) || !Number.isSafeInteger(body.revision) || body.revision < 0) throw invalid();
      if (body.lastTurnId !== undefined && (body.action !== 'fork' || typeof body.lastTurnId !== 'string' || !body.lastTurnId
        || body.lastTurnId.length > 128 || /[\u0000-\u001f]/.test(body.lastTurnId))) throw invalid();
      if (['create', 'send'].includes(body.action) && (typeof body.text !== 'string' || !body.text.trim()
        || Buffer.byteLength(body.text) > 32 * 1024 || body.text.includes('\0'))) throw invalid();
      const { action, ...intent } = body;
      const service = getService();
      invoked = true;
      const value = await service[action](intent);
      return { ok: true, value: await snapshot(value, body.actionId) };
    } catch (reason) {
      // Provider exceptions and source paths never become presentation text.
      const code = typeof reason?.code === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(reason.code)
        ? reason.code : 'native_conversation_unavailable';
      return { ok: false, error: { code, knownNotStarted: !invoked || reason?.actionRecorded === false,
        ...(reason?.nativeTurnNotStarted === true ? { nativeTurnNotStarted: true } : {}),
        message: 'The Native conversation action was not confirmed. Inspect its current state before sending another action.' } };
    }
  });
}
module.exports = { registerPersistentNativeConversations };
