'use strict';
const { randomBytes, randomUUID, createHash } = require('node:crypto');
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => plain(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const identity = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
const fail = () => { throw new Error('External Loop producer action unavailable; inspect status and retained receipts before another action'); };
/** Main alone generates/copies submission secrets. Core receives only a hash.
 * The generic Agent-mode renderer proxy must never be redirected to this route. */
function createAgentLoopProducerController({ runtimeHost, clipboard, getApplicationVersion }) {
  const reviews = new Map(), attempts = new Map(); let mutation = false, closed = false;
  async function core(body) {
    if (closed) fail();
    const supervisor = runtimeHost.supervisor, config = supervisor.readConfig();
    const cleanup = ['status', 'revoke', 'action-receipt'].includes(body.action);
    const version = getApplicationVersion?.();
    if (!cleanup && supervisor.launcherProfile === 'production' && config?.releaseVersion && version && config.releaseVersion !== version) {
      throw new Error('This external Loop producer action requires the automatic safe runtime switch; existing work continues');
    }
    const captured = JSON.stringify(config);
    if (!config || !await supervisor.ownedAgentRuntimeReady(config, { allowDraining: cleanup })) fail();
    if (closed || JSON.stringify(supervisor.readConfig()) !== captured) fail();
    const result = await supervisor.control(config, 'agent-loop-producers', { body, returnErrorReceipt: true });
    if (result?.ok !== true) fail();
    const value = result.value;
    // Raw secrets never come back from core. Reject future protocol drift rather than forwarding it.
    const encoded = JSON.stringify(value);
    if (Buffer.byteLength(encoded) > 2 * 1024 * 1024 || /nk-loop-[a-f0-9]{64}/.test(encoded)
      || /"(?:credentialHash|registrationFingerprint|rotationActions|token|secret)"\s*:/.test(encoded)) fail();
    if (plain(value?.status)) {
      if (!Number.isSafeInteger(config.port) || config.port < 1 || config.port > 65535) fail();
      return { ...value, status: { ...value.status, origin: `http://127.0.0.1:${config.port}` } };
    }
    return value;
  }
  const status = async taskId => { const result = await core({ action: 'status', ...(taskId ? { taskId } : {}) }); if (!Array.isArray(result?.status?.rows)) fail(); return { status: result.status, credentialCopied: false }; };
  async function request(body) {
    if (!plain(body) || Buffer.byteLength(JSON.stringify(body)) > 16 * 1024) fail();
    if (body.action === 'status' && (exact(body, ['action']) || exact(body, ['action', 'taskId']) && identity(body.taskId))) return status(body.taskId);
    if (body.action === 'revoke' && exact(body, ['action', 'producerId', 'explicitUserAction']) && body.explicitUserAction === true && identity(body.producerId)) {
      const result = await core(body); return { status: result.status, credentialCopied: false };
    }
    if (mutation || closed || body.explicitUserAction !== true) fail(); mutation = true;
    try {
      if (body.action === 'review' && exact(body, ['action', 'taskId', 'scope', 'label', 'instruction', 'eventBound', 'explicitUserAction'])) {
        const value = await core(body); if (!plain(value.review) || !plain(value.review.authority)) fail();
        if (reviews.size >= 512) fail();
        const review = { ...value.review, reviewId: randomUUID(), reviewDigest: hash(value.review) }; reviews.set(review.reviewId, review);
        return { ...(await status(body.taskId)), review };
      }
      if (!identity(body.actionId)) fail();
      if (!['register', 'rotate'].includes(body.action)) fail();
      const fingerprint = hash(body), prior = attempts.get(body.actionId);
      if (prior) {
        if (prior.fingerprint !== fingerprint) fail();
        const result = await core({ action: 'action-receipt', actionId: body.actionId });
        if (result?.found !== true || !result.status) fail();
        return { status: result.status, credentialCopied: false, ...(body.action === 'register' ? { created: false } : { rotated: false }) };
      }
      let payload;
      if (body.action === 'register' && exact(body, ['action', 'reviewId', 'reviewDigest', 'actionId', 'explicitUserAction'])) {
        const review = reviews.get(body.reviewId); if (!review || review.reviewDigest !== body.reviewDigest) fail();
        payload = { action: 'register', actionId: body.actionId, taskId: review.taskId, scope: review.scope, runId: review.authority.runId,
          label: review.label, instruction: review.instruction, eventBound: review.eventBound, explicitUserAction: true };
      } else if (body.action === 'rotate' && exact(body, ['action', 'producerId', 'actionId', 'explicitUserAction']) && identity(body.producerId)) payload = body;
      else fail();
      if (attempts.size >= 512) fail();
      const token = 'nk-loop-' + randomBytes(32).toString('hex');
      attempts.set(body.actionId, { fingerprint });
      const result = await core({ ...payload, credentialHash: hash(token) });
      if (closed) fail();
      const changed = body.action === 'register' ? result.created === true : result.rotated === true;
      if (changed) {
        try { clipboard.writeText(token); }
        catch { throw new Error('Producer credential was registered but could not be copied; inspect status and explicitly Rotate to replace it'); }
      }
      if (body.action === 'register') reviews.delete(body.reviewId);
      return { status: result.status, credentialCopied: changed,
        ...(body.action === 'register' ? { created: changed } : { rotated: changed }) };
    } finally { mutation = false; }
  }
  return Object.freeze({ request, currentOperation: () => mutation ? 'External Loop producer registration or credential copy' : null,
    close() { closed = true; reviews.clear(); attempts.clear(); } });
}
function registerAgentLoopProducers({ handle, ...options }) {
  const controller = createAgentLoopProducerController(options);
  handle('launcher:loop-producers', (_event, body) => controller.request(body)); return controller;
}
module.exports = { registerAgentLoopProducers, createAgentLoopProducerController };
