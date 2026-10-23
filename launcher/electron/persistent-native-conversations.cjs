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
// Archived receipts remain immutable idempotency evidence. Only live obligations
// and successful active-context history consume the operational count budget.
function activeQuota(state) {
  const active = new Set(state.conversations.filter(row => !row.archivedAt).map(row => row.id));
  return { conversations: active.size, conversationLimit: 128,
    actions: state.actions.filter(row => ['prepared', 'stopping', 'unknown'].includes(row.state) || row.ownerHeld === true
      || !['archive', 'stop', 'rename'].includes(row.kind) && row.state !== 'failed' && active.has(row.conversationId)).length, actionLimit: 512 };
}
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
  const settlingStops = new Set();
  let state;
  try {
    const bytes = regular(file, 4 * 1024 * 1024); lastDigest = digest(bytes); state = JSON.parse(bytes);
    if (![1, 2, 3].includes(state.version) || !Array.isArray(state.conversations) || !Array.isArray(state.actions) || activeQuota(state).conversations > 128 || activeQuota(state).actions - state.actions.filter(row => ['archive', 'stop', 'rename'].includes(row.kind) && (['prepared', 'stopping', 'unknown'].includes(row.state) || row.ownerHeld === true)).length > 512) throw new Error();
    for (const row of state.conversations) { uuid(row.id); uuid(row.profileId); uuid(row.epoch); uuid(row.serverGeneration); if (row.labelRevision !== undefined && (!Number.isSafeInteger(row.labelRevision) || row.labelRevision < 0) || row.label !== undefined && (typeof row.label !== 'string' || row.label.length > 80 || /\p{C}/u.test(row.label)) || !Number.isSafeInteger(row.revision) || row.revision < 0 || row.archivedAt !== undefined && (!Number.isSafeInteger(row.archivedAt) || row.archivedAt <= 0)) throw new Error(); }
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
  function registryBytes(candidate) {
    const bytes = `${JSON.stringify({ ...candidate, version: 3 })}\n`;
    if (Buffer.byteLength(bytes) > 4 * 1024 * 1024) throw Object.assign(fail('registry_quota', 'Persistent Native registry quota reached'), { registryWriteDisposition: 'not-written' });
    return bytes;
  }
  function save() {
    let publicationPossible = false;
    try {
      acquire();
      if (regular(lock, 4096).toString() !== owner) throw fail('owner_changed', 'Persistent Native registry owner changed');
      let observed;
      try { observed = digest(regular(file, 4 * 1024 * 1024)); } catch (reason) { if (reason.code !== 'ENOENT') throw reason; }
      if (observed !== lastDigest) throw fail('registry_changed', 'Persistent Native registry changed outside its owner');
      const bytes = registryBytes(state), tmp = path.join(directory, `${randomUUID()}.tmp`); let fd;
      try {
        fd = fs.openSync(tmp, 'wx', 0o600); fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
        publicationPossible = true; // A rename attempt or later error cannot prove absence of publication.
        fs.renameSync(tmp, file); const dir = fs.openSync(directory, 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
        lastDigest = digest(bytes); state.version = 3;
      } finally { if (fd !== undefined) fs.closeSync(fd); fs.rmSync(tmp, { force: true }); }
      notify();
    } catch (reason) { reason.registryWriteDisposition = publicationPossible ? 'unknown' : 'not-written'; throw reason; }
  }
  function publishIntent({ action, row, patch = {}, newConversation = false, selected = state.selected }) {
    // Validate the complete candidate before touching shared live row identities.
    // Replacing state wholesale would invalidate concurrent owners' row references.
    const conversations = row ? newConversation ? [...state.conversations, { ...row, ...patch }]
      : state.conversations.map(value => value === row ? { ...value, ...patch } : value) : state.conversations;
    registryBytes({ ...state, conversations, actions: [...state.actions, action], selected });
    const before = row && { ...row }, previousSelected = state.selected;
    if (newConversation) state.conversations.push(row);
    if (row) Object.assign(row, patch);
    state.actions.push(action); state.selected = selected;
    try { save(); }
    catch (reason) {
      if (reason.registryWriteDisposition === 'not-written') {
        state.actions.splice(state.actions.indexOf(action), 1);
        if (newConversation) state.conversations.splice(state.conversations.indexOf(row), 1);
        else if (row) for (const key of Object.keys(patch)) { if (Object.hasOwn(before, key)) row[key] = before[key]; else delete row[key]; }
        state.selected = previousSelected;
      }
      throw reason;
    }
  }
  const sameScope = (row, context) => context && row.profileId === context.profileId && row.epoch === context.epoch && row.serverGeneration === context.serverGeneration;
  function resumeReason(row, context) {
    if (![2, 3].includes(row.contextVersion) || row.contextVersion === 3 && row.conversationMode !== 'canonical-text-v1' || !isAgentNativeHistorySource(row.historySource)) return 'legacy_identity_unproven';
    if (state.actions.some(action => action.conversationId === row.id && (['prepared', 'stopping', 'unknown'].includes(action.state) || action.ownerHeld === true))) return 'prior_outcome_unresolved';
    if (!row.threadId || !['idle', 'unloaded'].includes(row.status)) return 'retained_context_unavailable';
    if (!context || destroyed || !context.server.inspect().accepting) return 'account_owner_unavailable';
    if (row.profileId !== context.profileId || row.epoch !== context.epoch) return 'account_scope_changed';
    const model = context.models.find(value => value.id === row.model);
    if (!model || !isAgentNativeHistorySource(model.historySource) || canonical(model.historySource) !== canonical(row.historySource)) return 'account_identity_changed';
    if (sameScope(row, context) && live.has(row.id)) return 'already_loaded';
    return null;
  }
  function canRename(row, context) {
    return Boolean(!destroyed && !row.archivedAt && context && row.profileId === context.profileId && row.epoch === context.epoch
      && !state.actions.some(action => action.conversationId === row.id && action.kind === 'rename' && (['prepared', 'unknown'].includes(action.state) || action.ownerHeld === true)));
  }
  async function rename(input) {
    let recorded = false;
    try {
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['actionId', 'conversationId', 'revision', 'expectedContext', 'expectedLabel', 'label'].includes(key))) throw fail('invalid_intent', 'Unsupported conversation label input');
      uuid(input.actionId); uuid(input.conversationId);
      for (const label of [input.label, input.expectedLabel]) if (typeof label !== 'string' || label.length > 80 || /\p{C}/u.test(label)) throw fail('invalid_conversation_label', 'Use a plain conversation label of at most 80 characters');
      if (!input.expectedContext || Object.keys(input.expectedContext).sort().join(',') !== 'epoch,profileId,serverGeneration') throw fail('stale_account', 'Select the exact current account generation');
      for (const key of ['profileId', 'epoch', 'serverGeneration']) uuid(input.expectedContext[key]);
      const fingerprint = digest(canonical({ kind: 'rename', input })), old = state.actions.find(action => action.actionId === input.actionId);
      if (old) { recorded = true; if (old.fingerprint !== fingerprint) throw fail('intent_conflict', 'Conversation label action identity changed'); return list(); }
      const context = getExecution(), row = state.conversations.find(row => row.id === input.conversationId);
      if (!row || row.revision !== input.revision) throw fail('stale_conversation', 'Select the exact current conversation revision');
      if (!canRename(row, context) || !['profileId', 'epoch', 'serverGeneration'].every(key => context[key] === input.expectedContext[key])) throw fail('stale_account', 'Select the current active conversation account');
      if ((row.label || '') !== input.expectedLabel) throw fail('conversation_label_changed', 'The conversation label changed; refresh before renaming');
      const action = { actionId: input.actionId, conversationId: row.id, kind: 'rename', fingerprint, state: 'completed', ownerHeld: false, revision: row.revision };
      try { publishIntent({ action, row, patch: { label: input.label.trim() || undefined, labelRevision: (row.labelRevision || 0) + 1 } }); recorded = true; }
      catch (reason) {
        recorded = reason.registryWriteDisposition !== 'not-written';
        if (recorded) { action.state = 'unknown'; action.reasonCode = 'label_publication_unknown'; }
        throw reason;
      }
      return list();
    } catch (reason) { reason.actionRecorded = recorded; throw reason; }
  }
  function stopTarget(row, context) {
    if (destroyed || row.archivedAt || !sameScope(row, context) || !context.server.inspect().accepting) return null;
    const worker = live.get(row.id), action = state.actions.find(action => action.actionId === row.activeActionId && action.revision === row.revision);
    if (!worker || !action || !['create', 'send'].includes(action.kind)) return null;
    const snapshot = worker.inspectOwnedWorker(), receipt = snapshot.receipts.find(receipt => receipt.actionId === action.turnActionId
      && receipt.workerHandle === snapshot.workerHandle && receipt.threadId === row.threadId);
    if (!receipt?.turnId || receipt.nativeStatus || receipt.ownerHeld !== true) return null;
    return { worker, action, receipt, workerHandle: snapshot.workerHandle };
  }
  function stopReason(row, context) {
    if (state.actions.some(action => action.kind === 'stop' && action.targetActionId === row.activeActionId)) return 'stop_already_requested';
    return stopTarget(row, context) ? null : 'exact_active_turn_unavailable';
  }
  function scheduleStopSettlement(row, target) {
    if (!target.nativeStatus) return;
    for (const stop of state.actions.filter(action => action.kind === 'stop' && action.targetActionId === target.actionId && !['completed', 'failed'].includes(action.state))) {
      if (settlingStops.has(stop.actionId)) continue;
      const worker = live.get(row.id); if (!worker) continue;
      settlingStops.add(stop.actionId);
      // Receipt observers fire before the Native worker clears its active offer.
      // Yield once; reentrant destroy must never replace a known terminal receipt.
      const work = Promise.resolve().then(async () => {
        await worker.destroy();
        if (live.get(row.id) === worker) live.delete(row.id);
        stop.state = 'completed'; stop.ownerHeld = false; stop.nativeStatus = target.nativeStatus;
        stop.reasonCode = target.nativeStatus === 'interrupted' ? 'native_interrupted' : target.nativeStatus === 'completed' ? 'native_completed' : 'native_failed';
        row.status = 'unloaded'; row.updatedAt = Date.now(); save();
      }).catch(reason => {
        stop.state = 'unknown'; stop.ownerHeld = true; stop.reasonCode = reason.code || 'stop_cleanup_unknown'; save();
      }).finally(() => { settlingStops.delete(stop.actionId); notify(); });
      pending.add(work); work.finally(() => pending.delete(work)).catch(() => {});
    }
  }
  function stop(input) {
    let recorded = false;
    const run = async () => {
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['actionId', 'conversationId', 'revision', 'expectedContext'].includes(key))) throw fail('invalid_intent', 'Unsupported Native stop input');
      uuid(input.actionId); uuid(input.conversationId);
      if (!input.expectedContext || Object.keys(input.expectedContext).sort().join(',') !== 'epoch,profileId,serverGeneration') throw fail('stale_account', 'Select the exact current account generation');
      for (const key of ['profileId', 'epoch', 'serverGeneration']) uuid(input.expectedContext[key]);
      const fingerprint = digest(canonical({ kind: 'stop', input })), old = state.actions.find(action => action.actionId === input.actionId);
      if (old) { recorded = true; if (old.fingerprint !== fingerprint) throw fail('intent_conflict', 'Native stop action identity changed'); return list(); }
      const context = getExecution(), row = state.conversations.find(row => row.id === input.conversationId);
      if (!row || row.revision !== input.revision) throw fail('stale_conversation', 'Select the exact active conversation revision');
      if (!context || !['profileId', 'epoch', 'serverGeneration'].every(key => context[key] === input.expectedContext[key])) throw fail('stale_account', 'The selected Native account generation changed');
      const target = stopReason(row, context) === null && stopTarget(row, context);
      if (!target) throw fail('stop_unavailable', 'An exact acknowledged active Native turn is required');
      const action = { actionId: input.actionId, conversationId: row.id, kind: 'stop', fingerprint, state: 'prepared', ownerHeld: true,
        targetActionId: target.action.actionId, targetNativeActionId: target.receipt.actionId, targetTurnId: target.receipt.turnId, revision: row.revision };
      try { publishIntent({ action }); recorded = true; }
      catch (reason) { recorded = reason.registryWriteDisposition !== 'not-written'; throw reason; }
      // Quota-exempt control intent; never revises the sending action.
      try {
        const current = getExecution();
        if (!current || current.server !== context.server || !sameScope(row, current) || live.get(row.id) !== target.worker || destroyed) throw fail('stale_account', 'Native Stop owner changed before dispatch');
        const result = await target.worker.interruptOwnedTurn({ workerHandle: target.workerHandle, actionId: action.actionId,
          targetActionId: action.targetNativeActionId, turnId: action.targetTurnId });
        if (action.state !== 'completed') {
          action.state = result.state === 'unknown' ? 'unknown' : 'stopping';
          action.reasonCode = result.state === 'unknown' ? 'native_interrupt_unknown' : 'awaiting_native_terminal'; save();
          if (result.receipt.nativeStatus) { target.action.nativeStatus = result.receipt.nativeStatus; scheduleStopSettlement(row, target.action); }
        }
        return list();
      } catch (reason) {
        action.state = 'unknown'; action.reasonCode = reason.code || 'native_interrupt_unknown'; save(); throw reason;
      }
    };
    const result = run().catch(reason => { reason.actionRecorded = recorded; throw reason; });
    pending.add(result); result.finally(() => pending.delete(result)).catch(() => {}); return result;
  }
  function archiveReason(row, context) {
    if (row.archivedAt || !['idle', 'unloaded', 'unavailable'].includes(row.status)) return 'conversation_not_settled';
    if (state.actions.some(action => action.conversationId === row.id && (['prepared', 'stopping', 'unknown'].includes(action.state) || action.ownerHeld === true))) return 'prior_outcome_unresolved';
    if (operations.has(row.id)) return 'conversation_busy';
    if (!context || destroyed || !context.server.inspect().accepting) return 'account_unavailable';
    if (row.profileId !== context.profileId || row.epoch !== context.epoch) return 'profile_epoch_changed';
    if (live.has(row.id) && !sameScope(row, context)) return 'account_unavailable';
    const worker = live.get(row.id), snapshot = worker?.inspectOwnedWorker();
    if (worker && (worker.currentOperation() || !['ready', 'retired'].includes(snapshot.state)
      || snapshot.receipts.some(receipt => receipt.ownerHeld === true || ['prepared', 'offered', 'acknowledged', 'unknown'].includes(receipt.state)))) return 'conversation_busy';
    return null;
  }
  function list({ archiveCursor, archiveQuery = '' } = {}) {
    if (typeof archiveQuery !== 'string' || archiveQuery.length > 120 || /\p{C}/u.test(archiveQuery)) throw fail('invalid_archive_query', 'Use a plain archive query of at most 120 characters');
    archiveQuery = archiveQuery.trim(); const foldedQuery = archiveQuery.toLowerCase(), queryHash = digest(foldedQuery).slice(0, 16);
    const context = getExecution(), selected = context || state.selected;
    const scoped = state.conversations.filter(row => selected && row.profileId === selected.profileId && row.epoch === selected.epoch);
    const project = row => {
      const worker = live.get(row.id), available = !destroyed && sameScope(row, context) && worker && !context.server.inspect().closed && context.server.inspect().accepting;
      return { id: row.id, revision: row.revision, ...(row.label ? { label: row.label } : {}), labelRevision: row.labelRevision || 0, renameAvailable: canRename(row, context), threadId: row.threadId, model: row.model,
        status: row.archivedAt ? 'archived' : available ? row.status : row.status === 'unloaded' ? 'unloaded' : 'unavailable', ownerAvailable: Boolean(available), createdAt: row.createdAt, updatedAt: row.updatedAt,
        stopAvailable: stopReason(row, context) === null, stopReason: stopReason(row, context),
        resumeAvailable: !row.archivedAt && resumeReason(row, context) === null, resumeReason: row.archivedAt ? 'archived' : resumeReason(row, context),
        archiveAvailable: archiveReason(row, context) === null, archiveReason: archiveReason(row, context),
        ...(row.archivedAt ? { archivedAt: row.archivedAt } : {}),
        ...(row.parentId ? { parentId: row.parentId } : {}), ...(row.lastSummary ? { lastSummary: row.archivedAt ? row.lastSummary.slice(0, 4096) : row.lastSummary } : {}), conversationMode: row.conversationMode ?? 'neko-json-v1',
        ...(row.lastTextPreview !== undefined ? { lastTextPreview: row.lastTextPreview, lastTextTruncated: row.lastTextTruncated === true } : {}),
        ...(typeof row.lastTurnId === 'string' ? { lastTurnId: row.lastTurnId } : {}), recordingRequiredBeforeFirstSend: row.requireCaptureUntilFirstSent === true };
    };
    const conversations = scoped.filter(row => !row.archivedAt).map(project);
    const allArchived = scoped.filter(row => row.archivedAt);
    const archived = allArchived.filter(row => !foldedQuery || [row.label, row.id, row.threadId, row.model, row.lastSummary?.slice(0, 4096), row.lastTextPreview?.slice(0, 2048)]
      .some(value => typeof value === 'string' && value.toLowerCase().includes(foldedQuery))).sort((a, b) => b.archivedAt - a.archivedAt || a.id.localeCompare(b.id));
    let cursorId;
    if (archiveCursor !== undefined) {
      if (typeof archiveCursor !== 'string' || archiveCursor.length > 80) throw fail('stale_archive_cursor', 'Refresh the archived conversation list');
      const parts = archiveCursor.split(':'); cursorId = parts[0]; uuid(cursorId);
      if (!(parts.length === 2 && parts[1] === queryHash || parts.length === 1 && !foldedQuery)) throw fail('stale_archive_cursor', 'The archive query changed; refresh its first page');
    }
    const start = archiveCursor === undefined ? 0 : archived.findIndex(row => row.id === cursorId) + 1;
    if (archiveCursor !== undefined && start === 0) throw fail('stale_archive_cursor', 'Refresh the archived conversation list');
    const page = archived.slice(start, start + 50);
    const ids = new Set(conversations.map(row => row.id));
    return { conversations, actions: state.actions.filter(row => ids.has(row.conversationId)).map(row => ({ actionId: row.actionId, kind: row.kind,
      conversationId: row.conversationId, state: row.state, ownerHeld: row.ownerHeld === true, ...(row.reasonCode ? { reasonCode: row.reasonCode } : {}),
      ...(row.nativeStatus ? { nativeStatus: row.nativeStatus } : {}) })),
      archivedConversations: page.map(project), archivedCount: archived.length, archivedTotalCount: allArchived.length, archiveQuery, archivedConversationIds: allArchived.map(row => row.id),
      archiveNextCursor: start + page.length < archived.length ? `${page.at(-1).id}:${queryHash}` : null, quota: activeQuota(state),
      busy: operations.size > 0, retention: 'explicit-native-context', resumeSupported: true };
  }
  function recordNative(action, row, receipt) {
    if (receipt.actionId !== action.turnActionId) return;
    if (row.revision !== action.revision || row.activeActionId !== action.actionId) return;
    // A late duplicate terminal observation cannot undo a proven Stop cleanup.
    if (state.actions.some(stop => stop.kind === 'stop' && stop.targetActionId === action.actionId && stop.state === 'completed')) return;
    if (receipt.nativeStatus) action.nativeStatus = receipt.nativeStatus;
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
    scheduleStopSettlement(row, action);
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
        if (!source || source.archivedAt || source.revision !== input.revision) throw fail('stale_conversation', 'Select the exact current conversation revision');
        if (input.lastTurnId !== undefined && !state.actions.some(action => action.conversationId === source.id && action.state === 'completed' && action.turnId === input.lastTurnId)) throw fail('invalid_intent', 'Fork point requires an exact completed owned turn');
        if (kind === 'archive') { const reason = archiveReason(source, context); if (reason) throw fail('archive_unavailable', reason); }
        else if (kind === 'resume') { const reason = resumeReason(source, context); if (reason) throw fail('resume_unavailable', reason); }
        else {
          if (!sameScope(source, context) || !live.has(source.id)) throw fail('owner_unavailable', 'This retained conversation has no current owner; explicitly Resume first');
          if (source.status !== 'idle') throw fail('stale_conversation', 'Select the current idle conversation revision');
          if (state.actions.some(action => action.conversationId === source.id && (['prepared', 'stopping', 'unknown'].includes(action.state) || action.ownerHeld === true))) throw fail('resume_unavailable', 'Prior conversation outcome is unresolved');
        }
      }
      if (kind === 'create' && input.retainContext !== true) throw fail('retention_consent_required', 'Explicit consent to retain full Native context is required');
      if (kind === 'create' || kind === 'send') textInput(input.text);
      const selectedModel = context.models.find(model => model.id === (source?.model || input.model));
      if (kind !== 'archive' && !selectedModel) throw fail('model_unavailable', 'Select a model from the current qualified account');
      if (kind !== 'archive' && (!isAgentNativeHistorySource(selectedModel.historySource) || selectedModel.historySource.profileId !== context.profileId || selectedModel.historySource.authEpoch !== context.epoch)) throw fail('account_identity_unavailable', 'Qualified Native account identity is required for retained context');
      if (kind !== 'archive' && (activeQuota(state).actions >= 512 || ['create', 'fork'].includes(kind) && activeQuota(state).conversations >= 128)) throw fail('registry_quota', 'Persistent Native registry quota reached');
      // A fork reserves its source too. Registry mutations remain synchronous under
      // one writer, while independent exact conversations can await Native together.
      const operationKey = source?.id || input.actionId;
      if (operations.has(operationKey)) throw fail('worker_busy', 'This persistent conversation already has an operation');
      operations.add(operationKey); notify();
      try {
        return await context.server.persistentOperation(async operation => {
          assertContext();
          // Account readiness yields; enforce the shared registry quota again at claim.
          if (kind !== 'archive' && (activeQuota(state).actions >= 512 || ['create', 'fork'].includes(kind) && activeQuota(state).conversations >= 128)) throw fail('registry_quota', 'Persistent Native registry quota reached');
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
          action.revision = row.revision + 1;
          try {
            publishIntent({ action, row, newConversation: ['create', 'fork'].includes(kind),
              patch: { revision: action.revision, status: 'running', updatedAt: now, activeActionId: action.actionId },
              selected: { profileId: context.profileId, epoch: context.epoch } });
            recorded = true;
          } catch (reason) { recorded = reason.registryWriteDisposition !== 'not-written'; throw reason; }
          let worker;
          try {
            if (kind === 'archive' && live.get(row.id)?.inspectOwnedWorker().state === 'retired') worker = live.get(row.id);
            else if (kind === 'send' || kind === 'closeIdle' || kind === 'archive' && live.has(row.id)) worker = operation.useWorker(live.get(row.id));
            else if (kind !== 'archive') {
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
            if (kind === 'archive') {
              // No thread deletion, capture grant or turn. The retained context and
              // every fingerprint stay in this one atomic bounded registry.
              if (worker) {
                action.ownerHeld = true; save();
                if (worker.inspectOwnedWorker().state !== 'retired') await worker.retireOwnedWorker({ workerHandle: worker.inspectOwnedWorker().workerHandle, actionId: action.closeActionId });
                await worker.destroy(); live.delete(row.id); action.ownerHeld = false;
              }
              assertContext();
              action.state = 'completed'; row.status = 'unloaded'; row.archivedAt = Date.now(); row.updatedAt = row.archivedAt;
              try { save(); } catch (reason) { delete row.archivedAt; action.state = 'unknown'; throw reason; }
            }
            else if (kind === 'closeIdle') {
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
                provablyNotSent = !['closeIdle', 'archive'].includes(kind) && snapshot.storageOwner === 'current' && !exact;
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
    if (destroyed || !row || row.archivedAt || row.conversationMode !== 'canonical-text-v1' || row.contextVersion !== 3 || !sameScope(row, context)
      || !worker || !context.server.inspect().ready || !context.server.inspect().accepting
      || !['ready', 'offering'].includes(worker.inspectOwnedWorker().state) || !isAgentNativeHistorySource(row.historySource)) return null;
    return { kind: 'owned-conversation', mode: 'canonical-text-v1', conversationId: row.id, threadId: row.threadId,
      ...structuredClone(row.historySource), serverGeneration: row.serverGeneration, workerBindingId: row.bindingId, workerGeneration: 1 };
  }
  function currentHistoryScopes() { return state.conversations.map(row => transcriptScope(row.id)).filter(Boolean); }
  function resolveHistoryScope({ conversationId, revision, expectedContext } = {}) {
    uuid(conversationId); const row = state.conversations.find(row => row.id === conversationId), current = getExecution();
    if (!row || row.archivedAt || row.revision !== revision || !expectedContext || !current
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
  return Object.freeze({ list, rename, stop, transcriptScope, currentHistoryScopes, resolveHistoryScope, readTranscriptPage, create: input => execute('create', input), send: input => execute('send', input), fork: input => execute('fork', input),
    archive: input => execute('archive', input), closeIdle: input => execute('closeIdle', input), resume: input => execute('resume', input),
    inspectAction: actionId => {
      uuid(actionId); const row = state.actions.find(value => value.actionId === actionId);
      return row ? { actionId: row.actionId, kind: row.kind, conversationId: row.conversationId, state: row.state,
        ownerHeld: row.ownerHeld === true, ...(row.reasonCode ? { reasonCode: row.reasonCode } : {}), ...(row.nativeStatus ? { nativeStatus: row.nativeStatus } : {}), ...(row.nativeTurnNotStarted ? { nativeTurnNotStarted: true } : {}) } : undefined;
    },
    currentOperation: () => operations.size ? 'Native persistent conversation' : [...live.values()].some(worker => worker.currentOperation()) ? 'Awaiting persistent Native ownership settlement' : null,
    destroy });
}
module.exports = { createPersistentNativeConversations };
