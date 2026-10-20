'use strict';
// Trusted Electron main only. This is an HTTP tools provider, never a stdio recipe or credential bridge.
const https = require('node:https');
const dns = require('node:dns');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { createOAuthMcpJournal } = require('./oauth-mcp-journal.cjs');
const { validateOAuthMcpPin, oauthMcpPinDigest, validateInvocation, validateScope, canonical, digest, plain, publicAddress, scrub } = require('./oauth-mcp-contract.cjs');
const fail = () => { throw new Error('OAuth MCP approved transport unavailable; inspect the retained receipt'); };
const METHODS = new Set(['initialize', 'notifications/initialized', 'tools/list', 'tools/call', 'notifications/cancelled']);
/** The TLS socket performs the only DNS lookup. Every returned address must be globally public.
 * No ambient fetch/proxy/cookie implementation, redirects, auth retries or request body logging.
 * Buffering is intentional: both JSON and finite POST SSE have hard aggregate/time limits.
 */
function createOAuthMcpFetch({ endpoint, token, signal, assertCurrent, onToolDispatch, expectedCall,
  httpsRequest = https.request, dnsLookup = dns.lookup, requestTimeoutMs = 15000 }) {
  const target = new URL(endpoint), counts = new Map(); let requests = 0;
  return async (raw, init = {}) => {
    assertCurrent(); signal.throwIfAborted();
    if (String(raw) !== endpoint || ++requests > 16) fail();
    // Optional server-to-client GET is deliberately unsupported. Never open/reconnect a background stream.
    if (init.method === 'GET') return new Response(null, { status: 405 });
    const method = init.method || 'GET';
    const headers = new Headers(init.headers);
    if (headers.has('authorization') || headers.has('cookie') || !['POST', 'DELETE'].includes(method)) fail();
    let message;
    if (method === 'POST') {
      if (typeof init.body !== 'string' || Buffer.byteLength(init.body) > 112 * 1024) fail();
      try { message = JSON.parse(init.body); } catch { fail(); }
      if (!plain(message) || message.jsonrpc !== '2.0' || !METHODS.has(message.method)) fail();
      const count = (counts.get(message.method) || 0) + 1; counts.set(message.method, count);
      if (count > (message.method === 'tools/list' ? 9 : 1)) fail();
      if (message.method === 'tools/call') {
        if (!expectedCall || canonical(message.params) !== canonical(expectedCall)) fail();
        // Independent physical dispatch fence, consumed before constructing any HTTP request.
        onToolDispatch();
      }
    } else if (init.body !== undefined || (counts.get('DELETE') || 0) >= 1) fail();
    else counts.set('DELETE', 1);
    const allowed = new Set(['accept', 'content-type', 'mcp-session-id', 'mcp-protocol-version']);
    for (const [name, value] of headers) if (!allowed.has(name) || value.length > 1024 || value.includes(token)) fail();
    assertCurrent(); signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      let settled = false, response;
      const safeReject = () => { if (!settled) { settled = true; response?.destroy(); reject(new Error('OAuth MCP HTTPS observation unavailable')); } };
      let request;
      try {
        request = httpsRequest(target, { method, agent: false, signal, rejectUnauthorized: true, minVersion: 'TLSv1.2',
          servername: target.hostname, headers: { ...Object.fromEntries(headers), authorization: 'Bearer ' + token },
          lookup(hostname, options, callback) {
            if (hostname !== target.hostname) { callback(new Error('OAuth MCP pinned host unavailable')); return; }
            dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
              if (error || !Array.isArray(addresses) || !addresses.length || !addresses.every(row => publicAddress(row.address))) {
                callback(new Error('OAuth MCP public socket required')); return;
              }
              const selected = addresses.find(row => !options.family || row.family === options.family);
              if (!selected) { callback(new Error('OAuth MCP address family unavailable')); return; }
              try { assertCurrent(); signal.throwIfAborted(); } catch { callback(new Error('OAuth MCP stale socket authority')); return; }
              if (options.all) callback(null, addresses); else callback(null, selected.address, selected.family);
            });
          },
        }, incoming => {
          response = incoming; const chunks = []; let size = 0;
          incoming.on('data', chunk => { size += chunk.length; if (size > 256 * 1024) { request.destroy(); safeReject(); } else chunks.push(chunk); });
          incoming.on('error', safeReject); incoming.on('aborted', safeReject);
          incoming.on('end', () => {
            if (settled) return;
            try {
              assertCurrent(); signal.throwIfAborted();
              const status = incoming.statusCode || 502;
              // Error bodies/challenges/Location are not returned to SDK, UI, core or diagnostics.
              if (status < 200 || status >= 300) {
                settled = true; resolve(new Response(null, { status: status >= 400 && status <= 599 ? status : 502 })); return;
              }
              const contentType = String(incoming.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
              const resultHeaders = new Headers();
              if (status !== 202 && status !== 204 && !['application/json', 'text/event-stream'].includes(contentType)) fail();
              if (contentType) resultHeaders.set('content-type', contentType);
              const session = incoming.headers['mcp-session-id'];
              if (session !== undefined) {
                if (typeof session !== 'string' || !/^[\x21-\x7e]{1,512}$/.test(session) || session.includes(token)) fail();
                resultHeaders.set('mcp-session-id', session);
              }
              // Remove literal echoes immediately. Decoded JSON strings are scrubbed again before publication.
              const body = Buffer.concat(chunks).toString('utf8').split(token).join('[protected]');
              if (contentType === 'text/event-stream' && (body.split(/\r?\n/).some(line => line.length > 96 * 1024) || body.split(/\r?\n\r?\n/).length > 128)) fail();
              settled = true; resolve(new Response([202, 204, 205].includes(status) ? null : body, { status, headers: resultHeaders }));
            } catch { safeReject(); }
          });
        });
        request.on('error', safeReject);
        request.setTimeout(requestTimeoutMs, () => { request.destroy(); safeReject(); });
        if (method === 'POST') request.write(init.body);
        request.end();
      } catch { request?.destroy(); safeReject(); }
    });
  };
}
function createOAuthMcpProvider({ pin: inputPin, getReviewedPin, oauthService, journalDirectory, isScopeActive,
  requestTimeoutMs = 15000, httpsRequest, dnsLookup, toolNamePrefix = '' } = {}) {
  const pin = validateOAuthMcpPin(inputPin), binding = oauthMcpPinDigest(pin);
  if (typeof getReviewedPin !== 'function' || typeof oauthService?.withAccessToken !== 'function' || typeof isScopeActive !== 'function'
    || !/^[a-zA-Z0-9_.-]{0,24}$/.test(toolNamePrefix) || !Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 10 || requestTimeoutMs > 30000) fail();
  const journal = createOAuthMcpJournal({ directory: journalDirectory, pinDigest: binding });
  const catalog = new Map(), active = new Map(), invalidScopes = new Set(); let stopped = false, closing;
  const scopeKey = scope => canonical({ taskId: scope.taskId, generation: scope.generation });
  function assertCurrent(scope) {
    if (stopped || invalidScopes.has(scopeKey(scope)) || !isScopeActive(scope)
      || oauthMcpPinDigest(validateOAuthMcpPin(getReviewedPin())) !== binding) fail();
  }
  async function session(scope, control, run, expectedCall, onToolDispatch = fail) {
    assertCurrent(scope); control.signal?.throwIfAborted();
    const controller = new AbortController(), key = scopeKey(scope);
    if (active.has(key)) fail();
    const settled = {};
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(requestTimeoutMs), ...(control.signal ? [control.signal] : [])]);
    active.set(key, { controller, settled });
    const work = oauthService.withAccessToken({ providerId: pin.providerId, resource: pin.resource, accountId: pin.accountId, epoch: pin.epoch }, async token => {
      if (typeof token !== 'string' || !token || /[\r\n]/.test(token)) fail();
      assertCurrent(scope); signal.throwIfAborted();
      const transport = new StreamableHTTPClientTransport(new URL(pin.endpoint), {
        fetch: createOAuthMcpFetch({ endpoint: pin.endpoint, token, signal, assertCurrent: () => assertCurrent(scope), expectedCall, onToolDispatch,
          requestTimeoutMs, ...(httpsRequest ? { httpsRequest } : {}), ...(dnsLookup ? { dnsLookup } : {}) }),
        reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 },
      });
      const client = new Client({ name: 'nekodex-reviewed-oauth-mcp', version: '1.0.0' }, { capabilities: {} });
      // No SDK authProvider, error forwarding, dynamic registration, redirect, retry or fallback.
      client.onerror = () => {};
      try {
        await client.connect(transport, { signal, timeout: requestTimeoutMs, maxTotalTimeout: requestTimeoutMs });
        assertCurrent(scope); signal.throwIfAborted();
        const result = await run(client, signal);
        assertCurrent(scope); signal.throwIfAborted();
        return scrub(result, token);
      } finally {
        // DELETE only ends this MCP session. Its receipt says nothing about an earlier tool effect.
        if (!signal.aborted) { try { await transport.terminateSession(); } catch {} }
        await client.close().catch(() => {});
      }
    });
    settled.promise = work;
    try { return await work; }
    catch { throw new Error('OAuth MCP bounded observation unavailable; no automatic replay'); }
    finally { if (active.get(key)?.settled === settled) active.delete(key); }
  }
  function safeOutcome(state, result) { return result === undefined ? { state, reason: state === 'failed' ? 'Exact remote tool was not dispatched' : 'Remote effect unknown; retained receipt prevents replay' } : { state, result }; }
  return Object.freeze({ serverId: pin.serverId,
    async discover(scopeInput, control = {}) {
      const scope = validateScope(scopeInput);
      const tools = await session(scope, control, async (client, signal) => {
        const result = [], names = new Set(), cursors = new Set(); let cursor;
        do {
          assertCurrent(scope); signal.throwIfAborted();
          const page = await client.listTools(cursor ? { cursor } : {}, { signal, timeout: requestTimeoutMs, maxTotalTimeout: requestTimeoutMs });
          for (const tool of page.tools) {
            if (!/^[a-zA-Z0-9_.-]{1,120}$/.test(tool.name) || names.has(tool.name) || result.length >= 64 || !plain(tool.inputSchema)
              || Buffer.byteLength(canonical(tool.inputSchema)) > 64 * 1024) fail();
            names.add(tool.name); result.push({ name: tool.name, ...(tool.description ? { description: tool.description.slice(0, 4000) } : {}), inputSchema: tool.inputSchema });
          }
          cursor = page.nextCursor;
          if (cursor) { if (typeof cursor !== 'string' || cursor.length > 2048 || cursors.has(cursor) || cursors.size >= 8) fail(); cursors.add(cursor); }
        } while (cursor);
        return result;
      });
      assertCurrent(scope);
      const descriptors = tools.map(tool => ({ id: pin.serverId + '/' + toolNamePrefix + tool.name, serverId: pin.serverId, name: toolNamePrefix + tool.name,
        ...(tool.description ? { description: tool.description } : {}), supported: true,
        inputSchema: { type: 'object', properties: { binding: { type: 'string', const: binding }, input: tool.inputSchema }, required: ['binding', 'input'], additionalProperties: false } }));
      if (descriptors.some(tool => tool.name.length > 120) || Buffer.byteLength(canonical(descriptors)) > 192 * 1024) fail();
      catalog.set(scopeKey(scope), new Set(descriptors.map(row => row.id)));
      return structuredClone(descriptors);
    },
    async execute(input, control = {}) {
      const request = validateInvocation(pin, input);
      const prior = journal.existing(request); if (prior) return prior;
      assertCurrent(request.scope); control.signal?.throwIfAborted();
      if (!request.tool.startsWith(pin.serverId + '/' + toolNamePrefix) || !catalog.get(scopeKey(request.scope))?.has(request.tool)) fail();
      const admitted = journal.begin(request); if (!admitted.inserted) return admitted.outcome;
      let dispatched = false;
      try {
        const expectedCall = { name: request.tool.slice(pin.serverId.length + 1 + toolNamePrefix.length), arguments: request.arguments.input };
        const result = await session(request.scope, control, (client, signal) => client.callTool(expectedCall, undefined,
          { signal, timeout: requestTimeoutMs, maxTotalTimeout: requestTimeoutMs }), expectedCall,
        () => { if (dispatched) fail(); dispatched = true; });
        return journal.settle(request, safeOutcome(result.isError === true ? 'failed' : 'completed', result));
      } catch {
        if (!dispatched) { try { return journal.settle(request, safeOutcome('failed')); } catch {} }
        return journal.existing(request) || safeOutcome('outcome_unknown');
      }
    },
    reconcile(input) { return journal.existing(validateInvocation(pin, input)); },
    attachScope(scope) { if (closing) fail(); validateScope(scope); stopped = false; invalidScopes.delete(scopeKey(scope)); },
    invalidateScope(scope) {
      validateScope(scope); const key = scopeKey(scope); invalidScopes.add(key); catalog.delete(key);
      active.get(key)?.controller.abort();
    },
    invalidate(taskId) {
      if (taskId === undefined) { stopped = true; catalog.clear(); }
      else { for (const key of [...catalog.keys(), ...active.keys()]) if (JSON.parse(key).taskId === taskId) { invalidScopes.add(key); catalog.delete(key); } }
      for (const [key, operation] of active) if (taskId === undefined || JSON.parse(key).taskId === taskId) operation.controller.abort();
    },
    close() {
      if (closing) return closing; stopped = true; catalog.clear(); for (const operation of active.values()) operation.controller.abort();
      closing = Promise.allSettled([...active.values()].map(value => value.settled.promise)).then(() => journal.close()); return closing;
    },
    receipts() { return journal.receipts(); },
    status() { return { serverId: pin.serverId, binding, stopped, activeCount: active.size, ...journal.status() }; },
  });
}
module.exports = { createOAuthMcpProvider, createOAuthMcpFetch };
