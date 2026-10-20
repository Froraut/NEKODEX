'use strict';
// Trusted main producer only. One optional text-capture observer; never an inference sender.
const { randomUUID, createHash } = require('node:crypto');
const { classifyCanonicalText } = require('./canonical-history-policy.cjs');
const { canonical } = require('./owned-native-admission.cjs');
const SCOPE_KEYS = ['kind', 'mode', 'conversationId', 'threadId', 'sourceId', 'profileId', 'backendAccountId', 'authEpoch', 'serverGeneration', 'workerBindingId', 'workerGeneration'];
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f]/.test(value);
const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
const fail = () => { throw new Error('Current owned text transcript source is unavailable'); };
function scopeOf(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== SCOPE_KEYS.length
    || !SCOPE_KEYS.every(key => Object.hasOwn(input, key)) || input.kind !== 'owned-conversation' || input.mode !== 'canonical-text-v1'
    || !/^[a-f0-9]{64}$/.test(input.sourceId) || !Number.isSafeInteger(input.workerGeneration) || input.workerGeneration < 1
    || !SCOPE_KEYS.filter(key => !['kind', 'mode', 'workerGeneration', 'sourceId'].includes(key)).every(key => id(input[key]))) fail();
  return structuredClone(input);
}
function createOwnedNativeTranscriptProducer({ history, resolveScope, maxQueuedBytes = 384 * 1024, maxQueuedEvents = 100 } = {}) {
  if (!history || !['begin', 'record', 'release'].every(key => typeof history[key] === 'function') || typeof resolveScope !== 'function'
    || !Number.isSafeInteger(maxQueuedBytes) || maxQueuedBytes < 1024 || maxQueuedBytes > 512 * 1024
    || !Number.isSafeInteger(maxQueuedEvents) || maxQueuedEvents < 1 || maxQueuedEvents > 128) fail();
  const sources = new Map(), captures = new Map(), admitting = new Set(), conversationDenials = new Map();
  const producerInstanceId = randomUUID(); let closed = false, pending = 0, authorityRevision = 0, globallyDenied = false;
  function current(scope) { try { return !closed && canonical(scopeOf(resolveScope(scope))) === canonical(scope); } catch { return false; } }
  function source(scope) {
    const key = canonical(scope); let value = sources.get(key);
    if (!value) { if (sources.size >= 128) fail(); value = { scope, captureEpoch: randomUUID(), cursor: 0, revisions: new Map(), gaps: 0, reason: null, authorityRevision: 0, denied: false, allowedGlobalRevision: -1 }; sources.set(key, value); }
    return value;
  }
  function conversationState(conversationId) { if (!id(conversationId)) fail(); let row = conversationDenials.get(conversationId); if (!row) { if (conversationDenials.size >= 128) fail(); row = {revision:0,denied:false}; conversationDenials.set(conversationId,row); } return row; }
  function recordingAuthority(input) {
    const scope = input === undefined ? null : scopeOf(input), state = scope ? source(scope) : null, conversation = scope ? conversationState(scope.conversationId) : null;
    return Object.freeze({producerInstanceId,globalRevision:authorityRevision,scopeDigest:scope ? hash(scope) : null,sourceRevision:state?.authorityRevision ?? null,conversationId:scope?.conversationId ?? null,conversationRevision:conversation?.revision ?? null});
  }
  function recordingAuthorityForConversation(conversationId, initialAuthority) {
    const initial = initialAuthority ?? recordingAuthority();
    if (initial.producerInstanceId !== producerInstanceId || initial.scopeDigest !== null || initial.conversationId !== null) fail();
    return Object.freeze({...initial,conversationId,conversationRevision:conversationState(conversationId).revision});
  }
  function recordingStatus(conversationId) {
    if (!id(conversationId)) fail();
    const conversation = conversationDenials.get(conversationId), active = [...sources.values()].filter(row=>row.scope.conversationId===conversationId && current(row.scope));
    const reason = conversation?.denied === true ? 'conversation-locally-revoked' : active.some(row=>row.denied) ? 'source-locally-revoked' : globallyDenied && !active.some(row=>row.allowedGlobalRevision===authorityRevision) ? 'global-recording-locally-revoked' : null;
    return {conversationId,locallyDenied:reason !== null,reason};
  }
  function provenance(capture, item) {
    return { actionId: capture.actionId, nativeActionId: capture.nativeActionId, serverGeneration: capture.scope.serverGeneration,
      workerBindingId: capture.scope.workerBindingId, workerGeneration: capture.scope.workerGeneration, messageId: item.messageId,
      turnId: item.turnId, threadId: capture.scope.threadId, timestampMs: item.timestampMs };
  }
  function startPump(capture) {
    if (capture.pump) return capture.pump;
    capture.pump = Promise.resolve().then(async () => {
      while (capture.queue.length && !capture.closed) {
        const row = capture.queue.shift(); capture.queuedBytes -= row.bytes;
        if (!current(capture.scope)) { capture.source.reason = 'source-changed'; capture.source.gaps++; capture.queue = []; capture.queuedBytes = 0; return; }
        pending++;
        try {
          const result = await history.record({ lease: capture.lease, scope: capture.scope, provenance: row.provenance, event: row.event });
          if (result && ['revoked', 'disabled', 'quota-reached', 'unavailable'].includes(result.outcome)) {
            capture.source.reason = result.outcome; capture.source.gaps++; capture.accepting = false; capture.queue = []; capture.queuedBytes = 0;
          }
        } catch { capture.source.reason = 'capture-observation-unavailable'; capture.source.gaps++; capture.accepting = false; capture.queue = []; capture.queuedBytes = 0; }
        finally { pending--; }
      }
    }).finally(() => { capture.pump = null; if (capture.queue.length && !capture.closed) void startPump(capture); });
    return capture.pump;
  }
  function enqueue(capture, event, proof) {
    const bytes = Buffer.byteLength(JSON.stringify(event));
    if (capture.queue.length >= maxQueuedEvents || capture.queuedBytes + bytes > maxQueuedBytes) {
      capture.source.gaps++; capture.source.reason = 'source-buffer-limit';
      const tail = capture.queue.at(-1);
      if (tail?.event.kind === 'gap') tail.event.cursor = event.cursor;
      else { const gap = { kind: 'gap', cursor: event.cursor, reason: 'source-buffer-limit' }; capture.queue.push({ event: gap, provenance: proof, bytes: 0 }); }
    } else { capture.queue.push({ event, provenance: proof, bytes }); capture.queuedBytes += bytes; }
    void startPump(capture);
  }
  return Object.freeze({
    async begin(input) {
      if (!input || Object.keys(input).some(key => !['scope', 'actionId', 'nativeActionId', 'enableConsent', 'requireCapture', 'expectedAuthority'].includes(key)) || !id(input.actionId) || !id(input.nativeActionId) || input.requireCapture !== undefined && typeof input.requireCapture !== 'boolean' || input.enableConsent !== undefined && (!input.enableConsent || Object.keys(input.enableConsent).sort().join(',') !== 'acknowledgeUnknownSecrets,consent' || input.enableConsent.consent !== true || input.enableConsent.acknowledgeUnknownSecrets !== true)) fail();
      if (input.enableConsent && (!input.expectedAuthority || input.expectedAuthority.producerInstanceId !== producerInstanceId || input.expectedAuthority.globalRevision !== authorityRevision)) fail();
      const scope = scopeOf(input.scope); if (!current(scope)) { if (input.requireCapture) fail(); return null; }
      const state = source(scope), conversation = conversationState(scope.conversationId);
      if (input.enableConsent && (input.expectedAuthority.conversationId !== scope.conversationId || input.expectedAuthority.conversationRevision !== conversation.revision)) fail();
      const revision = authorityRevision, sourceRevision = state.authorityRevision, conversationRevision = conversation.revision;
      if ((state.denied || conversation.denied || globallyDenied && state.allowedGlobalRevision !== authorityRevision) && !input.enableConsent) { state.reason = 'locally-revoked'; if (input.requireCapture) fail(); return null; }
      pending++; let admitted;
      const admission = { scope, promise: Promise.resolve().then(() => history.begin({ scope, actionId: input.actionId, nativeActionId: input.nativeActionId, afterCursor: state.cursor, captureEpoch: state.captureEpoch, ...(input.enableConsent ? { enableConsent: input.enableConsent } : {}) })) };
      admitting.add(admission);
      try { admitted = await admission.promise; }
      catch { state.reason = 'capture-admission-unavailable'; if (input.requireCapture) fail(); return null; }
      finally { pending--; admitting.delete(admission); }
      if (!admitted?.lease) { if (input.requireCapture) fail(); return null; }
      if (!current(scope) || revision !== authorityRevision || sourceRevision !== state.authorityRevision || conversationRevision !== conversation.revision) { try { await history.release(admitted.lease); } catch {} state.reason = 'source-changed'; if (input.requireCapture) fail(); return null; }
      if (input.enableConsent) { conversation.denied = false; state.denied = false; state.allowedGlobalRevision = authorityRevision; state.reason = null; }
      const capture = { id: randomUUID(), scope, source: state, actionId: input.actionId, nativeActionId: input.nativeActionId,
        lease: structuredClone(admitted.lease), accepting: true, closed: false, queue: [], queuedBytes: 0, pump: null };
      captures.set(capture.id, capture); return Object.freeze({ id: capture.id });
    },
    observe(handle, notification) {
      const capture = captures.get(handle?.id); if (!capture || !capture.accepting || capture.closed) return;
      const item = notification?.item;
      if (!current(capture.scope) || notification.actionId !== capture.nativeActionId || notification.threadId !== capture.scope.threadId
        || !item || !id(item.messageId) || !id(item.turnId) || !['user', 'assistant'].includes(item.role) || typeof item.text !== 'string'
        || Buffer.byteLength(item.text) > 128 * 1024 || !Number.isSafeInteger(item.timestampMs) || item.timestampMs < 0
        || item.phase != null && !['commentary', 'final_answer'].includes(item.phase)) {
        capture.source.gaps++; capture.source.reason = 'canonical-source-mismatch'; capture.accepting = false;
        if (current(capture.scope)) enqueue(capture, {kind:'gap',cursor:++capture.source.cursor,reason:'canonical-source-mismatch'}, capture.lastProvenance);
        return;
      }
      const exclusionReason = /"protocol"\s*:\s*"neko-agent-v1"/u.test(item.text) ? 'generated-instructions-or-schema' : classifyCanonicalText(item.text), text = exclusionReason ? '' : item.text;
      const attribution = item.authorship === 'direct-user' ? 'direct-human' : item.authorship === 'automatic-host' ? 'automatic-host' : item.authorship === 'native-assistant' ? 'assistant' : 'unknown';
      const projection = { itemId: item.messageId, turnId: item.turnId, role: item.role, attribution, text, timestampMs: item.timestampMs,
        phase: item.phase ?? null, originalBytes: Buffer.byteLength(item.text), exclusionReason, coverage: item.imageAttachments?.length ? 'partial' : 'complete',
        ...(item.imageAttachments?.length ? { coverageReason: 'native-nontext-content-excluded' } : {}) };
      const sourceRevision = hash(projection), prior = capture.source.revisions.get(item.messageId);
      if (prior?.sourceRevision === sourceRevision) return;
      if (!prior && capture.source.revisions.size >= 10000) { capture.source.gaps++; capture.source.reason = 'source-item-limit'; capture.accepting = false; enqueue(capture, {kind:'gap',cursor:++capture.source.cursor,reason:'source-item-limit'}, provenance(capture,item)); return; }
      const revisionNumber = (prior?.revisionNumber ?? 0) + 1;
      capture.source.revisions.set(item.messageId, { sourceRevision, revisionNumber });
      const event = { kind: 'upsert', cursor: ++capture.source.cursor, sourceRevision, revisionNumber, ...projection };
      capture.lastProvenance = provenance(capture, item); enqueue(capture, event, capture.lastProvenance);
    },
    async release(handle) {
      const capture = captures.get(handle?.id); if (!capture) return;
      capture.accepting = false;
      while (capture.pump) await capture.pump;
      capture.closed = true; capture.queue = []; captures.delete(capture.id);
      try { await history.release(capture.lease); } catch { capture.source.reason = 'capture-release-unavailable'; }
    },
    async revoke(input) {
      const scope = input === undefined ? null : scopeOf(input);
      if (scope === null) { authorityRevision++; globallyDenied = true; } else { const state = source(scope), conversation = conversationState(scope.conversationId); conversation.revision++; conversation.denied = true; state.authorityRevision++; state.denied = true; state.reason = 'locally-revoked'; }
      const pendingAdmissions = [...admitting].filter(row => scope === null || canonical(scope) === canonical(row.scope));
      const selected = [...captures.values()].filter(capture => scope === null || canonical(scope) === canonical(capture.scope));
      for (const capture of selected) { capture.accepting = false; capture.closed = true; capture.queue = []; capture.queuedBytes = 0; capture.source.reason = 'revoked'; captures.delete(capture.id); }
      await Promise.allSettled([...selected.map(capture => history.release(capture.lease)), ...pendingAdmissions.map(row => row.promise)]);
    },
    recordingAuthority, recordingAuthorityForConversation, recordingStatus,
    async revokeConversation(conversationId) {
      const conversation = conversationState(conversationId); conversation.revision++; conversation.denied = true;
      const affected = [...sources.values()].filter(row=>row.scope.conversationId===conversationId);
      await Promise.all(affected.map(row=>this.revoke(row.scope)));
    },
    allowRecording(input, expectedAuthority) {
      if (closed || !expectedAuthority || canonical(recordingAuthority(input)) !== canonical(expectedAuthority)) fail();
      if (input === undefined) globallyDenied = false;
      else { const scope = scopeOf(input); if (!current(scope)) fail(); const state = source(scope); conversationState(scope.conversationId).denied = false; state.denied = false; state.allowedGlobalRevision = authorityRevision; state.reason = null; }
    },
    status() { return { activeCount: captures.size, pendingCount: pending, globallyDenied, conversations:[...conversationDenials.keys()].map(recordingStatus), sources: [...sources.values()].map(row => ({ scope: structuredClone(row.scope), captureEpoch: row.captureEpoch, cursor: row.cursor, gaps: row.gaps, reason: row.reason, locallyDenied: row.denied || conversationDenials.get(row.scope.conversationId)?.denied === true || globallyDenied && row.allowedGlobalRevision !== authorityRevision })), closed }; },
    currentOperation() { return pending ? 'Owned conversation transcript observation' : null; },
    async close() { closed = true; authorityRevision++; const admissions = [...admitting]; const selected = [...captures.values()]; for (const capture of selected) { capture.accepting = false; capture.closed = true; capture.queue = []; captures.delete(capture.id); } await Promise.allSettled([...selected.flatMap(capture => [capture.pump, history.release(capture.lease)]), ...admissions.map(row => row.promise)].filter(Boolean)); },
  });
}
module.exports = { createOwnedNativeTranscriptProducer, validateOwnedConversationScope: scopeOf };
