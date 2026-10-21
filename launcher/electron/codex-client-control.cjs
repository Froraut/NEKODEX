const { createCodexAppServerConnection, absolute, record, error } = require('./codex-app-server-connection.cjs');
const { createCodexForkJournal } = require('./codex-fork-journal.cjs');

const MAX_CONVERSATION_MESSAGE_BYTES = 128 * 1024;
const MAX_CONVERSATION_PAGE_BYTES = 384 * 1024;
const SOURCE_KINDS = ['cli', 'vscode', 'exec', 'appServer', 'subAgent', 'subAgentReview',
  'subAgentCompact', 'subAgentThreadSpawn', 'subAgentOther', 'unknown'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function threadId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw error('invalid_thread_id', 'Invalid Codex thread ID');
  return value;
}
function optionalString(value, label, max = 4096) {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f]/.test(value)) {
    throw error('invalid_parameters', `Invalid ${label}`);
  }
  return value;
}
function projectThread(value) {
  if (!record(value) || !UUID.test(value.id) || !record(value.status)
    || !['notLoaded', 'idle', 'active', 'systemError'].includes(value.status.type)) {
    throw error('invalid_response', 'Codex returned invalid thread metadata');
  }
  const status = { type: value.status.type };
  if (status.type === 'active') {
    if (!Array.isArray(value.status.activeFlags)
      || value.status.activeFlags.some(flag => !['waitingOnApproval', 'waitingOnUserInput'].includes(flag))) {
      throw error('invalid_response', 'Codex returned invalid thread status');
    }
    status.activeFlags = [...value.status.activeFlags];
  }
  const result = { id: value.id, status };
  for (const key of ['name', 'agentNickname',
    'agentRole', 'cwd', 'model', 'modelProvider', 'reasoningEffort', 'originator']) {
    result[key] = typeof value[key] === 'string' ? value[key] : null;
  }
  for (const key of ['sessionId', 'parentThreadId', 'forkedFromId']) {
    result[key] = typeof value[key] === 'string' && UUID.test(value[key]) ? value[key] : null;
  }
  // Source may contain subagent provenance; expose a classification, never arbitrary nested data.
  result.source = typeof value.source === 'string' ? value.source
    : record(value.source?.subAgent) || typeof value.source?.subAgent === 'string' ? 'subAgent' : 'unknown';
  for (const key of ['createdAt', 'updatedAt', 'recencyAt']) {
    result[key] = Number.isFinite(value[key]) ? value[key] : null;
  }
  return result;
}

/** Main-process-only port. Never pass constructor options through renderer IPC. */
function createCodexClientControl({ executable, codexHome, controlSocket, journalPath, cwd,
  environment = process.env, spawnProcess, requestTimeoutMs = 15_000,
  stopGraceMs = 1000, maxLineBytes, terminateProcess } = {}) {
  if (journalPath !== undefined) journalPath = absolute(journalPath, 'Fork journal');
  const connection = createCodexAppServerConnection({ executable, codexHome, controlSocket, cwd, environment,
    requestTimeoutMs, stopGraceMs, clientName: 'nekodex-client-control',
    ...(spawnProcess ? { spawnProcess } : {}), ...(terminateProcess ? { terminateProcess } : {}),
    ...(maxLineBytes !== undefined ? { maxLineBytes } : {}) });
  codexHome = connection.codexHome; executable = connection.executable; controlSocket = connection.controlSocket ?? undefined;
  let pendingForks = 0;
  const methodSupport = { list: 'unverified', read: 'unverified', fork: 'unverified' };
  const transport = connection.transport;
  const journal = createCodexForkJournal({ journalPath, codexHome, executable, controlSocket });
  const request = connection.request;

  function snapshot() {
    return {
      state: connection.state(),
      transport, statusScope: controlSocket ? 'configured-server' : 'connection',
      userAgent: connection.userAgent(),
      // This metadata connection never resumes or sends. Exclusive handoff is a
      // separate owned process (codex-thread-handoff.cjs) with its own receipts.
      capabilities: { ...methodSupport, startTurn: false, interruptTurn: false, approve: false,
        resumeExternal: false, exclusiveHandoff: false },
      externalControl: { executionOwner: 'unverified', reason: 'exclusive-owner-contract-unavailable' },
      errorCode: connection.failureCode(),
      uncertainForks: journal?.snapshot() || [],
    };
  }
  async function connect() {
    await connection.connect();
    return snapshot();
  }
  async function call(kind, method, params, options) {
    await connect();
    try {
      const result = await request(method, params, options);
      methodSupport[kind] = 'supported';
      return result;
    } catch (reason) {
      const rpcCode = reason.rpcCode ?? reason.cause?.rpcCode;
      if (rpcCode === -32601) methodSupport[kind] = 'unsupported';
      // An explicit server rejection is a known failure, not an uncertain fork.
      if (reason.code === 'fork_outcome_unknown' && reason.cause?.authoritative) throw reason.cause;
      throw reason;
    }
  }
  async function listThreads({ cursor, limit = 50, cwd: filterCwd, archived = false } = {}, options) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || typeof archived !== 'boolean') {
      throw error('invalid_parameters', 'Invalid Codex thread list bounds');
    }
    const params = { limit, archived, sourceKinds: SOURCE_KINDS, sortKey: 'updated_at',
      sortDirection: 'desc' };
    if (cursor != null) params.cursor = optionalString(cursor, 'cursor');
    if (filterCwd != null) params.cwd = optionalString(filterCwd, 'working directory');
    const result = await call('list', 'thread/list', params, options);
    if (!record(result) || !Array.isArray(result.data) || result.data.length > limit
      || (result.nextCursor !== null && typeof result.nextCursor !== 'string')) {
      throw error('invalid_response', 'Codex returned an invalid thread list');
    }
    return { data: result.data.map(projectThread), nextCursor: result.nextCursor,
      statusScope: snapshot().statusScope };
  }
  async function readThread(id, options) {
    const result = await call('read', 'thread/read', { threadId: threadId(id), includeTurns: false }, options);
    const thread = projectThread(result?.thread);
    if (thread.id !== id) throw error('invalid_response', 'Codex returned a different thread');
    return { thread, statusScope: snapshot().statusScope };
  }
  /** Main-only canonical text producer. The history owner must obtain and
   * revalidate explicit per-thread recording consent around this read. */
  async function readThreadConversation(id, { cursor, limit = 50, signal } = {}) {
    threadId(id);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw error('invalid_parameters', 'Invalid native conversation page size');
    }
    const params = { threadId: id, limit, sortDirection: 'desc' };
    if (cursor != null) params.cursor = optionalString(cursor, 'conversation cursor');
    // Metadata binds the exact selected thread without hydrating all turns or
    // loading/resuming native execution. One bounded recent item page follows.
    await readThread(id, { signal });
    const result = await request('thread/items/list', params, { signal });
    if (!record(result) || !Array.isArray(result.data) || result.data.length > limit
      || (result.nextCursor !== null && (typeof result.nextCursor !== 'string'
        || result.nextCursor.length > 4096 || /[\u0000-\u001f]/.test(result.nextCursor)))) {
      throw error('invalid_response', 'Codex returned an invalid conversation page');
    }
    const messages = [];
    const seen = new Set();
    // Reserve room for envelope/cursor metadata; newest messages win if a page
    // reaches the projection bound, then the retained page is chronological.
    let excludedItems = 0, projectedBytes = 8192;
    for (const entry of result.data) {
      const item = entry?.item;
      if (!record(entry) || !record(item) || !['userMessage', 'agentMessage'].includes(item.type)) {
        excludedItems++; continue;
      }
      // Native canonical item IDs, never output indexes or guessed turn links.
      if (typeof item.id !== 'string' || !item.id || item.id.length > 512 || /[\u0000-\u001f]/.test(item.id)
        || typeof entry.turnId !== 'string' || !entry.turnId || entry.turnId.length > 512
        || /[\u0000-\u001f]/.test(entry.turnId) || seen.has(item.id)) {
        excludedItems++; continue;
      }
      let text, contentOmitted = false;
      if (item.type === 'userMessage') {
        if (!Array.isArray(item.content)) { excludedItems++; continue; }
        const parts = item.content.filter(part => record(part) && part.type === 'text' && typeof part.text === 'string');
        contentOmitted = parts.length !== item.content.length;
        if (!parts.length) { excludedItems++; continue; }
        text = parts.map(part => part.text).join('\n');
      } else text = item.text;
      // Never truncate into a misleading partial text or expose attachment/tool
      // payloads. The consent/sensitivity owner still validates canonical text.
      if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_CONVERSATION_MESSAGE_BYTES) {
        excludedItems++; continue;
      }
      const completed = Number.isSafeInteger(entry.completedAtMs) && entry.completedAtMs >= 0;
      const started = Number.isSafeInteger(entry.startedAtMs) && entry.startedAtMs >= 0;
      const partial = contentOmitted || !completed;
      const message = { messageId: item.id, turnId: entry.turnId,
        role: item.type === 'userMessage' ? 'user' : 'assistant', text,
        timestampMs: completed ? entry.completedAtMs : started ? entry.startedAtMs : null,
        compactionId: null, coverage: partial ? 'partial' : 'complete',
        ...(partial ? { coverageReason: contentOmitted ? 'native-nontext-content-excluded' : 'native-item-completion-unreported' } : {}),
      };
      const bytes = Buffer.byteLength(JSON.stringify(message)) + 1;
      if (projectedBytes + bytes > MAX_CONVERSATION_PAGE_BYTES) { excludedItems++; continue; }
      projectedBytes += bytes; seen.add(item.id); messages.push(message);
    }
    messages.reverse();
    return { threadId: id, observedAt: Date.now(), messages, nextCursor: result.nextCursor,
      complete: cursor == null && result.nextCursor === null && excludedItems === 0
        && messages.every(message => message.coverage === 'complete'), excludedItems };
  }
  /** Stored thread attachments are resource references Codex keeps beside history.
   * Identities only (type + identity key); payloads never leave this module. */
  async function attachmentIdentities(id) {
    const result = await request('thread/attachment/list', { threadId: id, limit: 100 });
    if (!record(result) || !Array.isArray(result.data) || result.data.length > 100
      || (result.nextCursor !== null && typeof result.nextCursor !== 'string')) {
      throw error('invalid_response', 'Codex returned an invalid attachment page');
    }
    const identities = new Set();
    for (const row of result.data) {
      if (!record(row) || typeof row.attachmentType !== 'string' || typeof row.identityKey !== 'string') {
        throw error('invalid_response', 'Codex returned an invalid attachment');
      }
      identities.add(JSON.stringify([row.attachmentType, row.identityKey]));
    }
    return { identities, complete: result.nextCursor === null };
  }
  /** Codex copies a non-ephemeral fork's attachments best effort (a copy failure is logged
   * and the fork still succeeds), so parity is observed, never assumed. Membership can
   * change independently, so only identities present before and after the fork count. */
  async function forkAttachmentParity(sourceId, forkId, before) {
    try {
      const after = await attachmentIdentities(sourceId), copied = await attachmentIdentities(forkId);
      const required = [...after.identities].filter(key => !before || before.identities.has(key));
      const missing = required.filter(key => !copied.identities.has(key)).length;
      const complete = after.complete && copied.complete && (!before || before.complete);
      return { state: missing ? 'missing' : complete ? 'matched' : 'partial', source: required.length,
        fork: copied.identities.size, missing };
    } catch (reason) {
      const rpcCode = reason.rpcCode ?? reason.cause?.rpcCode;
      return { state: rpcCode === -32601 ? 'unsupported' : 'unavailable', source: null, fork: null, missing: null };
    }
  }
  async function forkThread({ threadId: id, lastTurnId, userInitiated } = {}) {
    if (userInitiated !== true) throw error('user_action_required', 'Fork requires an explicit user action');
    const params = { threadId: threadId(id), excludeTurns: true };
    if (lastTurnId != null) {
      params.lastTurnId = optionalString(lastTurnId, 'last turn ID', 128);
      if (!params.lastTurnId) throw error('invalid_parameters', 'Invalid last turn ID');
    }
    if (!journal) throw error('fork_journal_unavailable', 'A private durable fork journal is required');
    pendingForks++;
    let actionId, observedForkId = null;
    try {
      // Handshake/readiness failure precedes durable mutation ownership.
      await connect();
      // Observation only; a failed attachment read never blocks or alters the fork.
      const attachmentsBefore = await attachmentIdentities(id).catch(() => null);
      actionId = journal.begin(id, lastTurnId);
      const result = await call('fork', 'thread/fork', params, { lostCode: 'fork_outcome_unknown' });
      if (record(result?.thread) && UUID.test(result.thread.id) && result.thread.id !== id) {
        observedForkId = result.thread.id;
      }
      let thread;
      try {
        thread = projectThread(result?.thread);
        if (thread.id === id || thread.forkedFromId !== id) throw error('invalid_response', 'Invalid fork association');
      } catch (cause) {
        throw error('fork_outcome_unknown', 'Codex fork returned an invalid receipt; reconcile before retrying', { cause });
      }
      observedForkId = thread.id;
      journal.finish(actionId, { state: 'completed', forkId: thread.id, completedAt: new Date().toISOString() });
      const attachments = await forkAttachmentParity(id, thread.id, attachmentsBefore);
      return { thread, actionId, sourceThreadId: id, lastTurnId: params.lastTurnId ?? null,
        executionStarted: false, attachments, statusScope: snapshot().statusScope };
    } catch (reason) {
      if (actionId) {
        if (reason.code === 'rpc_error' && reason.authoritative) {
          try { journal.finish(actionId, { state: 'failed', reasonCode: 'rpc_rejected', completedAt: new Date().toISOString() }); }
          catch { journal.uncertain(actionId, 'receipt_not_saved'); }
        } else {
          journal.uncertain(actionId, reason.code || 'fork_outcome_unknown', observedForkId);
          if (reason.code !== 'fork_outcome_unknown') throw error('fork_outcome_unknown',
            'Native fork receipt could not be retained; inspect the recorded action before retrying');
        }
      }
      throw reason;
    } finally {
      pendingForks--;
    }
  }
  const destroy = () => connection.destroy();
  const currentOperation = () => pendingForks ? 'Creating native Codex fork' : null;
  function acknowledgeFork({ actionId, threadId: id, confirmedInspection } = {}) {
    if (confirmedInspection !== true || typeof actionId !== 'string' || !UUID.test(actionId)) {
      throw error('invalid_parameters', 'Explicit fork inspection acknowledgement is required');
    }
    if (!journal) throw error('fork_journal_unavailable', 'Native fork receipts are unavailable');
    journal.acknowledge(actionId, threadId(id));
    return snapshot();
  }
  return Object.freeze({ connect, listThreads, readThread, readThreadConversation, forkThread, acknowledgeFork, snapshot, currentOperation, destroy });
}

module.exports = { createCodexClientControl };
