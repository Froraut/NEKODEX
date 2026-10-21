const path = require('node:path');
const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');
const { DETACH_OWNED_CHILD, terminateOwnedProcessTree } = require('./process-tree.cjs');

const MAX_LINE_BYTES = 1024 * 1024;
const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const error = (code, message, details) => Object.assign(new Error(message), { code, ...details });
const record = value => value && typeof value === 'object' && !Array.isArray(value);
/** The user-decline answer to each approval request of the Codex 0.163 app-server v2 protocol
 * (`codex app-server generate-ts`; `bespoke_event_handling.rs` at rust-v0.163.0). Codex records a
 * declined command or file change as "rejected by user" and continues the turn (`cancel` would
 * interrupt it); a permissions request is declined by granting nothing; an MCP elicitation,
 * including an MCP tool approval, is declined with no content. None of these grants anything. */
const APPROVAL_DECLINES = Object.freeze({
  'item/commandExecution/requestApproval': () => ({ decision: 'decline' }),
  'item/fileChange/requestApproval': () => ({ decision: 'decline' }),
  'item/permissions/requestApproval': () => ({ permissions: {}, scope: 'turn' }),
  'mcpServer/elicitation/request': () => ({ action: 'decline', content: null, _meta: null }),
});

function absolute(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) {
    throw error('invalid_configuration', `${label} must be an absolute path supplied by main`);
  }
  return path.resolve(value);
}

/** One owned official `codex app-server` child (stdio) or proxy client. Main-only.
 * It owns exactly that child process and never starts/stops a daemon. This client never
 * grants approvals, input, tool calls or tokens. By default every server request is refused
 * with method-not-found. Only an owner of one thread's turn (`declineApprovalsFor`) answers
 * that thread's approval requests with the protocol's user decline; every other request,
 * including any unknown method, is still refused. */
function createCodexAppServerConnection({ executable, codexHome, controlSocket, cwd,
  environment = process.env, spawnProcess = spawn, requestTimeoutMs = 15_000,
  stopGraceMs = 1000, maxLineBytes = MAX_LINE_BYTES, clientName = 'nekodex-client-control',
  terminateProcess = terminateOwnedProcessTree, onNotification, onServerRequest, declineApprovalsFor } = {}) {
  executable = absolute(executable, 'Codex executable');
  codexHome = absolute(codexHome, 'Codex home');
  cwd = absolute(cwd || codexHome, 'Working directory');
  if (controlSocket !== undefined) controlSocket = absolute(controlSocket, 'Control socket');
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 120_000
    || !Number.isInteger(stopGraceMs) || stopGraceMs < 1 || stopGraceMs > 10_000
    || !Number.isInteger(maxLineBytes) || maxLineBytes < 128 || maxLineBytes > 16 * MAX_LINE_BYTES
    || typeof clientName !== 'string' || !/^[a-z0-9-]{1,64}$/.test(clientName)
    || (declineApprovalsFor !== undefined && !(typeof declineApprovalsFor === 'string' && THREAD_ID.test(declineApprovalsFor)))) {
    throw error('invalid_configuration', 'Invalid Codex client bounds');
  }
  let child, connecting, closing, failure, initialized = false, closed = false, destroyed = false;
  let nextId = 1, buffer = '', bufferBytes = 0, userAgent = null;
  const pending = new Map();
  const decoder = new StringDecoder('utf8');
  let resolveClosed;
  const childClosed = new Promise(resolve => { resolveClosed = resolve; });

  function state() {
    return destroyed ? (closed || !child ? 'closed' : 'closing')
      : failure ? 'unavailable' : initialized ? 'ready' : child ? 'connecting' : 'disconnected';
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
  /** `lostCode` marks a mutation: any non-response settlement becomes that uncertain code. */
  function request(method, params, { signal, lostCode, timeoutMs = requestTimeoutMs } = {}) {
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
        reject: reason => settle(reject, lostCode ? error(lostCode,
          'Codex did not return a receipt; reconcile native state before retrying', { cause: reason }) : reason),
      });
      timer = setTimeout(() => pending.get(id)?.reject(error('rpc_timeout', 'Codex request timed out')), timeoutMs);
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
          // This client cannot approve commands, tools, permissions or refresh auth. A refusal is
          // settled by Codex as a failed request; a decline as the user's denial. Neither runs anything.
          const decline = declineApprovalsFor !== undefined && Object.hasOwn(APPROVAL_DECLINES, message.method)
            && record(message.params) && message.params.threadId === declineApprovalsFor
            ? APPROVAL_DECLINES[message.method]() : null;
          try { onServerRequest?.(message.method, decline ? 'declined' : 'refused'); }
          catch { /* Observer failures never grant a request. */ }
          try {
            write(decline ? { id: message.id, result: decline }
              : { id: message.id, error: { code: -32601, message: 'This client does not handle server requests' } });
          } catch { /* The transport failure already settles pending callers. */ }
        } else {
          try { onNotification?.(message.method, record(message.params) ? message.params : null); }
          catch { /* Notification observers are bounded consumers, never transport owners. */ }
        }
        continue;
      }
      const wait = pending.get(message.id);
      if (!wait) continue; // Cancelled/timed-out reads can still return; IDs are never reused.
      if (record(message.error)) {
        // Provider messages/data can contain paths, prompts or private values; expose only numeric code.
        // `writerOwned` is derived from Codex's fixed writer-lock refusal text, never forwarded verbatim.
        const writerOwned = message.error.code === -32600 && typeof message.error.message === 'string'
          && /^thread [0-9a-f-]{36} already has an active writer$/i.test(message.error.message);
        wait.reject(error('rpc_error', 'Codex rejected the request', { rpcCode: message.error.code, authoritative: true,
          ...(writerOwned ? { writerOwned: true } : {}) }));
      } else if (Object.hasOwn(message, 'result')) wait.resolve(message.result);
      else wait.reject(error('invalid_response', 'Codex returned an invalid RPC response'));
    }
  }
  async function connect() {
    if (destroyed) throw error('client_closed', 'Codex client is closed');
    if (failure) throw failure;
    if (initialized) return;
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
        clientInfo: { name: clientName, title: 'NEKODEX', version: '1' },
        capabilities: { experimentalApi: false, requestAttestation: false },
      });
      if (!record(response) || typeof response.userAgent !== 'string'
        || typeof response.codexHome !== 'string' || path.resolve(response.codexHome) !== codexHome) {
        throw error('home_mismatch', 'Codex did not confirm the configured home');
      }
      userAgent = response.userAgent;
      write({ method: 'initialized', params: {} });
      initialized = true;
    })().catch(async reason => {
      fail(reason);
      await destroy();
      throw reason;
    });
    return connecting;
  }
  async function waitClosed(ms) {
    if (closed) return true;
    let timer;
    const didClose = await Promise.race([childClosed.then(() => true),
      new Promise(resolve => { timer = setTimeout(() => resolve(false), ms); })]);
    clearTimeout(timer);
    return didClose;
  }
  /** Awaits the owned process closing; process exit releases every Codex lock it held. */
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
  return Object.freeze({
    connect, request, destroy, state,
    userAgent: () => userAgent,
    failureCode: () => failure?.code || null,
    isClosed: () => closed || destroyed,
    transport: controlSocket ? 'existing-server-proxy' : 'owned-stdio-server',
    codexHome, executable, controlSocket: controlSocket ?? null,
  });
}

module.exports = { createCodexAppServerConnection, absolute, record, error };
