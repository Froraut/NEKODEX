const path = require('node:path');
const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');
const { DETACH_OWNED_CHILD, terminateOwnedProcessTree } = require('./process-tree.cjs');
const { createCodexForkJournal } = require('./codex-fork-journal.cjs');

const MAX_LINE_BYTES = 1024 * 1024;
const SOURCE_KINDS = ['cli', 'vscode', 'exec', 'appServer', 'subAgent', 'subAgentReview',
  'subAgentCompact', 'subAgentThreadSpawn', 'subAgentOther', 'unknown'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const error = (code, message, details) => Object.assign(new Error(message), { code, ...details });
const record = value => value && typeof value === 'object' && !Array.isArray(value);

function absolute(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) {
    throw error('invalid_configuration', `${label} must be an absolute path supplied by main`);
  }
  return path.resolve(value);
}
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
  for (const key of ['sessionId', 'parentThreadId', 'forkedFromId', 'name', 'agentNickname',
    'agentRole', 'cwd', 'model', 'modelProvider', 'reasoningEffort', 'originator']) {
    result[key] = typeof value[key] === 'string' ? value[key] : null;
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
  environment = process.env, spawnProcess = spawn, requestTimeoutMs = 15_000,
  stopGraceMs = 1000, maxLineBytes = MAX_LINE_BYTES,
  terminateProcess = terminateOwnedProcessTree } = {}) {
  executable = absolute(executable, 'Codex executable');
  codexHome = absolute(codexHome, 'Codex home');
  cwd = absolute(cwd || codexHome, 'Working directory');
  if (controlSocket !== undefined) controlSocket = absolute(controlSocket, 'Control socket');
  if (journalPath !== undefined) journalPath = absolute(journalPath, 'Fork journal');
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 120_000
    || !Number.isInteger(stopGraceMs) || stopGraceMs < 1 || stopGraceMs > 10_000
    || !Number.isInteger(maxLineBytes) || maxLineBytes < 128 || maxLineBytes > 16 * MAX_LINE_BYTES) {
    throw error('invalid_configuration', 'Invalid Codex client bounds');
  }
  let child, connecting, closing, failure, initialized = false, closed = false, destroyed = false;
  let nextId = 1, buffer = '', bufferBytes = 0, initializeResult = null, pendingForks = 0;
  const pending = new Map();
  const decoder = new StringDecoder('utf8');
  let resolveClosed;
  const childClosed = new Promise(resolve => { resolveClosed = resolve; });
  const methodSupport = { list: 'unverified', read: 'unverified', fork: 'unverified' };
  const transport = controlSocket ? 'existing-server-proxy' : 'owned-stdio-server';
  const journal = createCodexForkJournal({ journalPath, codexHome, executable, controlSocket });

  function snapshot() {
    return {
      state: destroyed ? (closed || !child ? 'closed' : 'closing')
        : failure ? 'unavailable' : initialized ? 'ready' : child ? 'connecting' : 'disconnected',
      transport, statusScope: controlSocket ? 'configured-server' : 'connection',
      userAgent: initializeResult?.userAgent || null,
      capabilities: { ...methodSupport, startTurn: false, interruptTurn: false, approve: false },
      errorCode: failure?.code || null,
      uncertainForks: journal?.snapshot() || [],
    };
  }
  function fail(reason) {
    if (!failure) failure = reason;
    for (const wait of pending.values()) wait.reject(failure);
    pending.clear();
  }
  function write(message) {
    if (failure) throw failure;
    if (!child || closed || destroyed) throw error('client_closed', 'Codex client is closed');
    const line = `${JSON.stringify(message)}\n`;
    if (Buffer.byteLength(line) > maxLineBytes) throw error('request_too_large', 'Codex request exceeds the bound');
    child.stdin.write(line, writeError => {
      if (writeError) fail(error('transport_error', 'Codex input stream failed'));
    });
  }
  function request(method, params, { signal, mutation = false } = {}) {
    if (signal?.aborted) return Promise.reject(error('cancelled', 'Codex observation was cancelled'));
    if (failure) return Promise.reject(failure);
    if (pending.size >= 32) return Promise.reject(error('too_many_requests', 'Too many pending Codex requests'));
    return new Promise((resolve, reject) => {
      const id = nextId++;
      let timer;
      const settle = (handler, value) => {
        pending.delete(id);
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        handler(value);
      };
      const abort = () => settle(reject, error('cancelled', 'Codex observation was cancelled'));
      pending.set(id, {
        resolve: value => settle(resolve, value),
        reject: reason => settle(reject, mutation ? error('fork_outcome_unknown',
          'Codex fork did not return a receipt; reconcile thread metadata before retrying', { cause: reason }) : reason),
      });
      timer = setTimeout(() => pending.get(id)?.reject(error('rpc_timeout', 'Codex request timed out')), requestTimeoutMs);
      signal?.addEventListener('abort', abort, { once: true });
      try { write({ id, method, params }); } catch (reason) { pending.get(id)?.reject(reason); }
    });
  }
  function consume(chunk) {
    // Bound each line independently, including a partial line split across chunks.
    const text = decoder.write(chunk);
    let offset = 0;
    while (offset < text.length) {
      const newline = text.indexOf('\n', offset);
      const end = newline < 0 ? text.length : newline;
      const part = text.slice(offset, end);
      bufferBytes += Buffer.byteLength(part);
      if (bufferBytes > maxLineBytes) {
        fail(error('response_too_large', 'Codex response exceeds the bound'));
        void destroy().catch(() => {});
        return;
      }
      buffer += part;
      if (newline < 0) return;
      const line = buffer;
      buffer = ''; bufferBytes = 0; offset = newline + 1;
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); } catch {
        fail(error('invalid_response', 'Codex returned malformed JSON'));
        void destroy().catch(() => {}); return;
      }
      if (!record(message)) { fail(error('invalid_response', 'Codex returned an invalid RPC envelope')); return; }
      if (typeof message.method === 'string') {
        if (message.id !== undefined) {
          // This metadata port cannot approve commands, tools, permissions or refresh auth.
          try { write({ id: message.id, error: { code: -32601, message: 'This client does not handle server requests' } }); }
          catch { /* The transport failure already settles pending callers. */ }
        }
        continue;
      }
      const wait = pending.get(message.id);
      if (!wait) continue; // Cancelled/timed-out reads can still return; IDs are never reused.
      if (record(message.error)) {
        // Provider messages/data can contain paths, prompts or private values; expose only numeric code.
        wait.reject(error('rpc_error', 'Codex rejected the request', { rpcCode: message.error.code, authoritative: true }));
      } else if (Object.hasOwn(message, 'result')) wait.resolve(message.result);
      else wait.reject(error('invalid_response', 'Codex returned an invalid RPC response'));
    }
  }
  async function connect() {
    if (destroyed) throw error('client_closed', 'Codex client is closed');
    if (failure) throw failure;
    if (initialized) return snapshot();
    if (connecting) return connecting;
    connecting = (async () => {
      const env = { ...environment, CODEX_HOME: codexHome };
      // Never inherit the enclosing agent's thread identity into this client.
      delete env.CODEX_THREAD_ID;
      child = spawnProcess(executable, controlSocket
        ? ['app-server', 'proxy', '--sock', controlSocket] : ['app-server', '--stdio'], {
        cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: DETACH_OWNED_CHILD, windowsHide: true,
      });
      child.stderr.on('data', () => {}); // Drain without logging possible private diagnostics.
      child.stderr.on('error', () => {});
      child.stdin.on('error', () => fail(error('transport_error', 'Codex input stream failed')));
      child.stdout.on('data', consume);
      child.stdout.on('error', () => fail(error('transport_error', 'Codex output stream failed')));
      child.once('error', () => {
        fail(error('spawn_failed', 'Configured Codex executable could not start'));
      });
      child.once('close', () => {
        closed = true; buffer = ''; bufferBytes = 0;
        fail(error('client_closed', 'Codex client process closed'));
        resolveClosed();
      });
      const response = await request('initialize', {
        clientInfo: { name: 'nekodex-client-control', title: 'NEKODEX', version: '1' },
        capabilities: { experimentalApi: false, requestAttestation: false },
      });
      if (!record(response) || typeof response.userAgent !== 'string'
        || typeof response.codexHome !== 'string' || path.resolve(response.codexHome) !== codexHome) {
        throw error('home_mismatch', 'Codex did not confirm the configured home');
      }
      initializeResult = { userAgent: response.userAgent };
      write({ method: 'initialized', params: {} });
      initialized = true;
      return snapshot();
    })().catch(async reason => {
      fail(reason);
      await destroy();
      throw reason;
    });
    return connecting;
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
  async function forkThread({ threadId: id, lastTurnId, userInitiated } = {}) {
    if (userInitiated !== true) throw error('user_action_required', 'Fork requires an explicit user action');
    const params = { threadId: threadId(id), excludeTurns: true };
    if (lastTurnId != null) params.lastTurnId = optionalString(lastTurnId, 'last turn ID', 128);
    if (!journal) throw error('fork_journal_unavailable', 'A private durable fork journal is required');
    pendingForks++;
    let actionId, observedForkId = null;
    try {
      // Handshake/readiness failure precedes durable mutation ownership.
      await connect();
      actionId = journal.begin(id, lastTurnId);
      const result = await call('fork', 'thread/fork', params, { mutation: true });
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
      return { thread, actionId, statusScope: snapshot().statusScope };
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
  async function waitClosed(ms) {
    if (closed) return true;
    let timer;
    const didClose = await Promise.race([childClosed.then(() => true),
      new Promise(resolve => { timer = setTimeout(() => resolve(false), ms); })]);
    clearTimeout(timer);
    return didClose;
  }
  function destroy() {
    if (closing) return closing;
    destroyed = true;
    fail(error('client_closed', 'Codex client is closing'));
    closing = (async () => {
      if (!child || closed) return;
      child.stdin.end();
      if (await waitClosed(stopGraceMs)) return;
      terminateProcess(child, 'SIGTERM');
      if (await waitClosed(stopGraceMs)) return;
      terminateProcess(child, 'SIGKILL');
      if (!await waitClosed(stopGraceMs)) throw error('process_not_settled', 'Owned Codex client did not close');
    })();
    return closing;
  }
  const currentOperation = () => pendingForks ? 'Creating native Codex fork' : null;
  function acknowledgeFork({ actionId, threadId: id, confirmedInspection } = {}) {
    if (confirmedInspection !== true || typeof actionId !== 'string' || !UUID.test(actionId)) {
      throw error('invalid_parameters', 'Explicit fork inspection acknowledgement is required');
    }
    if (!journal) throw error('fork_journal_unavailable', 'Native fork receipts are unavailable');
    journal.acknowledge(actionId, threadId(id));
    return snapshot();
  }
  return Object.freeze({ connect, listThreads, readThread, forkThread, acknowledgeFork, snapshot, currentOperation, destroy });
}

module.exports = { createCodexClientControl };
