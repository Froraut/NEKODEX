'use strict';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEYS = {
  snapshot: ['action', 'actionId'],
  create: ['action', 'actionId', 'model', 'text', 'retainContext', 'expectedContext'],
  send: ['action', 'actionId', 'conversationId', 'revision', 'text', 'expectedContext'],
  fork: ['action', 'actionId', 'conversationId', 'revision', 'expectedContext'],
};
const invalid = () => Object.assign(new Error('Invalid persistent Native conversation request'), { code: 'invalid_request' });

/** Main receives intent and opaque identities only. No paths, credentials or raw RPC. */
function registerPersistentNativeConversations({ handle, getService, getContext }) {
  const projectAction = row => ({ actionId: row.actionId, kind: row.kind,
    ...(row.conversationId ? { conversationId: row.conversationId } : {}), state: row.state,
    ...(row.reasonCode ? { reasonCode: row.reasonCode } : {}) });
  const snapshot = async (value, actionId) => {
    const source = value || await getService().list();
    const context = getContext();
    const observed = actionId ? getService().inspectAction(actionId) : undefined;
    const result = {
      available: Boolean(context), profileId: context?.profileId || null, epoch: context?.epoch || null,
      serverGeneration: context?.serverGeneration || null,
      models: (context?.models || []).map(model => ({ id: model.id, ...(model.label ? { label: model.label } : {}) })),
      conversations: source.conversations.map(row => ({
        id: row.id, revision: row.revision, threadId: row.threadId, model: row.model,
        status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt,
        ...(row.parentId ? { parentId: row.parentId } : {}),
        ...(typeof row.lastSummary === 'string' ? { lastSummary: row.lastSummary } : {}),
        ownerAvailable: row.ownerAvailable === true,
      })),
      actions: source.actions.map(projectAction),
      ...(observed ? { observedAction: projectAction(observed) } : {}),
      busy: source.busy === true, retention: 'explicit-native-context', resumeSupported: false,
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
        if (body.actionId !== undefined && !UUID.test(body.actionId)) throw invalid();
        return { ok: true, value: await snapshot(undefined, body.actionId) };
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
      } else if (!UUID.test(body.conversationId) || !Number.isSafeInteger(body.revision) || body.revision < 0) throw invalid();
      if (body.action !== 'fork' && (typeof body.text !== 'string' || !body.text.trim()
        || Buffer.byteLength(body.text) > 32 * 1024 || body.text.includes('\0'))) throw invalid();
      const { action, ...intent } = body;
      const service = getService();
      invoked = true;
      const value = await service[action](intent);
      return { ok: true, value: await snapshot(value) };
    } catch (reason) {
      // Provider exceptions and source paths never become presentation text.
      const code = typeof reason?.code === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(reason.code)
        ? reason.code : 'native_conversation_unavailable';
      return { ok: false, error: { code, knownNotStarted: !invoked || reason?.actionRecorded === false,
        message: 'The Native conversation action was not confirmed. Inspect its current state before sending another action.' } };
    }
  });
}
module.exports = { registerPersistentNativeConversations };
