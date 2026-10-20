'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { canonical, digest, fail, privateDirectory, regular } = require('./owned-native-admission.cjs');
const { uuid } = require('./owned-native-journal.cjs');
const { PERSISTENT_NATIVE_FINAL_SCHEMA: FINAL_SCHEMA } = require('./owned-native-worker.cjs');
const { isAgentNativeHistorySource } = require('./agent-native-protocol.cjs');
const textInput = value => {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > 32768 || value.includes('\0')) throw fail('invalid_intent', 'Provide nonempty conversation text of at most 32 KiB');
  return value;
};
/** Main-only. Native retains full context by explicit consent; this registry contains
 * ownership/receipts and the last summary only, never credentials or raw rollouts. */
function createPersistentNativeConversations({ getExecution, storageRoot, storagePath, onChange, transcript } = {}) {
  if (typeof getExecution !== 'function' || !path.isAbsolute(storagePath || storageRoot || '')) throw fail('invalid_configuration', 'Persistent Native conversations require an existing main account owner');
  const file = storagePath || path.join(storageRoot, 'registry.json'), directory = path.dirname(file), lock = path.join(directory, 'owner.lock');
  const owner = JSON.stringify({ pid: process.pid, nonce: randomUUID() });
  const live = new Map();
  let owned = false, lastDigest, destroyed = false, closing;
  const operations = new Set();
  const pending = new Set();
  let state;
  try {
    const bytes = regular(file, 4 * 1024 * 1024); lastDigest = digest(bytes); state = JSON.parse(bytes);
    if (![1, 2].includes(state.version) || !Array.isArray(state.conversations) || !Array.isArray(state.actions) || state.conversations.length > 128 || state.actions.length > 512) throw new Error();
    for (const row of state.conversations) { uuid(row.id); uuid(row.profileId); uuid(row.epoch); uuid(row.serverGeneration); if (!Number.isSafeInteger(row.revision) || row.revision < 0) throw new Error(); }
    for (const row of state.actions) { uuid(row.actionId); uuid(row.conversationId); }
  } catch (reason) {
    if (reason.code !== 'ENOENT') throw fail('registry_unavailable', 'Persistent Native registry is unavailable');
    state = { version: 2, conversations: [], actions: [], selected: null };
  }
  const notify = () => { try { onChange?.(); } catch {} };
  function acquire() {
    if (owned) return;
    privateDirectory(directory);
    try { fs.writeFileSync(lock, owner, { flag: 'wx', mode: 0o600 }); }
    catch { throw fail('owner_exists', 'Persistent Native registry already has an owner; reconcile it before reuse'); }
    owned = true;
  }
  function save() {
    acquire();
    state.version = 2;
    if (regular(lock, 4096).toString() !== owner) throw fail('owner_changed', 'Persistent Native registry owner changed');
    let observed;
    try { observed = digest(regular(file, 4 * 1024 * 1024)); } catch (reason) { if (reason.code !== 'ENOENT') throw reason; }
    if (observed !== lastDigest) throw fail('registry_changed', 'Persistent Native registry changed outside its owner');
    const bytes = `${JSON.stringify(state)}\n`;
    if (Buffer.byteLength(bytes) > 4 * 1024 * 1024) throw fail('registry_quota', 'Persistent Native registry quota reached');
    const tmp = path.join(directory, `${randomUUID()}.tmp`); let fd;
    try {
      fd = fs.openSync(tmp, 'wx', 0o600); fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      fs.renameSync(tmp, file); const dir = fs.openSync(directory, 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
      lastDigest = digest(bytes);
    } finally { if (fd !== undefined) fs.closeSync(fd); fs.rmSync(tmp, { force: true }); }
    notify();
  }
  const sameScope = (row, context) => context && row.profileId === context.profileId && row.epoch === context.epoch && row.serverGeneration === context.serverGeneration;
  function resumeReason(row, context) {
    if (![2, 3].includes(row.contextVersion) || row.contextVersion === 3 && row.conversationMode !== 'canonical-text-v1' || !isAgentNativeHistorySource(row.historySource)) return 'legacy_identity_unproven';
    if (state.actions.some(action => action.conversationId === row.id && (['prepared', 'unknown'].includes(action.state) || action.ownerHeld === true))) return 'prior_outcome_unresolved';
    if (!row.threadId || !['idle', 'unloaded'].includes(row.status)) return 'retained_context_unavailable';
    if (!context || destroyed || !context.server.inspect().accepting) return 'account_owner_unavailable';
    if (row.profileId !== context.profileId || row.epoch !== context.epoch) return 'account_scope_changed';
    const model = context.models.find(value => value.id === row.model);
    if (!model || !isAgentNativeHistorySource(model.historySource) || canonical(model.historySource) !== canonical(row.historySource)) return 'account_identity_changed';
    if (sameScope(row, context) && live.has(row.id)) return 'already_loaded';
    return null;
  }
  function list() {
    const context = getExecution(), selected = context || state.selected;
    const conversations = state.conversations.filter(row => selected && row.profileId === selected.profileId && row.epoch === selected.epoch).map(row => {
      const worker = live.get(row.id), available = !destroyed && sameScope(row, context) && worker && !context.server.inspect().closed && context.server.inspect().accepting;
      return { id: row.id, revision: row.revision, threadId: row.threadId, model: row.model,
        status: available ? row.status : row.status === 'unloaded' ? 'unloaded' : 'unavailable', ownerAvailable: Boolean(available), createdAt: row.createdAt, updatedAt: row.updatedAt,
        resumeAvailable: resumeReason(row, context) === null, resumeReason: resumeReason(row, context),
        ...(row.parentId ? { parentId: row.parentId } : {}), ...(row.lastSummary ? { lastSummary: row.lastSummary } : {}), conversationMode: row.conversationMode ?? 'neko-json-v1',
        ...(row.lastTextPreview !== undefined ? { lastTextPreview: row.lastTextPreview, lastTextTruncated: row.lastTextTruncated === true } : {}),
        ...(typeof row.lastTurnId === 'string' ? { lastTurnId: row.lastTurnId } : {}), recordingRequiredBeforeFirstSend: row.requireCaptureUntilFirstSent === true };
    });
    const ids = new Set(conversations.map(row => row.id));
    return { conversations, actions: state.actions.filter(row => ids.has(row.conversationId)).map(row => ({ actionId: row.actionId, kind: row.kind,
      conversationId: row.conversationId, state: row.state, ownerHeld: row.ownerHeld === true, ...(row.reasonCode ? { reasonCode: row.reasonCode } : {}) })),
      busy: operations.size > 0, retention: 'explicit-native-context', resumeSupported: true };
  }
  function recordNative(action, row, receipt) {
    if (receipt.actionId !== action.turnActionId) return;
    if (row.revision !== action.revision || row.activeActionId !== action.actionId) return;
    action.nativeReceiptId = receipt.actionId; action.ownerHeld = receipt.ownerHeld;
    if (['acknowledged', 'completed'].includes(receipt.state) && receipt.turnId) row.requireCaptureUntilFirstSent = false;
    if (receipt.state === 'completed' && typeof receipt.turnId === 'string' && receipt.turnId.length > 0 && receipt.turnId.length <= 128) { action.turnId = receipt.turnId; row.lastTurnId = receipt.turnId; }
    if (receipt.state === 'completed' && row.conversationMode === 'canonical-text-v1') {
      const items = receipt.canonicalItems;
      const human = Array.isArray(items) && items.find(item => item.role === 'user' && item.authorship === 'direct-user' && item.turnId === receipt.turnId);
      const finals = Array.isArray(items) && items.filter(item => item.role === 'assistant' && item.authorship === 'native-assistant' && item.turnId === receipt.turnId && [null, undefined, 'final_answer'].includes(item.phase));
      if (!human || !finals.length || !finals.every(item => typeof item.text === 'string')) {
        action.state = 'failed'; action.reasonCode = 'canonical_text_unavailable'; row.status = 'unavailable';
      } else {
        action.state = 'completed'; delete action.reasonCode; row.status = 'idle';
        action.turnId = receipt.turnId;
        action.canonicalUser = { turnId: receipt.turnId, clientUserMessageId: receipt.clientUserMessageId, inputHash: receipt.inputHash };
        const text = finals.at(-1).text; row.lastTextPreview = text.slice(0, 2048); row.lastTextTruncated = text.length > 2048;
      }
    } else if (receipt.state === 'completed') {
      const result = receipt.structuredOutput;
      if (!result || result.kind !== 'final' || typeof result.summary !== 'string' || !result.summary.trim()) {
        action.state = 'failed'; action.reasonCode = 'invalid_final_result'; row.status = 'unavailable';
      } else {
        action.state = 'completed'; delete action.reasonCode; row.status = 'idle'; row.lastSummary = result.summary;
      }
    } else if (receipt.state === 'unknown' || receipt.state === 'failed') {
      action.state = receipt.state; action.reasonCode = receipt.reasonCode || 'native_outcome_unavailable'; row.status = receipt.state === 'unknown' ? 'unknown' : 'unavailable';
    }
    row.updatedAt = Date.now(); save();
  }
  function execute(kind, input) {
    let recorded = false;
    // Capture the initial intent ordering before account/thread creation awaits.
    const initialRecordingAuthority = input?.recordFutureText ? transcript?.recordingAuthority() : undefined;
    const run = async () => {
      const allowed = kind === 'create' ? ['actionId', 'model', 'text', 'retainContext', 'expectedContext', 'conversationMode', 'recordFutureText'] : kind === 'send' ? ['actionId', 'conversationId', 'revision', 'text', 'expectedContext'] : ['actionId', 'conversationId', 'revision', 'expectedContext', ...(kind === 'fork' ? ['lastTurnId'] : [])];
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) throw fail('invalid_intent', 'Unsupported persistent Native input');
      uuid(input.actionId);
      if (kind === 'create' && input.conversationMode !== undefined && !['neko-json-v1', 'canonical-text-v1'].includes(input.conversationMode)) throw fail('invalid_intent', 'Unsupported conversation text mode');
      if (input.recordFutureText !== undefined && (kind !== 'create' || input.conversationMode !== 'canonical-text-v1' || !input.recordFutureText || Object.keys(input.recordFutureText).sort().join(',') !== 'acknowledgeUnknownSecrets,consent' || input.recordFutureText.consent !== true || input.recordFutureText.acknowledgeUnknownSecrets !== true)) throw fail('invalid_intent', 'Explicit future text consent requires the new canonical text mode');
      if (input.lastTurnId !== undefined && (kind !== 'fork' || typeof input.lastTurnId !== 'string' || !input.lastTurnId || input.lastTurnId.length > 128 || /[\u0000-\u001f]/.test(input.lastTurnId))) throw fail('invalid_intent', 'Invalid exact fork turn');
      if (!input.expectedContext || Object.keys(input.expectedContext).sort().join(',') !== 'epoch,profileId,serverGeneration') throw fail('stale_account', 'Select the exact current account generation');
      for (const key of ['profileId', 'epoch', 'serverGeneration']) uuid(input.expectedContext[key]);
      const fingerprint = digest(canonical({ kind, input }));
      const old = state.actions.find(row => row.actionId === input.actionId);
      if (old) { recorded = true; if (old.fingerprint !== fingerprint) throw fail('intent_conflict', 'Persistent Native action identity changed'); return list(); }
      if (destroyed) throw fail('worker_busy', 'Persistent Native owner is unavailable');
      const context = getExecution();
      if (!context?.server || !context.server.inspect().accepting) throw fail('owner_unavailable', 'Open the selected qualified Native account first');
      uuid(context.profileId); uuid(context.epoch); uuid(context.serverGeneration);
      const assertContext = () => {
        const current = getExecution();
        if (!current || current.server !== context.server || destroyed || !['profileId', 'epoch', 'serverGeneration'].every(key => current[key] === input.expectedContext[key] && context[key] === input.expectedContext[key])) throw fail('stale_account', 'The selected Native account generation changed');
      };
      assertContext();
      let source;
      if (kind !== 'create') {
        uuid(input.conversationId); source = state.conversations.find(row => row.id === input.conversationId);
        if (!source || source.revision !== input.revision) throw fail('stale_conversation', 'Select the exact current conversation revision');
        if (input.lastTurnId !== undefined && !state.actions.some(action => action.conversationId === source.id && action.state === 'completed' && action.turnId === input.lastTurnId)) throw fail('invalid_intent', 'Fork point requires an exact completed owned turn');
        if (kind === 'resume') { const reason = resumeReason(source, context); if (reason) throw fail('resume_unavailable', reason); }
        else {
          if (!sameScope(source, context) || !live.has(source.id)) throw fail('owner_unavailable', 'This retained conversation has no current owner; explicitly Resume first');
          if (source.status !== 'idle') throw fail('stale_conversation', 'Select the current idle conversation revision');
          if (state.actions.some(action => action.conversationId === source.id && (['prepared', 'unknown'].includes(action.state) || action.ownerHeld === true))) throw fail('resume_unavailable', 'Prior conversation outcome is unresolved');
        }
      }
      if (kind === 'create' && input.retainContext !== true) throw fail('retention_consent_required', 'Explicit consent to retain full Native context is required');
      if (kind === 'create' || kind === 'send') textInput(input.text);
      const selectedModel = context.models.find(model => model.id === (source?.model || input.model));
      if (!selectedModel) throw fail('model_unavailable', 'Select a model from the current qualified account');
      if (!isAgentNativeHistorySource(selectedModel.historySource) || selectedModel.historySource.profileId !== context.profileId || selectedModel.historySource.authEpoch !== context.epoch) throw fail('account_identity_unavailable', 'Qualified Native account identity is required for retained context');
      if (state.actions.length >= 512 || ['create', 'fork'].includes(kind) && state.conversations.length >= 128) throw fail('registry_quota', 'Persistent Native registry quota reached');
      // A fork reserves its source too. Registry mutations remain synchronous under
      // one writer, while independent exact conversations can await Native together.
      const operationKey = source?.id || input.actionId;
      if (operations.has(operationKey)) throw fail('worker_busy', 'This persistent conversation already has an operation');
      operations.add(operationKey); notify();
      try {
        return await context.server.persistentOperation(async operation => {
          assertContext();
          // Account readiness yields; enforce the shared registry quota again at claim.
          if (state.actions.length >= 512 || ['create', 'fork'].includes(kind) && state.conversations.length >= 128) throw fail('registry_quota', 'Persistent Native registry quota reached');
          acquire();
          const makeResumedWorker = kind === 'resume' ? operation.prepareResume({ registryPath: file, conversationId: source.id, revision: source.revision }) : null;
          const now = Date.now(), conversationMode = kind === 'create' ? input.conversationMode ?? 'neko-json-v1' : source.conversationMode ?? 'neko-json-v1';
          const row = !['create', 'fork'].includes(kind) ? source : { id: randomUUID(), revision: 0, threadId: null, model: selectedModel.id,
            profileId: context.profileId, epoch: context.epoch, serverGeneration: context.serverGeneration, status: 'running', createdAt: now, updatedAt: now,
            contextVersion: conversationMode === 'canonical-text-v1' ? 3 : 2, conversationMode, requireCaptureUntilFirstSent: kind === 'create' && !!input.recordFutureText, historySource: structuredClone(selectedModel.historySource), forkedFromThreadId: kind === 'fork' ? source.threadId : null,
            ...(kind === 'fork' ? { parentId: source.id } : {}) };
          const firstRecordingAuthority = input.recordFutureText ? transcript?.recordingAuthorityForConversation(row.id, initialRecordingAuthority) : undefined;
          const action = { actionId: input.actionId, kind, fingerprint, conversationId: row.id, state: 'prepared', ownerHeld: false,
            createActionId: randomUUID(), turnActionId: randomUUID(), closeActionId: randomUUID(), createdAt: now };
          if (['create', 'fork'].includes(kind)) state.conversations.push(row);
          state.actions.push(action); state.selected = { profileId: context.profileId, epoch: context.epoch };
          row.revision++; row.status = 'running'; row.updatedAt = now; row.activeActionId = action.actionId; action.revision = row.revision;
          recorded = true; save();
          let worker;
          try {
            if (kind === 'send' || kind === 'closeIdle') worker = operation.useWorker(live.get(row.id));
            else {
              const binding = { workerBindingId: randomUUID(), workerGeneration: 1, taskId: row.id, familyId: row.id, generation: 1,
                agentWorkerId: row.id, admissionId: selectedModel.admissionId, model: selectedModel.id };
              const onReceipt = receipt => {
                const currentAction = state.actions.find(value => value.turnActionId === receipt.actionId && value.conversationId === row.id);
                if (currentAction) recordNative(currentAction, row, receipt);
              };
              worker = makeResumedWorker ? makeResumedWorker(binding, onReceipt) : operation.createWorker(binding, onReceipt, kind === 'fork' ? source.threadId : undefined, { mode: conversationMode, ...(input.lastTurnId ? { lastTurnId: input.lastTurnId } : {}) });
              live.set(row.id, worker);
              assertContext();
              const created = await worker.createOwnedWorker({ actionId: action.createActionId });
              row.threadId = created.threadId; row.bindingId = binding.workerBindingId; row.admissionId = selectedModel.admissionId; row.serverGeneration = context.serverGeneration; save();
            }
            if (kind === 'closeIdle') {
              await worker.retireOwnedWorker({ workerHandle: worker.inspectOwnedWorker().workerHandle, actionId: action.closeActionId });
              await worker.destroy(); live.delete(row.id);
              action.state = 'completed'; row.status = 'unloaded'; row.updatedAt = Date.now(); save();
            }
            else if (kind === 'fork' || kind === 'resume') { action.state = 'completed'; row.status = 'idle'; row.updatedAt = Date.now(); save(); }
            else {
              assertContext();
              let capture, unsubscribe; const requireCapture = row.requireCaptureUntilFirstSent === true;
              try {
                if (requireCapture && !transcript) throw Object.assign(fail('recording_unavailable', 'Requested first-turn recording is unavailable; the created thread is retained without sending'), { nativeTurnNotStarted: true });
                if (conversationMode === 'canonical-text-v1' && transcript) {
                  const scope = transcriptScope(row.id);
                  try { capture = await transcript.begin({ scope, actionId: action.actionId, nativeActionId: action.turnActionId, ...(input.recordFutureText ? { enableConsent: input.recordFutureText, expectedAuthority: firstRecordingAuthority } : {}), ...(requireCapture ? { requireCapture: true } : {}) }); } catch (reason) { if (requireCapture) throw Object.assign(fail('recording_unavailable', 'Requested first-turn recording is unavailable; the created thread is retained without sending'), { nativeTurnNotStarted: true }); }
                  assertContext();
                  if (capture) unsubscribe = worker.observeCanonical(event => transcript.observe(capture, event));
                }
                if (requireCapture && !capture) throw Object.assign(fail('recording_unavailable', 'Requested first-turn recording is unavailable; the created thread is retained without sending'), { nativeTurnNotStarted: true });
                const receipt = await worker.offerOwnedTurn({ workerHandle: worker.inspectOwnedWorker().workerHandle, actionId: action.turnActionId,
                  text: input.text, ...(conversationMode === 'canonical-text-v1' ? {} : { outputSchema: FINAL_SCHEMA }) });
                recordNative(action, row, receipt);
              } finally {
                unsubscribe?.();
                try { if (capture) await transcript.release(capture); } catch { /* Capture failure cannot repeat a Native offer. */ }
              }
            }
            return list();
          } catch (reason) {
            let provablyNotSent = false, knownLeafFailure = false;
            if (worker) {
              try {
                const snapshot = worker.inspectOwnedWorker();
                const exactId = kind === 'resume' || kind === 'fork' ? action.createActionId : row.threadId ? action.turnActionId : action.createActionId;
                const exact = snapshot.receipts.find(receipt => receipt.actionId === exactId);
                if (exact) action.ownerHeld = exact.ownerHeld === true;
                provablyNotSent = kind !== 'closeIdle' && snapshot.storageOwner === 'current' && !exact;
                knownLeafFailure = snapshot.storageOwner === 'current' && exact?.state === 'failed' && exact.ownerHeld === false;
              } catch { /* Receipt storage uncertainty is never permission to retry. */ }
            }
            if (action.state !== 'completed') {
              action.state = reason.authoritative || provablyNotSent || knownLeafFailure ? 'failed' : 'unknown'; if (reason.nativeTurnNotStarted === true) action.nativeTurnNotStarted = true; action.reasonCode = reason.code || 'native_outcome_unknown';
              row.status = action.state === 'unknown' ? 'unknown' : reason.nativeTurnNotStarted && row.threadId && worker ? 'idle' : kind === 'resume' ? 'unloaded' : 'unavailable';
              if (kind === 'resume' && action.state === 'failed') live.delete(row.id);
              row.updatedAt = Date.now(); save();
            }
            throw reason;
          }
        });
      } finally { operations.delete(operationKey); notify(); }
    };
    const result = run().then(() => list()).catch(reason => { reason.actionRecorded = recorded; throw reason; });
    pending.add(result); result.finally(() => { pending.delete(result); }).catch(() => {}); return result;
  }
  function transcriptScope(conversationId) {
    uuid(conversationId);
    const context = getExecution(), row = state.conversations.find(row => row.id === conversationId), worker = live.get(conversationId);
    if (destroyed || !row || row.conversationMode !== 'canonical-text-v1' || row.contextVersion !== 3 || !sameScope(row, context)
      || !worker || !context.server.inspect().ready || !context.server.inspect().accepting
      || !['ready', 'offering'].includes(worker.inspectOwnedWorker().state) || !isAgentNativeHistorySource(row.historySource)) return null;
    return { kind: 'owned-conversation', mode: 'canonical-text-v1', conversationId: row.id, threadId: row.threadId,
      ...structuredClone(row.historySource), serverGeneration: row.serverGeneration, workerBindingId: row.bindingId, workerGeneration: 1 };
  }
  function currentHistoryScopes() { return state.conversations.map(row => transcriptScope(row.id)).filter(Boolean); }
  function resolveHistoryScope({ conversationId, revision, expectedContext } = {}) {
    uuid(conversationId); const row = state.conversations.find(row => row.id === conversationId), current = getExecution();
    if (!row || row.revision !== revision || !expectedContext || !current
      || ['profileId', 'epoch', 'serverGeneration'].some(key => expectedContext[key] !== current[key])) throw fail('stale_conversation', 'Select the exact current text conversation revision and account');
    const scope = transcriptScope(conversationId); if (!scope) throw fail('canonical_unavailable', 'Owned text history source is unavailable'); return scope;
  }
  async function readTranscriptPage({ scope, turnId, cursor, limit } = {}) {
    if (!scope || canonical(transcriptScope(scope.conversationId)) !== canonical(scope)) throw fail('canonical_unavailable', 'Exact current owned text scope is unavailable');
    const worker = live.get(scope.conversationId);
    const page = await worker.readCanonicalPage({ threadId: scope.threadId, ...(turnId ? { turnId } : {}), ...(cursor !== undefined ? { cursor } : {}), ...(limit !== undefined ? { limit } : {}) });
    if (canonical(transcriptScope(scope.conversationId)) !== canonical(scope)) throw fail('canonical_unavailable', 'Owned transcript scope changed during read');
    return page;
  }
  function destroy() {
    if (closing) return closing; destroyed = true; notify();
    closing = (async () => {
      await Promise.allSettled([...pending]);
      for (const worker of live.values()) await worker.destroy();
      if (owned) { if (regular(lock, 4096).toString() !== owner) throw fail('owner_changed', 'Persistent Native registry owner changed'); fs.unlinkSync(lock); owned = false; }
    })().catch(reason => { closing = undefined; throw reason; });
    return closing;
  }
  return Object.freeze({ list, transcriptScope, currentHistoryScopes, resolveHistoryScope, readTranscriptPage, create: input => execute('create', input), send: input => execute('send', input), fork: input => execute('fork', input),
    closeIdle: input => execute('closeIdle', input), resume: input => execute('resume', input),
    inspectAction: actionId => {
      uuid(actionId); const row = state.actions.find(value => value.actionId === actionId);
      return row ? { actionId: row.actionId, kind: row.kind, conversationId: row.conversationId, state: row.state,
        ownerHeld: row.ownerHeld === true, ...(row.reasonCode ? { reasonCode: row.reasonCode } : {}), ...(row.nativeTurnNotStarted ? { nativeTurnNotStarted: true } : {}) } : undefined;
    },
    currentOperation: () => operations.size ? 'Native persistent conversation' : [...live.values()].some(worker => worker.currentOperation()) ? 'Awaiting persistent Native ownership settlement' : null,
    destroy });
}
module.exports = { createPersistentNativeConversations };
